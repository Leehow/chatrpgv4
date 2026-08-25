#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const domainUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts"),
).href;
const welcomeUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/welcome.ts"),
).href;

async function loadDomain() {
  return import(`${domainUrl}?t=${Date.now()}-${Math.random()}`);
}

async function loadWelcome() {
  return import(`${welcomeUrl}?t=${Date.now()}-${Math.random()}`);
}

test("awaiting_player plus existing table_opening satisfies play auto-open", async () => {
  const mod = await loadDomain();
  const campaignId = "played-auto-open";
  const probeRoot = mkdtempSync(path.join(tmpdir(), "pi-coc-play-auto-open-"));
  mkdirSync(path.join(probeRoot, ".coc", "campaigns", campaignId, "logs"), {
    recursive: true,
  });
  writeFileSync(
    path.join(probeRoot, ".coc", "campaigns", campaignId, "logs", "table-transcript.jsonl"),
    `${JSON.stringify({ role: "keeper", turn: 5 })}\n`,
  );
  assert.equal(mod.resumeSatisfiesPlayAutoOpen({
    ok: true,
    tool: "session.resume",
    data: {
      mode: "awaiting_player",
      campaign_id: campaignId,
      evidence: { table_opening: { text: "既有开场" } },
      next_operations: ["interpret_current_player_message"],
      checkpoint: { turn_number: 5 },
    },
  }, { workspaceRoot: probeRoot, campaignId }), true);
  assert.equal(mod.resumeSatisfiesPlayAutoOpen({
    data: { mode: "table_opening", next_operations: ["evidence.table_opening"] },
  }), false);
  assert.equal(mod.resumeSatisfiesPlayAutoOpen({
    data: {
      mode: "awaiting_player",
      next_operations: ["evidence.table_opening"],
    },
  }), false);
});

