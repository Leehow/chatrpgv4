#!/usr/bin/env node
// The leading-whitespace watchdog must bound a runaway stream without killing
// a padded one.
//
// It counted two things and aborted on either: 32 whitespace deltas, or 128
// whitespace characters. A counted delta always carries at least one
// character, so `charCount >= deltaCount` always holds and the delta bound can
// only ever fire first — four times sooner when a provider streams one
// character at a time. That is what happened on a live table (2026-09-01,
// campaign amaranthine-run3): every abort was exactly 32 deltas of 32
// characters, and the Keeper — re-prompted by the empty-terminal recovery it
// triggered — produced its narration immediately. The stream was padding, not
// runaway, and the host's own abort was what emptied the turn. Eight of 28
// turns paid an extra model round trip for it, six of them consecutively.
//
// A later measured stream led with 42 whitespace characters and finished
// normally, which is the case the old delta bound would have destroyed.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));

/** Drive one assistant stream through the gate and report what it did. */
function streamLeadingWhitespace({ chunks, thenText = "narration" }) {
  const handlers = new Map();
  const pi = {
    on: (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    appendEntry() {},
    sendMessage() {},
  };
  const aborts = [];
  const observed = [];
  main.registerPlayerTranscriptGate(
    pi,
    undefined,
    undefined,
    undefined,
    undefined,
    (details) => aborts.push(details),
    (details) => observed.push(details),
  );
  const emit = (event, payload) => {
    for (const handler of handlers.get(event) ?? []) {
      handler(payload, { abort() {} });
    }
  };
  const message = { role: "assistant", content: [] };
  emit("message_start", { message });
  for (const chunk of chunks) {
    emit("message_update", {
      message,
      assistantMessageEvent: { type: "text_delta", delta: chunk },
    });
  }
  if (thenText !== null) {
    emit("message_update", {
      message,
      assistantMessageEvent: { type: "text_delta", delta: thenText },
    });
  }
  emit("message_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: thenText ?? "" }],
    },
  });
  return { aborts, observed };
}

test("a padded stream is not aborted", () => {
  // The exact live shape: single-character whitespace deltas, then narration.
  const { aborts } = streamLeadingWhitespace({
    chunks: Array.from({ length: 42 }, () => "\n"),
  });
  assert.deepEqual(
    aborts,
    [],
    "42 leading whitespace characters aborted the stream; that is padding, "
      + "and aborting it empties the turn the host then has to recover",
  );
});

test("delta count alone never aborts", () => {
  // 200 one-character deltas is far past any delta bound and still well under
  // the character bound that expresses the guard's actual intent.
  const { aborts } = streamLeadingWhitespace({
    chunks: Array.from({ length: 200 }, () => " "),
  });
  assert.deepEqual(aborts, [], "the delta count is evidence, not a trigger");
});

test("a genuinely runaway whitespace stream is still bounded", () => {
  const { aborts } = streamLeadingWhitespace({
    chunks: Array.from({ length: 40 }, () => " ".repeat(64)),
    thenText: null,
  });
  assert.ok(aborts.length >= 1, "an unbounded whitespace stream must abort");
  assert.ok(
    aborts[0].charCount >= 512,
    `abort fired at ${aborts[0].charCount} characters, below the stated bound`,
  );
});

test("semantic output ends the watch immediately", () => {
  // Whitespace AFTER real text is ordinary formatting and must never count.
  const { aborts } = streamLeadingWhitespace({
    chunks: ["hello", ...Array.from({ length: 400 }, () => " ".repeat(8))],
    thenText: null,
  });
  assert.deepEqual(aborts, [], "whitespace after semantic output was counted");
});

test("every stream that led with whitespace reports what it led with", () => {
  // The bound was chosen from measurements; keep the measurements coming.
  const { observed } = streamLeadingWhitespace({
    chunks: Array.from({ length: 5 }, () => "\n"),
  });
  assert.deepEqual(observed, [{ deltaCount: 5, charCount: 5 }]);
  const clean = streamLeadingWhitespace({ chunks: [] });
  assert.deepEqual(
    clean.observed,
    [],
    "a stream with no leading whitespace must not report",
  );
});
