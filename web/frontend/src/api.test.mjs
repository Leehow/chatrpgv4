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

test("streamTurn rejects a clean HTTP EOF before the explicit end frame", async () => {
  const originalFetch = globalThis.fetch;
  const errors = [];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.close();
    },
  }), { status: 200 });
  try {
    await assert.rejects(
      () => streamTurn(
        "sid-eof",
        "",
        "p",
        "m",
        "off",
        undefined,
        { onError: (message) => errors.push(message) },
        undefined,
        { attach: true },
      ),
      /终止帧前结束/,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /终止帧前结束/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamTurn resolves at the explicit end frame before a later reader failure", async () => {
  const originalFetch = globalThis.fetch;
  const errors = [];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(sseFrame("end", {})));
      setTimeout(() => controller.error(new Error("late transport reset")), 0);
    },
  }), { status: 200 });
  try {
    await streamTurn(
      "sid-terminal-end",
      "",
      "p",
      "m",
      "off",
      undefined,
      { onError: (message) => errors.push(message) },
      undefined,
      { attach: true },
    );
    assert.deepEqual(errors, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamTurn surfaces a non-2xx transition conflict without streaming", async () => {
  const originalFetch = globalThis.fetch;
  const errors = [];
  const deltas = [];
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: "战役正在从建卡会话切换到开桌会话，请稍候。",
    code: "session_transitioning",
  }), { status: 409, headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(
      () => streamTurn(
        "sid-409",
        "我叫艾伦",
        "p",
        "m",
        "off",
        undefined,
        {
          onError: (message) => errors.push(message),
          onDelta: (delta) => deltas.push(delta),
          onTurn: () => {
            throw new Error("should not settle a rejected turn");
          },
        },
      ),
      /战役正在从建卡会话切换到开桌会话/,
    );
    assert.deepEqual(errors, ["战役正在从建卡会话切换到开桌会话，请稍候。"]);
    assert.deepEqual(deltas, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamTurn uses a zh-Hans fallback when a non-2xx body has no error", async () => {
  const originalFetch = globalThis.fetch;
  const errors = [];
  globalThis.fetch = async () => new Response("", { status: 500 });
  try {
    await assert.rejects(
      () => streamTurn(
        "sid-500",
        "我叫艾伦",
        "p",
        "m",
        "off",
        undefined,
        { onError: (message) => errors.push(message) },
      ),
      /发送失败（HTTP 500）/,
    );
    assert.deepEqual(errors, ["发送失败（HTTP 500）"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamTurn rejects a terminal error when the stream closes without an end frame", async () => {
  const originalFetch = globalThis.fetch;
  const errors = [];
  const turns = [];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(sseFrame("error", {
        message: "本回合未产出玩家可见文本（模型可能把叙事写进了思考频道或回合未结算）；请重试同一行动。",
      })));
      controller.close();
    },
  }), { status: 200 });
  try {
    await assert.rejects(
      () => streamTurn(
        "sid-empty-turn",
        "我推开门",
        "p",
        "m",
        "off",
        undefined,
        {
          onError: (message) => errors.push(message),
          onTurn: (payload) => turns.push(payload),
        },
      ),
      /未产出玩家可见文本/,
    );
    assert.deepEqual(errors, [
      "本回合未产出玩家可见文本（模型可能把叙事写进了思考频道或回合未结算）；请重试同一行动。",
    ]);
    assert.deepEqual(turns, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamTurn rejects a typed error observed before the explicit end frame", async () => {
  const originalFetch = globalThis.fetch;
  const errors = [];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode([
        sseFrame("error", { message: "typed terminal failure" }),
        sseFrame("end", {}),
      ].join("")));
    },
  }), { status: 200 });
  try {
    await assert.rejects(
      () => streamTurn(
        "sid-terminal-error",
        "",
        "p",
        "m",
        "off",
        undefined,
        { onError: (message) => errors.push(message) },
        undefined,
        { attach: true },
      ),
      /typed terminal failure/,
    );
    assert.deepEqual(errors, ["typed terminal failure"]);
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
          presentation_id: "doc-letter:presentation:2",
          presentation_revision: 2,
          kind: "document",
          title: "芝加哥来信",
          text: "逐字原文…",
          image_url: "/api/campaigns/camp-1/handout-assets/assets/handouts/letter.png",
          source_pages: ["pdf_index-16"],
        })));
        controller.enqueue(enc.encode(sseFrame("handout", {
          asset_id: "read-aloud-1",
          presentation_id: "read-aloud-1:presentation:1",
          presentation_revision: 1,
          kind: "read_aloud",
          title: "门后的响动",
          text: "门轴发出低沉的呻吟。",
          source_pages: ["pdf_index-9"],
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
        for (const [index, content_origin] of [
          null, 7, "", {}, [], "unknown",
        ].entries()) {
          controller.enqueue(enc.encode(sseFrame("handout", {
            asset_id: `invalid-origin-${index}`,
            kind: "document",
            content_origin,
            title: "MUST NOT DISPLAY",
            text: "MUST NOT REACH SSE",
          })));
        }
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
    assert.equal(cards.length, 4);
    assert.equal(cards[0].asset_id, "doc-letter");
    assert.equal(cards[0].presentation_id, "doc-letter:presentation:2");
    assert.equal(cards[0].presentation_revision, 2);
    assert.equal(cards[0].kind, "document");
    assert.equal(cards[0].text, "逐字原文…");
    assert.deepEqual(cards[0].source_pages, ["pdf_index-16"]);
    assert.equal(cards[1].kind, "read_aloud");
    assert.equal(cards[1].presentation_id, "read-aloud-1:presentation:1");
    assert.equal(cards[2].kind, "map");
    assert.equal(cards[2].image_url, null);
    assert.deepEqual(cards[2].source_pages, []);
    assert.ok(!JSON.stringify(cards).includes("MUST NOT"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
