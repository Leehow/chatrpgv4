#!/usr/bin/env node
/**
 * Component probe: Pi MCP client must surface toolbox error codes/messages.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"),
).href;

const {
  formatCanonicalToolFailure,
  formatMcpTransportError,
} = await import(runtimeUrl);

const cases = {
  pendingFinalization: formatCanonicalToolFailure(
    "coc_invoke",
    { isError: true },
    {
      ok: false,
      tool: "actions.advise",
      error: {
        code: "turn_pending_finalization",
        message: "state.journal already committed for this turn; finalize it before any further state mutation",
      },
    },
  ),
  journalBlocked: formatCanonicalToolFailure(
    "coc_invoke",
    { isError: true },
    {
      ok: false,
      error: {
        code: "turn_finalization_pending",
        message: "the previous journaled turn must be finalized or repaired before another turn can close",
      },
    },
  ),
  missingEnvelope: formatCanonicalToolFailure("coc_invoke", { isError: true }, null),
  opaqueOkOnly: formatCanonicalToolFailure(
    "coc_capabilities",
    { isError: false },
    { ok: false },
  ),
  transport: formatMcpTransportError({ code: -32000, message: "child died" }),
  transportMessageOnly: formatMcpTransportError({ message: "timeout" }),
  transportEmpty: formatMcpTransportError(null),
};

// Guard: never reintroduce the old opaque-only string as the sole message body
// when a toolbox code is available.
const asserts = {
  hasPendingCode: cases.pendingFinalization.includes("turn_pending_finalization"),
  hasPendingMessage: cases.pendingFinalization.includes("finalize it before"),
  hasJournalCode: cases.journalBlocked.includes("turn_finalization_pending"),
  notOpaqueOnlyWhenCoded: !/^canonical coc_invoke failed$/.test(cases.pendingFinalization),
  missingEnvelopeMentionsStructured: cases.missingEnvelope.includes("structuredContent"),
  transportHasCode: cases.transport.includes("-32000") && cases.transport.includes("child died"),
  transportMessage: cases.transportMessageOnly.includes("timeout"),
  transportFallback: cases.transportEmpty === "MCP request failed",
  keepsCanonicalPrefix: cases.pendingFinalization.startsWith("canonical coc_invoke failed"),
};

const ok = Object.values(asserts).every(Boolean);
process.stdout.write(JSON.stringify({ ok, cases, asserts }, null, 2) + "\n");
process.exit(ok ? 0 : 1);
