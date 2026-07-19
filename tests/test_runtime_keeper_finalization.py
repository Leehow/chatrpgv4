"""Thin Pi/headless contracts for exact turn-finalization release."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
RUNNER = REPO / "runtime" / "adapters" / "keeper" / "run_keeper_turn.mjs"


def _load(name: str, relative: str):
    path = REPO / relative
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _digest(value) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _receipt(
    *, fiction: str = "他把卷宗推到你面前。",
    exceptional: bool = False,
    multi_context: bool = False,
) -> dict:
    roll_id = "roll-finalized-1"
    coverage = [{
        "obligation_id": f"roll:{roll_id}",
        "realization": "fictional_beat",
        "action_realization": "调查员说明了请求。",
        "response": "档案员交出卷宗。",
        "causal_explanation": "请求具体且手续可信。",
        "persona_fit": "符合谨慎的档案员。",
        "player_input_handling": "specific_preserved",
        "exact_excerpt": fiction,
        "exceptional_beat": "",
    }]
    bundle = {
        "schema_version": 1,
        "journal_decision_id": "journal-finalized-1",
        "public_check": [{"roll_id": roll_id}],
        "state_delta": [],
        "context_effect": ([
            {"effect_id": "context:first-a", "npc_id": "npc-a"},
            {"effect_id": "context:first-b", "npc_id": "npc-b"},
        ] if multi_context else []),
        "exceptional_effect": ([{
            "event_id": "exceptional-event-finalized-1",
            "player_visible_impact": "档案员额外写下一位可信引荐人的姓名。",
        }] if exceptional else []),
        "concealed_consequence": [],
    }
    roll_text = "【明骰】说服｜掷骰：12；基础值：50；门槛：普通（≤50）；达到：困难；通过"
    segments = [
        {"segment_type": "fiction", "text": fiction, "source_ids": []},
        {"segment_type": "public_check", "text": roll_text, "source_ids": [roll_id]},
    ]
    if exceptional:
        segments.append({
            "segment_type": "exceptional_effect",
            "text": "【特殊影响】收益·关系/时钟：档案员额外写下一位可信引荐人的姓名。",
            "source_ids": ["exceptional-event-finalized-1"],
        })
    if multi_context:
        segments.append({
            "segment_type": "context_effect",
            "text": "【初次反应】露丝：她把椅子推近柜台。\n【初次反应】阿蒂：他递来登记簿。",
            "source_ids": ["context:first-a", "context:first-b"],
        })
    rendered = "\n\n".join(segment["text"] for segment in segments)
    receipt = {
        "schema_version": 1,
        "finalization_id": "turn-effect-v1:test-finalized-1",
        "decision_id": "finalize-finalized-1",
        "journal_decision_id": "journal-finalized-1",
        "journal_call_index": 3,
        "source_start_index": 0,
        "source_end_index": 3,
        "source_digest": _digest([]),
        "source_roll_ids": [roll_id],
        "obligation_ids": [f"roll:{roll_id}"],
        "coverage_ids": [f"roll:{roll_id}"],
        "draft_sha256": _digest(fiction),
        "coverage_sha256": _digest(coverage),
        "bundle_sha256": _digest(bundle),
        "rendered_sha256": _digest(rendered),
        "bundle": bundle,
        "coverage": coverage,
        "segments": segments,
        "rendered_text": rendered,
    }
    receipt["integrity_digest"] = _digest(receipt)
    return receipt


def _node_finalize(workspace: Path, campaign_id: str, offset: int, assistant: str) -> dict:
    script = """
