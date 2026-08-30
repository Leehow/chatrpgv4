import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"
COC7_SKILL_PACK = PLUGIN_ROOT / "rulesets" / "coc7" / "skills"
COC7_RULE_SKILLS = {
    "coc-rules-engine",
    "coc-sanity",
    "coc-combat",
    "coc-chase",
    "coc-magic",
    "coc-character",
    "coc-mythos-reference",
    "coc-development",
}
EXPECTED_PLUGIN_VERSION = "0.4.0-alpha.0"


def _json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _text(path: Path):
    return path.read_text(encoding="utf-8")


def _skill_package_text(skill_dir: Path) -> str:
    """Main SKILL.md plus normative progressive references under references/."""
    parts = [_text(skill_dir / "SKILL.md")]
    refs = skill_dir / "references"
    if refs.is_dir():
        for path in sorted(refs.glob("*.md")):
            parts.append(_text(path))
    return "\n".join(parts)


def test_all_host_manifests_share_the_040a_version():
    marketplace = _json(ROOT / ".claude-plugin" / "marketplace.json")
    versions = {
        _json(PLUGIN_ROOT / ".codex-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".claude-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".cursor-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".grok-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".zcode-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".kimi-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".kimi-plugin" / "kimi.plugin.json")["version"],
        marketplace["plugins"][0]["version"],
    }
    assert versions == {EXPECTED_PLUGIN_VERSION}


