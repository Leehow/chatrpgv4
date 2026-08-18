import test from "node:test";
import assert from "node:assert/strict";

import { finishPromptTurn } from "../turn-flow.mjs";

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
