"""Behavior tests owned by the npc-world operation cell."""
from toolbox_test_support import *

def test_npc_update_can_resolve_an_existing_promise(campaign_ws):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    made = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "record_promise": "promise-shelter-until-dawn",
        "decision_id": "npc-promise-made",
    })
    assert made["ok"] is True, made

    resolution_args = {
        "npc_id": npc_id,
        "resolve_promise": {
            "promise_id": "promise-shelter-until-dawn",
            "kept": True,
        },
        "decision_id": "npc-promise-kept",
    }
    resolved = _run(campaign_ws, "state.npc_update", resolution_args)
    duplicate = _run(campaign_ws, "state.npc_update", resolution_args)
    assert resolved["ok"] is True, resolved
    assert duplicate["data"] == resolved["data"]
    assert resolved["data"]["applied"]["resolved_promise"] == {
        "promise_id": "promise-shelter-until-dawn",
        "kept": True,
    }
    assert resolved["data"]["psych"]["promises"] == [
        {"promise_id": "promise-shelter-until-dawn", "kept": True}
    ]

def test_npc_update_invalid_availability_has_no_partial_state_mutation(campaign_ws):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    decision_id = "npc-atomic-invalid-then-valid"
    before = coc_toolbox.coc_npc_state.get_npc_entry(
        campaign_ws["campaign_dir"], npc_id
    )

    invalid = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "trust_delta": -1,
        "suspicion_delta": 2,
        "availability": "permission_required",
        "decision_id": decision_id,
    })

    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "invalid_request"
    assert coc_toolbox.coc_npc_state.get_npc_entry(
        campaign_ws["campaign_dir"], npc_id
    ) == before

    valid_args = {
        "npc_id": npc_id,
        "trust_delta": -1,
        "suspicion_delta": 2,
        "availability": "unavailable",
        "decision_id": decision_id,
    }
    first = _run(campaign_ws, "state.npc_update", valid_args)
    duplicate = _run(campaign_ws, "state.npc_update", valid_args)

    assert first["ok"] is True
    assert duplicate["ok"] is True
    assert duplicate["data"] == first["data"]
    assert first["data"]["psych"]["trust"] == before["trust"] - 1
    assert first["data"]["psych"]["suspicion"] == before["suspicion"] + 2
    assert first["data"]["psych"]["availability"] == {"status": "unavailable"}
    assert coc_toolbox.coc_npc_state.get_npc_entry(
        campaign_ws["campaign_dir"], npc_id
    ) == first["data"]["psych"]

def test_npc_update_persists_pair_impression_and_npc_query_projects_it(campaign_ws):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    investigator_id = campaign_ws["investigator_id"]
    args = {
        "npc_id": npc_id,
        "investigator": investigator_id,
        "impression_update": {
            "summary": "他认为托马斯谨慎且值得继续合作。",
            "expectations": ["下次会先说明证据责任。"],
            "reservations": ["仍担心他会独自承担危险。"],
            "memory": {
                "memory_id": "meaningful-action-1",
                "event": "托马斯在证据不足时承认不知道。",
                "interpretation": "他不会为了推进案件编造确定性。",
                "reason": "observed_behavior",
            },
            "reason": "npc_changed_its_view",
        },
        "decision_id": "npc-impression-once",
    }
    first = _run(campaign_ws, "state.npc_update", args)
    duplicate = _run(campaign_ws, "state.npc_update", args)
    assert first["ok"] and duplicate["ok"]
    assert duplicate["data"] == first["data"]
    projected = _run(campaign_ws, "npc.query", {
        "npc_id": npc_id,
        "investigator": investigator_id,
    })
    assert projected["ok"]
    row = projected["data"]["npcs"][0]
    assert row["psych"]["impression"]["summary"].startswith("他认为托马斯")
    assert len(row["psych"]["impression"]["memories"]) == 1

def test_npc_query_preserves_authored_identity_contract(campaign_ws):
    envelope = _run(campaign_ws, "npc.query", {"npc_id": "npc-kim-debrun"})

    assert envelope["ok"] is True
    kim = envelope["data"]["npcs"][0]
    assert kim["origin"] == "source"
    assert kim["relationship_to_investigators"] == "court_contact"
    assert kim["social_role"]["authority_scope"] == ["specialist_knowledge"]
    assert kim["identity_ref"].startswith("npc-identity-v2:")
    assert kim["profile_revision_ref"].startswith("npc-profile-v2:")
    contract = kim["identity_contract"]
    assert contract["keeper_only"] is True
    assert contract["npc_id"] == "npc-kim-debrun"
    assert contract["role"]["relationship_to_investigators"] == "court_contact"
    assert contract["agenda"] == kim["agenda"]
    assert contract["voice"] == kim["voice"]
    assert contract["schedule"] == kim["schedule"]
    assert contract["location_provenance"]["authored_scene_ids"] == [
        "higher-courts-central-police"
    ]
    assert any("identity contract" in hint for hint in envelope["hints"])
    assert any("never invent a gendered pronoun" in hint for hint in envelope["hints"])

