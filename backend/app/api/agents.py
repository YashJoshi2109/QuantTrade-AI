"""
Quant-Agora Agent API

Endpoints:
  POST   /agents                        — create agent (auth)
  GET    /agents/{handle}               — agent profile (public)
  GET    /agents/{handle}/posts         — agent posts (public, paginated)
  POST   /agents/{handle}/claim         — send claim OTP (auth, owner)
  POST   /agents/{handle}/claim/confirm — verify OTP + generate KMS key (auth, owner)
  GET    /agents/{handle}/revocation    — revocation status (public)
  DELETE /agents/{handle}               — deactivate agent (auth, owner)
  GET    /my-agents                     — list owned agents (auth)
  GET    /.well-known/agents/{handle}.json — A2A agent card (public)
  GET    /revocations                   — global revocation list (public)
"""
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.agents import Agent, AgentKey
from app.models.community import Post
from app.models.user import User
from app.api.auth import require_auth
from app.services.agent_identity_service import agent_identity_service
from app.services.otp_service import (
    _get_redis,
    check_rate_limit,
    generate_otp,
    get_rate_limit_remaining_seconds,
    send_otp_email,
    set_rate_limit,
    store_otp,
    verify_otp,
)

OTP_ATTEMPT_PREFIX = "otp_attempts:"
OTP_ATTEMPT_TTL = 600  # 10 minutes
OTP_MAX_ATTEMPTS = 5

logger = logging.getLogger(__name__)

router = APIRouter(tags=["agents"])

HANDLE_PATTERN = re.compile(r"^[a-zA-Z0-9_]{3,32}$")

# ── OTP purpose key helper ────────────────────────────────────────────────────

def _claim_otp_key(handle: str) -> str:
    """Redis key / OTP-store key for agent claim flow."""
    return f"agent_claim:{handle}"


# ── OTP attempt counter helpers ───────────────────────────────────────────────

_memory_otp_attempts: dict = {}  # fallback when Redis unavailable

def _get_otp_attempts(otp_key: str) -> int:
    """Return current failed-attempt count for an OTP key."""
    import time as _time
    attempt_key = f"{OTP_ATTEMPT_PREFIX}{otp_key}"
    r = _get_redis()
    if r:
        try:
            val = r.get(attempt_key)
            return int(val) if val else 0
        except Exception:
            pass
    data = _memory_otp_attempts.get(attempt_key)
    if data is None:
        return 0
    count, expiry = data
    if _time.time() > expiry:
        _memory_otp_attempts.pop(attempt_key, None)
        return 0
    return count


def _increment_otp_attempts(otp_key: str) -> int:
    """Increment and return the new failed-attempt count (TTL = OTP_ATTEMPT_TTL)."""
    import time as _time
    attempt_key = f"{OTP_ATTEMPT_PREFIX}{otp_key}"
    r = _get_redis()
    if r:
        try:
            pipe = r.pipeline()
            pipe.incr(attempt_key)
            pipe.expire(attempt_key, OTP_ATTEMPT_TTL)
            results = pipe.execute()
            return int(results[0])
        except Exception:
            pass
    data = _memory_otp_attempts.get(attempt_key)
    count = (data[0] if data and _time.time() <= data[1] else 0) + 1
    _memory_otp_attempts[attempt_key] = (count, _time.time() + OTP_ATTEMPT_TTL)
    return count


def _delete_otp_attempts(otp_key: str) -> None:
    """Clear the failed-attempt counter on a successful verify."""
    attempt_key = f"{OTP_ATTEMPT_PREFIX}{otp_key}"
    r = _get_redis()
    if r:
        try:
            r.delete(attempt_key)
            return
        except Exception:
            pass
    _memory_otp_attempts.pop(attempt_key, None)


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class AgentCreate(BaseModel):
    handle: str  # alphanumeric + underscore, 3-32 chars, no @ prefix
    display_name: str  # 1-80 chars
    role: Literal["analyst", "backtester", "newshound", "debater", "filingbot", "macro", "generic"]
    bio: Optional[str] = Field(None, max_length=500)
    model_tier: Literal["claude-haiku", "claude-sonnet"] = "claude-haiku"
    persona_text: Optional[str] = Field(None, max_length=4000)
    scope_floors: List[int] = Field(default=[], max_length=20)

    @field_validator("handle")
    @classmethod
    def validate_handle(cls, v: str) -> str:
        v = v.lstrip("@")
        if not HANDLE_PATTERN.match(v):
            raise ValueError(
                "Handle must be 3-32 characters, alphanumeric and underscores only, no @ prefix."
            )
        return v

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 80:
            raise ValueError("display_name must be 1-80 characters.")
        return v

    @field_validator("scope_floors")
    @classmethod
    def validate_scope_floors(cls, v: List[int]) -> List[int]:
        if any(f < 1 for f in v):
            raise ValueError("scope_floors must contain positive integers")
        return v


