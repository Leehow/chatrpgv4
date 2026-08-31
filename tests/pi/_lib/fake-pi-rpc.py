#!/usr/bin/env python3
"""Fake `pi` RPC binary for driver tests (not the real pi)."""
from __future__ import annotations

import json
import sys
import threading
import time


CANONICAL_HANDOFF = {
    "type": "coc_setup_handoff",
    "campaign_id": "setup-handoff-probe",
    "receipt": {
        "schema_version": 1,
        "decision_id": "handoff-1",
        "campaign_id": "setup-handoff-probe",
        "investigator_ids": ["thomas-hayes"],
        "completed_at": "2026-08-30T00:00:00Z",
        "opening_projection_ref": None,
        "lane_interrupted_at_handoff": False,
    },
    "at": "2026-08-30T00:00:00Z",
    "consumer": "server-node/launcher",
}


def emit_canonical_handoff() -> None:
    print(json.dumps({
        "type": "tool_execution_start",
        "tool": "coc_invoke",
    }), flush=True)
    print(json.dumps({
        "type": "message_end",
        "message": {
            "role": "assistant",
            "stopReason": "stop",
            "content": [{
                "type": "toolCall",
                "id": "call-setup-complete",
                "name": "coc_invoke",
                "arguments": {"operation": "setup.complete"},
            }],
        },
    }), flush=True)
    print(json.dumps({
        "type": "tool_execution_end",
        "tool": "coc_invoke",
    }), flush=True)
    print(json.dumps({
        "type": "entry_appended",
        "entry": {
            "type": "custom",
            "customType": "coc_setup_handoff",
            "data": CANONICAL_HANDOFF,
        },
    }), flush=True)
    print(json.dumps({
        "type": "custom_message",
        "customType": "coc_setup_handoff",
        "content": json.dumps(CANONICAL_HANDOFF, ensure_ascii=False),
        "details": CANONICAL_HANDOFF,
    }), flush=True)


def emit_campaign08_live_handoff() -> None:
    """Campaign 08 live shape: custom role messages, no outer exit 42."""
    content = json.dumps(CANONICAL_HANDOFF, ensure_ascii=False)
    print(json.dumps({
        "type": "tool_execution_start",
        "toolCallId": "call-setup-complete",
        "toolName": "coc_setup_complete",
    }), flush=True)
    print(json.dumps({
        "type": "tool_execution_end",
        "toolCallId": "call-setup-complete",
        "toolName": "coc_setup_complete",
        "result": {
            "content": [{
                "type": "text",
                "text": json.dumps({
                    "ok": True,
                    "tool": "setup.complete",
                    "data": {"status": "PASS"},
                }, ensure_ascii=False),
            }],
            "isError": False,
        },
    }), flush=True)
    custom_message = {
        "role": "custom",
        "customType": "coc_setup_handoff",
        "content": content,
        "display": False,
        "details": CANONICAL_HANDOFF,
    }
    print(json.dumps({
        "type": "message_start",
        "message": custom_message,
    }), flush=True)
    print(json.dumps({
        "type": "message_end",
        "message": custom_message,
    }), flush=True)
    print(json.dumps({
        "type": "entry_appended",
        "entry": {
            "type": "custom",
            "customType": "coc_setup_handoff",
            "data": CANONICAL_HANDOFF,
        },
    }), flush=True)
    print(json.dumps({
        "type": "extension_ui_request",
        "id": "ui-coc-loading",
        "method": "setStatus",
        "statusKey": "coc-loading",
        "statusText": "正在恢复战役 setup-handoff-probe……请稍候。",
    }), flush=True)
    print(json.dumps({
        "type": "extension_ui_request",
        "id": "ui-coc-warm",
        "method": "setStatus",
        "statusKey": "coc-warm",
        "statusText": "COC 已激活 · MCP 已预热",
    }), flush=True)


