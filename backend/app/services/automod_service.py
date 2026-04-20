"""
AutoMod rules engine for community content filtering.

Runs as Stage 0 in the moderation pipeline, before AI analysis.
Rules are stored per-community in Community.settings["automod_rules"].
"""
import re
import logging
from typing import List, Dict, Optional
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class AutoModResult:
    action: str          # "approve", "remove", "review"
    matched_rules: List[str]
    reason: Optional[str] = None


def evaluate_rules(
    content: str,
    title: str,
    author_account_age_days: int,
    author_reputation: int,
    rules: List[Dict],
) -> AutoModResult:
    """
    Evaluate automod rules against content.

    Rule format:
    {
        "type": "keyword" | "regex" | "account_age" | "karma" | "link",
        "value": str | int,
        "action": "remove" | "review",
        "name": str
    }
    """
    matched = []
    combined = f"{title} {content}".lower()

    for rule in rules:
        rule_type = rule.get("type", "")
        value = rule.get("value", "")
        action = rule.get("action", "review")
        name = rule.get("name", "unnamed")

        triggered = False

        if rule_type == "keyword":
            if isinstance(value, str) and value.lower() in combined:
                triggered = True

        elif rule_type == "regex":
            try:
                if isinstance(value, str) and re.search(value, combined, re.IGNORECASE):
                    triggered = True
            except re.error:
                pass

        elif rule_type == "account_age":
            min_days = int(value) if value else 0
            if author_account_age_days < min_days:
                triggered = True

        elif rule_type == "karma":
            min_karma = int(value) if value else 0
            if author_reputation < min_karma:
                triggered = True

        elif rule_type == "link":
            # Check if content contains links matching pattern
            if isinstance(value, str):
                if value.startswith("!"):
                    # Blacklist: block if link matches
                    if re.search(r'https?://[^\s]*' + re.escape(value[1:]), combined):
                        triggered = True
                else:
                    # Whitelist: block if ANY link doesn't match
                    links = re.findall(r'https?://[^\s]+', combined)
                    if links and not any(value in link for link in links):
                        triggered = True

        if triggered:
            matched.append(name)
            if action == "remove":
                return AutoModResult("remove", matched, f"AutoMod: {name}")

    if matched:
        return AutoModResult("review", matched, f"AutoMod flagged: {', '.join(matched)}")

    return AutoModResult("approve", [], None)


# Default rules for new communities
DEFAULT_RULES = [
    {"type": "keyword", "value": "guaranteed returns", "action": "remove", "name": "Guaranteed returns claim"},
    {"type": "keyword", "value": "not financial advice but you should definitely", "action": "review", "name": "Disguised advice"},
    {"type": "account_age", "value": 1, "action": "review", "name": "New account (<1 day)"},
    {"type": "regex", "value": r"(buy|sell)\s+now\s+before\s+it", "action": "review", "name": "FOMO pressure"},
]