def test_npc_query_projects_campaign_local_npc_and_invalidates_on_first_impression(
    campaign_ws,
):
    npc_id = "npc-invented-port-clerk"
    updated = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "trust_delta": 1,
        "decision_id": "campaign-local-query-state",
    })
    assert updated["ok"] is True

    before_reaction = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert before_reaction["ok"] is True
    revision = before_reaction["data"]["working_set"]["revision"]
    row = before_reaction["data"]["npcs"][0]
    assert row["origin"] == "improvised"
    assert row["name"] is None
    assert row["identity_ref"] is None
    assert row["profile_revision_ref"] is None
    assert row["identity_contract"] is None
    assert row["psych"]["trust"] == 1
    assert any("npc.reaction" in hint for hint in before_reaction["hints"])

    binding = _first_contact_binding(
        campaign_ws,
        npc_id,
        key="campaign-local-query",
    )
    after_reaction = _run(campaign_ws, "npc.query", {
        "npc_id": npc_id,
        "since_revision": revision,
    })
    assert after_reaction["ok"] is True
    assert after_reaction["data"].get("not_modified") is not True
    assert after_reaction["data"]["working_set"]["revision"] != revision
    assert after_reaction["data"]["npcs"][0]["name"] == (
        "测试 NPC campaign-local-query"
    )
    assert not any("npc.reaction" in hint for hint in after_reaction["hints"])

    recorded = _run(campaign_ws, "state.record_npc_engagement", {
        "npc_id": npc_id,
        "interaction_kind": "dialogue",
        "decision_id": "campaign-local-query-engagement",
        **binding,
    })
    assert recorded["ok"] is True

    queried = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried["ok"] is True
    row = queried["data"]["npcs"][0]
    assert row["psych"]["trust"] == 1
    assert row["psych"]["impression"]["initialized_from_first_impression"] is True
    all_npcs = _run(campaign_ws, "npc.query")
    assert npc_id in {item["npc_id"] for item in all_npcs["data"]["npcs"]}

def test_first_contact_readiness_projects_only_requested_investigator(campaign_ws):
    other_id = _add_eleanor_to_party(campaign_ws)
    npc_id = "npc-steven-knott"

    scoped = _run(campaign_ws, "npc.query", {
        "npc_id": npc_id,
        "investigator": campaign_ws["investigator_id"],
    })
    readiness = scoped["data"]["npcs"][0]["first_contact_readiness"]
    assert readiness["requested_pair_first_impression"]["investigator_id"] == (
        campaign_ws["investigator_id"]
    )
    reaction_cards = [
        card for card in readiness["next_operation_cards"]
        if card["operation"] == "npc.reaction"
    ]
    assert len(reaction_cards) == 1
    assert reaction_cards[0]["prefilled_arguments"]["investigator"] == (
        campaign_ws["investigator_id"]
    )
    assert other_id not in json.dumps(reaction_cards)

    unscoped = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    unscoped_ready = unscoped["data"]["npcs"][0]["first_contact_readiness"]
    assert unscoped_ready["requested_pair_first_impression"] == {
        "status": "investigator_selection_required",
        "investigator_id": None,
        "receipt_exists": None,
        "first_impression_ref": None,
    }
    assert not any(
        card["operation"] == "npc.reaction"
        for card in unscoped_ready["next_operation_cards"]
    )
    bulk = _run(campaign_ws, "npc.query")
    assert all("first_contact_readiness" not in row for row in bulk["data"]["npcs"])

