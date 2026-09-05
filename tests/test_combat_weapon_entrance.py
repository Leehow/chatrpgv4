"""The Keeper must be able to LEARN a weapon id, not only to be refused one.

Before this suite, `rules.context` family=combat with no fight underway
returned `canonical_context: {"active": false, "combat": null}`, and the
attack card described its `weapon_ref` slot as, verbatim, "weapon ref". The
canonical id appeared in exactly one model-facing place in the whole system:
the text of a REFUSED settle. So the Keeper reached for the display label it
did have. Live on 2026-09-01, lane `c-attack` of
`debug-gate9-depth-10-r65`, against a seeded `.38` revolver labelled
「.38 左轮」:

    unknown_weapon: 'item:38-左轮' is not a catalog, module, or owned custom
    weapon; carrying: revolver_38, revolver_38_or_9mm, unarmed

The refusal is good -- it names the arsenal -- but it arrives after the turn
is already damaged, and `nonretryable_repeat_blocked` then walls off the
retry. `unknown_weapon` recurs 33 times across that run's earlier lanes;
`r61/lanes/m2-reload` shows the same guess in another shape (`revolver-38`
with a hyphen, `item:铁门闩`).

Two things are held here, and the second is what makes the first worth
having:

  1. the owned, RESOLVABLE arsenal is projected into the combat family's
     `canonical_context` -- with the id to copy, not a label to guess; and
  2. it survives BOTH projections between the runtime and the Keeper. A
     field the runtime computes and the projection registry does not declare
     is dropped in silence, and an identity-shaped one collapses the whole
     envelope to `semantic_identity_unavailable`. Asserting on the runtime's
     own return value would prove nothing about what the Keeper sees.

The last test closes the loop the other way: every id the arsenal offers
settles a real attack through `rules.settle`, and the display label that
caused the live failure is still refused.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_mcp_wire  # noqa: E402
import coc_starter  # noqa: E402
import coc_toolbox  # noqa: E402

CONTRACT_DIGEST = "sha256:weapon-entrance-test"

#: A custom weapon the Keeper would naturally call by its label, exactly like
#: the live `item:铁门闩` near-miss in r61. Its canonical id is nothing a
#: model could derive from the label.
DOOR_BAR = {
    "weapon_id": "iron-door-bar",
    "name": "铁门闩",
    "skill": "Fighting (Brawl)",
    "damage": "1D6",
    "adds_damage_bonus": True,
    "impales": False,
}


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], args or {})


def _campaign(tmp_path: Path, campaign_id: str) -> dict:
    workspace = tmp_path / campaign_id
    coc_root = workspace / ".coc"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Weapon Entrance",
    )
    ws = {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
    }
    granted = _run(
        ws,
        "state.item_grant",
        {
            "investigator": ws["investigator_id"],
            "item_id": "iron-door-bar",
            "label": "铁门闩",
            "kind": "weapon",
            "decision_id": "grant-door-bar",
            "weapon": DOOR_BAR,
        },
    )
    assert granted["ok"] is True, granted
    return ws


@pytest.fixture
def campaign_ws(tmp_path: Path):
    return _campaign(tmp_path, "weapon-entrance")


def _combat_context(ws) -> dict:
    envelope = _run(
        ws,
        "rules.context",
        {"investigator": ws["investigator_id"], "family": "combat"},
    )
    assert envelope["ok"] is True, envelope.get("error")
    return envelope


def _projected(envelope: dict) -> dict:
    """What the wire hands the Keeper -- never the runtime's own return."""
    return coc_mcp_wire.project_envelope(
        "rules.context", envelope, contract_digest=CONTRACT_DIGEST,
    )


def _arsenal(ws) -> dict:
    view = _projected(_combat_context(ws))
    canonical = (view.get("data") or {}).get("canonical_context") or {}
    return canonical.get("arsenal") or {}


