"""Byte-budget laws for the nine-section turn capsule (contract §13.1, §13.6).

Every section (plus `recent`/`warnings`) has a byte budget on
`json.dumps(section, ensure_ascii=False)`; `head` and `turn` are exempt.
`truncated` must name every section that got cut and nothing else. `style`
gets a bigger budget on the first capsule a fresh process ever hands out,
and the normal budget after that.

Slice 3 (kernel side) is landing against the same §13 text this file was
written from; sections it hasn't added yet (`pressures`, `obligations`,
`director`, `situations`, `style`, `head`) simply won't be present in the
capsule -- see the worker report for what's "not implemented yet" versus
an actual budget violation.
"""
from __future__ import annotations

import json

from conftest import narrate, CAMPAIGN, PREGEN, RpcClient, campaign_dir, open_turn, read_json

INVESTIGATOR = "托马斯·海斯"

#: contract §13.1's byte budgets, by section name.
SECTION_BUDGETS = {
    "where": 4096, "present": 3072, "known": 3072, "pressures": 1024,
    "obligations": 1024, "director": 3072, "situations": 1024,
    "memory": 1536, "recent": 2048, "warnings": 1024,
    "voices": 3072,  # §40.7: the masks and exchanges of everyone present
}
#: §13.6: the process's first capsule gets every craft directive (2KB); every
#: capsule after that only gets the ones picked for the beat (1KB).
STYLE_BUDGET_FIRST_TURN = 2048
STYLE_BUDGET_LATER = 1536  # the four floor lines ride along (turn floor)

#: every scene in the-haunting, in an order where each is reachable from the
#: one before it (content/starters/the-haunting/module-graph.json route-to
#: edges), paired with its own clues -- walking the whole thing and
#: discovering everything along the way is what makes `known`, `where` and
#: `present` genuinely rich (all 39 clues, every scene's own affordances).
WALK = [
    ("commission-briefing", ["knott-commission", "knott-research-leads", "knott-macario-summary", "knott-keys"]),
    ("chapel-of-contemplation-ruins", ["chapel-eye-symbol", "chapel-cellar-remains", "chapel-journal-burial",
                                       "liber-ivonis-tome"]),
    ("higher-courts-central-police", ["police-raid-chapel"]),
    ("hall-of-records", ["will-executor-chapel", "chapel-closed-1912"]),
    ("central-library", ["house-built-1835", "neighbor-lawsuit-1852", "basement-burial-lawsuit",
                         "second-lawsuit-outcome-unrecorded"]),
    ("newspaper-morgue", ["globe-unpublished-story", "macario-tragedy", "globe-fire-cutoff"]),
    ("neighborhood-gossip", ["dooley-macario-madness", "burning-eyes-form", "chapel-ruins-location"]),
    ("previous-tenants", ["vittorio-bible-weapon", "gabriela-night-visitor", "boys-burning-eyes"]),
    ("corbitt-house-ground", ["corbitt-diaries", "upstairs-disturbance", "catholic-wards", "nailed-windows"]),
    ("upper-floor-bedroom", ["poltergeist-bed", "blood-pool-manifest", "mythos-reek"]),
    ("basement-rites", ["rusted-basement-dagger", "floating-knife", "hollow-boards", "corbitt-body-found",
                        "ritual-dagger-is-his"]),
    ("corbitt-confrontation", ["corbitt-animates", "own-dagger-ends-him", "flesh-ward-active"]),
]


def size(payload) -> int:
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def discover_everything_effects() -> list[dict]:
    effects: list[dict] = []
    for i, (scene, clues) in enumerate(WALK):
        if i > 0:
            effects.append({"kind": "move", "to": scene})
        effects.extend({"kind": "clue", "clue": clue} for clue in clues)
    return effects


