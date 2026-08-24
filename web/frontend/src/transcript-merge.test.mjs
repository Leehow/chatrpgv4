import test from "node:test";
import assert from "node:assert/strict";

import {
  applySettledKeeperMessage,
  mergeTranscriptMessages,
  rejectUnsentTurn,
  shouldAttachHostOpening,
} from "./transcript-merge.ts";

const rollBlocks = [
  {
    type: "roll_group",
    text: "【明骰】侦查｜掷骰：47；基础值：65；达到：成功；通过",
    source_ids: ["roll-1"],
    layout: "check",
    rolls: [{ roll_id: "roll-1", roll: 47, display_skill: "侦查", passed: true }],
  },
];

const olderBlocks = [
  {
    type: "roll",
    text: "【明骰】聆听｜掷骰：12；基础值：40；达到：成功；通过",
    source_ids: ["roll-old"],
    roll: { roll_id: "roll-old", roll: 12, display_skill: "聆听", passed: true },
  },
];

test("onTurn projection attaches content_blocks only when live_id matches", () => {
  const prev = [
    { kind: "player", text: "我检查门锁" },
    { kind: "keeper", text: "流式正文", streaming: true, liveId: "live-2" },
  ];
  const next = applySettledKeeperMessage(prev, {
    role: "keeper",
    text: "你仔细查看门锁。\n\n【明骰】侦查｜掷骰：47；基础值：65；达到：成功；通过",
    content_blocks: rollBlocks,
    finalization_id: "fin-2",
    entry_id: "table-transcript-v1:abc",
    live_id: "live-2",
    turn: 2,
  });
  const keeper = next[1];
  assert.equal(keeper.kind, "keeper");
  assert.equal(keeper.streaming, true);
  assert.equal(keeper.finalizationId, "fin-2");
  assert.equal(keeper.entryId, "table-transcript-v1:abc");
  assert.equal(keeper.liveId, "live-2");
  assert.deepEqual(keeper.contentBlocks, rollBlocks);
  assert.match(keeper.text, /你仔细查看门锁/);
});

test("onTurn projection is a no-op without a keeper message", () => {
  const prev = [
    { kind: "player", text: "我检查门锁" },
    { kind: "keeper", text: "流式正文", streaming: true, liveId: "live-2" },
  ];
  assert.equal(applySettledKeeperMessage(prev, null), prev);
  assert.equal(applySettledKeeperMessage(prev, { role: "player", text: "x" }), prev);
  assert.equal(applySettledKeeperMessage(prev, { role: "keeper", text: "" }), prev);
});

test("merge attaches cards by finalization id when streamed text differs", () => {
  const prev = [
    { kind: "player", text: "我检查门锁", turn: 2 },
    { kind: "keeper", text: "你仔细查看门锁。\n【明骰】侦查｜掷骰：47", liveId: "live-2" },
  ];
  const { next, applied } = mergeTranscriptMessages(
    prev,
    [
      { kind: "player", text: "我检查门锁", turn: 2 },
      {
        kind: "keeper",
        text: "你仔细查看门锁。\n\n【明骰】侦查｜掷骰：47；基础值：65；达到：成功；通过",
        contentBlocks: rollBlocks,
        finalizationId: "fin-2",
        liveId: "live-2",
      },
    ],
    true,
  );
  assert.equal(applied, true);
  assert.equal(next[1].kind, "keeper");
  assert.deepEqual(next[1].contentBlocks, rollBlocks);
  assert.equal(next[1].finalizationId, "fin-2");
});

test("old keeper without ids does not receive a new identified projection", () => {
  const prev = [
    { kind: "player", text: "我检查门锁！" },
    { kind: "keeper", text: "流式正文和标点都对不上" },
  ];
  const settled = applySettledKeeperMessage(prev, {
    role: "keeper",
    text: "权威正文",
    content_blocks: rollBlocks,
    finalization_id: "fin-2",
    live_id: "live-2",
    turn: 2,
  });
  assert.equal(settled, prev);
  assert.equal(settled[1].contentBlocks, undefined);

  const { next, applied } = mergeTranscriptMessages(
    prev,
    [
      { kind: "player", text: "我检查门锁", turn: 2 },
      {
        kind: "keeper",
        text: "权威正文",
        contentBlocks: rollBlocks,
        finalizationId: "fin-2",
      },
    ],
    true,
  );
  assert.equal(applied, false);
  assert.equal(next, prev);
  assert.equal(next[1].contentBlocks, undefined);
});

test("same text on different turns does not cross-attach", () => {
  const shared = "门后漆黑一片";
  const prev = [
    { kind: "player", text: "我开门", turn: 1 },
    { kind: "keeper", text: shared, finalizationId: "fin-1", contentBlocks: olderBlocks },
    { kind: "player", text: "我再看一眼", turn: 2 },
    { kind: "keeper", text: shared, liveId: "live-2" },
  ];
  const next = applySettledKeeperMessage(prev, {
    role: "keeper",
    text: shared,
    content_blocks: rollBlocks,
    finalization_id: "fin-2",
    turn: 1,
  });
  assert.equal(next[1].contentBlocks, olderBlocks);
  assert.equal(next[3].contentBlocks, undefined);
});

