"""
Authentication API endpoints
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta, date
import jwt
import bcrypt
from app.db.database import get_db
from app.models.user import User
from app.config import settings
from app.services.email_verifier_service import validate_email
from app.services.otp_service import (
    generate_otp,
    store_otp,
    verify_otp,
    check_rate_limit,
    get_rate_limit_remaining_seconds,
    set_rate_limit,
    send_otp_email,
)
try:
    from app.services.login_notification_service import send_login_notification
    LOGIN_NOTIFY_AVAILABLE = True
except ImportError:
    LOGIN_NOTIFY_AVAILABLE = False

# Google OAuth
try:
    from google.oauth2 import id_token
    from google.auth.transport import requests
    GOOGLE_AUTH_AVAILABLE = True
except ImportError:
    GOOGLE_AUTH_AVAILABLE = False

router = APIRouter()
security = HTTPBearer(auto_error=False)

# JWT Settings
SECRET_KEY = settings.SECRET_KEY or "your-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7


# Request/Response Models
class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str
    full_name: Optional[str] = None
    country_code: Optional[str] = None
    phone_number: Optional[str] = None
    otp: Optional[str] = None  # Optional code for email verification
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None  # male | female | non-binary | prefer_not_to_say


class UserLogin(BaseModel):
    email: str
    password: str


class GoogleLogin(BaseModel):
    google_id: str
    email: str
    name: str
    avatar_url: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    full_name: Optional[str]
    avatar_url: Optional[str]
    is_verified: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


# Helper functions
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))


def create_access_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": str(user_id),
        "exp": expire,
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload.get("sub"))
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Get current user from JWT token (returns None if not authenticated)"""
    if not credentials:
        return None
    
    user_id = decode_token(credentials.credentials)
    if not user_id:
        return None
    
    user = db.query(User).filter(User.id == user_id).first()
    return user


