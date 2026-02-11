"""
Authentication API endpoints
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, status
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
async def login(credentials: UserLogin, db: Session = Depends(get_db)):
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