test("merge does not paint a new turn's cards onto an older finalized keeper", () => {
  const prev = [
    { kind: "player", text: "我开门", turn: 1 },
    {
      kind: "keeper",
      text: "门后漆黑一片",
      contentBlocks: olderBlocks,
      finalizationId: "fin-1",
    },
  ];
  const { next, applied } = mergeTranscriptMessages(
    prev,
    [
      { kind: "player", text: "我检查门锁", turn: 2 },
      {
        kind: "keeper",
        text: "权威正文",
        contentBlocks: rollBlocks,
        finalizationId: "fin-2",
      },
    ],
    true,
  );
  assert.equal(applied, false);
  assert.equal(next, prev);
  assert.deepEqual(next[1].contentBlocks, olderBlocks);
  assert.equal(next[1].finalizationId, "fin-1");
});

test("merge prefers finalization id and does not use latest-keeper fallback", () => {
  const prev = [
    { kind: "player", text: "我开门", turn: 1 },
    {
      kind: "keeper",
      text: "门后漆黑一片",
      contentBlocks: olderBlocks,
      finalizationId: "fin-1",
    },
    { kind: "player", text: "我检查门锁", turn: 2 },
    { kind: "keeper", text: "流式正文差一点", liveId: "live-2" },
  ];
  const { next, applied } = mergeTranscriptMessages(
    prev,
    [
      { kind: "player", text: "我开门", turn: 1 },
      {
        kind: "keeper",
        text: "门后漆黑一片。",
        contentBlocks: olderBlocks,
        finalizationId: "fin-1",
      },
      { kind: "player", text: "我检查门锁", turn: 2 },
      {
        kind: "keeper",
        text: "权威正文",
        contentBlocks: rollBlocks,
        finalizationId: "fin-2",
        liveId: "live-2",
      },
    ],
    true,
  );
  assert.equal(applied, true);
  assert.equal(next[1].finalizationId, "fin-1");
  assert.deepEqual(next[1].contentBlocks, olderBlocks);
  assert.equal(next[3].finalizationId, "fin-2");
  assert.deepEqual(next[3].contentBlocks, rollBlocks);
});

test("multiple keepers without matching ids never attach via latest fallback", () => {
  const prev = [
    { kind: "player", text: "先问" },
    { kind: "keeper", text: "旧回答" },
    { kind: "player", text: "再问" },
    { kind: "keeper", text: "流式中", streaming: true },
  ];
  const settled = applySettledKeeperMessage(prev, {
    role: "keeper",
    text: "新结算",
    content_blocks: rollBlocks,
    finalization_id: "fin-new",
    live_id: "live-new",
    turn: 9,
  });
  assert.equal(settled, prev);
  const { next, applied } = mergeTranscriptMessages(
    prev,
    [
      { kind: "player", text: "先问", turn: 8 },
      { kind: "keeper", text: "旧回答", finalizationId: "fin-old" },
      { kind: "player", text: "再问", turn: 9 },
      { kind: "keeper", text: "新结算", contentBlocks: rollBlocks, finalizationId: "fin-new" },
    ],
    true,
  );
  assert.equal(applied, false);
  assert.equal(next[1].contentBlocks, undefined);
  assert.equal(next[3].contentBlocks, undefined);
});

test("merge and onTurn keep text when there is no identity", () => {
  const prev = [
    { kind: "player", text: "我四处张望" },
    { kind: "keeper", text: "走廊空无一人", streaming: false },
  ];
  assert.equal(applySettledKeeperMessage(prev, undefined), prev);
  const afterTextOnly = applySettledKeeperMessage(prev, {
    role: "keeper",
    text: "走廊空无一人。",
  });
  assert.equal(afterTextOnly, prev);
  assert.equal(afterTextOnly[1].text, "走廊空无一人");
  assert.equal(afterTextOnly[1].contentBlocks, undefined);

  const { next, applied } = mergeTranscriptMessages(
    prev,
    [{ kind: "player", text: "另一句" }, { kind: "keeper", text: "另一段" }],
    true,
  );
  assert.equal(applied, false);
  assert.equal(next, prev);
});

test("stale projection without this liveId does not overwrite the live streaming row", () => {
  const prev = [
    { kind: "player", text: "我开门", turn: 1 },
    {
      kind: "keeper",
      text: "门后漆黑一片",
      finalizationId: "fin-1",
      contentBlocks: olderBlocks,
    },
    { kind: "player", text: "我再看" },
    { kind: "keeper", text: "流式中", streaming: true, liveId: "live-now" },
  ];
  const next = applySettledKeeperMessage(
    prev,
    {
      role: "keeper",
      text: "门后漆黑一片",
      content_blocks: olderBlocks,
      finalization_id: "fin-1",
      entry_id: "k-old",
      turn: 1,
    },
    "live-now",
  );
  assert.equal(next[3].text, "流式中");
  assert.equal(next[3].contentBlocks, undefined);
  assert.equal(next[3].liveId, "live-now");
  assert.deepEqual(next[1].contentBlocks, olderBlocks);
});

