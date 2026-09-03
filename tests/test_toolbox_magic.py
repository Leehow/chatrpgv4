"""Behavior tests owned by the magic operation cell.

Both defects these cover were invisible to unit tests that fed a consumer a
hand-built dict: ``magic.learn`` returned ok while investigator-state never
moved, and ``magic.learn.sources`` was built only from NPC rows, so a tome
could never be a source. Everything below therefore enters through the real
tool and asserts on persisted state or on what the live fact provider hands
the card projection.
"""
from toolbox_test_support import *

coc_magic = _load("coc_magic_for_toolbox_magic", SCRIPTS / "coc_magic.py")
coc_rulesets = _load("coc_rulesets_for_toolbox_magic", SCRIPTS / "coc_rulesets.py")
coc_rules = _load("coc_rules_for_toolbox_magic", SCRIPTS / "coc_rules.py")
coc_mcp_wire = _load("coc_mcp_wire_for_toolbox_magic", SCRIPTS / "coc_mcp_wire.py")
pi_coc_debug_experiment = _load(
    "pi_coc_debug_experiment_for_toolbox_magic",
    REPO / "plugins" / "coc-keeper" / "pi" / "bin" / "pi_coc_debug_experiment.py",
)

SPELL = "Contact Spells"

#: What ``npc-walter-corbitt``'s mechanics profile has always called The
#: Haunting's own spell, and what the module now records as an alias of the
#: node it refers to.
MODULE_SHORTHAND = "Dominate (variant)"
#: The node's own name -- what everything downstream must settle on.
MODULE_SPELL = "Dominate (Corbitt's variant)"
MODULE_NODE_ID = "spell-dominate-corbitt-variant"

CONTRACT_DIGEST = "sha256:module-authored-spells-test"


def _projected(operation: str, envelope: dict) -> dict:
    """What the wire hands the Keeper -- never the runtime's own return."""
    return coc_mcp_wire.project_envelope(
        operation, envelope, contract_digest=CONTRACT_DIGEST,
    )


def _appoint_teacher(ws, npc_id: str, source_kind: str, spells: list[str]) -> None:
    """Appoint a teacher through the diagnostic lane's own seeding function.

    No shipped module marks any NPC teachable, so this is the only way the
    learn gate opens at all; it writes into the campaign's own
    ``scenario/npc-agendas.json``, the file ``Ctx.npc_agendas`` reads.
    """
    pi_coc_debug_experiment._appoint_spell_teachers(ws["campaign_dir"], [{
        "npc_id": npc_id, "source_kind": source_kind, "spells": list(spells),
    }])


def _learning_seed(int_value: int, *, succeeds: bool) -> int:
    """First seed whose INT(hard) draw lands the way the test needs.

    magic.learn draws the learning check off ``random.Random(seed)`` before it
    rolls study length, so probing the same check with the same seed picks the
    outcome without hand-writing a roll result.
    """
    for seed in range(1, 2000):
        probe = coc_magic.coc_roll.percentile_check(
            int_value, difficulty="hard", rng=random.Random(seed)
        )
        if bool(probe["roll"] <= probe["effective_target"]) is succeeds:
            return seed
    raise AssertionError("no seed produced the requested learning outcome")


def _magic_state(ws) -> dict:
    path = (
        ws["campaign_dir"] / "save" / "investigator-state"
        / f"{ws['investigator_id']}.json"
    )
    return json.loads(path.read_text(encoding="utf-8")).get("magic") or {}


def _live_facts(ws) -> dict:
    """Facts exactly as the card projection receives them."""
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(ws["workspace"], ws["campaign_id"])
    provider = kernel._facts_provider_for(ctx, ws["investigator_id"], "coc7")
    return dict(provider())


def _augmented(ws, semantic_inputs: dict) -> dict:
    """Live facts run through the coc7 adapter that owns the magic gates."""
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(ws["workspace"], ws["campaign_id"])
    adapter = coc_rulesets.get_rule_graph_adapter("coc7")
    return dict(adapter.augment_facts(
        ctx, {"semantic_inputs": semantic_inputs}, _live_facts(ws)
    ))


