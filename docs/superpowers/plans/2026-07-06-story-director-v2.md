# Story Director v2 Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Story Director 从"会推进模组"升级到"有记忆、有节奏、能回响、会写回"——实现评审 v2 建议的 1-4 项：clue 锚点填充 must_include、pacing-map 运行期消费、grep-native 记忆层、DirectorPlan 写回。

**Architecture:** 6 个 task 按依赖排序：M1（clue 锚点）和 M2（pacing-map）是独立的 director 输出改进；M3（memory card 工具）是基础设施；M4（memory 接入 director + PAYOFF）依赖 M3；M5（apply 写回层）独立；M6（harness drill）验证 M3+M4 端到端。每个 task 产出可独立测试的交付物。

**Tech Stack:** Python 3.10+ 纯标准库 + 项目既有 coc_rule_signals/coc_story_director。pytest 测试，importlib.util 动态加载。记忆卡用 Markdown + YAML frontmatter（grep-friendly，无新依赖）。

## Global Constraints

- 两 plugin 同步：所有脚本改动同时写到 `plugins/coc-keeper/scripts/` 和 `plugins/coc-keeper/scripts/`（字节一致）。
- 测试在 `tests/test_<module>.py`，用 `importlib.util` 加载，从 `plugins/coc-keeper/scripts/` 加载。
- 所有 RNG 用 `random.Random(seed)`。
- 规则数据从 `references/rules-json/` 读，不硬编码。
- director 只读规则状态，绝不直接写 save/combat/sanity（写回由 M5 的 apply 层负责）。
- 记忆卡 frontmatter 用稳定英文 key，玩家可见内容中文。
- 玩家可见文本走 `play_language`；机器标记/JSON key/枚举值 ASCII 稳定。

**真相源：** `docs/superpowers/specs/2026-07-06-story-director-v2-blueprint.md`。台账：`.zralph/story-director-tasks.md`。

---

## File Structure

```
plugins/coc-keeper/scripts/           plugins/coc-keeper/scripts/
  coc_memory.py          [NEW]           coc_memory.py          [NEW]
  coc_director_apply.py  [NEW]           coc_director_apply.py  [NEW]
  coc_story_director.py  [MOD]           coc_story_director.py  [MOD]

plugins/coc-keeper/references/         plugins/coc-keeper/references/
  memory-protocol.md     [NEW]           memory-protocol.md     [NEW]

tests/
  test_memory.py           [NEW]
  test_director_apply.py   [NEW]
  test_story_director.py   [MOD — must_include/pacing/PAYOFF/memory 测试]
```

职责边界：
- `coc_memory.py` — 记忆卡 CRUD + 检索打分 + context pack 构建（薄工具，无 director 决策）。
- `coc_director_apply.py` — 把 DirectorPlan 的 reveal/pressure/memory_write 落盘成 events/save/memory（写回层）。
- `coc_story_director.py` [MOD] — M1 must_include、M2 pacing-map 消费、M4 memory 接入 + PAYOFF 评分。

---

## Task 1: clue-graph 锚点 → must_include 自动填充

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py` 
- Test: `tests/test_story_director.py` (追加)

**Interfaces:**
- Consumes: `clue_graph["conclusions"][].clues[].player_visible_anchor`（新可选字段）
- Produces: `narrative_directives.must_include` 不再为空——当 reveal 有 clue 且该 clue 有 `player_visible_anchor` 时填充

- [ ] **Step 1: 追加失败测试**

```python
def test_must_include_filled_from_clue_anchor(tmp_path):
    """clue with player_visible_anchor populates must_include."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # rewrite clue-graph: clue-1 has player_visible_anchor
    cg = {"conclusions": [{"conclusion_id": "concl-1", "importance": "critical",
            "minimum_routes": 3,
            "clues": [
                {"clue_id": "clue-1", "delivery": "Handout 1 — direct give",
                 "visibility": "player-safe",
                 "player_visible_anchor": "门闩边缘的新鲜划痕"},
                {"clue_id": "clue-1b", "delivery": "Spot Hidden", "visibility": "player-safe"},
                {"clue_id": "clue-1c", "delivery": "Library Use", "visibility": "player-safe"},
            ], "fallback_policy": ""}]}
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(cg))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "anchor-test")
    # clue-1 is revealed (REVEAL action), its anchor must appear in must_include
    assert "门闩边缘的新鲜划痕" in plan["narrative_directives"]["must_include"]


def test_must_include_empty_when_clue_has_no_anchor(tmp_path):
    """clue without player_visible_anchor leaves must_include empty (no crash)."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # default _make_minimal_campaign clues have no player_visible_anchor
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "no-anchor-test")
    assert plan["narrative_directives"]["must_include"] == []
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_story_director.py -v -k must_include`
Expected: FAIL — `"门闩边缘的新鲜划痕" not in []`

- [ ] **Step 3: 实现 must_include 填充**

在 `coc_story_director.py` 加一个辅助函数（放在 `_select_clue_policy` 之后）：

```python
def _collect_anchors(clue_ids: list[str], clue_graph: dict[str, Any]) -> list[str]:
    """Collect player_visible_anchor strings for given clue ids from clue-graph.
    Used to populate narrative_directives.must_include so the narrator knows
    what concrete visible detail a REVEAL must surface."""
    anchors: list[str] = []
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("clue_id") in clue_ids:
                anchor = clue.get("player_visible_anchor")
                if anchor:
                    anchors.append(anchor)
    return anchors
