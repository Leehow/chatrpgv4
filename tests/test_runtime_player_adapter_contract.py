"""Contract tests for the player-brain adapter (Python wrapper + fake runners)."""
from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
PLAYER_DIR = REPO / "runtime" / "adapters" / "player"
ADAPTER_PATH = PLAYER_DIR / "adapter.py"
RUNNER_PATH = PLAYER_DIR / "run_player_turn.mjs"


def _load_adapter():
    spec = importlib.util.spec_from_file_location("runtime_player_adapter", ADAPTER_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _sample_request() -> dict:
    return {
        "public_state": {
            "schema_version": 1,
            "campaign_id": "live",
            "active_scene_id": "scene-1",
            "turn_number": 0,
            "discovered_clue_ids": [],
            "investigators": [],
            "pending_choice": None,
        },
        "narration": "雨还在下，门廊上有新鲜脚印。",
        "character_card": {
            "id": "inv1",
            "occupation": "Antiquarian",
            "skills": {"Spot Hidden": 60},
        },
        "transcript_tail": [
            {"role": "keeper", "text": "你站在门廊前。"},
        ],
        "pending_choice": None,
    }


def _write_fake_runner(path: Path, *, stdout: str, exit_code: int = 0) -> None:
    script = f"""#!/usr/bin/env python3
import sys
sys.stdout.write({stdout!r})
sys.exit({exit_code})
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _write_echo_runner(path: Path) -> None:
    """Fake runner that returns a fixed player_text and echoes request size."""
    script = """#!/usr/bin/env python3
import json, sys
req = json.loads(sys.stdin.read())
assert "public_state" in req
assert "narration" in req
assert "character_card" in req
out = {
    "ok": True,
    "player_text": "我仔细检查门廊上的脚印。",
    "player_notes": "脚印可能通向侧门。",
}
sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\\n")
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _write_test_models(
    agent_dir: Path,
    *,
    base_url: str,
    api_key: str = "test-key",
    provider: str = "coding-relay",
    model_id: str = "gpt-5.6",
) -> None:
    agent_dir.mkdir()
    (agent_dir / "models.json").write_text(
        json.dumps({
            "providers": {
                provider: {
                    "name": f"Test {provider}",
                    "baseUrl": base_url,
                    "api": "openai-completions",
                    "apiKey": api_key,
                    "models": [{
                        "id": model_id,
                        "name": f"Template {model_id}",
                        "contextWindow": 128000,
                        "maxTokens": 4096,
                    }],
                },
            },
        }),
        encoding="utf-8",
    )


def _resolve_player_model(agent_dir: Path, provider: str, model_id: str):
    script = """
const [_serverFlag, moduleUrl, agentDir, provider, modelId] = process.argv.slice(1);
const { resolveRequestedModel } = await import(moduleUrl);
const { model, modelRegistry } = resolveRequestedModel({ agentDir, provider, modelId });
const auth = await modelRegistry.getApiKeyAndHeaders(model);
process.stdout.write(JSON.stringify({
  identity: { provider: model.provider, id: model.id, name: model.name },
  request: { api: model.api, baseUrl: model.baseUrl },
  auth_ok: auth.ok,
  registry_has_exact: modelRegistry.find(provider, modelId) !== undefined,
  configured_provider_models: modelRegistry.getAvailable()
    .filter((candidate) => candidate.provider === provider)
    .map((candidate) => candidate.id),
}));
"""
    return subprocess.run(
        [
            "node",
            "--input-type=module",
            "--eval",
            script,
            "--",
            "--server",
            RUNNER_PATH.as_uri(),
            str(agent_dir),
            provider,
            model_id,
        ],
        text=True,
        input="",
        capture_output=True,
        timeout=20,
        check=False,
    )


def test_parse_runner_response_requires_ok_and_player_text():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {"ok": True, "player_text": "我环顾四周。", "player_notes": "先观察。"}
    )
    assert parsed["player_text"] == "我环顾四周。"
    assert parsed["player_notes"] == "先观察。"


def test_parse_runner_response_rejects_ok_false():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="model unavailable"):
        adapter.parse_runner_response({"ok": False, "error": "model unavailable"})


def test_parse_runner_response_rejects_missing_player_text():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="player_text"):
        adapter.parse_runner_response({"ok": True})