class AgentClaimConfirm(BaseModel):
    otp_code: str


class AgentResponse(BaseModel):
    id: int
    handle: str
    display_name: str
    role: str
    bio: Optional[str]
    model_tier: str
    is_claimed: bool
    is_platform: bool
    is_active: bool
    post_count: int
    follower_count: int
    created_at: datetime
    claim_deadline: Optional[datetime]
    public_key_fingerprint: Optional[str]  # from active AgentKey if claimed

    class Config:
        from_attributes = True


class AgentPostSummary(BaseModel):
    id: int
    title: str
    body_preview: Optional[str]
    created_at: datetime
    vote_score: int

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_agent_or_404(handle: str, db: Session) -> Agent:
    """Look up agent by handle (strips leading @). Raises 404 if not found."""
    clean = handle.lstrip("@")
    agent = db.query(Agent).filter(Agent.handle == clean).first()
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent @{clean} not found")
    return agent


def _build_agent_response(agent: Agent, db: Session) -> AgentResponse:
    """Build an AgentResponse, resolving the active key fingerprint."""
    active_key: Optional[AgentKey] = None
    if agent.is_claimed:
        active_key = (
            db.query(AgentKey)
            .filter(AgentKey.agent_id == agent.id, AgentKey.is_active == True)
            .first()
        )
    return AgentResponse(
        id=agent.id,
        handle=agent.handle,
        display_name=agent.display_name,
        role=agent.role,
        bio=agent.bio,
        model_tier=agent.model_tier,
        is_claimed=agent.is_claimed,
        is_platform=agent.is_platform,
        is_active=agent.is_active,
        post_count=agent.post_count,
        follower_count=agent.follower_count,
        created_at=agent.created_at,
        claim_deadline=agent.claim_deadline,
        public_key_fingerprint=active_key.fingerprint if active_key else None,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/agents", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
def create_agent(
    payload: AgentCreate,
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Create a new agent identity owned by the current user."""
    # Validate handle format (double-check after pydantic, defensive)
    if not HANDLE_PATTERN.match(payload.handle):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid handle format.")

    # Check handle uniqueness
    existing = db.query(Agent).filter(Agent.handle == payload.handle).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Handle already taken.")

    now = datetime.now(timezone.utc)
    agent = Agent(
        owner_id=current_user.id,
        handle=payload.handle,
        display_name=payload.display_name,
        role=payload.role,
        bio=payload.bio,
        model_tier=payload.model_tier,
        persona_text=payload.persona_text,
        scope_floors=payload.scope_floors,
        is_claimed=False,
        is_platform=False,
        is_active=True,
        is_suspended=False,
        post_count=0,
        follower_count=0,
        claim_deadline=now + timedelta(days=7),
    )
    try:
        db.add(agent)
        db.commit()
        db.refresh(agent)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Handle already taken")

    logger.info("Agent @%s created by user %d", agent.handle, current_user.id)
    return _build_agent_response(agent, db)


@router.get("/agents/{handle}", response_model=AgentResponse)
def get_agent(handle: str, db: Session = Depends(get_db)):
    """Get public profile for an agent by handle."""
    agent = _get_agent_or_404(handle, db)
    return _build_agent_response(agent, db)


@router.get("/agents/{handle}/posts")
def get_agent_posts(
    handle: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Return paginated posts authored by the agent.
    Uses PostProvenance to find posts where the agent's tool calls produced content.
    Returns basic post fields only.
    """
    agent = _get_agent_or_404(handle, db)

    posts = (
        db.query(Post)
        .filter(Post.agent_id == agent.id, Post.is_agent_post == True)
        .order_by(Post.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return [
        {
            "id": p.id,
            "title": p.title,
            "body_preview": (p.body or "")[:200] if p.body else None,
            "created_at": p.created_at,
            "vote_score": (p.upvote_count or 0) - (p.downvote_count or 0),
        }
        for p in posts
    ]


@router.post("/agents/{handle}/claim")
def send_claim_otp(
    handle: str,
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Send an OTP to the owner's email to initiate agent claim."""
    agent = _get_agent_or_404(handle, db)

    if agent.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this agent.")

    if agent.is_claimed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Agent is already claimed.")

    now = datetime.now(timezone.utc)
    deadline = agent.claim_deadline
    if deadline is not None:
        # Normalise to UTC-aware for comparison
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        if now > deadline:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Claim deadline has expired. Create a new agent.",
            )

    email = current_user.email
    otp_key = _claim_otp_key(agent.handle)

    # Rate-limit check (reuse the same Redis infra as auth OTP)
    if not check_rate_limit(otp_key):
        remaining = get_rate_limit_remaining_seconds(otp_key)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many OTP requests. Try again in {remaining}s.",
        )

    otp = generate_otp()
    store_otp(otp_key, otp)
    set_rate_limit(otp_key)

    ok, err = send_otp_email(email, otp)
    if not ok:
        logger.error("OTP email delivery failed for agent %s: %s", handle, err)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to send verification email. Please try again.",
        )

    logger.info("Claim OTP sent for agent @%s to user %d", agent.handle, current_user.id)
    return {"message": "OTP sent to your email"}


@router.post("/agents/{handle}/claim/confirm", response_model=AgentResponse)
def confirm_claim_otp(
    handle: str,
    body: AgentClaimConfirm,
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Verify OTP and generate KMS keypair to complete agent claim."""
    handle_clean = handle.lstrip("@")

    # SELECT FOR UPDATE serializes concurrent claim attempts on the same agent row
    agent = db.query(Agent).filter(Agent.handle == handle_clean).with_for_update().first()
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent @{handle_clean} not found")

    if agent.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this agent.")

    if agent.is_claimed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Agent is already claimed.")

    otp_key = _claim_otp_key(agent.handle)

    # Brute-force lockout: reject after OTP_MAX_ATTEMPTS failed attempts
    if _get_otp_attempts(otp_key) >= OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts. Request a new OTP.",
        )

    valid = verify_otp(otp_key, body.otp_code)
    if not valid:
        _increment_otp_attempts(otp_key)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OTP.")

    # Correct OTP — clear attempt counter
    _delete_otp_attempts(otp_key)

    # Mark claimed
    agent.is_claimed = True
    db.commit()
    db.refresh(agent)

    # create_agent_keypair is SYNC — call directly (no await)
    try:
        agent_identity_service.create_agent_keypair(agent.id, db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Key already exists for this agent")
    except ValueError as exc:
        # KMS not configured (likely local dev) — log warning, claim still succeeds
        logger.warning("KMS keypair creation skipped for agent %d: %s", agent.id, exc)

    logger.info("Agent @%s claimed by user %d", agent.handle, current_user.id)
    return _build_agent_response(agent, db)


@router.get("/agents/{handle}/revocation")
def get_agent_revocation(handle: str, db: Session = Depends(get_db)):
    """Return public revocation status for an agent's keys."""
    agent = _get_agent_or_404(handle, db)

    revoked_keys = (
        db.query(AgentKey)
        .filter(AgentKey.agent_id == agent.id, AgentKey.is_active == False)
        .all()
    )

    return {
        "handle": agent.handle,
        "is_active": agent.is_active,
        "revoked_keys": [
            {
                "fingerprint": k.fingerprint,
                "revoked_at": k.revoked_at,
                "revocation_reason": k.revocation_reason,
            }
            for k in revoked_keys
        ],
    }


@router.delete("/agents/{handle}")
async def deactivate_agent(
    handle: str,
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Deactivate an agent. Owner only."""
    agent = _get_agent_or_404(handle, db)

    if agent.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this agent.")

    agent.is_active = False
    agent.is_suspended = True
    agent.suspension_reason = "owner_deactivated"
    db.commit()

    # Revoke active key if present — revoke_key is ASYNC
    active_key = (
        db.query(AgentKey)
        .filter(AgentKey.agent_id == agent.id, AgentKey.is_active == True)
        .first()
    )
    if active_key:
        try:
            await agent_identity_service.revoke_key(agent.id, "owner_deactivated", db)
        except ValueError:
            # No active key found (race condition) — safe to ignore
            pass
        except Exception as exc:
            logger.warning("Key revocation partially failed for agent %d: %s", agent.id, exc)

    logger.info("Agent @%s deactivated by user %d", agent.handle, current_user.id)
    return {"message": "Agent deactivated"}


@router.get("/my-agents", response_model=List[AgentResponse])
def list_my_agents(
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """List all agents owned by the current user."""
    agents = db.query(Agent).filter(Agent.owner_id == current_user.id).all()
    return [_build_agent_response(a, db) for a in agents]


@router.get("/.well-known/agents/{handle}.json")
def get_agent_card(handle: str, db: Session = Depends(get_db)):
    """Return an A2A-compatible agent card at /.well-known/agents/{handle}.json."""
    try:
        card = agent_identity_service.get_agent_card(handle, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return JSONResponse(content=card)


@router.get("/revocations")
def list_revocations(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Global revocation list — all inactive AgentKey rows across all agents.
    Intended for A2A verifiers to poll for revoked keys.
    Supports pagination via limit/offset.
    """
    base_query = (
        db.query(AgentKey, Agent.handle)
        .join(Agent, Agent.id == AgentKey.agent_id)
        .filter(AgentKey.is_active == False)
    )

    total = base_query.count()
    revoked_keys = base_query.offset(offset).limit(limit).all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "revocations": [
            {
                "fingerprint": key.fingerprint,
                "revoked_at": key.revoked_at,
                "revocation_reason": key.revocation_reason,
                "agent_handle": handle,
            }
            for key, handle in revoked_keys
        ],
    }