def test_npc_advise_preserves_authored_truth_over_canonical_support(campaign_ws):
    npc_id = "npc-steven-knott"
    agendas_path = campaign_ws["campaign_dir"] / "scenario" / "npc-agendas.json"
    agendas = json.loads(agendas_path.read_text(encoding="utf-8"))
    authored = next(
        npc for npc in agendas["npcs"]
        if npc["npc_id"] == npc_id
    )
    story_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    active_scene = next(
        scene for scene in story["scenes"]
        if scene["scene_id"] == "commission-briefing"
    )
    active_scene["scene_tags"] = ["public_pressure"]
    active_scene["authority_demands"] = ["scene_safety"]
    _write_json(story_path, story)
    canonical = coc_toolbox.coc_npc_state.load_npc_state(
        campaign_ws["campaign_dir"]
    )
    canonical["npcs"][npc_id] = {
        "npc_id": npc_id,
        "name": {"status": "generated", "value": "Wrong Name"},
        "origin": "improvised",
        "agenda": "Replace the authored commission with a generic agenda.",
        "voice": "Replace the authored voice.",
        "social_role": {"authority_scope": ["wrong_scope"]},
        "persona": {
            "tags": ["stress_response.panic", "temperament.secretive"],
        },
    }
    coc_toolbox.coc_npc_state.save_npc_state(campaign_ws["campaign_dir"], canonical)
    stale_path = campaign_ws["campaign_dir"] / "save" / "npc-persona-state.json"
    stale_path.write_text(json.dumps({
        "npcs": {npc_id: {
            "npc_id": npc_id,
            "persona": {"tags": ["stress_response.freeze"]},
        }},
    }), encoding="utf-8")

    advised = _run(campaign_ws, "npc.advise", {
        "intent_evidence": {
            "primary_intent": "talk",
            "secondary_intents": [],
            "risk_posture": "careful",
            "target_entities": [npc_id],
            "intent_tags": [],
            "reason": "test canonical persona state",
        },
        "seed": 7,
    })
    assert advised["ok"] is True, advised
    card = advised["data"]["candidate_agency"]["by_npc"][npc_id]["persona_card"]
    assert card["name"]["value"] == authored["name"]
    assert card["origin"] == authored["origin"]
    assert card["agenda"] == authored["agenda"]
    assert card["voice"] == authored["voice"]
    assert card["social_role"] == authored["social_role"]
    assert card["persona"] == {}
    assert "generation" not in card
    assert advised["data"]["candidate_agency"]["npc_state_writes"] == []
    move_ids = {
        move["move_id"]
        for move in advised["data"]["candidate_agency"]["by_npc"][npc_id][
            "agency_moves"
        ]
    }
    assert "take_command" in move_ids
    assert not {"panic", "withhold"} & move_ids

    authored["persona"] = {"tags": ["temperament.secretive"]}
    _write_json(agendas_path, agendas)
    authored_secretive = _run(campaign_ws, "npc.advise", {
        "intent_evidence": {
            "primary_intent": "talk",
            "secondary_intents": [],
            "risk_posture": "careful",
            "target_entities": [npc_id],
            "intent_tags": [],
            "reason": "test explicit authored temperament",
        },
        "seed": 8,
    })
    secretive_row = authored_secretive["data"]["candidate_agency"]["by_npc"][
        npc_id
    ]
    assert secretive_row["persona_card"]["persona"]["tags"] == [
        "temperament.secretive"
    ]
    assert "withhold" in {
        move["move_id"] for move in secretive_row["agency_moves"]
    }

    authored["persona"] = {"tags": ["stress_response.panic"]}
    _write_json(agendas_path, agendas)
    authored_panic = _run(campaign_ws, "npc.advise", {
        "intent_evidence": {
            "primary_intent": "talk",
            "secondary_intents": [],
            "risk_posture": "careful",
            "target_entities": [npc_id],
            "intent_tags": [],
            "reason": "test explicit authored stress response",
        },
        "seed": 9,
    })
    panic_row = authored_panic["data"]["candidate_agency"]["by_npc"][npc_id]
    assert panic_row["persona_card"]["persona"]["tags"] == [
        "stress_response.panic"
    ]
    assert [move["move_id"] for move in panic_row["agency_moves"]] == ["panic"]

@pytest.mark.parametrize("play_language", ["zh-Hans", "en"])
def test_authored_stored_raw_name_is_not_localized_without_provenance(
    campaign_ws, play_language,
):
    npc_id = "npc-steven-knott"
    campaign_path = campaign_ws["campaign_dir"] / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["play_language"] = play_language
    _write_json(campaign_path, campaign)
    canonical = coc_toolbox.coc_npc_state.load_npc_state(
        campaign_ws["campaign_dir"]
    )
    canonical["npcs"][npc_id] = {
        "npc_id": npc_id,
        "name": {
            "status": "provided",
            "value": "Steven Knott",
            "source": "scenario_data",
        },
        "persona": {"tags": ["temperament.cautious"]},
    }
    coc_toolbox.coc_npc_state.save_npc_state(campaign_ws["campaign_dir"], canonical)

    before = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    readiness = before["data"]["npcs"][0]["first_contact_readiness"]
    assert readiness["localized_name_ready"] is False
    reaction_card = next(
        card for card in readiness["next_operation_cards"]
        if card["operation"] == "npc.reaction"
    )
    assert "npc_display_name" in reaction_card["missing_arguments"]

