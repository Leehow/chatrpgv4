import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  hostedSessionMessages,
  hostedSetupHistory,
  lastVisibleAssistantText,
  listSessionFiles,
  pickHostedSessionAgentDir,
  PLAY_TABLE_OPENING_MARKER,
  SETUP_CHARACTER_OPENING_MARKER,
  SETUP_HANDOFF_CUSTOM_TYPE,
  setupHistoryFromSessionFiles,
  TURN_RECOVERY_MARKER,
  visibleMessagesFromSessionFile,
} from "../pi-session-text.mjs";

function writeSession(agentDir, sessionId, rows) {
  const dir = path.join(agentDir, "sessions", "cwd-key");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `2026-08-17T04-46-20Z_${sessionId}.jsonl`);
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return file;
}

test("visibleMessagesFromSessionFile keeps only player-visible text", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pi-session-"));
  try {
    const file = writeSession(tmp, "web-the-haunting-qs", [
      { type: "session", id: "web-the-haunting-qs" },
      {
        type: "custom_message",
        customType: "coc-pi-loading",
        content: "正在打开建卡引导……请稍候。",
        display: true,
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", name: "coc_invoke" }],
        },
      },
      {
        type: "message",
        message: {
          role: "system",
          content: [{ type: "text", text: "internal system prompt" }],
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: "{\"ok\":true}" }],
        },
      },
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: `${SETUP_CHARACTER_OPENING_MARKER} first resume then contract` }],
        },
      },
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: `${TURN_RECOVERY_MARKER} call session.resume` }],
        },
      },
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: `${PLAY_TABLE_OPENING_MARKER} open the table` }],
        },
      },
      {
        type: "message",
        timestamp: "2026-08-17T04:47:15.624Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "先告诉我：这个人是谁？" },
          ],
        },
      },
    ]);
    assert.deepEqual(visibleMessagesFromSessionFile(file), [
      {
        role: "keeper",
        text: "先告诉我：这个人是谁？",
        at: Date.parse("2026-08-17T04:47:15.624Z"),
      },
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("lastVisibleAssistantText finds the newest matching session file", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pi-session-"));
  try {
    writeSession(tmp, "web-the-haunting-qs", [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "先告诉我：这个人是谁？" }],
        },
      },
    ]);
    assert.equal(
      lastVisibleAssistantText({
        agentDir: tmp,
        sessionId: "web-the-haunting-qs",
      }),
      "先告诉我：这个人是谁？",
    );
    assert.equal(
      lastVisibleAssistantText({
        agentDir: tmp,
        sessionId: "web-other",
      }),
      "",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("hostedSessionMessages prefers a canonical repo-local match over a newer legacy shadow", () => {
  const product = fs.mkdtempSync(path.join(os.tmpdir(), "coc-product-agent-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-ws-"));
  const repoRoot = path.join(workspace, "repo");
  const runtime = path.join(repoRoot, ".pi", "coc-agent");
  const sessionId = "web-the-white-war-qs-mt0c8rdz";
  try {
    const local = path.join(workspace, ".pi", "agent");
    writeSession(local, sessionId, [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "这就是你的调查员。确认吗？" }],
        },
      },
    ]);
    assert.equal(
      pickHostedSessionAgentDir({
        workspace,
        agentDir: product,
        sessionId,
      }),
      path.resolve(local),
    );
    const repoFile = writeSession(runtime, sessionId, [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "仓库本地的较新记录。" }],
        },
      },
    ]);
    const legacyFile = path.join(local, "sessions", "cwd-key", `2026-08-17T04-46-20Z_${sessionId}.jsonl`);
    fs.utimesSync(repoFile, new Date(1_000), new Date(1_000));
    fs.utimesSync(legacyFile, new Date(4_102_444_800_000), new Date(4_102_444_800_000));
    const messages = hostedSessionMessages({
      agentDirs: [runtime, product, local],
      sessionId,
    });
    assert.equal(messages.at(-1)?.text, "仓库本地的较新记录。");
  } finally {
    fs.rmSync(product, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("hostedSessionMessages falls back to the first legacy root with a matching session", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pi-session-roots-"));
  const runtime = path.join(tmp, "repo", ".pi", "coc-agent");
  const product = path.join(tmp, "app-support", "pi-agent");
  const workspaceLegacy = path.join(tmp, "workspace", ".pi", "agent");
  const sessionId = "web-the-white-war-qs-legacy-only";
  try {
    const productFile = writeSession(product, sessionId, [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "App Support 回退记录。" }],
        },
      },
    ]);
    const workspaceFile = writeSession(workspaceLegacy, sessionId, [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "工作区里时间更新的旧记录。" }],
        },
      },
    ]);
    fs.utimesSync(productFile, new Date(1_000), new Date(1_000));
    fs.utimesSync(workspaceFile, new Date(2_000), new Date(2_000));

    const messages = hostedSessionMessages({
      agentDirs: [runtime, product, workspaceLegacy],
      sessionId,
    });
    assert.equal(messages.at(-1)?.text, "App Support 回退记录。");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Setup-history projection

