"""
Load / merge user preferences JSON (settings UI + Pro alert internals).
"""
from __future__ import annotations

import json
from copy import deepcopy
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.user import User

DEFAULT_PREFERENCES: Dict[str, Any] = {
    "analyst_personality": "balanced",
    "data_sources": {"sec": True, "social": True, "technical": True},
    "notifications": {
        "volatility": True,
        "earnings": True,
        "updates": False,
        "security": True,
    },
    "pro_alerts": {
        "watchlist_price": True,
        "watchlist_news": True,
    },
    "_price_alert_snapshot": {},
    "_news_alert_sent_ids": [],
}


def _deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    out = deepcopy(base)
    for k, v in patch.items():
        if k.startswith("_"):
            continue
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_preferences(user: User) -> Dict[str, Any]:
    raw = user.preferences_json
    if not raw:
        return deepcopy(DEFAULT_PREFERENCES)
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            return deepcopy(DEFAULT_PREFERENCES)
    except json.JSONDecodeError:
        return deepcopy(DEFAULT_PREFERENCES)
    return _deep_merge(DEFAULT_PREFERENCES, data)


def public_preferences(prefs: Dict[str, Any]) -> Dict[str, Any]:
    """Strip server-only keys for API responses."""
    return {k: v for k, v in prefs.items() if not k.startswith("_")}


def save_preferences(db: Session, user: User, prefs: Dict[str, Any]) -> None:
    user.preferences_json = json.dumps(prefs)
    db.add(user)
    db.commit()
    db.refresh(user)


def merge_patch(db: Session, user: User, patch: Dict[str, Any]) -> Dict[str, Any]:
    current = load_preferences(user)
    merged = _deep_merge(current, patch)
    save_preferences(db, user, merged)
    return merged


def set_internal_key(db: Session, user: User, key: str, value: Any) -> None:
    """Server-only preference keys (alert snapshots, dedupe ids)."""
    if not key.startswith("_"):
        raise ValueError("internal keys must start with _")
    prefs = load_preferences(user)
    prefs[key] = value
    save_preferences(db, user, prefs)
