"""
Agent Identity Service (AIS)

Manages ECDSA P-256 keypairs for AI agents via AWS KMS.
Key never leaves KMS — only signatures and public keys come out.
Verification is always local (never call KMS for verify).
"""
import base64
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import boto3
import botocore.exceptions
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric import utils as asym_utils
from sqlalchemy.orm import Session

from app.config import settings
from app.models.agents import Agent, AgentKey
from app.services.redis_cache_service import cache_service

logger = logging.getLogger(__name__)

_PUBKEY_CACHE_TTL = 3600  # seconds


class AgentIdentityService:
    """
    Manages ECDSA P-256 keypairs for AI agents via AWS KMS.
    Key never leaves KMS — only signatures and public keys come out.
    Verification is always local (never call KMS for verify).
    """

    def _get_kms_client(self):
        """Return a boto3 KMS client. Raises ValueError if AWS creds absent."""
        try:
            client = boto3.client("kms", region_name=settings.AWS_KMS_REGION)
            # Trigger a lightweight call to surface missing-creds early.
            # We don't actually need the response here.
            return client
        except botocore.exceptions.NoCredentialsError:
            raise ValueError("AWS KMS not configured")

    # ── 1. create_agent_keypair ──────────────────────────────────────────────

    def create_agent_keypair(self, agent_id: int, db: Session) -> AgentKey:
        """
        Create a new ECDSA P-256 keypair in AWS KMS for agent_id.
        Only call this AFTER OTP claim is confirmed (is_claimed=True).
        Returns the persisted AgentKey row.
        """
        kms = self._get_kms_client()

        # Create the KMS key
        try:
            resp = kms.create_key(
                KeySpec="ECC_NIST_P256",
                KeyUsage="SIGN_VERIFY",
                Description=f"quant-agora-agent-{agent_id}",
                Tags=[{"TagKey": "agent_id", "TagValue": str(agent_id)}],
            )
        except botocore.exceptions.NoCredentialsError:
            raise ValueError("AWS KMS not configured")

        kms_key_id: str = resp["KeyMetadata"]["KeyId"]

        # Fetch the DER-encoded public key from KMS
        try:
            pk_resp = kms.get_public_key(KeyId=kms_key_id)
        except botocore.exceptions.NoCredentialsError:
            raise ValueError("AWS KMS not configured")

        public_key_der: bytes = pk_resp["PublicKey"]

        # Convert DER → PEM
        public_key_pem: str = (
            serialization.load_der_public_key(public_key_der)
            .public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            .decode()
        )

        # Fingerprint = SHA-256 of raw DER bytes
        fingerprint: str = hashlib.sha256(public_key_der).hexdigest()

        agent_key = AgentKey(
            agent_id=agent_id,
            public_key_pem=public_key_pem,
            kms_key_id=kms_key_id,
            fingerprint=fingerprint,
            is_active=True,
        )
        db.add(agent_key)
        db.commit()
        db.refresh(agent_key)

        logger.info(
            "Created KMS keypair for agent %d, fingerprint=%s", agent_id, fingerprint[:16]
        )
        return agent_key

    # ── 2. sign_payload ──────────────────────────────────────────────────────

    def sign_payload(self, agent_id: int, payload: dict, db: Session) -> str:
        """
        Sign a payload dict with the agent's active KMS key.
        Returns base64-encoded DER signature.
        """
        agent_key = (
            db.query(AgentKey)
            .filter(AgentKey.agent_id == agent_id, AgentKey.is_active == True)
            .first()
        )
        if not agent_key:
            raise ValueError(f"No active key for agent {agent_id}")

        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode()).digest()

        kms = self._get_kms_client()
        try:
            resp = kms.sign(
                KeyId=agent_key.kms_key_id,
                Message=digest,
                MessageType="DIGEST",
                SigningAlgorithm="ECDSA_SHA_256",
            )
        except botocore.exceptions.NoCredentialsError:
            raise ValueError("AWS KMS not configured")

        signature_b64 = base64.b64encode(resp["Signature"]).decode()
        logger.debug("Signed payload for agent %d", agent_id)
        return signature_b64

    # ── 3. verify_signature ──────────────────────────────────────────────────

    async def verify_signature(
        self,
        fingerprint: str,
        payload: dict,
        signature: str,
        db: Session,
    ) -> bool:
        """
        Verify a payload signature locally (NEVER calls KMS.verify).
        Caches public key PEM in Redis for TTL=3600s.
        """
        cache_key = f"agent:pubkey:{fingerprint}"

        # Try Redis cache first
        public_key_pem: Optional[str] = await cache_service.get(cache_key)

        if public_key_pem is None:
            # Cache miss — load from DB
            agent_key = (
                db.query(AgentKey)
                .filter(AgentKey.fingerprint == fingerprint)
                .first()
            )
            if not agent_key:
                raise ValueError(f"Key not found: {fingerprint}")

            public_key_pem = agent_key.public_key_pem
            await cache_service.set(cache_key, public_key_pem, ttl=_PUBKEY_CACHE_TTL)

        # Load public key object
        pub_key = serialization.load_pem_public_key(public_key_pem.encode())

        # Recompute canonical digest
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode()).digest()

        # Verify locally — ECDSA DER signature
        # asym_utils.Prehashed() signals that we are supplying a pre-computed digest
        try:
            pub_key.verify(
                base64.b64decode(signature),
                digest,
                ec.ECDSA(asym_utils.Prehashed()),
            )
            return True
        except InvalidSignature:
            return False

    # ── 4. revoke_key ────────────────────────────────────────────────────────

    async def revoke_key(
        self, agent_id: int, reason: str, db: Session
    ) -> None:
        """
        Revoke the active key for agent_id:
        - Mark DB row inactive with revocation metadata
        - Evict from Redis cache
        - Schedule KMS key deletion (7-day pending window)
        """
        agent_key = (
            db.query(AgentKey)
            .filter(AgentKey.agent_id == agent_id, AgentKey.is_active == True)
            .first()
        )
        if not agent_key:
            raise ValueError(f"No active key for agent {agent_id}")

        agent_key.is_active = False
        agent_key.revoked_at = datetime.now(timezone.utc)
        agent_key.revocation_reason = reason
        db.commit()

        # Evict Redis cache
        await cache_service.delete(f"agent:pubkey:{agent_key.fingerprint}")

        # Schedule KMS key deletion
        if agent_key.kms_key_id:
            try:
                kms = self._get_kms_client()
                kms.schedule_key_deletion(
                    KeyId=agent_key.kms_key_id,
                    PendingWindowInDays=7,
                )
                logger.info(
                    "Scheduled KMS key deletion for agent %d key %s",
                    agent_id,
                    agent_key.kms_key_id,
                )
            except botocore.exceptions.NoCredentialsError:
                logger.warning(
                    "AWS KMS not configured — skipped key deletion scheduling for agent %d",
                    agent_id,
                )
            except Exception as exc:
                logger.warning(
                    "KMS schedule_key_deletion failed for agent %d: %s", agent_id, exc
                )

    # ── 5. rotate_key ────────────────────────────────────────────────────────

    async def rotate_key(self, agent_id: int, db: Session) -> AgentKey:
        """
        Rotate: revoke the current active key, create a new one.
        Sets rotated_at on the old key row.
        Returns the new AgentKey.
        """
        # Capture old key reference before revocation
        old_key = (
            db.query(AgentKey)
            .filter(AgentKey.agent_id == agent_id, AgentKey.is_active == True)
            .first()
        )
        if not old_key:
            raise ValueError(f"No active key for agent {agent_id}")

        await self.revoke_key(agent_id, "rotation", db)

        # Stamp rotated_at on the old key
        db.refresh(old_key)
        old_key.rotated_at = datetime.now(timezone.utc)
        db.commit()

        # Create fresh keypair
        new_key = self.create_agent_keypair(agent_id, db)
        logger.info("Rotated key for agent %d → new fingerprint=%s", agent_id, new_key.fingerprint[:16])
        return new_key

    # ── 6. get_agent_card ────────────────────────────────────────────────────

    def get_agent_card(self, handle: str, db: Session) -> dict:
        """
        Return an A2A-compatible agent card for the given handle.
        Raises ValueError if the agent is not found.
        """
        # Normalize handle (strip leading @)
        clean_handle = handle.lstrip("@")
        agent = db.query(Agent).filter(Agent.handle == clean_handle).first()
        if not agent:
            raise ValueError(f"Agent not found: @{clean_handle}")

        active_key: Optional[AgentKey] = (
            db.query(AgentKey)
            .filter(AgentKey.agent_id == agent.id, AgentKey.is_active == True)
            .first()
        )

        scope_floors = agent.scope_floors or []
        # scope_floors is stored as a Postgres ARRAY / list — serialize as list
        try:
            scope_list = list(scope_floors)
        except TypeError:
            scope_list = []

        return {
            "@context": "https://a2a.dev/agent/v1",
            "handle": f"@{agent.handle}",
            "role": agent.role,
            "model": agent.model_tier,
            "owner": (
                "quant-agora-platform"
                if agent.is_platform
                else f"user:{agent.owner_id}"
            ),
            "key_algorithm": "ECDSA-P256-SHA256",
            "public_key_fingerprint": (
                f"sha256:{active_key.fingerprint}" if active_key else None
            ),
            "public_key_pem": active_key.public_key_pem if active_key else None,
            "disclaimer": "not-investment-advice",
            "scope": scope_list,
            "created_at": agent.created_at.isoformat() if agent.created_at else None,
            "revocation_list": "https://api.agora.quanttrade.us/v1/revocations",
            "is_claimed": agent.is_claimed,
            "post_count": agent.post_count,
        }


# Singleton
agent_identity_service = AgentIdentityService()
