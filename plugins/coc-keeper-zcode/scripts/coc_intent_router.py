#!/usr/bin/env python3
"""Keyword/rule-based intent parser for player free-text.

Extracts a rich intent structure from what a player types so the Story
Director (and other consumers) receive more than a single intent class.
Pure keyword + regex matching -- no LLM, no NLTK, no ML. Supports 中英文.

The Story Director still accepts the legacy ``player_intent_class`` string
directly (backward compatible); this router is an OPTIONAL enrichment layer
for callers (e.g. keeper-play) that want to surface secondary intents, target
entities, risk posture, explicit roll requests and player hypotheses before
directing.

Public API:
    parse_intent(player_text, active_scene=None) -> dict

All matching is case-insensitive (the text is lowercased once; Chinese is
case-neutral). The function returns a predictable structure even for empty
or garbage input.
"""
from __future__ import annotations

import re
from typing import Any


# ---------------------------------------------------------------------------
# Keyword tables
# ---------------------------------------------------------------------------

# ``meta`` is special-cased (starts-with-``[`` plus its own keyword set).
_META_KEYWORDS: tuple[str, ...] = ("[meta]", "规则", "系统", "rule", "system")

# Concrete action intents -- checked in this order, first match wins.
#
# NOTE on ordering: the written spec places ``stuck`` second (right after
# meta). That cannot pass the test suite because ``stuck`` includes the very
# broad Chinese particle "什么" (a question word that shows up inside normal
# social/investigate sentences such as "我去问问邻居昨晚听到了什么"). We
# therefore treat ``stuck`` as a FALLBACK intent checked AFTER every concrete
# action verb. Stuck still fires whenever no concrete action is present
# ("我不知道该去哪里"). This keeps the full keyword set and matches player
# intuition: an explicit action beats "I don't know".
_ACTION_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("combat",
     ("攻击", "打", "杀", "attack", "fight", "kill", "punch")),
    ("flee",
     ("跑", "逃", "撤退", "离开", "flee", "escape", "retreat", "leave", "run away")),
    ("social",
     ("问", "交谈", "说服", "恐吓", "ask", "talk", "persuade", "intimidate", "charm")),
    ("investigate",
     ("查", "检查", "搜索", "看", "调查",
      "inspect", "search", "examine", "investigate", "look", "check")),
    ("stuck",
     ("不知道", "随便", "什么", "无可", "don't know", "dont know", "unsure", "anything")),
)

# secondary intents -- independent, multiple may fire.
_AVOID_RISK: tuple[str, ...] = (
    "小心", "谨慎", "不进去", "绕", "先不", "安全",
    "careful", "cautious", "sneak", "stealth",
)
_SOCIAL_FOLLOWUP_CN: tuple[str, ...] = ("再问", "然后问", "也问")
_SOCIAL_FOLLOWUP_RE = re.compile(r"(ask .{0,8}also|then .{0,8}ask)", re.IGNORECASE)
_FORCE_ROLL: tuple[str, ...] = ("检定", "骰", "roll", "check dice")

# reckless posture keywords. ``cautious`` takes precedence when avoid_risk is
# already in secondary_intents (a player who voices caution is cautious even
# if they also say "直接").
_RECKLESS: tuple[str, ...] = ("冲", "直接", "不管", "rush", "charge", "regardless")

# explicit roll request -- player actively asks to throw dice.
_EXPLICIT_ROLL: tuple[str, ...] = ("我骰", "检定", "我要投", "roll", "i roll")

# player hypothesis markers. The clause following the first marker is the
# hypothesis string.
_HYPOTHESIS_RE = re.compile(
    r"(我觉得|我猜|可能是|i think|maybe|probably)", re.IGNORECASE
)