def _author_tome_item(ws, item_id: str, spells: list[str]) -> None:
    """Record an authored tome in the campaign's own module-meta item slot.

    This is the slot ``mechanics.ensure`` and ``state.item_grant`` already read
    item mechanics from; a tome's spell list belongs there because the reviewed
    CoC7 tome catalogue prints study weeks, Sanity cost and Mythos rating and
    no spell lists.
    """
    path = ws["campaign_dir"] / "scenario" / "module-meta.json"
    meta = json.loads(path.read_text(encoding="utf-8"))
    mechanics = meta.setdefault("module_mechanics", {"schema_version": 1, "items": {}})
    mechanics.setdefault("items", {})[item_id] = {
        "item_id": item_id,
        "label": "Corbitt's notes",
        "origin": "source",
        "mechanics": {
            "status": "authored",
            "profile": {
                "profile_kind": "tome",
                "name": "Corbitt's notes",
                "spells": list(spells),
                "authority": "source_authored",
            },
            "source_refs": [{"source_id": "the-haunting", "pdf_index": 453}],
        },
    }
    _write_json(path, meta)


# --------------------------------------------------------------------------- #
# magic.learn must move persisted state, and the study must actually complete
# --------------------------------------------------------------------------- #
def test_magic_learn_from_a_tome_moves_state_and_completes_on_the_clock(campaign_ws):
    seed = _learning_seed(70, succeeds=True)
    settled = _run(campaign_ws, "magic.learn", {
        "spell": SPELL,
        "source": "tome",
        "decision_id": "magic-learn:tome:1",
        "seed": seed,
    })
    assert settled["ok"] is True, settled
    result = settled["data"]["receipt"]["result"]
    assert result["learned"] is True
    trigger_id = result["completion_trigger_id"]
    assert trigger_id

    # p.176-177: the spell is not known yet, but the settled write must be
    # visible in persisted state — an ok receipt over an unchanged file is how
    # every consumer downstream came to believe a write had happened.
    magic = _magic_state(campaign_ws)
    assert magic["learned_spells"] == []
    assert [row["spell"] for row in magic["studying_spells"]] == [SPELL]
    study = magic["studying_spells"][0]
    assert study["trigger_id"] == trigger_id
    assert study["study_weeks"] == result["study_weeks"]
    assert study["due_elapsed_minutes"] == result["study_completion_elapsed_minutes"]
    assert _live_facts(campaign_ws)["magic.known_spells"] == []

    # The study completes on the in-fiction clock, through the ordinary
    # time-advance operation a Keeper would call.
    advanced = _run(campaign_ws, "state.advance_time", {
        "minutes": int(result["study_days"]) * 24 * 60 + 60,
        "reason": "the investigator spends the weeks studying the tome",
        "decision_id": "magic-learn:tome:1:study",
    })
    assert advanced["ok"] is True, advanced

    magic_after = _magic_state(campaign_ws)
    assert magic_after["learned_spells"] == [SPELL]
    assert magic_after["studying_spells"] == []
    assert _live_facts(campaign_ws)["magic.known_spells"] == [SPELL]


def test_cast_spell_gate_opens_only_once_the_studied_spell_is_known(campaign_ws):
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    inputs = {"spell": SPELL}

    assert _augmented(campaign_ws, inputs)["magic.spell.known"] is False
    with pytest.raises(kernel.ToolError) as unknown:
        kernel._canonical_magic_binding(
            ctx,
            investigator_id=campaign_ws["investigator_id"],
            decision_ref="decision:coc7:magic:cast-spell",
            semantic_inputs=inputs,
        )
    assert unknown.value.code == "magic_spell_not_known"

    settled = _run(campaign_ws, "magic.learn", {
        "spell": SPELL,
        "source": "tome",
        "decision_id": "magic-learn:tome:cast-gate",
        "seed": _learning_seed(70, succeeds=True),
    })
    assert settled["ok"] is True, settled
    study_days = int(settled["data"]["receipt"]["result"]["study_days"])
    assert _run(campaign_ws, "state.advance_time", {
        "minutes": study_days * 24 * 60 + 60,
        "reason": "the study period passes",
        "decision_id": "magic-learn:tome:cast-gate:study",
    })["ok"] is True

    assert _augmented(campaign_ws, inputs)["magic.spell.known"] is True
    bound = kernel._canonical_magic_binding(
        kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"]),
        investigator_id=campaign_ws["investigator_id"],
        decision_ref="decision:coc7:magic:cast-spell",
        semantic_inputs=inputs,
    )
    assert bound["known_spell_ref"].startswith(
        f"learned-spell:{campaign_ws['investigator_id']}:"
    )


