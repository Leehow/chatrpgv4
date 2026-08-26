import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Tool } from "@earendil-works/pi-ai";
import type { JsonObject } from "./runtime.ts";

export const STATE_CLAIM_HOST_FIELD = "state_claim_compilation";
export const STATE_CLAIM_FUNCTION = "emit_state_claim_compilation";
// Per-attempt semantic compilation deadline. Slow providers such as
// xai/grok-4.5 routinely exceed the previous 20s hard cap.
// Transient protocol/result-invalid output may retry once with a fresh
// deadline and typed validator feedback. Timeout, capability, provider,
// and canonical-authority rejections stay fail-closed without retry.
export const STATE_CLAIM_COMPILER_TIMEOUT_MS = 120_000;
export const STATE_CLAIM_COMPILER_TRANSIENT_RETRIES = 1;
export const STATE_CLAIM_KINDS = [
  "assets_liquidate", "cash", "condition", "item", "loaded_ammunition",
  "purchase", "rest", "scalar", "time", "time_appearance",
] as const;

const SYSTEM_PROMPT = [
  "You are a minimum-authority semantic compiler inside the Pi-Coc host.",
  "Review the exact player-visible draft as a whole and identify every assertion that a current player character's durable canonical state is now changed under one supplied claim kind.",
  "Exclude NPC-only state, conditional or future outcomes, unaccepted offers, and descriptions that do not assert a current PC state change.",
  "Interpret meaning across languages and paraphrases. Never classify by keyword, regex, or phrase lookup.",
  "Use minimal exact draft substrings. Match a candidate only when it denotes the same asserted state change.",
  "You have no prose-rewrite, plot, world, source-truth, mechanics, state-mutation, or finalization authority. Emit only the forced structured function call.",
].join(" ");

type RetainedContext = {
  campaignId: string;
  turnId: string;
  sourceDigest: string;
  expectedRevision: number;
  pcSubjectRefs: string[];
  settlementSnapshotId: string;
  mechanicsBundleSha256: string;
};

type InferenceOutcome = { result: JsonObject; responseModel: JsonObject };
export type StateClaimCompilerFailureClass =
  | "capability_unsupported"
  | "provider_unavailable"
  | "timeout"
  | "protocol_invalid"
  | "result_invalid";

export class PiStateClaimCompilerFailure extends Error {
  readonly failureClass: StateClaimCompilerFailureClass;
  readonly requestedModel: JsonObject | null;
  readonly elapsedMs: number;

  constructor(
    message: string,
    failureClass: StateClaimCompilerFailureClass,
    requestedModel: JsonObject | null,
    elapsedMs: number,
  ) {
    super(message);
    this.name = "PiStateClaimCompilerFailure";
    this.failureClass = failureClass;
    this.requestedModel = requestedModel;
    this.elapsedMs = Math.max(0, Math.round(elapsedMs));
  }
}
type InflightEntry = {
  controller: AbortController;
  promise: Promise<InferenceOutcome>;
};
type InferenceRuntime = {
  ctx: ExtensionContext;
  signal?: AbortSignal;
  timeoutMs?: number;
  correction?: string;
};
type Inference = (
  input: JsonObject,
  schema: JsonObject,
  runtime: InferenceRuntime,
) => Promise<InferenceOutcome>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as JsonObject;
    return `{${Object.keys(row).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(row[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_invalid`);
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}_invalid`);
  return value;
}

function exactKeys(value: JsonObject, keys: readonly string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label}_closed_schema_invalid`);
  }
}

function requiredToolChoice(api: string): "required" | "any" {
  if (new Set([
    "openai-completions", "openai-responses", "azure-openai-responses",
    "openai-codex-responses", "pi-messages", "mistral-conversations",
  ]).has(api)) return "required";
  if (new Set([
    "anthropic-messages", "bedrock-converse-stream",
    "google-generative-ai", "google-vertex",
  ]).has(api)) return "any";
  throw new Error("state_claim_model_api_unsupported");
}

function requestedModelIdentity(ctx: ExtensionContext): JsonObject | null {
  return ctx.model
    ? { provider: ctx.model.provider, id: ctx.model.id, api: ctx.model.api }
    : null;
}

