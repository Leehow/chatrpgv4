import json
import re
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
        "coc-playtest",
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
    assert "coc-playtest-player" in install
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
                "authored_choices_or_investigation_paths",
                "information_each_path_can_establish",
                "named_conditional_contacts_as_mentions",
                "materially_present_npcs",
            ],
        },
        "semantic_default_replacement": {
            "clues": "populate every source-authored clue needed to play the current beat",
            "affordances": "populate source-authored immediately usable courses of action",
            "mentions": "populate source-authored named people or places referenced but not materially present",
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
    assert contract["lifecycle"]["manager_background"] is True
    assert contract["lifecycle"]["leaf_background"] is False
    assert contract["lifecycle"]["main_keeper_waits"] is False
    assert contract["lifecycle"]["main_keeper_retrieves_result"] is False
    assert contract["authority"]["max_nesting_depth"] == 2
    failure = contract["failure_policy"]
    assert failure["authority"] == "prompt_first_advisory"
    assert failure["single_failure"] == "transient_allowed"
    assert failure["same_failure_escalation_threshold"] == 3
    assert failure["threshold_outcome"] == "design_issue"
    assert failure["runtime_gate"] is False
    assert failure["player_output_gate"] is False
    assert failure["same_task_retry"] is False

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
        "`coordinator_dispatch.codex_task`",
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
    assert contract["lifecycle"]["main_keeper_dispatches_before_pdf_locator_or_concepts"] is True
    assert contract["lifecycle"]["blocking_phase"] == "concept_locator_natural_return"
    assert contract["lifecycle"]["background_phase"] == (
        "same_child_exact_followup_source_build"
    )
    assert contract["lifecycle"]["main_keeper_exact_forwards_continue_task"] is True
    assert contract["lifecycle"]["no_in_turn_parent_callback"] is True
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


def test_source_scope_locator_is_bounded_nonblocking_and_prompt_first():
    contract = json.loads(
        _text(PLUGIN_ROOT / "references" / "source-scope-locator-v1.json")
    )
    assert contract["contract_id"] == "coc.source-scope-locator.v1"
    assert contract["canonical_caller"]["trigger"] == (
        "scene.context.progressive.source_scope_takeover"
    )
    assert contract["authority"]["may_compile_entity_pack"] is False
    assert contract["lifecycle"]["main_keeper_waits"] is False
    assert contract["lifecycle"]["success_wakes_existing_source_pack_lifecycle"] is True
    assert contract["source_bundle_manifest_contract"] == {
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "review_state": "manual_accepted",
        "parse_confidence": "number_from_0_through_1",
        "text_sha256": "sha256_of_exact_markdown_file_bytes",
        "assets": [],
    }
    assert contract["failure_policy"]["same_task_retry"] is False

    agent = _text(PLUGIN_ROOT / "agents" / "coc-source-scope-locator.md")
    compact = " ".join(agent.split()).lower()
    for phrase in (
        "name: coc-source-scope-locator",
        "never the keeper",
        "locator-only",
        "one to three zero-based pages",
        "call no coc operation",
        "progressive.resolve_source_scope",
        "`review_state=manual_accepted`",
        "numeric `parse_confidence` from 0 through 1",
        "never edit the manifest and call again",
        "do not claim, fulfill, poll, retry",
        "three observed occurrences of the same failure class",
    ):
        assert phrase in compact, phrase

    play = " ".join(
        _text(PLUGIN_ROOT / "skills" / "coc-keeper-play" / "SKILL.md").split()
    ).lower()
    assert "`scene.context.progressive.source_scope_takeover`" in play
    assert "`ready_for_background_count=0`" in play
    assert "use the stable `dispatch_key`" in play


def test_fresh_raw_pdf_skill_catalog_routes_only_through_coc_main():
    descriptions = {}
    for name in (
        "coc-main",
        "coc-keeper-play",
        "coc-scenario-import",
        "coc-campaign-state",
        "coc-playtest",
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
    assert "select coc-main first" in descriptions["coc-playtest"]


def test_preconfirmation_opening_warm_start_uses_a_real_background_task():
    main = " ".join(
        _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md").split()
    ).lower()
    for phrase in (
        "only after confirmation use `investigator.create`",
        "the card is not an opening gate",
        "pre-confirmation opening warm start",
        "exact contiguous 1–3-page `partial_opening` request",
        "`direct_single_leaf`",
        "host-selected `next_host_action`",
        "one ready work group",
        "real task ids only in volatile host context",
        "host completion reminder as notification/liveness only",
        "must not call `get_task_output`",
        "`get_command_or_subagent_output`",
        "never a reassurance query",
        "invoke `progressive.status` exactly once as dispatch acquisition",
        "never loop on status",
        "keep the host turn alive",
        "permitted residual tier 1a wait",
        "declare the opening failed merely because",
    ):
        assert phrase in main, phrase

    scenario = " ".join(
        _text(
            PLUGIN_ROOT / "skills" / "coc-scenario-import" / "SKILL.md"
        ).split()
    ).lower()
    for phrase in (
        "pre-confirmation opening warm start",
        "intentionally **not** described as background work",
        "host-selected `next_host_action`",
        "child atomically claims and compiles its packet",
        "a one-group request must not pay a manager-to-one-leaf hop",
        "real task ids only in volatile host-session context",
        "must not read those claimed packet pages itself",
        "source child submits the complete outer result itself through its named submit-only mcp",
        "host completion reminder as notification/liveness only",
        "never call `get_task_output` or `get_command_or_subagent_output`",
        "retrieve the pack or compact receipt",
        "invoke `progressive.status` exactly once to acquire dispatch",
        "request response is authoritative for immediate dispatch",
        "keep the host turn alive",
        "only permitted `blocking_micro` dependency",
        "declare the opening failed merely because",
        "child retains its compact `coc.source-submit-receipt.v1` final output for audit only",
        "never claim source success to the player",
        "naturally needed canonical entity or mechanics query",
        "never a reassurance query or poll",
        "`coc-character` owns character semantics and confirmation, not source work",
        "focused keeper launcher",
        "without parent task-output retrieval",
        "add no prefix, suffix, transcript, optional-row request, reconstructed wrapper, or model override",
        "existing recovery",
        "retain the exact r28 fallback",
        "`worker_result=result` object",
        "never extract or retype `job_id`, `pack`, or `related_packs`",
        "trust fallback success only when `ok=true` and durable `request_status=fulfilled`",
    ):
        assert phrase in scenario, phrase

    profile = " ".join(
        _text(PLUGIN_ROOT / "agents" / "coc-keeper-kp.md").split()
    ).lower()
    for phrase in (
            "`action=spawn_background_task` task runs with `background=true`",
        "real host task id only in the host session, never module truth",
        "claimed dispatch task transfers its exact page read",
        "do not fake a task",
        "without parent task-output retrieval",
            "selected serialized task json is the entire child task prompt",
        "add no prefix, suffix, transcript, optional-row request, or schema hint",
        "existing recovery",
        "source child owns submission through its named submit-only mcp",
        "host completion reminder as notification/liveness only",
        "never call `get_task_output` or `get_command_or_subagent_output`",
        "retrieve the pack or compact receipt",
        "child retains its compact `coc.source-submit-receipt.v1` final output for audit only",
        "never claim source success to the player",
        "naturally needed canonical entity or mechanics query",
        "never issue a reassurance query or poll",
        "r28-compatible fallback",
        "`worker_result=result`",
        "never extract or retype `job_id`, `pack`, or `related_packs`",
        "trust fallback success only when `ok=true` and durable `request_status=fulfilled`",
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
        "claim once only",
        "focused unqualified `coc-source-pack-worker` with `background=true`",
        "do not use the plugin-qualified agent",
        "must not read those exact packet pages itself",
        "deliver the character confirmation text immediately after spawning and never wait for the child",
        "only after final character confirmation",
        "not `coc-character`",
        "focused keeper launcher",
        "without parent task-output retrieval",
        "serialized returned dispatch task json is the entire child task prompt",
        "add no prefix, suffix, transcript, optional-row request, or schema hint",
        "existing recovery",
        "installed-plugin projection's narrow read plus named-submit profile",
        "host completion reminder as notification/liveness only",
        "must not call `get_task_output` or `get_command_or_subagent_output`",
        "retrieve the pack or compact receipt",
        "child retains its compact `coc.source-submit-receipt.v1` final output for audit only",
        "never claim source success to the player",
        "naturally needed canonical entity or mechanics query",
        "never a reassurance query or poll",
        "retain the exact r28 fallback",
        "`worker_result=result`",
        "never extract or retype `job_id`, `pack`, or `related_packs`",
        "trust fallback success only when `ok=true` and durable `request_status=fulfilled`",
    ):
        assert phrase in tooling, phrase


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

    for surface in (profile, play, tooling, scenario):
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

    for surface in (profile, tooling, scenario):
        assert "`progressive.claim_host_work`" in surface
        assert "dispatch_mode" in surface

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


def test_grok_playtest_player_is_protocol_isolated_and_not_a_fake_keeper():
    player = _text(PLUGIN_ROOT / "agents" / "coc-playtest-player.md")
    compact = " ".join(player.split()).lower()
    for phrase in (
        "name: coc-playtest-player",
        "agents_md: false",
        "tools: []",
        "mcpinheritance: none",
        "player at a live call of cthulhu table",
        "never a keeper",
        "only the exact player-visible keeper text",
        "do not call tools",
        "exactly one player message",
        "do not guess module secrets",
        "no analysis",
    ):
        assert phrase in compact, phrase


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

    pi_compact = " ".join(
        _text(ROOT / "runtime" / "adapters" / "pi" / "README.md").split()
    ).lower()
    assert "always-active core keeper response contract" in pi_compact
    assert "whether or not an optional" in pi_compact


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


def test_required_canonical_skills_are_present():
    names = {
        path.name
        for path in (PLUGIN_ROOT / "skills").iterdir()
        if path.is_dir()
    }
    assert {
        "coc-main",
        "coc-keeper-play",
        "coc-playtest",
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


def test_playtest_skill_defines_real_plugin_context_free_player_acceptance():
    text = _text(PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md")
    compact = " ".join(text.split()).lower()
    for phrase in (
        "main codex",
        "canonical `coc-keeper` plugin",
        "fork_turns: none",
        "player-safe",
        "fresh isolated workspace",
        "coc-export-battle-report",
        "structured ending",
        "references/playtest-model-lanes-v1.json",
        "gpt-5.6-luna",
        "fast_iteration",
        "quality_confirmation",
        "selected_before_activation",
        "switched_during_run",
        "background_model_policy",
        "inherit_parent",
        "no model override",
        "three observations",
        "design issue",
        "host-observed user-message submission event",
        "an in-turn `date` call",
        "latency boundary as unverified",
        "defer `coc-keeper-play` until character/source readiness",
        "the main kp does not load `coc-scenario-import`, `trpg-pdf-ingest`, or `coc-campaign-state`",
    ):
        assert phrase in compact

    contract = _json(
        PLUGIN_ROOT / "references" / "playtest-model-lanes-v1.json"
    )
    assert contract["contract_id"] == "coc.playtest-model-lanes.v1"
    assert contract["authority"]["advisory_only"] is True
    assert contract["authority"]["runtime_gate"] is False
    assert contract["authority"]["player_output_gate"] is False
    assert contract["window_contract"]["model_locked_for_run"] is True
    assert contract["window_contract"]["mid_run_switch_policy"] == (
        "record_mixed_model_and_do_not_claim_single_model_acceptance"
    )
    assert contract["window_contract"]["player_model_policy"] == "inherit_parent"
    assert contract["window_contract"]["source_coordinator_model_policy"] == (
        "inherit_parent"
    )
    assert contract["window_contract"]["source_leaf_model_policy"] == (
        "inherit_parent"
    )
    assert contract["lanes"]["fast_iteration"]["recommended_model_ids"] == [
        "gpt-5.6-luna"
    ]
    assert contract["lanes"]["quality_confirmation"][
        "recommended_model_ids"
    ] == ["gpt-5.6-sol", "gpt-5.6-terra"]
    assert contract["failure_policy"]["same_failure_escalation_threshold"] == 3
    assert contract["failure_policy"]["threshold_outcome"] == "design_issue"
    for obsolete in (
        "coc_eval.py",
        "haunting_module",
        "chase_drill",
        "coc_playtest_harness.py",
        "coc_interactive_playtest.py",
    ):
        assert obsolete not in text


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
    playtest = _text(PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md")
    combined = "\n".join((main, ingest, playtest)).lower()
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
        for name in ("coc-main", "coc-campaign-state", "coc-playtest")
    )
    assert "exact-schema" in combined or "exact current" in combined
    assert "legacy" in combined or "mismatched" in combined
    assert "start fresh" in combined or "fresh campaign" in combined


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
        "not a keyword map or hard narrative gate",
    ):
        assert phrase in play_main, phrase
    # Main skill must reject general observation as expert-conclusion substitute.
    assert "must **not** return the same diagnosis" in play_main or (
        "must not return the same diagnosis" in play_main
    )
    assert "professional conclusions" in play_main
    assert "check adjudication flow" in play_main
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