function writeNamedSession(agentDir, fileName, rows) {
  const dir = path.join(agentDir, "sessions", "cwd-key");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return file;
}

const sessionHeader = (id, timestamp) => ({ type: "session", id, timestamp, version: 3 });
const messageRow = (id, timestamp, role, text) => ({
  type: "message",
  id,
  parentId: null,
  timestamp,
  message: { role, content: [{ type: "text", text }] },
});

const setupAssistant = messageRow("a1", "2026-08-17T04:47:15.624Z", "assistant", "先告诉我：这个人是谁？");
const setupPlayer = messageRow("u1", "2026-08-17T04:48:00.000Z", "user", "我叫艾伦。");
const playAssistant = messageRow("a9", "2026-08-17T05:10:00.000Z", "assistant", "波士顿的雾比记忆中更湿。");

const handoffPayload = (campaignId) => ({
  type: SETUP_HANDOFF_CUSTOM_TYPE,
  campaign_id: campaignId,
  receipt: { schema_version: 1, campaign_id: campaignId, decision_id: "setup-complete-x" },
  at: "2026-08-17T04:50:00.000Z",
  consumer: "server-node/launcher",
});
/** pi.sendMessage envelope (live custom_message). */
const handoffCustomMessage = (campaignId) => ({
  type: "custom_message",
  customType: SETUP_HANDOFF_CUSTOM_TYPE,
  content: JSON.stringify(handoffPayload(campaignId)),
  details: handoffPayload(campaignId),
  display: false,
});
/** pi.appendEntry envelope (persisted session event). */
const handoffAppendEntry = (campaignId) => ({
  type: "custom",
  customType: SETUP_HANDOFF_CUSTOM_TYPE,
  data: handoffPayload(campaignId),
});