def test_parse_runner_response_rejects_non_string_player_text():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="player_text"):
        adapter.parse_runner_response({"ok": True, "player_text": 42})


def test_parse_runner_response_accepts_valid_intent_class():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "player_text": "我仔细搜查现场。",
            "intent_class": "investigate",
        }
    )
    assert parsed["intent_class"] == "investigate"


def test_parse_runner_response_accepts_typed_player_pending_choice_response():
    adapter = _load_adapter()
    response = {
        "choice_id": "push-offer:confirm",
        "responder": "player",
        "revision": 0,
        "action": "cancel",
    }
    parsed = adapter.parse_runner_response({
        "ok": True,
        "player_text": "我不冒这个险。",
        "pending_choice_response": response,
    })
    assert parsed["pending_choice_response"] == response


def test_parse_runner_response_accepts_action_only_pending_choice_response():
    adapter = _load_adapter()
    response = {
        "choice_id": "push-offer:confirm",
        "responder": "player",
        "revision": 0,
        "action": "cancel",
    }
    parsed = adapter.parse_runner_response({
        "ok": True,
        "pending_choice_response": response,
    })
    assert parsed["player_text"] == ""
    assert parsed["pending_choice_response"] == response


def test_parse_runner_response_rejects_keeper_pending_choice_response():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="pending_choice_response"):
        adapter.parse_runner_response({
            "ok": True,
            "player_text": "继续。",
            "pending_choice_response": {
                "choice_id": "san:bout",
                "responder": "keeper",
                "revision": 0,
                "action": "tick",
            },
        })


def test_parse_runner_response_preserves_observed_model_and_response_mode():
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "player_text": "我检查门锁。",
            "model_identity": {"provider": "openai", "id": "gpt-evidence"},
            "response_mode": "tool",
        }
    )

    assert parsed["model_identity"] == {
        "provider": "openai",
        "id": "gpt-evidence",
    }
    assert parsed["response_mode"] == "tool"


def test_parse_runner_response_preserves_optional_model_usage_metadata():
    parsed = _load_adapter().parse_runner_response({
        "ok": True, "player_text": "我检查门锁。",
        "usage": {"input_tokens": 12, "output_tokens": 4},
    })
    assert parsed["usage"] == {"input_tokens": 12, "output_tokens": 4}


def test_parse_runner_response_rejects_invalid_intent_class():
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="intent_class"):
        adapter.parse_runner_response(
            {
                "ok": True,
                "player_text": "我仔细搜查现场。",
                "intent_class": "flirting",
            }
        )