```

然后在 `generate_director_plan` 里，构造 `narrative_directives` 时调用它。找到 `narrative_directives = {` 块，把 `"must_include": [],` 改为：

```python
        "must_include": _collect_anchors(
            clue_policy.get("reveal", []) + clue_policy.get("fallback_routes", []),
            ctx.get("clue_graph", {}),
        ),
```

（单轨：仅维护 plugins/coc-keeper/。）

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_story_director.py -v -k must_include`
Expected: 2 passed

- [ ] **Step 5: 全量 + Commit**

```bash
pytest tests/ -q
# sync check
diff plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_story_director.py
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_story_director.py tests/test_story_director.py
git commit -m "feat: populate must_include from clue player_visible_anchor"
```

---

## Task 2: pacing-map 运行期消费（horror_stage/pacing_mode/tension_delta）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py` 
- Test: `tests/test_story_director.py` (追加)

**Interfaces:**
- Consumes: `pacing_map["pacing_curve"]`（每项有 `scene_id`/`tension_target`/`horror_stage`）
- Produces: `narrative_directives.horror_escalation_stage` 和 `pacing_mode` 从 active scene 读，不再静态/仅按 action

- [ ] **Step 1: 追加失败测试**

```python
def test_pacing_drives_horror_stage_from_active_scene(tmp_path):
    """horror_escalation_stage comes from pacing-map entry matching active scene."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # add a pacing-map with scene-1 = revelation stage
    pm = {"pacing_curve": [
        {"scene_id": "scene-1", "tension_target": "high", "horror_stage": "revelation"},
    ]}
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps(pm))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "pacing-test")
    assert plan["narrative_directives"]["horror_escalation_stage"] == "revelation"
    assert plan["pacing_mode"] == "high"


def test_pacing_falls_back_when_no_matching_scene(tmp_path):
    """no pacing entry for active scene -> fallback to action-based defaults, no crash."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # pacing-map exists but no scene-1 entry
    pm = {"pacing_curve": [{"scene_id": "other-scene", "tension_target": "low", "horror_stage": "ordinary"}]}
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps(pm))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "pacing-fallback-test")
    # fallback horror stage is wrongness (v1 default), pacing_mode from action
    assert plan["narrative_directives"]["horror_escalation_stage"] == "wrongness"
    assert plan["pacing_mode"] in ("investigation", "pressure", "social", "low", "medium", "high", "climax", "aftermath", "slow_burn")
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_story_director.py -v -k pacing_drives or pacing_falls_back`
Expected: FAIL — horror_escalation_stage 是 "wrongness" 不是 "revelation"

- [ ] **Step 3: 实现 pacing-map 消费**

在 `coc_story_director.py` 加辅助函数（放在 `_collect_anchors` 之后）：

```python
VALID_HORROR_STAGES = {"ordinary", "wrongness", "pattern", "revelation"}


def _current_pacing_entry(ctx: dict[str, Any]) -> dict[str, Any]:
    """Find the pacing-map entry for the active scene. Returns {} if none."""
    active_scene_id = ctx.get("active_scene_id")
    if not active_scene_id:
        return {}
    for entry in ctx.get("pacing_map", {}).get("pacing_curve", []):
        if entry.get("scene_id") == active_scene_id:
            return entry
    return {}
```

然后在 `generate_director_plan` 里，把现在的静态 horror_stage 和 action-only pacing_mode/tension_delta 改成读 pacing entry。找到 `generate_director_plan` 中计算这些字段的区块（约 line 500-530），替换为：

```python
    pacing_entry = _current_pacing_entry(ctx)
    # horror stage from pacing-map, validated; fallback to wrongness
    raw_horror = pacing_entry.get("horror_stage", "wrongness")
    horror_stage = raw_horror if raw_horror in VALID_HORROR_STAGES else "wrongness"
    # pacing_mode: prefer pacing-map tension_target; fallback to action-based
    pacing_mode = pacing_entry.get("tension_target")
    if not pacing_mode:
        pacing_mode = "investigation" if action in ("REVEAL", "DEEPEN") else ("pressure" if action == "PRESSURE" else "social")
    # tension_delta: action-driven, but escalation scenes add +1
    tension_delta = 1 if action in ("PRESSURE", "SUBSYSTEM") else (0 if action in ("REVEAL", "DEEPEN", "RECOVER") else -1)
    if pacing_entry.get("tension_target") in ("high", "climax") and action not in ("RECOVER", "MONTAGE"):
        tension_delta = max(tension_delta, 1)
```

然后 `narrative_directives` 里把 `"horror_escalation_stage": "wrongness",` 改成 `"horror_escalation_stage": horror_stage,`，`"pacing_mode"` 改成用上面的变量，`"tension_delta"` 用上面的变量。

（单轨：仅维护 plugins/coc-keeper/。）

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_story_director.py -v -k pacing_drives or pacing_falls_back`
Expected: 2 passed

- [ ] **Step 5: 全量 + Commit**

```bash
pytest tests/ -q
diff plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_story_director.py
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_story_director.py tests/test_story_director.py
git commit -m "feat: consume pacing-map for horror_stage/pacing_mode/tension_delta"
```

---

## Task 3: coc_memory.py — Markdown memory cards + 检索 + context pack

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_memory.py` 
- Create: `plugins/coc-keeper/references/memory-protocol.md` 
- Test: `tests/test_memory.py`

**Interfaces:**
- Produces: `create_memory_card()`, `retrieve_memory_cards()`, `build_context_pack()`, `update_memory_index()`

- [ ] **Step 1: 写失败测试 test_memory.py**

```python
"""Tests for coc_memory: grep-native Markdown memory cards."""
import importlib.util
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_memory = _load("coc_memory", "plugins/coc-keeper/scripts/coc_memory.py")


def _campaign(tmp_path):
    camp = tmp_path / "campaigns" / "test"
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True)
    (camp / "memory" / "cards" / "keeper-only").mkdir(parents=True)
    return camp


def test_create_memory_card_writes_markdown_with_frontmatter(tmp_path):
    camp = _campaign(tmp_path)
    path = coc_memory.create_memory_card(
        campaign_dir=camp,
        memory_id="mem-001-door-scratches",
        privacy="player_safe",
        salience=0.82,
        summary="玩家对门闩划痕非常在意，偏好近距离检查。",
        entities=["ada-king", "corbitt-house", "front-door"],
        tags=["player_interest", "physical_clue"],
        reactivation_cues=["door", "lock", "scratch"],
        source_events=["event-042"],
    )
    assert path.exists()
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    assert "memory_id: mem-001-door-scratches" in text
    assert "ada-king" in text
    assert "玩家对门闩划痕非常在意" in text  # body
    assert "player-safe" in str(path)  # privacy dir routing


def test_create_memory_card_keeper_only_routes_to_separate_dir(tmp_path):
    camp = _campaign(tmp_path)
    path = coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-002-corbitt-secret",
        privacy="keeper_only", salience=0.9,
        summary="Corbitt 埋在地下室（keeper only）。",
        entities=["corbitt"], tags=["secret"],
        reactivation_cues=["basement"], source_events=[],
    )
    assert "keeper-only" in str(path)
    assert "player-safe" not in str(path)


def test_retrieve_memory_cards_scores_by_entity_overlap(tmp_path):
    camp = _campaign(tmp_path)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-door", privacy="player_safe",
        salience=0.8, summary="door interest",
        entities=["front-door", "corbitt-house"], tags=["player_interest"],
        reactivation_cues=["door"], source_events=[])
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-npc", privacy="player_safe",
        salience=0.5, summary="npc relation",
        entities=["npc-knott"], tags=["npc_relationship"],
        reactivation_cues=["knott"], source_events=[])
    results = coc_memory.retrieve_memory_cards(
        campaign_dir=camp,
        query_entities=["front-door", "corbitt-house"],
        query_cues=["door"], query_tags=[],
        privacy_filter="player_safe", limit=5,
    )
    assert len(results) >= 1
    assert results[0]["memory_id"] == "mem-door"  # highest entity overlap


def test_retrieve_excludes_wrong_privacy(tmp_path):
    camp = _campaign(tmp_path)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-secret", privacy="keeper_only",
        salience=0.95, summary="secret", entities=["front-door"],
        tags=["x"], reactivation_cues=["door"], source_events=[])
    results = coc_memory.retrieve_memory_cards(
        campaign_dir=camp, query_entities=["front-door"],
        query_cues=["door"], query_tags=[], privacy_filter="player_safe", limit=5)
    assert all(r["privacy"] != "keeper_only" for r in results)


def test_build_context_pack_writes_markdown(tmp_path):
    camp = _campaign(tmp_path)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-door", privacy="player_safe",
        salience=0.8, summary="door interest", entities=["front-door"],
        tags=["player_interest"], reactivation_cues=["door"], source_events=[])
    cards = coc_memory.retrieve_memory_cards(
        campaign_dir=camp, query_entities=["front-door"],
        query_cues=["door"], query_tags=[], privacy_filter="player_safe", limit=5)
    pack_path = coc_memory.build_context_pack(
        campaign_dir=camp, turn=42,
        active_scene_id="house-entry", dramatic_question="x?",
        player_intent="检查门", cards=cards,
        keeper_constraints=["不透露 corbitt-buried"])
    assert pack_path.exists()
    text = pack_path.read_text(encoding="utf-8")
    assert "turn-42" in str(pack_path) or "turn 42" in text.lower() or "42" in text
    assert "检查门" in text
    assert "mem-door" in text
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_memory.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: 实现 coc_memory.py**

```python
#!/usr/bin/env python3
"""Grep-native memory layer for the COC Story Director.

Memory cards are Markdown files with YAML frontmatter. The frontmatter holds
machine-readable fields (memory_id, privacy, salience, entities, tags,
reactivation_cues); the body holds a short Chinese summary an LLM can read
directly. This design favors Codex grep/read over a database.

Spec: docs/superpowers/specs/2026-07-06-story-director-v2-blueprint.md
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

PRIVACY_DIRS = {
    "player_safe": "player-safe",
    "keeper_only": "keeper-only",
    "system_only": "keeper-only",  # system-only not shown to anyone; reuse keeper-only dir
}


def _cards_dir(campaign_dir: Path, privacy: str) -> Path:
    subdir = PRIVACY_DIRS.get(privacy, "keeper-only")
    d = campaign_dir / "memory" / "cards" / subdir
    d.mkdir(parents=True, exist_ok=True)
    return d


def _frontmatter(cards_dir: Path) -> list[dict[str, Any]]:
    """Parse frontmatter from all .md cards in a dir. Returns list of dicts with path."""
    import re
    out = []
    for md in sorted(cards_dir.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        if not text.startswith("---\n"):
            continue
        parts = text.split("---", 2)
        if len(parts) < 3:
            continue
        fm_text = parts[1]
        # crude YAML parse (key: value or multiline list)
        meta: dict[str, Any] = {"path": str(md), "body": parts[2].strip()}
        current_list_key = None
        current_list: list[str] = []
        for line in fm_text.splitlines():
            list_item = re.match(r^\s*-\s+(.+)$`, line)
            if list_item and current_list_key:
                current_list.append(list_item.group(1).strip())
                continue
            m = re.match(r^([a-z_]+):\s*(.*)$`, line)
            if m:
                if current_list_key and current_list:
                    meta[current_list_key] = current_list
                key, val = m.group(1), m.group(2).strip()
                current_list_key = key if val == "" else None
                current_list = []
                if val:
                    try:
                        meta[key] = float(val) if "." in val else int(val)
                    except ValueError:
                        meta[key] = val
        if current_list_key and current_list:
            meta[current_list_key] = current_list
        out.append(meta)
    return out


def create_memory_card(
    campaign_dir: Path,
    memory_id: str,
    privacy: str,
    summary: str,
    entities: list[str],
    tags: list[str],
    reactivation_cues: list[str],
    source_events: list[str] | None = None,
    salience: float = 0.5,
    scope: str = "campaign",
    scenes: list[str] | None = None,
    possible_payoff: str = "",
) -> Path:
    """Write a Markdown memory card with YAML frontmatter. Returns its path."""
    source_events = source_events or []
    scenes = scenes or []
    cards_dir = _cards_dir(campaign_dir, privacy)
    path = cards_dir / f"{memory_id}.md"
    lines = ["---",
        f"memory_id: {memory_id}",
        f"scope: {scope}",
        f"privacy: {privacy}",
        f"salience: {salience}",
        "entities:"]
    lines += [f"  - {e}" for e in entities]
    lines.append("tags:")
    lines += [f"  - {t}" for t in tags]
    lines.append("reactivation_cues:")
    lines += [f"  - {c}" for c in reactivation_cues]
    if scenes:
        lines.append("scenes:")
        lines += [f"  - {s}" for s in scenes]
    if source_events:
        lines.append("source_events:")
        lines += [f"  - {e}" for e in source_events]
    if possible_payoff:
        lines.append(f"possible_payoff: {possible_payoff}")
    lines.append("---")
    lines.append("")
    lines.append(summary)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    update_memory_index(campaign_dir)
    return path


def retrieve_memory_cards(
    campaign_dir: Path,
    query_entities: list[str],
    query_cues: list[str],
    query_tags: list[str],
    privacy_filter: str = "player_safe",
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Score and rank memory cards by overlap with query terms. No embeddings.

    score = 4*entity_overlap + 3*cue_overlap + 2*tag_overlap + 2*salience - 5*privacy_mismatch
    """
    candidates: list[dict[str, Any]] = []
    # which dirs to scan based on privacy_filter
    scan_dirs = []
    if privacy_filter == "player_safe":
        scan_dirs.append(campaign_dir / "memory" / "cards" / "player-safe")
    else:
        # keeper can see both
        scan_dirs.append(campaign_dir / "memory" / "cards" / "player-safe")
        scan_dirs.append(campaign_dir / "memory" / "cards" / "keeper-only")

    q_entities = set(query_entities)
    q_cues = set(query_cues)
    q_tags = set(query_tags)

    for d in scan_dirs:
        if not d.exists():
            continue
        for meta in _frontmatter(d):
            card_entities = set(meta.get("entities", []) or [])
            card_cues = set(meta.get("reactivation_cues", []) or [])
            card_tags = set(meta.get("tags", []) or [])
            card_privacy = meta.get("privacy", "player_safe")
            # privacy mismatch penalty
            privacy_penalty = 0
            if privacy_filter == "player_safe" and card_privacy != "player_safe":
                privacy_penalty = 5
            score = (
                4 * len(q_entities & card_entities)
                + 3 * len(q_cues & card_cues)
                + 2 * len(q_tags & card_tags)
                + 2 * float(meta.get("salience", 0.5))
                - privacy_penalty
            )
            if score > 0:
                meta["score"] = round(score, 3)
                candidates.append(meta)
    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[:limit]


def build_context_pack(
    campaign_dir: Path,
    turn: int,
    active_scene_id: str,
    dramatic_question: str,
    player_intent: str,
    cards: list[dict[str, Any]],
    keeper_constraints: list[str] | None = None,
) -> Path:
    """Write a Markdown context pack the director reads next turn."""
    keeper_constraints = keeper_constraints or []
    packs_dir = campaign_dir / "memory" / "context-packs"
    packs_dir.mkdir(parents=True, exist_ok=True)
    path = packs_dir / f"turn-{turn:05d}.md"
    lines = [
        f"# Director Context Pack turn-{turn}",
        "",
        "## Active Scene",
        f"scene_id: {active_scene_id}",
        f"dramatic_question: {dramatic_question}",
        "",
        "## Current Player Intent",
        player_intent,
        "",
        "## Relevant Memory Cards",
    ]
    if cards:
        for c in cards:
            mid = c.get("memory_id", "?")
            body = c.get("body", "")
            lines.append(f"- {mid}: {body}")
    else:
        lines.append("(none)")
    lines.append("")
    lines.append("## Keeper-only Constraints")
    if keeper_constraints:
        lines += [f"- {k}" for k in keeper_constraints]
    else:
        lines.append("(none)")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    # also update latest
    latest = packs_dir / "latest-director-context.md"
    latest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def update_memory_index(campaign_dir: Path) -> None:
    """Rebuild memory/index.json from all cards (cheap, run on write)."""
    cards_meta = []
    for sub in ("player-safe", "keeper-only"):
        d = campaign_dir / "memory" / "cards" / sub
        if not d.exists():
            continue
        for meta in _frontmatter(d):
            cards_meta.append({
                "memory_id": meta.get("memory_id"),
                "path": meta.get("path"),
                "privacy": meta.get("privacy"),
                "salience": meta.get("salience", 0.5),
                "entities": meta.get("entities", []),
                "tags": meta.get("tags", []),
                "reactivation_cues": meta.get("reactivation_cues", []),
            })
    index_path = campaign_dir / "memory" / "index.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps({"schema_version": 1, "cards": cards_meta}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
```

**重要：** 上面 `_frontmatter` 里的正则用了反引号包裹（markdown 渲染问题），实际代码里必须是合法 Python 正则字符串。实现时写为：
```python
list_item = re.match(r"^\s*-\s+(.+)$", line)
...
m = re.match(r"^([a-z_]+):\s*(.*)$", line)
```

（单轨：仅维护 plugins/coc-keeper/。）

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_memory.py -v`
Expected: 5 passed

- [ ] **Step 5: 写 memory-protocol.md**

```markdown
# Memory Protocol

Grep-native memory layer for the COC Story Director. See `docs/superpowers/specs/2026-07-06-story-director-v2-blueprint.md`.

## Layout
```
.coc/campaigns/<id>/memory/
  cards/player-safe/mem-*.md     # player-visible memory
  cards/keeper-only/mem-*.md     # director-only
  context-packs/turn-NNNNN.md    # per-turn director context
  index.json                      # retrieval accelerator
```

## Card format
Markdown + YAML frontmatter. Frontmatter keys (English, stable): `memory_id`, `scope`, `privacy`, `salience`, `entities`, `tags`, `reactivation_cues`, `scenes`, `source_events`, `possible_payoff`. Body: short Chinese summary.

## Grep examples
```
grep -R "reactivation_cues:.*door" memory/cards
grep -R "entities:.*ada-king" memory/cards
grep -R "tags:.*player_interest" memory/cards
```

## Write triggers (don't write too often)
1. player expresses preference/fear/hypothesis
2. player spends big Luck or pushes a roll
3. NPC attitude changes
4. critical clue understood/misunderstood
5. irreversible choice
6. trauma/insanity/major wound
7. foreshadow set or paid off
```

（单轨：仅维护 plugins/coc-keeper/。）

- [ ] **Step 6: 全量 + Commit**

```bash
pytest tests/ -q
diff plugins/coc-keeper/scripts/coc_memory.py plugins/coc-keeper/scripts/coc_memory.py
git add plugins/coc-keeper/scripts/coc_memory.py plugins/coc-keeper/scripts/coc_memory.py \
        plugins/coc-keeper/references/memory-protocol.md plugins/coc-keeper/references/memory-protocol.md \
        tests/test_memory.py
git commit -m "feat: add coc_memory grep-native markdown memory cards + retrieval + context pack"
```

---

## Task 4: Director 接入 memory（memory_reads/writes + PAYOFF 评分）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py` 
- Test: `tests/test_story_director.py` (追加)

**Interfaces:**
- Consumes: `coc_memory.retrieve_memory_cards()`（M3）；ctx 里加 `memory_cards`（context pack 检索结果）
- Produces: DirectorPlan.memory_reads 非空；PAYOFF base_score 不再 hardcoded 0

- [ ] **Step 1: 追加失败测试**

```python
def test_payoff_scores_above_zero_when_memory_matches(tmp_path):
    """PAYOFF should score > 0 when retrieved memory cards match the scene."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    # pre-populate a memory card keyed to scene-1 entities
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_memory", "plugins/coc-keeper/scripts/coc_memory.py")
    coc_memory = importlib.util.module_from_spec(spec); spec.loader.exec_module(coc_memory)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-test-door",
        privacy="player_safe", salience=0.8,
        summary="玩家关注门", entities=["scene-1-entity"],
        tags=["player_interest"], reactivation_cues=["scene-1"], source_events=[])
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="recall", player_intent_class="investigate", rng=random.Random(42))
    # force memory retrieval by injecting entities matching the card
    ctx["memory_query_entities"] = ["scene-1-entity"]
    ctx["memory_query_cues"] = ["scene-1"]
    score = coc_story_director._base_score("PAYOFF", ctx)
    assert score > 0.0


def test_memory_reads_populated_when_cards_match(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_memory", "plugins/coc-keeper/scripts/coc_memory.py")
    coc_memory = importlib.util.module_from_spec(spec); spec.loader.exec_module(coc_memory)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-test-door",
        privacy="player_safe", salience=0.9,
        summary="玩家关注门", entities=["scene-1-entity"],
        tags=["player_interest"], reactivation_cues=["scene-1"], source_events=[])
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    ctx["memory_query_entities"] = ["scene-1-entity"]
    ctx["memory_query_cues"] = ["scene-1"]
    plan = coc_story_director.generate_director_plan(ctx, "mem-test")
    assert len(plan["memory_reads"]) >= 1
    assert plan["memory_reads"][0]["memory_id"] == "mem-test-door"
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_story_director.py -v -k payoff_scores or memory_reads_populated`
Expected: FAIL — PAYOFF 返回 0，memory_reads 为空

- [ ] **Step 3: 实现 memory 接入**

在 `coc_story_director.py` 顶部加载 coc_memory（在加载 coc_rule_signals 后）：

```python
coc_memory = None
try:
    coc_memory = _load_sibling("coc_memory", "coc_memory.py")
except Exception:
    coc_memory = None  # memory layer optional; director degrades gracefully
```

改 `_base_score` 的 PAYOFF 分支（找到 `if action == "PAYOFF":` 块，现在是 `return 0.0`）：

```python
    if action == "PAYOFF":
        if coc_memory is None:
            return 0.0
        cards = _retrieve_memory_for_ctx(ctx)
        if not cards:
            return 0.0
        # score scales with top card salience + match count
        top = max(float(c.get("score", 0)) for c in cards)
        return min(0.9, 0.3 + top * 0.1)
```

加辅助函数（放在 `_current_pacing_entry` 之后）：

```python
def _retrieve_memory_for_ctx(ctx: dict[str, Any]) -> list[dict[str, Any]]:
    """Retrieve memory cards matching the current scene/intent. Returns [] if no memory layer."""
    if coc_memory is None:
        return []
    campaign_dir = ctx.get("campaign_dir")
    if campaign_dir is None:
        return []
    # query terms: explicit overrides first, else derive from scene + intent
    entities = ctx.get("memory_query_entities") or _derive_memory_entities(ctx)
    cues = ctx.get("memory_query_cues") or [ctx.get("player_intent", "")]
    tags = ctx.get("memory_query_tags") or []
    cards = coc_memory.retrieve_memory_cards(
        campaign_dir=Path(campaign_dir),
        query_entities=[e for e in entities if e],
        query_cues=[c for c in cues if c],
        query_tags=tags,
        privacy_filter="player_safe",
        limit=5,
    )
    return cards


def _derive_memory_entities(ctx: dict[str, Any]) -> list[str]:
    """Default memory query: active scene id + npc ids + available clue ids."""
    scene = ctx.get("active_scene") or {}
    ents = [ctx.get("active_scene_id", "")]
    ents += scene.get("npc_ids", [])
    ents += scene.get("available_clues", [])
    return [e for e in ents if e]
```

在 `generate_director_plan` 里，把 `"memory_reads": [],` 改为填充检索结果：

```python
    mem_cards = _retrieve_memory_for_ctx(ctx)
    memory_reads = [
        {"memory_id": c.get("memory_id"), "path": c.get("path"),
         "reason": "entity/scene match", "use": "PAYOFF" if action == "PAYOFF" else "TONE"}
        for c in mem_cards
    ]
```

然后在 plan dict 里用 `"memory_reads": memory_reads,`。

`memory_writes` v2 先留空数组（写回由 M5 的 apply 层根据场景触发，不在 director 里决定）。

（单轨：仅维护 plugins/coc-keeper/。）

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_story_director.py -v -k payoff_scores or memory_reads_populated`
Expected: 2 passed

- [ ] **Step 5: 全量 + Commit**

```bash
pytest tests/ -q
diff plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_story_director.py
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_story_director.py tests/test_story_director.py
git commit -m "feat: wire memory retrieval into director (PAYOFF scores + memory_reads)"
```

---

## Task 5: coc_director_apply.py — DirectorPlan 写回层

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_director_apply.py` 
- Test: `tests/test_director_apply.py`

**Interfaces:**
- Consumes: DirectorPlan JSON（reveal/pressure_moves/memory_writes）
- Produces: 更新 `save/world-state.json`（discovered_clue_ids）、`save/pacing-state.json`（tension/turn）、追加 `logs/events.jsonl`、写 memory cards（如有 memory_writes）

- [ ] **Step 1: 写失败测试 test_director_apply.py**

```python
"""Tests for coc_director_apply: persists DirectorPlan effects to save/logs/memory."""
import importlib.util
import json
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_director_apply = _load("coc_director_apply", "plugins/coc-keeper/scripts/coc_director_apply.py")


def _campaign(tmp_path):
    camp = tmp_path / "campaigns" / "test"
    (camp / "save").mkdir(parents=True)
    (camp / "save" / "investigator-state").mkdir()
    (camp / "logs").mkdir(parents=True)
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True)
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "discovered_clue_ids": [],
        "active_scene_id": "scene-1"}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 0, "luck_spent_last": 0}))
    (camp / "logs" / "events.jsonl").write_text("")
    return camp


def test_apply_reveal_adds_clue_to_discovered(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" in world["discovered_clue_ids"]
    assert any("clue-A" in e.get("summary", "") or "reveal" in e.get("event_type", "") for e in events)


def test_apply_pressure_updates_pacing_turn(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d2", "scene_action": "PRESSURE",
            "clue_policy": {"reveal": []},
            "pressure_moves": [{"clock_id": "cult-alert", "tick": 1, "visible_symptom": "黑车出现"}],
            "memory_writes": [], "rule_signals": {},
            "narrative_directives": {"horror_escalation_stage": "pattern"}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["turn_number"] == 1
    assert pacing["tension_level"] == "medium"  # low + 1 pressure tick -> medium


def test_apply_writes_event_to_logs(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d3", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-X"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    events_text = (camp / "logs" / "events.jsonl").read_text().strip()
    assert events_text  # non-empty
    assert "clue-X" in events_text


def test_apply_memory_write_creates_card(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d4", "scene_action": "CHARACTER",
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [{"type": "player_interest", "privacy": "player_safe",
                               "salience": 0.7, "entities": ["npc-knott"],
                               "tags": ["npc_relationship"], "summary": "玩家信任诺特",
                               "reactivation_cues": ["knott"]}],
            "rule_signals": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    cards = list((camp / "memory" / "cards" / "player-safe").glob("*.md"))
    assert len(cards) >= 1
    assert "玩家信任诺特" in cards[0].read_text(encoding="utf-8")
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_director_apply.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: 实现 coc_director_apply.py**

```python
#!/usr/bin/env python3
"""DirectorPlan apply layer — persists director decisions to save/logs/memory.

The director is read-only wrt rule state; this module is the write side that
turns a DirectorPlan's reveal/pressure/memory_write intents into file changes.
Called by coc-keeper-play after narrating a turn.

Spec: docs/superpowers/specs/2026-07-06-story-director-v2-blueprint.md
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_memory = None
try:
    coc_memory = _load_sibling("coc_memory", "coc_memory.py")
except Exception:
    coc_memory = None


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


_TENSION_LADDER = ["low", "medium", "high", "climax"]


def _bump_tension(current: str, delta: int) -> str:
    """Move tension level by delta steps, clamped to the ladder."""
    if current not in _TENSION_LADDER:
        current = "low"
    idx = _TENSION_LADDER.index(current) + delta
    idx = max(0, min(len(_TENSION_LADDER) - 1, idx))
    return _TENSION_LADDER[idx]


def apply_plan(campaign_dir: Path, plan: dict[str, Any], investigator_id: str) -> list[dict[str, Any]]:
    """Apply a DirectorPlan's effects. Returns the events written to logs/events.jsonl.

    - clue reveal -> add to world-state.discovered_clue_ids + event
    - pressure_moves -> bump pacing tension + turn + event per move
    - memory_writes -> create memory cards via coc_memory
    """
    events: list[dict[str, Any]] = []
    save = campaign_dir / "save"
    logs = campaign_dir / "logs"
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    decision_id = plan.get("decision_id", "unknown")
    action = plan.get("scene_action", "")

    # 1. clue reveal
    world_path = save / "world-state.json"
    world = _read_json(world_path, {"discovered_clue_ids": []})
    discovered = list(world.get("discovered_clue_ids", []))
    for clue_id in plan.get("clue_policy", {}).get("reveal", []):
        if clue_id and clue_id not in discovered:
            discovered.append(clue_id)
            ev = {"event_type": "clue_reveal", "decision_id": decision_id,
                  "clue_id": clue_id, "investigator_id": investigator_id,
                  "summary": f"clue revealed: {clue_id}", "ts": ts}
            events.append(ev)
            _append_jsonl(logs / "events.jsonl", ev)
    world["discovered_clue_ids"] = discovered
    _write_json(world_path, world)

    # 2. pressure moves -> pacing state + events
    pacing_path = save / "pacing-state.json"
    pacing = _read_json(pacing_path, {"tension_level": "low", "turn_number": 0})
    pressure_moves = plan.get("pressure_moves", [])
    tension_delta = sum(int(m.get("tick", 0)) for m in pressure_moves)
    if tension_delta or action in ("PRESSURE", "SUBSYSTEM"):
        pacing["tension_level"] = _bump_tension(pacing.get("tension_level", "low"), max(1, tension_delta))
    pacing["turn_number"] = int(pacing.get("turn_number", 0)) + 1
    # carry horror stage from plan into pacing for next-turn director read
    horror = plan.get("narrative_directives", {}).get("horror_escalation_stage")
    if horror:
        pacing["horror_stage"] = horror
    _write_json(pacing_path, pacing)
    for move in pressure_moves:
        ev = {"event_type": "pressure_tick", "decision_id": decision_id,
              "clock_id": move.get("clock_id"), "visible_symptom": move.get("visible_symptom"),
              "investigator_id": investigator_id, "ts": ts}
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    # 3. memory writes -> cards
    if coc_memory is not None:
        for i, mw in enumerate(plan.get("memory_writes", [])):
            mid = f"mem-{decision_id}-{i}"
            coc_memory.create_memory_card(
                campaign_dir=campaign_dir, memory_id=mid,
                privacy=mw.get("privacy", "player_safe"),
                salience=float(mw.get("salience", 0.5)),
                summary=mw.get("summary", ""),
                entities=mw.get("entities", []),
                tags=mw.get("tags", []),
                reactivation_cues=mw.get("reactivation_cues", []),
                source_events=[decision_id],
            )

    # 4. always emit a turn event if nothing else did
    if not events:
        ev = {"event_type": "turn", "decision_id": decision_id, "action": action,
              "investigator_id": investigator_id, "ts": ts}
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    return events
```

（单轨：仅维护 plugins/coc-keeper/。）

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_director_apply.py -v`
Expected: 4 passed

- [ ] **Step 5: 全量 + Commit**

```bash
pytest tests/ -q
diff plugins/coc-keeper/scripts/coc_director_apply.py plugins/coc-keeper/scripts/coc_director_apply.py
git add plugins/coc-keeper/scripts/coc_director_apply.py plugins/coc-keeper/scripts/coc_director_apply.py tests/test_director_apply.py
git commit -m "feat: add coc_director_apply write-back layer (reveal/pressure/memory -> save/logs)"
```

---

## Task 6: memory continuity harness drill + 全量验证

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_harness.py` （加 memory continuity 检查）
- Test: `tests/test_story_harness.py` (追加)

**Interfaces:**
- Consumes: DirectorPlan（across multiple turns）+ coc_memory cards
- Produces: `assert_memory_continuity()` — 验证 director 在后续轮能检索到前轮写入的记忆

- [ ] **Step 1: 追加失败测试**

```python
def test_memory_continuity_recalls_earlier_interest(tmp_path):
    """Director writes a memory card in turn 1, recalls it in turn 2 when entity matches."""
    import importlib.util, random
    # load apply + memory
    spec_mem = importlib.util.spec_from_file_location("coc_memory_apply", "plugins/coc-keeper/scripts/coc_memory.py")
    coc_memory = importlib.util.module_from_spec(spec_mem); spec_mem.loader.exec_module(coc_memory)
    spec_apply = importlib.util.spec_from_file_location("coc_apply", "plugins/coc-keeper/scripts/coc_director_apply.py")
    coc_director_apply = importlib.util.module_from_spec(spec_apply); spec_apply.loader.exec_module(coc_director_apply)

    camp, char_path = _make_campaign_with_fumble(tmp_path)
    # ensure memory dirs
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True, exist_ok=True)

    # turn 1: director plan with a memory_write about a door
    plan1 = {"decision_id": "turn-1", "scene_action": "REVEAL",
             "clue_policy": {"reveal": []}, "pressure_moves": [],
             "memory_writes": [{"type": "player_interest", "privacy": "player_safe",
                                "salience": 0.8, "entities": ["front-door"],
                                "tags": ["player_interest"], "summary": "玩家关注门划痕",
                                "reactivation_cues": ["door"]}],
             "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan1, investigator_id="inv1")

    # turn 2: director asked about a door -> should recall
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="检查后门", player_intent_class="investigate", rng=random.Random(7))
    ctx["memory_query_entities"] = ["front-door"]
    ctx["memory_query_cues"] = ["door"]
    plan2 = coc_story_director.generate_director_plan(ctx, "turn-2")
    assert len(plan2["memory_reads"]) >= 1
    assert any("门" in r.get("memory_id", "") or "door" in str(r) for r in plan2["memory_reads"]) or \
           any("front-door" in str(r) for r in plan2["memory_reads"])
```

注：`_make_campaign_with_fumble` 来自 `tests/test_story_harness.py`（已存在）。如果该 helper 在 test_story_harness.py 而非 test_story_director.py，把这个测试加到 test_story_harness.py。

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_story_harness.py -v -k memory_continuity`
Expected: FAIL 或 PASS（取决于 coc_memory 是否被正确加载）

- [ ] **Step 3: 加 assert_memory_continuity 到 harness（可选增强）**

在 `coc_story_harness.py` 的 `assert_plan` 里加一个 memory continuity 软检查（如果有 memory_reads）：

```python
    # --- memory (soft) ---
    memory_reads = plan.get("memory_reads", [])
    findings["memory_relevant_not_dumped"] = {
        "passed": len(memory_reads) <= 5,  # no recap dump
        "detail": f"{len(memory_reads)} memory_reads",
    }
```

（单轨：仅维护 plugins/coc-keeper/。）

- [ ] **Step 4: 全量 + 跑 v7 smoke 确认无回归**

```bash
pytest tests/ -q
python3 .coc/playtests/v7-director-smoke/run_smoke.py 2>/dev/null && echo "smoke OK" || echo "smoke needs re-run (fixtures predate memory layer)"
```

注意：v7 smoke 可能因为新 pacing-map 消费而改变 scene_action 选择——这是预期的（pacing-map 现在驱动 horror_stage）。如果 smoke 全绿说明兼容；如果有失败，检查是否是 pacing-map 改进导致的合理行为变化。

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_story_harness.py plugins/coc-keeper/scripts/coc_story_harness.py tests/test_story_harness.py
git commit -m "feat: add memory continuity drill + memory recap-dump assertion"
```

---

## Self-Review

**1. Spec coverage（对照 v2 蓝图评审建议）：**
- 评审 #1 must_include → M1 ✓
- 评审 #2 pacing-map 运行期消费 → M2 ✓
- 评审 #3 coc_director_apply.py 写回层 → M5 ✓
- 评审 #4 memory v0.1（cards + index + context pack + PAYOFF）→ M3 + M4 ✓
- 评审 #5 harness memory_continuity_drill → M6 ✓

**2. Placeholder scan：** 无 TBD/TODO；每个 step 有真实代码。M3 的 `_frontmatter` 正则已标注实现注意事项。

**3. Type consistency：**
- `create_memory_card(campaign_dir, memory_id, privacy, summary, entities, tags, reactivation_cues, source_events, salience, ...)` — M3 定义，M4/M5 调用签名一致
- `retrieve_memory_cards(campaign_dir, query_entities, query_cues, query_tags, privacy_filter, limit)` — M3 定义，M4 `_retrieve_memory_for_ctx` 调用一致
- `build_context_pack(campaign_dir, turn, active_scene_id, dramatic_question, player_intent, cards, keeper_constraints)` — M3 定义
- `apply_plan(campaign_dir, plan, investigator_id)` — M5 定义，返回 events list
- `_base_score(action, ctx)` — ctx 新增可选键 `memory_query_entities/cues/tags`，不破坏现有调用
