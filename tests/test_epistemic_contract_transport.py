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
    pages = [{
        "pdf_index": 446,
        "text": "KEEPER_SENTINEL_SECRET_PROSE",
        "text_sha256": "b" * 64,
        "review_state": "manual_accepted",
        "parse_confidence": 0.93,
        "grep_anchors": [],
    }]
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
const sha='a'.repeat(64); const holder={result:null,rejection:null}; const tool=buildSubmissionTool({request_sha256:sha},holder,{provider:'fixture',id:'terra'});
const base={schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{},reveal_contracts:{},compile_confidence:{},reasons:{}};
const prepared=tool.prepareArguments(base); const accepted=validateToolArguments(tool,{name:tool.name,arguments:prepared});
const boolHolder={result:null,rejection:null}; const boolTool=buildSubmissionTool({request_sha256:sha},boolHolder,{provider:'fixture',id:'terra'}); const converted=boolTool.prepareArguments({...base,schema_version:true}); const neutral=validateToolArguments(boolTool,{name:boolTool.name,arguments:converted}); const outcome=await boolTool.execute('boolean',neutral);
process.stdout.write(JSON.stringify({accepted,holder,boolHolder,outcome}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    found = json.loads(proc.stdout)
    assert found["accepted"]["schema_version"] == 1
    assert found["holder"]["rawAttempts"] == 1
    assert found["boolHolder"]["rawAttempts"] == 1
    assert found["boolHolder"]["acceptedResults"] == 0
    assert found["boolHolder"]["rejection"]["error_code"] == "compile_result_identity_invalid"
    assert found["boolHolder"]["rejection"]["rejected_result_bytes"] != 4
    assert found["boolHolder"]["rejection"]["rejected_result_sha256"] != hashlib.sha256(b"null").hexdigest()
    assert found["outcome"]["terminate"] is True
    assert json.loads(found["outcome"]["content"][0]["text"]) == {
        "ok": False,
        "error_code": "epistemic_arguments_rejected",
    }


def test_runner_fake_session_terminates_raw_invalid_and_accepts_one_valid_result():
    script = r"""
import {validateToolArguments} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/validation.js';
import {run} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const compile_request_json=JSON.stringify({kind:'coc_epistemic_compile_request',unicode:'树',nested:{b:2,a:1}}); const dependencies={provider:'fixture',modelId:'terra',agentDir:'.',resolveModel:()=>({model:{provider:'fixture',id:'terra'},registry:{}})};
async function invoke(mode){return run({compile_request_json},{...dependencies,sessionFactory:async({tool})=>({session:{prompt:async()=>{const sha=tool.parameters.properties.evaluation_provenance.properties.request_sha256.const;const base={schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{},reveal_contracts:{},compile_confidence:{},reasons:{}};const raw=mode==='invalid'?{...base,schema_version:true}:base;const prepared=tool.prepareArguments(raw);const converted=validateToolArguments(tool,{name:tool.name,arguments:prepared});await tool.execute('id',converted);},dispose:()=>{}}})});}
const success=await invoke('success');let invalid;try{await invoke('invalid');}catch(error){invalid=error;}
process.stdout.write(JSON.stringify({success,invalid}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    found = json.loads(proc.stdout)
    assert found["success"]["ok"] is True
    assert found["success"]["compile_result"]["schema_version"] == 1
    assert found["success"]["submission_audit"] == {
        "raw_attempts": 1,
        "validated_candidates": 1,
        "accepted_results": 1,
        "rejected_raw_attempts": 0,
        "duplicate_valid_candidates": 0,
    }
    assert found["invalid"]["error_code"] == "compile_result_identity_invalid"
    assert found["invalid"]["diagnostic_subject"] == "rejected_result"
    assert found["invalid"]["submission_attempt"] == 1
    assert found["invalid"]["accepted_result_count"] == 0


def test_real_pi_loop_invalid_raw_call_terminates_before_same_session_correction():
    script = r"""
import {runAgentLoop} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js';
import {createAssistantMessageEventStream} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js';
import {buildSubmissionTool} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const sha='a'.repeat(64); const holder={result:null,rejection:null}; const tool=buildSubmissionTool({request_sha256:sha},holder,{provider:'fixture',id:'terra'});
const invalid={schema_version:true,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{},reveal_contracts:{},compile_confidence:{},reasons:{}};
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const assistant={role:'assistant',content:[{type:'toolCall',id:'bad',name:tool.name,arguments:invalid}],api:'openai-completions',provider:'fixture',model:'terra',usage,stopReason:'toolUse',timestamp:1};
let modelCalls=0; const streamFn=()=>{modelCalls+=1;const stream=createAssistantMessageEventStream();stream.push({type:'done',reason:'toolUse',message:assistant});return stream;};
const messages=await runAgentLoop([{role:'user',content:'compile',timestamp:0}],{systemPrompt:'test',messages:[],tools:[tool]},{model:{provider:'fixture',id:'terra',api:'openai-completions'},convertToLlm:(items)=>items},()=>{},undefined,streamFn);
const toolResults=messages.filter((message)=>message.role==='toolResult');
process.stdout.write(JSON.stringify({modelCalls,holder,toolResults}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    found = json.loads(proc.stdout)
    assert found["modelCalls"] == 1
    assert found["holder"]["rawAttempts"] == 1
    assert found["holder"]["acceptedResults"] == 0
    assert found["holder"]["rejection"]["error_code"] == "compile_result_identity_invalid"
    assert len(found["toolResults"]) == 1
    assert json.loads(found["toolResults"][0]["content"][0]["text"]) == {
        "ok": False,
        "error_code": "epistemic_arguments_rejected",
    }


def test_real_pi_loop_two_valid_calls_is_sequential_first_result_wins():
    script = r"""
import {runAgentLoop} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js';
import {createAssistantMessageEventStream} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js';
import {buildSubmissionTool} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const sha='a'.repeat(64); const holder={result:null,rejection:null}; const tool=buildSubmissionTool({request_sha256:sha},holder,{provider:'fixture',id:'terra'});
const base={schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{winner:'first'},reveal_contracts:{},compile_confidence:{},reasons:{}};
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const assistant={role:'assistant',content:[{type:'toolCall',id:'first',name:tool.name,arguments:base},{type:'toolCall',id:'second',name:tool.name,arguments:{...base,epistemic_graph:{winner:'second'}}}],api:'openai-completions',provider:'fixture',model:'terra',usage,stopReason:'toolUse',timestamp:1};
const streamFn=()=>{const stream=createAssistantMessageEventStream();stream.push({type:'done',reason:'toolUse',message:assistant});return stream;};
const messages=await runAgentLoop([{role:'user',content:'compile',timestamp:0}],{systemPrompt:'test',messages:[],tools:[tool]},{model:{provider:'fixture',id:'terra',api:'openai-completions'},convertToLlm:(items)=>items},()=>{},undefined,streamFn);
process.stdout.write(JSON.stringify({executionMode:tool.executionMode,holder,toolResults:messages.filter((message)=>message.role==='toolResult')}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    found = json.loads(proc.stdout)
    assert found["executionMode"] == "sequential"
    assert found["holder"]["rawAttempts"] == 2
    assert found["holder"]["acceptedResults"] == 1
    assert found["holder"]["duplicateValidCandidates"] == 1
    assert found["holder"]["result"]["epistemic_graph"] == {"winner": "first"}
    assert len(found["toolResults"]) == 2
    assert found["toolResults"][1]["details"] == {"ok": True, "already_received": True}


def test_real_pi_loop_invalid_then_valid_batch_cannot_correct_in_same_session():
    script = r"""
import {runAgentLoop} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js';
import {createAssistantMessageEventStream} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js';
import {buildSubmissionTool} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const sha='a'.repeat(64);const holder={result:null,rejection:null};const tool=buildSubmissionTool({request_sha256:sha},holder,{provider:'fixture',id:'terra'});const valid={schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{},reveal_contracts:{},compile_confidence:{},reasons:{}};const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};const assistant={role:'assistant',content:[{type:'toolCall',id:'bad',name:tool.name,arguments:{...valid,schema_version:true}},{type:'toolCall',id:'later',name:tool.name,arguments:valid}],api:'openai-completions',provider:'fixture',model:'terra',usage,stopReason:'toolUse',timestamp:1};const streamFn=()=>{const stream=createAssistantMessageEventStream();stream.push({type:'done',reason:'toolUse',message:assistant});return stream;};const messages=await runAgentLoop([{role:'user',content:'compile',timestamp:0}],{systemPrompt:'test',messages:[],tools:[tool]},{model:{provider:'fixture',id:'terra',api:'openai-completions'},convertToLlm:(items)=>items},()=>{},undefined,streamFn);process.stdout.write(JSON.stringify({holder,toolResults:messages.filter((message)=>message.role==='toolResult')}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    found = json.loads(proc.stdout)
    assert found["holder"]["rawAttempts"] == 2
    assert found["holder"]["validatedCandidates"] == 0
    assert found["holder"]["acceptedResults"] == 0
    assert found["holder"]["result"] is None
    assert found["holder"]["rejection"]["error_code"] == "compile_result_identity_invalid"
    assert len(found["toolResults"]) == 2
    assert all(
        json.loads(result["content"][0]["text"])["error_code"]
        == "epistemic_arguments_rejected"
        for result in found["toolResults"]
    )


def test_runner_not_submitted_diagnostic_has_no_synthetic_null_fingerprint():
    script = r"""
import {run} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const compile_request_json=JSON.stringify({kind:'coc_epistemic_compile_request'});const dependencies={provider:'fixture',modelId:'terra',agentDir:'.',resolveModel:()=>({model:{provider:'fixture',id:'terra'},registry:{}}),sessionFactory:async()=>({session:{prompt:async()=>{},dispose:()=>{}}})};
let diagnostic;try{await run({compile_request_json},dependencies);}catch(error){diagnostic=error;}
process.stdout.write(JSON.stringify(diagnostic));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    diagnostic = json.loads(proc.stdout)
    assert diagnostic["error_code"] == "compile_result_not_submitted"
    assert diagnostic["diagnostic_subject"] == "none"
    assert "rejected_result_sha256" not in diagnostic
    assert "rejected_result_bytes" not in diagnostic


def test_manual_duplicate_preparations_cannot_overwrite_first_valid_candidate():
    script = r"""
import {validateToolArguments} from './runtime/adapters/compiler/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/validation.js';
import {buildSubmissionTool} from './runtime/adapters/compiler/run_epistemic_compile.mjs';
const sha='a'.repeat(64);const holder={result:null,rejection:null};const tool=buildSubmissionTool({request_sha256:sha},holder,{provider:'fixture',id:'terra'});const base={schema_version:1,evaluator_id:'codex-epistemic-compiler-v1',evaluation_provenance:{kind:'llm',request_sha256:sha,reviewed_artifact:'epistemic-compile-request.json'},epistemic_graph:{winner:'first'},reveal_contracts:{},compile_confidence:{},reasons:{}};
const first=validateToolArguments(tool,{name:tool.name,arguments:tool.prepareArguments(base)});const second=validateToolArguments(tool,{name:tool.name,arguments:tool.prepareArguments({...base,epistemic_graph:{winner:'second'}})});const firstResult=await tool.execute('first',first);const secondResult=await tool.execute('second',second);process.stdout.write(JSON.stringify({holder,firstResult,secondResult}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    found = json.loads(proc.stdout)
    assert found["holder"]["rawAttempts"] == 2
    assert found["holder"]["validatedCandidates"] == 1
    assert found["holder"]["acceptedResults"] == 1
    assert found["holder"]["duplicateValidCandidates"] == 1
    assert found["holder"]["result"]["epistemic_graph"] == {"winner": "first"}
    assert found["firstResult"]["terminate"] is True
    assert found["secondResult"]["details"] == {"ok": True, "already_received": True}


def test_adapter_retries_once_with_safe_feedback_and_preserves_diagnostic(tmp_path):
    request = epistemic.build_compile_request(HAUNTING)
    response = adapter.compile_epistemic(request, runner_path=_fake_runner(tmp_path))

    assert response["ok"] is True
    assert response["epistemic_attempts"] == 2
    assert len(response["rejected_attempts"]) == 1
    assert response["rejected_attempts"][0]["error_code"] == "compile_result_root_keys_mismatch"


def test_adapter_fresh_correction_reuses_exact_request_and_stops_at_two_processes(
    monkeypatch,
):
    request = epistemic.build_compile_request(HAUNTING)
    envelopes = []

    def invoke(_runner, envelope, *, timeout_s):
        assert timeout_s == 900
        envelopes.append(json.loads(json.dumps(envelope)))
        digest = hashlib.sha256(envelope["compile_request_json"].encode()).hexdigest()
        if len(envelopes) == 1:
            diagnostic = {
                "schema_version": 1,
                "phase": "epistemic_compile",
                "error_code": "compile_result_root_keys_mismatch",
                "diagnostic_subject": "rejected_result",
                "epistemic_request_sha256": digest,
                "rejected_result_sha256": hashlib.sha256(b"{}").hexdigest(),
                "rejected_result_bytes": 2,
                "model_identity": {"provider": "fixture", "id": "terra"},
            }
            return 1, json.dumps({"ok": False, "diagnostic": diagnostic})
        result = {
            "schema_version": 1,
            "evaluator_id": "codex-epistemic-compiler-v1",
            "evaluation_provenance": {
                "kind": "llm",
                "request_sha256": digest,
                "reviewed_artifact": "epistemic-compile-request.json",
            },
            "epistemic_graph": {},
            "reveal_contracts": {},
            "compile_confidence": {},
            "reasons": {},
        }
        return 0, json.dumps({
            "ok": True,
            "compile_result": result,
            "model_identity": {"provider": "fixture", "id": "terra"},
        })

    monkeypatch.setattr(adapter, "_invoke_runner", invoke)
    response = adapter.compile_epistemic(request, runner_path=RUNNER)

    assert response["ok"] is True
    assert response["epistemic_attempts"] == 2
    assert len(envelopes) == 2
    assert envelopes[0]["compile_request_json"] == envelopes[1]["compile_request_json"]
    assert set(envelopes[0]) == {"compile_request_json"}
    assert set(envelopes[1]) == {"compile_request_json", "correction_feedback"}
    assert envelopes[1]["correction_feedback"]["process_attempt"] == 1
    assert "KEEPER_SENTINEL_SECRET_PROSE" not in json.dumps(
        envelopes[1]["correction_feedback"]
    )


def test_adapter_duplicate_valid_protocol_diagnostic_never_starts_fresh_process(
    monkeypatch,
):
    request = epistemic.build_compile_request(HAUNTING)
    calls = 0

    def invoke(_runner, envelope, *, timeout_s):
        nonlocal calls
        calls += 1
        digest = hashlib.sha256(envelope["compile_request_json"].encode()).hexdigest()
        diagnostic = {
            "schema_version": 1,
            "phase": "epistemic_compile",
            "error_code": "compile_result_duplicate_valid_candidate",
            "diagnostic_subject": "none",
            "epistemic_request_sha256": digest,
            "accepted_result_count": 1,
            "failure_class": "duplicate_valid_candidate",
            "model_identity": {"provider": "fixture", "id": "terra"},
        }
        return 1, json.dumps({"ok": False, "diagnostic": diagnostic})

    monkeypatch.setattr(adapter, "_invoke_runner", invoke)
    with pytest.raises(adapter.EpistemicCompileRejected) as exc_info:
        adapter.compile_epistemic(request, runner_path=RUNNER)

    assert calls == 1
    assert exc_info.value.diagnostics[0]["error_code"] == (
        "compile_result_duplicate_valid_candidate"
    )


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


def test_adapter_accepts_payload_free_not_submitted_diagnostic_without_sha_null():
    digest = "a" * 64
    diagnostic = adapter._safe_diagnostic({
        "error_code": "compile_result_not_submitted",
        "diagnostic_subject": "none",
        "epistemic_request_sha256": digest,
        "accepted_result_count": 0,
        "failure_class": "not_submitted",
        "model_identity": {"provider": "fixture", "id": "terra"},
    }, digest)
    assert diagnostic == {
        "schema_version": 1,
        "phase": "epistemic_compile",
        "error_code": "compile_result_not_submitted",
        "diagnostic_subject": "none",
        "epistemic_request_sha256": digest,
        "expected_key_names": [],
        "present_expected_key_names": [],
        "missing_key_names": [],
        "provenance_expected_key_names": [],
        "provenance_present_expected_key_names": [],
        "provenance_missing_key_names": [],
        "unexpected_key_sha256": [],
        "provenance_unexpected_key_sha256": [],
        "unexpected_key_count": 0,
        "provenance_unexpected_key_count": 0,
        "model_identity": {"provider": "fixture", "id": "terra"},
        "accepted_result_count": 0,
        "failure_class": "not_submitted",
    }
    assert adapter._safe_diagnostic({
        **diagnostic,
        "rejected_result_sha256": hashlib.sha256(b"null").hexdigest(),
        "rejected_result_bytes": 4,
    }, digest) is None


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


def test_exhausted_correction_keeps_new_base_and_records_both_safe_attempts(
    tmp_path, monkeypatch
):
    campaign = _campaign(tmp_path)
    for name in hydration.REQUIRED_FILES:
        shutil.copy2(HAUNTING / name, campaign / "scenario" / name)
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

    receipt = hydration.ensure_scenario_ready(
        campaign,
        compiler=lambda _request: {"ok": True, "scenario_bundle": _bundle()},
        epistemic_runner_path=_fake_runner(tmp_path, always_reject=True),
        compile_epistemic_sidecars=True,
        force_recompile=True,
    )

    assert receipt["status"] == "PASS"
    assert receipt["epistemic_sidecars"]["status"] == "FAIL"
    assert receipt["epistemic_sidecars"]["reason"] == "compile_result_rejected"
    assert receipt["epistemic_sidecars"]["rejection_receipts"] == "PASS"
    assert len(receipt["epistemic_sidecars"]["error_sha256"]) == 64
    assert (campaign / "scenario/resolution-receipt.json").read_bytes() != old_resolution
    assert {
        name: json.loads((campaign / "scenario" / name).read_text(encoding="utf-8"))
        for name in hydration.REQUIRED_FILES
    } == _bundle()
    assert not any((campaign / "scenario" / name).exists() for name in old_sidecars)
    receipts = sorted((campaign / "logs/scenario-resolution").glob("*.epistemic-*.rejected-*.json"))
    assert len(receipts) == 2
    combined = "".join(path.read_text(encoding="utf-8") for path in receipts)
    assert "KEEPER_SENTINEL_SECRET_PROSE" not in combined
    assert not list((campaign / "scenario").parent.glob(".scenario-compile-*"))
