"""Mechanics blocks and their placement in the keeper's narration (contract §5 narrate)."""

from __future__ import annotations

import re
from typing import Any

DICE_MARKER = "【明骰】"
CHANGE_MARKER = "【变化】"
FORBIDDEN_MARKERS = (DICE_MARKER, CHANGE_MARKER)

DIFFICULTY_ZH = {"regular": "普通", "hard": "困难", "extreme": "极难"}

_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n")


def has_self_written_mechanics(text: str) -> bool:
    return any(marker in text for marker in FORBIDDEN_MARKERS)


def mechanics_line(receipt: dict[str, Any]) -> str | None:
    kind = receipt.get("kind")
    if kind == "roll":
        difficulty = DIFFICULTY_ZH.get(str(receipt.get("difficulty")), str(receipt.get("difficulty")))
        verdict = "通过" if receipt.get("passed") else "未通过"
        return (f"{DICE_MARKER}{receipt['skill']}｜掷骰：{receipt['roll']}；"
                f"基础值：{receipt['target']}；门槛：{difficulty}（≤{receipt['threshold']}）；"
                f"结果：{verdict}")
    if kind == "move":
        return (f"{CHANGE_MARKER}场景：{receipt['from']} → {receipt['to']}"
                f"（{int(receipt.get('minutes') or 0)} 分钟）")
    if kind == "clue":
        return f"{CHANGE_MARKER}线索：{receipt['clue']}"
    if kind == "time":
        return f"{CHANGE_MARKER}时间：+{int(receipt['minutes'])} 分钟"
    return None


def mechanics_block(receipts: list[dict[str, Any]]) -> str:
    lines = [line for line in (mechanics_line(r) for r in receipts) if line]
    return "\n".join(lines)


def place(text: str, block: str, placement: str) -> str:
    text = text.strip("\n")
    if not block:
        return text
    if placement == "auto":
        paragraphs = _PARAGRAPH_BREAK.split(text)
        if len(paragraphs) >= 2:
            return "\n\n".join([paragraphs[0], block, *paragraphs[1:]])
    return f"{text}\n\n{block}"


def render_choice(prompt: str, options: list[str]) -> str:
    numbered = [f"{i}. {option}" for i, option in enumerate(options, start=1)]
    return "\n".join([prompt.strip(), *numbered])
