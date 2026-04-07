"""
QuantTrade Life — Game API router.

Protected endpoints (all require valid JWT):
  GET  /api/v1/game/bootstrap    — auth + profile + character + wallet + missions + community
  GET  /api/v1/game/character    — character state
  GET  /api/v1/game/wallet       — treasury state
  GET  /api/v1/game/missions     — active missions
  GET  /api/v1/game/community    — community groups
  POST /api/v1/game/character/update — update character traits/name/avatar
  POST /api/v1/game/mission/complete — mark mission complete + award XP/gold
  GET  /api/v1/game/stage-config — stage metadata (unlocked assets, story arc)
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import httpx

from app.db.database import get_db
from app.api.auth import require_auth
from app.models.user import User
from app.config import settings
from app.models.game import (
    GameCharacter, GameWallet, GameMission,
    GameCommunityGroup, GameCharacterCommunity,
    MissionStatus,
)
from app.services.game_service import (
    bootstrap_game, STAGE_CONFIGS, DEFAULT_STORY_ARCS,
    compute_age, map_age_to_stage,
)

router = APIRouter()


# ── Bootstrap ─────────────────────────────────────────────────────────────────

@router.get("/bootstrap")
def game_bootstrap(
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Single endpoint the frontend calls on game entry.
    - Validates auth
    - Computes age/stage from DOB
    - Creates or loads character
    - Returns full game state
    """
    return bootstrap_game(user, db)


# ── Character ─────────────────────────────────────────────────────────────────

