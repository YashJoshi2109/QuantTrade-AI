"""
File upload endpoints for community media.

Supports Cloudflare R2 (primary) with local filesystem fallback.
R2 is S3-compatible, so we use boto3 with a custom endpoint.
"""
import uuid
import os
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from app.api.auth import require_auth
from app.models.user import User
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_SIZE_BYTES = 5 * 1024 * 1024  # 5MB

# Lazy-loaded S3/R2 client (reused across requests)
_s3_client = None


def _get_s3_client():
    """Get or create a reusable boto3 S3 client for R2."""
    global _s3_client
    if _s3_client is not None:
        return _s3_client
    if not settings.S3_ENDPOINT or not settings.S3_ACCESS_KEY:
        return None
    try:
        import boto3
        _s3_client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name="auto",
        )
        logger.info("R2/S3 client initialized for uploads")
        return _s3_client
    except Exception as e:
        logger.warning(f"Failed to init S3 client: {e}")
        return None


def _r2_available() -> bool:
    """Check if R2 is configured and usable."""
    return bool(settings.S3_ENDPOINT and settings.S3_ACCESS_KEY and settings.S3_SECRET_KEY)


@router.post("/uploads/image")
async def upload_image(
    file: UploadFile = File(...),
    user: User = Depends(require_auth),
):
    """Upload an image for use in posts. Max 5MB, JPEG/PNG/WebP/GIF."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{file.content_type}' not allowed. Use JPEG, PNG, WebP, or GIF.",
        )

    contents = await file.read()
    if len(contents) > MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large ({len(contents) // 1024}KB). Maximum is 5MB.",
        )

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
        ext = "jpg"

    filename = f"{uuid.uuid4().hex}.{ext}"
    object_key = f"community/uploads/{user.id}/{filename}"

    # Try R2 first, then local fallback
    try:
        if _r2_available():
            url = await _upload_to_r2(object_key, contents, file.content_type)
        else:
            url = _upload_to_local(object_key, contents, user.id, filename)
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload file. Please try again.",
        )

    return {
        "url": url,
        "filename": file.filename,
        "size": len(contents),
        "content_type": file.content_type,
    }


async def _upload_to_r2(object_key: str, contents: bytes, content_type: str) -> str:
    """Upload to Cloudflare R2 and return public URL."""
    import asyncio

    def _put():
        client = _get_s3_client()
        if not client:
            raise RuntimeError("R2 client not available")
        client.put_object(
            Bucket=settings.S3_BUCKET,
            Key=object_key,
            Body=contents,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )

    await asyncio.to_thread(_put)

    # Return public URL (R2.dev subdomain or custom domain)
    if settings.S3_PUBLIC_URL:
        return f"{settings.S3_PUBLIC_URL.rstrip('/')}/{object_key}"
    # Fallback: construct from endpoint (not publicly accessible without r2.dev enabled)
    return f"{settings.S3_ENDPOINT}/{settings.S3_BUCKET}/{object_key}"


def _upload_to_local(object_key: str, contents: bytes, user_id: int, filename: str) -> str:
    """Upload to local filesystem as fallback."""
    local_dir = os.path.join(
        settings.LOCAL_STORAGE_PATH, "community", "uploads", str(user_id)
    )
    os.makedirs(local_dir, exist_ok=True)
    local_path = os.path.join(local_dir, filename)
    with open(local_path, "wb") as f:
        f.write(contents)
    return f"/static/uploads/{object_key}"