function failureClass(message: string): StateClaimCompilerFailureClass {
  if (
    message === "state_claim_model_api_unsupported"
    || message.includes("requires JSON-schema constrained sampling")
    || message.includes("strict tools are unsupported")
  ) return "capability_unsupported";
  if (message === "state_claim_compiler_timeout") return "timeout";
  if (
    message.startsWith("state_claim_model_protocol_")
    || message.startsWith("state_claim_model_arguments_")
    || message.startsWith("state_claim_response_")
  ) return "protocol_invalid";
  if (
    message.startsWith("state_claim_result_")
    || message.startsWith("state_claim_coverage_")
  ) return "result_invalid";
  return "provider_unavailable";
}

function classifiedFailure(error: unknown): StateClaimCompilerFailureClass {
  if (error instanceof PiStateClaimCompilerFailure) return error.failureClass;
  const message = error instanceof Error && error.message
    ? error.message
    : "state_claim_compiler_unavailable";
  return failureClass(message);
}

function isTransientCompilerOutputFailure(error: unknown): boolean {
  const classified = classifiedFailure(error);
  return classified === "protocol_invalid" || classified === "result_invalid";
}

function correctionPrompt(error: unknown): string {
  const message = error instanceof Error && error.message
    ? error.message
    : "state_claim_compiler_unavailable";
  return [
    `Previous compilation was rejected by the host validator: ${message}.`,
    "Re-emit only the forced structured function call.",
    "Do not invent claims, receipts, subject refs, excerpts, or effect IDs.",
    "Satisfy the closed schema, identity, subject, excerpt, and coverage contract exactly.",
  ].join(" ");
}

function waiterOutcome(
  shared: Promise<InferenceOutcome>,
  signal?: AbortSignal,
): Promise<InferenceOutcome> {
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(new Error("state_claim_compiler_aborted"));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(new Error("state_claim_compiler_aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    shared.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

function responseModel(value: unknown): JsonObject {
  const row = object(value, "state_claim_response_model");
  exactKeys(row, ["provider", "id", "api"], "state_claim_response_model");
  return {
    provider: string(row.provider, "state_claim_response_provider"),
    id: string(row.id, "state_claim_response_model_id"),
    api: string(row.api, "state_claim_response_api"),
  };
}

export function draftParagraphs(draft: string): string[] {
  const paragraphs: string[] = [];
  let lines: string[] = [];
  for (const line of draft.split("\n")) {
    if (line.trim()) lines.push(line);
    else if (lines.length > 0) {
      paragraphs.push(lines.join("\n"));
      lines = [];
    }
  }
  if (lines.length > 0) paragraphs.push(lines.join("\n"));
  return paragraphs;
}

function loadDurableCompilation(
  ctx: ExtensionContext,
  campaignId: string,
  inputDigest: string,
  retained: RetainedContext,
): InferenceOutcome | null {
  const cwd = typeof ctx.cwd === "string" ? ctx.cwd : "";
  if (!cwd) return null;
  let text = "";
  try {
    text = readFileSync(
      join(cwd, ".coc", "campaigns", campaignId, "logs", "narration-reviews.jsonl"),
      "utf8",
    );
  } catch {
    return null;
  }
  const rows = text.split(/\r?\n/).filter((line) => line.trim());
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      const row = JSON.parse(rows[index]) as JsonObject;
      const compilation = row.state_claim_compilation;
      if (!compilation || typeof compilation !== "object" || Array.isArray(compilation)) {
        continue;
      }
      const receipt = compilation as JsonObject;
      if (
        receipt.status !== "completed"
        || receipt.semantic_input_digest !== inputDigest
      ) continue;
      const binding = receipt.binding;
      if (!binding || typeof binding !== "object" || Array.isArray(binding)) continue;
      const bound = binding as JsonObject;
      if (
        bound.turn_id !== retained.turnId
        || bound.source_digest !== retained.sourceDigest
        || bound.settlement_snapshot_id !== retained.settlementSnapshotId
        || bound.mechanics_bundle_sha256 !== retained.mechanicsBundleSha256
      ) continue;
      const result = receipt.result;
      const responseModelValue = receipt.response_model;
      if (!result || typeof result !== "object" || Array.isArray(result)) continue;
      if (
        !responseModelValue
        || typeof responseModelValue !== "object"
        || Array.isArray(responseModelValue)
      ) continue;
      return {
        result: result as JsonObject,
        responseModel: responseModelValue as JsonObject,
      };
    } catch {
      continue;
    }
  }
  return null;
}

function candidateClaims(review: JsonObject): JsonObject[] {
  const claims = Array.isArray(review.claims) ? review.claims : [];
  return claims.map((value) => {
    const claim = object(value, "candidate_claim");
    return {
      claim_id: string(claim.claim_id, "candidate_claim_id"),
      subject_ref: string(claim.subject_ref, "candidate_subject_ref"),
      claim_kind: string(claim.claim_kind, "candidate_claim_kind"),
      exact_excerpt: string(claim.exact_excerpt, "candidate_exact_excerpt"),
    };
  }).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function resultSchema(input: JsonObject): JsonObject {
  const pcRefs = input.pc_subject_refs as string[];
  const candidates = input.candidate_claims as JsonObject[];
  const candidateIds = candidates.map((row) => row.claim_id as string);
  return {
    type: "object", additionalProperties: false,
    properties: {
      schema_version: { type: "integer", const: 1 },
      contract_id: { type: "string", const: "coc.pi-state-claim-compiler-result.v1" },
      disposition: { type: "string", enum: ["no_claims_detected", "claims_detected"] },
      reason: { type: "string", minLength: 1, maxLength: 600 },
      claims: {
        type: "array", maxItems: 64,
        items: {
          type: "object", additionalProperties: false,
          properties: {
            subject_ref: { type: "string", enum: pcRefs },
            claim_kind: { type: "string", enum: [...STATE_CLAIM_KINDS] },
            exact_excerpt: { type: "string", minLength: 1 },
            matched_review_claim_id: candidateIds.length > 0
              ? { anyOf: [{ type: "string", enum: candidateIds }, { type: "null" }] }
              : { type: "null" },
            reason: { type: "string", minLength: 1, maxLength: 600 },
          },
          required: ["subject_ref", "claim_kind", "exact_excerpt", "matched_review_claim_id", "reason"],
        },
      },
      paragraph_coverage: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            paragraph_index: { type: "integer", minimum: 0 },
            paragraph_sha256: { type: "string", minLength: 71, maxLength: 71 },
            claim_indices: { type: "array", items: { type: "integer", minimum: 0 } },
          },
          required: ["paragraph_index", "paragraph_sha256", "claim_indices"],
        },
      },
    },
    required: ["schema_version", "contract_id", "disposition", "reason", "claims", "paragraph_coverage"],
  };
}

