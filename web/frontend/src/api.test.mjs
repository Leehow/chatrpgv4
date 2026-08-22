import test from "node:test";
import assert from "node:assert/strict";

import { generatePortrait, streamTurn } from "./api.ts";
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

test("generatePortrait posts campaign and investigator ids without a client prompt", async () => {
  const originalFetch = globalThis.fetch;
  let url;
  let body;
  globalThis.fetch = async (nextUrl, init) => {
    url = String(nextUrl);
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      ok: true,
      portrait: {
        portrait_path: ".coc/investigators/ada/portraits/ada.png",
        image_url: "/api/investigators/ada/portraits/ada.png",
        portrait_status: "generated",
      },
    }), { status: 200 });
  };
  try {
    const result = await generatePortrait({ campaign_id: "camp-1", investigator_id: "ada" });
    assert.equal(url, "/api/portraits/generate");
    assert.deepEqual(body, { campaign_id: "camp-1", investigator_id: "ada" });
    assert.equal("prompt" in body, false);
    assert.equal(result.portrait.image_url, "/api/investigators/ada/portraits/ada.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamTurn parses handout SSE events into sanitized player-safe cards", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(sseFrame("handout", {
          asset_id: "doc-letter",
          kind: "document",
          title: "芝加哥来信",
          text: "逐字原文…",
          image_url: "/api/campaigns/camp-1/handout-assets/assets/handouts/letter.png",
          source_pages: ["pdf_index-16"],
        })));
        controller.enqueue(enc.encode(sseFrame("handout", {
          asset_id: "map-1",
          kind: "map",
          title: "农舍地图",
          image_url: null,
          source_pages: [],
        })));
        controller.enqueue(enc.encode(sseFrame("handout", {
          asset_id: "weird-1",
          kind: "hologram",
          title: "未知类型卡",
        })));
        controller.enqueue(enc.encode(sseFrame("end", {})));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  try {
    const cards = [];
    await streamTurn("sid", "", "p", "m", "off", undefined, {
      onHandout: (card) => cards.push(card),
    }, undefined, { attach: true });
    assert.equal(cards.length, 3);
    assert.equal(cards[0].asset_id, "doc-letter");
    assert.equal(cards[0].kind, "document");
    assert.equal(cards[0].text, "逐字原文…");
    assert.deepEqual(cards[0].source_pages, ["pdf_index-16"]);
    assert.equal(cards[1].image_url, null);
    assert.deepEqual(cards[1].source_pages, []);
    // 边界解析把未知 kind 归一为严格枚举 document。
    assert.equal(cards[2].kind, "document");
    assert.deepEqual(cards[2].source_pages, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
