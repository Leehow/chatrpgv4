import hashlib
import importlib.util
import json
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "runtime/adapters/compiler/run_epistemic_compile.mjs"
HAUNTING = ROOT / "plugins/coc-keeper/references/starter-scenarios/the-haunting"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


epistemic = _load(
    "epistemic_contract_transport_compile",
    ROOT / "plugins/coc-keeper/scripts/coc_epistemic_compile.py",
)
adapter = _load(
    "epistemic_contract_transport_adapter",
    ROOT / "runtime/adapters/compiler/epistemic_adapter.py",
)
hydration = _load(
    "epistemic_contract_transport_hydration",
    ROOT / "plugins/coc-keeper/scripts/coc_scenario_hydration.py",
)


def _campaign(tmp_path: Path) -> Path:
    campaign = tmp_path / ".coc/campaigns/cold"
    (campaign / "scenario").mkdir(parents=True)
    (campaign / "save").mkdir(parents=True)
    (campaign / "save/world-state.json").write_text(
        json.dumps({"schema_version": 1, "campaign_id": "cold"}), encoding="utf-8"
    )
    (campaign / "scenario/scenario.json").write_text(json.dumps({
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "resolution_policy": "source_first",
        "source": {"path": "/private/module.pdf", "pdf_index_start": 446},
    }), encoding="utf-8")
    return campaign


def _source(monkeypatch):
    source = {
        "source_id": "pdf:keeper-rulebook", "path": "/private/module.pdf",
        "title": "Keeper Rulebook", "file_sha256": "a" * 64,
        "page_count": 465, "pdf_index_start": 446, "pdf_index_end": 446,
    }
    pages = [{"pdf_index": 446, "text": "KEEPER_SENTINEL_SECRET_PROSE", "text_sha256": "b" * 64}]
    monkeypatch.setattr(hydration, "_extract_source", lambda _seed: (source, pages))


def _bundle():
    result = {
        name: json.loads((HAUNTING / name).read_text(encoding="utf-8"))
        for name in hydration.REQUIRED_FILES
    }

    def retarget(value):
        if isinstance(value, list):
            return [retarget(item) for item in value]
        if not isinstance(value, dict):
            return value
        value = {key: retarget(item) for key, item in value.items()}
        if isinstance(value.get("source_refs"), list):
            value["source_refs"] = [{"source_id": "pdf:keeper-rulebook", "pdf_index": 446}]
        return value

    return retarget(result)


def _fake_runner(tmp_path: Path, *, always_reject: bool = False) -> Path:
    path = tmp_path / "fake-epistemic-runner.mjs"
    path.write_text(
        """import crypto from 'node:crypto';
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
const envelope=JSON.parse(chunks.join('')); const sha=crypto.createHash('sha256').update(envelope.compile_request_json).digest('hex');
if (!envelope.correction_feedback || ALWAYS_REJECT) {
  const diagnostic={schema_version:1,phase:'epistemic_compile',error_code:'compile_result_root_keys_mismatch',epistemic_request_sha256:sha,expected_key_names:['schema_version','evaluator_id','evaluation_provenance','epistemic_graph','reveal_contracts','compile_confidence','reasons'],present_expected_key_names:['epistemic_graph'],missing_key_names:['schema_version'],unexpected_key_count:0,unexpected_key_sha256:[],rejected_result_sha256:crypto.createHash('sha256').update('{}').digest('hex'),rejected_result_bytes:2,model_identity:{provider:'fixture',id:'terra'}};
  process.stdout.write(JSON.stringify({ok:false,error_code:diagnostic.error_code,diagnostic})+'\\n'); process.exitCode=1;
} else {
  const compile_result={schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{schema_version:2,questions:[],evidence_links:[]},reveal_contracts:{schema_version:2,contracts:[]},compile_confidence:{schema_version:1,default_threshold:0.8,nodes:[]},reasons:{}};
  process.stdout.write(JSON.stringify({ok:true,compile_result,model_identity:{provider:'fixture',id:'terra'}})+'\\n');
}
""".replace("ALWAYS_REJECT", "true" if always_reject else "false"),
        encoding="utf-8",
    )
    return path


def test_python_request_contract_is_the_shared_exact_seven_key_contract():
    request = epistemic.build_compile_request(HAUNTING)
    expected = request["expected_output"]

    assert expected["required"] == list(epistemic.RESULT_ROOT_KEYS)
    assert expected["ordered_root_keys"] == list(epistemic.RESULT_ROOT_KEYS)
    assert expected["additional_properties"] is False
    assert expected["identity"] == {
        "schema_version": 1,
        "evaluator_id": "codex-epistemic-compiler-v1",
    }
    assert expected["evaluation_provenance"]["additional_properties"] is False


