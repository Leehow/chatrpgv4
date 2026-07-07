#!/usr/bin/env python3
"""COC Storylet Engine — deterministic event deck for AI Keeper pacing.

A storylet is a small, conflict-leveled plot fragment. It adds scene meat by
binding to existing scenario entities (scene/NPC/clue/front) and never rewrites
module truth.
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"

CONFLICT_RANK = {"color": 0, "low": 1, "medium": 2, "high": 3, "climax": 4}
RANK_CONFLICT = {v: k for k, v in CONFLICT_RANK.items()}
STAGE_MAX = {"ordinary": "low", "wrongness": "medium", "pattern": "high", "revelation": "climax"}
ACTION_TARGET = {"REVEAL": "low", "DEEPEN": "low", "PRESSURE": "medium", "CHARACTER": "low", "CHOICE": "medium", "CUT": "low", "MONTAGE": "color", "SUBSYSTEM": "high", "RECOVER": "low", "PAYOFF": "medium"}
SERVICE_KEYS = ("mainline", "can_reveal_clue", "can_tick_front", "can_deepen_npc", "can_force_choice", "can_payoff_memory", "can_recover_stall", "theme")

# flags: n=needs NPC, c=uses/reveals clue, f=uses front/clock, x=choice, p=payoff,
# r=recovery, m=mainline. These 60 original events are generic CoC pacing beats.
SEEDS: list[tuple[str, str, str, str, str, str, str, str]] = [
    ("ambient-echoed-phrase", "回声偷走一句话", "atmosphere", "echo", "color", "DEEPEN PAYOFF MONTAGE", "p", "房间短暂重复调查员刚说过的一句话。"),
    ("ambient-wrong-smell", "不该存在的气味", "atmosphere", "smell", "color", "DEEPEN MONTAGE", "p", "空气里多出一种和地点不相称的气味。"),
    ("ambient-clock-hiccup", "钟表打嗝", "time", "clock", "color", "DEEPEN PAYOFF", "p", "所有计时物短暂慢半拍。"),
    ("ambient-animal-refusal", "动物不肯过线", "warning", "animal", "color", "DEEPEN CHARACTER", "n", "普通动物拒绝靠近某个门槛或物件。"),
    ("ambient-reflection-delay", "倒影慢了一拍", "perception", "mirror", "color", "DEEPEN PAYOFF", "p", "镜面或水面里的动作比现实慢一瞬。"),
    ("ambient-paper-warmth", "纸张余温", "object", "warm-paper", "color", "DEEPEN REVEAL", "c", "一张普通纸像刚被人攥过一样温热。"),
    ("ambient-crowd-silence", "人群忽然安静", "social-weather", "crowd", "color", "DEEPEN PRESSURE", "x", "周围人群在同一秒不约而同地停顿。"),
    ("ambient-wrong-name", "名字被叫错", "identity", "wrong-name", "color", "DEEPEN CHARACTER PAYOFF", "np", "陌生人用错误却贴近真相的名字称呼调查员。"),
    ("ambient-local-superstition", "本地迷信露头", "local-color", "superstition", "color", "DEEPEN CHARACTER MONTAGE", "n", "本地人随口做出避邪动作，随后假装无事。"),
    ("ambient-unseasonal-weather", "天气错季", "environment", "weather", "color", "DEEPEN CUT MONTAGE", "p", "天气短暂呈现不合季节的迹象。"),
    ("clue-nervous-witness", "证人露怯", "npc-reaction", "witness-tell", "low", "CHARACTER REVEAL", "ncm", "NPC在安全问题上过度紧张，露出可追问缝隙。"),
    ("clue-minor-contradiction", "细节对不上", "clue-route", "contradiction", "low", "REVEAL DEEPEN", "cm", "一个小矛盾把调查员带回现有线索链。"),
    ("clue-misfiled-record", "档案归错类", "clue-route", "misfiled", "low", "REVEAL", "cm", "文件没有失踪，只是被归进错误类别。"),
    ("clue-stained-handout", "污渍指出方向", "clue-route", "stain", "low", "REVEAL", "cm", "手稿或收据上的污渍暴露一个地点、时间或接触对象。"),
    ("social-politeness-tax", "礼貌的门槛", "social-friction", "gatekeeping", "low", "CHARACTER CHOICE", "nx", "NPC无敌意，但要求身份、礼貌或小代价。"),
    ("social-small-favor", "先帮个小忙", "side-hook", "favor", "low", "CHOICE CHARACTER", "nxm", "NPC愿意帮忙，但先要求一个不超过一场戏的小帮助。"),
    ("pressure-curious-onlooker", "好奇旁观者", "soft-pressure", "onlooker", "low", "PRESSURE", "x", "旁观者注意到调查员，给隐秘调查增加社交压力。"),
    ("pressure-soft-deadline", "温和截止时间", "soft-pressure", "deadline", "low", "PRESSURE CUT", "fm", "场所即将关门、天色将变或约定时间逼近。"),
    ("choice-two-leads", "两条线索都可走", "choice", "two-leads", "low", "CHOICE", "cxm", "把两个现有方向并置，让玩家选择先追哪一个。"),
    ("recover-obvious-next-step", "显眼但有代价的下一步", "recovery", "next-step", "low", "RECOVER", "crm", "以场内方式把被忽略的现有方向重新摆上台面。"),
    ("payoff-callback-object", "旧物回声", "memory", "object-callback", "low", "PAYOFF", "p", "之前出现过的普通物件现在有了新的意味。"),
    ("cut-clean-transition", "顺势转场", "transition", "clean-cut", "low", "CUT", "m", "当前场景问题暂时回答，镜头自然切到下一站。"),
    ("complication-witness-bolts", "证人逃走", "npc-reaction", "witness-bolts", "medium", "PRESSURE CHARACTER", "nxm", "NPC意识到话题危险，立刻找借口离场。"),
    ("complication-scene-cordoned", "现场被封锁", "access", "cordon", "medium", "PRESSURE CHOICE", "fxm", "关键地点被官方、业主或意外情况临时封锁。"),
    ("complication-notes-touched", "笔记被动过", "surveillance", "notes", "medium", "PRESSURE DEEPEN", "f", "调查员的笔记、房间或随身物显示有人接触过。"),
    ("complication-ally-demands-proof", "盟友要求证据", "npc-reaction", "proof", "medium", "CHARACTER CHOICE", "nxm", "潜在盟友不再接受空口说法，要求现有证据。"),
    ("complication-false-rumor", "假流言扩散", "social-friction", "rumor", "medium", "PRESSURE CHARACTER", "fx", "关于调查员的错误传言开始传播。"),
    ("complication-clue-moved", "线索被搬走", "clue-route", "relocated", "medium", "REVEAL PRESSURE", "cfm", "线索仍在模组内，但被移到另一个可抵达位置。"),
    ("complication-rival-arrives", "竞争调查者出现", "social-friction", "rival", "medium", "CHARACTER CHOICE", "x", "另一名调查者或利益相关者也在追同一条线。"),
    ("complication-ritual-echo", "仪式余波", "mythos-pressure", "ritual-echo", "medium", "DEEPEN PRESSURE", "f", "短暂异象显示幕后力量曾经或即将经过此处。"),
    ("complication-safe-place-cracks", "安全地点裂缝", "soft-pressure", "safe-crack", "medium", "PRESSURE CHOICE", "fx", "调查员以为安全的地方出现轻微入侵迹象。"),
    ("complication-private-bargain", "私下交易", "side-hook", "bargain", "medium", "CHARACTER CHOICE", "nxm", "NPC提出私下交易，但交易必须回流到现有线索或前沿。"),
    ("recover-fail-forward-cost", "失败也有路线", "recovery", "fail-forward", "medium", "RECOVER", "crfm", "调查停滞时让路线出现，但付出时间、信任或安全成本。"),
    ("payoff-half-right", "玩家猜对一半", "memory", "half-right", "medium", "PAYOFF DEEPEN", "pm", "承认玩家猜测的一半成立，同时暴露更危险的缺口。"),
    ("high-witness-disappears", "关键证人失踪", "front-move", "witness-gone", "high", "PRESSURE CHOICE", "nfxm", "关键证人离开可接触范围，留下可追踪痕迹。"),
    ("high-room-searched", "住所被翻动", "surveillance", "room-searched", "high", "PRESSURE", "f", "私人空间被搜过，但不是为了偷钱。"),
    ("high-ally-threatened", "盟友受到威胁", "front-move", "ally-threat", "high", "PRESSURE CHOICE", "nfx", "盟友遭到非图像化威胁，迫使玩家选择是否转向救援。"),
    ("high-evidence-destroyed", "证据正在被毁", "front-move", "evidence", "high", "PRESSURE REVEAL", "cfxm", "现有线索即将被毁，但仍有最后机会抢救一部分。"),
    ("high-authority-turns", "权力机关转向", "authority", "authority-turns", "high", "PRESSURE SUBSYSTEM", "fx", "警方、军方、医院或校方把调查员视为麻烦源。"),
    ("high-vehicle-sabotage", "交通工具被动手脚", "front-move", "vehicle", "high", "PRESSURE CUT", "fx", "离开路线被破坏，说明对手知道调查员行程。"),
    ("high-hostile-offer", "敌对方递来条件", "front-move", "offer", "high", "CHARACTER CHOICE PRESSURE", "fx", "对手提出交换、威胁或停手条件。"),
    ("high-fresh-monster-trace", "怪异痕迹仍新鲜", "mythos-pressure", "fresh-trace", "high", "DEEPEN PRESSURE", "f", "现场出现刚刚留下的非人痕迹。"),
    ("high-public-incident", "异常公开化", "front-move", "public", "high", "PRESSURE CHOICE", "fxm", "怪事在公众面前露出一角，必须处理目击者或舆论。"),
    ("high-countdown-jumps", "倒计时提前", "front-move", "countdown", "high", "PRESSURE", "fm", "威胁前沿的计划提前，原本还有的时间被夺走。"),
    ("high-moral-tradeoff", "道德交换", "choice", "moral", "high", "CHOICE PRESSURE", "cxm", "一条线索可以得到，但会让无辜者、盟友或名誉承担代价。"),
    ("high-rules-spillover", "规则后果外溢", "rule", "spillover", "high", "SUBSYSTEM PRESSURE", "fx", "战斗、追逐或理智后果改变场景条件，而不只是扣数值。"),
    ("climax-threshold-opens", "最终门槛开启", "climax", "threshold", "climax", "PRESSURE CUT SUBSYSTEM", "fxm", "通往终局的门槛打开，继续就不能完整回头。"),
    ("climax-ritual-surges", "仪式暴涨", "climax", "ritual", "climax", "PRESSURE SUBSYSTEM", "fm", "仪式或核心威胁突然推进一大步。"),
    ("climax-ally-as-choice", "盟友成为选择", "climax-choice", "ally-choice", "climax", "CHOICE PRESSURE", "nfxm", "盟友不只是受害者，而是最终选择的一部分。"),
    ("climax-exit-closes", "退路关闭", "climax", "exit", "climax", "PRESSURE CUT", "fx", "玩家仍有行动自由，但安全退路已经消失。"),
    ("climax-truth-costs", "公开真相的代价", "climax-choice", "truth-cost", "climax", "CHOICE PAYOFF", "cxpm", "真相可以说出，但说出会造成制度、家庭或公众层面的代价。"),
    ("climax-investigator-marked", "调查员被标记", "climax", "marked", "climax", "PRESSURE SUBSYSTEM", "fx", "威胁不再只追线索，而是直接认出了调查员。"),
    ("climax-faction-side", "阵营要求站队", "climax-choice", "side", "climax", "CHOICE CHARACTER", "nxm", "一个阵营要求调查员明确站队，不再允许中立。"),
    ("climax-place-collapses", "地点开始崩塌", "climax-env", "collapse", "climax", "PRESSURE SUBSYSTEM", "fx", "关键地点的物理或社会秩序开始崩塌。"),
    ("climax-impossible-return", "不可能的回返", "climax-payoff", "return", "climax", "PAYOFF DEEPEN", "pm", "早已离场或不可能出现的回声，以可行动回应的方式回到场上。"),
    ("climax-wrong-memory", "最后一段错误记忆", "climax-payoff", "wrong-memory", "climax", "PAYOFF CHOICE", "px", "调查员意识到自己对某个关键细节的记忆被改写过。"),
    ("loop-remembering-stranger", "循环中的陌生人记得你", "time-loop", "remember", "medium", "PAYOFF DEEPEN", "npm", "一个本不该记得的人记得上一轮细节。"),
    ("faction-rumor-trade", "流言交易", "faction", "rumor-trade", "low", "CHARACTER REVEAL", "ncm", "NPC愿用一个流言交换调查员的态度。"),
    ("sandbox-route-complication", "自由移动遇阻", "sandbox", "route", "medium", "CHOICE PRESSURE", "fx", "通往某地点的路线上出现临时阻碍。"),
    ("campaign-old-wound", "旧伤回调", "campaign", "old-wound", "medium", "PAYOFF CHARACTER", "p", "前作的伤、债或承诺改变当前态度。"),
]

GENERIC_VARIANTS = {
    "color": ["灯影边缘轻轻抖动", "远处传来一声不合时宜的笑", "空气像旧棉布一样发闷"],
    "low": ["手指摩擦袖口", "多花十分钟", "需要留下姓名"],
    "medium": ["电话突然响起", "门外传来急促脚步", "有人喊出调查员姓名"],
    "high": ["门锁有新划痕", "电话线被剪断", "安全出口被堵住"],
    "climax": ["所有声音只剩心跳", "地面像呼吸一样起伏", "钟声从地下传来"],
}


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _rank(level: str | None) -> int:
    return CONFLICT_RANK.get(str(level or "low"), 1)


def _default_ledger() -> dict[str, Any]:
    return {"schema_version": 1, "used_counts": {}, "used_storylet_ids": [], "recent_families": [], "recent_tropes": [], "recent_motifs": [], "recent_targets": [], "recent_signatures": []}


def read_storylet_ledger(campaign_dir: Path) -> dict[str, Any]:
    data = _read_json(campaign_dir / "save" / "storylet-ledger.json", _default_ledger())
    if not isinstance(data, dict):
        data = _default_ledger()
    for k, v in _default_ledger().items():
        data.setdefault(k, v)
    if not isinstance(data.get("used_counts"), dict):
        data["used_counts"] = {}
    for k in ("used_storylet_ids", "recent_families", "recent_tropes", "recent_motifs", "recent_targets", "recent_signatures"):
        if not isinstance(data.get(k), list):
            data[k] = []
    return data


def write_storylet_ledger(campaign_dir: Path, ledger: dict[str, Any]) -> None:
    _write_json(campaign_dir / "save" / "storylet-ledger.json", ledger)


def _event_from_seed(seed: tuple[str, str, str, str, str, str, str, str]) -> dict[str, Any]:
    sid, title, family, trope, level, actions, flags, beat = seed
    return {
        "storylet_id": sid, "title": title, "family_id": family, "trope_id": trope,
        "conflict_level": level, "dramatic_function": actions.split(),
        "requires": {"npc_id": "n" in flags, "unrevealed_clue": "required" if "c" in flags else "optional", "active_front": "f" in flags},
        "serves": {"mainline": "m" in flags, "can_reveal_clue": "c" in flags, "can_tick_front": "f" in flags, "can_deepen_npc": "n" in flags, "can_force_choice": "x" in flags, "can_payoff_memory": "p" in flags, "can_recover_stall": "r" in flags, "theme": True},
        "motifs": [family, trope],
        "template": {"beat": beat, "mainline_debt": "必须回扣现有线索、NPC议程、威胁前沿、场景问题或主题；不得发明新真凶或改写核心真相。"},
        "anti_repeat": {"max_per_session": 1, "cooldown_turns": 6, "exclude_if_family_used_recently": True},
    }


def _builtin_library() -> dict[str, Any]:
    return {"schema_version": 1, "description": "Built-in generic COC storylet deck", "conflict_levels": list(CONFLICT_RANK), "storylets": [_event_from_seed(s) for s in SEEDS]}


def load_storylet_library(campaign_dir: Path | None = None, rules_dir: Path | None = None) -> dict[str, Any]:
    by_id = {s["storylet_id"]: s for s in _builtin_library()["storylets"]}
    rules_dir = rules_dir or RULES_DIR
    for path in [rules_dir / "storylet-library.json", *(([campaign_dir / "scenario" / "storylet-library.json"] if campaign_dir else []))]:
        data = _read_json(path, {})
        for s in data.get("storylets", []) if isinstance(data, dict) else []:
            if isinstance(s, dict) and s.get("storylet_id"):
                by_id[s["storylet_id"]] = s
    return {"schema_version": 1, "storylets": list(by_id.values())}


def _pacing_entry(ctx: dict[str, Any]) -> dict[str, Any]:
    sid = ctx.get("active_scene_id")
    for e in ctx.get("pacing_map", {}).get("pacing_curve", []):
        if e.get("scene_id") == sid:
            return e
    return {}


def _stage(ctx: dict[str, Any]) -> str:
    return _pacing_entry(ctx).get("horror_stage") or ctx.get("rule_signals", {}).get("horror_stage") or "wrongness"


def target_conflict_for(ctx: dict[str, Any], action: str) -> str:
    target = ACTION_TARGET.get(action, "low")
    tension = _pacing_entry(ctx).get("tension_target") or ctx.get("rule_signals", {}).get("tension_clock", {}).get("tension_level")
    if tension in ("low", "medium", "high", "climax"):
        target = tension
    if ctx.get("rule_signals", {}).get("last_roll_fumble") and _rank(target) < _rank("high"):
        target = "high"
    if action == "RECOVER":
        target = "low"
    return target


def max_conflict_for(ctx: dict[str, Any], action: str) -> str:
    max_level = STAGE_MAX.get(_stage(ctx), "medium")
    if action == "SUBSYSTEM" and _rank(max_level) < 4:
        return RANK_CONFLICT[_rank(max_level) + 1]
    if action == "RECOVER" and _rank(max_level) > 2:
        return "medium"
    return max_level


def _scene_npcs(ctx: dict[str, Any]) -> list[str]:
    return [str(x) for x in (ctx.get("active_scene") or {}).get("npc_ids", []) if x]


def _scene_clues(ctx: dict[str, Any], clue_policy: dict[str, Any] | None = None) -> list[str]:
    found = set(ctx.get("world_state", {}).get("discovered_clue_ids", []))
    out: list[str] = []
    policy = clue_policy or {}
    groups = [policy.get("reveal", []), policy.get("fallback_routes", []), policy.get("leads", []),
              (ctx.get("active_scene") or {}).get("available_clues", [])]
    for group in groups:
        if isinstance(group, str):
            group = [group]
        if isinstance(group, list):
            for c in group:
                if c and c not in found and c not in out:
                    out.append(str(c))
    return out


def _front_clock(ctx: dict[str, Any]) -> tuple[str | None, str | None]:
    for f in ctx.get("threat_fronts", {}).get("fronts", []):
        for c in f.get("clocks", []):
            if int(c.get("current_segments", 0) or 0) < int(c.get("segments", 6) or 6):
                return f.get("front_id"), c.get("clock_id")
        if f.get("front_id"):
            return f.get("front_id"), None
    return None, None


def _eligible(s: dict[str, Any], ctx: dict[str, Any], action: str, ledger: dict[str, Any], clue_policy: dict[str, Any] | None) -> bool:
    if action not in s.get("dramatic_function", []) and "ANY" not in s.get("dramatic_function", []):
        return False
    if _rank(s.get("conflict_level")) > _rank(max_conflict_for(ctx, action)):
        return False
    req = s.get("requires", {})
    if req.get("npc_id") and not _scene_npcs(ctx):
        return False
    if req.get("active_front") and not _front_clock(ctx)[0]:
        return False
    if req.get("unrevealed_clue") == "required" and not _scene_clues(ctx, clue_policy):
        return False
    used = ledger.get("used_counts", {}) if isinstance(ledger.get("used_counts"), dict) else {}
    if int(used.get(s.get("storylet_id"), 0) or 0) >= int(s.get("anti_repeat", {}).get("max_per_session", 1)):
        return False
    return any(s.get("serves", {}).get(k) for k in SERVICE_KEYS)


def _score(s: dict[str, Any], ctx: dict[str, Any], action: str, ledger: dict[str, Any]) -> float:
    diff = abs(_rank(s.get("conflict_level")) - _rank(target_conflict_for(ctx, action)))
    score = {0: 1.35, 1: 1.0, 2: 0.65, 3: 0.35, 4: 0.2}.get(diff, 0.2)
    if s.get("family_id") in ledger.get("recent_families", [])[-6:]:
        score *= 0.25
    if s.get("trope_id") in ledger.get("recent_tropes", [])[-10:]:
        score *= 0.45
    return round(score, 6)


def _pick(items: list[tuple[dict[str, Any], float]], rng: random.Random) -> dict[str, Any] | None:
    total = sum(w for _, w in items)
    if not items or total <= 0:
        return items[0][0] if items else None
    r = rng.random() * total
    acc = 0.0
    for s, w in items:
        acc += w
        if acc >= r:
            return s
    return items[-1][0]


def select_storylet(ctx: dict[str, Any], action: str, clue_policy: dict[str, Any] | None = None, rng: random.Random | None = None, ledger: dict[str, Any] | None = None, library: dict[str, Any] | None = None) -> dict[str, Any]:
    rng = rng or ctx.get("rng") or random.Random()
    campaign_dir = Path(ctx["campaign_dir"]) if ctx.get("campaign_dir") else None
    ledger = ledger or (read_storylet_ledger(campaign_dir) if campaign_dir else _default_ledger())
    library = library or load_storylet_library(campaign_dir)
    candidates = [(s, _score(s, ctx, action, ledger)) for s in library.get("storylets", []) if isinstance(s, dict) and _eligible(s, ctx, action, ledger, clue_policy)]
    candidates = [(s, w) for s, w in candidates if w > 0]
    candidates.sort(key=lambda x: (x[1], x[0].get("storylet_id", "")), reverse=True)
    s = _pick(candidates, rng)
    if not s:
        return {"selected_storylet_id": None, "conflict_level": "color", "target_conflict": target_conflict_for(ctx, action), "max_conflict": max_conflict_for(ctx, action), "ledger_update": None}
    npcs, clues = _scene_npcs(ctx), _scene_clues(ctx, clue_policy)
    front, clock = _front_clock(ctx)
    npc = npcs[rng.randrange(len(npcs))] if npcs and s.get("requires", {}).get("npc_id") else None
    clue = clues[rng.randrange(len(clues))] if clues and (s.get("requires", {}).get("unrevealed_clue") or s.get("serves", {}).get("can_reveal_clue")) else None
    if not (s.get("requires", {}).get("active_front") or s.get("serves", {}).get("can_tick_front")):
        front, clock = None, None
    variant_pool = GENERIC_VARIANTS.get(s.get("conflict_level", "low"), [])
    variant = variant_pool[rng.randrange(len(variant_pool))] if variant_pool else None
    bound = {"location_id": ctx.get("active_scene_id"), "npc_id": npc, "clue_id": clue, "front_id": front, "clock_id": clock}
    signature = ":".join(str(x or "") for x in (s.get("family_id"), s.get("trope_id"), bound["location_id"], npc, clue, front))
    return {"selected_storylet_id": s.get("storylet_id"), "title": s.get("title"), "family_id": s.get("family_id"), "trope_id": s.get("trope_id"), "scope": s.get("scope", "scene"), "conflict_level": s.get("conflict_level"), "target_conflict": target_conflict_for(ctx, action), "max_conflict": max_conflict_for(ctx, action), "dramatic_function": s.get("dramatic_function", []), "bound_entities": bound, "rolled_variants": {"detail": variant} if variant else {}, "serves": s.get("serves", {}), "anti_repeat": {"score": _score(s, ctx, action, ledger), "recent_families_checked": ledger.get("recent_families", [])[-6:]}, "narrative_contract": s.get("template", {}), "ledger_update": {"storylet_id": s.get("storylet_id"), "family_id": s.get("family_id"), "trope_id": s.get("trope_id"), "motifs": s.get("motifs", []), "target_ids": [x for x in bound.values() if x], "signature": signature}}


def enrich_director_plan(ctx: dict[str, Any], plan: dict[str, Any], rng: random.Random | None = None, ledger: dict[str, Any] | None = None, library: dict[str, Any] | None = None) -> dict[str, Any]:
    enriched = json.loads(json.dumps(plan, ensure_ascii=False))
    sel = select_storylet(ctx, str(enriched.get("scene_action", "CHOICE")), enriched.get("clue_policy", {}), rng=rng, ledger=ledger, library=library)
    enriched["storylet"] = sel
    if sel.get("selected_storylet_id"):
        nd = enriched.setdefault("narrative_directives", {})
        nd["storylet_contract"] = sel.get("narrative_contract", {})
        nd["storylet_conflict_level"] = sel.get("conflict_level")
        nd["storylet_rolled_variants"] = sel.get("rolled_variants", {})
        must = nd.setdefault("must_include", [])
        for v in sel.get("rolled_variants", {}).values():
            if v and v not in must:
                must.append(v)
    return enriched


def record_storylet_use(ledger: dict[str, Any], selection: dict[str, Any], turn_number: int | None = None, keep_recent: int = 12) -> dict[str, Any]:
    if not selection or not selection.get("selected_storylet_id"):
        return ledger
    data = json.loads(json.dumps(ledger or _default_ledger(), ensure_ascii=False))
    for k, v in _default_ledger().items():
        data.setdefault(k, v)
    upd = selection.get("ledger_update") or {}
    sid = upd.get("storylet_id") or selection.get("selected_storylet_id")
    data["used_storylet_ids"].append(sid)
    data["used_counts"][sid] = int(data["used_counts"].get(sid, 0) or 0) + 1
    for key, value in (("recent_families", upd.get("family_id")), ("recent_tropes", upd.get("trope_id"))):
        if value:
            data[key].append(value)
    for motif in upd.get("motifs", []):
        if motif:
            data["recent_motifs"].append(motif)
    for target in upd.get("target_ids", []):
        if target:
            data["recent_targets"].append(target)
    if upd.get("signature"):
        data["recent_signatures"].append({"signature": upd["signature"], "turn_number": turn_number})
    for k in ("recent_families", "recent_tropes", "recent_motifs", "recent_targets", "recent_signatures"):
        data[k] = data[k][-keep_recent:]
    return data