# --------------------------------------------------------------------------- #
# 1. The block exists at all, on the wire the Keeper actually reads.
# --------------------------------------------------------------------------- #
def test_the_arsenal_reaches_the_keeper_over_the_wire(campaign_ws):
    arsenal = _arsenal(campaign_ws)
    rows = arsenal.get("weapons")
    assert isinstance(rows, list) and rows, (
        "rules.context family=combat carried no arsenal; the Keeper's only "
        f"source for a canonical weapon id is still a refused settle: {arsenal}"
    )
    offered = {row["weapon_ref"] for row in rows}
    assert "revolver_38_or_9mm" in offered, (
        "the sheet weapon labelled '.38 Revolver' must be named by the id the "
        f"settle path takes, not by its label: {rows}"
    )
    assert "iron-door-bar" in offered, offered
    assert "unarmed" in offered, (
        "unarmed is always available and is the one weapon a Keeper reaches "
        f"for when nothing else resolves: {offered}"
    )
    by_ref = {row["weapon_ref"]: row for row in rows}
    assert by_ref["revolver_38_or_9mm"]["name"] == ".38 Revolver", (
        "without the display label the Keeper cannot match the fiction it "
        f"just narrated to an id: {rows}"
    )
    assert by_ref["iron-door-bar"]["name"] == "铁门闩"
    assert by_ref["revolver_38_or_9mm"]["skill"] == "Firearms (Handgun)"
    assert "weapon_ref" in (arsenal.get("note") or ""), (
        "a list of ids with no statement of where they go is a puzzle, not "
        f"an entrance: {arsenal.get('note')!r}"
    )


def test_the_arsenal_is_there_before_the_first_swing(campaign_ws):
    """The whole defect is the timing, not the information.

    A block that only appeared once a fight was underway would still make the
    Keeper guess the id of the attack that STARTS the fight -- which is
    exactly the turn the live lane lost.
    """
    canonical = (
        (_projected(_combat_context(campaign_ws)).get("data") or {})
        .get("canonical_context") or {}
    )
    assert canonical.get("active") is False, canonical
    assert canonical.get("combat") is None, canonical
    assert canonical.get("arsenal", {}).get("weapons"), (
        "with no combat underway the context was the two-key block "
        f"{{'active': False, 'combat': None}} and nothing else: {canonical}"
    )


# --------------------------------------------------------------------------- #
# 2. It survives the projection registry. This is the one that would fail if
#    the field were computed but never declared.
# --------------------------------------------------------------------------- #
PI_PROBE = r"""
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
const root = path.resolve(process.argv[2]);
const { projectModelVisibleCanonicalResult } = await import(path.join(
  root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
));
const { createSemanticIdentityRegistry } = await import(path.join(
  root, "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts",
));
const envelope = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const view = createSemanticIdentityRegistry().projectAll({
  sessionEpoch: 1, campaign: "weapon-entrance", playerTurnEpoch: 1,
});
const diagnostics = { unmapped: [] };
const visible = projectModelVisibleCanonicalResult(
  "rules.context", envelope, view, diagnostics,
);
process.stdout.write(JSON.stringify({
  undeclared: diagnostics.unmapped.map((e) => e.path ?? e.field),
  ok: visible.ok,
  code: visible.error?.code ?? null,
  canonical_context: visible.data?.canonical_context ?? null,
  cards: (visible.data?.cards ?? []).length,
}));
"""


def _pi_projection(tmp_path: Path, envelope: dict) -> dict:
    probe = tmp_path / "weapon-entrance-projection.mjs"
    probe.write_text(PI_PROBE, encoding="utf-8")
    payload = tmp_path / "weapon-entrance-envelope.json"
    payload.write_text(json.dumps(envelope, ensure_ascii=False), encoding="utf-8")
    completed = subprocess.run(
        [
            "node", "--experimental-strip-types", str(probe),
            str(ROOT), str(payload),
        ],
        cwd=ROOT, check=False, capture_output=True, text=True,
    )
    assert completed.returncode == 0, completed.stdout + "\n" + completed.stderr
    return json.loads(completed.stdout)


