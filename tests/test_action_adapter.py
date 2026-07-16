"""Strict subprocess contract for the KP semantic action adapter."""
from __future__ import annotations

import importlib.util
import json
import stat
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
ADAPTER_PATH = REPO / "runtime" / "adapters" / "compiler" / "action_adapter.py"
JS_RUNNER = REPO / "runtime" / "adapters" / "compiler" / "run_action_resolve.mjs"


def _load_adapter():
    spec = importlib.util.spec_from_file_location("runtime_action_adapter_test", ADAPTER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


adapter = _load_adapter()


def _resolution(*, push_request):
    is_push = push_request is not None
    return {
        "schema_version": 1,
        "evaluator_id": "coc-action-resolver-v1",
        "matched_affordance_ids": [] if is_push else ["persuade-arty"],
        "matched_destination_scene_id": None,
        "normalized_target_entities": ["Arty"],
        "normalized_action_atoms": (
            [] if is_push else [{
                "id": "persuade-arty", "verb": "persuade", "target": "Arty",
                "requires_roll": True, "skill": "Persuade",
            }]
        ),
        "push_request": push_request,
        "primary_intent": "social",
        "confidence": 0.99,
        "reason": "The action binds the exact authored route.",
        "no_match": False,
    }


def _request(*, with_candidate: bool):
    request = {
        "player_text": "I make a careful case to Arty.",
        "active_scene": {"scene_id": "newspaper-morgue"},
        "public_affordances": [{"affordance_id": "persuade-arty"}],
        "destination_candidates": [],
        "weapon_candidates": [{"weapon_id": "unarmed"}],
        "push_candidate": None,
    }
    if with_candidate:
        request["push_candidate"] = {
            "candidate_id": "push:turn-3-rule-1",
            "route_id": "persuade-arty",
        }
    return request


def _runner(tmp_path: Path, raw: dict) -> Path:
    path = tmp_path / "action-resolver-fixture"
    payload = json.dumps(raw, ensure_ascii=False)
    path.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "sys.stdin.read()\n"
        f"sys.stdout.write({payload!r})\n",
        encoding="utf-8",
    )
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


@pytest.mark.parametrize(
    ("push_request", "with_candidate"),
    [
        (None, False),
        ({
            "candidate_id": "push:turn-3-rule-1",
            "changed_method_summary": "Ruth supervises and I accept liability",
        }, True),
    ],
)
def test_action_adapter_subprocess_preserves_current_nullable_push_contract(
    tmp_path, push_request, with_candidate,
):
    raw = {
        "ok": True,
        "action_resolution": _resolution(push_request=push_request),
        "model_identity": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "response_mode": "json",
    }

    result = adapter.resolve_action(
        _request(with_candidate=with_candidate),
        runner_path=_runner(tmp_path, raw),
    )

    assert result["push_request"] == push_request
    assert result["model_identity"] == {
        "provider": "coding-relay", "id": "gpt-5.6-luna",
    }


def test_action_adapter_requires_push_field_from_current_canonical_runner():
    resolution = _resolution(push_request=None)
    resolution.pop("push_request")

    with pytest.raises(RuntimeError, match="unsupported or missing fields"):
        adapter.parse_action_resolution({"ok": True, "action_resolution": resolution})


@pytest.mark.parametrize(
    "push_request",
    [
        {},
        {"candidate_id": "push:turn-3-rule-1"},
        {"candidate_id": "", "changed_method_summary": "changed"},
        {
            "candidate_id": "push:turn-3-rule-1",
            "changed_method_summary": "",
        },
        {
            "candidate_id": "push:turn-3-rule-1",
            "changed_method_summary": "changed",
            "extra": True,
        },
    ],
)
def test_action_adapter_rejects_malformed_non_null_push_request(push_request):
    with pytest.raises(RuntimeError, match="exact candidate and changed-method"):
        adapter.parse_action_resolution({
            "ok": True,
            "action_resolution": _resolution(push_request=push_request),
        })


def test_action_adapter_rejects_unknown_push_candidate_at_request_boundary(
    tmp_path,
):
    push_request = {
        "candidate_id": "push:unknown",
        "changed_method_summary": "Ruth supervises and I accept liability",
    }
    raw = {
        "ok": True,
        "action_resolution": _resolution(push_request=push_request),
    }

    result = adapter.resolve_action(
        _request(with_candidate=True),
        runner_path=_runner(tmp_path, raw),
    )

    assert result["push_request"] is None
    assert result["normalized_action_atoms"] == []
    assert result["matched_affordance_ids"] == []
    assert result["no_match"] is True
    assert result["push_binding_rejection"] == {
        "schema_version": 1,
        "field": "push_request",
        "action": "rejected_to_typed_limitation",
        "reason": "candidate_id_mismatch",
    }