import { finalizedKeeperOutput } from %s;
try {
  const result = finalizedKeeperOutput(%s, %s);
  console.log(JSON.stringify({ok: true, result}));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    code: error && error.code,
    reason: error && error.reason,
  }));
}
""" % (
        json.dumps(RUNNER.as_uri()),
        json.dumps({
            "workspace": str(workspace),
            "campaign_id": campaign_id,
            "finalization_offset": offset,
        }, ensure_ascii=False),
        json.dumps(assistant, ensure_ascii=False),
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=REPO,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(completed.stdout)


def test_valid_receipt_releases_exact_text_once_without_duplicate_roll(tmp_path):
    campaign_id = "case-finalized"
    campaign = tmp_path / ".coc" / "campaigns" / campaign_id
    logs = campaign / "logs"
    logs.mkdir(parents=True)
    path = logs / "turn-finalizations.jsonl"
    prior = _receipt(fiction="上一回合。")
    path.write_text(json.dumps(prior, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    offset = path.stat().st_size
    receipt = _receipt(exceptional=True, multi_context=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")

    released = _node_finalize(tmp_path, campaign_id, offset, receipt["rendered_text"])

    assert released["ok"] is True
    assert [row["segment_type"] for row in receipt["segments"]] == [
        "fiction", "public_check", "exceptional_effect", "context_effect",
    ]
    assert receipt["segments"][-1]["source_ids"] == [
        "context:first-a", "context:first-b",
    ]
    adapter = _load("runtime_keeper_finalization_adapter", "runtime/adapters/keeper/adapter.py")
    assert adapter.validate_finalization_receipt(receipt)["segments"] == receipt["segments"]
    assert released["result"]["narration"] == receipt["rendered_text"]
    assert released["result"]["finalization"] == {
        "finalization_id": receipt["finalization_id"],
        "journal_decision_id": receipt["journal_decision_id"],
        "rendered_sha256": receipt["rendered_sha256"],
        "integrity_digest": receipt["integrity_digest"],
        "segments": receipt["segments"],
    }

    # A raw public roll may exist in the same turn, but finalized narration is
    # now the single player-visible owner of that die result.
    (logs / "rolls.jsonl").write_text(json.dumps({
        "roll_id": "roll-finalized-1",
        "visibility": "public",
        "payload": {"roll_id": "roll-finalized-1", "roll": 12},
    }) + "\n", encoding="utf-8")
    session = _load("runtime_session_finalized_projection", "runtime/engine/session.py")
    events = session._project_keeper_turn_events(
        campaign,
        {"toolbox": 0, "rolls": 0, "finalizations": offset},
        receipt["rendered_text"],
        finalization=released["result"]["finalization"],
        workspace=tmp_path,
        campaign_id=campaign_id,
    )
    assert [event["type"] for event in events] == ["narration"]
    assert events[0]["payload"]["text"] == receipt["rendered_text"]


@pytest.mark.parametrize("malformed", [False, True])
def test_missing_or_malformed_receipt_fails_closed(tmp_path, malformed):
    campaign_id = "case-blocked"
    logs = tmp_path / ".coc" / "campaigns" / campaign_id / "logs"
    logs.mkdir(parents=True)
    if malformed:
        (logs / "turn-finalizations.jsonl").write_text("{bad json}\n", encoding="utf-8")

    released = _node_finalize(tmp_path, campaign_id, 0, "arbitrary model prose")

    assert released["ok"] is False
    assert released["code"] == "keeper_finalization_blocked"
    assert released["reason"] == ("malformed" if malformed else "missing")


def test_typed_finalization_failure_never_retries_whole_keeper_turn(tmp_path, monkeypatch):
    session = _load("runtime_session_no_finalization_retry", "runtime/engine/session.py")
    campaign = tmp_path / ".coc" / "campaigns" / "case-no-retry"
    (campaign / "logs").mkdir(parents=True)

    class PublicState:
        @staticmethod
        def build_public_state(*_args, **_kwargs):
            return {"play_language": "zh-Hans"}

    class Adapter:
        class KeeperFinalizationError(RuntimeError):
            pass

        calls = 0
        last_request = None

        @classmethod
        def keeper_send_turn(cls, request, **_kwargs):
            cls.calls += 1
            cls.last_request = request
            raise cls.KeeperFinalizationError("settled output blocked")

    monkeypatch.setattr(session, "get_session", lambda _sid: {
        "session_id": "sess-no-retry",
        "workspace": tmp_path,
        "campaign_id": "case-no-retry",
        "investigator_id": "inv-no-retry",
        "campaign_dir": campaign,
    })
    monkeypatch.setattr(session, "_load_public_state", lambda: PublicState)
    monkeypatch.setattr(session, "_load_keeper_adapter", lambda: Adapter)

    with pytest.raises(session.KeeperFinalizationBlockedError) as exc:
        session.send("sess-no-retry", "我检查那扇门。")

    assert exc.value.kind == "keeper_finalization_blocked"
    assert exc.value.turn_committed is True
    assert Adapter.calls == 1
    assert Adapter.last_request["finalization_offset"] == 0