def test_a_failed_learning_check_leaves_no_study_behind(campaign_ws):
    settled = _run(campaign_ws, "magic.learn", {
        "spell": SPELL,
        "source": "tome",
        "decision_id": "magic-learn:tome:failed",
        "seed": _learning_seed(70, succeeds=False),
    })
    assert settled["ok"] is True, settled
    assert settled["data"]["receipt"]["result"]["learned"] is False
    magic = _magic_state(campaign_ws)
    assert magic["learned_spells"] == []
    assert magic["studying_spells"] == []


# --------------------------------------------------------------------------- #
# A tome can be a spell source — from authored item mechanics, not from a label
# --------------------------------------------------------------------------- #
def test_an_authored_tome_is_a_learnable_source(campaign_ws):
    _author_tome_item(campaign_ws, "tome-corbitt-notes", [SPELL])
    facts = _live_facts(campaign_ws)
    assert facts["magic.learn.sources"]["tome:tome-corbitt-notes"] == [SPELL]

    inputs = {
        "spell": SPELL,
        "source": "tome",
        "source_ref": "tome:tome-corbitt-notes",
    }
    assert _augmented(campaign_ws, inputs)["magic.learn.source-available"] is True

    kernel = coc_toolbox.coc_operation_kernel
    bound = kernel._canonical_magic_binding(
        kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"]),
        investigator_id=campaign_ws["investigator_id"],
        decision_ref="decision:coc7:magic:learn-spell",
        semantic_inputs=inputs,
    )
    assert bound["investigator"] == campaign_ws["investigator_id"]


def test_an_authored_tome_does_not_teach_a_spell_it_does_not_hold(campaign_ws):
    _author_tome_item(campaign_ws, "tome-corbitt-notes", ["Contact Ghoul"])
    inputs = {
        "spell": SPELL,
        "source": "tome",
        "source_ref": "tome:tome-corbitt-notes",
    }
    assert _augmented(campaign_ws, inputs)["magic.learn.source-available"] is False
    kernel = coc_toolbox.coc_operation_kernel
    with pytest.raises(kernel.ToolError) as refused:
        kernel._canonical_magic_binding(
            kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"]),
            investigator_id=campaign_ws["investigator_id"],
            decision_ref="decision:coc7:magic:learn-spell",
            semantic_inputs=inputs,
        )
    assert refused.value.code == "magic_source_invalid"
    assert refused.value.details["available_source_refs"] == [
        "tome:tome-corbitt-notes"
    ]


def test_carrying_a_tome_is_possession_not_a_spell_source(campaign_ws):
    """A grant records who holds the object, never what is written in it."""
    granted = _run(campaign_ws, "state.item_grant", {
        "kind": "gear",
        "label": "Corbitt's notes",
        "item_id": "tome-corbitt-notes",
        "note": "found in the library",
        "decision_id": "item-grant:tome-corbitt-notes",
    })
    assert granted["ok"] is True, granted

    facts = _live_facts(campaign_ws)
    assert [key for key in facts["magic.learn.sources"] if key.startswith("tome:")] == []
    inputs = {
        "spell": SPELL,
        "source": "tome",
        "source_ref": "tome:tome-corbitt-notes",
    }
    assert _augmented(campaign_ws, inputs)["magic.learn.source-available"] is False


# --------------------------------------------------------------------------- #
# The whole family, through the production rules.context -> rules.settle path
# --------------------------------------------------------------------------- #
def _settled_result(settled: dict) -> dict:
    """The subsystem receipt a graph settlement carries."""
    return settled["data"]["settlement"]["result"]["receipt"]["result"]


