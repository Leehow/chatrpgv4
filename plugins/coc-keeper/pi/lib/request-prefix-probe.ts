/**
 * Request prefix probe — observation only, on the real provider request body.
 *
 * `lib/context-probe.ts` measures the message array pi hands to the provider
 * adapter. That is *not* what the provider bills. Measured on the
 * `dirgraph-smoke-20260901` play session, the first model call of a fresh
 * `pi` process carried a 717-char transcript (180 `est_tokens`) while the
 * provider billed 33,000 tokens for the same call: everything above the
 * transcript — the system prompt, the advertised tool definitions, and the
 * provider's own scaffolding — is invisible to the message-array probe.
 * Roughly 18k of those 33k tokens could not be attributed at all from the
 * preserved evidence, because the request body is recorded nowhere:
 * `rpc-wire.jsonl` carries RPC framing only, and the first
 * `coc-tool-working-set` audit entry of a session is emitted *after* the first
 * model call, so the tool set actually advertised on that call was unknowable.
 *
 * pi's `before_provider_request` event carries the fully assembled provider
 * params object — `instructions` + `tools` + `input` for the
 * `openai-responses` adapter, `system` + `tools` + `messages` for
 * `anthropic-messages` — immediately before the HTTP call. That is the only
 * place the whole prefix exists in one object, so it is where this module
 * measures.
 *
 * Three rules keep this an observation and not a behaviour change:
 *
 * 1. **Nothing is returned.** The caller must discard this module's output
 *    from the event handler; a `before_provider_request` handler that returns
 *    a value *replaces* the payload. This module never produces a payload.
 * 2. **Nothing is copied.** Only byte counts, tool names, and digests are
 *    recorded. No prompt text, no message content, no tool schema bodies
 *    reach the telemetry log, and nothing reaches the model.
 * 3. **Nothing throws.** A malformed or unserializable payload yields `null`,
 *    and the caller keeps going.
 *
 * What it settles that post-hoc analysis could not:
 *
 * - the exact advertised tool list and its byte cost **on every call**,
 *   including the first, next to that call's `usage.cacheRead` in the same
 *   telemetry step — so "tool set moved ⇒ cache miss" becomes a measured
 *   per-call fact rather than a correlation across two files;
 * - the system-prompt byte count as the provider received it, rather than
 *   reconstructed from `session-roles.json`;
 * - `other_bytes`, the part of the request that is neither prompt nor tools
 *   nor transcript — the residual that the 18k-token gap has to live in.
 */
import { createHash } from "node:crypto";

/** Short digest: collisions are irrelevant, this only answers "did it move". */
function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export type RequestSectionStatus = "first" | "stable" | "changed" | "absent";

/** Per-tool advertised cost. Names only — schema bodies are never copied. */
export type AdvertisedToolCost = {
  name: string;
  bytes: number;
};

export type RequestPrefixProbe = {
  /** Which request shape was recognised; `unknown` still yields payload_bytes. */
  shape: "openai-responses" | "anthropic-messages" | "unknown";
  /** Serialized size of the whole provider request body. */
  payload_bytes: number;
  /** System prompt / `instructions`, as the provider received it. */
  instructions_bytes: number;
  instructions_digest: string | null;
  instructions_status: RequestSectionStatus;
  /** Advertised tool definitions — the field whose churn breaks prefix cache. */
  tools_count: number;
  tools_bytes: number;
  tools_digest: string | null;
  /** Digest over the tool *names* only, so a rename is separable from a reschema. */
  tool_names_digest: string | null;
  tool_names: readonly string[];
  tools_status: RequestSectionStatus;
  /** Per-tool bytes, largest first. Bounded by the working-set budget. */
  tools: readonly AdvertisedToolCost[];
  /** Transcript array actually sent (post-fold, post-`context` handlers). */
  input_messages: number;
  input_bytes: number;
  /**
   * `payload_bytes` minus the three sections above. Absorbs key names, commas,
   * and every remaining request field (model id, sampling, reasoning config,
   * tool_choice, cache directives). This is the residual the unattributed
   * prefix tokens have to come out of.
   */
  other_bytes: number;
  /** Probe cost, so an observation hook can never hide its own price. */
  observe_ms: number;
};

export type RequestPrefixProbeSettings = { enabled: boolean };

export function readRequestPrefixProbeSettings(
  env: Record<string, string | undefined> = process.env,
): RequestPrefixProbeSettings {
  const raw = (env.PI_COC_REQUEST_PREFIX_PROBE ?? "").trim().toLowerCase();
  return { enabled: raw !== "off" && raw !== "0" && raw !== "false" };
}

