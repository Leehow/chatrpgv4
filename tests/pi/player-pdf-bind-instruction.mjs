#!/usr/bin/env node
// Smoke: the extension-layer forced raw-PDF bind injection.
//
// The KP must not need to read coc-module-init/SKILL.md to know that a player
// message carrying a local PDF path makes scenario.bind_pdf its first call
// (observed DeepSeek sessions instead called unrelated setup.invoke ops or
// claimed the system was producing a bundle while nothing parsed). This probe
// proves the message_start listener steers exactly one hidden instruction
// (display:false, deliverAs:"steer" so the agent loop drains it before the
// first model call) per normalized PDF path, and stays silent otherwise.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const extension = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const { registerPlayerPdfBindInstruction } = extension;

const temp = await mkdtemp(path.join(os.tmpdir(), "pi-pdf-inject-"));
const pdfPath = path.join(temp, "cold-harvest.pdf");
await writeFile(pdfPath, "%PDF-1.4 fixture for the pdf-bind injection smoke");
const missingPdf = path.join(temp, "does-not-exist.pdf");

const handlers = new Map();
const sent = [];
const epoch = { value: 1 };
const injectedPaths = new Set();
registerPlayerPdfBindInstruction({
  on(type, handler) {
    const registered = handlers.get(type) || [];
    registered.push(handler);
    handlers.set(type, registered);
  },
  sendMessage: (message, options) => sent.push({ message, options }),
}, {
  workspaceRoot: () => "/workspace",
  isCurrent: (value) => value === epoch.value,
  epoch: () => epoch.value,
  injectedPaths,
});

async function emit(message) {
  for (const handler of handlers.get("message_start") || []) {
    await handler({ type: "message_start", message }, { cwd: "/workspace" });
  }
}

const userWithPdf = {
  role: "user",
  content: [{ type: "text", text: `跑这个新本：${pdfPath}` }],
};
await emit(userWithPdf);
const injected = sent.filter(
  (entry) => (
    entry.message.customType
      === extension.PLAYER_PDF_BIND_INSTRUCTION_CUSTOM_TYPE
  ),
);
assert.equal(sent.length, 1, "exactly one hidden message sent for one PDF path");
assert.equal(injected.length, 1, "injection uses the dedicated custom type");
assert.equal(injected[0].message.display, false, "injection is display:false");
assert.equal(injected[0].options.deliverAs, "steer", "steered before first model call");
assert.equal(injected[0].options.triggerTurn, undefined, "no extra turn trigger");
assert.match(injected[0].message.content, /scenario\.bind_pdf/, "content names bind_pdf");
assert.match(injected[0].message.content, new RegExp(escapeRegExp(pdfPath)), "content carries the exact PDF path");
assert.match(
  injected[0].message.content,
  /bundle-must-be-directory/,
  "content explains the raw-PDF trigger error",
);
assert.match(
  injected[0].message.content,
  /coc-raw-pdf-bind-first-bundle-terminal/,
  "content names the terminal notice to wait for",
);
assert.deepEqual(
  injected[0].message.details,
  {
    schema_version: 1,
    pdf_path: pdfPath,
    instruction_ref: "pi.player-pdf-bind.first-instruction.v1",
  },
  "structured details identify the exact PDF path",
);

// Dedup: the same PDF path again must not re-inject.
await emit(userWithPdf);
assert.equal(sent.length, 1, "duplicate PDF message does not re-inject");

// The same path re-mentioned through a different wording still dedups on the
// normalized path.
await emit({
  role: "user",
  content: [{ type: "text", text: `就用刚才那个 ${pdfPath} 开始吧` }],
});
assert.equal(sent.length, 1, "re-mention of the same path does not re-inject");

// A different real PDF is a new injection.
const secondPdf = path.join(temp, "second-module.pdf");
await writeFile(secondPdf, "%PDF-1.4 second fixture");
await emit({
  role: "user",
  content: [{ type: "text", text: `换一个本：${secondPdf}` }],
});
assert.equal(sent.length, 2, "a new PDF path injects once");

// Non-PDF / no-path messages stay silent.
await emit({ role: "user", content: [{ type: "text", text: "继续。" }] });
await emit({ role: "user", content: [{ type: "text", text: "看一下这本书的介绍" }] });
await emit({ role: "assistant", content: [{ type: "text", text: pdfPath }] });
await emit({ role: "custom", customType: "coc-pi-welcome", content: "welcome", display: false });
await emit({ role: "user", content: [{ type: "toolResult", id: "t-1" }] });
assert.equal(sent.length, 2, "PDF-free, assistant, custom, and toolResult messages never inject");

// A URL ending in .pdf is structurally excluded.
await emit({
  role: "user",
  content: [{ type: "text", text: `查一下 https://example.com/guide.pdf 这页` }],
});
assert.equal(sent.length, 2, "URL .pdf tokens are not local PDF paths");

// A .pdf mention that does not exist on disk is a document mention, not a
// player-provided module: the existence gate keeps it silent.
await emit({
  role: "user",
  content: [{ type: "text", text: `把 ${missingPdf} 加进规则` }],
});
assert.equal(sent.length, 2, "missing file stays silent");

// Session boundary resets the dedup (the extension clears its session set on
// session_shutdown) so a later session may inject again.
epoch.value = 2;
injectedPaths.clear();
await emit(userWithPdf);
assert.equal(sent.length, 3, "a new session epoch may inject the same path once");
await emit(userWithPdf);
assert.equal(sent.length, 3, "still once per session");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

process.stdout.write("player-pdf-bind instruction smoke OK\n");