def _magic_cards(ws, semantic_inputs: dict) -> dict:
    held = _run(ws, "rules.context", {
        "family": "magic",
        "investigator": ws["investigator_id"],
        "semantic_inputs": semantic_inputs,
    })
    assert held["ok"] is True, held
    return {
        card["decision_ref"]: card
        for card in (held["data"].get("cards") or [])
    }


def test_the_magic_family_settles_learn_then_cast_through_the_graph(campaign_ws):
    _author_tome_item(campaign_ws, "tome-corbitt-notes", [SPELL])
    learn_inputs = {
        "spell": SPELL,
        "source": "tome",
        "source_ref": "tome:tome-corbitt-notes",
    }

    cards = _magic_cards(campaign_ws, learn_inputs)
    learn_card = cards["decision:coc7:magic:learn-spell"]
    assert learn_card["applicability"] == "applicable", learn_card
    assert (
        cards.get("decision:coc7:magic:cast-spell", {}).get("applicability")
        != "applicable"
    )

    settled = _run(campaign_ws, "rules.settle", {
        "decision_ref": "decision:coc7:magic:learn-spell",
        "decision_id": "graph-magic-learn-0001",
        "investigator": campaign_ws["investigator_id"],
        "seed": _learning_seed(70, succeeds=True),
        "semantic_inputs": learn_inputs,
    })
    assert settled["ok"] is True, settled
    assert _settled_result(settled)["learned"] is True

    magic = _magic_state(campaign_ws)
    assert [row["spell"] for row in magic["studying_spells"]] == [SPELL]
    assert _run(campaign_ws, "state.advance_time", {
        "minutes": int(magic["studying_spells"][0]["study_days"]) * 24 * 60 + 60,
        "reason": "the study period passes",
        "decision_id": "graph-magic-learn-0001:study",
    })["ok"] is True
    assert _magic_state(campaign_ws)["learned_spells"] == [SPELL]

    cast_inputs = {"spell": SPELL, "pushed": False, "interrupted": False}
    cast_card = _magic_cards(campaign_ws, cast_inputs)[
        "decision:coc7:magic:cast-spell"
    ]
    assert cast_card["applicability"] == "applicable", cast_card
    cast = _run(campaign_ws, "rules.settle", {
        "decision_ref": "decision:coc7:magic:cast-spell",
        "decision_id": "graph-magic-cast-0001",
        "investigator": campaign_ws["investigator_id"],
        "seed": 3,
        "semantic_inputs": cast_inputs,
    })
    assert cast["ok"] is True, cast
    # The cast itself is a POW(hard) check like any other; what this pins is
    # that the settlement reached the runtime and its bookkeeping matches its
    # own roll rather than settling into nothing.
    cast_result = _settled_result(cast)
    assert cast_result["spell"] == SPELL
    assert _magic_state(campaign_ws)["cast_spells"] == (
        [SPELL] if cast_result["success"] else []
    )


def test_graph_settle_refuses_a_tome_the_campaign_never_authored(campaign_ws):
    """The live-lane refusal, verbatim, for a tome no module ever wrote down.

    The same call with an authored tome settles (above): what the gate reads
    is whether the campaign's own data says this book holds this spell.
    """
    inputs = {
        "spell": SPELL,
        "source": "tome",
        "source_ref": "tome:tome-corbitt-notes",
    }
    assert "decision:coc7:magic:learn-spell" not in {
        ref for ref, card in _magic_cards(campaign_ws, inputs).items()
        if card["applicability"] == "applicable"
    }
    settled = _run(campaign_ws, "rules.settle", {
        "decision_ref": "decision:coc7:magic:learn-spell",
        "decision_id": "graph-magic-learn-unauthored",
        "investigator": campaign_ws["investigator_id"],
        "semantic_inputs": inputs,
    })
    assert settled["ok"] is False
    assert settled["error"]["code"] == "rule_decision_stale"
    assert "magic.learn.source-available" in settled["error"]["message"]
    assert _magic_state(campaign_ws).get("studying_spells", []) == []


def test_learn_source_gate_and_settle_binding_read_the_same_map(campaign_ws):
    """The card's gate and the operation behind it cannot disagree."""
    _author_tome_item(campaign_ws, "tome-corbitt-notes", [SPELL])
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    assert (
        _live_facts(campaign_ws)["magic.learn.sources"]
        == kernel._magic_learning_sources(ctx)
    )


