import test from "node:test";
import assert from "node:assert/strict";

import { PiRpcTurnIdleWatchdog } from "../pi-rpc-turn-watchdog.mjs";

test("watchdog classifies an unmatched tool start as tool in flight", () => {
  const watchdog = new PiRpcTurnIdleWatchdog();
  watchdog.observe({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "coc_invoke",
    args: { operation: "state.journal" },
  });

  assert.deepEqual(watchdog.diagnostics(), {
    idle_classification: "tool_in_flight",
    active_tools: [{ tool_call_id: "call-1", tool: "state.journal" }],
    last_tool_terminal: null,
    finalization_status: "absent",
  });
});

test("watchdog preserves a structured terminal tool rejection", () => {
  const watchdog = new PiRpcTurnIdleWatchdog();
  watchdog.observe({
    type: "tool_execution_end",
    toolCallId: "call-2",
    toolName: "coc_invoke",
    args: { operation: "state.cash_grant" },
    result: { ok: false, error: { code: "policy_rejected" } },
  });

  assert.equal(watchdog.diagnostics().idle_classification, "tool_terminal_error");
  assert.deepEqual(watchdog.diagnostics().last_tool_terminal, {
    tool_call_id: "call-2",
    tool: "state.cash_grant",
    outcome: "failure_or_rejection",
    error_code: "policy_rejected",
  });
});

test("watchdog distinguishes successful tool completion without agent settlement", () => {
  const watchdog = new PiRpcTurnIdleWatchdog();
  watchdog.observe({
    type: "tool_execution_end",
    toolCallId: "call-3",
    toolName: "coc_invoke",
    args: { operation: "state.journal" },
    result: { ok: true },
  });

  assert.equal(
    watchdog.diagnostics().idle_classification,
    "post_tool_success_no_agent_settled",
  );
  assert.equal(watchdog.diagnostics().finalization_status, "absent");
});

test("watchdog distinguishes exact finalized output waiting for agent settlement", () => {
  const watchdog = new PiRpcTurnIdleWatchdog();
  watchdog.observe({
    type: "tool_execution_end",
    toolCallId: "call-4",
    toolName: "coc_turn_finalize",
    result: { ok: true },
  }, { finalizationReceipt: true });

  assert.equal(watchdog.diagnostics().idle_classification, "finalized_no_agent_settled");
  assert.equal(watchdog.diagnostics().finalization_status, "observed");
});
