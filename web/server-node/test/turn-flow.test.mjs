import test from "node:test";
import assert from "node:assert/strict";

import {
  attachWithStallRecovery,
  finishPromptTurn,
  finishRecoveredTurn,
  promptWithStallRecovery,
  recoverAbortedTurn,
} from "../turn-flow.mjs";

test("attach provider idle resumes on a replacement host without player input", async () => {
  const attached = [];
  const stalled = {
    async attachOpening() {
      attached.push("stalled");
      const error = new Error("provider idle during resume");
      error.kind = "pi_coc_rpc_idle_timeout";
      error.details = { idle_classification: "post_tool_success_no_agent_settled" };
      throw error;
    },
  };
  const recoveredHost = { id: "recovered" };
  const orchestrator = {
    async recoverStalledTurn(campaignId, options) {
      assert.equal(campaignId, "attach-stall");
      assert.deepEqual(options.recoveryDiagnostic, {
        idle_classification: "post_tool_success_no_agent_settled",
      });
      return { host: recoveredHost, promptResult: { recovered: true } };
    },
  };
  const frames = [];

  const result = await attachWithStallRecovery({
    host: stalled,
    campaignId: "attach-stall",
    orchestrator,
    onSse: (frame) => frames.push(frame),
  });

  assert.deepEqual(attached, ["stalled"]);
  assert.deepEqual(result, {
    host: recoveredHost,
    promptResult: { recovered: true },
  });
  assert.deepEqual(frames, [{
    event: "status",
    data: {
      phase: "recovering",
      diagnostic: { idle_classification: "post_tool_success_no_agent_settled" },
    },
  }]);
});

test("idle provider recovery never resends the original player input", async () => {
  const prompts = [];
  const stalled = {
    async prompt(message) {
      prompts.push(message);
      const error = new Error("provider idle");
      error.kind = "pi_coc_rpc_idle_timeout";
      error.details = { idle_classification: "post_tool_success_no_agent_settled" };
      throw error;
    },
  };
  const recoveredHost = { id: "recovered" };
  const orchestrator = {
    async recoverStalledTurn(campaignId, options) {
      assert.equal(campaignId, "turn-stall");
      assert.deepEqual(options.recoveryDiagnostic, {
        idle_classification: "post_tool_success_no_agent_settled",
      });
      return { host: recoveredHost, promptResult: { recovered: true } };
    },
  };
  const frames = [];
  const result = await promptWithStallRecovery({
    host: stalled,
    message: "玩家原始行动",
    campaignId: "turn-stall",
    orchestrator,
    onSse: (frame) => frames.push(frame),
  });
  assert.deepEqual(prompts, ["玩家原始行动"]);
  assert.equal(result.host, recoveredHost);
  assert.deepEqual(result.promptResult, { recovered: true });
  assert.deepEqual(frames, [{
    event: "status",
    data: {
      phase: "recovering",
      diagnostic: { idle_classification: "post_tool_success_no_agent_settled" },
    },
  }]);
});

test("abort after an authoritative write resumes the retained turn without player resend", async () => {
  const calls = [];
  const orchestrator = {
    async recoverStalledTurn(campaignId) {
      calls.push(`resume:${campaignId}`);
      return { host: { id: "recovered" }, promptResult: { recovered: true } };
    },
  };

  const result = await recoverAbortedTurn({
    campaignId: "journal-before-abort",
    orchestrator,
  });
  assert.deepEqual(calls, ["resume:journal-before-abort"]);
  assert.equal(result.promptResult.recovered, true);
});

test("aborted-turn recovery preserves delivery acknowledgement and finalization", async () => {
  const delivery = {
    finalizationId: "final-1",
    renderedSha256: "a".repeat(64),
  };
  const recoveredHost = {
    offerStreamedDelivery(offer) {
      return offer(delivery) === false ? null : delivery;
    },
  };
  const deliveries = [];
  const finalized = [];
  const result = await finishRecoveredTurn({
    recovery: { host: recoveredHost, promptResult: { recovered: true } },
    campaignId: "journal-before-abort",
    orchestrator: { isTransitioning: () => false },
    onDelivery: (value) => deliveries.push(value),
    finalize: async (host) => finalized.push(host),
  });

  assert.equal(result, recoveredHost);
  assert.deepEqual(deliveries, [delivery]);
  assert.deepEqual(finalized, [recoveredHost]);
});

test("setup exit keeps the turn pending through play opening before final done", async () => {
  const order = [];
  const setupHost = {
    isHandoffShutdown: () => true,
  };
  const playHost = { id: "play" };
  const orchestrator = {
    isTransitioning: () => true,
    async completeHandoffOpening(_campaignId, { onSse }) {
      order.push("play_respawn");
      onSse({ event: "delta", data: { text: "雨幕后的科比特宅邸亮起一盏灯。" } });
      order.push("opening_final");
      return playHost;
    },
  };

  const result = await finishPromptTurn({
    host: setupHost,
    promptResult: { handoff: true },
    campaignId: "scratch-handoff",
    orchestrator,
    onSse: (frame) => order.push(frame.event),
    finalize: async (host) => {
      assert.equal(host, playHost);
      order.push("turn");
      order.push("end");
    },
  });

  assert.equal(result, playHost);
  assert.deepEqual(order, [
    "play_respawn",
    "delta",
    "opening_final",
    "turn",
    "end",
  ]);
});

test("handoff respawn failure emits no final done and preserves its exact error", async () => {
  let finalized = false;
  const orchestrator = {
    isTransitioning: () => true,
    async completeHandoffOpening() {
      const err = new Error("建卡到开桌交接失败：play RPC ready probe timed out");
      err.code = "session_handoff_failed";
      throw err;
    },
  };

  await assert.rejects(
    () => finishPromptTurn({
      host: { isHandoffShutdown: () => true },
      promptResult: { handoff: true },
      campaignId: "scratch-broken",
      orchestrator,
      onSse: () => {},
      finalize: async () => {
        finalized = true;
      },
    }),
    (err) => {
      assert.equal(
        err.message,
        "建卡到开桌交接失败：play RPC ready probe timed out",
      );
      return true;
    },
  );
  assert.equal(finalized, false);
});
