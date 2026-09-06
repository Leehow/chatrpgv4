"""Deterministic sentences over receipts and world state (contract §12.2, §12.3, §12.5).

Everything here is a template filled from a receipt or a graph record. Nothing reads
prose to decide anything: the facts list is what the receipts say, in play_language,
and the keeper-only list is what the graph marks as undiscovered or secret."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from .module_graph import ModuleGraph, record_of
from .render import CHANGE_MARKER, DICE_MARKER, SESSION_ZH

KEEPER_ONLY_BUDGET = 2048
HEAD_CHARS = 60
DEFAULT_LANGUAGE = "zh-Hans"

_ROUND_LINE = re.compile(r"^【第 \d+ 轮】$")
#: Success levels are a closed rule enum (contract §5 resolve); the zh words for them.
LEVEL_ZH = {"critical": "大成功", "extreme": "极难成功", "hard": "困难成功", "regular": "普通成功",
            "failure": "失败", "fumble": "大失败"}

#: Fixed strings per play_language. A language the table does not know falls back to its
#: primary subtag, then to zh-Hans (the mechanics lines are zh already).
TEMPLATES: dict[str, dict[str, str]] = {
    "zh-Hans": {
        "roll": "{actor}的{skill}检定{verdict}（{level}）",
        "roll_hidden": "{actor}的{skill}检定{verdict}（{level}；暗骰）",
        "dice": "{actor}掷{skill} {expression}：{total}",
        "move": "场景：{from_} → {to}",
        "move_minutes": "场景：{from_} → {to}（{minutes} 分钟）",
        "clue": "发现线索：{clue}",
        "delta": "{label}：{subject} {before} → {after}",
        "time": "时间推进 {minutes} 分钟",
        "item_gain": "物品：{subject} 得到 {name}{count}",
        "item_loss": "物品：{subject} 失去 {name}{count}",
        "choice": "玩家选择：{option}",
        "declared": "玩家声明：{text}",
        "session_start": "{start}",
        "session_end": "{end}：{outcome}",
        "session_end_plain": "{end}",
        "session_round": "{family}进入第 {round} 轮",
        "place": "地点：{scene}",
        "present": "在场：{names}",
        "present_none": "在场：无人",
        "passed": "通过",
        "failed": "未通过",
        "undiscovered_clue": "未发现线索：{name}——{summary}",
        "npc_secret": "{name}的秘密——agenda：{agenda}；secret：{secret}",
        "module_secret": "模组秘密：{name}——{summary}",
        "one_line": "第 {turn} 回合：{scene}，{clock}，{session}；上回合：{head}",
        "clock": "时钟 {minutes} 分钟",
        "no_session": "无会话",
        "session_label": "{family}进行中（第 {round} 轮）",
        "no_head": "（无交付）",
        "instruction": (
            "只写这一回合新出现的事实、知晓、信念、关系、玩家断言；主语用 known_entities 里的名字，"
            "或保留主语 world、party、keeper、player；不写数值与骰面；不复述 prior 已有的。"
            "每条给 kind（world_event、knowledge、belief、relationship、player_assertion、"
            "player_preference、keeper_correction、promise 之一）、subject、statement；world_event 的 subject 必须是 world；"
            "relationship 的 entities 恰好一个名字。"
            "有人答应了有期限或有条件的事时写一条 promise：subject 是许诺者，entities 列受诺者与相关实体，statement 写清条件或期限。"
            "不要写 id、回合号、收据或任何机器键。"
        ),
    },
    "en": {
        "roll": "{actor}'s {skill} check {verdict} ({level})",
        "roll_hidden": "{actor}'s {skill} check {verdict} ({level}; hidden)",
        "dice": "{actor} rolls {skill} {expression}: {total}",
        "move": "Scene: {from_} → {to}",
        "move_minutes": "Scene: {from_} → {to} ({minutes} min)",
        "clue": "Clue found: {clue}",
        "delta": "{label}: {subject} {before} → {after}",
        "time": "Time advances {minutes} min",
        "item_gain": "Item: {subject} gains {name}{count}",
        "item_loss": "Item: {subject} loses {name}{count}",
        "choice": "Player chose: {option}",
        "declared": "Player declared: {text}",
        "session_start": "{start}",
        "session_end": "{end}: {outcome}",
        "session_end_plain": "{end}",
        "session_round": "{family} enters round {round}",
        "place": "Location: {scene}",
        "present": "Present: {names}",
        "present_none": "Present: nobody",
        "passed": "passed",
        "failed": "failed",
        "undiscovered_clue": "Undiscovered clue: {name} — {summary}",
        "npc_secret": "{name}'s secret — agenda: {agenda}; secret: {secret}",
        "module_secret": "Module secret: {name} — {summary}",
        "one_line": "Turn {turn}: {scene}, {clock}, {session}; last turn: {head}",
        "clock": "clock {minutes} min",
        "no_session": "no session",
        "session_label": "{family} in progress (round {round})",
        "no_head": "(no delivery)",
        "instruction": (
            "Write only what is new this turn: facts, knowledge, beliefs, relationships, player assertions. "
            "Use names from known_entities as subjects, or the reserved subjects world, party, keeper, player; "
            "no numbers or dice; do not repeat what prior already holds. Each candidate has kind (one of world_event, "
            "knowledge, belief, relationship, player_assertion, player_preference, keeper_correction, promise), subject and "
            "statement; a world_event's subject must be world; a relationship names exactly one entity in entities. "
            "When someone promised something with a deadline or a condition, write a promise: subject is the one who "
            "promised, entities the one promised to and what it concerns, statement the condition or deadline. "
            "Never write ids, turn numbers, receipts or any machine key."
        ),
    },
}


def language_of(meta: dict[str, Any] | None) -> str:
    language = str((meta or {}).get("play_language") or DEFAULT_LANGUAGE)
    if language in TEMPLATES:
        return language
    primary = language.split("-", 1)[0].lower()
    for known in TEMPLATES:
        if known.split("-", 1)[0].lower() == primary:
            return known
    return DEFAULT_LANGUAGE


def t(language: str, key: str, **fields: Any) -> str:
    return TEMPLATES[language][key].format(**fields)


def prose_of(rendered_text: str | None) -> str:
    """The delivery minus the mechanics lines the kernel inserted (【明骰】【变化】【第 n 轮】)."""
    if not rendered_text:
        return ""
    kept = [line for line in rendered_text.splitlines()
            if not line.startswith((DICE_MARKER, CHANGE_MARKER)) and not _ROUND_LINE.match(line.strip())]
    text = "\n".join(kept)
    return re.sub(r"\n{3,}", "\n\n", text).strip("\n")


def head_of(rendered_text: str | None, chars: int = HEAD_CHARS) -> str:
    return " ".join(prose_of(rendered_text).split())[:chars]


def json_size(payload: Any) -> int:
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


# ---- committed ----------------------------------------------------------------------------

def committed_facts(language: str, receipts: list[dict[str, Any]], snapshot: dict[str, Any],
                    label_of: Callable[[str], str], player_text: str | None = None) -> list[str]:
    """The player's declaration first (the verifier must know what the player actually said
    before judging agency), then one sentence per receipt, then the place and who is
    present. `snapshot` is the turn record's `world` block; `label_of` maps an actor id
    to its display name."""
    facts: list[str] = []
    if isinstance(player_text, str) and player_text.strip():
        facts.append(t(language, "declared", text=" ".join(player_text.split())))
    for receipt in receipts:
        kind = receipt.get("kind")
        if kind == "roll":
            actor = receipt.get("actor_label") or label_of(str(receipt.get("actor")))
            skill = receipt.get("skill_label") or receipt.get("skill")
            if receipt.get("form") == "dice":
                facts.append(t(language, "dice", actor=actor, skill=skill, expression=receipt.get("expression"),
                               total=receipt.get("total")))
                continue
            verdict = t(language, "passed" if receipt.get("passed") else "failed")
            key = "roll_hidden" if receipt.get("visibility") == "keeper" else "roll"
            level = str(receipt.get("level"))
            if language.startswith("zh"):
                level = LEVEL_ZH.get(level, level)
            facts.append(t(language, key, actor=actor, skill=skill, verdict=verdict, level=level))
        elif kind == "move":
            minutes = int(receipt.get("minutes") or 0)
            key = "move_minutes" if minutes > 0 else "move"
            facts.append(t(language, key, from_=receipt.get("from_label") or receipt.get("from"),
                           to=receipt.get("to_label") or receipt.get("to"), minutes=minutes))
        elif kind == "clue":
            facts.append(t(language, "clue", clue=receipt.get("label") or receipt.get("clue")))
        elif kind in ("delta", "cash"):
            # #19: a cash receipt is a resource change too (label 现金, before → after)
            facts.append(t(language, "delta", label=receipt.get("label") or receipt.get("resource"),
                           subject=receipt.get("subject_label") or receipt.get("subject"),
                           before=receipt.get("before"), after=receipt.get("after")))
        elif kind == "item":
            quantity = int(receipt.get("quantity") or 1)
            facts.append(t(language, "item_loss" if quantity < 0 else "item_gain",
                           subject=receipt.get("subject_label") or receipt.get("subject"),
                           name=receipt.get("label") or receipt.get("name"),
                           count=f" ×{abs(quantity)}" if abs(quantity) > 1 else ""))
        elif kind == "time":
            facts.append(t(language, "time", minutes=int(receipt.get("minutes") or 0)))
        elif kind == "choice":
            facts.append(t(language, "choice", option=receipt.get("option")))
        elif kind == "session":
            family = str(receipt.get("family"))
            start, end = SESSION_ZH.get(family, (family, family))
            transition = receipt.get("transition")
            if transition == "start":
                summary = receipt.get("summary")
                facts.append(t(language, "session_start", start=f"{start}：{summary}" if summary else start))
            elif transition == "end":
                outcome = receipt.get("summary") or receipt.get("outcome")
                key = "session_end" if outcome else "session_end_plain"
                facts.append(t(language, key, end=end, outcome=outcome))
            else:
                facts.append(t(language, "session_round", family=start, round=receipt.get("round")))
    scene = snapshot.get("scene") or {}
    facts.append(t(language, "place", scene=scene.get("display_name") or scene.get("name")))
    present = [str(n) for n in snapshot.get("present") or []]
    facts.append(t(language, "present", names="、".join(present) if language.startswith("zh") else ", ".join(present))
                 if present else t(language, "present_none"))
    return facts


# ---- keeper only --------------------------------------------------------------------------

def keeper_only_facts(language: str, graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any],
                      present: list[dict[str, Any]], budget: int = KEEPER_ONLY_BUDGET) -> list[str]:
    """Undiscovered clues here, present NPCs' agenda and secret, then the module secrets.
    Secrets carry no scene relation in the graph, so they come last and are the first to
    go when the budget trims (12.9)."""
    discovered = set(world.get("discovered_clues") or [])
    items: list[str] = []
    for clue_id in graph.scene_clue_ids(scene):
        node = graph.nodes[clue_id]
        handle = graph.handle(node)
        if handle in discovered:
            continue
        items.append(t(language, "undiscovered_clue", name=handle, summary=graph.summary(node)))
    for node in present:
        record = record_of(node)
        if not record.get("agenda") and not record.get("secret"):
            continue
        items.append(t(language, "npc_secret", name=graph.display_name(node), agenda=record.get("agenda") or "—",
                       secret=record.get("secret") or "—"))
    for node in graph.by_kind.get("secret", []):
        items.append(t(language, "module_secret", name=graph.handle(node), summary=graph.summary(node)))
    while items and json_size(items) > budget:
        items.pop()
    return items


# ---- continuation -------------------------------------------------------------------------

def one_line(language: str, turn: int, scene_display: str, clock_minutes: int,
             session: dict[str, Any] | None, rendered_text: str | None) -> str:
    if session:
        session_label = t(language, "session_label", family=SESSION_ZH.get(str(session.get("kind")), (session.get("kind"),))[0]
                          if language.startswith("zh") else session.get("kind"), round=session.get("round"))
    else:
        session_label = t(language, "no_session")
    head = head_of(rendered_text) or t(language, "no_head")
    return t(language, "one_line", turn=turn, scene=scene_display, clock=t(language, "clock", minutes=clock_minutes),
             session=session_label, head=head)


def instruction(language: str) -> str:
    return t(language, "instruction")
