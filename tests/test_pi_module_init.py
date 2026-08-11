"""Pi-Coc Skill 1: source-bound L0 module-init state and construction gate."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest


REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
ADAPTER_PATH = REPO / "plugins" / "coc-keeper" / "pi" / "bin" / "coc-pdf-skill-adapter.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


ops = _load("coc_runtime_ops_pi_module_init_test", SCRIPTS / "coc_runtime_ops.py")
adapter = _load("coc_pdf_skill_adapter_l0_guidance_test", ADAPTER_PATH)


def _l0(*, extension: bool = False) -> dict:
    value = {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "module_meta": {
            "title_zh": "远页来信",
            "title_en": "The Far Page Letter",
            "authors": ["测试作者"],
            "translator": [],
            "era": "1920s",
            "locale": "Boston",
            "party_size": "1-4",
            "duration_hint": "one session",
            "tone_tags": ["mystery"],
            "mythos_entities": [],
            "campaign_hooks": ["一封未署名的信"],
            "warnings": ["失踪"],
            "safety_notes": None,
            "structure_type": "linear_investigation",
        },
        "pregens": [{
            "name": "林晓",
            "age": 31,
            "occupation": "记者",
            "hooks_to_plot": ["收到那封信"],
            "backstory_blocks": {"public": "调查过港口失踪案"},
            "stats_ref": "appendix/pregen-lin",
        }],
        "opening_hooks": [{
            "id": "letter",
            "audience": "player",
            "text": "一封没有署名的信送到你的办公桌上。",
            "variant_of": None,
        }],
        "chargen_deltas": [{"era_skill_remap": {"Computer Use": "无"}}],
        "opening_handouts": [{
            "id": "letter-handout",
            "title": "未署名的信",
            "when_to_give": "开场",
        }],
    }
    if extension:
        value["module_meta"]["publisher_imprint"] = "自定义版本"
        value["pregens"][0]["private_handout"] = "letter-handout"
        value["module_specific_rule"] = {"status": "optional"}
    return value


def _facts(source_id: str, page: int) -> dict:
    refs = [{"source_id": source_id, "pdf_index": page}]
    answer = lambda value: {
        "status": "source", "value": value, "source_refs": refs,
    }
    return {
        "schema_version": 1,
        "contract_id": "coc.opening-fast-facts.v1",
        "era": answer("1920s"),
        "place": answer("Boston"),
        "investigator_hook": answer("一封未署名的信把调查员引向港口。"),
        "investigator_constraints": answer("适合与港口、新闻或学术有关的调查员。"),
        "player_safe_summary": answer("从一封信开始的失踪调查。"),
        "content_flags": answer(["失踪"]),
    }


def _source_bundle(root: Path) -> tuple[Path, str]:
    pdf = root / "module.pdf"
    pdf.write_bytes(b"%PDF module-init fixture")
    source_id = "pdf:module-init-fixture"
    bundle = root / "source-bundle"
    bundle.mkdir()
    pages = {
        0: "# 封面\n\n远页来信\n",
        1: "# 版权\n\n无目录；封面后的占位页。\n",
        17: "# 开场\n\n一封没有署名的信送到你的办公桌上。\n",
        23: "# 附录：预设调查员与建卡说明\n\n年代：1920s。地点：Boston。\n",
    }
    rows = []
    for index, text in pages.items():
        name = f"page-{index:04d}.md"
        body = text.encode("utf-8")
        (bundle / name).write_bytes(body)
        rows.append({
            "pdf_index": index,
            "markdown_path": name,
            "text_sha256": hashlib.sha256(body).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.97,
            "grep_anchors": [text.splitlines()[-1]],
        })
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": source_id,
            "title": "远页来信",
            "path": str(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 24,
        },
        "pages": rows,
    }, ensure_ascii=False), encoding="utf-8")
    return bundle, source_id


def _create_and_bind(root: Path, campaign_id: str) -> tuple[Path, str]:
    ops.execute_setup_operation(root, operation={
        "schema_version": 1,
        "kind": "campaign.create",
        "payload": {
            "campaign_id": campaign_id,
            "title": "L0 Test Campaign",
            "play_language": "zh-Hans",
        },
    })
    bundle, source_id = _source_bundle(root)
    bound = ops.execute_setup_operation(root, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": campaign_id,
            "scenario_id": "far-page-letter",
            "title": "远页来信",
            "source_bundle_path": str(bundle),
            "compile_now": False,
        },
    })
    assert bound["status"] == "PASS"
    return bundle, source_id


def _review_and_apply_l0(root: Path, campaign_id: str, source_id: str, l0: dict) -> dict:
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    scenario = json.loads((campaign_dir / "scenario" / "scenario.json").read_text(encoding="utf-8"))
    task = scenario["opening_source_review_task"]
    receipt = ops._build_opening_source_review_fulfillment(
        root,
        continuation={
            "schema_version": 1,
            "contract_id": "coc.opening-source-continue.v1",
            "campaign_id": campaign_id,
            "scenario_id": "far-page-letter",
            "selected_opening_pdf_indices": [17],
            "source_bundle_id": task["source_bundle_id"],
            "source_bundle_path": task["source_bundle_path"],
            "result_delivery": "task_return_to_parent",
        },
        status="reviewed",
        selected_opening_pdf_indices=[17],
    )
    ops._apply_opening_source_review_fulfillment(
        root,
        receipt,
        source_facts=_facts(source_id, 23),
        module_init_l0=l0,
    )
    scenario = json.loads((campaign_dir / "scenario" / "scenario.json").read_text(encoding="utf-8"))
    return scenario["opening_source_facts_transport"]["facts"]


@pytest.mark.parametrize(
    ("mutate", "error"),
    [
        (
            lambda value: value["opening_hooks"][0].pop("variant_of"),
            "missing required field.*variant_of",
        ),
        (
            lambda value: value["opening_hooks"][0].update(audience="observer"),
            "audience must be one of: player, keeper",
        ),
        (
            lambda value: value["opening_hooks"][0].update(text=12),
            "text must be a non-empty string",
        ),
        (
            lambda value: value["opening_handouts"][0].pop("when_to_give"),
            "missing required field.*when_to_give",
        ),
        (
            lambda value: value["pregens"][0].pop("hooks_to_plot"),
            "missing required field.*hooks_to_plot",
        ),
        (
            lambda value: value["pregens"][0].update(hooks_to_plot=None),
            "hooks_to_plot must be an array of non-empty strings",
        ),
        (
            lambda value: value["pregens"][0].update(hooks_to_plot=[""]),
            "hooks_to_plot must be an array of non-empty strings",
        ),
        (
            lambda value: value["pregens"][0].update(hooks_to_plot="收到那封信"),
            "hooks_to_plot must be an array of non-empty strings",
        ),
        (
            lambda value: value["pregens"][0].update(name=""),
            r"pregens\[0\]\.name must be a non-empty string or null",
        ),
        (
            lambda value: value["pregens"][0].update(age=True),
            r"pregens\[0\]\.age must be a string, integer, or null",
        ),
        (
            lambda value: value["pregens"][0].update(backstory_blocks=12),
            "backstory_blocks must be a string, object, array, or null",
        ),
        (
            lambda value: value["pregens"][0].update(stats_ref=12),
            "stats_ref must be a string, object, or null",
        ),
    ],
)
def test_pi_module_init_l0_reports_exact_invalid_field(mutate, error):
    value = _l0()
    mutate(value)
    with pytest.raises(ops.RuntimeOperationError, match=error):
        ops._validate_module_init_l0(value)


def _l0_guidance_gaps(schema: dict) -> list[str]:
    """Every validator-required L0 field that lacks producer shape guidance.

    This is the structural gate that turns a future validator/schema drift
    (a new required field, a renamed rule key, or a dropped rule) into an
    immediate test failure instead of a late production rejection. It is
    deliberately computed from the validator's own required-field constants,
    so a new required field fails the gate until the producer schema and the
    prompt rule sentences cover it.
    """
    gaps: list[str] = []
    listed_top = set(schema.get("required_fields", []))
    for field in sorted(ops._MODULE_INIT_L0_REQUIRED_FIELDS - listed_top):
        gaps.append(f"top-level required_fields missing {field}")
    required_by_group = {
        "module_meta": ops._MODULE_INIT_META_REQUIRED_FIELDS,
        "pregens": ops._MODULE_INIT_PREGEN_REQUIRED_FIELDS,
        "opening_hooks": ops._MODULE_INIT_HOOK_REQUIRED_FIELDS,
        "opening_handouts": ops._MODULE_INIT_HANDOUT_REQUIRED_FIELDS,
    }
    schema_keys = {
        "module_meta": ("module_meta_required_fields", "module_meta_field_rules"),
        "pregens": ("pregen_required_fields", "pregen_field_rules"),
        "opening_hooks": ("opening_hook_required_fields", "opening_hook_field_rules"),
        "opening_handouts": ("opening_handout_required_fields", "opening_handout_field_rules"),
    }
    for group, required in required_by_group.items():
        fields_key, rules_key = schema_keys[group]
        listed = set(schema.get(fields_key, []))
        rules = schema.get(rules_key, {})
        for field in sorted(required - listed):
            gaps.append(f"{group}.{field} missing from {fields_key}")
        for field in sorted(required):
            rule = rules.get(field)
            if not isinstance(rule, str) or not rule.strip():
                gaps.append(f"{group}.{field} missing a rule in {rules_key}")
    chargen = schema.get("chargen_deltas_rule")
    if not isinstance(chargen, str) or "array of objects" not in chargen:
        gaps.append("chargen_deltas missing an array-of-objects shape rule")
    return gaps


@pytest.mark.parametrize(
    "bad",
    [
        {"era_skill_remap": {"Computer Use": "无"}},
        None,
        "none",
        0,
        True,
        [{"ok": 1}, "not-an-object"],
        [{"ok": 1}, None],
    ],
)
def test_pi_module_init_l0_rejects_non_array_chargen_deltas(bad):
    """The validator treats any non-array-of-objects chargen_deltas as invalid."""
    value = _l0()
    value["chargen_deltas"] = bad
    with pytest.raises(
        ops.RuntimeOperationError,
        match="chargen_deltas must be an array of objects",
    ):
        ops._validate_module_init_l0(value)


def test_pi_module_init_l0_accepts_empty_and_object_chargen_deltas():
    """[] and lists of plain objects are both valid; items carry no required keys."""
    value = _l0()
    value["chargen_deltas"] = []
    assert ops._validate_module_init_l0(value)["chargen_deltas"] == []
    deltas = [
        {"era_skill_remap": {"Computer Use": "无"}},
        {"skill": "Credit Rating", "delta": -10, "source": "appendix"},
        {"note": "no adjustments"},
    ]
    value["chargen_deltas"] = deltas
    assert ops._validate_module_init_l0(value)["chargen_deltas"] == deltas


def test_producer_l0_guidance_covers_every_validator_required_field():
    """Every validator-required L0 field has a producer shape rule right now."""
    schema = adapter._module_init_l0_schema()
    assert _l0_guidance_gaps(schema) == []
    assert "[] is valid" in schema["chargen_deltas_rule"]
    assert "no required fields" in schema["chargen_deltas_rule"]


def test_l0_guidance_gate_fails_when_a_required_field_loses_its_rule():
    """Prove the gate catches every future drift class, not just today's gaps."""
    schema = json.loads(json.dumps(adapter._module_init_l0_schema()))
    mutations = [
        (lambda s: s.pop("chargen_deltas_rule"), "chargen_deltas missing"),
        (lambda s: s["required_fields"].remove("chargen_deltas"),
         "top-level required_fields missing chargen_deltas"),
        (lambda s: s["module_meta_required_fields"].remove("party_size"),
         "module_meta.party_size missing from"),
        (lambda s: s["module_meta_field_rules"].pop("tone_tags"),
         "module_meta.tone_tags missing a rule"),
        (lambda s: s["pregen_required_fields"].remove("stats_ref"),
         "pregens.stats_ref missing from"),
        (lambda s: s["pregen_field_rules"].pop("hooks_to_plot"),
         "pregens.hooks_to_plot missing a rule"),
        (lambda s: s["opening_hook_required_fields"].remove("variant_of"),
         "opening_hooks.variant_of missing from"),
        (lambda s: s["opening_hook_field_rules"].pop("audience"),
         "opening_hooks.audience missing a rule"),
        (lambda s: s["opening_handout_field_rules"].pop("when_to_give"),
         "opening_handouts.when_to_give missing a rule"),
    ]
    for mutate, expected in mutations:
        candidate = json.loads(json.dumps(schema))
        mutate(candidate)
        gaps = _l0_guidance_gaps(candidate)
        assert any(expected in gap for gap in gaps), (expected, gaps)