@router.get("/character")
def get_character(
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    char = db.query(GameCharacter).filter(GameCharacter.user_id == user.id).first()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found. Call /game/bootstrap first.")
    return {
        "id": char.id,
        "name": char.name,
        "avatar_style": char.avatar_style,
        "life_stage": char.life_stage.value,
        "level": char.level,
        "xp": char.xp,
        "xp_to_next_level": char.xp_to_next_level,
        "streak_days": char.streak_days,
        "financial_confidence": char.financial_confidence,
        "discipline_score": char.discipline_score,
        "risk_appetite": char.risk_appetite,
        "savings_habit": char.savings_habit,
        "emotional_resilience": char.emotional_resilience,
        "diversification_score": char.diversification_score,
        "current_story_arc": char.current_story_arc,
        "story_arc_step": char.story_arc_step,
        "behavioral_profile": char.behavioral_profile or {},
        "created_at": char.created_at.isoformat() if char.created_at else None,
    }


class CharacterUpdateRequest(BaseModel):
    name: Optional[str] = None
    avatar_style: Optional[str] = None  # knight|scholar|merchant|noble|sage


@router.post("/character/update")
def update_character(
    req: CharacterUpdateRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    char = db.query(GameCharacter).filter(GameCharacter.user_id == user.id).first()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found.")
    if req.name:
        char.name = req.name[:100]
    if req.avatar_style and req.avatar_style in ("knight", "scholar", "merchant", "noble", "sage"):
        char.avatar_style = req.avatar_style
    db.commit()
    return {"success": True, "name": char.name, "avatar_style": char.avatar_style}


# ── Wallet ────────────────────────────────────────────────────────────────────

@router.get("/wallet")
def get_wallet(
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    char = db.query(GameCharacter).filter(GameCharacter.user_id == user.id).first()
    if not char or not char.wallet:
        raise HTTPException(status_code=404, detail="Wallet not found. Call /game/bootstrap first.")
    w = char.wallet
    return {
        "cash_balance": w.cash_balance,
        "salary_monthly": w.salary_monthly,
        "emergency_fund": w.emergency_fund,
        "total_invested": w.total_invested,
        "total_debt": w.total_debt,
        "net_worth": w.net_worth,
        "gold_coins": w.gold_coins,
        "silver_coins": w.silver_coins,
        "monthly_expenses": w.monthly_expenses,
        "savings_rate": w.savings_rate,
        "net_worth_history": w.net_worth_history or [],
    }


# ── Missions ──────────────────────────────────────────────────────────────────

@router.get("/missions")
def get_missions(
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    char = db.query(GameCharacter).filter(GameCharacter.user_id == user.id).first()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found.")
    missions = db.query(GameMission).filter(
        GameMission.character_id == char.id
    ).order_by(GameMission.status, GameMission.created_at).all()
    return [
        {
            "id": m.id,
            "title": m.title,
            "description": m.description,
            "mission_type": m.mission_type,
            "category": m.category,
            "target_value": m.target_value,
            "current_value": m.current_value,
            "xp_reward": m.xp_reward,
            "gold_reward": m.gold_reward,
            "status": m.status.value,
            "progress_pct": round(
                min(100, m.current_value / m.target_value * 100)
                if m.target_value else 0
            ),
        }
        for m in missions
    ]


class MissionCompleteRequest(BaseModel):
    mission_id: int


class VoiceoverRequest(BaseModel):
    text: str
    role: str = "narrator"  # narrator | character
    avatar_style: Optional[str] = None  # knight|scholar|merchant|noble|sage


def _resolve_voice_id(role: str, avatar_style: Optional[str]) -> Optional[str]:
    if role == "character":
        style = (avatar_style or "").lower()
        if style == "knight":
            return settings.ELEVENLABS_VOICE_KNIGHT or settings.ELEVENLABS_VOICE_NARRATOR
        if style == "scholar":
            return settings.ELEVENLABS_VOICE_SCHOLAR or settings.ELEVENLABS_VOICE_NARRATOR
        if style == "merchant":
            return settings.ELEVENLABS_VOICE_MERCHANT or settings.ELEVENLABS_VOICE_NARRATOR
        if style == "noble":
            return settings.ELEVENLABS_VOICE_NOBLE or settings.ELEVENLABS_VOICE_NARRATOR
        if style == "sage":
            return settings.ELEVENLABS_VOICE_SAGE or settings.ELEVENLABS_VOICE_NARRATOR
    return settings.ELEVENLABS_VOICE_NARRATOR


@router.post("/mission/complete")
def complete_mission(
    req: MissionCompleteRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    char = db.query(GameCharacter).filter(GameCharacter.user_id == user.id).first()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found.")
    mission = db.query(GameMission).filter(
        GameMission.id == req.mission_id,
        GameMission.character_id == char.id,
    ).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found.")
    if mission.status != MissionStatus.active:
        raise HTTPException(status_code=400, detail=f"Mission is already {mission.status.value}.")

    mission.status = MissionStatus.completed
    mission.completed_at = datetime.utcnow()

    # Award XP + gold
    char.xp += mission.xp_reward
    if char.wallet:
        char.wallet.gold_coins = (char.wallet.gold_coins or 0) + mission.gold_reward

    # Level-up check
    leveled_up = False
    while char.xp >= char.xp_to_next_level:
        char.xp -= char.xp_to_next_level
        char.level += 1
        char.xp_to_next_level = int(char.xp_to_next_level * 1.4)
        leveled_up = True

    db.commit()
    return {
        "success": True,
        "xp_awarded": mission.xp_reward,
        "gold_awarded": mission.gold_reward,
        "leveled_up": leveled_up,
        "new_level": char.level,
        "new_xp": char.xp,
    }


@router.post("/audio/voiceover")
def game_voiceover(
    req: VoiceoverRequest,
    user: User = Depends(require_auth),
):
    """
    Generate speech audio via ElevenLabs for in-game narration and character voice lines.
    """
    _ = user  # authenticated endpoint; user context may be used for quotas later
    if not settings.ELEVENLABS_API_KEY:
        raise HTTPException(status_code=503, detail="ElevenLabs is not configured on the server")
    voice_id = _resolve_voice_id(req.role, req.avatar_style)
    if not voice_id:
        raise HTTPException(status_code=503, detail="No ElevenLabs voice configured for this role")

    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    if len(text) > 1500:
        text = text[:1500]

    endpoint = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    payload = {
        "text": text,
        "model_id": settings.ELEVENLABS_MODEL_ID,
        "voice_settings": {"stability": 0.45, "similarity_boost": 0.75},
    }
    headers = {
        "xi-api-key": settings.ELEVENLABS_API_KEY,
        "accept": "audio/mpeg",
        "content-type": "application/json",
    }

    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(endpoint, json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Voice generation failed")
        return Response(content=resp.content, media_type="audio/mpeg")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Voice generation failed")


# ── Community ─────────────────────────────────────────────────────────────────

@router.get("/community")
def get_community(
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    char = db.query(GameCharacter).filter(GameCharacter.user_id == user.id).first()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found.")
    memberships = db.query(GameCharacterCommunity).filter(
        GameCharacterCommunity.character_id == char.id
    ).all()
    group_ids = [m.group_id for m in memberships]
    rep_map = {m.group_id: m.reputation for m in memberships}
    groups = db.query(GameCommunityGroup).filter(
        GameCommunityGroup.id.in_(group_ids)
    ).all() if group_ids else []
    return [
        {
            "id": g.id,
            "name": g.name,
            "slug": g.slug,
            "description": g.description,
            "icon": g.icon,
            "color": g.color,
            "member_count": g.member_count,
            "is_global": g.is_global,
            "my_reputation": rep_map.get(g.id, 0),
        }
        for g in groups
    ]


# ── Stage config ──────────────────────────────────────────────────────────────

@router.get("/stage-config")
def get_stage_config(
    user: User = Depends(require_auth),
):
    """Return metadata for the user's computed life stage."""
    from app.models.game import LifeStage
    from datetime import date as _date
    dob = getattr(user, "date_of_birth", None)
    age = compute_age(dob) if dob else None
    stage = map_age_to_stage(age) if age is not None else LifeStage.college
    cfg = STAGE_CONFIGS[stage]
    return {
        "stage": stage.value,
        "display": cfg["display"],
        "realm": cfg["realm"],
        "description": cfg["description"],
        "unlocked_assets": cfg["unlocked_assets"],
        "story_arc": cfg["story_arc"],
        "story_arc_narrative": DEFAULT_STORY_ARCS.get(cfg["story_arc"], ""),
        "age": age,
    }