def test_the_arsenal_survives_the_pi_identity_projection(campaign_ws, tmp_path):
    """`weapon_ref` is identity-named, so silence is not the failure mode.

    `(^|_)(id|ids|ref|refs)$` makes every member of the arsenal an
    identity-bearing field. Undeclared, a string under such a name does not
    merely vanish: it collapses the WHOLE envelope to
    `semantic_identity_unavailable`, and the fix for a Keeper that could not
    see its weapons would have been a Keeper that could not see its cards.
    """
    seen = _pi_projection(tmp_path, _projected(_combat_context(campaign_ws)))
    assert seen["undeclared"] == [], (
        "one undeclared identity field is enough to take the whole result "
        f"with it: {seen['undeclared']}"
    )
    assert seen["ok"] is True and seen["code"] is None, seen
    assert seen["cards"] > 0, "the cards must still reach the Keeper too"
    rows = ((seen["canonical_context"] or {}).get("arsenal") or {}).get("weapons")
    assert rows, f"the arsenal did not survive projection: {seen}"
    offered = {row["weapon_ref"] for row in rows}
    assert {"revolver_38_or_9mm", "iron-door-bar", "unarmed"} <= offered, offered
    assert {row["weapon_ref"] for row in rows if row.get("name") == "铁门闩"} == {
        "iron-door-bar"
    }, (
        "the canonical id must arrive VERBATIM, not rewritten to a registry "
        f"handle the settle slot has no restore path for: {rows}"
    )


# --------------------------------------------------------------------------- #
# 3. Only what combat.resolve would actually accept.
# --------------------------------------------------------------------------- #
def test_an_owned_but_unresolvable_weapon_is_not_offered(campaign_ws):
    """Ownership is not resolvability, and offering one for the other would
    swap one wasted turn for another."""
    inv = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    inventory = state.setdefault("inventory", {"entries": [], "lost_weapon_ids": []})
    inventory.setdefault("entries", []).append({
        "item_id": "broken-pipe",
        "kind": "weapon",
        "label": "Broken pipe",
        # No skill, no damage, not in the catalog: owned and unusable.
        "weapon": {"weapon_id": "broken-pipe"},
    })
    state_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    listed = _run(campaign_ws, "state.inventory_list", {"investigator": inv})
    assert listed["ok"] is True
    assert "broken-pipe" in {row["weapon_id"] for row in listed["data"]["weapons"]}, (
        "the fixture must actually be owned, or this test proves nothing"
    )

    offered = {row["weapon_ref"] for row in _arsenal(campaign_ws)["weapons"]}
    assert "broken-pipe" not in offered, (
        "an owned weapon combat.resolve refuses must not be offered as one "
        f"the Keeper may name: {offered}"
    )
    assert "iron-door-bar" in offered, (
        "the filter must not have thrown out the resolvable custom weapon too"
    )

    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-broken"},
    )
    assert moved["ok"] is True, moved
    refused = _run(campaign_ws, "combat.resolve", {
        "affordance_id": "conventional-assault",
        "investigator": inv,
        "weapon_id": "broken-pipe",
        "decision_id": "combat-broken-pipe",
        "seed": 3,
    })
    assert refused["ok"] is False, (
        "the exclusion above is only correct while combat.resolve really does "
        f"refuse this row; if it now accepts it, the filter is wrong: {refused}"
    )
    assert refused["error"]["code"] == "unknown_weapon", refused["error"]


def test_a_shortened_arsenal_says_so_in_the_block(campaign_ws, monkeypatch):
    """Truncation must be visible, and `warnings` cannot carry it.

    Pi drops canonical warning prose exactly as it drops canonical hints, so
    a warning would be written and never delivered. A Keeper handed a
    silently shortened list reads it as the whole of what the investigator
    carries -- worse than no list, because it looks complete.
    """
    combat_cell = coc_toolbox.OPERATION_MODULES["combat"]
    monkeypatch.setattr(combat_cell, "_ARSENAL_LIMIT", 2)
    arsenal = _arsenal(campaign_ws)
    assert len(arsenal["weapons"]) == 2, arsenal
    assert arsenal["not_listed"] == 1, (
        f"the block must count what it left out: {arsenal}"
    )
    assert "state.inventory_list" in arsenal["note"], (
        f"and name the route to the rest: {arsenal['note']!r}"
    )


