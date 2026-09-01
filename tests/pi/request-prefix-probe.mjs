#!/usr/bin/env node
/**
 * Deterministic smoke for lib/request-prefix-probe.ts.
 *
 * The probe reads the assembled provider request body — the one object that
 * holds the system prompt, the advertised tools and the transcript at once —
 * and is the only place the sections a message-array probe cannot see are
 * measurable. Its whole value depends on being an observation: it must not
 * mutate the payload, must not copy content out of it, and must not throw on
 * a body it does not recognise.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const mod = await import(
  pathToFileURL(resolve(root, "plugins/coc-keeper/pi/lib/request-prefix-probe.ts")).href
);

let clock = 0;
const now = () => (clock += 1);
const probe = mod.createRequestPrefixProbe({ now, settings: { enabled: true } });

const systemPrompt = "守秘人系统提示".repeat(100);
const tool = (name, pad) => ({
  type: "function",
  name,
  parameters: { type: "object", properties: { p: { type: "string", description: "z".repeat(pad) } } },
});
const message = (text) => ({ role: "user", content: text });

// --- openai-responses shape -------------------------------------------------
const first = probe.observe({
  model: "grok-4.5",
  instructions: systemPrompt,
  tools: [tool("coc_invoke", 300), tool("read", 50)],
  input: [message("我推门"), message("我看向窗户")],
  stream: true,
});
// Same tools, one more message: the prefix is stable, the transcript grew.
const appended = probe.observe({
  model: "grok-4.5",
  instructions: systemPrompt,
  tools: [tool("coc_invoke", 300), tool("read", 50)],
  input: [message("我推门"), message("我看向窗户"), message("我上楼")],
  stream: true,
});
// Tool dropped: the transcript is still append-only, the prefix is not.
const toolsMoved = probe.observe({
  model: "grok-4.5",
  instructions: systemPrompt,
  tools: [tool("coc_invoke", 300)],
  input: [message("我推门"), message("我看向窗户"), message("我上楼"), message("我推门进去")],
  stream: true,
});
// Same tool names, bigger schema: names alone would call this stable.
const reschemad = probe.observe({
  model: "grok-4.5",
  instructions: systemPrompt,
  tools: [tool("coc_invoke", 900)],
  input: [message("我推门")],
  stream: true,
});

// --- anthropic-messages shape ----------------------------------------------
const anthropicProbe = mod.createRequestPrefixProbe({ now, settings: { enabled: true } });
const anthropic = anthropicProbe.observe({
  model: "claude",
  system: [{ type: "text", text: systemPrompt }],
  tools: [{ name: "coc_invoke", input_schema: { type: "object" } }],
  messages: [message("我推门")],
});

// --- legacy `function` nesting ---------------------------------------------
const legacyProbe = mod.createRequestPrefixProbe({ now, settings: { enabled: true } });
const legacy = legacyProbe.observe({
  tools: [{ type: "function", function: { name: "nested_tool", parameters: {} } }],
  input: [],
});

// --- degenerate and hostile input ------------------------------------------
const unknownShape = legacyProbe.observe({ model: "x", prompt: "no arrays here" });
const circular = { model: "x", input: [] };
circular.self = circular;
const circularResult = legacyProbe.observe(circular);
const nullResult = legacyProbe.observe(null);
const undefinedResult = legacyProbe.observe(undefined);
const primitiveResult = legacyProbe.observe("not an object");

// --- kill switch ------------------------------------------------------------
const offProbe = mod.createRequestPrefixProbe({ now, settings: { enabled: false } });
const offResult = offProbe.observe({ instructions: systemPrompt, tools: [], input: [] });
const envOff = mod.readRequestPrefixProbeSettings({ PI_COC_REQUEST_PREFIX_PROBE: "off" });
const envZero = mod.readRequestPrefixProbeSettings({ PI_COC_REQUEST_PREFIX_PROBE: "0" });
const envDefault = mod.readRequestPrefixProbeSettings({});

// --- the payload must survive untouched ------------------------------------
const guarded = {
  model: "grok-4.5",
  instructions: systemPrompt,
  tools: [tool("coc_invoke", 10)],
  input: [message("我推门")],
};
const guardedBefore = JSON.stringify(guarded);
const guardedReturn = probe.observe(guarded);
const guardedAfter = JSON.stringify(guarded);

const serializedFirst = JSON.stringify(first);

process.stdout.write(JSON.stringify({
  ok: true,
  // Every section of the request body is measured, and the four sections plus
  // the residual reconcile exactly with the serialized body.
  sections: first.shape === "openai-responses"
    && first.instructions_bytes === Buffer.byteLength(systemPrompt, "utf8")
    && first.tools_count === 2
    && first.tools_bytes > 0
    && first.input_messages === 2
    && first.other_bytes > 0
    && first.instructions_bytes + first.tools_bytes + first.input_bytes
      + first.other_bytes === first.payload_bytes,
  perToolCostLargestFirst: JSON.stringify(first.tools.map((t) => t.name))
    === JSON.stringify(["coc_invoke", "read"])
    && first.tools[0].bytes > first.tools[1].bytes,
  firstCallHasNoPrior: first.tools_status === "first"
    && first.instructions_status === "first",
  // The distinction the whole investigation turned on: a growing transcript is
  // free, a moving tool field is not.
  appendOnlyTranscriptKeepsPrefixStable: appended.tools_status === "stable"
    && appended.instructions_status === "stable"
    && appended.input_messages === 3,
  movedToolSetIsFlagged: toolsMoved.tools_status === "changed"
    && toolsMoved.instructions_status === "stable"
    && toolsMoved.tools_count === 1,
  // A reschema with identical names still moves the prefix; the name digest
  // stays put so the two causes are separable after the fact.
  reschemaSeparableFromRename: reschemad.tools_status === "changed"
    && reschemad.tool_names_digest === toolsMoved.tool_names_digest
    && reschemad.tools_digest !== toolsMoved.tools_digest,
  anthropicShape: anthropic.shape === "anthropic-messages"
    && anthropic.instructions_bytes > 0
    && anthropic.tools_count === 1
    && anthropic.input_messages === 1,
  legacyFunctionNesting: JSON.stringify(legacy.tool_names) === JSON.stringify(["nested_tool"]),
  // An unrecognised body still yields a total, which is the number that would
  // expose a provider shape this module has not learned yet.
  unknownShapeStillMeasured: unknownShape.shape === "unknown"
    && unknownShape.payload_bytes > 0
    && unknownShape.tools_count === 0
    && unknownShape.input_messages === 0
    && unknownShape.tools_status === "absent",
  hostileInputIsNull: circularResult === null && nullResult === null
    && undefinedResult === null && primitiveResult === null,
  killSwitch: offResult === null && envOff.enabled === false
    && envZero.enabled === false && envDefault.enabled === true,
  // Observation only: the body is not mutated, and no prompt text, message
  // content, or schema body is copied into the record.
  payloadUntouched: guardedBefore === guardedAfter && guardedReturn !== null,
  copiesNoContent: !serializedFirst.includes("守秘人")
    && !serializedFirst.includes("我推门")
    && !serializedFirst.includes("zzzz"),
  observeMsCounted: first.observe_ms > 0,
}, null, 2));
process.stdout.write("\n");