function validateResult(raw: unknown, input: JsonObject): JsonObject {
  const result = object(raw, "state_claim_result");
  exactKeys(result, ["schema_version", "contract_id", "disposition", "reason", "claims", "paragraph_coverage"], "state_claim_result");
  if (result.schema_version !== 1 || result.contract_id !== "coc.pi-state-claim-compiler-result.v1") throw new Error("state_claim_result_identity_invalid");
  const claims = Array.isArray(result.claims) ? result.claims : null;
  if (claims === null) throw new Error("state_claim_result_shape_invalid");
  const resultReason = string(result.reason, "state_claim_result_reason");
  if (resultReason.length > 600 || claims.length > 64) throw new Error("state_claim_result_bounds_invalid");
  const disposition = result.disposition;
  if (!new Set(["claims_detected", "no_claims_detected"]).has(String(disposition))
      || ((disposition === "claims_detected") !== (claims.length > 0))) throw new Error("state_claim_result_disposition_invalid");
  const draft = input.draft_text as string;
  const pcRefs = new Set(input.pc_subject_refs as string[]);
  const candidates = new Map((input.candidate_claims as JsonObject[]).map((row) => [row.claim_id as string, row]));
  const seen = new Set<string>();
  const matchedCandidateIds = new Set<string>();
  const normalizedClaims = claims.map((value, index) => {
    const claim = object(value, `state_claim_result_claim_${index}`);
    exactKeys(claim, ["subject_ref", "claim_kind", "exact_excerpt", "matched_review_claim_id", "reason"], `state_claim_result_claim_${index}`);
    const subject = string(claim.subject_ref, "state_claim_subject_ref");
    const kind = string(claim.claim_kind, "state_claim_kind");
    const excerpt = string(claim.exact_excerpt, "state_claim_excerpt");
    const reason = string(claim.reason, "state_claim_reason");
    if (reason.length > 600 || !pcRefs.has(subject) || !(STATE_CLAIM_KINDS as readonly string[]).includes(kind) || !draft.includes(excerpt)) throw new Error("state_claim_result_value_invalid");
    const matched = claim.matched_review_claim_id;
    if (matched !== null) {
      const candidate = typeof matched === "string" ? candidates.get(matched) : undefined;
      if (!candidate || candidate.subject_ref !== subject || candidate.claim_kind !== kind || matchedCandidateIds.has(matched)) throw new Error("state_claim_result_match_invalid");
      matchedCandidateIds.add(matched);
    }
    const identity = stableJson([subject, kind, excerpt, matched]);
    if (seen.has(identity)) throw new Error("state_claim_result_duplicate");
    seen.add(identity);
    return {
      compiler_claim_id: `compiled:${canonicalDigest([subject, kind, excerpt, matched]).slice(7, 47)}`,
      subject_ref: subject,
      claim_kind: kind,
      exact_excerpt: excerpt,
      matched_review_claim_id: matched,
      reason,
    };
  });
  const paragraphs = draftParagraphs(draft);
  if (!Array.isArray(result.paragraph_coverage) || result.paragraph_coverage.length !== paragraphs.length) throw new Error("state_claim_coverage_incomplete");
  const covered = new Set<number>();
  const coverage = result.paragraph_coverage.map((value, index) => {
    const row = object(value, `state_claim_coverage_${index}`);
    exactKeys(row, ["paragraph_index", "paragraph_sha256", "claim_indices"], `state_claim_coverage_${index}`);
    if (row.paragraph_index !== index || row.paragraph_sha256 !== canonicalDigest(paragraphs[index]) || !Array.isArray(row.claim_indices)) throw new Error("state_claim_coverage_invalid");
    const indices = row.claim_indices.map((rawIndex) => {
      const claimIndex = Number(rawIndex);
      if (!Number.isInteger(rawIndex) || claimIndex < 0 || claimIndex >= normalizedClaims.length || covered.has(claimIndex)) throw new Error("state_claim_coverage_claim_invalid");
      if (!paragraphs[index].includes(normalizedClaims[claimIndex].exact_excerpt)) throw new Error("state_claim_coverage_excerpt_invalid");
      covered.add(claimIndex);
      return claimIndex;
    });
    return { paragraph_index: index, paragraph_sha256: row.paragraph_sha256, claim_indices: indices };
  });
  if (covered.size !== normalizedClaims.length) throw new Error("state_claim_coverage_incomplete");
  return { ...result, claims: normalizedClaims, paragraph_coverage: coverage };
}

