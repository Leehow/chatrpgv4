import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  hostedSessionMessages,
  lastVisibleAssistantText,
  pickHostedSessionAgentDir,
  SETUP_CHARACTER_OPENING_MARKER,
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

test("hostedSessionMessages finds workspace .pi/agent when product dir is empty", () => {
  const product = fs.mkdtempSync(path.join(os.tmpdir(), "coc-product-agent-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-ws-"));
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
    const messages = hostedSessionMessages({
      workspace,
      agentDir: product,
      sessionId,
    });
    assert.equal(messages.at(-1)?.text, "这就是你的调查员。确认吗？");
  } finally {
    fs.rmSync(product, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
