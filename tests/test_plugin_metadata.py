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
        },
        "forced_empty_fields": {
            "scene_edges": [],
            "affordances": [],
        },
        "infer_structured_clock_or_routes_from_prose": False,
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
        "do not claim a wall clock",
        "/bin/cat -- <path>",
        "compile exactly one `coc.source-pack-worker.v1` json object",
        "request_purpose=foreground_opening_slice",
        "request.result_contract",
        "source-bounded immediate agenda",
        "copy `fixed_fields`, `copy_from_request`, and every `empty_defaults` value",
        "keep `scene_edges=[]` and `affordances=[]`",
        "do not infer a structured clock or route from prose",
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


def test_preconfirmation_opening_warm_start_uses_a_real_background_task():
    main = " ".join(
        _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md").split()
    ).lower()
    for phrase in (
        "only after confirmation use `investigator.create`",
        "pre-confirmation opening warm start",
        "exact contiguous 1–3-page `partial_opening` request",
        "must launch a real `coc-source-pack-worker` with `background=true`",
        "real task id only in the host session",
        "return the character confirmation text immediately without waiting",
        "host completion reminder as notification/liveness only",
        "must not call `get_task_output`",
        "`get_command_or_subagent_output`",
        "never a reassurance query",
        "must not fake a task or claim work for an imaginary child",
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
        "`progressive.claim_host_work` once",
        "actually spawn the existing `coc-source-pack-worker` with `background=true`",
        "narrow read plus named-submit profile without overriding it to read-only",
        "real host task id only in volatile host-session context",
        "must not read those claimed packet pages itself",
        "source child submits the complete outer result itself through its named submit-only mcp",
        "host completion reminder as notification/liveness only",
        "never call `get_task_output` or `get_command_or_subagent_output`",
        "retrieve the pack or compact receipt",
        "child retains its compact `coc.source-submit-receipt.v1` final output for audit only",
        "never claim source success to the player",
        "naturally needed canonical entity or mechanics query",
        "never a reassurance query or poll",
        "`coc-character` owns character semantics and confirmation, not source work",
        "focused keeper launcher",
        "without parent task-output retrieval",
        "serialized claimed packet json is the entire child task prompt",
        "add no prefix, suffix, transcript, optional-row request, or schema hint",
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
        "actually spawn each returned exact packet as a `coc-source-pack-worker` task with `background=true`",
        "real host task id only in the host session, never module truth",
        "must not read those claimed packet pages",
        "do not fake a task",
        "without parent task-output retrieval",
        "serialized claimed packet json is the entire child task prompt",
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
        "serialized claimed packet json is the entire child task prompt",
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
            "`progressive.claim_host_work`",
            "unqualified `coc-source-pack-worker` with `background=true`",
            "`rules.roll`",
            "`rules.opposed`",
            "copied stub values",
            "a generic profile",
            "`blocking_micro`",
            "no new narrative or output gate",
        ):
            assert phrase in surface, phrase

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
    ):
        assert phrase in compact
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
    assert "coc_eval.py" not in text
    assert "supplementary" not in compact


def test_pdf_ingest_is_an_external_skill_source_bundle_boundary():
    main = _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md")
    ingest = _text(PLUGIN_ROOT / "skills" / "trpg-pdf-ingest" / "SKILL.md")
    playtest = _text(PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md")
    combined = "\n".join((main, ingest, playtest)).lower()
    assert "external pdf skill" in combined
    assert "source bundle" in combined or "source-bundle" in combined
    assert "repository has no pdf parser fallback" in combined
    assert "coc_pdf_bundle.py" in combined


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