def test_first_impression_receipt_accepts_authored_table_name(campaign_ws):
    npc_id = "npc-steven-knott"
    canonical = coc_toolbox.coc_npc_state.load_npc_state(
        campaign_ws["campaign_dir"]
    )
    canonical["npcs"][npc_id] = {
        "npc_id": npc_id,
        "name": {
            "status": "provided",
            "value": "Steven Knott",
            "source": "scenario_data",
        },
        "persona": {"tags": ["temperament.cautious"]},
    }
    coc_toolbox.coc_npc_state.save_npc_state(campaign_ws["campaign_dir"], canonical)

    accepted_name = "测试史蒂文"
    reaction = _run(campaign_ws, "npc.reaction", {
        "npc_id": npc_id,
        "npc_display_name": accepted_name,
        "investigator": campaign_ws["investigator_id"],
        "context": {
            "player_conduct": "the investigator introduces themself",
            "scene_constraints": "the authored commission remains in force",
            "authored_or_relationship_boundary": "identity and agenda do not change",
            "semantic_reason": "this is the actual first substantive contact",
        },
        "decision_id": "localized-name-receipt",
        "seed": 1,
    })
    assert reaction["ok"] is True, reaction
    after = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    after_ready = after["data"]["npcs"][0]["first_contact_readiness"]
    assert after_ready["localized_name_ready"] is True
    assert after_ready["localized_name"] == accepted_name

def test_first_impression_localizes_english_source_display_name(campaign_ws):
    npc_id = "npc-steven-knott-en"
    reaction = _run(campaign_ws, "npc.reaction", {
        "npc_id": npc_id,
        "npc_display_name": "Steven Knott",
        "investigator": campaign_ws["investigator_id"],
        "context": {
            "player_conduct": "the investigator introduces themself",
            "scene_constraints": "the authored commission remains in force",
            "authored_or_relationship_boundary": "identity and agenda do not change",
            "semantic_reason": "this is the actual first substantive contact",
        },
        "decision_id": "english-name-localized",
        "seed": 1,
    })
    assert reaction["ok"] is True, reaction
    assert reaction["data"]["npc_display_name"] == "史蒂文·诺特"
    assert reaction["data"]["roll_record"]["npc_display_name"] == "史蒂文·诺特"

def test_npc_short_name_and_open_interaction_label_degrade_without_blocking(campaign_ws):
    query = _run(campaign_ws, "npc.query", {"npc_id": "knott"})
    assert query["ok"] is True
    assert query["data"]["npcs"][0]["npc_id"] == "npc-steven-knott"
    assert any("resolved NPC alias" in hint for hint in query["hints"])

    engagement = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "knott",
            "interaction_kind": "request_access",
            "decision_id": "knott-access-soft-label",
            **_first_contact_binding(
                campaign_ws,
                "knott",
                key="knott-first-contact",
            ),
        },
    )
    assert engagement["ok"] is True
    assert engagement["data"]["npc_id"] == "npc-steven-knott"
    assert engagement["data"]["interaction_kind"] == "other"
    assert engagement["data"]["interaction_label"] == "request_access"
    assert any("normalized to 'other'" in warning for warning in engagement["warnings"])

def test_npc_structured_alias_normalization_is_unicode_safe_and_unambiguous():
    agendas = {
        "npcs": [
            {
                "npc_id": "npc-elise-zhou",
                "name": "Élise 周",
                "aliases": ["周女士"],
            },
            {
                "npc_id": "npc-zhou-ming",
                "name": "Ming 周",
                "aliases": ["周先生"],
            },
        ]
    }

    assert coc_toolbox._npc_by_id(agendas, "ÉLISE")["npc_id"] == "npc-elise-zhou"
    assert coc_toolbox._npc_by_id(agendas, "周女士")["npc_id"] == "npc-elise-zhou"
    # The shared structured token stays unresolved instead of selecting one NPC.
    assert coc_toolbox._npc_by_id(agendas, "周") is None