def test_real_tool_schema_and_execute_reject_five_keys_and_wrapper_then_accept_direct():
    script = r"""
import {buildResultParameters, buildSubmissionTool} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const sha='a'.repeat(64); const schema=buildResultParameters(sha);
const base={evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{},reveal_contracts:{},compile_confidence:{},reasons:{}};
async function submit(value){const holder={result:null,rejection:null};const tool=buildSubmissionTool({request_sha256:sha},holder,{provider:'fixture',id:'terra'});await tool.execute('id',value);return {result:holder.result,rejection:holder.rejection};}
const five=await submit(base); const wrapped=await submit({compile_result:{schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',...base}}); const valid=await submit({schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',...base});
process.stdout.write(JSON.stringify({schema,five,wrapped,valid}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    found = json.loads(proc.stdout)
    schema = found["schema"]
    assert schema["required"] == list(epistemic.RESULT_ROOT_KEYS)
    assert schema["additionalProperties"] is False
    assert schema["properties"]["evaluation_provenance"]["additionalProperties"] is False
    assert found["five"]["rejection"]["missing_key_names"] == ["evaluator_id", "schema_version"]
    assert found["wrapped"]["rejection"]["unexpected_key_count"] == 1
    assert len(found["wrapped"]["rejection"]["unexpected_key_sha256"]) == 1
    assert found["valid"]["result"]["schema_version"] == 1


def test_js_boundary_rejects_identity_provenance_extras_and_non_object_documents():
    script = r"""
import {validateResult} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const sha='a'.repeat(64); const base={schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{},reveal_contracts:{},compile_confidence:{},reasons:{}};
const cases={schema_string:{...base,schema_version:'1'},schema_bool:{...base,schema_version:true},stale_sha:{...base,evaluation_provenance:{...base.evaluation_provenance,request_sha256:'b'.repeat(64)}},provenance_extra:{...base,evaluation_provenance:{...base.evaluation_provenance,usage:{}}},array_graph:{...base,epistemic_graph:[]},null_contracts:{...base,reveal_contracts:null},scalar_confidence:{...base,compile_confidence:1},unexpected_usage:{...base,usage:{}},unexpected_data:{...base,data:{}},unexpected_raw:{...base,raw_module_prose:'SENTINEL'}};
const found={}; for(const [name,value] of Object.entries(cases)){try{validateResult(value,sha,{provider:'fixture',id:'terra'});found[name]='accepted';}catch(error){found[name]=error.error_code;}}
process.stdout.write(JSON.stringify(found));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    found = json.loads(proc.stdout)
    assert found == {
        "schema_string": "compile_result_identity_invalid",
        "schema_bool": "compile_result_identity_invalid",
        "stale_sha": "compile_result_provenance_invalid",
        "provenance_extra": "compile_result_provenance_invalid",
        "array_graph": "compile_result_document_type_invalid",
        "null_contracts": "compile_result_document_type_invalid",
        "scalar_confidence": "compile_result_document_type_invalid",
        "unexpected_usage": "compile_result_root_keys_mismatch",
        "unexpected_data": "compile_result_root_keys_mismatch",
        "unexpected_raw": "compile_result_root_keys_mismatch",
    }


def test_real_pi_path_runs_raw_prepare_before_converting_typebox_validator():
    script = r"""
import {validateToolArguments} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/validation.js';
import {buildSubmissionTool} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const sha='a'.repeat(64); const holder={result:null,rejection:null,submissions:0}; const tool=buildSubmissionTool({request_sha256:sha},holder,{provider:'fixture',id:'terra'});
const base={schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{},reveal_contracts:{},compile_confidence:{},reasons:{}};
const prepared=tool.prepareArguments(base); const accepted=validateToolArguments(tool,{name:tool.name,arguments:prepared});
let booleanRejected=false; const boolHolder={result:null,rejection:null,submissions:0}; const boolTool=buildSubmissionTool({request_sha256:sha},boolHolder,{provider:'fixture',id:'terra'}); try{const converted=boolTool.prepareArguments({...base,schema_version:true});validateToolArguments(boolTool,{name:boolTool.name,arguments:converted});}catch(error){booleanRejected=String(error)==='Error: epistemic_arguments_rejected';}
process.stdout.write(JSON.stringify({accepted,booleanRejected,submissions:holder.submissions}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    found = json.loads(proc.stdout)
    assert found["accepted"]["schema_version"] == 1
    assert found["booleanRejected"] is True
    assert found["submissions"] == 1


def test_runner_fake_session_uses_actual_tool_and_rejects_second_submission():
    script = r"""
