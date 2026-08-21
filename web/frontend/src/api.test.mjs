import test from "node:test";
import assert from "node:assert/strict";

import { streamTurn } from "./api.ts";
import { applySettledKeeperMessage } from "./transcript-merge.ts";

function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

test("streamTurn sends live_id only for non-attach turns and onTurn consumes message", async () => {
  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(sseFrame("turn", {
          events: [],
          state: { ok: true },
          usage: null,
          message: {
            role: "keeper",
            text: "你仔细查看门锁。",
            live_id: "live-2",
            finalization_id: "fin-2",
            entry_id: "k-2",
            turn: 2,
          },
        })));
        controller.enqueue(enc.encode(sseFrame("end", {})));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  try {
    let payload;
    await streamTurn("sid", "我检查门锁", "p", "m", "off", undefined, {
      onTurn: (next) => {
        payload = next;
      },
    }, undefined, { liveId: "live-2" });
    assert.equal(bodies[0].live_id, "live-2");
    assert.equal(bodies[0].attach, undefined);
    assert.equal(payload.message.live_id, "live-2");
    const merged = applySettledKeeperMessage(
      [
        { kind: "player", text: "我检查门锁" },
        { kind: "keeper", text: "流式", streaming: true, liveId: "live-2" },
      ],
      payload.message,
      "live-2",
    );
    assert.equal(merged[1].text, "你仔细查看门锁。");
    assert.equal(merged[1].finalizationId, "fin-2");

    await streamTurn("sid", "", "p", "m", "off", undefined, {}, undefined, {
      attach: true,
      liveId: "must-not-send",
    });
    assert.equal(bodies[1].attach, true);
    assert.equal("live_id" in bodies[1], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
