"""
File upload endpoints for community media.
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

    object_name = f"community/uploads/{user.id}/{uuid.uuid4().hex}.{ext}"

    # Try S3/R2 upload, fall back to local storage
    try:
        use_local = getattr(settings, 'USE_LOCAL_STORAGE', True)
        if not use_local and getattr(settings, 'S3_ENDPOINT', None):
            import boto3
            s3 = boto3.client(
                's3',
                endpoint_url=settings.S3_ENDPOINT,
                aws_access_key_id=settings.S3_ACCESS_KEY,
                aws_secret_access_key=settings.S3_SECRET_KEY,
            )
            s3.put_object(
                Bucket=settings.S3_BUCKET,
                Key=object_name,
                Body=contents,
                ContentType=file.content_type,
            )
            url = f"{settings.S3_ENDPOINT}/{settings.S3_BUCKET}/{object_name}"
        else:
            # Local storage fallback
            local_dir = os.path.join(getattr(settings, 'LOCAL_STORAGE_PATH', '/tmp/qt-uploads'), "community/uploads", str(user.id))
            os.makedirs(local_dir, exist_ok=True)
            local_path = os.path.join(local_dir, f"{uuid.uuid4().hex}.{ext}")
            with open(local_path, "wb") as f:
                f.write(contents)
            url = f"/static/uploads/{object_name}"

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