test("play-role auto-open always triggers one resume-first continuation", async () => {
  const welcome = await loadWelcome();
  assert.equal(welcome.tableOpenShouldTriggerTurn({
    intent: "continue",
    resumeSatisfied: true,
  }), true);
  assert.equal(welcome.tableOpenShouldTriggerTurn({
    intent: "character-setup",
    resumeSatisfied: true,
  }), true);
  assert.equal(welcome.tableOpenShouldTriggerTurn({
    intent: "continue",
    resumeSatisfied: false,
  }), true);

  const prevAttached = process.env.COC_PI_ATTACHED_UI;
  const prevIntent = process.env.COC_PI_TABLE_INTENT;
  const prevRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_ATTACHED_UI = "1";
  process.env.COC_PI_TABLE_INTENT = "continue";
  process.env.COC_PI_SESSION_ROLE = "play";
  const sent = [];
  const fakePi = {
    registerCommand: () => {},
    sendMessage: (message, options) => {
      sent.push({ message, options });
    },
  };
  const campaignId = "web-the-haunting-qs-msyt48g3";
  const playedRoot = mkdtempSync(path.join(tmpdir(), "pi-coc-welcome-played-"));
  mkdirSync(path.join(playedRoot, ".coc", "campaigns", campaignId, "logs"), {
    recursive: true,
  });
  writeFileSync(
    path.join(playedRoot, ".coc", "campaigns", campaignId, "logs", "table-transcript.jsonl"),
    `${JSON.stringify({ role: "keeper", turn: 5 })}
`,
  );
  const handler = welcome.registerCocWelcome(
    fakePi,
    () => ({
      callTool: async (name) => {
        if (name === "coc_capabilities") return { ok: true };
        throw new Error(`unexpected ${name}`);
      },
    }),
    mkdtempSync(path.join(tmpdir(), "pi-coc-welcome-auto-open-")),
  );
  try {
    await handler({ reason: "startup" }, {
      cwd: playedRoot,
      mode: "rpc",
      hasUI: false,
      sessionManager: { getEntries: () => [] },
      ui: {
        setHeader: () => {},
        setStatus: () => {},
        notify: () => {},
      },
    }, campaignId);
  } finally {
    if (prevAttached === undefined) delete process.env.COC_PI_ATTACHED_UI;
    else process.env.COC_PI_ATTACHED_UI = prevAttached;
    if (prevIntent === undefined) delete process.env.COC_PI_TABLE_INTENT;
    else process.env.COC_PI_TABLE_INTENT = prevIntent;
    if (prevRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = prevRole;
  }
  const tableOpen = sent.filter((row) => (
    row.message?.customType === "coc-pi-table-open"
  ));
  assert.equal(tableOpen.length, 1);
  assert.equal(tableOpen[0].options?.triggerTurn, true);
  assert.equal(tableOpen[0].message?.details?.table_open_satisfied, false);
  assert.match(tableOpen[0].message?.content ?? "", /session\.resume/);
  assert.match(tableOpen[0].message?.content ?? "", /pending_finalization/);
  assert.match(tableOpen[0].message?.content ?? "", /awaiting_player/);
  assert.match(tableOpen[0].message?.content ?? "", /Never replay an older assistant opening/);
  assert.equal(sent.some((row) => (
    row.message?.customType === welcome.STARTUP_RESUME_CUSTOM_TYPE
  )), false);
});

test("play-role resume session with visible history still triggers continuation", async () => {
  const welcome = await loadWelcome();
  assert.equal(welcome.shouldAutoOpenTable("resume", false, {
    intent: "continue",
    hasVisibleAssistant: true,
  }), true);
  assert.equal(welcome.shouldAutoOpenTable("resume", false, {
    intent: "continue",
    hasVisibleAssistant: true,
    startupCampaignSelected: false,
  }), false);
});

let branchEntrySeq = 0;
function branchEntry(role, content, extra = {}) {
  branchEntrySeq += 1;
  return {
    type: "message",
    id: `branch-entry-${branchEntrySeq}`,
    parentId: `branch-entry-${branchEntrySeq - 1}`,
    timestamp: "2026-08-24T17:38:00.000Z",
    message: { role, content },
    ...extra,
  };
}

function branchCtx(branch, entries = []) {
  return { sessionManager: { getEntries: () => entries, getBranch: () => branch } };
}

const visibleQuestion = () => branchEntry(
  "assistant",
  [{ type: "text", text: "请告诉我调查员的姓名、职业与年代。" }],
  { stopReason: "stop" },
);
const playerAnswer = (content = [{
  type: "text",
  text: "托马斯·里德，1890年代的记者。",
}]) => branchEntry("user", content);

test("trailing-player-user branch helper matches structured roles only", async () => {
  const welcome = await loadWelcome();
  const helper = welcome.sessionBranchHasTrailingPlayerUser;

  // Visible assistant question then a text user answer: unmatched.
  assert.equal(helper(branchCtx(
    [visibleQuestion(), playerAnswer()],
    [visibleQuestion(), playerAnswer()],
  )), true);

  // Attachment-only player turn still arms pending: content is never a
  // prerequisite.
  assert.equal(helper(branchCtx([
    visibleQuestion(),
    playerAnswer([{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo==" }]),
  ])), true);

  // String-content player turn (plain text input) arms pending exactly like
  // the array form: content shape is never a prerequisite. Empty and absent
  // content arm it too — parity with the extension quarantine helper.
  assert.equal(helper(branchCtx([
    visibleQuestion(),
    playerAnswer("托马斯·里德，1890年代的记者。"),
  ])), true);
  assert.equal(helper(branchCtx([visibleQuestion(), playerAnswer([])])), true);
  assert.equal(helper(branchCtx([
    visibleQuestion(),
    {
      type: "message",
      id: "branch-entry-user-no-content",
      parentId: "branch-entry-user-no-content-p",
      timestamp: "2026-08-24T17:38:00.000Z",
      message: { role: "user" },
    },
  ])), true);

  // Thinking-only / tool-only / empty assistant, toolResult, and hidden
  // custom entries after the user answer never clear the pending fact.
  assert.equal(helper(branchCtx([
    visibleQuestion(),
    playerAnswer(),
    branchEntry("assistant", [
      { type: "thinking", text: "整理姓名与职业，继续建卡。" },
      {
        type: "toolCall",
        id: "call-branch-1",
        name: "coc_setup",
        arguments: { operation: "setup.investigator_contract" },
      },
    ], { stopReason: "toolUse" }),
    branchEntry("toolResult", [
      { type: "text", text: '{"ok":true,"tool":"setup.investigator_contract"}' },
    ], { toolCallId: "call-branch-1", toolName: "coc_setup" }),
    branchEntry("assistant", [], { stopReason: "stop" }),
    {
      type: "custom_message",
      customType: "coc-pi-loading",
      content: "正在打开建卡引导……请稍候。",
      display: true,
    },
    {
      type: "custom",
      customType: "coc-tool-telemetry",
      data: { canonical_operation: "progressive.opening_bootstrap" },
    },
  ])), true);

  // A later assistant message with player-visible text clears it — including
  // after a string-content player turn.
  assert.equal(helper(branchCtx([
    visibleQuestion(),
    playerAnswer(),
    branchEntry(
      "assistant",
      [{ type: "text", text: "已记录：托马斯·里德，记者。请掷运气。" }],
      { stopReason: "stop" },
    ),
  ])), false);
  assert.equal(helper(branchCtx([
    visibleQuestion(),
    playerAnswer("托马斯·里德，1890年代的记者。"),
    branchEntry(
      "assistant",
      [{ type: "text", text: "已记录：托马斯·里德，记者。请掷运气。" }],
      { stopReason: "stop" },
    ),
  ])), false);

  // Only the CURRENT branch counts: entries visible through getEntries but
  // not on the branch (abandoned/older turns) never arm the fact, and a
  // sessionManager without getBranch stays safely false.
  assert.equal(helper(branchCtx(
    [visibleQuestion(), playerAnswer(), branchEntry(
      "assistant",
      [{ type: "text", text: "已记录：托马斯·里德，记者。" }],
      { stopReason: "stop" },
    )],
    [visibleQuestion(), playerAnswer()],
  )), false);
  assert.equal(helper({
    sessionManager: { getEntries: () => [playerAnswer()] },
  }), false);
  assert.equal(helper({ sessionManager: {} }), false);
});

test("string-content trailing player user auto-opens then settles to idle", async () => {
  const welcome = await loadWelcome();
  const helper = welcome.sessionBranchHasTrailingPlayerUser;

  // Same contract as the extension quarantine helper: a string-content
  // role=user answer arms the pending fact, so the character-setup table
  // auto-opens for it exactly like the array-content form.
  const pendingBranch = [
    visibleQuestion(),
    playerAnswer("托马斯·里德，1890年代的记者。"),
  ];
  const trailingPlayerUser = helper(branchCtx(pendingBranch));
  assert.equal(trailingPlayerUser, true);
  assert.equal(welcome.shouldAutoOpenTable("startup", false, {
    intent: "character-setup",
    hasVisibleAssistant: true,
    trailingPlayerUser,
  }), true);

  // A later player-visible assistant answer settles that turn: the pending
  // fact clears and settled idle behavior returns.
  const settledBranch = [
    ...pendingBranch,
    branchEntry(
      "assistant",
      [{ type: "text", text: "已记录：托马斯·里德，记者。" }],
      { stopReason: "stop" },
    ),
  ];
  const settledTrailing = helper(branchCtx(settledBranch));
  assert.equal(settledTrailing, false);
  assert.equal(welcome.shouldAutoOpenTable("startup", false, {
    intent: "character-setup",
    hasVisibleAssistant: true,
    trailingPlayerUser: settledTrailing,
  }), false);
});

test("character-setup auto-open covers trailing unmatched player answer", async () => {
  const welcome = await loadWelcome();

  // Non-fresh setup with a visible assistant AND a trailing user: open.
  assert.equal(welcome.shouldAutoOpenTable("startup", false, {
    intent: "character-setup",
    hasVisibleAssistant: true,
    trailingPlayerUser: true,
  }), true);
  // Settled setup history (visible assistant, no trailing user): idle.
  assert.equal(welcome.shouldAutoOpenTable("startup", false, {
    intent: "character-setup",
    hasVisibleAssistant: true,
    trailingPlayerUser: false,
  }), false);
  // Fresh setup desktop stays open regardless of the branch fact.
  assert.equal(welcome.shouldAutoOpenTable("startup", true, {
    intent: "character-setup",
    hasVisibleAssistant: true,
    trailingPlayerUser: false,
  }), true);
  // Other reasons stay gated exactly as before.
  assert.equal(welcome.shouldAutoOpenTable("resume", false, {
    intent: "character-setup",
    hasVisibleAssistant: false,
    trailingPlayerUser: true,
  }), false);
  // Continue mode ignores the branch fact entirely.
  assert.equal(welcome.shouldAutoOpenTable("startup", false, {
    intent: "continue",
    hasVisibleAssistant: true,
    trailingPlayerUser: false,
  }), true);
  assert.equal(welcome.shouldAutoOpenTable("startup", false, {
    intent: "continue",
    hasVisibleAssistant: true,
    trailingPlayerUser: true,
  }), true);
  assert.equal(welcome.shouldAutoOpenTable("resume", false, {
    intent: "continue",
    hasVisibleAssistant: true,
    trailingPlayerUser: true,
    startupCampaignSelected: false,
  }), false);
});

async function runSetupWelcomeHarness({ branch, entries }) {
  const welcome = await loadWelcome();
  const prevAttached = process.env.COC_PI_ATTACHED_UI;
  const prevIntent = process.env.COC_PI_TABLE_INTENT;
  process.env.COC_PI_ATTACHED_UI = "1";
  process.env.COC_PI_TABLE_INTENT = "character-setup";
  const sent = [];
  const fakePi = {
    registerCommand: () => {},
    sendMessage: (message, options) => {
      sent.push({ message, options });
    },
  };
  const campaignId = "pdf-coc-setup-pending-answer";
  const handler = welcome.registerCocWelcome(
    fakePi,
    () => ({
      callTool: async (name) => {
        if (name === "coc_capabilities") return { ok: true };
        throw new Error(`unexpected ${name}`);
      },
    }),
    mkdtempSync(path.join(tmpdir(), "pi-coc-welcome-setup-")),
  );
  try {
    await handler({ reason: "startup" }, {
      cwd: mkdtempSync(path.join(tmpdir(), "pi-coc-welcome-setup-cwd-")),
      mode: "rpc",
      hasUI: false,
      sessionManager: { getEntries: () => entries, getBranch: () => branch },
      ui: {
        setHeader: () => {},
        setStatus: () => {},
        notify: () => {},
      },
    }, campaignId);
  } finally {
    if (prevAttached === undefined) delete process.env.COC_PI_ATTACHED_UI;
    else process.env.COC_PI_ATTACHED_UI = prevAttached;
    if (prevIntent === undefined) delete process.env.COC_PI_TABLE_INTENT;
    else process.env.COC_PI_TABLE_INTENT = prevIntent;
  }
  return { welcome, sent };
}

test("setup resume with visible assistant + trailing user auto-opens with triggerTurn", async () => {
  const { welcome, sent } = await runSetupWelcomeHarness({
    branch: [visibleQuestion(), playerAnswer()],
    entries: [visibleQuestion(), playerAnswer()],
  });
  const tableOpen = sent.filter((row) => (
    row.message?.customType === "coc-pi-table-open"
  ));
  assert.equal(tableOpen.length, 1);
  assert.equal(tableOpen[0].options?.triggerTurn, true);
  assert.equal(tableOpen[0].message?.details?.table_intent, "character-setup");
  assert.equal(tableOpen[0].message?.details?.auto_open, true);
  assert.equal(tableOpen[0].message?.details?.table_open_satisfied, false);
  assert.match(tableOpen[0].message?.content ?? "", /session\.resume/);
  assert.match(tableOpen[0].message?.content ?? "", /setup\.investigator_contract/);
  assert.equal(sent.some((row) => (
    row.message?.customType === welcome.STARTUP_RESUME_CUSTOM_TYPE
  )), false);
});

test("settled setup history stays idle with non-triggering startup instruction", async () => {
  const { welcome, sent } = await runSetupWelcomeHarness({
    branch: [
      visibleQuestion(),
      playerAnswer(),
      branchEntry(
        "assistant",
        [{ type: "text", text: "已记录：托马斯·里德，记者。" }],
        { stopReason: "stop" },
      ),
    ],
    entries: [visibleQuestion(), playerAnswer()],
  });
  assert.equal(sent.some((row) => (
    row.message?.customType === "coc-pi-table-open"
  )), false);
  const startupResume = sent.filter((row) => (
    row.message?.customType === welcome.STARTUP_RESUME_CUSTOM_TYPE
  ));
  assert.equal(startupResume.length, 1);
  assert.equal(startupResume[0].options?.triggerTurn, false);
  assert.match(startupResume[0].message?.content ?? "", /session\.resume/);
  assert.match(startupResume[0].message?.content ?? "", /setup\.investigator_contract/);
});