# --------------------------------------------------------------------------- #
# A parameterised Summon/Bind name is one spell family bound to one creature
# --------------------------------------------------------------------------- #
#: What the-haunting authors on npc-walter-corbitt. No spells.json row is
#: titled this; CoC7 prints the family once and leaves the creature in the name.
PARAMETERISED = "Summon/Bind Dimensional Shambler"


def test_magic_learn_accepts_the_name_content_authors_and_persists_the_creature(
    campaign_ws,
):
    """The parameterised name is what goes into ``learned_spells``.

    The family name would say the investigator can summon *something*; the
    module says which. So the canonical name persisted is the family stem over
    the catalogue's creature, and the receipt says out loud which catalogue row
    priced it.
    """
    _author_tome_item(campaign_ws, "tome-corbitt-notes", [PARAMETERISED])
    settled = _run(campaign_ws, "magic.learn", {
        "spell": PARAMETERISED,
        "source": "tome",
        "decision_id": "magic-learn:summon-bind:1",
        "seed": _learning_seed(70, succeeds=True),
    })
    assert settled["ok"] is True, settled
    receipt = settled["data"]["receipt"]
    assert receipt["result"]["learned"] is True

    # The receipt is unambiguous about all three names at once.
    assert receipt["spell"]["canonical_name"] == PARAMETERISED
    assert receipt["spell"]["catalog_entry_name"] == "Summon/Bind Spells"
    assert receipt["spell"]["parameterisation"]["parameter"] == {
        "kind": "creature",
        "entity_id": "dimensional_shambler",
        "name": "Dimensional Shambler",
    }

    magic = _magic_state(campaign_ws)
    assert [row["spell"] for row in magic["studying_spells"]] == [PARAMETERISED]
    assert _run(campaign_ws, "state.advance_time", {
        "minutes": int(magic["studying_spells"][0]["study_days"]) * 24 * 60 + 60,
        "reason": "the study period passes",
        "decision_id": "magic-learn:summon-bind:1:study",
    })["ok"] is True
    assert _magic_state(campaign_ws)["learned_spells"] == [PARAMETERISED]
    assert _live_facts(campaign_ws)["magic.known_spells"] == [PARAMETERISED]


def test_a_creature_the_catalogue_never_carries_is_refused_not_invented(campaign_ws):
    """A parameter with no catalogue creature row is a content gap, not a spell."""
    _author_tome_item(campaign_ws, "tome-corbitt-notes", ["Summon/Bind Gug"])
    settled = _run(campaign_ws, "magic.learn", {
        "spell": "Summon/Bind Gug",
        "source": "tome",
        "decision_id": "magic-learn:summon-bind:gug",
        "seed": 5,
    })
    assert settled["ok"] is False
    assert "unknown spell" in settled["error"]["message"]
    assert _magic_state(campaign_ws).get("studying_spells", []) == []