test("applySettledKeeperMessage requires liveId or a unique stable id, never last-row fallback", () => {
  const prev = [
    { kind: "player", text: "问" },
    { kind: "keeper", text: "流式中", streaming: true, liveId: "live-now" },
  ];
  assert.equal(
    applySettledKeeperMessage(prev, {
      role: "keeper",
      text: "权威但无身份",
      content_blocks: rollBlocks,
    }, "live-now"),
    prev,
  );
  const matched = applySettledKeeperMessage(
    prev,
    {
      role: "keeper",
      text: "权威正文",
      content_blocks: rollBlocks,
      finalization_id: "fin-new",
      live_id: "live-now",
      turn: 3,
    },
    "live-now",
  );
  assert.equal(matched[1].finalizationId, "fin-new");
  assert.deepEqual(matched[1].contentBlocks, rollBlocks);
  assert.equal(
    applySettledKeeperMessage(
      prev,
      {
        role: "keeper",
        text: "权威正文",
        content_blocks: rollBlocks,
        finalization_id: "fin-new",
        live_id: "live-other",
        turn: 3,
      },
      "live-now",
    ),
    prev,
  );
});

test("applySettledKeeperMessage refuses to retarget an older finalized last keeper", () => {
  const prev = [
    { kind: "player", text: "我开门" },
    {
      kind: "keeper",
      text: "门后漆黑一片",
      contentBlocks: olderBlocks,
      finalizationId: "fin-1",
    },
  ];
  const next = applySettledKeeperMessage(prev, {
    role: "keeper",
    text: "权威正文",
    content_blocks: rollBlocks,
    finalization_id: "fin-2",
  });
  assert.equal(next, prev);
});

test("empty or chrome first hydrate applies and skips opening attach", () => {
  const incoming = [{ kind: "keeper", text: "车站月台灯火昏黄。" }];
  const rows = [{ role: "keeper", text: "车站月台灯火昏黄。" }];
  const empty = mergeTranscriptMessages([], incoming, true);
  assert.equal(empty.applied, true);
  assert.equal(empty.next[0].text, "车站月台灯火昏黄。");
  assert.equal(shouldAttachHostOpening(true, empty.applied, rows), false);

  const chrome = mergeTranscriptMessages(
    [
      { kind: "note", text: "正在打开桌面" },
      { kind: "keeper", text: "", streaming: true },
    ],
    incoming,
    true,
  );
  assert.equal(chrome.applied, true);
  assert.equal(shouldAttachHostOpening(true, chrome.applied, rows), false);

  assert.equal(shouldAttachHostOpening(true, false, rows), true);
  assert.equal(
    shouldAttachHostOpening(true, true, [{ role: "player", text: "你好" }]),
    true,
  );
});

test("rejectUnsentTurn rolls back an optimistic player and empty keeper", () => {
  const history = [
    { kind: "keeper", text: "请先自报姓名。" },
    { kind: "player", text: "我叫艾伦" },
    { kind: "keeper", text: "", streaming: true },
  ];
  const result = rejectUnsentTurn(history, "我叫艾伦");
  assert.equal(result.recovered, true);
  assert.deepEqual(result.messages, [{ kind: "keeper", text: "请先自报姓名。" }]);
});

test("rejectUnsentTurn recovers after onError already dropped the empty keeper", () => {
  const history = [
    { kind: "keeper", text: "请先自报姓名。" },
    { kind: "player", text: "我叫艾伦" },
  ];
  const result = rejectUnsentTurn(history, "我叫艾伦");
  assert.equal(result.recovered, true);
  assert.deepEqual(result.messages, [{ kind: "keeper", text: "请先自报姓名。" }]);
});

test("rejectUnsentTurn keeps a partial streamed turn and does not recover the composer", () => {
  const history = [
    { kind: "player", text: "我检查门锁" },
    { kind: "keeper", text: "你走近门边", streaming: true },
  ];
  const result = rejectUnsentTurn(history, "我检查门锁");
  assert.equal(result.recovered, false);
  assert.equal(result.messages, history);
});

test("rejectUnsentTurn does not drop a canonical player or a different draft", () => {
  const canonical = [
    { kind: "player", text: "我叫艾伦", turn: 2, entryId: "p-2" },
    { kind: "keeper", text: "", streaming: true },
  ];
  const keptCanonical = rejectUnsentTurn(canonical, "我叫艾伦");
  assert.equal(keptCanonical.recovered, false);
  assert.deepEqual(keptCanonical.messages, [{ kind: "player", text: "我叫艾伦", turn: 2, entryId: "p-2" }]);

  const otherDraft = [
    { kind: "player", text: "先问" },
    { kind: "keeper", text: "", streaming: true },
  ];
  const keptOther = rejectUnsentTurn(otherDraft, "我叫艾伦");
  assert.equal(keptOther.recovered, false);
  assert.deepEqual(keptOther.messages, [{ kind: "player", text: "先问" }]);
});
