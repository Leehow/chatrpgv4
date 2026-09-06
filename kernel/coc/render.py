"""Mechanics blocks and their placement in the keeper's narration (contract §5 narrate)."""

from __future__ import annotations

import re
from typing import Any

DICE_MARKER = "【明骰】"
CHANGE_MARKER = "【变化】"
FORBIDDEN_MARKERS = (DICE_MARKER, CHANGE_MARKER)

DIFFICULTY_ZH = {"regular": "普通", "hard": "困难", "extreme": "极难"}
#: Session transitions (contract §11.6): the family's zh name and its start / end verbs.
SESSION_ZH = {"combat": ("战斗开始", "战斗结束"), "chase": ("追逐开始", "追逐结束"), "sanity_bout": ("理智发作", "发作结束")}

_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n")


def has_self_written_mechanics(text: str) -> bool:
    return any(marker in text for marker in FORBIDDEN_MARKERS)


def mechanics_line(receipt: dict[str, Any]) -> str | None:
    kind = receipt.get("kind")
    if kind == "roll":
        # A keeper-concealed roll (an NPC's, a Psychology observation) never reaches the
        # player's text; the receipt still exists for the record.
        if receipt.get("visibility") == "keeper":
            return None
        skill = receipt.get("skill_label") or receipt["skill"]
        if receipt.get("form") == "dice":
            faces = "+".join(str(f) for f in receipt.get("faces") or [])
            return f"{DICE_MARKER}{skill}｜{receipt.get('expression')}：{faces} = {receipt.get('total')}"
        difficulty = DIFFICULTY_ZH.get(str(receipt.get("difficulty")), str(receipt.get("difficulty")))
        verdict = "通过" if receipt.get("passed") else "未通过"
        who = f"{receipt['actor_label']}·" if receipt.get("actor_label") else ""
        pushed = "（推骰）" if receipt.get("pushed") else ""
        return (f"{DICE_MARKER}{who}{skill}{pushed}｜掷骰：{receipt['roll']}；"
                f"基础值：{receipt['target']}；门槛：{difficulty}（≤{receipt['threshold']}）；"
                f"结果：{verdict}")
    if kind == "delta":
        subject = receipt.get("subject_label") or receipt.get("subject")
        return f"{CHANGE_MARKER}{receipt.get('label') or receipt['resource']}：{subject} {receipt['before']} → {receipt['after']}"
    if kind == "move":
        minutes = int(receipt.get("minutes") or 0)
        line = (f"{CHANGE_MARKER}场景：{receipt.get('from_label') or receipt['from']} → "
                f"{receipt.get('to_label') or receipt['to']}")
        return f"{line}（{minutes} 分钟）" if minutes > 0 else line
    if kind == "clue":
        return f"{CHANGE_MARKER}线索：{receipt.get('label') or receipt['clue']}"
    if kind == "time":
        return f"{CHANGE_MARKER}时间：+{int(receipt['minutes'])} 分钟"
    if kind == "session":
        start, end = SESSION_ZH.get(str(receipt.get("family")), (str(receipt.get("family")), str(receipt.get("family"))))
        if receipt.get("transition") == "start":
            summary = receipt.get("summary")
            return f"{CHANGE_MARKER}{start}：{summary}" if summary and receipt.get("family") == "sanity_bout" else f"{CHANGE_MARKER}{start}"
        outcome = receipt.get("summary") or receipt.get("outcome")
        return f"{CHANGE_MARKER}{end}：{outcome}" if outcome else f"{CHANGE_MARKER}{end}"
    return None


def mechanics_block(receipts: list[dict[str, Any]]) -> str:
    """One line per receipt; when a combat session's dice span several rounds within the
    turn, a 【第 n 轮】 line precedes each round's dice."""
    rounds = {r.get("round") for r in receipts if r.get("kind") == "roll" and r.get("session_kind") == "combat"
              and isinstance(r.get("round"), int)}
    label_rounds = len(rounds) > 1
    lines: list[str] = []
    current_round: int | None = None
    for receipt in receipts:
        line = mechanics_line(receipt)
        if not line:
            continue
        if label_rounds and receipt.get("kind") == "roll" and receipt.get("session_kind") == "combat":
            round_no = receipt.get("round")
            if isinstance(round_no, int) and round_no != current_round:
                lines.append(f"【第 {round_no} 轮】")
                current_round = round_no
        lines.append(line)
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