@pytest.mark.parametrize(
    ("conflict", "reason"),
    [
        ("destination", "destination_conflict"),
        ("post_arrival", "post_arrival_conflict"),
    ],
)
def test_action_adapter_rejects_push_with_parallel_action_authority(
    tmp_path, conflict, reason,
):
    push_request = {
        "candidate_id": "push:turn-3-rule-1",
        "changed_method_summary": "Ruth supervises and I accept liability",
    }
    resolution = _resolution(push_request=push_request)
    request = _request(with_candidate=True)
    if conflict == "destination":
        request["destination_candidates"] = [{"scene_id": "central-library"}]
        resolution["matched_destination_scene_id"] = "central-library"
    else:
        request["post_arrival_affordances"] = [{
            "affordance_id": "central-library-search-1835",
            "destination_scene_id": "central-library",
        }]
        resolution["matched_affordance_ids"] = [
            "central-library-search-1835"
        ]

    result = adapter.resolve_action(
        request,
        runner_path=_runner(tmp_path, {
            "ok": True, "action_resolution": resolution,
        }),
    )

    assert result["push_request"] is None
    assert result["matched_affordance_ids"] == []
    assert result["matched_destination_scene_id"] is None
    assert result["normalized_action_atoms"] == []
    assert result["no_match"] is True
    assert result["push_binding_rejection"]["reason"] == reason


def test_action_adapter_suppresses_contradictory_atoms_when_exact_push_wins(
    tmp_path,
):
    push_request = {
        "candidate_id": "push:turn-3-rule-1",
        "changed_method_summary": "Ruth supervises and I accept liability",
    }
    resolution = _resolution(push_request=push_request)
    resolution["normalized_action_atoms"] = [{
        "id": "contradictory-reroll", "verb": "persuade", "target": "Arty",
        "requires_roll": True, "skill": "Persuade",
    }]

    result = adapter.resolve_action(
        _request(with_candidate=True),
        runner_path=_runner(tmp_path, {
            "ok": True,
            "action_resolution": resolution,
        }),
    )

    assert result["push_request"] == push_request
    assert result["matched_affordance_ids"] == []
    assert result["normalized_action_atoms"] == []
    assert result["push_action_normalization"] == {
        "schema_version": 1,
        "field": "normalized_action_atoms",
        "action": "suppressed_for_canonical_push",
        "reason": "push_request_owns_exact_failed_action",
        "suppressed_atom_count": 1,
    }


def test_direct_coding_relay_recovers_bounded_multi_affordance_action_when_no_push_exists(
    monkeypatch,
):
    seen_requests = []
    model_resolution = {
        "matched_affordance_ids": ["accept-commission", "ask-research-options"],
        "matched_destination_scene_id": None,
        "normalized_target_entities": ["Knott"],
        "normalized_action_atoms": [],
        # This is the exact cross-model defect observed in Rev16: a purported
        # Push despite the request containing push_candidate:null.
        "push_request": {
            "candidate_id": "invented-opening-push",
            "changed_method_summary": "accept the commission and ask about records",
        },
        "primary_intent": "social",
        "confidence": 0.98,
        "reason": "The player accepts the job and asks for concrete research leads.",
        "no_match": False,
    }

    class RelayHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - stdlib handler API
            length = int(self.headers.get("content-length", "0"))
            request = json.loads(self.rfile.read(length))
            seen_requests.append(request)
            payload = {
                "choices": [{
                    "message": {
                        "content": json.dumps(model_resolution, ensure_ascii=False),
                    },
                }],
                "usage": {"prompt_tokens": 100, "completion_tokens": 50},
            }
            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), RelayHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv(
        "COC_ACTION_RESOLVER_URL",
        f"http://127.0.0.1:{server.server_port}/v1/chat/completions",
    )
    request = {
        "player_text": (
            "我接受委托，接过钥匙、宅址与预付现金，并请 Knott 告诉我从哪些"
            "公开记录开始调查。"
        ),
        "active_scene": {"scene_id": "commission-briefing"},
        "public_affordances": [
            {"affordance_id": "accept-commission"},
            {"affordance_id": "ask-research-options"},
        ],
        "destination_candidates": [],
        "weapon_candidates": [{"weapon_id": "unarmed"}],
        "push_candidate": None,
    }
    try:
        result = adapter.resolve_action(request, runner_path=JS_RUNNER, timeout_s=30)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert result["matched_affordance_ids"] == [
        "accept-commission", "ask-research-options",
    ]
    assert result["push_request"] is None
    assert result["push_request_normalization"] == {
        "schema_version": 1,
        "field": "push_request",
        "action": "normalized_to_null",
        "reason": "no_push_candidate_supplied",
    }
    assert result["no_match"] is False
    prompt = "\n".join(
        message["content"] for message in seen_requests[0]["messages"]
    )
    assert "push_request MUST be exactly null" in prompt
    assert (
        '"push_request":"must be exactly null because no eligible push candidate was supplied"'
        in prompt
    )


