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

function writeNamedSession(agentDir, fileName, rows) {
  const dir = path.join(agentDir, "sessions", "cwd-key");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return file;
}

const setupAssistant = {
  type: "message",
  timestamp: "2026-08-17T04:47:15.624Z",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "先告诉我：这个人是谁？" }],
  },
};
const setupPlayer = {
  type: "message",
  timestamp: "2026-08-17T04:48:00.000Z",
  message: {
    role: "user",
    content: [{ type: "text", text: "我叫艾伦。" }],
  },
};
const playAssistant = {
  type: "message",
  timestamp: "2026-08-17T05:10:00.000Z",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "波士顿的雾比记忆中更湿。" }],
  },
};

test("setup history cuts at persisted coc_setup_handoff and hides host prompts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-"));
  try {
    const file = writeSession(tmp, "web-camp-handoff", [
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: `${SETUP_CHARACTER_OPENING_MARKER} open` }],
        },
      },
      setupAssistant,
      setupPlayer,
      {
        type: "custom_message",
        customType: SETUP_HANDOFF_CUSTOM_TYPE,
        details: { type: SETUP_HANDOFF_CUSTOM_TYPE, campaign_id: "camp" },
      },
      playAssistant,
    ]);
    const extracted = setupHistoryFromSessionFiles([file]);
    assert.equal(extracted.scope, "setup");
    assert.equal(extracted.boundary, "handoff");
    assert.deepEqual(extracted.messages.map((row) => row.text), [
      "先告诉我：这个人是谁？",
      "我叫艾伦。",
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("setup history cuts at the exact play opening host prompt across files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-files-"));
  try {
    const older = writeNamedSession(tmp, "2026-08-17T04-46-20Z_web-camp-join.jsonl", [
      setupAssistant,
      setupPlayer,
    ]);
    const newer = writeNamedSession(tmp, "2026-08-17T05-00-00Z_web-camp-join.jsonl", [
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: `${PLAY_TABLE_OPENING_MARKER} resume` }],
        },
      },
      playAssistant,
    ]);
    const listed = listSessionFiles(tmp, "web-camp-join");
    assert.deepEqual(listed, [older, newer]);
    const extracted = setupHistoryFromSessionFiles(listed);
    assert.equal(extracted.scope, "setup");
    assert.equal(extracted.boundary, "play_opening");
    assert.deepEqual(extracted.messages.map((row) => row.text), [
      "先告诉我：这个人是谁？",
      "我叫艾伦。",
    ]);
    const hosted = hostedSetupHistory({ agentDir: tmp, sessionId: "web-camp-join" });
    assert.equal(hosted.source, "pi-host-session");
    assert.equal(hosted.session_id, "web-camp-join");
    assert.equal(hosted.scope, "setup");
    assert.equal(hosted.messages.at(-1)?.text, "我叫艾伦。");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("setup history stays conservative when no machine boundary exists", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-history-join-"));
  try {
    const file = writeSession(tmp, "web-camp-plain", [
      setupAssistant,
      setupPlayer,
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: `${TURN_RECOVERY_MARKER} recover` }],
        },
      },
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
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