async function directInference(
  input: JsonObject,
  schema: JsonObject,
  runtime: InferenceRuntime,
): Promise<InferenceOutcome> {
  const model = runtime.ctx.model;
  if (!model) throw new Error("state_claim_model_unavailable");
  const tool: Tool = {
    name: STATE_CLAIM_FUNCTION,
    description: "Return the closed semantic state-claim compilation.",
    parameters: schema as Tool["parameters"],
    constrainedSampling: { type: "json_schema", strict: "prefer" },
  };
  const messages: Array<{
    role: "user";
    content: Array<{ type: "text"; text: string }>;
    timestamp: number;
  }> = [
    { role: "user", content: [{ type: "text", text: stableJson(input) }], timestamp: Date.now() },
  ];
  if (runtime.correction) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: runtime.correction }],
      timestamp: Date.now(),
    });
  }
  const response = await runtime.ctx.modelRegistry.complete(
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages,
      tools: [tool],
    },
    {
      signal: runtime.signal,
      timeoutMs: runtime.timeoutMs ?? STATE_CLAIM_COMPILER_TIMEOUT_MS,
      maxRetries: 0, maxTokens: 1024,
      cacheRetention: "none", sessionId: randomUUID(),
      toolChoice: requiredToolChoice(model.api),
    },
  );
  const ordinary = response.content.filter((part) => part.type === "text" && part.text.trim());
  const calls = response.content.filter((part) => part.type === "toolCall");
  if (response.stopReason !== "toolUse" || ordinary.length > 0 || calls.length !== 1 || calls[0].name !== STATE_CLAIM_FUNCTION) throw new Error("state_claim_model_protocol_invalid");
  return {
    result: object(calls[0].arguments, "state_claim_model_arguments"),
    responseModel: responseModel({
      provider: response.provider, id: response.model, api: response.api,
    }),
  };
}