def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Require authentication - raises 401 if not authenticated"""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    user_id = decode_token(credentials.credentials)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )
    
    return user


def user_to_dict(user: User) -> dict:
    dob = getattr(user, "date_of_birth", None)
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url,
        "is_verified": user.is_verified,
        "country_code": getattr(user, "country_code", None),
        "phone_number": getattr(user, "phone_number", None),
        "date_of_birth": dob.isoformat() if dob else None,
        "gender": getattr(user, "gender", None),
        "created_at": user.created_at.isoformat() if user.created_at else None
    }


# --- Email Validation & OTP Endpoints ---
class ValidateEmailRequest(BaseModel):
    email: str


@router.get("/validate-email")
async def validate_email_endpoint(email: str):
    """Validate email format and deliverability via Rapid Email Verifier API."""
    result = await validate_email(email)
    return {
        "valid": result.valid,
        "status": result.status,
        "syntax_valid": result.syntax_valid,
        "domain_exists": result.domain_exists,
        "is_disposable": result.is_disposable,
        "message": result.message,
        "typo_suggestion": result.typo_suggestion,
        "alias_of": result.alias_of,
    }


class SendOtpRequest(BaseModel):
    email: EmailStr


@router.post("/send-otp")
async def send_otp_endpoint(req: SendOtpRequest, db: Session = Depends(get_db)):
    """Send OTP to email for verification. Rate limited to 1 per minute."""
    if not check_rate_limit(req.email):
        wait_seconds = get_rate_limit_remaining_seconds(req.email)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Please wait {wait_seconds} seconds before requesting another code"
                if wait_seconds > 0
                else "Please wait a moment before requesting another code"
            ),
        )
    otp = generate_otp()
    if not store_otp(req.email, otp):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OTP service temporarily unavailable"
        )
    sent, mail_error = await asyncio.to_thread(send_otp_email, req.email, otp)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=mail_error or "Failed to send verification email.",
        )
    set_rate_limit(req.email)
    return {"message": "Verification code sent to your email"}


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str


@router.post("/verify-otp")
async def verify_otp_endpoint(req: VerifyOtpRequest):
    """Verify OTP code."""
    if verify_otp(req.email, req.otp):
        return {"verified": True, "message": "Email verified successfully"}
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid or expired verification code"
    )


# Endpoints
@router.post("/register", response_model=TokenResponse)
async def register(user_data: UserRegister, db: Session = Depends(get_db)):
    """Register a new user with optional email verification and phone"""
    # Optional: require OTP verification if OTP provided
    if user_data.otp:
        if not verify_otp(user_data.email, user_data.otp):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired verification code. Please request a new one."
            )

    # Check if email exists
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Check if username exists
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )
    
    # Create user
    user = User(
        email=user_data.email,
        username=user_data.username,
        hashed_password=hash_password(user_data.password),
        full_name=user_data.full_name,
        country_code=user_data.country_code,
        phone_number=user_data.phone_number,
        is_verified=True,
        otp_verified=bool(user_data.otp),
        email_verified_at=datetime.utcnow() if user_data.otp else None,
        date_of_birth=user_data.date_of_birth,
        gender=user_data.gender,
    )
    
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Generate token
    token = create_access_token(user.id)
    
    return TokenResponse(
        access_token=token,
        user=user_to_dict(user)
    )


@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin, request: Request, db: Session = Depends(get_db)):
    """Login with email and password"""
    user = db.query(User).filter(User.email == credentials.email).first()
    
    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    if not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Update last login
    user.last_login = datetime.utcnow()
    db.commit()
    
    # OWASP A09: Security event — notify user of new sign-in with IP (fire-and-forget)
    if LOGIN_NOTIFY_AVAILABLE:
        ip_address = (
            request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or request.headers.get("X-Real-IP", "")
            or (request.client.host if request.client else "unknown")
        )
        user_agent = request.headers.get("User-Agent", "Unknown")
        asyncio.create_task(
            send_login_notification(
                email=user.email,
                ip_address=ip_address,
                user_agent=user_agent,
            )
        )
    
    # Generate token
    token = create_access_token(user.id)
    
    return TokenResponse(
        access_token=token,
        user=user_to_dict(user)
    )


class GoogleTokenVerify(BaseModel):
    credential: str  # Google ID token


@router.post("/google/verify", response_model=TokenResponse)
async def google_verify_token(
    token_data: GoogleTokenVerify,
    db: Session = Depends(get_db)
):
    """Verify Google ID token and login/register user"""
    if not GOOGLE_AUTH_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth not configured. Install google-auth library."
        )
    
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GOOGLE_CLIENT_ID not configured"
        )
    
    try:
        # Verify the Google ID token
        idinfo = id_token.verify_oauth2_token(
            token_data.credential,
            requests.Request(),
            settings.GOOGLE_CLIENT_ID
        )
        
        # Extract user info
        google_id = idinfo.get('sub')
        email = idinfo.get('email')
        name = idinfo.get('name', '')
        picture = idinfo.get('picture')
        
        if not google_id or not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid Google token"
            )
        
        # Check if user exists by Google ID
        user = db.query(User).filter(User.google_id == google_id).first()
        
        if not user:
            # Check if email exists (link accounts)
            user = db.query(User).filter(User.email == email).first()
            
            if user:
                # Link Google account to existing user
                user.google_id = google_id
                if picture:
                    user.avatar_url = picture
            else:
                # Create new user
                # Generate unique username from email
                base_username = email.split('@')[0]
                username = base_username
                counter = 1
                while db.query(User).filter(User.username == username).first():
                    username = f"{base_username}{counter}"
                    counter += 1
                
                user = User(
                    email=email,
                    username=username,
                    google_id=google_id,
                    full_name=name,
                    avatar_url=picture,
                    is_verified=True
                )
                db.add(user)
        
        # Update last login
        user.last_login = datetime.utcnow()
        db.commit()
        db.refresh(user)
        
        # Generate token
        token = create_access_token(user.id)
        
        return TokenResponse(
            access_token=token,
            user=user_to_dict(user)
        )
        
    except ValueError as e:
        # Invalid token
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google token: {str(e)}"
        )


@router.post("/google", response_model=TokenResponse)
async def google_auth(google_data: GoogleLogin, db: Session = Depends(get_db)):
    """Login or register with Google OAuth (legacy endpoint - use /google/verify instead)"""
    # Check if user exists by Google ID
    user = db.query(User).filter(User.google_id == google_data.google_id).first()
    
    if not user:
        # Check if email exists (link accounts)
        user = db.query(User).filter(User.email == google_data.email).first()
        
        if user:
            # Link Google account to existing user
            user.google_id = google_data.google_id
            if google_data.avatar_url:
                user.avatar_url = google_data.avatar_url
        else:
            # Create new user
            # Generate unique username from email
            base_username = google_data.email.split('@')[0]
            username = base_username
            counter = 1
            while db.query(User).filter(User.username == username).first():
                username = f"{base_username}{counter}"
                counter += 1
            
            user = User(
                email=google_data.email,
                username=username,
                google_id=google_data.google_id,
                full_name=google_data.name,
                avatar_url=google_data.avatar_url,
                is_verified=True
            )
            db.add(user)
    
    # Update last login
    user.last_login = datetime.utcnow()
    db.commit()
    db.refresh(user)
    
    # Generate token
    token = create_access_token(user.id)
    
    return TokenResponse(
        access_token=token,
        user=user_to_dict(user)
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(require_auth)):
    """Get current user info"""
    return user


@router.get("/session")
async def check_session(user: User = Depends(get_current_user)):
    """Check if user is authenticated (doesn't require auth)"""
    if user:
        return {
            "authenticated": True,
            "user": user_to_dict(user)
        }
    return {
        "authenticated": False,
        "user": None
    }


@router.post("/logout")
async def logout():
    """Logout (client should delete token)"""
    return {"message": "Logged out successfully"}


# ─── Passkey / WebAuthn Endpoints ────────────────────────────────────────────
import secrets as _secrets
import base64 as _base64
import time as _time
from typing import Dict, Tuple, Optional as _Opt

try:
    import webauthn as _webauthn
    WEBAUTHN_AVAILABLE = True
except ImportError:
    WEBAUTHN_AVAILABLE = False

from app.models.passkey_credential import PasskeyCredential

# In-process challenge store: session_token → (challenge_b64url, user_id|None, expires_at)
_passkey_challenges: Dict[str, Tuple[str, _Opt[int], float]] = {}
_CHALLENGE_TTL = 300  # 5 minutes


def _webauthn_expected_origins() -> List[str]:
    """Origins allowed in clientDataJSON.origin (must match browser page origin)."""
    raw = (getattr(settings, "WEBAUTHN_ORIGINS", None) or "").strip()
    if raw:
        return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    single = (settings.WEBAUTHN_ORIGIN or "").strip().rstrip("/")
    return [single] if single else ["http://localhost:3000"]


def _b64url(data: bytes) -> str:
    return _base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    # Re-pad and decode
    padding = (4 - len(s) % 4) % 4
    return _base64.urlsafe_b64decode(s + "=" * padding)


def _clean_challenges() -> None:
    now = _time.time()
    expired = [k for k, (_, _, exp) in _passkey_challenges.items() if exp < now]
    for k in expired:
        del _passkey_challenges[k]


class PasskeyRegisterChallengeRequest(BaseModel):
    user_id: int


class PasskeyRegisterVerifyRequest(BaseModel):
    session_token: str
    credential_id: str       # base64url-encoded credential id
    attestation_object: str  # base64url-encoded CBOR attestation object
    client_data_json: str    # base64url-encoded client data JSON


class PasskeyAuthChallengeResponse(BaseModel):
    challenge: str
    session_token: str
    rp_id: str


class PasskeySummaryResponse(BaseModel):
    id: int
    credential_id_suffix: str
    created_at: Optional[str] = None
    sign_count: int


class PasskeyAuthVerifyRequest(BaseModel):
    session_token: str
    credential_id: str
    authenticator_data: str  # base64url
    client_data_json: str    # base64url
    signature: str           # base64url
    user_handle: Optional[str] = None  # base64url, optional


@router.post("/passkey/register/challenge")
async def passkey_register_challenge(
    req: PasskeyRegisterChallengeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    """Generate a WebAuthn registration challenge for the signed-in user."""
    if req.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot register a passkey for another account")
    user = db.query(User).filter(User.id == req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    _clean_challenges()
    challenge_bytes = _secrets.token_bytes(32)
    session_token = _secrets.token_hex(32)
    challenge_b64 = _b64url(challenge_bytes)

    _passkey_challenges[session_token] = (challenge_b64, req.user_id, _time.time() + _CHALLENGE_TTL)

    return {
        "challenge": challenge_b64,
        "session_token": session_token,
        "rp_id": settings.WEBAUTHN_RP_ID,
        "rp_name": "QuantTrade AI",
        "user_id": _b64url(str(req.user_id).encode()),
        "user_name": user.email,
        "user_display_name": user.full_name or user.username,
    }


@router.post("/passkey/register/verify")
async def passkey_register_verify(
    req: PasskeyRegisterVerifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    """Verify WebAuthn attestation and persist the passkey credential."""
    if not WEBAUTHN_AVAILABLE:
        raise HTTPException(status_code=503, detail="WebAuthn library not installed. Run: pip install webauthn")

    entry = _passkey_challenges.get(req.session_token)
    if not entry or _time.time() > entry[2]:
        raise HTTPException(status_code=400, detail="Challenge expired or invalid — please try again")

    challenge_b64, user_id, _ = entry
    del _passkey_challenges[req.session_token]

    if not user_id:
        raise HTTPException(status_code=400, detail="No user_id associated with this challenge")

    if user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Challenge does not match the signed-in user")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        from webauthn import verify_registration_response
        from webauthn.helpers.structs import (
            RegistrationCredential,
            AuthenticatorAttestationResponse,
        )

        credential = RegistrationCredential(
            id=req.credential_id,
            raw_id=_b64url_decode(req.credential_id),
            response=AuthenticatorAttestationResponse(
                client_data_json=_b64url_decode(req.client_data_json),
                attestation_object=_b64url_decode(req.attestation_object),
            ),
            type="public-key",
        )

        verification = verify_registration_response(
            credential=credential,
            expected_challenge=_b64url_decode(challenge_b64),
            expected_rp_id=settings.WEBAUTHN_RP_ID,
            expected_origin=_webauthn_expected_origins(),
            require_user_verification=True,
        )

        # Remove any existing passkeys for this credential_id (re-registration)
        db.query(PasskeyCredential).filter(
            PasskeyCredential.credential_id == req.credential_id
        ).delete()

        passkey = PasskeyCredential(
            user_id=user_id,
            credential_id=req.credential_id,
            public_key=verification.credential_public_key,
            sign_count=verification.sign_count,
        )
        db.add(passkey)
        db.commit()

        return {"success": True, "message": "Passkey registered successfully"}

    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(exc)}")


@router.get("/passkey/status")
async def passkey_status():
    """Return the current WebAuthn configuration for debugging."""
    return {
        "webauthn_available": WEBAUTHN_AVAILABLE,
        "rp_id": settings.WEBAUTHN_RP_ID,
        "expected_origins": _webauthn_expected_origins(),
        "hint": (
            "rp_id must match your browser's hostname exactly (e.g. localhost or quanttrade.us). "
            "expected_origins must match the full origin including protocol and port "
            "(e.g. http://localhost:3000 or https://quanttrade.us)."
        ),
    }


@router.get("/passkey/list")
async def passkey_list(
    current_user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """List passkeys registered for the signed-in user."""
    rows = (
        db.query(PasskeyCredential)
        .filter(PasskeyCredential.user_id == current_user.id)
        .order_by(PasskeyCredential.created_at.desc())
        .all()
    )
    items = [
        PasskeySummaryResponse(
            id=row.id,
            credential_id_suffix=(row.credential_id[-10:] if row.credential_id else ""),
            created_at=row.created_at.isoformat() if row.created_at else None,
            sign_count=row.sign_count or 0,
        ).model_dump()
        for row in rows
    ]
    return {"count": len(items), "items": items}


@router.post("/passkey/auth/challenge")
async def passkey_auth_challenge():
    """Generate a WebAuthn authentication challenge (no user required — discoverable credentials)."""
    _clean_challenges()
    challenge_bytes = _secrets.token_bytes(32)
    session_token = _secrets.token_hex(32)
    challenge_b64 = _b64url(challenge_bytes)

    _passkey_challenges[session_token] = (challenge_b64, None, _time.time() + _CHALLENGE_TTL)

    return {
        "challenge": challenge_b64,
        "session_token": session_token,
        "rp_id": settings.WEBAUTHN_RP_ID,
    }


@router.post("/passkey/auth/verify", response_model=TokenResponse)
async def passkey_auth_verify(req: PasskeyAuthVerifyRequest, db: Session = Depends(get_db)):
    """Verify WebAuthn assertion and return a JWT if valid."""
    if not WEBAUTHN_AVAILABLE:
        raise HTTPException(status_code=503, detail="WebAuthn library not installed. Run: pip install webauthn")

    entry = _passkey_challenges.get(req.session_token)
    if not entry or _time.time() > entry[2]:
        raise HTTPException(status_code=400, detail="Challenge expired or invalid — please try again")

    challenge_b64, _, _ = entry
    del _passkey_challenges[req.session_token]

    passkey = db.query(PasskeyCredential).filter(
        PasskeyCredential.credential_id == req.credential_id
    ).first()
    if not passkey:
        raise HTTPException(status_code=401, detail="Passkey not registered on this account")

    try:
        from webauthn import verify_authentication_response
        from webauthn.helpers.structs import (
            AuthenticationCredential,
            AuthenticatorAssertionResponse,
        )

        credential = AuthenticationCredential(
            id=req.credential_id,
            raw_id=_b64url_decode(req.credential_id),
            response=AuthenticatorAssertionResponse(
                client_data_json=_b64url_decode(req.client_data_json),
                authenticator_data=_b64url_decode(req.authenticator_data),
                signature=_b64url_decode(req.signature),
                user_handle=_b64url_decode(req.user_handle) if req.user_handle else None,
            ),
            type="public-key",
        )

        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=_b64url_decode(challenge_b64),
            expected_rp_id=settings.WEBAUTHN_RP_ID,
            expected_origin=_webauthn_expected_origins(),
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )

        passkey.sign_count = verification.new_sign_count

        user = db.query(User).filter(User.id == passkey.user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        user.last_login = datetime.utcnow()
        db.commit()

        token = create_access_token(user.id)
        return TokenResponse(access_token=token, user=user_to_dict(user))

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(exc)}")


# ─── Forgot / Reset Password ──────────────────────────────────────────────────
import secrets as _pw_secrets
import time as _pw_time

# In-memory store: token → (email, expiry). Redis-backed in production via OTP module.
_reset_tokens: dict = {}
_RESET_TOKEN_TTL = 3600  # 1 hour


def _clean_reset_tokens() -> None:
    now = _pw_time.time()
    expired = [k for k, (_, exp) in _reset_tokens.items() if now > exp]
    for k in expired:
        del _reset_tokens[k]


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    Send a password-reset link to the registered email address.
    Always returns 200 to prevent email enumeration (OWASP A07).
    """
    _clean_reset_tokens()
    user = db.query(User).filter(User.email == req.email.lower()).first()
    if user:
        token = _pw_secrets.token_urlsafe(32)
        _reset_tokens[token] = (user.email, _pw_time.time() + _RESET_TOKEN_TTL)

        app_url = getattr(settings, "APP_URL", "https://quanttrade.us")
        reset_link = f"{app_url}/auth/forgot-password?token={token}"

        html = f"""
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#060B12;padding:40px 20px;">
          <div style="background:#0D1828;border:1px solid rgba(0,212,255,0.2);border-radius:16px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#060B12,#0a1628);padding:28px 32px;border-bottom:1px solid rgba(0,212,255,0.15);">
              <span style="color:#00D4FF;font-size:18px;font-weight:700;">⚡ QuantTrade AI</span>
              <h1 style="margin:12px 0 0;color:#F0F6FF;font-size:20px;font-weight:600;">Password Reset Request</h1>
            </div>
            <div style="padding:32px;">
              <p style="color:#94A3B8;font-size:15px;margin:0 0 24px;">
                We received a request to reset the password for your account (<strong style="color:#E2E8F0">{user.email}</strong>).
                Click the button below to set a new password.
              </p>
              <a href="{reset_link}"
                 style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#06b6d4);color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:700;margin-bottom:24px;">
                Reset My Password →
              </a>
              <p style="color:#64748B;font-size:13px;margin:0 0 8px;">
                This link expires in <strong style="color:#94A3B8">1 hour</strong>.
                If you didn't request a reset, you can safely ignore this email — your password won't change.
              </p>
            </div>
          </div>
        </div>
        """

        try:
            from app.services.email_service import send_email
            await send_email(user.email, "QuantTrade AI — Reset Your Password", html)
        except Exception:
            pass  # Never block — anti-enumeration

    return {"message": "If that email is registered, you'll receive a reset link shortly."}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Validate the reset token and update the user's password."""
    _clean_reset_tokens()
    entry = _reset_tokens.get(req.token)
    if not entry or _pw_time.time() > entry[1]:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired. Please request a new one.")

    email, _ = entry
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=400, detail="Account not found.")

    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    user.hashed_password = hash_password(req.new_password)
    db.commit()

    # Invalidate the token after use
    del _reset_tokens[req.token]

    return {"message": "Password updated successfully. You can now sign in with your new password."}


# ── Email diagnostics (dev/admin) ─────────────────────────────────────────────

class TestEmailRequest(BaseModel):
    to: str
    subject: str = "QuantTrade AI — Test Email"


@router.post("/test-email")
async def test_email(req: TestEmailRequest):
    """
    Diagnostic endpoint: send a test email via Brevo and return detailed result.
    Remove or gate behind admin check in production.
    """
    from app.services.email_service import send_email_sync
    from app.config import settings as _cfg
    import os

    brevo_key_set = bool(getattr(_cfg, "BREVO_API_KEY", None))
    from_email = getattr(_cfg, "BREVO_FROM_EMAIL", "NOT SET")

    html = """
    <div style="font-family:sans-serif;padding:24px;background:#060B12;color:#e2e8f0;">
      <h2 style="color:#00D4FF;">✅ QuantTrade AI — Brevo Test</h2>
      <p>If you're reading this, Brevo is configured correctly.</p>
    </div>
    """
    ok, detail = send_email_sync(req.to, req.subject, html)
    return {
        "success": ok,
        "error": detail if not ok else None,
        "brevo_key_set": brevo_key_set,
        "from_email": from_email,
        "hint": (
            "Email sent successfully." if ok
            else "Check that BREVO_FROM_EMAIL sender is verified in Brevo dashboard → Senders & IPs."
        ),
    }