def test_opening_prompt_carries_chargen_deltas_and_module_meta_shape_rules(
    tmp_path: Path,
):
    """The producer prompt states the chargen_deltas and module_meta shapes."""
    _bundle, source_id = _source_bundle(tmp_path)
    task = {
        "workspace_root": str(tmp_path),
        "campaign_id": "prompt-shape",
        "scenario_id": "far-page-letter",
        "title": "Far Page Letter",
        "play_language": "zh-Hans",
        "source": {"source_id": source_id},
        "source_bundle_path": str(tmp_path / "reviewed-bundle"),
        "opening_fast_facts_schema": {},
        "module_init_l0_schema": {},
        "reusable_bound_source": {"manifest": {"pages": []}},
    }
    materialized = {
        "selected_opening_pdf_indices": [10, 11],
        "fact_evidence_pdf_indices": [3, 10, 11],
        "bundle": {"pages": []},
    }
    prompt = adapter._opening_text_prompt(task, materialized)
    assert "chargen_deltas MUST be an array of objects" in prompt
    assert "may be [] when the source makes no creation adjustments" in prompt
    assert "a single dict or any other non-array is invalid" in prompt
    assert "no required fields" in prompt
    assert (
        "module_meta MUST include every field named by its required fields list"
        in prompt
    )
    assert "party_size is a string, integer, or null" in prompt
    assert "authors, translator, and safety_notes are null, a string, or an array" in prompt
    assert (
        "tone_tags, mythos_entities, campaign_hooks, and warnings are arrays"
        in prompt
    )
    assert "use [] when the source names none -- never null" in prompt
    assert "Do not expose full source text in L0" in prompt