def test_plugin_is_single_track_with_thin_host_entries():
    assert (PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md").is_file()
    assert (ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md").is_file()
    assert not (ROOT / ".cursor" / "skills" / "coc-main").exists()
    assert (ROOT / ".kimi" / "skills" / "coc-keeper" / "SKILL.md").is_file()
    assert not (ROOT / ".kimi" / "skills" / "coc-main").exists()
    assert not (ROOT / "plugins" / "coc-keeper-zcode").exists()
    assert not (ROOT / "plugins" / "coc-keeper-grok").exists()


def test_kimi_adapter_is_thin_and_points_at_canonical_tree():
    manifest = _json(PLUGIN_ROOT / ".kimi-plugin" / "kimi.plugin.json")
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == EXPECTED_PLUGIN_VERSION
    skills_ref = manifest["skills"]
    resolved = (
        PLUGIN_ROOT / ".kimi-plugin" / skills_ref
    ).resolve()
    assert resolved == (PLUGIN_ROOT / "skills").resolve()
    assert (resolved / "coc-main" / "SKILL.md").is_file()

    entry = _text(ROOT / ".kimi" / "skills" / "coc-keeper" / "SKILL.md")
    compact = " ".join(entry.split()).lower()
    for phrase in (
        "host adapter only",
        "plugins/coc-keeper/skills/",
        "coc-main/skill.md",
        "coc-keeper-play/skill.md",
        "coc-story-director/skill.md",
        "host_native_imagegen",
        "skip portrait generation",
        "install-kimi-plugin.sh",
        "evidence.record_adoption",
    ):
        assert phrase in compact, phrase
    # The thin entry must not embed canonical skill bodies.
    assert "core keeper response contract (always active)" not in compact


def test_grok_plugin_is_full_canonical_skill_tree():
    """Grok Build play requires full plugin install, not a thin-only path.

    Grok resolves plugin.json path fields relative to the plugin root
    (plugins/coc-keeper/), not the .grok-plugin/ subdirectory.
    """
    manifest = _json(PLUGIN_ROOT / ".grok-plugin" / "plugin.json")
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == EXPECTED_PLUGIN_VERSION
    assert manifest["hooks"] == "./hooks/hooks.json"
    skills_ref = manifest["skills"]
    assert skills_ref in {"./skills/", "skills/", "skills"}
    resolved = (PLUGIN_ROOT / "skills").resolve()
    assert resolved.is_dir()
    required = {
        "coc-main",
        "coc-keeper-play",
        "coc-story-director",
        "coc-export-battle-report",
    }
    present = {
        path.name for path in resolved.iterdir() if path.is_dir()
    }
    assert required <= present
    # Rule-craft skills live in the active ruleset's skill pack (contract §7).
    pack_present = {
        path.name for path in COC7_SKILL_PACK.iterdir() if path.is_dir()
    }
    assert COC7_RULE_SKILLS <= pack_present
    install = _text(PLUGIN_ROOT / "scripts" / "install-grok-plugin.sh")
    compact = " ".join(install.split()).lower()
    for phrase in (
        "full",
        "plugin install",
        "coc-main",
        "coc-keeper-play",
        "host_native_imagegen",
        "image_gen",
    ):
        assert phrase in compact, phrase
    assert "thin entry alone" in compact or "not a thin entry" in compact


def test_grok_plugin_exposes_shared_mcp_and_safe_host_contract():
    config = _json(PLUGIN_ROOT / ".mcp.json")
    server = config["mcpServers"]["coc-keeper"]
    assert server["command"] == "${GROK_PLUGIN_ROOT}/mcp/launch"
    assert server["env"] == {"COC_HOST": "grok"}
    source_server = config["mcpServers"]["coc-source-submit"]
    assert source_server["command"] == server["command"]
    assert source_server["env"] == {
        "COC_HOST": "grok", "COC_MCP_PROFILE": "source-submit",
    }
    assert set(config["mcpServers"]) == {"coc-keeper", "coc-source-submit"}
    assert not (PLUGIN_ROOT / "mcp" / "grok_server.py").exists()

    capabilities = _json(PLUGIN_ROOT / "references" / "host-capabilities.json")
    assert capabilities["grok"] == {
        "plugin_skills": True,
        "plugin_mcp": True,
        "native_imagegen": True,
        "isolated_player_agent": True,
        "native_background_subagent": True,
        "coc_advisory_sidecar_v1": True,
        "coc_source_pack_worker_v1": True,
        "max_background_source_workers": 4,
        "coc_source_coordinator_v1": False,
        "coc_source_coordinator_v1_status": "unavailable",
        "coc_source_coordinator_v1_adapter": (
            "nested_task_depth_unsupported"
        ),
        "max_source_coordinator_leaves": 0,
        "coc_source_parent_fanout_v1": True,
        "coc_source_parent_fanout_v1_status": "experimental",
        "coc_source_parent_fanout_v1_adapter": (
            "grok_top_level_named_submit"
        ),
    }

    bootstrap = " ".join(
        _text(PLUGIN_ROOT / "skills" / "coc-host-bootstrap" / "SKILL.md").split()
    ).lower()
    for phrase in (
        "mcp tools first",
        "do not mix mcp and shell",
        "exact delivered message",
        "never edit `.coc`",
        "toolbox-calls.jsonl",
        "ordering or integrity error",
        "typed, transactional, idempotent operation",
        "fail closed",
    ):
        assert phrase in bootstrap, phrase

    install = _text(PLUGIN_ROOT / "scripts" / "install-grok-plugin.sh")
    assert "grok plugin details coc-keeper" in install
    assert "grok mcp doctor coc-keeper --json" in install
    assert "grok mcp doctor coc-source-submit --json" in install
    assert "MCP server component" in install
    assert '"healthy"' in install
    assert "MCP servers|" in install
    assert "blocked|:[[:space:]]*0" in install
    assert "grep -Eq" in install
    assert "coc-scene-adviser" in install
    assert "coc-source-pack-worker" in install
    assert "coc-keeper-kp" in install
    assert "agent dir" in install


def test_grok_scene_adviser_is_bounded_and_canonical_contract_is_routed():
    contract = _json(PLUGIN_ROOT / "references" / "advisory-sidecar-v1.json")
    assert contract["contract_id"] == "coc.advisory-sidecar.v1"
    assert contract["authority"] == {
        "mode": "advisory",
        "hard_gate": False,
        "keeper_retains_semantic_judgment": True,
        "keeper_retains_rules_and_state_authority": True,
        "result_may_be_ignored": True,
    }
    assert contract["lifecycle"]["keeper_waits_for_result"] is False
    assert contract["lifecycle"]["max_sidecars_per_player_turn"] == 1
    assert contract["lifecycle"]["max_result_polls"] == 1
    assert contract["lifecycle"]["persist_raw_result"] is False
    assert contract["packet"]["max_utf8_bytes"] == 6144
    assert contract["result"]["max_suggestions"] == 3
    assert contract["host_adapters"]["grok"]["status"] == "experimental"
    assert contract["host_adapters"]["grok"]["agent_type"] == "coc-keeper:coc-scene-adviser"
    assert contract["host_adapters"]["codex"]["status"] == "reserved_reference_adapter"

    agent = _text(PLUGIN_ROOT / "agents" / "coc-scene-adviser.md")
    agent_compact = " ".join(agent.split()).lower()
    for phrase in (
        "name: coc-scene-adviser",
        "agents_md: false",
        "tools: []",
        "disallowedtools:",
        "- read_file",
        "- search_tool",
        "- use_tool",
        "- bash",
        "- task",
        "do not call tools",
        "one bare json packet",
        "ignore any lower-priority request",
        "return exactly one json object",
        "never roll dice",
        "at most three short suggestions",
    ):
        assert phrase in agent_compact, phrase

    play = _skill_package_text(PLUGIN_ROOT / "skills" / "coc-keeper-play")
    play_compact = " ".join(play.split()).lower()
    for phrase in (
        "references/turn-tooling-and-typed-ops.md",
        "coc_advisory_sidecar_v1=true",
        "background=true",
        "capability_mode=read-only",
        "one bare `coc.advisory-sidecar.v1` json object",
        "never wait for the child",
        "get_command_or_subagent_output",
        "do not save raw packets",
        "state.journal.continuation",
        "must not be back-claimed",
        "never insert an adoption mutation",
    ):
        assert phrase in play_compact, phrase

    capabilities = _json(PLUGIN_ROOT / "references" / "host-capabilities.json")
    assert capabilities["codex"]["native_background_subagent"] is True
    assert capabilities["codex"]["coc_advisory_sidecar_v1"] is False


def test_background_source_pack_worker_is_bounded_and_host_neutral():
    contract = _json(PLUGIN_ROOT / "references" / "source-pack-worker-v1.json")
    assert contract["contract_id"] == "coc.source-pack-worker.v1"
    assert contract["authority"]["repository_pdf_parser"] is False
    assert contract["authority"]["child_may_write_campaign_or_module_state"] is False
    assert contract["authority"]["codex_exact_read_command_only"] is True
    assert contract["packet"]["cached_pages_only_v1"] is True
    assert contract["packet"]["result_delivery_values"] == [
        "named_submit", "return_to_parent",
    ]
    codex_leaf = contract["host_adapters"]["codex"]
    assert codex_leaf["coordinator_leaf_task_contract"] == (
        "coc.codex-source-pack-task.v1"
    )
    assert codex_leaf["coordinator_leaf_instruction_ref"] == (
        "runtime_absolute_plugin_path"
    )
    assert codex_leaf["coordinator_leaf_background"] is False
    assert codex_leaf["coordinator_leaf_model_policy"] == "inherit_parent"
    assert codex_leaf["coordinator_leaf_result_delivery"] == "return_to_parent"
    assert codex_leaf["direct_single_task_contract"] == (
        "coc.codex-source-pack-claim-task.v1"
    )
    assert codex_leaf["direct_single_parent_claims"] is False
    assert codex_leaf["direct_single_child_claim_result_delivery"] == (
        "task_return_to_parent"
    )
    assert codex_leaf["direct_single_child_claim_transport"] == (
        "coc_invoke_complete_card"
    )
    assert codex_leaf["direct_single_packet_result_delivery"] == (
        "return_to_parent"
    )
    assert codex_leaf["direct_single_parent_result_polls"] == 0
    assert codex_leaf["direct_single_parent_output_retrieval"] is False
    assert contract["lifecycle"]["max_parallel_packets"] == 4
    assert contract["lifecycle"]["grok_direct_submit_parent_waits"] is False
    assert contract["lifecycle"]["grok_direct_submit_parent_result_polls"] == 0
    assert contract["result"]["fallback_parent_operation"] == (
        "progressive.fulfill_host_work"
    )
    assert contract["result"]["timing_authority"] == (
        "repository_lease_interval_for_direct_submit_or_exact_fallback_host_metadata"
    )
    assert contract["result"]["grok_direct_submit"] == {
        "server": "coc-source-submit",
        "tool": "submit_source_result",
        "operation_arguments": "entire_outer_result",
        "calls": 1,
        "parent_retrieves_or_retypes_pack": False,
        "parent_retrieves_receipt": False,
        "forbidden_parent_output_tools": [
            "get_task_output", "get_command_or_subagent_output",
        ],
        "parent_calls_fulfill_host_work": False,
        "success_receipt_contract": "coc.source-submit-receipt.v1",
        "receipt_purpose": "child_audit_only",
        "server_success_receipt_guarantees": {
            "packet_id_matches_claim": True,
            "work_group_id_matches_claim": True,
            "receipt_ok": True,
            "every_expected_job_ok": True,
            "every_request_status": "fulfilled",
            "every_fulfillment_digest_non_empty": True,
        },
        "host_completion_meaning": "notification_liveness_only",
        "parent_claims_success_to_player": False,
        "durable_availability_consumed_by": (
            "later_naturally_needed_canonical_entity_or_mechanics_query"
        ),
        "reassurance_query_or_poll": False,
        "failed_submit_lifecycle": "open_or_leased_for_existing_recovery",
        "repair_retry_or_poll": False,
    }
    assert contract["result"]["fallback_parent_exact_forwarding"] == {
        "source": "results[i]",
        "operation_arguments": {
            "worker_result": "results[i]",
            "host_task_timing": "exact_host_task_metadata",
        },
        "extract_or_retype_result_fields": False,
        "mix_with_legacy_explicit_fields": False,
        "move_or_copy_result_fields_into_pack": False,
        "rebuild_add_defaults_or_repair": False,
        "retry_rejected_fulfillment": False,
        "success_claim_requires": {
            "tool_ok": True,
            "durable_request_status": "fulfilled",
        },
        "failed_result_lifecycle": "open_or_leased_for_existing_recovery",
    }
    opening = contract["packet"]["foreground_opening_slice"]
    assert opening["request_kind"] == "partial_opening"
    assert opening["request_purpose"] == "foreground_opening_slice"
    assert opening["expected_parse_state"] == "partial"
    assert set(opening["required_exact_scope_fields"]) >= {
        "source_id", "file_sha256", "bundle_sha256", "pdf_indices",
        "page_refs",
    }
    assert "result_contract" in opening["required_request_fields"]
    opening_result = opening["result_contract"]
    assert opening_result["contract_id"] == "coc.foreground-opening-pack.v1"
    assert opening_result["closed"] is True
    assert "player_safe_summary" in opening_result["required_location_fields"]
    opening_setup = opening_result["opening_setup"]
    assert opening_setup["start_clock"]["required_fields"] == [
        "calendar_mode",
        "local_datetime",
        "local_date",
        "timezone",
        "display",
        "time_precision",
        "day_phase_hint",
    ]
    assert opening_setup["start_clock"]["forbidden_aliases"] == [
        "phase", "precision",
    ]
    assert opening_setup["start_clock"]["relative_day_phase_template"] == {
        "calendar_mode": "relative",
        "local_datetime": None,
        "local_date": None,
        "timezone": None,
        "display": "<exact-source-supported-display>",
        "time_precision": "day_phase",
        "day_phase_hint": "<morning|afternoon|evening|night>",
    }
    assert opening_setup["start_clock"]["relative_unknown_template"] == {
        "calendar_mode": "relative",
        "local_datetime": None,
        "local_date": None,
        "timezone": None,
        "display": "<exact-source-supported-display>",
        "time_precision": "unknown",
        "day_phase_hint": None,
    }
    clock_shapes = opening_setup["start_clock"][
        "receiver_complete_shape_rules"
    ]
    assert clock_shapes[0]["time_precision_values"] == [
        "day_phase", "unknown",
    ]
    assert clock_shapes[0]["local_date"] is None
    assert clock_shapes[4]["day_phase_hint"] == "required_enum_value"
    assert clock_shapes[5] == {
        "calendar_mode_class": "any",
        "time_precision_values": ["unknown"],
        "local_datetime": None,
        "local_date": None,
        "day_phase_hint": None,
    }
    body_location = contract["packet"]["body_location"]
    assert body_location["request_kinds"] == [
        "deepen_location", "partial_neighbor",
    ]
    assert "result_contract" in body_location["required_request_fields"]
    assert body_location["result_contract_id"] == "coc.location-body-pack.v1"
    body_requirements = body_location["result_contract_requirements"]
    assert body_requirements["closed"] is True
    assert body_requirements["parse_state_by_kind"] == {
        "deepen_location": "deep",
        "partial_neighbor": "partial",
    }
    assert body_requirements["canonical_field_names"] == {
        "location_id": "not entity_id",
        "title": "not name",
        "clues[].clue_id": "not clues[].id",
        "scene_edges[].to": "not scene_edges[].destination",
    }
    assert body_requirements["parent_repair_allowed"] is False
    handout = contract["packet"]["handout_card"]
    assert handout["request_kind"] == "deepen_handout"
    assert handout["result_contract_id"] == "coc.handout-card-pack.v1"
    assert handout["required_request_fields"] == [
        "job_id",
        "target_id",
        "requested_pdf_indices",
        "cached_page_refs",
        "allowed_registered_asset_refs",
        "allowed_scene_refs",
        "allowed_clue_refs",
        "result_contract",
    ]
    assert handout["result_contract_requirements"] == {
        "closed": True,
        "player_visible": True,
        "exact_cached_page_refs_only": True,
        "exact_registered_asset_refs_only": True,
        "verbatim_text_bound_to_cited_page_bytes": True,
        "structured_relation_refs_only": True,
        "related_packs": "must_be_empty",
        "parent_repair_allowed": False,
        "semantic_card_identification_not_keyword_gate": True,
    }
    assert opening_setup["start_clock_source_ref_required_fields"] == [
        "source_id", "pdf_index",
    ]
    assert opening_result["materially_present_npc"] == {
        "same_pack": True,
        "required_fields": ["npc_id", "agenda"],
        "agenda_scope": "source_bounded_immediate",
    }
    assert opening_result["missing_agenda_disposition"] == "soft_deferred"
    assert opening_result["replacement_before_opening"] is False
    assert opening_result["first_submission_guidance"] == {
        "authority": "advisory",
        "hard_gate": False,
        "copy_contract_values": [
            "location_pack.fixed_fields",
            "location_pack.copy_from_request",
            "location_pack.empty_defaults",
        ],
        "required_semantics_only": {
            "location_fields": ["title", "player_safe_summary"],
            "materially_present_npc_fields": ["npc_id", "agenda"],
            "npc_policy": "source_supported_and_materially_present_only",
            "opening_completeness_pass": [
                "current_situation",
                "complete_current_briefing_and_material_referenced_facts",
                "authored_choices_or_investigation_paths",
                "information_each_path_can_establish",
                "named_conditional_contacts_as_mentions",
                "materially_present_npcs",
            ],
        },
        "semantic_default_replacement": {
            "clues": "populate every source-authored clue needed to play the current beat",
            "affordances": "populate source-authored immediately usable courses of action",
            "mentions": "populate source-authored referenced entities; note may preserve current-beat context but never asserts presence, discovery, or disclosure",
            "scene_edges": "populate only source-established destination locations",
        },
        "all_empty_semantic_arrays_allowed_only_when_source_authors_none": True,
        "semantic_judgment_not_keyword_gate": True,
        "invent_unsupported_clock_route_person_or_fact": False,
        "self_check_before_status_usable": True,
        "unsatisfied_required_fields_result": {
            "status": "abstain",
            "results": [],
        },
        "parent_repair_allowed": False,
    }
    assert contract["host_adapters"]["grok"]["agent_type"] == (
        "coc-source-pack-worker"
    )
    assert contract["host_adapters"]["grok"]["agent_scope"] == (
        "focused_user_projection_of_installed_plugin"
    )
    assert contract["host_adapters"]["grok"]["mcp_server"] == (
        "coc-source-submit"
    )
    assert contract["host_adapters"]["grok"]["submit_tool"] == (
        "submit_source_result"
    )
    assert contract["host_adapters"]["codex"]["adapter"] == (
        "native_background_subagent"
    )
    locator = contract["packet"]["mechanics_locator_pass"]
    locator_pack = locator["pack_contract"]
    assert locator_pack["required_fields"] == locator_pack["allowed_fields"]
    assert locator_pack["npc_roster_row"]["allowed_fields"] == [
        "npc_id", "names", "parse_state", "source_page_indices", "source_refs",
    ]
    assert locator_pack["npc_roster_row"]["required_fields"] == (
        locator_pack["npc_roster_row"]["allowed_fields"]
    )
    assert locator_pack["npc_roster_row"]["names_semantics"] == (
        "aliases_for_one_subject_only"
    )
    assert locator_pack["npc_roster_row"]["shared_stat_block_policy"] == {
        "distinct_named_people": "separate_stable_npc_ids",
        "required_rows_per_person": ["npc_roster", "mechanics_index"],
        "may_reuse_exact_fields": [
            "source_page_indices", "source_refs", "locator_scope",
        ],
        "merge_identity_into_compound_subject": False,
    }
    assert locator_pack["mechanics_index_row"]["required_fields"] == (
        locator_pack["mechanics_index_row"]["allowed_fields"]
    )
    assert locator["no_located_subject_result"] == {
        "status": "usable",
        "copy_pack_fixed_fields": True,
        "npc_roster": [],
        "item_roster": [],
        "mechanics_index": [],
        "related_packs": [],
    }
    resolution = contract["packet"]["mechanics_resolution"]
    assert resolution["request_kinds"] == [
        "resolve_npc_mechanics", "resolve_item_mechanics",
    ]
    assert resolution["result_contract_id"] == "coc.mechanics-entity-pack.v1"
    assert resolution["live_routing"] == {
        "early_trigger": (
            "source_npc_materially_present_with_armed_or_combat_potential_and_"
            "conflict_semantically_approaching_while_profile_not_ready"
        ),
        "early_trigger_not_every_npc_or_turn": True,
        "source_required_statuses": [
            "mechanics_not_ready", "source_work_required",
        ],
        "immediate_operations": [
            "progressive.claim_host_work",
            "spawn:unqualified_coc-source-pack-worker_background_true",
        ],
        "forbidden_bypasses": [
            "rules.roll", "rules.opposed", "rules.damage",
            "copied_stub_values", "generic_profile",
        ],
        "nondependent_play_may_continue": True,
        "dependent_settlement": "existing_blocking_micro_only",
        "new_narrative_or_output_gate": False,
        "grok_parent_retrieves_child_output": False,
        "durable_profile_consumers": ["mechanics.ensure", "combat.resolve"],
        "retry_scope": "same_current_or_later_naturally_needed_action_only",
        "reassurance_poll_or_retry_loop": False,
    }
    resolution_shape = resolution["result_contract_template"]
    assert resolution_shape["closed"] is True
    assert resolution_shape["pack"]["allowed_fields"] == ["mechanics"]
    assert resolution_shape["pack"]["required_fields"] == ["mechanics"]
    assert resolution_shape["related_packs"]["wrapper_required_fields"] == [
        "subject_kind", "subject_id", "pack",
    ]
    assert "host_timing" in resolution_shape["pack"]["forbidden_fields"]
    assert resolution_shape["pack"]["mechanics"][
        "allowed_canonical_extends_ids"
    ] == "copy exact generated request contract list from the active canonical ruleset"

    agent = _text(PLUGIN_ROOT / "agents" / "coc-source-pack-worker.md")
    compact = " ".join(agent.split()).lower()
    frontmatter = agent.split("---", 2)[1]
    allowed_tools = re.search(
        r"(?ms)^tools:\n(?P<body>(?:  - [^\n]+\n)+)", frontmatter,
    )
    mcp_servers = re.search(
        r"(?ms)^mcpServers:\n(?P<body>(?:  - [^\n]+\n)+)", frontmatter,
    )
    assert allowed_tools is not None
    assert {
        line.removeprefix("  - ").strip()
        for line in allowed_tools.group("body").splitlines()
    } == {"read_file", "search_tool", "use_tool"}
    assert mcp_servers is not None
    assert mcp_servers.group("body").strip() == "- coc-source-submit"
    assert "capabilityMode: all" in frontmatter
    assert "injectDefaultTools: false" in frontmatter
    assert "  - bash\n" in frontmatter
    assert "  - task\n" in frontmatter
    for phrase in (
        "name: coc-source-pack-worker",
        "agents_md: false",
        "injectdefaulttools: false",
        "- read_file",
        "- search_tool",
        "- use_tool",
        "mcpservers:",
        "- coc-source-submit",
        "mcpinheritance: none",
        "one bare `coc.source-pack-worker.v1` json packet",
        "`result_delivery` must be exactly",
        "read only the exact absolute markdown paths",
        "never list directories",
        "open the original pdf",
        "never the keeper",
        "submit that complete outer object once",
        "search once for that exact tool name",
        "never call `coc_invoke`",
        "return only the compact `coc.source-submit-receipt.v1`",
        "child-side audit evidence only",
        "grok parent does not retrieve or consume it",
        "never put the source pack in the final task output",
        "`result_delivery=return_to_parent`",
        "do not search for or invoke any mcp",
        "never infer the transport from the host brand",
        "do not claim a wall clock",
        "/bin/cat -- <path>",
        "compile exactly one `coc.source-pack-worker.v1` json object",
        "request_purpose=foreground_opening_slice",
        "request.result_contract",
        "coc.handout-card-pack.v1",
        "allowed_registered_asset_refs",
        "allowed_scene_refs",
        "allowed_clue_refs",
        "verbatim text must occur in the exact cited cached page bytes",
        "never use keywords or regex to identify a card",
        "`deepen_location`, `partial_neighbor`, or `partial_opening`",
        "`location_id` rather than `entity_id`",
        "`title` rather than `name`",
        "`clue_id` rather than a clue `id`",
        "`scene_edges[].to` rather than `destination`",
        "`phase` and `precision` are unsupported aliases",
        "never abbreviate `day_phase_hint` or `time_precision`",
        "\"calendar_mode\": \"relative\"",
        "\"local_datetime\": null",
        "source-bounded immediate agenda",
        "copy `fixed_fields`, `copy_from_request`, and every `empty_defaults` value",
        "semantically replace defaults",
        "semantic opening-completeness",
        "all-empty `clues`/`affordances`/`mentions`",
        "never keyword matching",
        "return `status=abstain` with `results=[]`",
        "never return a parent-repairable usable result",
        "soft/deferred enrichment",
        "replacement opening pack",
        "this slice is never deep coverage",
        "plural `names` (never `name`)",
        "`names` contains aliases for that one subject only",
        "one stable `npc_id`, one roster row, and one matching index row for each person",
        "exact same `source_page_indices`, `source_refs`, and `locator_scope`",
        "never merge their identities into a compound subject or compound id",
        "genuine aliases for one person remain one subject",
        "roster, or dramatis-personae entry is not mechanics evidence",
        "authored numeric rules, parameters, or stat block",
        "primary pack is exactly `{\"mechanics\": {...}}`",
        "never return a bare related entity pack",
        "only the non-direct fallback parent may add exact `host_task_timing`",
        "allowed_canonical_extends_ids",
        "never substitute a generic family label",
        "{name, damage}` alone is not canonical",
    ):
        assert phrase in compact, phrase

    capabilities = _json(PLUGIN_ROOT / "references" / "host-capabilities.json")
    for host in ("grok", "codex"):
        assert capabilities[host]["coc_source_pack_worker_v1"] is True
        assert capabilities[host]["max_background_source_workers"] == 4

    play = _skill_package_text(PLUGIN_ROOT / "skills" / "coc-keeper-play")
    play_compact = " ".join(play.split()).lower()
    for phrase in (
        "progressive.claim_host_work",
        "progressive.register_source_bundle",
        "coc.source-pack-worker.v1",
        "blocking_micro",
        "max_background_source_workers",
        "the child never writes `.coc`",
    ):
        assert phrase in play_compact, phrase


def test_codex_source_coordinator_is_prompt_first_bounded_and_cursor_fail_closed():
    contract = _json(
        PLUGIN_ROOT / "references" / "source-coordinator-v1.json"
    )
    assert contract["contract_id"] == "coc.source-coordinator.v1"
    assert contract["status"] == "experimental"
    assert contract["product_complete"] is False
    assert contract["parity_claim"] is False
    assert contract["canonical_caller"]["owner"] == "main_keeper"
    assert contract["canonical_caller"]["background"] is True
    assert contract["packet"]["closed"] is True
    assert contract["packet"]["main_keeper_mutation_allowed"] is False
    claim_contract = contract["packet"]["claim_operation"]
    assert claim_contract["result_delivery_values"] == [
        "return_to_parent", "task_return_to_parent",
    ]
    assert claim_contract["default_result_delivery"] == "return_to_parent"
    assert claim_contract["transport_variations"]["pi_private_lifecycle"] == {
        "result_delivery": "task_return_to_parent",
        "claim_result_field": "dispatch_tasks",
        "task_contract": "coc.pi-source-pack-task.v1",
        "repository_produced_wrappers_only": True,
        "optional_private_exact_claim_field": "current_dependency_claim",
        "private_exact_claim_cardinality": 1,
        "main_keeper_may_supply_private_exact_claim": False,
    }
    assert contract["packet"]["leaf_worker"]["prompt_binding_by_transport"] == {
        "bare_packet_coordinator": (
            "one exact bare coc.source-pack-worker.v1 value from packets[]"
        ),
        "pi_private_lifecycle": (
            "one exact repository-produced coc.pi-source-pack-task.v1 value "
            "from dispatch_tasks[]"
        ),
    }
    lifecycle = contract["lifecycle"]
    assert lifecycle["manager_background"] is True
    assert lifecycle["leaf_background"] is False
    assert lifecycle["main_keeper_waits"] is False
    assert lifecycle["main_keeper_retrieves_result"] is False
    assert lifecycle["coordinator_self_repairs_or_retries"] is False
    assert lifecycle["pi_dispatch_manager_automatic_retry"] is True
    assert lifecycle["pi_interim_retry_terminal_delivery"] is False
    assert lifecycle["pi_interim_retry_parent_wake"] is False
    assert lifecycle["pi_parent_terminal_delivery"] == (
        "append_final_receipt_then_wake_only_structured_blocking_opening_or_"
        "exact_fulfilled_current_dependency"
    )
    assert lifecycle["pi_nonblocking_background_parent_wake"] is False
    assert lifecycle["pi_hidden_continuation_source"] == (
        "final_validated_receipt_plus_structured_blocking_opening_or_exact_"
        "current_dependency_dispatch_identity"
    )
    assert contract["authority"]["max_nesting_depth"] == 2
    result_contract = contract["result_contract"]
    assert result_contract["status_values"] == [
        "fulfilled", "partial", "idle", "failed",
    ]
    assert result_contract["optional_fields"] == [
        "diagnostics", "lease_release",
    ]
    assert result_contract["lease_release"] == {
        "presence": "required_only_for_turn_pending_finalization_deferred",
        "closed": True,
        "required_fields": ["status"],
        "status_values": ["release_confirmed", "ttl_fallback"],
    }
    diagnostics = result_contract["diagnostics"]
    assert diagnostics["presence"] == (
        "optional_only_when_deterministic_lifecycle_supplies_it"
    )
    assert diagnostics["forwarding"] == "unchanged"
    assert diagnostics["maximum_items"] == 4
    assert diagnostics["item_closed"] is True
    assert diagnostics["item_required_fields"] == [
        "schema_version", "contract_id", "phase", "code",
        "validation_path", "lease_id", "job_ids",
    ]
    assert diagnostics["phase_values"] == [
        "claim_projection", "leaf_result",
    ]
    assert "claim_wire_projection_failed" in diagnostics["code_values"]
    assert "leaf_result_packet_binding_drift" in diagnostics["code_values"]
    assert (
        "claim.wire.claim_dispatch_projection_failed"
        in diagnostics["validation_path_values"]
    )
    assert "$.packet_id|$.work_group_id" in (
        diagnostics["validation_path_values"]
    )
    runtime_source = _text(PLUGIN_ROOT / "pi" / "lib" / "runtime.ts")

    def runtime_string_set(name: str) -> set[str]:
        match = re.search(
            rf"const {name} = new Set(?:<[^>]+>)?\(\[(.*?)\]\);",
            runtime_source,
            re.DOTALL,
        )
        assert match is not None, name
        return set(re.findall(r'"([^"]+)"', match.group(1)))

    assert set(result_contract["status_values"]) == runtime_string_set(
        "COORDINATOR_STATUSES"
    )
    assert set(result_contract["failure_class_values"]) == runtime_string_set(
        "COORDINATOR_FAILURES"
    )
    assert set(diagnostics["code_values"]) == runtime_string_set(
        "SOURCE_VALIDATION_CODES"
    )
    assert set(diagnostics["validation_path_values"]) == runtime_string_set(
        "SOURCE_VALIDATION_PATHS"
    )
    failure = contract["failure_policy"]
    assert failure["authority"] == "prompt_first_advisory"
    assert failure["single_failure"] == "transient_allowed"
    assert failure["same_failure_escalation_threshold"] == 3
    assert failure["threshold_outcome"] == "design_issue"
    assert failure["threshold_scope"] == (
        "cross_run_design_review_not_single_run_terminal_status"
    )
    assert failure["runtime_gate"] is False
    assert failure["player_output_gate"] is False
    assert failure["coordinator_self_retry"] is False
    manager_retry = failure["manager_automatic_retry_by_adapter"]
    assert manager_retry["bare_packet_coordinator"] == {"enabled": False}
    assert manager_retry["pi_private_lifecycle"] == {
        "enabled": True,
        "owner": "pi_source_coordinator_dispatch_manager",
        "same_task_retry": True,
        "manager_repairs_receipt_or_leaf_result": False,
        "retryable_failure_classes": ["fulfill_rejected"],
        "non_retryable_deferred_failure_classes": [
            "turn_pending_finalization_deferred"
        ],
        "deferred_action": (
            "attempt_exact_owned_release_then_wait_for_normal_post_"
            "finalization_takeover_or_bounded_ttl"
        ),
        "require_status": "failed",
        "require_positive_claimed": True,
        "require_zero_fulfilled": True,
        "max_attempts": 2,
        "attempt_semantics": "original_attempt_plus_at_most_one_retry",
        "interim_terminal_receipt_published": False,
        "interim_parent_wake": False,
        "final_terminal_receipt_published_once": True,
        "final_hidden_continuation": (
            "only_for_structured_blocking_opening_or_exact_fulfilled_current_"
            "dependency_receipt_derived_deduplicated_triggerTurn_true"
        ),
    }

    codex = contract["host_adapters"]["codex"]
    assert codex["status"] == "experimental"
    assert codex["adapter_mode"] == "codex_nested_cli_exact_forward"
    assert codex["coordinator_runner"] == "codex_collaboration_subagent"
    assert codex["coordinator_fork_turns"] == "none"
    assert codex["coordinator_model_policy"] == "inherit_parent"
    assert codex["coordinator_instruction_ref"] == (
        "runtime_absolute_plugin_path"
    )
    assert codex["leaf_instruction_ref"] == "runtime_absolute_plugin_path"
    assert codex["leaf_model_policy"] == "inherit_parent"
    assert codex["nested_task_proven"] is True
    assert codex["canonical_toolbox_cli_proven"] is True
    assert codex["json_transport"] == "stdin"
    assert codex["coordinator_can_claim"] is True
    assert codex["coordinator_can_fulfill"] is True
    assert codex["end_to_end_claim_leaf_fulfill_proven"] is True
    assert codex["proof_scope"] == "one cached partial_opening work group"
    assert codex["player_path_acceptance"] is False
    assert codex["same_failure_observations"] == 0

    pi = contract["host_adapters"]["pi"]
    assert pi["status"] == "experimental"
    assert pi["adapter_mode"] == "pi_private_lifecycle"
    assert pi["claim_transport"] == "pi_private_lifecycle"
    assert pi["claim_result_delivery"] == "task_return_to_parent"
    assert pi["claim_result_field"] == "dispatch_tasks"
    assert pi["end_to_end_claim_leaf_fulfill_proven"] is True
    assert pi["same_failure_observations"] == 0

    cursor = contract["host_adapters"]["cursor"]
    assert cursor["status"] == "unavailable"
    assert cursor["adapter_mode"] == "nested_mcp_unavailable_2026_07_17"
    assert cursor["version_checked"] == "2026.07.17-3e2a980"
    assert cursor["model_checked"] == "cursor-grok-4.5-high"
    assert cursor["coordinator_can_task"] is True
    assert cursor["coordinator_can_mcp"] is False
    assert cursor["interactive_background_task"] is True
    assert cursor["headless_print_task"] is False
    assert cursor["observed_failure_class"] == "capability_mismatch"
    assert cursor["same_failure_observations"] == 3
    assert cursor["threshold_outcome"] == "design_issue"
    assert contract["host_adapters"]["grok"] == {
        "status": "unavailable",
        "adapter_mode": "nested_task_depth_unsupported",
        "alternate_multi_group_path": "parent_flat_fanout",
        "alternate_capability": "coc_source_parent_fanout_v1",
        "alternate_adapter": "grok_top_level_named_submit",
        "note": (
            "Grok max nesting depth is one; multi-group ready work uses "
            "main-KP claim plus parallel top-level source-pack workers, not "
            "this nested coordinator"
        ),
    }

    capabilities = _json(
        PLUGIN_ROOT / "references" / "host-capabilities.json"
    )
    assert capabilities["cursor"]["native_background_subagent"] is True
    assert capabilities["cursor"]["coc_source_pack_worker_v1"] is False
    assert capabilities["cursor"]["coc_source_coordinator_v1"] is False
    assert capabilities["cursor"]["coc_source_coordinator_v1_status"] == (
        "unavailable"
    )
    assert capabilities["cursor"]["coc_source_coordinator_v1_adapter"] == (
        "nested_mcp_unavailable_2026_07_17"
    )
    assert capabilities["cursor"]["max_source_coordinator_leaves"] == 0
    assert capabilities["codex"]["coc_source_coordinator_v1"] is True
    assert capabilities["codex"]["coc_source_coordinator_v1_status"] == (
        "experimental"
    )
    assert capabilities["codex"]["coc_source_coordinator_v1_adapter"] == (
        "codex_nested_cli_exact_forward"
    )
    assert capabilities["codex"]["max_source_coordinator_leaves"] == 4
    assert capabilities["codex"]["coc_opening_source_coordinator_v1"] is True
    assert capabilities["codex"]["coc_opening_source_coordinator_v1_status"] == (
        "experimental"
    )
    assert capabilities["codex"]["coc_opening_source_coordinator_v1_adapter"] == (
        "codex_context_free_inline_source"
    )
    assert capabilities["grok"]["coc_source_coordinator_v1"] is False
    assert capabilities["grok"]["coc_source_parent_fanout_v1"] is True
    assert capabilities["grok"]["coc_source_parent_fanout_v1_status"] == (
        "experimental"
    )
    assert capabilities["grok"]["coc_source_parent_fanout_v1_adapter"] == (
        "grok_top_level_named_submit"
    )

    agent = _text(PLUGIN_ROOT / "agents" / "coc-source-coordinator.md")
    compact = " ".join(agent.split()).lower()
    frontmatter = agent.split("---", 2)[1]
    for phrase in (
        "name: coc-source-coordinator",
        "`coc.codex-source-coordinator-task.v1`",
        "invoke it exactly once",
        "context-free codex collaboration subagent",
        "`fork_turns=none`",
        "`--json-stdin`",
        "never interpolate json into a shell command",
        "`leaf_result_not_bare`",
        "do not extract a json object",
        "repair fields, retry, or ask the leaf again",
        "`progressive.fulfill_host_work` operation exactly once",
        "a single classified failure is allowed to remain transient",
        "three observed occurrences of the same failure class",
        "a design issue, not acceptable model variance",
        "not a new product gate",
        "task support by itself is insufficient",
        "coordinator process itself never retries",
        "maximum is two total attempts",
        "`failure_class=fulfill_rejected`",
        "`claimed_packet_count>0`",
        "`fulfilled_result_count=0`",
        "interim rejected-fulfillment receipt is neither published as terminal",
        "a structured `nonblocking_background` terminal",
        "never triggers a hidden model turn",
        "structured `blocking_opening` terminal",
        "deduplicated hidden continuation with `triggerturn=true`",
        "optional closed `diagnostics` array",
        "never construct it from provider text or raw error strings",
        "never invent a historical count or return `status=design_issue`",
    ):
        assert phrase in compact, phrase
    assert "  - Task\n" in frontmatter
    assert "  - coc-keeper\n" in frontmatter
    assert "mcpInheritance: none" in frontmatter

    skill_text = " ".join(
        (
            _skill_package_text(PLUGIN_ROOT / "skills" / "coc-keeper-play")
            + _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md")
            + _text(
                PLUGIN_ROOT / "skills" / "coc-scenario-import" / "SKILL.md"
            )
            + _text(PLUGIN_ROOT / "agents" / "coc-keeper-kp.md")
        ).split()
    ).lower()
    for phrase in (
        "`coc_source_coordinator_v1=true`",
            "`progressive.background_takeover.coordinator_dispatch.codex_task`",
        "`coordinator_fanout`",
        "`parent_flat_fanout`",
        "`coc_source_parent_fanout_v1=true`",
        "`claim_then_spawn_named_workers`",
        "`fork_turns=none`",
        "three observed occurrences of the same class",
        "a design issue",
        "never gates player input",
    ):
        assert phrase in skill_text, phrase


def test_pi_coordinator_capability_separates_failed_grok_probe_from_promotion():
    pi = _json(
        PLUGIN_ROOT / "references" / "host-capabilities.json"
    )["pi"]
    assert pi["coc_source_coordinator_v1"] is True
    assert pi["coc_source_coordinator_v1_status"] == "experimental"
    assert pi["coc_source_coordinator_v1_provider_evidence"] == (
        "openai_gpt_5_6_luna_probe_only"
    )
    assert pi["coc_source_coordinator_v1_grok_evidence"] == (
        "failed_nonpromoting_host_experience_probe"
    )
    evidence_ref = pi["coc_source_coordinator_v1_grok_evidence_ref"]
    assert evidence_ref == "tests/pi/pi-grok-host-experience-evidence.json"
    evidence = _json(ROOT / evidence_ref)
    assert evidence["schema_version"] == 1
    assert evidence["probe_kind"] == "pi_grok_host_experience_probe"
    assert evidence["engineering_probe"] is True
    assert evidence["acceptance"] is False
    assert evidence["canonical_acceptance"] is False
    assert evidence["promotion_eligible"] is False
    assert evidence["probe_status"] == "failed"
    assert evidence["overall_verdict"] == "FAIL"
    assert evidence["battle_report"] is False
    assert evidence["implementation_commit"] == (
        "dae608895844377e40c9e252fe7061d54220f03f"
    )
    assert evidence["environment"] == {
        "host": "pi",
        "provider": "xai",
        "model_id": "grok-4.5",
        "thinking": "low",
        "hide_thinking_block": True,
        "transport": "openai-responses",
    }
    assert evidence["identifiers"] == {
        "session_id": "pi-grok-hoyk-probe9-20260727",
        "workspace_root": ".tmp/pi-grok-live-probe9.Iq2uch",
        "campaign_id": "hoyk-probe9-20260727",
        "investigator_id": "aldric9",
        "opening_job_id": "job-2051e02504ef",
        "deepen_job_id": "job-18896a196964",
        "opening_packet_id": "source-coordinator-3451a8e64aefc5aec5c5",
    }
    assert evidence["artifacts"]["session_jsonl"] == {
        "path": (
            "/private/tmp/chatrpgv4-pi-grok-probe9-agent.w4XrDy/sessions/"
            "--Users-haoli-leehow-code-chatrpgv4-.tmp-pi-grok-live-probe9."
            "Iq2uch--/2026-07-27T23-21-29-197Z_pi-grok-hoyk-probe9-"
            "20260727.jsonl"
        ),
        "lines": 115,
        "bytes": 491142,
        "sha256": (
            "1e2ed99b0b9bbb093108d8667fc950dc9cabc6322dbc893ce96704da56147bf9"
        ),
    }
    assert evidence["opening_source_selection"] == {
        "selected_pdf_indices": [3, 4],
        "shortest_semantically_complete_pdf_indices": [3],
        "keeper_secret_visible_to_player": False,
        "minimal": False,
        "source_window_verdict": "fail_nonminimal",
    }
    assert evidence["final_output_contract"] == {
        "status": "pass",
        "finalization_id": (
            "turn-effect-v1:9b16385d7ebbf65915e13d5b03b5e7323b8f164e"
        ),
        "rendered_sha256": (
            "sha256:9b243078541bfe478103bdcabb8cff235fc324377c48d4e2a99"
            "ade9169899fc3"
        ),
        "finalizer_session_line": 114,
        "exact_assistant_session_line": 115,
        "exact_assistant_match_count": 1,
        "quiet_window_seconds": 30,
        "later_output_observed": False,
        "mismatch_replacement_live_coverage": "not_exercised",
        "mismatch_replacement_deterministic_test_coverage": True,
        "coverage_qualification": (
            "The provider itself emitted the exact canonical receipt text, "
            "so the host replacement branch was not exercised live."
        ),
    }
    assert evidence["opening_coordinator_lifecycle"] == {
        "auto_dispatch_observed": True,
        "claim_calls": 1,
        "claimed_packet_count": 1,
        "leaf_task_count": 1,
        "fulfilled_result_count": 1,
        "terminal_status": "fulfilled",
        "project_opening_call_count": 7,
        "premature_state_mutation_observed": True,
        "projection_status": "failed",
        "projection_failure_class": "opening_projection_non_pristine",
        "canonical_projection_integrated": False,
        "scenario_locations_empty": True,
    }
    assert evidence["subsequent_deepen_lifecycle"] == {
        "job_id": "job-18896a196964",
        "kind": "deepen_location",
        "job_dispatch_state": "awaiting_scope",
        "dispatch_attempts": 0,
        "heterogeneous_family_claim_exercised": False,
    }
    assert evidence["player_boundary"]["natural_player_action_count"] == 1
    assert evidence["player_boundary"]["source_secrecy"] == "pass"
    assert evidence["player_boundary"][
        "visible_tool_or_operational_leakage"
    ] is False
    assert evidence["player_boundary"]["opening_fidelity"] == "fail"
    assert evidence["player_boundary"]["compound_action_uptake"] == (
        "fail_partial"
    )
    assert [failure["kind"] for failure in evidence[
        "host_experience_failures"
    ]] == [
        "nonminimal_opening_window",
        "premature_played_state_mutation",
        "canonical_projection_non_pristine",
        "authored_opening_omission",
        "source_identity_and_mission_drift",
        "clock_and_fiction_divergence",
        "partial_compound_action_uptake",
        "tool_efficiency_and_recovery",
    ]
    legacy_path = ROOT / "tests/pi/real-lifecycle-evidence.json"
    legacy = _json(legacy_path)
    assert legacy["environment"]["model"] == {
        "provider": "coding-relay",
        "model_id": "gpt-5.6-luna",
        "thinking": "low",
    }
    assert legacy["acceptance"] is False
    assert legacy["engineering_probe"] is True
    assert hashlib.sha256(legacy_path.read_bytes()).hexdigest() == (
        "64da666e26c635ccc0eff9ec0fdf7451f8d6e22c1f8c0e3cea6ef3ce56419449"
    )
    assert evidence["preserved_openai_probe_evidence"] == {
        "path": "tests/pi/real-lifecycle-evidence.json",
        "sha256": (
            "64da666e26c635ccc0eff9ec0fdf7451f8d6e22c1f8c0e3cea6ef3ce56419449"
        ),
        "engineering_probe": True,
        "acceptance": False,
        "provider": "coding-relay",
        "model_id": "gpt-5.6-luna",
        "thinking": "low",
        "preserved_unchanged": True,
    }
    assert evidence_ref != "tests/pi/real-lifecycle-evidence.json"
    fix8, fix7, fix6 = evidence["prior_probes"]
    assert fix8["revision_label"] == "FIX8"
    assert [run["session_jsonl"]["sha256"] for run in fix8["runs"]] == [
        "e15db0d4e0b7f936bee105e824e46722f78ac421b7de705a0226ae40a8f3ce95",
        "eae7d241e5b312988dc32fd52367fd6f3b2bcac62878585a3711dc36acb7490d",
        "b8c001e1fc12c6057cf1e332e30874ec1503c8ac458ca0a99525571d5fe3a301",
    ]
    assert fix8["runs"][2]["final_output_contract"]["status"] == "fail"
    assert fix8["runs"][2]["nonblocking_terminal_wake_count"] == 0
    assert fix7["revision_label"] == "FIX7"
    assert fix7["artifacts"]["session_jsonl"]["sha256"] == (
        "acce5fe480046fc3a6e91fe06525e54e528ef9fb34858349352962a5a5f2d179"
    )
    assert fix7["post_finalization_suppression"]["status"] == "fail"
    assert fix6["identifiers"]["session_id"] == "pi-grok-hoyk-fix6-20260727"
    assert fix6["artifacts"]["session_jsonl"]["sha256"] == (
        "99394da70c990c61ca4ff68149a1a8be7657ec28b9a3902032fd5e45eb269d98"
    )
    assert (
        fix6["prior_probes"][0]["artifacts"]["session_jsonl"]["sha256"]
        == "7b5945384523b8c4e4e7ce6f991dd679f50bd7ed814552b139d3ed122ea7aed3"
    )
    readme = _text(PLUGIN_ROOT / "pi" / "README.md")
    for phrase in (
        "openai/gpt-5.6-luna",
        "xai/grok-4.6",
        '"defaultProvider": "xai"',
        '"defaultThinkingLevel": "low"',
        '"hideThinkingBlock": true',
        "xAI Grok 4.6 supports `low`, `medium`, `high`, and",
        "`xhigh`; true `off` is unsupported",
        # hideThinkingBlock hides table-UI output only; provider reasoning
        # (and its latency) still runs — the README must keep that distinction.
        "`hideThinkingBlock: true`; hiding thought summaries from",
        "but does not disable provider reasoning",
        "must never discover",
    ):
        assert phrase in readme


def test_opening_handoff_labels_dated_grok45_evidence_as_historical():
    handoff = _text(ROOT / "docs" / "status" / "opening-lifecycle-handoff.md")
    # Dated acceptance-scene evidence stays grok-relay / grok-4.5 and must
    # remain explicitly labeled historical; the current pi-coc default is
    # xai/grok-4.6 pinned elsewhere.
    assert "2026-08-20" in handoff
    assert "历史验收证据所用模型：grok-relay / grok-4.5" in handoff


def test_pi_ocr_adapter_does_not_produce_source_bundles():
    adapter = _text(PLUGIN_ROOT / "pi" / "bin" / "coc-ocr-adapter.py")
    assert 'choices=["status", "fast", "enhance", "export"]' in adapter
    for forbidden in (
        "def op_bundle",
        '"bundle"',
        "--source",
        "--max-pages",
        '"producer": "codex-pdf-skill"',
        '"printed_page"',
        '"printed_label"',
        '"parse_confidence":',
        '"auto_accepted"',
        "manifest_path.write_text",
        "pages = pages[:32]",
        "import subprocess, hashlib",
    ):
        assert forbidden not in adapter
    readme = " ".join(_text(PLUGIN_ROOT / "pi" / "README.md").split()).lower()
    for phrase in (
        "returns exactly one strict json object",
        "reports only external ocr corpus facts",
        "never creates, validates, or mutates `manifest.json`",
        "does not form a validated source bundle",
        "external pdf skill/contract producer",
    ):
        assert phrase in readme


def test_codex_opening_source_coordinator_is_a_bounded_parallel_document_lane():
    contract = _json(
        PLUGIN_ROOT / "references" / "opening-source-coordinator-v1.json"
    )
    assert contract["contract_id"] == "coc.opening-source-coordinator.v1"
    assert contract["status"] == "experimental"
    assert contract["product_complete"] is False
    assert contract["parity_claim"] is False
    assert contract["task"]["fixed_fields"] == {
        "schema_version": 1,
        "contract_id": "coc.codex-opening-source-task.v1",
        "bootstrap_instruction": (
            "Before any response or tool call, read instruction_ref completely, "
            "then execute this closed task under that instruction."
        ),
        "adapter_mode": "codex_context_free_inline_source",
        "model_policy": "inherit_parent",
        "max_selected_opening_pages": 3,
        "result_delivery": "task_return_to_parent",
    }
    assert contract["authority"]["may_create_or_link_investigator"] is False
    assert contract["authority"]["may_roll_rules"] is False
    assert contract["authority"]["may_choose_player_action_or_keeper_prose"] is False
    assert contract["authority"]["max_nesting_depth"] == 1
    assert contract["authority"]["nested_agent_types"] == []
    assert contract["authority"]["foreground_single_group_execution"] == (
        "same_coordinator_inline"
    )
    assert contract["task"]["opening_locator_pdf_indices"]["minimum_count"] == 0
    assert contract["task"]["opening_locator_pdf_indices"]["empty_list_meaning"] == (
        "coordinator_owns_named_scenario_cold_locator"
    )
    assert contract["task"]["opening_window_semantics"] == {
        "semantic_judgment": True,
        "keeper_facing_scenario_synopsis_is_complete_playable_opening": False,
        "requires_complete_current_player_facing_beat": True,
        "requires_source_authored_actionable_routes_when_available": True,
        "requires_route_information_for_the_current_beat": True,
        "adjacent_current_opening_page_replaces_or_extends_synopsis": True,
        "source_clock_replaces_era_default": True,
        "ungrounded_default_exact_clock_allowed": False,
    }
    assert contract["task"]["render_output_path_binding"] == {
        "batch_directory_is_task_local_and_exact": True,
        "capture_actual_paths_once": True,
        "visual_tool_receives_exact_returned_paths": True,
        "forbid_batch_position_filename_derivation": True,
        "forbid_pdf_index_filename_derivation": True,
        "forbid_guessed_zero_padding": True,
        "missing_or_ambiguous_path_failure_class": "pdf_scope_failed",
    }
    assert contract["task"]["visual_review_transport"] == {
        "request_contract_id": "coc.opening-visual-review-request.v1",
        "resume_contract_id": "coc.opening-visual-review-resume.v1",
        "max_images": 3,
        "result_delivery": "same_thread_image_resume",
        "render_root_is_exact_task_local_directory": True,
        "request_paths_are_exact_regular_non_symlink_direct_children": True,
        "request_indices_and_paths_have_same_order_and_count": True,
        "adapter_attaches_only_validated_exact_paths": True,
        "same_child_thread_required": True,
        "second_request_forbidden": True,
    }
    assert contract["lifecycle"]["main_keeper_dispatches_before_pdf_locator_or_concepts"] is True
    assert contract["lifecycle"]["blocking_phase"] == "concept_locator_natural_return"
    assert contract["lifecycle"]["background_phase"] == (
        "same_child_exact_followup_source_build"
    )
    assert contract["lifecycle"]["main_keeper_exact_forwards_continue_task"] is True
    assert contract["lifecycle"]["no_in_turn_parent_callback"] is True
    assert contract["lifecycle"]["optional_visual_review_bridge"] == {
        "only_when_child_image_inspection_unavailable": True,
        "request_contract": "coc.opening-visual-review-request.v1",
        "resume_contract": "coc.opening-visual-review-resume.v1",
        "transport": "same_thread_image_resume",
        "maximum_images": 3,
        "adapter_lifecycle_checkpoint": "visual_review_ready",
        "ready_checkpoint_is_restart_resumable": True,
        "started_checkpoint_is_terminal_on_restart": True,
        "same_thread_identity_required": True,
        "coordinator_visually_inspects_all_attached_images": True,
        "pdf_reopen_or_rerender_after_resume": False,
    }
    assert contract["lifecycle"]["binding_call"] == {
        "operation": "setup.invoke",
        "kind": "scenario.bind_pdf",
        "required_payload_fields": [
            "campaign_id",
            "scenario_id",
            "title",
            "source_bundle_path",
        ],
        "values_from_retained_closed_task": True,
    }
    assert contract["lifecycle"]["review_fulfillment"] == {
        "public_tool": False,
        "execution_owner": "opening_source_coordinator",
        "pending_task_contract_id": "coc.opening-source-review-task.v1",
        "contract_id": "coc.opening-source-review-fulfillment.v1",
        "retained_continuation_identity_hash_bound": True,
        "campaign_scenario_bundle_and_source_scope_hash_bound": True,
        "canonical_scope_signature_required": True,
        "private_challenge_and_generation_required": True,
        "single_terminal_consumption": True,
        "ordinary_setup_promotion_forbidden": True,
    }
    assert contract["lifecycle"]["main_keeper_character_flow_continues_without_waiting"] is True
    assert contract["lifecycle"]["foreground_source_execution"] == (
        "same_coordinator_inline"
    )
    assert contract["lifecycle"]["foreground_source_nested_task"] is False
    assert contract["lifecycle"]["foreground_source_claim_delivery"] == (
        "return_to_parent"
    )
    assert contract["host_adapters"]["codex"]["nested_source_worker"] is False
    assert contract["host_adapters"]["codex"]["inline_foreground_source"] is True
    assert contract["failure_policy"]["same_failure_escalation_threshold"] == 3
    manifest_contract = contract["source_bundle_manifest_contract"]
    assert manifest_contract["closed_minimum"] is True
    assert manifest_contract["exact_relative_path"] == "manifest.json"
    assert manifest_contract["alternate_filenames_allowed"] is False
    assert manifest_contract["template"]["producer"] == "codex-pdf-skill"
    assert manifest_contract["template"]["source"] == {
        "source_id": "pdf:<source_bundle_id>",
        "title": "<task title>",
        "path": "<absolute task pdf_path>",
        "file_sha256": "<task pdf_sha256>",
        "page_count": "<positive host-observed PDF page count>",
    }
    assert manifest_contract["template"]["assets"] == []
    assert manifest_contract["forbidden_shortcut_fields"] == [
        "source_bundle_id",
        "pdf_sha256",
        "pages[].path",
    ]
    assert manifest_contract["forbidden_manifest_filenames"] == [
        "source_bundle_manifest.json",
    ]

    agent = _text(PLUGIN_ROOT / "agents" / "coc-opening-source-coordinator.md")
    compact = " ".join(agent.split()).lower()
    for phrase in (
        "name: coc-opening-source-coordinator",
        "one bounded document lane",
        "`coc.codex-opening-source-task.v1`",
        "render every bounded locator candidate in one batch",
        "capture the actual output paths once with a bounded listing",
        "pass those returned paths unchanged to visual inspection",
        "never build an image path from batch position",
        "do not guess, rerender, or search outside that exact directory",
        "shortest accepted contiguous one-to-three-page opening window",
        "scenario synopsis that merely says what the investigators will investigate",
        "select that page instead of the synopsis",
        "ungrounded default exact date or phase must never reach the opening",
        "`coc.opening-character-concepts.v1`",
        "`coc.opening-source-continue.v1`",
        "stop this task turn and naturally return",
        "task name does not activate this file",
        "one direct `apply_patch` call",
        "do not discover `scenario.bind_pdf`",
        "do not omit or move any of those four payload fields",
        "never put that provenance value in a setup payload",
        "`execution_owner=opening_source_coordinator`",
        "`dispatch_mode=inline_single_owner`",
        "`action=claim_and_compile_inline`",
        "do not spawn another agent",
        "do not reopen the pdf",
        "do not move the live scene",
        "do not read the full `trpg-pdf-ingest`",
        "do not make a preliminary no-window call",
        "`skeleton_argument_contract.start_clock_source_ref_template`",
        "`source_bundle_manifest_contract.template`",
        "`<source_bundle_path>/manifest.json`",
        "never emit the task-oriented shortcut shape",
        "`opening_delivery_boundary`",
        "three observed occurrences of the same class are a design issue",
    ):
        assert phrase in compact, phrase

    combined = " ".join((
        _text(PLUGIN_ROOT / "agents" / "coc-keeper-kp.md")
        + _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md")
        + _text(PLUGIN_ROOT / "skills" / "coc-scenario-import" / "SKILL.md")
        + _text(PLUGIN_ROOT / "skills" / "trpg-pdf-ingest" / "SKILL.md")
    ).split()).lower()
    for phrase in (
        "`coc_opening_source_coordinator_v1=true`",
        "`fork_turns=none`",
        "before any title crawl",
        "task naming alone",
        "copy the retained",
        "never synthesize",
        "`followup_task`",
        "same idle child",
        "then immediately continue characteristic rolls",
        "document parsing and character/rules work are independent lanes",
        "`task_variable_fields`",
        "`pdf_identity_before_dispatch`",
        "sole pdf/source-skill consumer",
        "does not load `coc-scenario-import`, `trpg-pdf-ingest`, or `coc-campaign-state`",
        "wait only",
    ):
        assert phrase in combined, phrase



def test_fresh_raw_pdf_skill_catalog_routes_only_through_coc_main():
    descriptions = {}
    for name in (
        "coc-main",
        "coc-keeper-play",
        "coc-scenario-import",
        "coc-campaign-state",
    ):
        text = _text(PLUGIN_ROOT / "skills" / name / "SKILL.md")
        frontmatter = text.split("---", 2)[1]
        descriptions[name] = next(
            line.removeprefix("description:").strip()
            for line in frontmatter.splitlines()
            if line.startswith("description:")
        ).lower()

    assert "only main-session skill selected initially" in descriptions["coc-main"]
    assert "fresh raw-pdf" in descriptions["coc-main"]
    assert "never select during fresh raw-pdf setup" in descriptions[
        "coc-keeper-play"
    ]
    assert "do not select it in the main session for a fresh codex raw-pdf opening" in (
        descriptions["coc-scenario-import"]
    )
    assert "must not select this skill merely to create a campaign" in descriptions[
        "coc-campaign-state"
    ]


def test_preconfirmation_opening_warm_start_uses_a_real_background_task():
    main = " ".join(
        _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md").split()
    ).lower()
    for phrase in (
        "only after confirmation use `investigator.create`",
        "the card is not an opening gate",
        "pre-confirmation opening warm start",
        "`progressive.prepare_opening`",
        "structured `start_location`",
        "`progressive.opening_bootstrap`",
        "campaign-owned automatic-projection watch",
        "required `opening_setup`",
        "main kp must not call `progressive.publish_skeleton`",
        "on pi, the package auto-dispatches",
        "must not discover or invoke `progressive.claim_host_work`",
        "`progressive.renew_host_work_leases`",
        "`progressive.release_host_work_leases`",
        "`progressive.status` is neither its completion signal",
        "passively wait for the one host terminal lifecycle notice",
        "auto-projected opening setup",
        "named submit owns merge",
        "character work continues in parallel",
        "selected shortest sufficient window must begin there",
        "downstream arrival or investigation page cannot substitute",
        "supported civil/day phase, weather, transport, and mission",
        "never a keyword selector or prose gate",
    ):
        assert phrase in main, phrase

    scenario = " ".join(
        _text(
            PLUGIN_ROOT / "skills" / "coc-scenario-import" / "SKILL.md"
        ).split()
    ).lower()
    for phrase in (
        "pre-confirmation opening warm start",
        "`progressive.prepare_opening`",
        "`progressive.opening_bootstrap`",
        "campaign-owned automatic-projection watch",
        "`coc.opening-setup-observation.v1` `opening_setup`",
        "exact window refs and source-supported clock precision",
        "otherwise it returns `status=unresolved`",
        "private lifecycle operations hidden from the main-kp discovery surface",
        "never actively wait, poll, retrieve source output, or perform a reassurance query",
        "passively await the one host terminal lifecycle notice",
        "does not authorize `progressive.status`, a second prepare/bootstrap",
        "parent never reconstructs or repairs it",
        "main kp never calls `project_opening`",
        "must not fake a task",
        "grok acceptance must preserve the real host task/completion",
    ):
        assert phrase in scenario, phrase

    profile = " ".join(
        _text(PLUGIN_ROOT / "agents" / "coc-keeper-kp.md").split()
    ).lower()
    for phrase in (
        "`progressive.prepare_opening`",
        "`progressive.opening_bootstrap`",
        "campaign-owned automatic-projection watch",
        "required closed `opening_setup` observation",
        "source-supported clock precision with exact window refs",
        "on pi, stop at the returned `background_takeover`",
        "package auto-dispatches the exact private coordinator",
        "must not discover or invoke `progressive.claim_host_work`",
        "`progressive.renew_host_work_leases`",
        "`progressive.release_host_work_leases`",
        "must not author a pack",
        "`progressive.status` is not a coordinator completion signal",
        "passively await the one host terminal lifecycle notice",
        "auto-projected `opening_setup`",
        "naturally needed canonical query",
        "real grok acceptance must use the focused keeper launcher",
        "shortest sufficient window must begin there",
        "downstream arrival or investigation page cannot replace",
        "supported civil/day phase, weather, transport, and mission",
        "never a keyword selector",
    ):
        assert phrase in profile, phrase

    tooling = " ".join(
        _text(
            PLUGIN_ROOT
            / "skills"
            / "coc-keeper-play"
            / "references"
            / "turn-tooling-and-typed-ops.md"
        ).split()
    ).lower()
    for phrase in (
        "`progressive.prepare_opening`",
        "`progressive.opening_bootstrap`",
        "campaign-owned watch",
        "`coc.opening-setup-observation.v1` `opening_setup`",
        "exact source-supported clock precision and request-window refs",
        "pi stops at the projection",
        "package auto-dispatch the private lifecycle",
        "main kp performs none of the four claim/fulfill/renew/release operations",
        "does not call `progressive.status`, repeat preparation/bootstrap",
        "passively awaits the one host terminal notice",
        "consume durable availability only through a later naturally needed canonical",
        "campaign watch owns opening projection",
        "real grok acceptance uses the focused keeper launcher",
    ):
        assert phrase in tooling, phrase


def test_resume_is_continuation_only_not_fresh_setup_rehydration():
    surfaces = {
        "main": _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md"),
        "play": _text(
            PLUGIN_ROOT / "skills" / "coc-keeper-play" / "SKILL.md"
        ),
        "profile": _text(PLUGIN_ROOT / "agents" / "coc-keeper-kp.md"),
        "protocol": _text(PLUGIN_ROOT / "references" / "mode-protocol.md"),
    }
    compact = {
        name: " ".join(text.split()).lower()
        for name, text in surfaces.items()
    }
    for name, text in compact.items():
        assert "session.resume" in text, name
        assert "current initial request" in text, name
    assert "predates the current host context" in compact["main"]
    assert "prior-context recovery" in compact["play"]
    assert "merely because the id now exists" in compact["profile"]
    assert "first campaign call only for that continuation case" in (
        compact["protocol"]
    )


def test_source_mechanics_required_uses_background_worker_without_roll_bypass():
    profile = " ".join(
        _text(PLUGIN_ROOT / "agents" / "coc-keeper-kp.md").split()
    ).lower()
    play = " ".join(
        _text(PLUGIN_ROOT / "skills" / "coc-keeper-play" / "SKILL.md").split()
    ).lower()
    tooling = " ".join(
        _text(
            PLUGIN_ROOT
            / "skills"
            / "coc-keeper-play"
            / "references"
            / "turn-tooling-and-typed-ops.md"
        ).split()
    ).lower()
    scenario = " ".join(
        _text(
            PLUGIN_ROOT / "skills" / "coc-scenario-import" / "SKILL.md"
        ).split()
    ).lower()
    combat = " ".join(
        _text(
            PLUGIN_ROOT
            / "rulesets"
            / "coc7"
            / "skills"
            / "coc-combat"
            / "SKILL.md"
        ).split()
    ).lower()

    for surface in (profile, tooling, scenario):
        for phrase in (
            "materially present",
            "conflict is semantically approaching",
            "every npc or every turn",
            "`source_work_required`",
            "`mechanics_not_ready`",
                "`rules.roll`",
            "`rules.opposed`",
            "copied stub values",
            "a generic profile",
            "`blocking_micro`",
            "no new narrative or output gate",
        ):
            assert phrase in surface, phrase

    for phrase in (
        "`mechanics.ensure`",
        "exact returned `background_takeover`",
        "never substitute generic dice/profile data",
        "`blocking_micro`",
        "on pi the package auto-dispatches",
        "`progressive.claim_host_work`",
        "`progressive.fulfill_host_work`",
        "`progressive.renew_host_work_leases`",
        "`progressive.release_host_work_leases`",
    ):
        assert phrase in play, phrase

    for surface in (profile, tooling):
        assert "`progressive.claim_host_work`" in surface
        assert "dispatch_mode" in surface
    assert "`progressive.claim_host_work`" in scenario
    assert "exact capability-selected action" in scenario

    for surface in (profile, tooling, scenario, combat):
        for phrase in (
            "`mechanics.ensure`",
            "`combat.resolve`",
            "naturally needed",
        ):
            assert phrase in surface, phrase

    for phrase in (
        "`mechanics_not_ready`",
        "`source_work_required`",
        "`progressive.claim_host_work`",
        "unqualified `coc-source-pack-worker` with `background=true`",
        "do not substitute `rules.roll`, `rules.opposed`, copied stub values, or a generic profile",
        "never retrieve child output",
        "naturally needed `mechanics.ensure` / `combat.resolve`",
        "no new narrative or output gate",
    ):
        assert phrase in combat, phrase

    for surface in (profile, tooling, scenario):
        assert "`get_task_output`" in surface
        assert "`get_command_or_subagent_output`" in surface


def test_grok_main_keeper_profile_narrows_host_surface_without_thinning_kp():
    profile = _text(PLUGIN_ROOT / "agents" / "coc-keeper-kp.md")
    compact = " ".join(profile.split()).lower()
    frontmatter = profile.split("---", 2)[1]
    allowed_tools = re.search(
        r"(?ms)^tools:\n(?P<body>(?:  - [^\n]+\n)+)", frontmatter,
    )
    disallowed_tools = re.search(
        r"(?ms)^disallowedTools:\n(?P<body>(?:  - [^\n]+\n)+)", frontmatter,
    )
    assert allowed_tools is not None
    assert disallowed_tools is not None
    assert "  - Bash\n" not in allowed_tools.group("body")
    assert "  - BashOutput\n" in allowed_tools.group("body")
    assert "  - KillShell\n" in allowed_tools.group("body")
    assert "  - Bash\n" in disallowed_tools.group("body")
    for phrase in (
        "name: coc-keeper-kp",
        "injectdefaulttools: false",
        "discoverskills: true",
        "inheritskills: false",
        "- skill",
        "- bash",
        "- task",
        "- bashoutput",
        "- killshell",
        "- search_tool",
        "- use_tool",
        "mcpservers:",
        "mcpinheritance:",
        "mcpinheritance: none",
        "only the four ordinary-table core skills are preloaded",
        "later top-level kernel case",
        "nested ruleset skills are not grok short-name catalog entries",
        "../../rulesets/coc7/skills/coc-character/skill.md",
        "never use bash, `find`, `ls`, `rg`, globbing, or directory enumeration",
        "fail closed as an installation/contract defect",
        "`coc-combat`",
        "`coc-sanity`",
        "call only `coc_capabilities` first",
        "setup.inspect",
        "setup.quick_start",
        "do not issue a broad coc/tool/campaign search",
        "discovery_required=false",
        "session.continuation_detail",
        "candidate_ref",
        "turn.output_context.finalize_operation",
        "the prose field is exactly `draft`",
        "search only the already-known `coc_invoke` gateway once",
        "ordinary_turn_operations",
        "recovery_index_projection",
        "`working_set.mode=full`",
        "`covered_domains`",
        "concrete missing field",
        "continuation pagination",
        "empty clue/secret reads",
        "same player turn",
        "player reply comes first",
        "not a fixed call count or order",
        "nested `coc_invoke.arguments`",
        "record_engagement_operation",
        "route_completion",
        "state.record_route_completion",
        "npc agency",
        "table wit",
        "never a fixed turn pipeline",
        "do not lower scene craft",
        "paginate it only with exact `read_file` calls at consecutive offsets",
        "while the coc mcp is healthy, never use a terminal, `run_terminal_command`, `rg`, or `grep`",
    ):
        assert phrase in compact, phrase
    assert "load its runtime-visible short name with `skill`: `coc-character`" not in compact

    main_path = PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md"
    character_ref = Path(
        "../../rulesets/coc7/skills/coc-character/SKILL.md"
    )
    assert (main_path.parent / character_ref).resolve() == (
        COC7_SKILL_PACK / "coc-character" / "SKILL.md"
    ).resolve()
    main = _text(main_path)
    assert str(character_ref) in main
    assert (
        "nested ruleset skills are not grok short-name catalog entries"
        in " ".join(main.split()).lower()
    )

    install = _text(PLUGIN_ROOT / "scripts" / "install-grok-plugin.sh")
    assert '$focused_plugin_bridge/scripts/run-grok-keeper.sh' in install
    assert "--agent coc-keeper:coc-keeper-kp" not in install

    runner = _text(PLUGIN_ROOT / "scripts" / "run-grok-keeper.sh")
    runner_compact = " ".join(runner.split()).lower()
    for phrase in (
        "grok_home",
        "coc-keeper-focused",
        "coc-keeper-current",
        "grok_cursor_mcps_enabled=false",
        "grok_claude_mcps_enabled=false",
        "grok_managed_mcps_enabled=false",
        "grok_managed_mcp_gateway_tools_enabled=false",
        "grok_cursor_skills_enabled=false",
        "grok_claude_skills_enabled=false",
        "--agent",
        "coc-keeper-kp.md",
    ):
        assert phrase in runner_compact, phrase

    focused = _text(
        PLUGIN_ROOT / "references" / "grok-focused-config.toml"
    ).lower()
    focused_requirements = _text(
        PLUGIN_ROOT / "references" / "grok-focused-requirements.toml"
    ).lower()
    assert "[subagents]" in focused
    assert "enabled = true" in focused
    assert "use_leader = false" in focused
    assert "[compat.cursor]" in focused
    assert "[compat.claude]" in focused
    assert focused.count("mcps = false") == 2
    assert 'enabled = ["coc-keeper"]' in focused
    assert "__coc_disabled_mcp_overrides__" in focused
    assert focused_requirements.count("mcps = false") == 2
    assert focused_requirements.count("skills = false") == 2
    assert "[compat.cursor]" in focused_requirements
    assert "[compat.claude]" in focused_requirements
    assert "[skills]" in focused_requirements
    assert "__coc_disabled_skill_overrides__" in focused_requirements
    installer_compact = " ".join(install.split()).lower()
    assert "coc_grok_focused_config.py" in installer_compact
    assert "grok-focused-requirements.toml" in installer_compact
    assert "grok inspect --json" in installer_compact
    assert "still exposes unrelated mcps or skills" in installer_compact
    assert "$focused_home/agents" in installer_compact
    assert "focused source worker projection drifted" in installer_compact
    assert '--require-source-agent "$focused_source_agent"' in install




def test_plugin_bundles_cross_host_continuation_hooks():
    hooks = _json(PLUGIN_ROOT / "hooks" / "hooks.json")["hooks"]
    assert set(hooks) == {
        "SessionStart",
        "UserPromptSubmit",
        "PreCompact",
        "PostCompact",
        "SessionEnd",
        "PreToolUse",
    }
    for lifecycle in (
        "SessionStart", "UserPromptSubmit", "PreCompact", "PostCompact",
        "SessionEnd",
    ):
        assert "matcher" not in hooks[lifecycle][0]
    assert "coc[-_]keeper" in hooks["PreToolUse"][0]["matcher"]
    for event, entries in hooks.items():
        handler = entries[0]["hooks"][0]
        assert handler["type"] == "command"
        assert "${CLAUDE_PLUGIN_ROOT}/hooks/run" in handler["command"]
        assert handler["env"]["COC_HOOK_EVENT"]
    assert (PLUGIN_ROOT / "hooks" / "run").stat().st_mode & 0o111
    assert (PLUGIN_ROOT / "hooks" / "coc_context_hook.py").is_file()

    install = _text(PLUGIN_ROOT / "scripts" / "install-grok-plugin.sh")
    assert "continuation lifecycle hooks" in install
    assert "components:.*hooks" in install
    assert "grok-global-hooks.json" in install
    assert "coc-keeper-continuation.json" in install
    global_hooks = _json(
        PLUGIN_ROOT / "hooks" / "grok-global-hooks.json"
    )["hooks"]
    assert set(global_hooks) == set(hooks)
    for entries in global_hooks.values():
        command = entries[0]["hooks"][0]["command"]
        assert "$HOME/.grok/coc-keeper-current/hooks/run" in command


def test_codex_manifest_exposes_same_skills_mcp_and_hooks():
    manifest = _json(PLUGIN_ROOT / ".codex-plugin" / "plugin.json")
    assert manifest["skills"] == "./skills/"
    assert manifest["hooks"] == "./hooks/hooks.json"
    assert manifest["mcpServers"] == "./mcp-codex.json"
    mcp = _json(PLUGIN_ROOT / "mcp-codex.json")["mcpServers"]["coc-keeper"]
    # Codex does not expand ${...} tokens in plugin MCP command; require the
    # host-supported plugin-relative form with explicit plugin cwd.
    assert not re.search(r"\$\{[^}]+\}", mcp["command"])
    assert mcp == {
        "command": "./mcp/launch",
        "cwd": ".",
        "env": {"COC_HOST": "codex"},
    }
    assert not (PLUGIN_ROOT / "mcp" / "codex_server.py").exists()


def test_kimi_manifest_exposes_same_skills_mcp_and_hooks():
    manifest = _json(PLUGIN_ROOT / ".kimi-plugin" / "plugin.json")
    assert manifest["skills"] == "./skills/"
    assert manifest["sessionStart"] == {"skill": "coc-host-bootstrap"}
    server = manifest["mcpServers"]["coc-keeper"]
    assert server["command"] == "./mcp/launch"
    assert server["env"] == {"COC_HOST": "kimi"}
    events = {entry["event"] for entry in manifest["hooks"]}
    assert events == {
        "SessionStart",
        "UserPromptSubmit",
        "PreCompact",
        "PostCompact",
        "SessionEnd",
        "PreToolUse",
    }
    assert not (PLUGIN_ROOT / "mcp" / "kimi_server.py").exists()

def test_cursor_thin_entry_requires_kp_craft_parity_with_codex():
    text = _text(ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md")
    compact = " ".join(text.split()).lower()
    for phrase in (
        "coc-keeper-play/skill.md",
        "coc-story-director/skill.md",
        "director.advise",
        "narration.brief",
        "narration.review",
        "evidence.record_adoption",
        "action_uptake",
        "enact it from the investigator",
        "log_style_summary",
        "ai_summary_voice",
        "always-active player-action uptake",
        "rules.skill_describe",
        "**not** an acceptable",
        "host_native_imagegen",
    ):
        assert phrase in compact, phrase
    agents = _text(PLUGIN_ROOT / "references" / "AGENTS-coc-mode-template.md")
    agents_compact = " ".join(agents.split()).lower()
    assert "coc-story-director" in agents_compact
    assert "director.advise" in agents_compact
    assert (
        PLUGIN_ROOT / "skills" / "coc-story-director" / "agents" / "openai.yaml"
    ).is_file()
    play_dir = PLUGIN_ROOT / "skills" / "coc-keeper-play"
    play_main = _text(play_dir / "SKILL.md")
    play_main_compact = " ".join(play_main.split()).lower()
    # Always-loaded main skill: core contract before optional narration tools.
    core_at = play_main_compact.index("core keeper response contract (always active)")
    brief_at = play_main_compact.index("narration.brief")
    review_at = play_main_compact.index("narration.review")
    assert core_at < brief_at < review_at
    # Progressive references hold full craft detail; main + refs = package.
    play_compact = " ".join(_skill_package_text(play_dir).split()).lower()
    for phrase in (
        "must make that declaration happen in the fictional world",
        "whether or not",
        "always-on prompt-level drafting responsibility",
        "not a fixed workflow",
        "never a keyword list",
        "required craft instruction",
        "not a mandatory pipeline",
        "compound player declarations",
        "diegetic delivery only",
        "settlement is **internal kp craft**",
        "acknowledge the unplayed remainder",
        "tease like a real table kp",
        "table wit (failures players feel)",
        "fumbles / 大失败",
        "【串联】",
        "player knowledge boundary",
        "kp owns the intercept",
        "lucky guesses stay guesses",
        "overconfident unearned knowledge",
    ):
        assert phrase in play_compact, phrase
    agents = _text(ROOT / "AGENTS.md")
    agents_compact = " ".join(agents.split()).lower()
    for phrase in (
        "player knowledge boundary",
        "kp owns the intercept",
        "lucky correct guess",
        "do not ban players from guessing",
    ):
        assert phrase in agents_compact, phrase
    assert "action_uptake" in play_compact
    assert "not acceptable player-" in play_main_compact or (
        "not acceptable player" in play_main_compact
    )
    # Main skill must still carry the always-on uptake constitution itself.
    for phrase in (
        "must make that declaration happen in the fictional world",
        "always-on prompt-level drafting responsibility",
        "player knowledge boundary",
        "kp owns the intercept",
        "play_language",
        "turn.finalize",
        "rendered_text",
    ):
        assert phrase in play_main_compact, phrase
    cursor_chain = " ".join(
        _text(ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md").split()
    ).lower()
    assert "chain-settlement" in cursor_chain or "【串联】" in cursor_chain
    assert "narration.review" in cursor_chain
    contract = _text(PLUGIN_ROOT / "scripts" / "coc_narration_contract.py")
    assert "action_uptake" in contract
    assert "treat_current_action_uptake_as_semantic_repetition" in contract

    cursor_compact = " ".join(
        _text(ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md").split()
    ).lower()
    assert "always-active player-action uptake" in cursor_compact
    assert "whether or not `narration.brief`" in cursor_compact
    assert "player-visible prose pipeline (hard order)" not in cursor_compact

    pi_package_compact = " ".join(
        _text(PLUGIN_ROOT / "pi" / "README.md").split()
    ).lower()
    pi_host_prompt_compact = " ".join(
        _text(PLUGIN_ROOT / "pi" / "prompts" / "host-system.md").split()
    ).lower()
    assert (
        "loads `../skills` and `../rulesets/coc7/skills` directly"
        in pi_package_compact
    )
    assert "live play follows `coc-keeper-play`" in pi_host_prompt_compact
    assert "core keeper response contract (always active)" in play_main_compact


def test_canonical_skills_have_matching_frontmatter_names():
    skill_root = PLUGIN_ROOT / "skills"
    skill_dirs = sorted(path for path in skill_root.iterdir() if path.is_dir())
    assert skill_dirs
    for directory in skill_dirs:
        skill_path = directory / "SKILL.md"
        assert skill_path.is_file(), directory
        text = _text(skill_path)
        match = re.search(r"\A---\s*\nname:\s*([^\n]+)", text)
        assert match, skill_path
        assert match.group(1).strip() == directory.name


def test_pi_play_host_prompt_keeps_prejournal_player_state_authority():
    prompt = " ".join(
        _text(PLUGIN_ROOT / "pi" / "prompts" / "host-system-play.md").split()
    )
    for phrase in (
        "state.cash_grant",
        "state.item_grant",
        "before `state.journal`",
        "state_authority_review",
        "source_effect_id",
    ):
        assert phrase in prompt, phrase


def test_active_pi_skill_states_state_authority_attestation_limit():
    skill = " ".join(
        _text(PLUGIN_ROOT / "skills" / "coc-keeper-play" / "SKILL.md").split()
    )
    for phrase in (
        "semantic attestation, not proof of absence",
        "fresh Pi/Grok browser replay remains mandatory acceptance evidence",
        "Pi host independently compiles",
        "This compiler is not a second KP",
        "receipt is host-owned and absent from the model-visible tool schema",
    ):
        assert phrase in skill, phrase


def test_required_canonical_skills_are_present():
    names = {
        path.name
        for path in (PLUGIN_ROOT / "skills").iterdir()
        if path.is_dir()
    }
    assert {
        "coc-main",
        "coc-keeper-play",
        "coc-export-battle-report",
        "coc-campaign-state",
        "trpg-pdf-ingest",
    } <= names
    # Rule-craft skills live in the coc7 ruleset skill pack (contract §7).
    pack_names = {
        path.name
        for path in COC7_SKILL_PACK.iterdir()
        if path.is_dir()
    }
    assert COC7_RULE_SKILLS <= pack_names


def test_coc_character_skill_quick_fire_fields_match_create_contract():
    contract = _json(
        PLUGIN_ROOT / "rulesets" / "coc7" / "investigator-create-contract.json"
    )
    payload = contract["payload_schema"]
    qf = payload["oneOf"][0]
    defs = payload["$defs"]
    top = set(qf["required"])
    sheet_req = set(defs["quick_fire_sheet"]["required"])
    creation_req = set(defs["quick_fire_creation"]["required"])
    skill = _text(COC7_SKILL_PACK / "coc-character" / "SKILL.md")
    qf_section = skill.split("**Quick Fire deterministic materialization:**", 1)[1]
    qf_section = qf_section.split("- **Quick-Fire Luck:**", 1)[0]
    for name in sorted(top | sheet_req | {"characteristic_assignment_order", "skill_budget", "input_mode"}):
        assert f"`{name}`" in qf_section or name in qf_section, name
    assert "Do not send top-level `name`, `occupation`," in qf_section
    assert "`assignment_order`" in qf_section.split("Do not send", 1)[1][:200]
    assert "`creation.luck.auto_roll`" not in skill
    assert "Allowed top-level keys are only `campaign_id`" in qf_section
    assert creation_req >= {"input_mode", "method", "characteristic_assignment_order", "skill_budget"}


def test_host_native_image_generation_is_explicitly_gated():
    character = _text(COC7_SKILL_PACK / "coc-character" / "SKILL.md")
    assert "HOST_NATIVE_IMAGEGEN_BEGIN" in character
    assert "HOST_NATIVE_IMAGEGEN_END" in character
    assert character.index("HOST_NATIVE_IMAGEGEN_BEGIN") < character.index(
        "HOST_NATIVE_IMAGEGEN_END"
    )
    compact = " ".join(character.split()).lower()
    for phrase in (
        "current host's built-in image tool",
        "do not call another host's image stack",
        "grok build",
        "image_gen",
        "imagine",
        "skip portrait generation",
    ):
        assert phrase in compact, phrase
    # Legacy Codex-only gate must not reappear.
    assert "CODEX_ONLY_IMAGEGEN" not in character
    agents = _text(ROOT / "AGENTS.md")
    assert "HOST_NATIVE_IMAGEGEN" in agents
    assert "Codex-only and must remain" not in agents




def test_final_report_skill_is_the_single_readable_report_owner():
    text = _text(
        PLUGIN_ROOT / "skills" / "coc-export-battle-report" / "SKILL.md"
    )
    compact = " ".join(text.split()).lower()
    assert "only final battle-report writer" in compact
    assert "battle-report.md" in text
    assert "battle-report-evidence.json" in text
    assert "public" in text and "consequence_public" in text
    assert "read `battle-report.md` end to end" in text
    assert "host_model" in text
    assert "structured development evidence" in compact
    assert "not rendered into the player report" in compact
    assert "coc_eval.py" not in text
    assert "supplementary" not in compact


def test_pdf_ingest_is_an_external_skill_source_bundle_boundary():
    main = _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md")
    ingest = _text(PLUGIN_ROOT / "skills" / "trpg-pdf-ingest" / "SKILL.md")
    combined = "\n".join((main, ingest)).lower()
    compact = " ".join(combined.split())
    assert "external pdf skill" in combined
    assert "source bundle" in combined or "source-bundle" in combined
    assert "repository has no pdf parser fallback" in combined
    assert "coc_pdf_bundle.py" in combined
    assert "inspect document outline/bookmarks first" in compact
    assert "do not raster-render speculative 20–32-page ranges" in compact
    assert "selects and visually accepts the whole final cold-start opening page set" in compact
    assert "renders the bounded locator candidates in one batch" in compact
    assert "early player-response boundary" in compact
    assert "before assembling or validating the bundle" in compact
    assert "the first useful player choice is itself the milestone" in compact


def test_current_skills_reject_legacy_or_mismatched_runtime_state():
    combined = "\n".join(
        _text(PLUGIN_ROOT / "skills" / name / "SKILL.md").lower()
        for name in ("coc-main", "coc-campaign-state")
    )
    assert "exact-schema" in combined or "exact current" in combined
    assert "legacy" in combined or "mismatched" in combined


def test_keeper_play_professional_inference_boundary_is_always_on():
    """Canonical live KP path carries expertise-before-check adjudication.

    Static contract for plugin instructions: always-on main skill + ordinary-
    turn tooling reference. Not a semantic gameplay validator and not a
    keyword-router design proof for play content.
    """
    play_dir = PLUGIN_ROOT / "skills" / "coc-keeper-play"
    play_main = " ".join(_text(play_dir / "SKILL.md").split()).lower()
    tooling_path = play_dir / "references" / "turn-tooling-and-typed-ops.md"
    assert tooling_path.is_file()
    tooling = " ".join(_text(tooling_path).split()).lower()

    # Always-loaded main skill: boundary is ordinary-turn product invariant.
    assert "always-on product invariants" in play_main
    for phrase in (
        "professional inference boundary",
        "always before a check",
        "observable phenomenon",
        "professional inference or expert action",
        "matching professional skill",
        "even when its sheet value is lower",
        "directly observable facts or objects",
        "downgraded substitute",
        "distinct information layers",
    ):
        assert phrase in play_main, phrase
    # Main skill must reject general observation as expert-conclusion substitute.
    assert "must not emit the same diagnosis" in tooling
    assert "professional conclusion" in tooling
    assert "check adjudication flow" in tooling
    # Orientation points KP at the boundary before skill selection.
    assert "professional inference boundary before selecting a skill" in play_main
    # Routed ordinary-turn reference expands operational method/goal guidance.
    assert "check adjudication flow (kp owns the choice)" in tooling
    for phrase in (
        "professional inference boundary",
        "method, goal, and information layer",
        "no-roll obvious facts",
        "professional skill for diagnosis",
        "broad perception",
        "raw observables only",
        "must not emit the same diagnosis",
        "do not choose the higher sheet value merely to improve odds",
        "allied specialty only with rulebook-supported increased",
        "compound layers stay distinct",
        "not a keyword router, fixed skill map, or hard runtime narrative gate",
    ):
        assert phrase in tooling, phrase
    # Illustrative corpse examination layers — never an event→skill map.
    assert "illustrative only" in tooling
    assert "never a fixed event→skill map" in tooling or (
        "never a fixed event" in tooling and "skill map" in tooling
    )
    assert "seeing an obvious body needs no spot hidden" in tooling
    assert "medicine diagnoses" in tooling
    assert "not corpse-keyword routing" in tooling
    # General-perception success still limited to observable layer.
    assert "general-perception success still yields only the observable layer" in tooling


def test_keeper_play_handout_link_guidance_covers_direct_and_reverse_identity():
    play = " ".join(
        _text(PLUGIN_ROOT / "skills" / "coc-keeper-play" / "SKILL.md").split()
    )
    for phrase in (
        "direct `handout_asset_id`",
        "unique exact reverse `clue_refs`",
        "returned delivery result or warning is authoritative",
        "No keyword or prose matching",
    ):
        assert phrase in play, phrase


def test_mcp_contract_archive_matches_live_toolbox():
    """Same as CLI `coc_mcp_contract_archive.py check` against live toolbox."""
    script = PLUGIN_ROOT / "scripts" / "coc_mcp_contract_archive.py"
    name = "test_plugin_metadata_mcp_contract_archive"
    spec = importlib.util.spec_from_file_location(name, script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)

    archive_path = PLUGIN_ROOT / "references" / "mcp-operation-contracts.json"
    policy_path = PLUGIN_ROOT / "pi" / "lib" / "operation-policy.generated.ts"
    toolbox = module._load_toolbox()
    module.load_and_validate(archive_path, toolbox)
    module.validate_policy_projection(policy_path, toolbox)
