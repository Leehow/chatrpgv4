import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  lastVisibleAssistantText,
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