def test_pi_module_init_l0_accepts_complete_opening_shapes():
    assert ops._validate_module_init_l0(_l0()) == _l0()


def test_pi_module_init_l0_accepts_empty_hooks_to_plot_array():
    """The validator contract allows [] when the source lists no hooks.

    The producer guidance must therefore never demand fabricated hooks; it
    only forbids null and empty-string entries.
    """
    value = _l0()
    value["pregens"][0]["hooks_to_plot"] = []
    assert ops._validate_module_init_l0(value) == value


def test_pi_module_init_l0_unblocks_contract_and_preserves_extensions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("COC_HOST", "pi")
    campaign_id = "l0-ready"
    _bundle, source_id = _create_and_bind(tmp_path, campaign_id)
    facts = _review_and_apply_l0(tmp_path, campaign_id, source_id, _l0(extension=True))

    adopted = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.adopt_source_facts",
        "payload": {"campaign_id": campaign_id, "facts": facts},
    })
    assert adopted["result"]["module_init_ready"] is True
    assert adopted["result"]["character_creation_unblocked"] is True
    assert f".coc/campaigns/{campaign_id}/save/module-init.json" in adopted["state_refs"]

    state = json.loads((
        tmp_path / ".coc" / "campaigns" / campaign_id / "save" / "module-init.json"
    ).read_text(encoding="utf-8"))
    assert state["secrecy"] == "keeper_only"
    assert state["source_binding"]["scenario_id"] == "far-page-letter"
    assert state["l0"]["module_meta"]["publisher_imprint"] == "自定义版本"
    assert state["l0"]["pregens"][0]["private_handout"] == "letter-handout"
    assert state["l0"]["module_specific_rule"] == {"status": "optional"}

    contract = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.contract",
        "payload": {"campaign_id": campaign_id},
    })
    assert contract["status"] == "PASS"
    # The hot investigator contract is only the fail-closed admission gate;
    # it never embeds keeper-only package fields.
    assert "module_init" not in contract["result"]
    assert "private_handout" not in json.dumps(contract, ensure_ascii=False)


