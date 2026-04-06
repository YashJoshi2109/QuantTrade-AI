"""
Authentication API endpoints
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta
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
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url,
        "is_verified": user.is_verified,
        "country_code": getattr(user, "country_code", None),
        "phone_number": getattr(user, "phone_number", None),
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
    # Validate email first
    validation = await validate_email(req.email)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=validation.message
        )
    if not check_rate_limit(req.email):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Please wait a minute before requesting another code"
        )
    otp = generate_otp()
    if not store_otp(req.email, otp):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OTP service temporarily unavailable"
        )
    sent = await asyncio.to_thread(send_otp_email, req.email, otp)
    set_rate_limit(req.email)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to send verification email. Please check RESEND_API_KEY and domain configuration."
        )
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
    # Validate email format and deliverability
    validation = await validate_email(user_data.email)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=validation.message
        )
    if validation.is_disposable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Disposable email addresses are not allowed"
        )

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


class PasskeyAuthVerifyRequest(BaseModel):
    session_token: str
    credential_id: str
    authenticator_data: str  # base64url
    client_data_json: str    # base64url
    signature: str           # base64url
    user_handle: Optional[str] = None  # base64url, optional


@router.post("/passkey/register/challenge")
async def passkey_register_challenge(req: PasskeyRegisterChallengeRequest, db: Session = Depends(get_db)):
    """Generate a WebAuthn registration challenge for an authenticated user."""
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
async def passkey_register_verify(req: PasskeyRegisterVerifyRequest, db: Session = Depends(get_db)):
    """Verify WebAuthn attestation and persist the passkey credential."""
    if not WEBAUTHN_AVAILABLE:
        raise HTTPException(status_code=503, detail="WebAuthn library not installed. Run: pip install py_webauthn")

    entry = _passkey_challenges.get(req.session_token)
    if not entry or _time.time() > entry[2]:
        raise HTTPException(status_code=400, detail="Challenge expired or invalid — please try again")

    challenge_b64, user_id, _ = entry
    del _passkey_challenges[req.session_token]

    if not user_id:
        raise HTTPException(status_code=400, detail="No user_id associated with this challenge")

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
            expected_origin=settings.WEBAUTHN_ORIGIN,
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
        raise HTTPException(status_code=503, detail="WebAuthn library not installed. Run: pip install py_webauthn")

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
            expected_origin=settings.WEBAUTHN_ORIGIN,
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
