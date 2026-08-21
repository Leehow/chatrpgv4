#!/usr/bin/env node
/**
 * Deterministic smoke for lib/context-fold.ts. The fold is a live rewrite of
 * what the model sees, so the checks here are about the two things that make it
 * safe: it must never touch the running turn's tool results, and a folded
 * prefix must stay byte-identical forever (the prefix cache has no pinnable
 * breakpoints, so an unstable stub would silently cost a full re-send).
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const mod = await import(
  pathToFileURL(resolve(root, "plugins/coc-keeper/pi/lib/context-fold.ts")).href
);

const player = (text) => ({ role: "user", content: text, timestamp: 1 });
const keeper = (prose) => ({
  role: "assistant",
  model: "grok-4.5",
  content: [
    { type: "thinking", thinking: "思".repeat(100) },
    { type: "text", text: prose },
    { type: "toolCall", id: "c", name: "coc_invoke", arguments: { operation: "state.journal" } },
  ],
  usage: {},
  stopReason: "toolCalls",
  timestamp: 2,
});
const result = (id, size, operation = "state.journal") => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "coc_invoke",
  content: [{
    type: "text",
    text: JSON.stringify({
      ok: true,
      tool: operation,
      wire: {
        canonical_operation: operation,
        full_result_sha256: `sha256:${id.padEnd(64, "0")}`,
      },
      data: { padding: "x".repeat(size) },
    }),
  }],
  details: { hostOnly: "d".repeat(5000) },
  isError: false,
  timestamp: 3,
});

const turn = (n, size) => [player(`回合 ${n}`), keeper(`叙事 ${n}`), result(`t${n}`, size)];
const contentText = (message) => (typeof message.content === "string"
  ? message.content
  : message.content.map((part) => part.text ?? "").join(""));
const isStub = (message) => contentText(message).includes('"folded":true');

// --- Below threshold: nothing folded, the array comes back untouched. ---
const quiet = mod.createContextFold({ enabled: true, thresholdTokens: 20000 });
const smallHistory = [...turn(1, 500), player("回合 2")];
const quietRun = quiet.apply(smallHistory);
const belowThreshold = quietRun.messages === smallHistory
  && quiet.stats().folded_results === 0
  && quiet.stats().epochs === 0
  && quiet.stats().pending_chars > 0;

// --- Crossing the threshold at a turn boundary folds the closed turns. ---
const fold = mod.createContextFold({ enabled: true, thresholdTokens: 5000 });
const history = [...turn(1, 30000), ...turn(2, 30000)];

// Mid-turn (the pile is already over threshold, but the turn is still running):
// folding here would rewrite the prefix underneath the calls of this very turn.
const midTurn = fold.apply([...history, player("回合 3"), keeper("叙事 3"), result("t3", 100)]);
const midTurnHeldOff = fold.stats().epochs === 0
  && midTurn.messages.filter(isStub).length === 0;

// First call of the next turn: the boundary the fold is allowed to use.
const atBoundary = fold.apply([...history, player("回合 3")]);
const stats = fold.stats();
const foldedAtBoundary = stats.epochs === 1
  && stats.folded_results === 2
  && stats.folded_chars > 60000
  && stats.stub_chars < 1000
  && stats.pending_chars === 0
  && atBoundary.messages.filter(isStub).length === 2;

// The live turn's own result is never folded, on the same call.
const withLive = fold.apply([...history, player("回合 3"), keeper("叙事 3"), result("t3", 30000)]);
const liveTurnUntouched = !isStub(withLive.messages.at(-1))
  && contentText(withLive.messages.at(-1)).includes("x".repeat(100));

// --- Byte stability: the same result must render to the same stub forever. ---
const stubA = contentText(atBoundary.messages[2]);
const stubB = contentText(withLive.messages[2]);
const later = fold.apply([...history, player("回合 3"), keeper("叙事 3"), result("t3", 30000),
  player("回合 4")]);
const stubC = contentText(later.messages[2]);
const stubStable = stubA === stubB && stubB === stubC;

// Monotonic: once folded, never restored, even as the transcript grows.
const monotonic = later.messages.filter(isStub).length >= 2
  && fold.stats().folded_results >= 2;

// --- Stub content is structural, never a summary of the payload. ---
const stub = JSON.parse(stubA);
const stubShape = stub.folded === true
  && stub.tool === "coc_invoke"
  && stub.canonical_operation === "state.journal"
  && stub.ok === true
  && stub.full_result_sha256.startsWith("sha256:t1")
  && stub.folded_chars > 30000
  && typeof stub.note === "string"
  && !stubA.includes("padding");

// Host-side `details` survives: the TUI and this package's renderers still
// show the original call even though the provider gets the stub.
const detailsKept = atBoundary.messages[2].details.hostOnly.length === 5000;

// Player messages and KP prose are never folded.
const proseKept = atBoundary.messages[1].content.some((part) => part.text === "叙事 1")
  && atBoundary.messages[0].content === "回合 1";

// A result smaller than the stub is left alone: folding it would cost context.
const tiny = mod.createContextFold({ enabled: true, thresholdTokens: 1 });
const tinyRun = tiny.apply([player("回合 1"), keeper("叙事 1"), result("s1", 5), player("回合 2")]);
const tinyResultKept = tiny.stats().folded_results === 0
  && tiny.stats().pending_chars === 0
  && tinyRun.messages.filter(isStub).length === 0;

// --- Kill switch and settings. ---
const off = mod.createContextFold({ enabled: false, thresholdTokens: 1 });
const offRun = off.apply(history);
const disabled = offRun.messages === history && off.stats().folded_results === 0;

const envDefault = mod.readFoldSettings({});
const envOff = mod.readFoldSettings({ PI_COC_CONTEXT_FOLD: "off" });
const envTuned = mod.readFoldSettings({ PI_COC_CONTEXT_FOLD_TOKENS: "1234" });
const settingsRead = envDefault.enabled === true
  && envDefault.thresholdTokens === mod.DEFAULT_FOLD_THRESHOLD_TOKENS
  && envOff.enabled === false
  && envTuned.thresholdTokens === 1234
  && mod.readFoldSettings({ PI_COC_CONTEXT_FOLD_TOKENS: "junk" }).thresholdTokens
    === mod.DEFAULT_FOLD_THRESHOLD_TOKENS;

// Degenerate input must not throw.
const empty = mod.createContextFold({ enabled: true, thresholdTokens: 1 }).apply([]);
const emptySafe = empty.messages.length === 0;

process.stdout.write(JSON.stringify({
  ok: true,
  belowThreshold,
  midTurnHeldOff,
  foldedAtBoundary,
  liveTurnUntouched,
  stubStable,
  monotonic,
  stubShape,
  tinyResultKept,
  detailsKept,
  proseKept,
  disabled,
  settingsRead,
  emptySafe,
  foldedChars: stats.folded_chars,
  stubChars: stats.stub_chars,
}));
