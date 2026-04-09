"""
PasskeyCredential model — stores WebAuthn/FIDO2 credential data per user
"""
from sqlalchemy import Column, Integer, String, LargeBinary, DateTime, ForeignKey
from datetime import datetime
from app.db.database import Base


class PasskeyCredential(Base):
    __tablename__ = "passkey_credentials"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    credential_id = Column(String(512), unique=True, nullable=False, index=True)
    public_key = Column(LargeBinary, nullable=False)
    sign_count = Column(Integer, default=0, nullable=False)
    device_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<PasskeyCredential user_id={self.user_id} cred={self.credential_id[:16]}…>"
