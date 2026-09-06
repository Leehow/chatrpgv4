"""Black-box laws for the Director section of the turn capsule (contract §13.3/13.4/13.7).

The Director never writes: it only ever appends a `director` section to the
read-only capsule, computed fresh from state + the previous turn + the
content-team's graphs (`content/director/director-graph.json`,
`content/ontology/system-ontology.json`). Slice 3 (kernel side) is landing
against the same §13 text this file was written from; until it lands, most
of these fail on a missing `director`/`grounded_by`/etc. key -- that is
"not implemented yet", not a law violation. See the worker report for which
is which.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from conftest import RpcClient, campaign_dir, create_campaign, narrate_opening, open_turn, read_json, read_jsonl
from test_rules_families import resolve, walk_to_confrontation

REPO_ROOT = Path(__file__).resolve().parents[2]
ONTOLOGY_PATH = REPO_ROOT / "content" / "ontology" / "system-ontology.json"

BEATS = {"REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE",
         "PAYOFF", "RECOVER", "SUBSYSTEM", "ADVANCE"}

# corbitt-house-ground (content/starters/the-haunting/module-graph.json): no NPCs,
# a dramatic question and pressure_moves like every scene in this module, no
# exit_conditions, four clues -- discovering all four kills REVEAL's and
# CHOICE's undiscovered-clue conditions; having no NPC kills CHARACTER's.
GROUND_FLOOR_CLUES = ["corbitt-diaries", "upstairs-disturbance", "catholic-wards", "nailed-windows"]


# ---- helpers ------------------------------------------------------------------

def snapshot_files(directory: Path) -> dict[str, str]:
    """Relative path -> sha256 for every file under `directory`, so a test can prove
    a read call touched nothing (contract §13: "Director 没有写侧")."""
    out = {}
    for path in sorted(directory.rglob("*")):
        if path.is_file():
            out[str(path.relative_to(directory))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def load_ontology() -> dict:
    return json.loads(ONTOLOGY_PATH.read_text(encoding="utf-8"))


def strip_ruleset_prefix(semantic_id: str) -> str:
    """§11.3's convention for turning a rule-graph semantic id into the short name a
    keeper-facing field uses: 'decision:coc7:magic:cast-spell' -> 'magic:cast-spell',
    'effect:coc7:chase:end-chase-ended' -> 'chase:end-chase-ended'."""
    parts = semantic_id.split(":")
    return ":".join(parts[2:]) if len(parts) > 2 else semantic_id


def grounded_by_universe(ontology: dict) -> set[str]:
    """Every semantic name §13.3's `grounded_by` is allowed to contain: the rule
    decisions any Director scoring-rule/craft-directive is `grounded-by`, plus the
    effects those same decisions `may-emit-effect`. Both the raw ontology
    semantic_id and its ruleset-prefix-stripped form are accepted, since §13.3
    only says "规则决策语义名（如 magic:cast-spell）" -- an example, not a spec for
    exactly how much of the id survives."""
    refs = {r["ref_id"]: r for r in ontology["references"]}
    names: set[str] = set()
    grounded_decision_refs: set[str] = set()
    for rel in ontology["relations"]:
        if rel["relation_kind"] != "grounded-by":
            continue
        target = refs.get(rel["to_ref"])
        if not target:
            continue
        grounded_decision_refs.add(rel["to_ref"])
        names.add(target["semantic_id"])
        names.add(strip_ruleset_prefix(target["semantic_id"]))
    for rel in ontology["relations"]:
        if rel["relation_kind"] != "may-emit-effect" or rel["from_ref"] not in grounded_decision_refs:
            continue
        target = refs.get(rel["to_ref"])
        if not target:
            continue
        names.add(target["semantic_id"])
        names.add(strip_ruleset_prefix(target["semantic_id"]))
    return names


def director_of(client: RpcClient) -> dict:
    capsule = client.table("capsule")
    assert "director" in capsule, "capsule has no `director` section (§13.1) -- slice 3 kernel side not landed yet"
    return capsule["director"]


def discover_ground_floor_with_idle_intent(client: RpcClient) -> None:
    """Move to corbitt-house-ground, discover all four of its clues, and close
    the turn with an explicit idle resolve so next turn's `intent` signal is
    'idle' -- not 'move' (which would itself trip CUT's explicit-move-intent)."""
    open_turn(client, "我们先去看看地面层。")
    client.table("apply", call_id="t1-c1", effects=[
        {"kind": "move", "to": "corbitt-house-ground"},
        *({"kind": "clue", "clue": clue} for clue in GROUND_FLOOR_CLUES),
    ])
    client.table("resolve", call_id="t1-c2", action={"intent": "idle", "goal": "", "method": ""})
    client.table("narrate", call_id="t1-c3", text="地面层已经翻遍了，没有别的动静。")


# ---- (a) no write side ---------------------------------------------------------

def test_capsule_has_no_write_side(kernel):
    open_turn(kernel, "我看看四周。")
    directory = campaign_dir(kernel.workspace)
    before = snapshot_files(directory)
    for _ in range(5):
        kernel.table("capsule")
    after = snapshot_files(directory)
    assert after == before


# ---- (b) determinism ------------------------------------------------------------

def test_director_is_byte_identical_across_repeated_calls(kernel):
    open_turn(kernel, "我环视委托人的办公室。")
    first = kernel.table("capsule")["director"]
    second = kernel.table("capsule")["director"]
    assert json.dumps(first, ensure_ascii=False, sort_keys=True) == json.dumps(second, ensure_ascii=False, sort_keys=True)


def test_director_is_byte_identical_across_processes_for_the_same_state(tmp_path):
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        open_turn(first, "我环视委托人的办公室。")
        director_1 = first.table("capsule")["director"]
    finally:
        first.close()

    second = RpcClient(workspace)
    try:
        director_2 = second.table("capsule")["director"]
    finally:
        second.close()

    assert json.dumps(director_1, ensure_ascii=False, sort_keys=True) == json.dumps(director_2, ensure_ascii=False, sort_keys=True)


# ---- (c) overrides beat scores --------------------------------------------------

def test_live_combat_session_overrides_to_subsystem(seeded_kernel):
    open_turn(seeded_kernel, "我举枪对准棺材里的东西。")
    n = walk_to_confrontation(seeded_kernel)
    resolve(seeded_kernel, f"t1-c{n}", intent="combat", goal="朝科比特开枪", method="用左轮射击",
            target="Walter Corbitt", weapon=".38 Revolver")
    # the attack call already opened the combat session (test_sessions.py).
    assert seeded_kernel.table("look")["where"]["session"]["kind"] == "combat"

    director = director_of(seeded_kernel)
    assert director["beat"] == "SUBSYSTEM"
    assert director.get("override"), "session != none must set director.override (§13.3 third layer)"


# ---- (d) ADVANCE is the default -------------------------------------------------

def test_advance_is_the_default_when_no_rule_fires(kernel):
    discover_ground_floor_with_idle_intent(kernel)
    kernel.table("player_input", text="继续检查地面层，看看还有没有别的动静。")

    director = director_of(kernel)
    assert director["beat"] == "ADVANCE", (
        "expected ADVANCE with every scoring-rule condition false (0 undiscovered clues, "
        "0 agenda NPCs present, idle intent, no exit condition, turns_in_scene<3); got "
        f"{director!r} -- if some other beat won, either a scoring-rule condition this test "
        "didn't account for is true, or an unconditional condition (e.g. a 'baseline' rule "
        "for PRESSURE) is scoring nonzero even with nothing to react to (see report)."
    )
    assert director["grounded_by"] == []
    assert "override" not in director


# ---- (e) grounded_by never fabricates -------------------------------------------

def test_grounded_by_entries_are_registered_ontology_targets(kernel):
    ontology = load_ontology()
    universe = grounded_by_universe(ontology)
    open_turn(kernel, "我仔细观察诺特，问他委托的细节。")
    director = director_of(kernel)
    for name in director["grounded_by"]:
        assert name in universe, (name, sorted(universe))


# ---- (f) scores are bounded and capped at three --------------------------------

def test_scores_are_bounded_and_at_most_three(kernel):
    open_turn(kernel, "我仔细观察诺特，问他委托的细节。")
    director = director_of(kernel)
    scores = director["scores"]
    assert 1 <= len(scores) <= 3
    for beat, value in scores.items():
        assert beat in BEATS
        assert isinstance(value, (int, float))
        assert 0 <= value <= 1.3, (beat, value)
    assert director["beat"] in BEATS


# ---- (g) adoption evidence -------------------------------------------------------

def test_reveal_adoption_true_when_the_listed_clue_is_applied(kernel):
    _setup_investigate_intent_scene(kernel)

    kernel.table("player_input", text="继续在地面层翻找。")
    director = director_of(kernel)
    assert director["beat"] == "REVEAL", director
    reveal = director["reveal"]
    assert reveal, "REVEAL beat must list at least one undiscovered clue (§13.3)"
    clue = reveal[0]["clue"]

    kernel.table("apply", call_id="t3-c1", effects=[{"kind": "clue", "clue": clue}])
    receipts = kernel.table("status")["receipts"]
    clue_receipt = next(r["id"] for r in receipts if r["kind"] == "clue")
    kernel.table("narrate", call_id="t3-c2", text="终于找到了那份记录。")

    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0003.json")
    assert "director_adoption" in record, "narrate must write director_adoption into the turn record (§13.7)"
    adoption = record["director_adoption"]
    assert adoption["beat"] == "REVEAL"
    assert adoption["adopted"] is True
    assert clue_receipt in adoption["evidence"]


def test_reveal_adoption_false_when_the_turn_only_narrates(kernel):
    _setup_investigate_intent_scene(kernel)
    kernel.table("player_input", text="继续在地面层翻找。")
    director = director_of(kernel)
    assert director["beat"] == "REVEAL", director

    kernel.table("narrate", call_id="t3-c1", text="这一轮什么都没找到。")

    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0003.json")
    assert "director_adoption" in record
    adoption = record["director_adoption"]
    assert adoption["beat"] == "REVEAL"
    assert adoption["adopted"] is False


def _setup_investigate_intent_scene(client: RpcClient) -> None:
    """Move to corbitt-house-ground (no NPC, so CHARACTER can't compete) and leave
    its four clues undiscovered, but set last turn's intent to 'investigate' via
    a real resolve -- so REVEAL's `investigate-intent` condition (undiscovered_here
    > 0 and intent in {investigate, social}) is the one live scoring-rule
    condition. This must be called on a fresh, just-opened turn 1."""
    open_turn(client, "我们先去看看地面层。")
    client.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "corbitt-house-ground"}])
    client.table("narrate", call_id="t1-c2", text="地面层空空荡荡。")
    client.table("player_input", text="仔细搜索地面层。")
    client.table("resolve", call_id="t2-c1", action={"intent": "investigate", "goal": "搜索地面层",
                                                      "method": "用侦查", "skill": "Spot Hidden"})
    client.table("narrate", call_id="t2-c2", text="你翻了个遍，但天色已经暗了下来，什么都没找全。")