def test_direct_coding_relay_exact_push_suppresses_extra_roll_atom(monkeypatch):
    candidate_id = "push:turn-3-rule-1"
    model_resolution = {
        # Rev27 model shape: the opaque Push capability is present, while the
        # ordinary route ID is intentionally not repeated.
        "matched_affordance_ids": [],
        "matched_destination_scene_id": None,
        "normalized_target_entities": ["Arty"],
        "normalized_action_atoms": [{
            "id": "model-also-rerolls", "verb": "persuade", "target": "Arty",
            "requires_roll": True, "skill": "Persuade",
        }],
        "push_request": {
            "candidate_id": candidate_id,
            "changed_method_summary": "written limits plus staff supervision",
        },
        "primary_intent": "social",
        "confidence": 0.99,
        "reason": "The exact failed route is pushed with a changed method.",
        "no_match": False,
    }

    class RelayHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - stdlib handler API
            length = int(self.headers.get("content-length", "0"))
            self.rfile.read(length)
            encoded = json.dumps({
                "choices": [{"message": {"content": json.dumps(model_resolution)}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 50},
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), RelayHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv(
        "COC_ACTION_RESOLVER_URL",
        f"http://127.0.0.1:{server.server_port}/v1/chat/completions",
    )
    try:
        result = adapter.resolve_action(
            _request(with_candidate=True), runner_path=JS_RUNNER, timeout_s=30
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert result["push_request"] == model_resolution["push_request"]
    assert result["matched_affordance_ids"] == []
    assert result["normalized_action_atoms"] == []
    assert result["push_action_normalization"]["suppressed_atom_count"] == 1


def test_direct_keeper_planner_retries_hard_fact_violation_without_vetoing_judgment(
    monkeypatch,
):
    seen_requests = []

    def proposal(fact_id):
        return {
            "schema_version": 1,
            "source": "model",
            "resolution_mode": "improvised",
            "scene_action": "CHARACTER",
            "player_goal": "ask Ruth about the archive cutoff",
            "fictional_method": "ask a direct routine question",
            "rule_ruling": {
                "decision": "no_roll",
                "operation_kind": None,
                "skill": None,
                "difficulty": None,
                "bonus_penalty_dice": 0,
                "accepted_advice_ids": [
                    "core:roll-only-for-meaningful-uncertainty",
                ],
                "overridden_advice_ids": [],
                "reason": "The answer is routine and carries no uncertain stakes.",
            },
            "npc_ruling": {
                "npc_id": "npc-ruth",
                "tactic": "answer",
                "fact_id": fact_id,
                "reason": "Ruth can answer with the authorized archive fact.",
            },
            "narration_plan": {
                "beat": "character",
                "tone": ["helpful"],
                "sensory_focus": ["paper dust"],
                "end_with": "actionable_hook",
                "objective": "Answer naturally and keep play moving.",
            },
            "rationale": "A normal off-menu question deserves an NPC response.",
        }

    def resolution(fact_id):
        return {
            "matched_affordance_ids": [],
            "matched_destination_scene_id": None,
            "normalized_target_entities": ["Ruth"],
            "normalized_action_atoms": [],
            "push_request": None,
            "primary_intent": "social",
            "confidence": 0.97,
            "reason": "The player asks Ruth a clear off-menu question.",
            "no_match": False,
            "keeper_proposal": proposal(fact_id),
        }

    class RelayHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - stdlib handler API
            length = int(self.headers.get("content-length", "0"))
            request = json.loads(self.rfile.read(length))
            seen_requests.append(request)
            fact_id = "keeper-secret" if len(seen_requests) == 1 else "fact-cutoff"
            encoded = json.dumps({
                "choices": [{"message": {"content": json.dumps(resolution(fact_id))}}],
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), RelayHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv(
        "COC_ACTION_RESOLVER_URL",
        f"http://127.0.0.1:{server.server_port}/v1/chat/completions",
    )
    request = {
        "player_text": "I ask Ruth why the archive stops at 1878.",
        "active_scene": {"scene_id": "archive"},
        "public_affordances": [],
        "destination_candidates": [],
        "weapon_candidates": [{"weapon_id": "unarmed"}],
        "push_candidate": None,
        "rule_advice": [{
            "advice_id": "core:roll-only-for-meaningful-uncertainty",
        }],
        "keeper_context": {
            "present_or_scene_npcs": [{"npc_id": "npc-ruth"}],
            "npc_fact_capabilities": [{
                "npc_id": "npc-ruth",
                "fact_id": "fact-cutoff",
                "known_by_npc": True,
                "revealable": True,
            }],
        },
        "keeper_proposal_contract": {"schema_version": 1},
    }
    try:
        result = adapter.resolve_action(request, runner_path=JS_RUNNER, timeout_s=30)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert len(seen_requests) == 2
    repair_prompt = "\n".join(
        message["content"] for message in seen_requests[1]["messages"]
    )
    assert "selected an unauthorized NPC fact" in repair_prompt
    assert result["keeper_proposal"]["source"] == "model"
    assert result["keeper_proposal"]["npc_ruling"]["fact_id"] == "fact-cutoff"
