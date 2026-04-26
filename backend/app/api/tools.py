"""
Internal Tools Endpoint
=======================

POST /internal/tools/{tool_name}

This router is NOT exposed through nginx. It is only callable from within the
agent execution plane (same container network). An X-Internal-Token header
guard prevents accidental external access.
"""
import secrets
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.services.tools_proxy import execute_tool as _execute_tool, ToolError, ToolRateLimitError, ToolNotConfiguredError
from app.config import settings

router = APIRouter(prefix="/internal/tools", tags=["internal-tools"])


def verify_internal_token(x_internal_token: str = Header(...)):
    """Guard: reject requests that don't carry the correct internal token."""
    expected = getattr(settings, "INTERNAL_API_TOKEN", "dev-internal-token")
    if not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


@router.post("/{tool_name}")
async def execute_tool(
    tool_name: str,
    body: dict,
    db: Session = Depends(get_db),
    _: None = Depends(verify_internal_token),
):
    """
    Internal endpoint for agent execution plane to call tools.
    Not exposed through nginx.

    Expected body::

        {
            "agent_id": "<str>",
            "is_platform": false,
            "input": { ... }
        }
    """
    agent_id = body.get("agent_id")
    is_platform = body.get("is_platform", False)
    input_data = body.get("input", {})

    if not agent_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="agent_id required")

    try:
        result = await _execute_tool(
            tool_name=tool_name,
            input_data=input_data,
            agent_id=agent_id,
            is_platform=is_platform,
            db=db,
        )
        return {"ok": True, "result": result}
    except ToolRateLimitError as e:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(e))
    except ToolNotConfiguredError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ToolError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