function serialize(value: unknown): string | null {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? encoded : null;
  } catch {
    return null;
  }
}

function byteLength(value: string | null): number {
  return value === null ? 0 : Buffer.byteLength(value, "utf8");
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Tool name as the provider request carries it. `openai-responses` flattens a
 * function tool to `{type, name, parameters}`; `anthropic-messages` keeps
 * `{name, input_schema}`; older `function` nesting is still seen in the wild.
 */
function toolNameOf(tool: unknown): string {
  const record = tool as { name?: unknown; function?: { name?: unknown } } | null;
  const direct = stringOrNull(record?.name);
  if (direct !== null) return direct;
  const nested = stringOrNull(record?.function?.name);
  return nested ?? "";
}

type SectionState = { digest: string | null };

export type RequestPrefixProbeObserver = {
  /** Measure one provider request body. Never mutates and never returns it. */
  observe(payload: unknown): RequestPrefixProbe | null;
};

export function createRequestPrefixProbe(
  options: {
    now?: () => number;
    settings?: RequestPrefixProbeSettings;
  } = {},
): RequestPrefixProbeObserver {
  const now = options.now ?? performance.now.bind(performance);
  const settings = options.settings ?? readRequestPrefixProbeSettings();
  const previousInstructions: SectionState = { digest: null };
  const previousTools: SectionState = { digest: null };
  let seenCall = false;

  const statusOf = (
    state: SectionState,
    next: string | null,
  ): RequestSectionStatus => {
    if (next === null) return "absent";
    if (!seenCall || state.digest === null) return "first";
    return state.digest === next ? "stable" : "changed";
  };

  return {
    observe(payload: unknown): RequestPrefixProbe | null {
      if (!settings.enabled) return null;
      const startedAt = now();
      try {
        const body = payload as Record<string, unknown> | null;
        if (body === null || typeof body !== "object") return null;

        const encodedPayload = serialize(body);
        if (encodedPayload === null) return null;

        // `instructions` is openai-responses; `system` is anthropic-messages,
        // where it may be a content-part array rather than a bare string.
        const instructionsValue = body.instructions ?? body.system;
        const encodedInstructions = instructionsValue === undefined
          ? null
          : typeof instructionsValue === "string"
            ? instructionsValue
            : serialize(instructionsValue);

        const toolsValue = Array.isArray(body.tools) ? body.tools : null;
        const encodedTools = toolsValue === null ? null : serialize(toolsValue);
        const toolNames = (toolsValue ?? []).map(toolNameOf);
        const perTool = (toolsValue ?? [])
          .map((tool, index) => ({
            name: toolNames[index],
            bytes: byteLength(serialize(tool)),
          }))
          .sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name));

        const inputValue = Array.isArray(body.input)
          ? body.input
          : Array.isArray(body.messages)
            ? body.messages
            : null;
        const encodedInput = inputValue === null ? null : serialize(inputValue);

        const shape: RequestPrefixProbe["shape"] = Array.isArray(body.input)
          ? "openai-responses"
          : Array.isArray(body.messages)
            ? "anthropic-messages"
            : "unknown";

        const instructionsDigest = encodedInstructions === null
          ? null
          : digest(encodedInstructions);
        const toolsDigest = encodedTools === null ? null : digest(encodedTools);
        const instructionsStatus = statusOf(previousInstructions, instructionsDigest);
        const toolsStatus = statusOf(previousTools, toolsDigest);
        previousInstructions.digest = instructionsDigest;
        previousTools.digest = toolsDigest;
        seenCall = true;

        const payloadBytes = byteLength(encodedPayload);
        const instructionsBytes = byteLength(encodedInstructions);
        const toolsBytes = byteLength(encodedTools);
        const inputBytes = byteLength(encodedInput);

        return {
          shape,
          payload_bytes: payloadBytes,
          instructions_bytes: instructionsBytes,
          instructions_digest: instructionsDigest,
          instructions_status: instructionsStatus,
          tools_count: toolNames.length,
          tools_bytes: toolsBytes,
          tools_digest: toolsDigest,
          tool_names_digest: toolsValue === null
            ? null
            : digest(JSON.stringify(toolNames)),
          tool_names: toolNames,
          tools_status: toolsStatus,
          tools: perTool,
          input_messages: inputValue?.length ?? 0,
          input_bytes: inputBytes,
          other_bytes: Math.max(
            0,
            payloadBytes - instructionsBytes - toolsBytes - inputBytes,
          ),
          observe_ms: Math.max(0, now() - startedAt),
        };
      } catch {
        // An observation must never cost a call.
        return null;
      }
    },
  };
}