import {validateToolArguments} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/validation.js';
import {run} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const compile_request_json=JSON.stringify({kind:'coc_epistemic_compile_request',unicode:'树',nested:{b:2,a:1}}); const dependencies={provider:'fixture',modelId:'terra',agentDir:'.',resolveModel:()=>({model:{provider:'fixture',id:'terra'},registry:{}})};
async function invoke(mode){return run({compile_request_json},{...dependencies,sessionFactory:async({tool})=>({session:{prompt:async()=>{const sha=tool.parameters.properties.evaluation_provenance.properties.request_sha256.const;const base={schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{},reveal_contracts:{},compile_confidence:{},reasons:{}};if(mode==='double'){try{tool.prepareArguments({...base,schema_version:true});}catch{};try{tool.prepareArguments(base);}catch{};return;}const prepared=tool.prepareArguments(base);const converted=validateToolArguments(tool,{name:tool.name,arguments:prepared});await tool.execute('id',converted);},dispose:()=>{}}})});}
const success=await invoke('success');let doubleCode;try{await invoke('double');}catch(error){doubleCode=error.error_code;}
process.stdout.write(JSON.stringify({success,doubleCode}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    found = json.loads(proc.stdout)
    assert found["success"]["ok"] is True
    assert found["success"]["compile_result"]["schema_version"] == 1
    assert found["doubleCode"] == "compile_result_submission_limit_exceeded"


def test_adapter_retries_once_with_safe_feedback_and_preserves_diagnostic(tmp_path):
    request = epistemic.build_compile_request(HAUNTING)
    response = adapter.compile_epistemic(request, runner_path=_fake_runner(tmp_path))

    assert response["ok"] is True
    assert response["epistemic_attempts"] == 2
    assert len(response["rejected_attempts"]) == 1
    assert response["rejected_attempts"][0]["error_code"] == "compile_result_root_keys_mismatch"


def test_adapter_drops_forged_diagnostic_fields_and_model_controlled_key_names():
    digest = "a" * 64
    diagnostic = adapter._safe_diagnostic({
        "error_code": "compile_result_root_keys_mismatch",
        "epistemic_request_sha256": digest,
        "rejected_result_sha256": "b" * 64,
        "rejected_result_bytes": 12,
        "expected_key_names": ["schema_version", "KEEPER_SECRET_SENTINEL"],
        "present_expected_key_names": ["epistemic_graph", "KEEPER_SECRET_SENTINEL"],
        "missing_key_names": ["evaluator_id", "KEEPER_SECRET_SENTINEL"],
        "unexpected_key_count": 1,
        "unexpected_key_sha256": [hashlib.sha256(b"KEEPER_SECRET_SENTINEL").hexdigest()],
        "model_identity": {"provider": "fixture", "id": "terra"},
        "unknown": "KEEPER_SECRET_SENTINEL",
    }, digest)
    assert diagnostic is not None
    serialized = json.dumps(diagnostic)
    assert "KEEPER_SECRET_SENTINEL" not in serialized
    assert "unknown" not in diagnostic


def test_hydration_correction_reuses_base_stage_and_records_safe_receipt(tmp_path, monkeypatch):
    campaign = _campaign(tmp_path)
    _source(monkeypatch)
    base_calls = []

    def compile_base(request):
        base_calls.append(request)
        return {"ok": True, "scenario_bundle": _bundle()}

    receipt = hydration.ensure_scenario_ready(
        campaign,
        compiler=compile_base,
        epistemic_runner_path=_fake_runner(tmp_path),
        compile_epistemic_sidecars=True,
    )

    assert len(base_calls) == 1
    assert receipt["status"] == "PASS"
    assert receipt["epistemic_sidecars"]["attempts"] == 2
    matches = list((campaign / "logs/scenario-resolution").glob(
        f"{receipt['request_sha256']}.epistemic-*.rejected-1.json"
    ))
    assert len(matches) == 1
    rejection_path = matches[0]
    persisted = json.loads(rejection_path.read_text(encoding="utf-8"))
    assert persisted["base_request_sha256"] == receipt["request_sha256"]
    assert persisted["error_code"] == "compile_result_root_keys_mismatch"
    assert "KEEPER_SENTINEL_SECRET_PROSE" not in rejection_path.read_text(encoding="utf-8")


def test_rejection_receipt_is_bounded_concurrent_idempotent_and_conflict_safe(tmp_path):
    campaign = tmp_path / "campaign"
    campaign.mkdir()
    filename = "receipt.json"
    path = campaign / "logs/scenario-resolution" / filename
    payload = {
        "schema_version": 1,
        "status": "REJECTED",
        "phase": "epistemic_compile",
        "base_request_sha256": "a" * 64,
        "epistemic_request_sha256": "b" * 64,
        "attempt": 1,
        "error_code": "compile_result_root_keys_mismatch",
        "rejected_result_sha256": "c" * 64,
        "rejected_result_bytes": 2,
        "model_identity": {"provider": "fixture", "id": "terra"},
    }
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(
            lambda _index: hydration._write_epistemic_receipt_exclusive(
                campaign, filename, payload
            ),
            range(8),
        ))
    before = path.read_bytes()
    hydration._write_epistemic_receipt_exclusive(campaign, filename, payload)
    assert path.read_bytes() == before
    assert len(before) <= 8192
    with pytest.raises(hydration.ScenarioHydrationError, match="conflict"):
        hydration._write_epistemic_receipt_exclusive(
            campaign,
            filename,
            {**payload, "rejected_result_sha256": "d" * 64},
        )


def test_rejection_receipt_rejects_preexisting_symlinked_parent(tmp_path):
    campaign = tmp_path / "campaign"
    outside = tmp_path / "outside"
    (campaign / "logs").mkdir(parents=True)
    outside.mkdir()
    (campaign / "logs/scenario-resolution").symlink_to(
        outside, target_is_directory=True
    )

    with pytest.raises(hydration.ScenarioHydrationError, match="directory is invalid"):
        hydration._write_epistemic_receipt_exclusive(
            campaign, "receipt.json", {"schema_version": 1}
        )

    assert not (outside / "receipt.json").exists()


def test_rejection_receipt_parent_name_swap_stays_in_opened_directory(tmp_path):
    campaign = tmp_path / "campaign"
    resolution = campaign / "logs/scenario-resolution"
    retained = campaign / "logs/scenario-resolution-retained"
    outside = tmp_path / "outside"
    resolution.mkdir(parents=True)
    outside.mkdir()

    def swap_parent_name():
        resolution.rename(retained)
        resolution.symlink_to(outside, target_is_directory=True)

    hydration._write_epistemic_receipt_exclusive(
        campaign,
        "receipt.json",
        {"schema_version": 1},
        _after_directory_open=swap_parent_name,
    )

    assert not (outside / "receipt.json").exists()
    assert (retained / "receipt.json").is_file()


def test_exhausted_correction_rolls_back_and_records_both_safe_attempts(tmp_path, monkeypatch):
    campaign = _campaign(tmp_path)
    for name in hydration.REQUIRED_FILES:
        shutil.copy2(HAUNTING / name, campaign / "scenario" / name)
    before = {name: (campaign / "scenario" / name).read_bytes() for name in hydration.REQUIRED_FILES}
    old_resolution = b'{"schema_version":1,"status":"PASS","sentinel":"OLD"}\n'
    (campaign / "scenario/resolution-receipt.json").write_bytes(old_resolution)
    old_sidecars = {
        "epistemic-graph.json": b'{"schema_version":2,"questions":[],"evidence_links":[]}\n',
        "reveal-contracts.json": b'{"schema_version":2,"contracts":[]}\n',
        "compile-confidence.json": b'{"schema_version":1,"default_threshold":0.8,"nodes":[]}\n',
    }
    for name, content in old_sidecars.items():
        (campaign / "scenario" / name).write_bytes(content)
    _source(monkeypatch)

    with pytest.raises(hydration.ScenarioHydrationError, match="rejected result"):
        hydration.ensure_scenario_ready(
            campaign,
            compiler=lambda _request: {"ok": True, "scenario_bundle": _bundle()},
            epistemic_runner_path=_fake_runner(tmp_path, always_reject=True),
            compile_epistemic_sidecars=True,
            force_recompile=True,
        )

    after = {name: (campaign / "scenario" / name).read_bytes() for name in hydration.REQUIRED_FILES}
    assert after == before
    assert (campaign / "scenario/resolution-receipt.json").read_bytes() == old_resolution
    assert {
        name: (campaign / "scenario" / name).read_bytes() for name in old_sidecars
    } == old_sidecars
    receipts = sorted((campaign / "logs/scenario-resolution").glob("*.epistemic-*.rejected-*.json"))
    assert len(receipts) == 2
    combined = "".join(path.read_text(encoding="utf-8") for path in receipts)
    assert "KEEPER_SENTINEL_SECRET_PROSE" not in combined
    assert not list((campaign / "scenario").parent.glob(".scenario-compile-*"))