# --------------------------------------------------------------------------- #
# 4. The loop closes: what the arsenal offers is what the settle path takes.
# --------------------------------------------------------------------------- #
def _settle_attack(ws, weapon_ref: str) -> dict:
    """One real attack through the Keeper's own route: context, then settle."""
    assert _combat_context(ws)["ok"] is True
    return _run(ws, "rules.settle", {
        "investigator": ws["investigator_id"],
        "decision_ref": "decision:coc7:combat:attack",
        "semantic_inputs": {
            "candidate_ref": "combat-route:conventional-assault",
            "weapon_ref": weapon_ref,
        },
        "decision_id": "attack-weapon-entrance",
        "seed": 9,
    })


@pytest.mark.parametrize(
    "weapon_ref", ["revolver_38_or_9mm", "iron-door-bar", "unarmed"],
)
def test_every_offered_weapon_ref_settles_a_real_attack(tmp_path, weapon_ref):
    """A vocabulary the settle path rejects is worse than no vocabulary."""
    ws = _campaign(tmp_path, f"settles-{weapon_ref.replace('_', '-')}")
    assert weapon_ref in {
        row["weapon_ref"] for row in _arsenal(ws)["weapons"]
    }, "the parametrization must track what the arsenal actually offers"
    moved = _run(ws, "state.move_scene", {
        "scene_id": "corbitt-confrontation", "decision_id": "move-attack",
    })
    assert moved["ok"] is True, moved
    settled = _settle_attack(ws, weapon_ref)
    assert settled["ok"] is True, settled.get("error")


def test_a_display_label_is_still_refused_by_name(tmp_path):
    """The refusal was never the bug -- arriving too late was.

    Keep it exact: the label the Keeper would reach for fails closed, and the
    refusal still names the arsenal, so a Keeper that skipped the context can
    still recover inside the turn.
    """
    ws = _campaign(tmp_path, "label-refused")
    moved = _run(ws, "state.move_scene", {
        "scene_id": "corbitt-confrontation", "decision_id": "move-label",
    })
    assert moved["ok"] is True, moved
    refused = _settle_attack(ws, "item:铁门闩")
    assert refused["ok"] is False, refused
    assert refused["error"]["code"] == "unknown_weapon", refused["error"]
    assert "carrying: " in refused["error"]["message"], refused["error"]


@pytest.mark.parametrize("namespace", ["weapon:", "item:"])
def test_both_published_namespaces_reach_the_same_owned_weapon(
    tmp_path, namespace,
):
    """The smaller bug beside the big one.

    Pi publishes `weapon:` and `item:` side by side as the accepted grammar
    for `weapon_ref` (`RAW_ECHOED_FIELDS`), and
    `coc_inventory.resolve_owned_weapon` matches on `item_id` as well as
    `weapon_id`. But the kernel binding stripped only `weapon:`, so
    `item:<owned id>` reached the gateway with its prefix still attached and
    was refused as an unknown weapon for no reason the Keeper could see or
    correct.
    """
    ws = _campaign(tmp_path, "namespace-" + namespace.strip(":"))
    moved = _run(ws, "state.move_scene", {
        "scene_id": "corbitt-confrontation", "decision_id": "move-ns",
    })
    assert moved["ok"] is True, moved
    settled = _settle_attack(ws, namespace + "iron-door-bar")
    assert settled["ok"] is True, settled.get("error")


# --------------------------------------------------------------------------- #
# 5. Budget. `rules.context` for combat already sat near the inline cap.
# --------------------------------------------------------------------------- #
def test_the_arsenal_does_not_spend_the_transport_budget(campaign_ws):
    view = _projected(_combat_context(campaign_ws))
    total = coc_mcp_wire.transport_bytes(view)
    assert total <= coc_mcp_wire.MAX_INLINE_BYTES, (
        f"combat rules.context is {total} bytes against a "
        f"{coc_mcp_wire.MAX_INLINE_BYTES} cap; over it the Keeper gets an "
        "identity-only envelope instead of cards"
    )
    arsenal = (view["data"]["canonical_context"] or {})["arsenal"]
    cost = coc_mcp_wire.transport_bytes(arsenal)
    assert cost < 1024, (
        "the arsenal is a working set, not a weapon catalogue: "
        f"{cost} bytes for {len(arsenal['weapons'])} weapons"
    )