def test_toolbox_npc_engagement_producer_emits_exact_current_event_schema(
    campaign_ws,
):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    result = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": npc_id,
            "interaction_kind": "dialogue",
            "decision_id": "npc-schema-producer",
            **_first_contact_binding(
                campaign_ws,
                npc_id,
                key="npc-schema-producer",
            ),
        },
    )
    assert result["ok"] is True
    assert type(result["data"]["schema_version"]) is int
    assert result["data"]["schema_version"] == (
        coc_toolbox.coc_npc_identity.ENGAGEMENT_EVENT_SCHEMA_VERSION
    )
    assert result["data"]["event_id"].startswith("npc-engagement-v1:")
    assert result["data"]["producer"] == "state.record_npc_engagement"
    assert result["data"]["campaign_id"] == campaign_ws["campaign_id"]
    assert result["data"]["decision_id"] == "npc-schema-producer"
    receipt_doc = coc_toolbox.coc_npc_event_chain.load_receipt_document(
        campaign_ws["campaign_dir"]
    )
    receipt = receipt_doc["receipts"][result["data"]["event_id"]]
    assert coc_toolbox.coc_npc_event_chain.valid_receipt(receipt)

def test_npc_reaction_is_public_deterministic_and_npc_bound(campaign_ws):
    realization_schema = coc_toolbox.TOOLS[
        "state.record_npc_engagement"
    ]["params"]["first_impression_realization"]
    assert realization_schema["required_fields"] == [
        "observable_manner",
        "causal_explanation",
        "boundary_preserved",
        "opportunity_or_friction",
    ]
    assert all(
        realization_schema["properties"][field]["type"] == "string"
        for field in realization_schema["required_fields"]
    )
    args = {
        "npc_id": "npc-test-clerk",
        "npc_display_name": "测试档案员",
        "investigator": campaign_ws["investigator_id"],
        "context": {
            "player_conduct": "调查员清楚说明来意并保持礼貌",
            "scene_constraints": "档案室仍有正常借阅和保密边界",
            "authored_or_relationship_boundary": "双方第一次见面且没有既有私交",
            "semantic_reason": "外表与信用只调节起初态度",
        },
        "seed": 7,
        "decision_id": "npc-reaction-deterministic",
    }
    first = _run(campaign_ws, "npc.reaction", args)
    second = _run(campaign_ws, "npc.reaction", args)
    assert first["ok"] is True
    assert first["data"] == second["data"]
    data = first["data"]
    assert data["schema_version"] == 2
    assert data["rule_ref"].startswith("keeper-rulebook p.191")
    assert data["governing_attribute"] in ("app", "credit_rating")
    assert data["governing_value"] == max(data["app"], data["credit_rating"])
    assert data["roll_record"]["visibility"] == "public"
    assert data["reaction_tier"]
    engagement = data["record_engagement_operation"]
    assert engagement["operation"] == "state.record_npc_engagement"
    assert engagement["prefilled_arguments"] == {
        "npc_id": "npc-test-clerk",
        "investigator": campaign_ws["investigator_id"],
        "first_impression_ref": data["receipt_id"],
        "run_id": data["run_id"],
    }
    assert engagement["missing_arguments"] == [
        "interaction_kind",
        "decision_id",
        "first_impression_realization",
    ]
    assert engagement["hard_gate"] is False
    # The public first-impression die is written exactly once.
    rolls_log = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    matching = [
        row for row in _read_jsonl(rolls_log)
        if row.get("payload", {}).get("roll_id") == data["roll_id"]
    ]
    assert len(matching) == 1

    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    bound = _run(campaign_ws, "npc.reaction", {
        **args,
        "npc_id": npc_id,
        "npc_display_name": "另一位测试 NPC",
        "decision_id": "npc-reaction-authored-bound",
    })
    assert bound["ok"] is True
    assert bound["data"]["npc_id"] == npc_id

def test_first_impression_hint_on_npc_query_and_engagement(campaign_ws):
    npc_id = _first_neutral_npc_id(campaign_ws["campaign_dir"])

    queried = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried["ok"] is True
    assert any(
        "first impression" in hint and "npc.reaction" in hint
        for hint in queried["hints"]
    )

    recorded = _run(campaign_ws, "state.record_npc_engagement", {
        "npc_id": npc_id,
        "interaction_kind": "dialogue",
        "decision_id": "first-impression-hint-1",
        **_first_contact_binding(
            campaign_ws,
            npc_id,
            key="first-impression-hint",
        ),
    })
    assert recorded["ok"] is True
    assert any(
        "first contact settled exactly once" in hint
        for hint in recorded["hints"]
    )

    # The pair receipt itself suppresses the first-contact advisory; later
    # relationship state can then evolve without another first-impression roll.
    queried_after_contact = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried_after_contact["ok"] is True
    assert not any("first impression" in hint for hint in queried_after_contact["hints"])
    updated = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "trust_delta": 2,
        "decision_id": "first-impression-hint-2",
    })
    assert updated["ok"] is True
    queried_after = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried_after["ok"] is True
    assert not any("first impression" in hint for hint in queried_after["hints"])