export class PiStateClaimCompiler {
  private readonly infer: Inference;
  private readonly timeoutMs: number;
  private readonly retained = new Map<string, RetainedContext>();
  private readonly inflight = new Map<string, InflightEntry>();
  private readonly cache = new Map<string, InferenceOutcome>();
  private readonly failures = new Map<string, PiStateClaimCompilerFailure>();
  private failureGeneration = 0;

  constructor(infer: Inference = directInference, timeoutMs = STATE_CLAIM_COMPILER_TIMEOUT_MS) {
    this.infer = infer;
    this.timeoutMs = timeoutMs;
  }

  observeOutputContext(campaignId: string, envelopeValue: unknown): void {
    const envelope = object(envelopeValue, "output_context_envelope");
    if (envelope.ok !== true || envelope.tool !== "turn.output_context") return;
    const data = object(envelope.data, "output_context_data");
    const operation = object(data.agency_review_operation, "agency_review_operation");
    const prefilled = object(operation.prefilled_arguments, "agency_review_prefilled");
    const contractProjection = object(data.contract_projection, "contract_projection");
    const agencyAuthority = object(contractProjection.agency_authority, "agency_authority");
    const refs = Array.isArray(agencyAuthority.pc_subject_refs)
      ? agencyAuthority.pc_subject_refs.map((ref) => string(ref, "state_claim_subject_ref")).sort()
      : [];
    const expectedRevision = Number(prefilled.revision);
    if (!campaignId || refs.length === 0 || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error("state_claim_compiler_context_invalid");
    }
    this.retained.set(campaignId, {
      campaignId,
      turnId: string(data.turn_id, "turn_id"),
      sourceDigest: string(data.source_digest, "source_digest"),
      expectedRevision,
      pcSubjectRefs: refs,
      settlementSnapshotId: string(data.settlement_snapshot_id, "settlement_snapshot_id"),
      mechanicsBundleSha256: string(data.mechanics_bundle_sha256, "mechanics_bundle_sha256"),
    });
  }

  beginExternalTurn(): void {
    this.failureGeneration += 1;
    this.failures.clear();
  }

  releaseLatchedFailure(campaignId: string, turnId: string): boolean {
    if (!campaignId || !turnId) return false;
    return this.failures.delete(canonicalDigest({
      failure_generation: this.failureGeneration,
      campaign_id: campaignId,
      turn_id: turnId,
    }));
  }

  private rememberFailure(
    key: string,
    error: unknown,
    generation: number,
    requestedModel: JsonObject | null,
    startedAt: number,
  ): never {
    const message = error instanceof Error && error.message
      ? error.message : "state_claim_compiler_unavailable";
    const failure = error instanceof PiStateClaimCompilerFailure
      ? error
      : new PiStateClaimCompilerFailure(
          message,
          failureClass(message),
          requestedModel,
          Date.now() - startedAt,
        );
    if (generation === this.failureGeneration) {
      this.failures.set(key, failure);
      if (this.failures.size > 64) this.failures.delete(this.failures.keys().next().value!);
    }
    throw failure;
  }