# target entities: (keyword, normalized english form). Order matters only for
# output ordering; duplicates are de-duplicated by normalized form.
_TARGET_RULES: tuple[tuple[str, str], ...] = (
    ("门", "door"), ("door", "door"),
    ("窗", "window"), ("window", "window"),
    ("地下室", "basement"), ("basement", "basement"),
    ("邻居", "neighbor"), ("neighbor", "neighbor"),
    ("后院", "backyard"), ("后花园", "backyard"), ("backyard", "backyard"),
    ("档案", "archive"), ("图书馆", "archive"),
    ("archive", "archive"), ("library", "archive"),
    ("尸体", "body"), ("body", "body"),
    ("书", "book"), ("日记", "book"),
    ("book", "book"), ("journal", "book"), ("diary", "book"),
    ("符号", "symbol"), ("symbol", "symbol"), ("mark", "symbol"),
    ("锁", "lock"), ("lock", "lock"),
)


def _any_in(haystack: str, needles: tuple[str, ...]) -> bool:
    """True if any needle is a substring of haystack."""
    return any(n in haystack for n in needles)


def parse_intent(player_text: str | None, active_scene: dict | None = None) -> dict:
    """Parse player text into a structured intent. Pure keyword/regex, no LLM.

    Args:
        player_text: Raw player free-text (中英文 mixed ok). None/empty is
            treated as idle.
        active_scene: Optional scene dict; if provided, its ``available_clues``
            and ``npc_ids`` lists are scanned and any id that appears in the
            text is added verbatim to ``target_entities``.

    Returns:
        {
            "primary_intent": "investigate|social|combat|flee|meta|stuck|idle",
            "secondary_intents": list[str],   # e.g. ["avoid_risk", "social_followup"]
            "target_entities": list[str],     # e.g. ["backyard", "window", "neighbor"]
            "risk_posture": "cautious|neutral|reckless",
            "explicit_roll_request": bool,
            "player_hypothesis": str | None,  # clause after a hypothesis marker
        }
    """
    text = player_text or ""
    low = text.lower()

    # --- primary_intent ---------------------------------------------------
    primary = "idle"
    stripped = low.lstrip()
    if stripped.startswith("[") or _any_in(low, _META_KEYWORDS):
        primary = "meta"
    else:
        for name, keywords in _ACTION_RULES:
            if _any_in(low, keywords):
                primary = name
                break

    # --- secondary_intents ------------------------------------------------
    secondary: list[str] = []
    if _any_in(low, _AVOID_RISK):
        secondary.append("avoid_risk")
    if _any_in(low, _SOCIAL_FOLLOWUP_CN) or _SOCIAL_FOLLOWUP_RE.search(text):
        secondary.append("social_followup")
    if _any_in(low, _FORCE_ROLL):
        secondary.append("force_roll")

    # --- risk_posture -----------------------------------------------------
    if "avoid_risk" in secondary:
        risk_posture = "cautious"
    elif _any_in(low, _RECKLESS):
        risk_posture = "reckless"
    else:
        risk_posture = "neutral"

    # --- explicit_roll_request -------------------------------------------
    explicit_roll = _any_in(low, _EXPLICIT_ROLL)

    # --- target_entities --------------------------------------------------
    targets: list[str] = []
    for keyword, normalized in _TARGET_RULES:
        if keyword in low and normalized not in targets:
            targets.append(normalized)

    if isinstance(active_scene, dict):
        for key in ("available_clues", "npc_ids"):
            for entity_id in active_scene.get(key) or []:
                if not isinstance(entity_id, str):
                    continue
                if entity_id.lower() in low and entity_id not in targets:
                    targets.append(entity_id)

    # --- player_hypothesis ------------------------------------------------
    hypothesis: str | None = None
    match = _HYPOTHESIS_RE.search(text)
    if match:
        clause = text[match.end():].strip()
        hypothesis = clause or None

    return {
        "primary_intent": primary,
        "secondary_intents": secondary,
        "target_entities": targets,
        "risk_posture": risk_posture,
        "explicit_roll_request": explicit_roll,
        "player_hypothesis": hypothesis,
    }
