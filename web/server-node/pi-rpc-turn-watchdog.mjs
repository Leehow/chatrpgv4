/** Pi lifecycle events that prove the active agent turn is still advancing. */
const TURN_PROGRESS_EVENTS = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

export const DEFAULT_RPC_TURN_IDLE_TIMEOUT_MS = 180_000;

export class PiRpcTurnIdleWatchdog {
  constructor({
    timeoutMs = DEFAULT_RPC_TURN_IDLE_TIMEOUT_MS,
    now = Date.now,
  } = {}) {
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_RPC_TURN_IDLE_TIMEOUT_MS;
    this.now = now;
    this.lastProgressAt = now();
    this.activeTools = new Map();
    this.lastToolTerminal = null;
    this.finalizationObserved = false;
  }

  observe(event, { finalizationReceipt = false, canonicalToolEnvelope = null } = {}) {
    if (TURN_PROGRESS_EVENTS.has(event?.type)) {
      this.progress();
    }
    if (event?.type === "tool_execution_start") {
      const id = toolIdentity(event);
      this.activeTools.set(id, {
        tool_call_id: id,
        tool: toolName(event),
      });
    } else if (event?.type === "tool_execution_end") {
      const id = toolIdentity(event);
      this.activeTools.delete(id);
      this.lastToolTerminal = {
        tool_call_id: id,
        tool: toolName(event),
        outcome: toolTerminalOutcome(event, canonicalToolEnvelope),
        error_code: toolErrorCode(event, canonicalToolEnvelope),
      };
      if (finalizationReceipt) this.finalizationObserved = true;
    }
  }

  progress() {
    this.lastProgressAt = this.now();
  }

  expired() {
    return this.now() - this.lastProgressAt > this.timeoutMs;
  }

  diagnostics() {
    const active_tools = [...this.activeTools.values()]
      .sort((left, right) => left.tool_call_id.localeCompare(right.tool_call_id));
    let idle_classification = "pre_agent_or_no_tool_progress";
    if (active_tools.length > 0) {
      idle_classification = "tool_in_flight";
    } else if (this.lastToolTerminal?.outcome === "failure_or_rejection") {
      idle_classification = "tool_terminal_error";
    } else if (this.finalizationObserved) {
      idle_classification = "finalized_no_agent_settled";
    } else if (this.lastToolTerminal?.outcome === "success") {
      idle_classification = "post_tool_success_no_agent_settled";
    }
    return {
      idle_classification,
      active_tools,
      last_tool_terminal: this.lastToolTerminal,
      finalization_status: this.finalizationObserved ? "observed" : "absent",
    };
  }
}

function toolIdentity(event) {
  const value = event?.toolCallId ?? event?.tool_call_id;
  return typeof value === "string" && value ? value : "unidentified-tool-call";
}

function toolName(event) {
  const operation = event?.args?.operation;
  if (typeof operation === "string" && operation) return operation;
  const name = event?.toolName;
  return typeof name === "string" && name ? name : "unknown";
}

function structuredToolResult(event, canonicalToolEnvelope) {
  if (
    canonicalToolEnvelope
    && typeof canonicalToolEnvelope === "object"
    && typeof canonicalToolEnvelope.ok === "boolean"
  ) return canonicalToolEnvelope;
  const result = event?.result;
  if (!result || typeof result !== "object") return null;
  if (typeof result.ok === "boolean") return result;
  const details = result.details;
  return details && typeof details === "object" && typeof details.ok === "boolean"
    ? details
    : null;
}

function toolTerminalOutcome(event, canonicalToolEnvelope) {
  const result = structuredToolResult(event, canonicalToolEnvelope);
  if (event?.isError === true || result?.ok === false) return "failure_or_rejection";
  if (result?.ok === true || event?.isError === false) return "success";
  return "unknown";
}

function toolErrorCode(event, canonicalToolEnvelope) {
  const result = structuredToolResult(event, canonicalToolEnvelope);
  const code = result?.error?.code ?? event?.error?.code;
  return typeof code === "string" && code ? code : null;
}
