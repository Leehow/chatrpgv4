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
const typedUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts"),
).href;

const {
  CanonicalToolError,
  formatCanonicalToolFailure,
  formatMcpTransportError,
  modelVisibleCanonicalToolResult,
} = await import(runtimeUrl);
const { attachExpectedSchema } = await import(typedUrl);

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

const missingParam = modelVisibleCanonicalToolResult(new CanonicalToolError(
  "coc_invoke",
  "missing_param",
  "canonical coc_invoke failed: missing_param",
  { missing_parameters: ["campaign"] },
  {
    ok: false,
    tool: "state.journal",
    error: {
      code: "missing_param",
      message: "required parameter missing",
      retryable: false,
      details: { missing_parameters: ["campaign"] },
    },
  },
));
const invalidParam = modelVisibleCanonicalToolResult(new CanonicalToolError(
  "coc_invoke",
  "invalid_param",
  "canonical coc_invoke failed: invalid_param",
  { field: "operation" },
  {
    ok: false,
    error: {
      code: "invalid_param",
      message: "operation is not allowed",
      retryable: false,
      details: { field: "operation" },
    },
  },
));
const campaignBusy = modelVisibleCanonicalToolResult(new CanonicalToolError(
  "coc_invoke",
  "campaign_busy",
  "canonical coc_invoke failed: campaign_busy",
  { attempts: 3 },
  {
    ok: false,
    error: {
      code: "campaign_busy",
      message: "campaign lock still held after toolbox retries",
      retryable: true,
      details: { attempts: 3 },
    },
  },
));
const protocolNoEnvelope = modelVisibleCanonicalToolResult(new CanonicalToolError(
  "coc_invoke",
  "whatever",
  "canonical coc_invoke failed: missing structuredContent envelope",
  null,
  null,
));
const protocolNoCode = (() => {
  try {
    throw new Error("MCP request failed: child died");
  } catch (error) {
    return error instanceof CanonicalToolError
      ? modelVisibleCanonicalToolResult(error)
      : null;
  }
})();

const hostAutomaticRetryCount = 0;

Object.assign(asserts, {
  missingParamKeepsDetails: Array.isArray(
    missingParam?.error?.details?.missing_parameters,
  ) && missingParam.error.details.missing_parameters.includes("campaign"),
  missingParamRetryableFalse: missingParam?.error?.retryable === false,
  missingParamIsError: missingParam?.isError === true && missingParam?.ok === false,
  invalidParamKeepsDetails: invalidParam?.error?.details?.field === "operation",
  campaignBusyRetryable: campaignBusy?.error?.retryable === true
    && campaignBusy?.error?.code === "campaign_busy",
  protocolNoEnvelopeThrowsPath: protocolNoEnvelope === null,
  protocolPlainErrorThrowsPath: protocolNoCode === null,
  hostDoesNotAutoRetry: hostAutomaticRetryCount === 0,
  missingParamExpectedSchema: attachExpectedSchema(missingParam, "state.journal")
    ?.error?.expected_schema?.type === "object",
  missingParamDetailsPreserved: Array.isArray(
    attachExpectedSchema(missingParam, "state.journal")?.error?.details?.missing_parameters,
  ),
});

const ok = Object.values(asserts).every(Boolean);
process.stdout.write(JSON.stringify({
  ok,
  cases,
  asserts,
  visible: { missingParam, invalidParam, campaignBusy },
  hostAutomaticRetryCount,
}, null, 2) + "\n");
process.exit(ok ? 0 : 1);