def build_rich_state(client: RpcClient) -> None:
    """Every scene visited and all 39 clues discovered (stresses `where`,
    `present`, `known`), a live combat session (`pressures`/`obligations`/
    `situations`/the third-layer override), nine long memory candidates
    (`memory`), and ten long verifier findings (`warnings`) -- one rich
    turn, closed once."""
    open_turn(client, "我们把整栋房子翻了个底朝天，最后冲向地下室对峙科比特。")
    client.table("apply", call_id="t1-c1", effects=discover_everything_effects())
    client.table("resolve", call_id="t1-c2", action={
        "intent": "combat", "goal": "冲上去和科比特对决", "method": "举枪射击",
        "target": "Walter Corbitt", "weapon": ".38 Revolver"})
    narrated = narrate(client, "t1-c3", "故事的每一条线索都被翻了出来，科比特应声而起。" * 3)
    job_id = narrated["extraction"]["job_id"]
    long_statement = "科比特" + "的事情说来话长，笔记写得密密麻麻，" * 20  # under the 400-char cap, still ~290 chars
    client.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": job_id, "candidates": [
        {"kind": "knowledge", "subject": "Walter Corbitt", "entities": [INVESTIGATOR],
         "statement": f"{i}{long_statement}"} for i in range(9)
    ]})
    quote = narrated["rendered_text"][:100]
    client.ok("table.warn", {"campaign": CAMPAIGN, "turn": 1, "lane": "verifier", "findings": [
        {"kind": "reveal", "quote": quote, "why": "理由说明文字" * 90} for _ in range(10)
    ]})


def test_every_section_stays_within_its_budget_on_a_rich_state(kernel):
    build_rich_state(kernel)
    capsule = kernel.table("player_input", text="继续。")["capsule"]

    missing = [name for name in SECTION_BUDGETS if name not in capsule]
    for name, budget in SECTION_BUDGETS.items():
        if name in missing:
            continue
        assert size(capsule[name]) <= budget, (name, size(capsule[name]), budget)

    truncated = capsule.get("truncated", [])
    valid_names = set(SECTION_BUDGETS) | {"style", "module"}  # #22: the first-turn briefing has its own 2KB
    assert set(truncated) <= valid_names, truncated
    # every truncated name must actually be a key the capsule carries.
    assert set(truncated) <= set(capsule), truncated
    # nine ~900-char candidates cannot fit in memory's 1536-byte budget, nor
    # ten ~460-char findings in warnings' 1024 bytes -- both must be cut.
    if "memory" not in missing:
        assert "memory" in truncated
    if "warnings" not in missing:
        assert "warnings" in truncated
    # checked last so a real budget/truncation violation above is reported on
    # its own merits, distinct from "this slice hasn't added the section yet".
    assert not missing, f"capsule is missing sections (not implemented yet in this slice): {missing}"


def test_head_and_turn_are_excluded_from_the_budget_and_from_truncated(kernel):
    build_rich_state(kernel)
    capsule = kernel.table("player_input", text="继续。")["capsule"]
    truncated = capsule.get("truncated", [])
    assert "turn" not in truncated
    assert "head" not in truncated
    # `turn` is always present (§6); no size assertion applies to it or to `head`.
    assert "turn" in capsule


def test_style_budget_is_larger_on_the_first_capsule_of_a_fresh_process(tmp_path):
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        build_rich_state(first)
        first_capsule = first.table("player_input", text="继续。")["capsule"]
        assert "style" in first_capsule, "capsule has no `style` section (§13.6) -- not implemented yet in this slice"
        assert size(first_capsule["style"]) <= STYLE_BUDGET_FIRST_TURN
        # a second capsule in the *same* process (not the process's first
        # anymore) must already be held to the smaller, later budget.
        second_capsule = first.table("capsule")
        assert size(second_capsule["style"]) <= STYLE_BUDGET_LATER
    finally:
        first.close()


def test_style_budget_is_the_smaller_one_in_a_later_turn(kernel):
    build_rich_state(kernel)
    kernel.table("player_input", text="继续搜查。")
    narrate(kernel, "t2-c1", "一无所获。")
    later_capsule = kernel.table("player_input", text="再搜一次。")["capsule"]
    assert "style" in later_capsule, "capsule has no `style` section (§13.6) -- not implemented yet in this slice"
    assert size(later_capsule["style"]) <= STYLE_BUDGET_LATER