test("setup history cuts at the persisted handoff envelope and hides host prompts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-"));
  try {
    const file = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-handoff.jsonl", [
      sessionHeader("web-camp-handoff", "2026-08-17T04:46:20.000Z"),
      messageRow("h1", "2026-08-17T04:46:21.000Z", "user", `${SETUP_CHARACTER_OPENING_MARKER} open`),
      setupAssistant,
      setupPlayer,
      handoffCustomMessage("camp"),
      playAssistant,
    ]);
    const withCampaign = setupHistoryFromSessionFiles([file], { campaignId: "camp" });
    assert.equal(withCampaign.scope, "setup");
    assert.equal(withCampaign.boundary, "handoff");
    assert.deepEqual(withCampaign.messages.map((row) => row.text), [
      "先告诉我：这个人是谁？",
      "我叫艾伦。",
    ]);
    // Without a campaign constraint the same structural envelope still cuts.
    const anyCampaign = setupHistoryFromSessionFiles([file]);
    assert.equal(anyCampaign.scope, "setup");
    assert.equal(anyCampaign.boundary, "handoff");

    const hosted = hostedSetupHistory({ agentDir: tmp, sessionId: "web-camp-handoff", campaignId: "camp" });
    assert.equal(hosted.source, "pi-host-session");
    assert.equal(hosted.session_id, "web-camp-handoff");
    assert.equal(hosted.scope, "setup");
    assert.equal(hosted.boundary, "handoff");
    assert.equal(hosted.attribution, "message-role");
    assert.deepEqual(hosted.messages.map((row) => row.text), [
      "先告诉我：这个人是谁？",
      "我叫艾伦。",
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the appendEntry custom envelope is also a valid handoff boundary", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-append-"));
  try {
    const file = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-append.jsonl", [
      sessionHeader("web-camp-append", "2026-08-17T04:46:20.000Z"),
      setupAssistant,
      setupPlayer,
      handoffAppendEntry("camp"),
      playAssistant,
    ]);
    const extracted = setupHistoryFromSessionFiles(
      listSessionFiles(tmp, "web-camp-append"),
      { campaignId: "camp" },
    );
    assert.equal(extracted.scope, "setup");
    assert.equal(extracted.boundary, "handoff");
    assert.equal(extracted.messages.at(-1)?.text, "我叫艾伦。");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("forged or malformed handoff shapes never cut the boundary", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-forged-"));
  try {
    const file = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-forged.jsonl", [
      sessionHeader("web-camp-forged", "2026-08-17T04:46:20.000Z"),
      setupAssistant,
      // bare top-level type, never a persisted JSONL shape
      { type: SETUP_HANDOFF_CUSTOM_TYPE, campaign_id: "camp" },
      // custom_message envelope with a different customType
      {
        type: "custom_message",
        customType: "player-note",
        details: handoffPayload("camp"),
      },
      // payload missing campaign_id
      {
        type: "custom_message",
        customType: SETUP_HANDOFF_CUSTOM_TYPE,
        details: { type: SETUP_HANDOFF_CUSTOM_TYPE },
      },
      // payload with a different type field
      {
        type: "custom",
        customType: SETUP_HANDOFF_CUSTOM_TYPE,
        data: { type: "other", campaign_id: "camp" },
      },
      // player prose quoting the customType is just a player message
      messageRow("u9", "2026-08-17T04:55:00.000Z", "user", "coc_setup_handoff"),
      playAssistant,
    ]);
    const extracted = setupHistoryFromSessionFiles([file], { campaignId: "camp" });
    assert.equal(extracted.scope, "setup_and_table_join");
    assert.equal(extracted.boundary, null);
    assert.deepEqual(extracted.messages.map((row) => row.text), [
      "先告诉我：这个人是谁？",
      "coc_setup_handoff",
      "波士顿的雾比记忆中更湿。",
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a handoff for another campaign is not a boundary for this campaign", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-campaign-"));
  try {
    const file = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-cross.jsonl", [
      sessionHeader("web-camp-cross", "2026-08-17T04:46:20.000Z"),
      setupAssistant,
      handoffCustomMessage("other-camp"),
      playAssistant,
    ]);
    const mismatch = setupHistoryFromSessionFiles([file], { campaignId: "camp" });
    assert.equal(mismatch.scope, "setup_and_table_join");
    assert.equal(mismatch.boundary, null);
    const match = setupHistoryFromSessionFiles([file], { campaignId: "other-camp" });
    assert.equal(match.scope, "setup");
    assert.equal(match.boundary, "handoff");
    assert.deepEqual(match.messages.map((row) => row.text), ["先告诉我：这个人是谁？"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the play-opening host prompt is hidden but never a boundary", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-playmark-"));
  try {
    const file = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-playmark.jsonl", [
      sessionHeader("web-camp-playmark", "2026-08-17T04:46:20.000Z"),
      setupAssistant,
      setupPlayer,
      messageRow("h2", "2026-08-17T05:00:00.000Z", "user", `${PLAY_TABLE_OPENING_MARKER} resume`),
      playAssistant,
    ]);
    const extracted = setupHistoryFromSessionFiles([file]);
    assert.equal(extracted.scope, "setup_and_table_join");
    assert.equal(extracted.boundary, null);
    assert.deepEqual(extracted.messages.map((row) => row.text), [
      "先告诉我：这个人是谁？",
      "我叫艾伦。",
      "波士顿的雾比记忆中更湿。",
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("files without a provable session header are excluded from the merge", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-provenance-"));
  try {
    const good = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-prov.jsonl", [
      sessionHeader("web-camp-prov", "2026-08-17T04:46:20.000Z"),
      setupAssistant,
    ]);
    // header names another session id
    writeNamedSession(tmp, "2026-08-17T05-46-20Z_web-camp-prov.jsonl", [
      sessionHeader("web-other", "2026-08-17T05:46:20.000Z"),
      playAssistant,
    ]);
    // no session header at all
    writeNamedSession(tmp, "2026-08-17T06-46-20Z_web-camp-prov.jsonl", [
      playAssistant,
    ]);
    // first line is not JSON
    const dir = path.join(tmp, "sessions", "cwd-key");
    fs.writeFileSync(path.join(dir, "2026-08-17T07-46-20Z_web-camp-prov.jsonl"), "not-json\n");

    assert.deepEqual(listSessionFiles(tmp, "web-camp-prov"), [good]);
    const hosted = hostedSetupHistory({ agentDir: tmp, sessionId: "web-camp-prov" });
    assert.equal(hosted.scope, "setup_and_table_join");
    assert.deepEqual(hosted.messages.map((row) => row.text), ["先告诉我：这个人是谁？"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("verified files merge in session-start order with conservative dedup", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-merge-"));
  try {
    // File names run opposite to session-start order; ordering must follow
    // the recorded header timestamps, not the names.
    const newerStart = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-merge.jsonl", [
      sessionHeader("web-camp-merge", "2026-08-17T09:00:00.000Z"),
      setupAssistant,
      setupPlayer,
    ]);
    const olderStart = writeNamedSession(tmp, "2026-08-17T09-46-20Z_web-camp-merge.jsonl", [
      sessionHeader("web-camp-merge", "2026-08-17T05:00:00.000Z"),
      // duplicate of the newer file's player row (same row id, time, text)
      setupPlayer,
      // replay of the same assistant text under a new row id and new time
      messageRow("a2", "2026-08-17T06:00:00.000Z", "assistant", "先告诉我：这个人是谁？"),
      // player repeating the same words later is a distinct turn
      messageRow("u2", "2026-08-17T07:00:00.000Z", "user", "我叫艾伦。"),
    ]);
    assert.deepEqual(listSessionFiles(tmp, "web-camp-merge"), [olderStart, newerStart]);
    const extracted = setupHistoryFromSessionFiles(listSessionFiles(tmp, "web-camp-merge"));
    assert.deepEqual(extracted.messages.map((row) => row.text), [
      "我叫艾伦。",           // first occurrence (older file)
      "先告诉我：这个人是谁？", // replayed text, new id + time → kept
      "我叫艾伦。",           // repeated player words, new id + time → kept
      "先告诉我：这个人是谁？", // newer file
      // newer file's 我叫艾伦 dropped: same row id (and same role+time+text)
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("system, tool and thinking rows never project into setup history", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-roles-"));
  try {
    const file = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-roles.jsonl", [
      sessionHeader("web-camp-roles", "2026-08-17T04:46:20.000Z"),
      messageRow("s1", "2026-08-17T04:47:00.000Z", "system", "internal system prompt"),
      messageRow("t1", "2026-08-17T04:47:01.000Z", "toolResult", "{\"ok\":true}"),
      {
        type: "message",
        id: "a3",
        timestamp: "2026-08-17T04:47:15.624Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden reasoning" },
            { type: "text", text: "先告诉我：这个人是谁？" },
          ],
        },
      },
    ]);
    const extracted = setupHistoryFromSessionFiles([file]);
    assert.deepEqual(extracted.messages, [
      { role: "keeper", text: "先告诉我：这个人是谁？", at: Date.parse("2026-08-17T04:47:15.624Z") },
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("setup history stays conservative when no machine boundary exists", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-join-"));
  try {
    const file = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-plain.jsonl", [
      sessionHeader("web-camp-plain", "2026-08-17T04:46:20.000Z"),
      setupAssistant,
      setupPlayer,
      messageRow("h3", "2026-08-17T04:49:00.000Z", "user", `${TURN_RECOVERY_MARKER} recover`),
      playAssistant,
    ]);
    const extracted = setupHistoryFromSessionFiles([file]);
    assert.equal(extracted.scope, "setup_and_table_join");
    assert.equal(extracted.boundary, null);
    assert.deepEqual(extracted.messages.map((row) => row.text), [
      "先告诉我：这个人是谁？",
      "我叫艾伦。",
      "波士顿的雾比记忆中更湿。",
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("hostedSetupHistory does not invent messages for an unknown session", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-empty-"));
  try {
    const hosted = hostedSetupHistory({ agentDir: tmp, sessionId: "web-missing" });
    assert.deepEqual(hosted, {
      messages: [],
      source: "pi-host-session",
      session_id: "web-missing",
      scope: "setup",
      boundary: null,
      attribution: "message-role",
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