def main() -> int:
    progress_stop = threading.Event()
    progress_thread: threading.Thread | None = None
    active_budget_tool = False

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = command.get("type")
        if kind == "set_model":
            print(json.dumps({
                "id": command.get("id"),
                "type": "response",
                "command": "set_model",
                "success": True,
            }), flush=True)
        elif kind == "prompt":
            message_text = str(command.get("message", ""))
            print(json.dumps({
                "type": "message_start",
                "message": {"role": "user", "content": [{"type": "text", "text": message_text}]},
            }), flush=True)
            if message_text.startswith("__CAMPAIGN08_HANDOFF__"):
                # Live launcher re-exec: envelope + setup.complete + UI
                # freeze, outer process stays alive, no driver_pi_exited.
                emit_campaign08_live_handoff()
            elif message_text.startswith("__RULES_DIRECTOR_BUDGET__"):
                # Keep emitting real RPC progress while one tool is in flight.
                # An idle watchdog would never fire; the acceptance profile's
                # absolute wall budget must still send one protocol abort.
                active_budget_tool = True
                print(json.dumps({"type": "agent_start"}), flush=True)
                print(json.dumps({
                    "type": "message_start",
                    "message": {
                        "role": "assistant",
                        "provider": "fake-provider",
                        "model": "fake-rules-director",
                        "content": [],
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "tool_execution_start",
                    "toolCallId": "call-rules-director-budget",
                    "toolName": "coc_rules_settle",
                }), flush=True)

                def emit_progress() -> None:
                    while not progress_stop.wait(0.05):
                        print(json.dumps({
                            "type": "message_update",
                            "assistantMessageEvent": {
                                "type": "thinking_delta",
                                "delta": ".",
                            },
                        }), flush=True)

                progress_thread = threading.Thread(target=emit_progress, daemon=True)
                progress_thread.start()
            elif message_text.startswith("__HANDOFF_THEN_READER_ERROR__"):
                # Valid envelope first, then invalid UTF-8 kills the reader,
                # then exit 42. The waiter must not freeze on the envelope.
                emit_canonical_handoff()
                sys.stdout.buffer.write(b"\xff\xfe\n")
                sys.stdout.buffer.flush()
                raise SystemExit(42)
            elif message_text.startswith("__HANDOFF_THEN_EXIT_1__"):
                emit_canonical_handoff()
                raise SystemExit(1)
            elif message_text.startswith("__HANDOFF_EXIT_READER_ERROR__"):
                # Invalid UTF-8 on the text-mode RPC pipe raises in the driver
                # stdout reader (UnicodeDecodeError → driver_reader_error),
                # then the process exits 42. This is genuine reader failure,
                # not a non-JSON line handled per event.
                sys.stdout.buffer.write(b"\xff\xfe\n")
                sys.stdout.buffer.flush()
                raise SystemExit(42)
            elif message_text.startswith("__TOOLS_NO_SETTLE__"):
                # Ordinary play: tools ran, no visible text, no agent_settled.
                # The driver must wait out the timeout and fail closed.
                print(json.dumps({
                    "type": "tool_execution_start",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{
                            "type": "toolCall",
                            "id": "call-tools-no-settle",
                            "name": "coc_invoke",
                            "arguments": {},
                        }],
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "tool_execution_end",
                    "tool": "coc_invoke",
                }), flush=True)
                time.sleep(30)
            elif (
                message_text.startswith("__SETUP_HANDOFF_EXIT__")
                or message_text.startswith("__PLAY_EXIT_42__")
                or message_text.startswith("__HANDOFF_EXIT_EPIPE__")
                or message_text.startswith("__SETUP_HANDOFF__")
            ):
                # Canonical setup.complete terminal: tools ran, host emitted
                # coc_setup_handoff, no player-visible prose, no agent_settled.
                # Envelope-only sleeps so a waiter that completes on the
                # event would return early. EXIT variants then die 42.
                if message_text.startswith("__HANDOFF_EXIT_EPIPE__"):
                    print("this is not json", flush=True)
                emit_canonical_handoff()
                if (
                    message_text.startswith("__SETUP_HANDOFF_EXIT__")
                    or message_text.startswith("__PLAY_EXIT_42__")
                    or message_text.startswith("__HANDOFF_EXIT_EPIPE__")
                ):
                    raise SystemExit(42)
                time.sleep(30)
            elif message_text.startswith("__EMPTY_SETTLE__"):
                # Provider-successful thinking-only terminal with no recovery
                # in flight: the driver must classify this as empty_settle.
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "thinking", "thinking": "only reasoning"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
            elif message_text.startswith("__EMPTY_TOOLS__"):
                # Tools ran but zero visible assistant output: tool activity
                # is not delivery; the driver must classify this as an
                # undelivered settle and exit nonzero.
                print(json.dumps({
                    "type": "tool_execution_start",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{
                            "type": "toolCall",
                            "id": "call-empty-tools-probe",
                            "name": "coc_invoke",
                            "arguments": {},
                        }],
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "tool_execution_end",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
            elif message_text.startswith("__ABORT_RECOVER_DELIVER__"):
                # Evidence-shaped: whitespace abort arms recovery without a
                # pre-recovery agent_settled; the recovered turn delivers
                # visible text and settles once. Sleep after settle so a
                # stale count heuristic would burn the turn timeout.
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-leading-whitespace-stream-abort",
                        "data": {"status": "aborted"},
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-empty-terminal-recovery",
                        "data": {"kind": "empty_terminal_recovery"},
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "abort",
                        "content": [{"type": "thinking", "thinking": "only reasoning"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_end", "willRetry": False}), flush=True)
                print(json.dumps({
                    "type": "tool_execution_start",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "tool_execution_end",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "text", "text": "abort-recovered KP text"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
                time.sleep(30)
            elif message_text.startswith("__SETTLED_RECOVER__"):
                # Tools ran with no visible text, then a claimed
                # settled-output recovery follow-up delivers visible output.
                # Exhausted markers must not keep the wait open by themselves.
                print(json.dumps({
                    "type": "tool_execution_start",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{
                            "type": "toolCall",
                            "id": "call-settled-recover-probe",
                            "name": "coc_invoke",
                            "arguments": {},
                        }],
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "tool_execution_end",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-settled-output-recovery",
                        "data": {"schema_version": 1, "status": "claimed"},
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "text", "text": "settled-output recovered KP text"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
            elif message_text.startswith("__EXHAUSTED_RECOVERY__"):
                # Campaign-11 evidence shape: one empty-terminal recovery and
                # repeated settled-output claims all belong to the same player
                # epoch. The final exhausted marker plus terminal fault closes
                # that recovery state; the following settle is terminal even
                # though no player-visible prose was delivered.
                epoch = 2
                print(json.dumps({
                    "type": "tool_execution_start",
                    "toolCallId": "call-exhausted-recovery",
                    "toolName": "coc_turn_output_context",
                }), flush=True)
                print(json.dumps({
                    "type": "tool_execution_end",
                    "toolCallId": "call-exhausted-recovery",
                    "toolName": "coc_turn_output_context",
                }), flush=True)
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-empty-terminal-recovery",
                        "data": {
                            "schema_version": 1,
                            "kind": "empty_terminal_recovery",
                            "status": "scheduled",
                            "player_turn_epoch": epoch,
                        },
                    },
                }), flush=True)
                for _attempt in range(2):
                    print(json.dumps({
                        "type": "entry_appended",
                        "entry": {
                            "type": "custom",
                            "customType": "coc-settled-output-recovery",
                            "data": {
                                "schema_version": 1,
                                "status": "claimed",
                                "player_turn_epoch": epoch,
                                "canonical_progress_revision": 0,
                                "stage": "acting",
                            },
                        },
                    }), flush=True)
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-settled-output-recovery",
                        "data": {
                            "schema_version": 1,
                            "status": "exhausted",
                            "player_turn_epoch": epoch,
                            "canonical_progress_revision": 0,
                            "stage": "acting",
                        },
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-turn-processing-fault",
                        "data": {
                            "schema_version": 1,
                            "contract_id": "coc.pi-turn-processing-fault.v1",
                            "kind": "turn_processing_fault",
                            "status": "terminal",
                            "stage": "finalization_repair",
                            "code": "settled_output_recovery_exhausted",
                            "retryable": False,
                            "will_retry": False,
                            "pending_turn_preserved": True,
                            "player_turn_epoch": epoch,
                        },
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
                time.sleep(30)
            elif message_text.startswith("__EMPTY_RECOVER__"):
                # Empty settle followed by the hidden recovery marker, then
                # the recovered follow-up turn delivers visible output and
                # settles again; the driver must wait through both settles.
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "thinking", "thinking": "only reasoning"}],
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-empty-terminal-recovery",
                        "data": {"kind": "empty_terminal_recovery"},
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "text", "text": "recovered KP text"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
            else:
                print(json.dumps({
                    "type": "message_end",
                    "message": {"role": "assistant", "content": [{"type": "text", "text": "fake KP text"}]},
                }), flush=True)
                # Long enough for the test to kill this process mid-turn.
                time.sleep(30)
                print(json.dumps({"type": "agent_settled"}), flush=True)
        elif kind == "abort":
            progress_stop.set()
            if progress_thread is not None:
                progress_thread.join(timeout=1)
                progress_thread = None
            if active_budget_tool:
                print(json.dumps({
                    "type": "tool_execution_end",
                    "toolCallId": "call-rules-director-budget",
                    "toolName": "coc_rules_settle",
                    "isError": True,
                }), flush=True)
                active_budget_tool = False
            print(json.dumps({
                "id": command.get("id"),
                "type": "response",
                "command": "abort",
                "success": True,
            }), flush=True)
            print(json.dumps({"type": "agent_settled"}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