def test_player_send_turn_round_trip_with_fake_runner(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_player_runner"
    _write_echo_runner(runner)

    result = adapter.player_send_turn(_sample_request(), runner_path=runner)
    assert result["player_text"] == "我仔细检查门廊上的脚印。"
    assert result["player_notes"] == "脚印可能通向侧门。"


def test_player_send_turn_rejects_response_mismatching_requested_choice(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_mismatched_choice"
    _write_fake_runner(
        runner,
        stdout=json.dumps({
            "ok": True,
            "player_text": "我确认。",
            "pending_choice_response": {
                "choice_id": "another-choice",
                "responder": "player",
                "revision": 0,
                "action": "confirm",
            },
        }) + "\n",
    )
    request = _sample_request()
    request["pending_choice"] = {
        "choice_id": "push-offer:confirm",
        "kind": "push_confirm",
        "responder": "player",
        "revision": 0,
        "options": [{"action": "confirm", "label": "Push"}],
    }

    with pytest.raises(RuntimeError, match="canonical pending choice"):
        adapter.player_send_turn(request, runner_path=runner)


def test_player_send_turn_accepts_action_only_matching_choice(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_action_only_choice"
    response = {
        "choice_id": "push-offer:confirm",
        "responder": "player",
        "revision": 0,
        "action": "cancel",
    }
    _write_fake_runner(
        runner,
        stdout=json.dumps({"ok": True, "pending_choice_response": response}) + "\n",
    )
    request = _sample_request()
    request["pending_choice"] = {
        "choice_id": "push-offer:confirm",
        "kind": "push_confirm",
        "responder": "player",
        "revision": 0,
        "options": [{"action": "cancel", "label": "Keep failure"}],
    }
    result = adapter.player_send_turn(request, runner_path=runner)
    assert result == {"ok": True, "player_text": "", "pending_choice_response": response}


def test_player_send_turn_requires_request_keys(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_player_runner"
    _write_echo_runner(runner)
    with pytest.raises(ValueError, match="public_state"):
        adapter.player_send_turn({"narration": "x"}, runner_path=runner)


def test_player_send_turn_raises_on_nonzero_exit(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_fail"
    _write_fake_runner(runner, stdout='{"ok": false, "error": "boom"}\n', exit_code=1)
    with pytest.raises(RuntimeError):
        adapter.player_send_turn(_sample_request(), runner_path=runner)


def test_player_send_turn_raises_on_ok_false_even_with_zero_exit(tmp_path):
    adapter = _load_adapter()
    runner = tmp_path / "fake_ok_false"
    _write_fake_runner(
        runner,
        stdout='{"ok": false, "error": "model unavailable"}\n',
        exit_code=0,
    )
    with pytest.raises(RuntimeError, match="model unavailable"):
        adapter.player_send_turn(_sample_request(), runner_path=runner)


def test_player_request_schema_documents_required_keys():
    adapter = _load_adapter()
    assert set(adapter.PLAYER_REQUEST_KEYS) == {
        "public_state",
        "narration",
        "character_card",
        "transcript_tail",
        "pending_choice",
    }


def test_parse_runner_response_accepts_prose_degraded_shape():
    """Prose-without-tool degradation is a valid ok envelope (usable player_text)."""
    adapter = _load_adapter()
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "player_text": "我蹲下仔细查看门廊上的脚印。",
            "player_notes": (
                "player_missing_tool_use: model returned prose without coc_player_action"
            ),
        }
    )
    assert parsed["player_text"].startswith("我蹲下")
    assert "player_missing_tool_use" in parsed["player_notes"]
    assert "intent_class" not in parsed


def test_parse_runner_response_recovers_tool_scaffolding_from_prose():
    """Glued coc_player_action field labels must not leak into player_text."""
    adapter = _load_adapter()
    blob = (
        "coc_player_actionplayer_text: 海斯没有去碰那个话题。"
        "他把身体往椅背一靠。intent_class: socialplayer_notes: "
        "海斯注意到签名，选择不直接揭穿。"
    )
    parsed = adapter.parse_runner_response(
        {
            "ok": True,
            "player_text": blob,
            "player_notes": (
                "player_missing_tool_use: model returned prose without coc_player_action"
            ),
        }
    )
    assert parsed["player_text"].startswith("海斯没有去碰那个话题")
    assert "coc_player_action" not in parsed["player_text"]
    assert "intent_class:" not in parsed["player_text"]
    assert "player_notes:" not in parsed["player_text"]
    assert parsed["intent_class"] == "social"
    assert parsed["player_notes"].startswith("海斯注意到签名")


def test_recover_player_action_scaffolding_leaves_ordinary_prose_alone():
    adapter = _load_adapter()
    assert adapter.recover_player_action_scaffolding("我推开侧门往里看一眼。") is None
    assert adapter.recover_player_action_scaffolding("") is None


def test_player_send_turn_accepts_prose_degraded_fake_runner(tmp_path):
    """Fake runner emitting prose-degraded shape must round-trip through adapter."""
    adapter = _load_adapter()
    runner = tmp_path / "fake_prose_degraded"
    _write_fake_runner(
        runner,
        stdout=json.dumps(
            {
                "ok": True,
                "player_text": "我推开侧门往里看一眼。",
                "player_notes": (
                    "player_missing_tool_use: model returned prose without coc_player_action"
                ),
            },
            ensure_ascii=False,
        )
        + "\n",
    )
    result = adapter.player_send_turn(_sample_request(), runner_path=runner)
    assert result["player_text"] == "我推开侧门往里看一眼。"
    assert result["player_notes"].startswith("player_missing_tool_use:")


def test_run_player_turn_mjs_is_real_bridge_not_placeholder():
    """Sanity: committed runner is the real Pi bridge, not the N5 placeholder stub."""
    source = (PLAYER_DIR / "run_player_turn.mjs").read_text(encoding="utf-8")
    assert "coc_player_action" in source
    assert "@earendil-works/pi-coding-agent" in source
    assert "placeholder" not in source.lower()
    assert "player_missing_tool_use" in source
    assert "session.model" in source
    assert "model_identity" in source
    assert "response_mode" in source
    assert "pending_choice_response" in source
    pkg = json.loads((PLAYER_DIR / "package.json").read_text(encoding="utf-8"))
    assert pkg["dependencies"]["@earendil-works/pi-coding-agent"] == "0.79.9"


def test_player_runner_pins_luna_without_mutating_global_default():
    source = (PLAYER_DIR / "run_player_turn.mjs").read_text(encoding="utf-8")
    assert "COC_PLAYER_MODEL_PROVIDER" in source
    assert "COC_PLAYER_MODEL_ID" in source
    assert "createAgentSession({" in source and "modelRegistry" in source
    assert "setModel(" not in source


def test_player_resolves_missing_luna_from_authenticated_relay_template(tmp_path):
    agent_dir = tmp_path / "agent"
    _write_test_models(agent_dir, base_url="http://127.0.0.1:1/v1")

    completed = _resolve_player_model(agent_dir, "coding-relay", "gpt-5.6-luna")

    assert completed.returncode == 0, completed.stderr
    resolved = json.loads(completed.stdout)
    assert resolved["identity"] == {
        "provider": "coding-relay",
        "id": "gpt-5.6-luna",
        "name": "gpt-5.6-luna",
    }
    assert resolved["request"] == {
        "api": "openai-completions",
        "baseUrl": "http://127.0.0.1:1/v1",
    }
    assert resolved["auth_ok"] is True
    assert resolved["registry_has_exact"] is False
    assert resolved["configured_provider_models"] == ["gpt-5.6"]


def test_player_dynamic_relay_resolution_still_fails_closed_without_template_auth(
    tmp_path, monkeypatch
):
    authenticated_dir = tmp_path / "authenticated"
    _write_test_models(authenticated_dir, base_url="http://127.0.0.1:1/v1")
    unknown = _resolve_player_model(
        authenticated_dir, "unknown-provider", "gpt-5.6-luna"
    )
    assert unknown.returncode != 0
    assert "requested model unavailable: unknown-provider/gpt-5.6-luna" in unknown.stderr

    unauthenticated_dir = tmp_path / "unauthenticated"
    missing_key = "COC_TEST_INTENTIONALLY_MISSING_RELAY_KEY"
    monkeypatch.delenv(missing_key, raising=False)
    _write_test_models(
        unauthenticated_dir,
        base_url="http://127.0.0.1:1/v1",
        api_key=f"${missing_key}",
    )
    unauthenticated = _resolve_player_model(
        unauthenticated_dir, "coding-relay", "gpt-5.6-luna"
    )
    assert unauthenticated.returncode != 0
    assert "requested model unavailable: coding-relay/gpt-5.6-luna" in (
        unauthenticated.stderr
    )


def test_player_luna_request_surfaces_endpoint_404_without_model_fallback(tmp_path):
    requests = []

    class NotFoundHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            requests.append(json.loads(self.rfile.read(length)))
            body = b'{"error":{"message":"test luna endpoint missing"}}'
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), NotFoundHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        agent_dir = tmp_path / "agent"
        _write_test_models(
            agent_dir,
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
        )
        env = dict(os.environ)
        env["PI_CODING_AGENT_DIR"] = str(agent_dir)
        env.pop("COC_PLAYER_MODEL_PROVIDER", None)
        env.pop("COC_PLAYER_MODEL_ID", None)
        completed = subprocess.run(
            ["node", str(RUNNER_PATH)],
            input=json.dumps(_sample_request(), ensure_ascii=False),
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
            env=env,
            cwd=PLAYER_DIR,
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert completed.returncode != 0
    response = json.loads(completed.stdout.strip().splitlines()[-1])
    assert response["ok"] is False
    assert "404" in response["error"]
    assert requests
    assert {request["model"] for request in requests} == {"gpt-5.6-luna"}


def test_player_server_does_not_reuse_prior_turn_provider_error(tmp_path):
    requests = []

    class ErrorThenSuccessHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            requests.append(json.loads(self.rfile.read(length)))
            if len(requests) == 1:
                body = b'{"error":{"message":"historical test 404"}}'
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
            else:
                chunks = [
                    {
                        "id": "chatcmpl-current-turn",
                        "object": "chat.completion.chunk",
                        "model": "gpt-5.6-luna",
                        "choices": [{
                            "index": 0,
                            "delta": {
                                "role": "assistant",
                                "content": "I inspect the later footprints.",
                            },
                            "finish_reason": None,
                        }],
                    },
                    {
                        "id": "chatcmpl-current-turn",
                        "object": "chat.completion.chunk",
                        "model": "gpt-5.6-luna",
                        "choices": [{
                            "index": 0,
                            "delta": {},
                            "finish_reason": "stop",
                        }],
                    },
                ]
                body = (
                    "".join(
                        f"data: {json.dumps(chunk)}\n\n" for chunk in chunks
                    )
                    + "data: [DONE]\n\n"
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), ErrorThenSuccessHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        agent_dir = tmp_path / "agent"
        _write_test_models(
            agent_dir,
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
        )
        env = dict(os.environ)
        env["PI_CODING_AGENT_DIR"] = str(agent_dir)
        env.pop("COC_PLAYER_MODEL_PROVIDER", None)
        env.pop("COC_PLAYER_MODEL_ID", None)
        later_request = _sample_request()
        later_request["narration"] = "Later footprints cross the hallway."
        server_input = "\n".join([
            json.dumps({"request_id": "turn-1", "payload": _sample_request()}),
            json.dumps({"request_id": "turn-2", "payload": later_request}),
        ]) + "\n"
        completed = subprocess.run(
            ["node", str(RUNNER_PATH), "--server"],
            input=server_input,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
            env=env,
            cwd=PLAYER_DIR,
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert completed.returncode == 0, completed.stderr
    responses = [json.loads(line) for line in completed.stdout.splitlines()]
    assert len(responses) == 2
    assert responses[0]["request_id"] == "turn-1"
    assert responses[0]["ok"] is False
    assert "404" in responses[0]["error"]
    assert responses[1] == {
        "request_id": "turn-2",
        "ok": True,
        "player_text": "I inspect the later footprints.",
        "player_notes": (
            "player_missing_tool_use: model returned prose without coc_player_action"
        ),
        "response_mode": "prose_fallback",
        "model_identity": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
    }
    assert {request["model"] for request in requests} == {"gpt-5.6-luna"}


def test_player_current_turn_retry_success_clears_transient_provider_error(tmp_path):
    requests = []

    class RetryThenSuccessHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            requests.append(json.loads(self.rfile.read(length)))
            if len(requests) == 1:
                body = b'{"error":{"message":"transient test 500"}}'
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
            else:
                chunks = [
                    {
                        "id": "chatcmpl-retry-success",
                        "object": "chat.completion.chunk",
                        "model": "gpt-5.6-luna",
                        "choices": [{
                            "index": 0,
                            "delta": {
                                "role": "assistant",
                                "content": "I follow the fresh footprints.",
                            },
                            "finish_reason": None,
                        }],
                    },
                    {
                        "id": "chatcmpl-retry-success",
                        "object": "chat.completion.chunk",
                        "model": "gpt-5.6-luna",
                        "choices": [{
                            "index": 0,
                            "delta": {},
                            "finish_reason": "stop",
                        }],
                    },
                ]
                body = (
                    "".join(
                        f"data: {json.dumps(chunk)}\n\n" for chunk in chunks
                    )
                    + "data: [DONE]\n\n"
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), RetryThenSuccessHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        agent_dir = tmp_path / "agent"
        _write_test_models(
            agent_dir,
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
        )
        (agent_dir / "settings.json").write_text(
            json.dumps({
                "retry": {"enabled": True, "maxRetries": 1, "baseDelayMs": 1},
            }),
            encoding="utf-8",
        )
        env = dict(os.environ)
        env["PI_CODING_AGENT_DIR"] = str(agent_dir)
        env.pop("COC_PLAYER_MODEL_PROVIDER", None)
        env.pop("COC_PLAYER_MODEL_ID", None)
        completed = subprocess.run(
            ["node", str(RUNNER_PATH)],
            input=json.dumps(_sample_request(), ensure_ascii=False),
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
            env=env,
            cwd=PLAYER_DIR,
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert completed.returncode == 0, completed.stdout
    assert json.loads(completed.stdout) == {
        "ok": True,
        "player_text": "I follow the fresh footprints.",
        "player_notes": (
            "player_missing_tool_use: model returned prose without coc_player_action"
        ),
        "response_mode": "prose_fallback",
        "model_identity": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
    }
    assert len(requests) == 2
    assert {request["model"] for request in requests} == {"gpt-5.6-luna"}
