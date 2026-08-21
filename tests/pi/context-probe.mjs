#!/usr/bin/env node
/**
 * Deterministic smoke for lib/context-probe.ts: build a small but realistic
 * pi transcript (two closed player turns plus a live turn), then assert the
 * probe's accounting, its epoch-fold projection, and its prefix-stability
 * classification (append_only / rewritten / reset). The probe must never
 * touch the messages it observes.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const mod = await import(
  pathToFileURL(resolve(root, "plugins/coc-keeper/pi/lib/context-probe.ts")).href
);

let clockMs = 0;
const probe = mod.createContextProbe({ now: () => (clockMs += 1) });

const userMessage = (text) => ({ role: "user", content: text, timestamp: 1 });
const keeperMessage = (prose, toolArgs) => ({
  role: "assistant",
  model: "grok-4.5",
  content: [
    { type: "thinking", thinking: "思".repeat(400) },
    { type: "text", text: prose },
    ...(toolArgs ? [{ type: "toolCall", id: "call-1", name: "coc_state_journal", arguments: toolArgs }] : []),
  ],
  usage: {},
  stopReason: "toolUse",
  timestamp: 2,
});
const toolResult = (size) => ({
  role: "toolResult",
  toolCallId: "call-1",
  toolName: "coc_state_journal",
  content: [{ type: "text", text: "x".repeat(size) }],
  isError: false,
  timestamp: 3,
});

const closedTurn = (prose, size) => [
  userMessage("我推门进去"),
  keeperMessage(prose, { operation: "state.journal", campaign: "probe" }),
  toolResult(size),
];

const history = [
  ...closedTurn("门后是走廊。", 4000),
  ...closedTurn("走廊尽头有扇窗。", 6000),
];
const live = [...history, userMessage("我走向窗户"), toolResult(2000)];

const first = probe.observe(live);

// Accounting: prose is tiny, tool payloads dominate — the real session shape.
const classSum = Object.values(first.by_class).reduce((sum, value) => sum + value, 0);
const accounting = first.messages === 8
  && first.chars > 0
  && first.est_tokens === Math.ceil(first.chars / 4)
  && classSum === first.chars
  && first.by_class.tool_result === 12000 + 3 * "coc_state_journal".length
  && first.by_class.user === "我推门进去".length * 2 + "我走向窗户".length
  && first.by_class.assistant_thinking === 800
  && first.by_class.tool_call > 0;

// Fold projection: only the two closed turns are foldable. The live turn's
// tool result (2000 chars) is the current call's own input and must survive.
const fold = first.fold;
const journalArgsChars = JSON.stringify({ operation: "state.journal", campaign: "probe" }).length;
const foldShape = fold.turn_boundary_index === 6
  && fold.closed_turns === 2
  && fold.folded_tool_results === 2
  && fold.tool_chars === 4000 + 6000 + 2 * "coc_state_journal".length
    + 2 * ("coc_state_journal".length + journalArgsChars)
  && fold.thinking_chars === 800
  && fold.evictable_chars === fold.tool_chars + fold.thinking_chars
  && fold.stub_chars === 2 * mod.STUB_CHARS
  && fold.saving_chars === fold.evictable_chars - fold.stub_chars
  && fold.projected_chars === first.chars - fold.saving_chars
  && fold.est_saving_tokens === mod.estimateTokens(fold.saving_chars)
  && fold.saving_percent > 50;
const liveTurnPreserved = fold.tool_chars < first.by_class.tool_result;

// Prefix: first observation, then a pure append (same turn, next model call).
const appended = probe.observe([
  ...live,
  keeperMessage("窗外是雨夜。", null),
]);
const appendOnly = appended.prefix.status === "append_only"
  && appended.prefix.stable_messages === 8
  && appended.prefix.diverged_at === null
  && appended.prefix.appended_messages === 1
  && appended.prefix.stable_chars > 0;

// A mid-history rewrite (what folding would do) must be reported, not hidden.
const folded = [...live.slice(0, 2), toolResult(50), ...live.slice(3), keeperMessage("窗外是雨夜。", null)];
const rewritten = probe.observe(folded);
const rewriteDetected = rewritten.prefix.status === "rewritten"
  && rewritten.prefix.diverged_at === 2
  && rewritten.prefix.stable_messages === 2;

// A different conversation entirely (subagent / fresh session) is a reset.
const reset = probe.observe([userMessage("另一局"), toolResult(10)]);
const resetDetected = reset.prefix.status === "reset" && reset.prefix.stable_messages === 0;

// Host-side `details` never reaches the provider and must not be measured.
const withDetails = probe.observe([
  userMessage("带 details"),
  { ...toolResult(100), details: { bulky: "d".repeat(50000) } },
]);
const detailsIgnored = withDetails.chars < 1000
  && withDetails.by_class.tool_result === 100 + "coc_state_journal".length;

// Observation must not mutate the observed messages.
const untouched = live.length === 8
  && live[2].content[0].text.length === 4000
  && JSON.stringify(live[1].content[0]).includes("思");

// No turn boundary at all (tool-only context) must not crash or over-fold.
const boundaryless = probe.observe([toolResult(100)]);
const boundarylessSafe = boundaryless.fold.turn_boundary_index === null
  && boundaryless.fold.closed_turns === 0
  && boundaryless.fold.saving_chars === 0;

const empty = probe.observe([]);
const emptySafe = empty.messages === 0 && empty.chars === 0 && empty.fold.saving_percent === null;

process.stdout.write(JSON.stringify({
  ok: true,
  accounting,
  foldShape,
  liveTurnPreserved,
  appendOnly,
  rewriteDetected,
  resetDetected,
  untouched,
  detailsIgnored,
  boundarylessSafe,
  emptySafe,
  savingPercent: Math.round(fold.saving_percent),
  probeMsCounted: first.observe_ms > 0,
}));