def test_the_parameterised_family_settles_learn_then_cast_through_the_graph(
    campaign_ws,
):
    """The defect one layer along: learnable but never castable.

    Every gate on the way — the learn card's source-available fact, the
    settle-time binding, ``magic.spell.known``, and the cast itself — has to
    read the same name, or a spell that can be learned refuses to be cast.
    """
    _author_tome_item(campaign_ws, "tome-corbitt-notes", [PARAMETERISED])
    learn_inputs = {
        "spell": PARAMETERISED,
        "source": "tome",
        "source_ref": "tome:tome-corbitt-notes",
    }
    assert _augmented(campaign_ws, learn_inputs)["magic.learn.source-available"] is True
    learn_card = _magic_cards(campaign_ws, learn_inputs)[
        "decision:coc7:magic:learn-spell"
    ]
    assert learn_card["applicability"] == "applicable", learn_card

    settled = _run(campaign_ws, "rules.settle", {
        "decision_ref": "decision:coc7:magic:learn-spell",
        "decision_id": "graph-magic-summon-bind-learn",
        "investigator": campaign_ws["investigator_id"],
        "seed": _learning_seed(70, succeeds=True),
        "semantic_inputs": learn_inputs,
    })
    assert settled["ok"] is True, settled
    assert _settled_result(settled)["learned"] is True

    magic = _magic_state(campaign_ws)
    assert _run(campaign_ws, "state.advance_time", {
        "minutes": int(magic["studying_spells"][0]["study_days"]) * 24 * 60 + 60,
        "reason": "the study period passes",
        "decision_id": "graph-magic-summon-bind-learn:study",
    })["ok"] is True

    cast_inputs = {"spell": PARAMETERISED, "pushed": False, "interrupted": False}
    assert _augmented(campaign_ws, cast_inputs)["magic.spell.known"] is True
    cast_card = _magic_cards(campaign_ws, cast_inputs)[
        "decision:coc7:magic:cast-spell"
    ]
    assert cast_card["applicability"] == "applicable", cast_card
    cast = _run(campaign_ws, "rules.settle", {
        "decision_ref": "decision:coc7:magic:cast-spell",
        "decision_id": "graph-magic-summon-bind-cast",
        "investigator": campaign_ws["investigator_id"],
        "seed": 3,
        "semantic_inputs": cast_inputs,
    })
    assert cast["ok"] is True, cast
    cast_result = _settled_result(cast)
    assert cast_result["spell"] == PARAMETERISED
    # The parameterised name has no row of its own, so the cast can only have
    # been priced from the family row the rulebook prints on p.255.
    assert coc_rules.spell_by_name(PARAMETERISED)["source_page"] == 255
    assert _magic_state(campaign_ws)["cast_spells"] == (
        [PARAMETERISED] if cast_result["success"] else []
    )


def test_the_rulebooks_alternative_family_name_is_the_same_learned_spell(campaign_ws):
    """"Summoning Byakhee" and "Summon/Bind Byakhee" are one spell, not two."""
    _author_tome_item(campaign_ws, "tome-corbitt-notes", ["Summoning Byakhee"])
    settled = _run(campaign_ws, "magic.learn", {
        "spell": "Summoning Byakhee",
        "source": "entity",
        "decision_id": "magic-learn:summoning-byakhee",
        "seed": _learning_seed(70, succeeds=True),
    })
    assert settled["ok"] is True, settled
    assert settled["data"]["receipt"]["spell"]["canonical_name"] == (
        "Summon/Bind Byakhee"
    )
    assert _magic_state(campaign_ws)["learned_spells"] == ["Summon/Bind Byakhee"]
    # Either spelling reads as known, and the authored tome still teaches it.
    for spelling in ("Summoning Byakhee", "Summon/Bind Byakhee"):
        facts = _augmented(campaign_ws, {"spell": spelling})
        assert facts["magic.spell.known"] is True, spelling
        available = _augmented(campaign_ws, {
            "spell": spelling,
            "source": "tome",
            "source_ref": "tome:tome-corbitt-notes",
        })
        assert available["magic.learn.source-available"] is True, spelling

    # ...and the settle-time binding agrees with the card that showed it: a
    # spelling the fact calls known must not be refused as unknown one layer
    # along, which is the same defect displaced rather than fixed.
    for index, spelling in enumerate(("Summoning Byakhee", "Summon/Bind Byakhee")):
        cast_inputs = {"spell": spelling, "pushed": False, "interrupted": False}
        card = _magic_cards(campaign_ws, cast_inputs)[
            "decision:coc7:magic:cast-spell"
        ]
        assert card["applicability"] == "applicable", (spelling, card)
        cast = _run(campaign_ws, "rules.settle", {
            "decision_ref": "decision:coc7:magic:cast-spell",
            "decision_id": f"graph-magic-byakhee-cast-{index}",
            "investigator": campaign_ws["investigator_id"],
            "seed": 3 + index,
            "semantic_inputs": cast_inputs,
        })
        assert cast["ok"] is True, (spelling, cast)
        assert _settled_result(cast)["spell"] == "Summon/Bind Byakhee"