def test_pi_module_init_source_binding_drift_fails_closed_for_contract(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("COC_HOST", "pi")
    campaign_id = "l0-source-drift"
    _bundle, source_id = _create_and_bind(tmp_path, campaign_id)
    facts = _review_and_apply_l0(tmp_path, campaign_id, source_id, _l0())
    ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.adopt_source_facts",
        "payload": {"campaign_id": campaign_id, "facts": facts},
    })
    state_path = (
        tmp_path / ".coc" / "campaigns" / campaign_id / "save" / "module-init.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["source_binding"]["bundle_sha256"] = "f" * 64
    state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ops.RuntimeOperationError, match="coc-module-init L0"):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.contract",
            "payload": {"campaign_id": campaign_id},
        })


def test_pi_module_init_private_projection_is_source_bound_and_not_on_contract_wire(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("COC_HOST", "pi")
    campaign_id = "l0-private-projection"
    _bundle, source_id = _create_and_bind(tmp_path, campaign_id)
    l0 = _l0(extension=True)
    sentinel = "KEEPER_ONLY_L0_SENTINEL"
    l0["module_specific_rule"] = {
        "status": "optional",
        "sentinel": sentinel,
    }
    facts = _review_and_apply_l0(tmp_path, campaign_id, source_id, l0)
    ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.adopt_source_facts",
        "payload": {"campaign_id": campaign_id, "facts": facts},
    })
    contract = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.contract",
        "payload": {"campaign_id": campaign_id},
    })
    state = json.loads((
        tmp_path / ".coc" / "campaigns" / campaign_id / "save" / "module-init.json"
    ).read_text(encoding="utf-8"))
    assert sentinel not in json.dumps(contract, ensure_ascii=False)
    fixture = tmp_path / "module-init-private-context.json"
    fixture.write_text(json.dumps({
        "workspace": str(tmp_path),
        "params": {
            "operation": "setup.investigator_contract",
            "campaign": campaign_id,
            "arguments": {"campaign_id": campaign_id},
        },
        "envelope": {
            "ok": True,
            "tool": "setup.investigator_contract",
            "data": contract,
        },
        "expected_l0": state["l0"],
        "expected_l0_sha256": state["l0_sha256"],
        "sentinel": sentinel,
    }, ensure_ascii=False), encoding="utf-8")
    completed = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(REPO / "tests" / "pi" / "module-init-private-context.mjs"),
            str(REPO),
            str(fixture),
        ],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(completed.stdout)
    assert result["ok"] is True
    assert result["secrecy"] == "keeper_only"
    assert result["l0Sha256"] == state["l0_sha256"]