  private async runInferenceAttempts(
    input: JsonObject,
    entry: InflightEntry,
    ctx: ExtensionContext,
    failureGeneration: number,
  ): Promise<InferenceOutcome> {
    let correction: string | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= STATE_CLAIM_COMPILER_TRANSIENT_RETRIES; attempt++) {
      if (attempt > 0 && failureGeneration !== this.failureGeneration) {
        throw lastError instanceof Error
          ? lastError
          : new Error("state_claim_compiler_session_cleared");
      }
      const controller = new AbortController();
      entry.controller = controller;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutFailure = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort("state_claim_compiler_timeout");
          reject(new Error("state_claim_compiler_timeout"));
        }, this.timeoutMs);
      });
      try {
        return await Promise.race([
          this.infer(input, resultSchema(input), {
            ctx,
            signal: controller.signal,
            timeoutMs: this.timeoutMs,
            correction,
          }).then((outcome) => ({
            result: validateResult(outcome.result, input),
            responseModel: responseModel(outcome.responseModel),
          })),
          timeoutFailure,
        ]);
      } catch (error) {
        lastError = error;
        if (
          attempt >= STATE_CLAIM_COMPILER_TRANSIENT_RETRIES
          || failureGeneration !== this.failureGeneration
          || !isTransientCompilerOutputFailure(error)
        ) {
          throw error;
        }
        correction = correctionPrompt(error);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("state_claim_compiler_unavailable");
  }

  async compileReview(options: {
    campaignId: string;
    arguments: JsonObject;
    ctx: ExtensionContext;
    signal?: AbortSignal;
    sessionEpoch: number;
    isCurrent(epoch: number): boolean;
  }): Promise<JsonObject> {
    const retained = this.retained.get(options.campaignId);
    if (!retained) throw new Error("state_claim_compiler_context_missing");
    const args = options.arguments;
    const draft = string(args.draft_text, "draft_text");
    const revision = Number(args.revision);
    if (retained.turnId !== args.turn_id || retained.sourceDigest !== args.source_digest || retained.expectedRevision !== revision) throw new Error("state_claim_compiler_context_missing");
    const review = object(args.state_authority_review, "state_authority_review");
    const candidates = candidateClaims(review);
    const paragraphs = draftParagraphs(draft).map((text, index) => ({ paragraph_index: index, paragraph_sha256: canonicalDigest(text) }));
    const input: JsonObject = {
      schema_version: 1, contract_id: "coc.pi-state-claim-compiler-input.v1",
      draft_text: draft, pc_subject_refs: retained.pcSubjectRefs,
      candidate_claims: candidates, paragraphs,
    };
    const inputDigest = canonicalDigest(input);
    const failureGeneration = this.failureGeneration;
    const failureKey = canonicalDigest({
      failure_generation: failureGeneration,
      campaign_id: retained.campaignId,
      turn_id: retained.turnId,
    });
    const latchedFailure = this.failures.get(failureKey);
    if (latchedFailure) throw latchedFailure;
    let compiled = this.cache.get(inputDigest);
    if (!compiled) {
      const durable = loadDurableCompilation(
        options.ctx, options.campaignId, inputDigest, retained,
      );
      if (durable) {
        compiled = durable;
        this.cache.set(inputDigest, durable);
      }
    }
    if (!compiled) {
      let entry = this.inflight.get(inputDigest);
      if (!entry) {
        const startedAt = Date.now();
        const requestedModel = requestedModelIdentity(options.ctx);
        entry = {
          controller: new AbortController(),
          promise: Promise.resolve({} as InferenceOutcome),
        };
        const ownedEntry = entry;
        entry.promise = this.runInferenceAttempts(
          input, ownedEntry, options.ctx, failureGeneration,
        ).catch((error) => this.rememberFailure(
          failureKey, error, failureGeneration, requestedModel, startedAt,
        )).finally(() => {
          if (this.inflight.get(inputDigest) === ownedEntry) {
            this.inflight.delete(inputDigest);
          }
        });
        this.inflight.set(inputDigest, entry);
      }
      compiled = await waiterOutcome(entry.promise, options.signal);
      if (!options.isCurrent(options.sessionEpoch)) throw new Error("state_claim_compiler_epoch_stale");
      this.cache.set(inputDigest, compiled);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    }
    if (!options.isCurrent(options.sessionEpoch)) throw new Error("state_claim_compiler_epoch_stale");
    const result = compiled.result;
    const binding = {
      turn_id: retained.turnId, source_digest: retained.sourceDigest, revision,
      draft_sha256: canonicalDigest(draft), kp_review_digest: canonicalDigest(review),
      settlement_snapshot_id: retained.settlementSnapshotId,
      mechanics_bundle_sha256: retained.mechanicsBundleSha256,
    };
    const requestedModel = requestedModelIdentity(options.ctx);
    const receipt: JsonObject = {
      schema_version: 1, contract_id: "coc.pi-state-claim-compilation-receipt.v1",
      status: "completed", compiler_contract_id: "coc.pi-state-claim-compiler.v1",
      requested_model: requestedModel, response_model: compiled.responseModel,
      semantic_input_digest: inputDigest, semantic_result_digest: canonicalDigest(result),
      binding, result,
    };
    receipt.binding_digest = canonicalDigest(receipt);
    return receipt;
  }

  clear(): void {
    this.failureGeneration += 1;
    for (const entry of this.inflight.values()) {
      entry.controller.abort("state_claim_compiler_session_cleared");
    }
    this.retained.clear();
    this.inflight.clear();
    this.cache.clear();
    this.failures.clear();
  }
}