# --------------------------------------------------------------------------- #
# The module's own spell namespace, through the tools that must see it
# --------------------------------------------------------------------------- #
def test_the_module_authored_spell_is_reachable_through_catalog_search(campaign_ws):
    """The wiring, not the function.

    ``coc_catalog`` can merge a module namespace, but only if the operation
    hands it one. Before this, ``rules.catalog_search`` passed no module
    records at all, so the Keeper's one entrance to spell names could not name
    The Haunting's own spell under either string.
    """
    found = _run(campaign_ws, "rules.catalog_search", {
        "query": MODULE_SHORTHAND, "kinds": ["spell"],
    })
    assert found["ok"] is True, found
    ids = [row["entity_id"] for row in found["data"]["candidates"]]
    assert ids == [MODULE_NODE_ID]

    row = found["data"]["candidates"][0]
    assert row["name"] == MODULE_SPELL
    block = row["module_authored"]
    assert block["authority"] == "module_authored_spell"
    assert block["module_id"] == "module-the-haunting"
    assert block["properties"]["target_scope"] == "inside the Corbitt House"
    # Keeper-only, and therefore on the surface's existing no-print rule.
    assert row["secret"] is True and found["data"]["secret"] is True

    # The Keeper is told it is the module's spell and that it is unpriced.
    hints = " ".join(found["hints"])
    assert MODULE_NODE_ID in hints
    assert "not a rulebook row" in hints
    assert "unpriced is not free" in hints.casefold()

    # It survives the wire; a field the runtime computes and the projection
    # drops would be invisible to the Keeper who has to act on it.
    view = _projected("rules.catalog_search", found)
    wired = view["data"]["candidates"][0]
    assert wired["entity_id"] == MODULE_NODE_ID
    assert wired["module_authored"]["node_id"] == MODULE_NODE_ID
    assert wired["module_authored"]["costs"]["authored"] is False


def test_the_module_spell_learns_through_the_graph_under_either_name(campaign_ws):
    """rules.context -> rules.settle, on the name the module already wrote.

    The teacher is appointed with the shorthand the NPC profile carries and
    the Keeper asks for the node's own name; both sides canonicalise against
    the module namespace, so the card's applicability gate and the settle-time
    binding read one name. Either half missing it is a card that offers a
    spell the settle then refuses.
    """
    _appoint_teacher(campaign_ws, "npc-walter-corbitt", "entity", [MODULE_SHORTHAND])

    facts = _live_facts(campaign_ws)
    # The shorthand was already in Corbitt's authored profile; appointing him
    # only says he may teach, so the list is the module's own, unchanged.
    assert facts["magic.learn.sources"]["entity:npc-walter-corbitt"] == [
        MODULE_SHORTHAND, "Flesh Ward", "Summon/Bind Dimensional Shambler",
    ]
    # The host publishes the namespace on the one host -> ruleset channel.
    assert MODULE_NODE_ID in {
        record["entity_id"]
        for record in facts["magic.spell.module_namespace"]
    }

    learn_inputs = {
        "spell": MODULE_SPELL,
        "source": "entity",
        "source_ref": "entity:npc-walter-corbitt",
    }
    assert _augmented(campaign_ws, learn_inputs)["magic.learn.source-available"] is True
    card = _magic_cards(campaign_ws, learn_inputs)["decision:coc7:magic:learn-spell"]
    assert card["applicability"] == "applicable", card

    settled = _run(campaign_ws, "rules.settle", {
        "decision_ref": "decision:coc7:magic:learn-spell",
        "decision_id": "graph-module-spell-learn",
        "investigator": campaign_ws["investigator_id"],
        "seed": _learning_seed(70, succeeds=True),
        "semantic_inputs": learn_inputs,
    })
    assert settled["ok"] is True, settled
    assert _settled_result(settled)["learned"] is True

    # Entity teaching has no study delay, so the node's own name is what the
    # investigator now knows -- not the shorthand, and not two spells.
    assert _magic_state(campaign_ws)["learned_spells"] == [MODULE_SPELL]
    assert _live_facts(campaign_ws)["magic.known_spells"] == [MODULE_SPELL]
    # And the shorthand still reads as the same known spell one layer along.
    assert _augmented(campaign_ws, {"spell": MODULE_SHORTHAND})[
        "magic.spell.known"
    ] is True