def test_pi_module_init_l0_missing_fails_closed_for_contract_and_create(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("COC_HOST", "pi")
    campaign_id = "l0-missing"
    _bundle, source_id = _create_and_bind(tmp_path, campaign_id)
    facts = _facts(source_id, 23)
    adopted = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.adopt_source_facts",
        "payload": {"campaign_id": campaign_id, "facts": facts},
    })
    assert adopted["result"]["module_init_ready"] is False
    assert adopted["result"]["character_creation_unblocked"] is False

    with pytest.raises(ops.RuntimeOperationError, match="coc-module-init L0"):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.contract",
            "payload": {"campaign_id": campaign_id},
        })
    with pytest.raises(ops.RuntimeOperationError, match="coc-module-init L0"):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": {
                "campaign_id": campaign_id,
                "investigator_id": "blocked-before-l0",
                "sheet": {},
                "creation": {
                    "input_mode": "guided_quick_fire",
                    "characteristic_assignment_order": [],
                },
            },
        })


def test_opening_l0_failure_evidence_is_private_and_outside_campaign_state(
    tmp_path: Path,
):
    adapter = _load("coc_pdf_adapter_l0_evidence_test", ADAPTER_PATH)
    campaign_dir = tmp_path / ".coc" / "campaigns" / "evidence-campaign"
    payload = {"pregens": [{"name": "林晓", "hooks_to_plot": None}]}
    path = adapter._write_opening_l0_failure_evidence(
        campaign_dir,
        {
            "campaign_id": "evidence-campaign",
            "scenario_id": "far-page-letter",
            "opening_review_generation": 3,
        },
        payload,
        "pregens[0].hooks_to_plot must be an array of non-empty strings",
    )
    assert path == campaign_dir / "logs" / "opening-source-review-evidence" / "l0-producer-failure-g3.json"
    evidence = json.loads(path.read_text(encoding="utf-8"))
    assert evidence["secrecy"] == "keeper_only"
    assert evidence["module_init_l0"] == payload
    assert not (campaign_dir / "save" / "module-init.json").exists()