def test_the_learn_receipt_names_the_module_spell_after_the_wire(campaign_ws):
    """A receipt that said only "Dominate" would lose whose spell this is."""
    _appoint_teacher(campaign_ws, "npc-walter-corbitt", "entity", [MODULE_SHORTHAND])
    settled = _run(campaign_ws, "magic.learn", {
        "spell": MODULE_SHORTHAND,
        "source": "entity",
        "decision_id": "magic-learn:module-spell:1",
        "seed": _learning_seed(70, succeeds=True),
    })
    assert settled["ok"] is True, settled

    view = _projected("magic.learn", settled)
    spell = view["data"]["receipt"]["spell"]
    assert spell["canonical_name"] == MODULE_SPELL
    assert spell["parameterisation"] is None
    block = spell["module_authored"]
    assert block["authority"] == "module_authored_spell"
    assert block["node_id"] == MODULE_NODE_ID
    assert block["visibility"] == "keeper-only"
    assert block["properties"]["target_scope"] == "inside the Corbitt House"
    assert [ref["pdf_index"] for ref in block["source_refs"]] == [457, 460]


def test_casting_an_unpriced_module_spell_is_refused_by_name(campaign_ws):
    """Unpriced is not free, and the refusal survives projection as itself.

    The module authored this spell with no costs. Casting it off a missing
    ``cost_mp`` would spend nothing and cost no Sanity -- a costless Mythos
    spell no source says is costless. The refusal names the node and the
    fields nobody wrote, so the gap is fixable content rather than a wall.
    """
    _appoint_teacher(campaign_ws, "npc-walter-corbitt", "entity", [MODULE_SHORTHAND])
    assert _run(campaign_ws, "magic.learn", {
        "spell": MODULE_SHORTHAND,
        "source": "entity",
        "decision_id": "magic-learn:module-spell:cast-setup",
        "seed": _learning_seed(70, succeeds=True),
    })["ok"] is True
    assert _magic_state(campaign_ws)["learned_spells"] == [MODULE_SPELL]

    cast = _run(campaign_ws, "magic.cast", {
        "spell": MODULE_SPELL,
        "decision_id": "magic-cast:module-spell:1",
        "seed": 3,
    })
    assert cast["ok"] is False, cast
    view = _projected("magic.cast", cast)
    error = view["error"]
    # Its own code, not a flattened invalid_param: the Keeper has to be able
    # to tell an unpriced spell from a malformed call.
    assert error["code"] == "magic_spell_unpriced"
    assert error["details"]["module_node_id"] == MODULE_NODE_ID
    assert error["details"]["unpriced_fields"] == ["cost_mp", "cost_sanity"]
    assert error["details"]["learnable"] is True

    # Nothing was spent and nothing was recorded as cast.
    assert _magic_state(campaign_ws).get("cast_spells", []) == []


def test_a_rulebook_spell_the_module_annotates_still_casts_from_its_own_row(
    campaign_ws,
):
    """Precedence, live: the module's ``spell-flesh-ward`` annotates, not wins.

    Were the module node to win the name, "Flesh Ward" would resolve to a node
    that prices nothing and the cast would be refused as unpriced -- a spell
    the rulebook prices at ``1D4`` Sanity turned uncastable by an annotation.
    """
    _appoint_teacher(campaign_ws, "npc-walter-corbitt", "entity", ["Flesh Ward"])
    assert _run(campaign_ws, "magic.learn", {
        "spell": "Flesh Ward",
        "source": "entity",
        "decision_id": "magic-learn:flesh-ward:1",
        "seed": _learning_seed(70, succeeds=True),
    })["ok"] is True

    cast = _run(campaign_ws, "magic.cast", {
        "spell": "Flesh Ward",
        "decision_id": "magic-cast:flesh-ward:1",
        "seed": 3,
    })
    assert cast["ok"] is True, cast
    spell = _projected("magic.cast", cast)["data"]["receipt"]["spell"]
    assert spell["canonical_name"] == "Flesh Ward"
    assert spell["catalog_entry_name"] == "Flesh Ward"
    # The losing node is reported for what it is rather than dropped.
    assert spell["module_authored"]["authority"] == "module_annotation"
    assert spell["module_authored"]["node_id"] == "spell-flesh-ward"