def test_l0_soft_location_accepts_non_front_matter_fixture_without_page_rule(
    tmp_path: Path,
):
    """Cover/placeholder pages do not constrain the semantic L0 locator."""
    _bundle, source_id = _source_bundle(tmp_path)
    adapter = _load("coc_pdf_adapter_l0_soft_location_test", ADAPTER_PATH)
    task = {
        "campaign_id": "soft-location",
        "scenario_id": "far-page-letter",
        "source_bundle_path": str(tmp_path / "reviewed-bundle"),
        "source": {"source_id": source_id},
        "reusable_bound_source": {"manifest": {"pages": []}},
    }
    result = {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-pdf-producer-result.v1",
        "status": "reviewed",
        "campaign_id": "soft-location",
        "scenario_id": "far-page-letter",
        "selected_opening_pdf_indices": [17],
        "fact_evidence_pdf_indices": [23],
        "source_bundle_path": str(tmp_path / "reviewed-bundle"),
        "failure_class": None,
        "facts": _facts(source_id, 23),
        "module_init_l0": _l0(),
    }
    assert adapter._validate_opening_result(result, task)["fact_evidence_pdf_indices"] == [23]
    materialized = {
        "selected_opening_pdf_indices": [17],
        "fact_evidence_pdf_indices": [23],
        "bundle": {"pages": []},
    }
    task = {
        **task,
        "workspace_root": str(tmp_path),
        "title": "Far Page Letter",
        "play_language": "zh-Hans",
        "opening_fast_facts_schema": {},
        "module_init_l0_schema": {},
    }
    prompt = adapter._opening_text_prompt(task, materialized)
    assert "positions are not fixed" in prompt
    assert "grep/find anchors" in prompt
    assert "semantically" in prompt
    assert "Do not assume the first N pages" in prompt
    assert "first 5 pages" not in prompt
    assert "variant_of is present as null" in prompt
    assert "audience is exactly player or keeper" in prompt
    assert "Every pregen and opening_handouts item MUST include every field" in prompt
    assert "hooks_to_plot is an" in prompt
    assert "never null and never empty-string entries" in prompt
    assert "Handout rules: id is a non-empty string" in prompt
    schema = adapter._module_init_l0_schema()
    assert "array of non-empty strings" in schema["pregen_field_rules"]["hooks_to_plot"]
    assert schema["pregen_field_rules"]["age"] == "null, string, or integer"
    assert schema["pregen_field_rules"]["stats_ref"] == "null, string, or object"
    assert schema["pregen_field_rules"]["backstory_blocks"] == "null, string, array, or object"
