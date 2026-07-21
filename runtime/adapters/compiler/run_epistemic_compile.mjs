#!/usr/bin/env node
/** Minimum-privilege semantic compiler for epistemic scenario sidecars. */
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  AuthStorage, createAgentSession, createExtensionRuntime, DefaultResourceLoader,
  ModelRegistry, SessionManager, defineTool, getAgentDir,
} from "@earendil-works/pi-coding-agent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(
  path.join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json"),
);
const { Type } = require("typebox");
const CONTRACT_PATH = process.env.COC_EPISTEMIC_CONTRACT_PATH ?? path.resolve(
  __dirname, "../../../plugins/coc-keeper/scripts/epistemic-contract.json",
);
export const EPISTEMIC_CONTRACT = Object.freeze(
  JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8")),
);
export const RESULT_ROOT_KEYS = Object.freeze([...EPISTEMIC_CONTRACT.ordered_root_keys]);
export const RESULT_DOCUMENT_KEYS = Object.freeze([...EPISTEMIC_CONTRACT.document_keys]);

const SYSTEM_PROMPT =
  "You are the Keeper-only epistemic compiler for a Call of Cthulhu runtime. " +
  "The request is a minimum-privilege structured projection: it contains IDs, enums, " +
  "player-safe summaries, and source locators, never raw source text or Keeper agenda prose. " +
  "Infer belief questions and evidence relationships from the structured scenario as a whole. " +
  "Never classify by fixed keyword hits, invent module truth, or copy prose. " +
  "Return the exact provenance-bound result through coc_submit_epistemic_result.";

const MAX_DIAGNOSTIC_KEYS = 32;
const MAX_KEY_BYTES = 128;

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(chunks.join(""))); }
      catch { reject(new Error("invalid_stdin_json")); }
    });
    process.stdin.on("error", reject);
  });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeKeyNames(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).slice(0, MAX_DIAGNOSTIC_KEYS).map((key) => {
    const bytes = Buffer.from(key, "utf8");
    return bytes.length <= MAX_KEY_BYTES
      ? key
      : bytes.subarray(0, MAX_KEY_BYTES).toString("utf8").replace(/\uFFFD$/u, "");
  }).sort();
}

function unexpectedKeyEvidence(value, expected) {
  const names = safeKeyNames(value).filter((key) => !expected.includes(key));
  return {
    unexpected_key_count: names.length,
    unexpected_key_sha256: names.map((key) =>
      crypto.createHash("sha256").update(Buffer.from(key, "utf8")).digest("hex"),
    ),
  };
}

function rejectedFingerprint(value) {
  let encoded;
  try { encoded = Buffer.from(stableJson(value), "utf8"); }
  catch { encoded = Buffer.from("<unserializable>", "utf8"); }
  return {
    rejected_result_sha256: crypto.createHash("sha256").update(encoded).digest("hex"),
    rejected_result_bytes: encoded.length,
  };
}

function rejection(errorCode, result, requestSha, modelIdentity, extra = {}) {
  return {
    schema_version: 1,
    phase: "epistemic_compile",
    error_code: errorCode,
    diagnostic_subject: "rejected_result",
    epistemic_request_sha256: requestSha,
    expected_key_names: [...RESULT_ROOT_KEYS].sort(),
    present_expected_key_names: safeKeyNames(result).filter((key) => RESULT_ROOT_KEYS.includes(key)),
    missing_key_names: [],
    ...unexpectedKeyEvidence(result, RESULT_ROOT_KEYS),
    ...rejectedFingerprint(result),
    model_identity: modelIdentity,
    ...extra,
  };
}

function protocolDiagnostic(errorCode, requestSha, modelIdentity, extra = {}) {
  return {
    schema_version: 1,
    phase: "epistemic_compile",
    error_code: errorCode,
    diagnostic_subject: "none",
    epistemic_request_sha256: requestSha,
    expected_key_names: [...RESULT_ROOT_KEYS].sort(),
    present_expected_key_names: [],
    missing_key_names: [],
    unexpected_key_count: 0,
    unexpected_key_sha256: [],
    model_identity: modelIdentity,
    ...extra,
  };
}

function neutralResult(requestSha) {
  return {
    schema_version: EPISTEMIC_CONTRACT.schema_version,
    evaluator_id: EPISTEMIC_CONTRACT.evaluator_id,
    evaluation_provenance: {
      kind: EPISTEMIC_CONTRACT.provenance.kind,
      request_sha256: requestSha,
      reviewed_artifact: EPISTEMIC_CONTRACT.provenance.reviewed_artifact,
    },
    epistemic_graph: {},
    reveal_contracts: {},
    compile_confidence: {},
    reasons: {},
  };
}

export function buildResultParameters(requestSha) {
  const openDocument = Type.Object({}, { additionalProperties: true });
  const provenance = Type.Object({
    kind: Type.Literal(EPISTEMIC_CONTRACT.provenance.kind),
    request_sha256: Type.Literal(requestSha),
    reviewed_artifact: Type.Literal(EPISTEMIC_CONTRACT.provenance.reviewed_artifact),
  }, { additionalProperties: false });
  return Type.Object({
    schema_version: Type.Literal(EPISTEMIC_CONTRACT.schema_version),
    evaluator_id: Type.Literal(EPISTEMIC_CONTRACT.evaluator_id),
    evaluation_provenance: provenance,
    epistemic_graph: openDocument,
    reveal_contracts: openDocument,
    compile_confidence: openDocument,
    reasons: openDocument,
  }, { additionalProperties: false });
}

export function validateResult(result, requestSha, modelIdentity = null) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw rejection("compile_result_root_type_invalid", result, requestSha, modelIdentity);
  }
  const expected = [...RESULT_ROOT_KEYS].sort();
  const actual = Object.keys(result).sort();
  const missing = expected.filter((key) => !Object.hasOwn(result, key));
  const unexpected = actual.filter((key) => !RESULT_ROOT_KEYS.includes(key));
  if (missing.length || unexpected.length) {
    throw rejection("compile_result_root_keys_mismatch", result, requestSha, modelIdentity, {
      missing_key_names: missing,
      ...unexpectedKeyEvidence(result, RESULT_ROOT_KEYS),
    });
  }
  if (result.schema_version !== EPISTEMIC_CONTRACT.schema_version ||
      result.evaluator_id !== EPISTEMIC_CONTRACT.evaluator_id) {
    throw rejection("compile_result_identity_invalid", result, requestSha, modelIdentity);
  }
  const provenance = result.evaluation_provenance;
  const expectedProvenance = [...EPISTEMIC_CONTRACT.provenance.ordered_keys].sort();
  const actualProvenance = safeKeyNames(provenance);
  const provenanceExact = provenance && typeof provenance === "object" && !Array.isArray(provenance) &&
    JSON.stringify(Object.keys(provenance).sort()) === JSON.stringify(expectedProvenance);
  if (!provenanceExact || provenance.kind !== EPISTEMIC_CONTRACT.provenance.kind ||
      provenance.request_sha256 !== requestSha ||
      provenance.reviewed_artifact !== EPISTEMIC_CONTRACT.provenance.reviewed_artifact) {
    throw rejection("compile_result_provenance_invalid", result, requestSha, modelIdentity, {
      provenance_expected_key_names: expectedProvenance,
      provenance_present_expected_key_names: actualProvenance.filter(
        (key) => expectedProvenance.includes(key),
      ),
      provenance_missing_key_names: expectedProvenance.filter(
        (key) => !provenance || !Object.hasOwn(provenance, key),
      ),
      provenance_unexpected_key_count: actualProvenance.filter(
        (key) => !expectedProvenance.includes(key),
      ).length,
      provenance_unexpected_key_sha256: actualProvenance.filter(
        (key) => !expectedProvenance.includes(key),
      ).map((key) => crypto.createHash("sha256").update(Buffer.from(key, "utf8")).digest("hex")),
    });
  }
  for (const key of RESULT_DOCUMENT_KEYS) {
    if (!result[key] || typeof result[key] !== "object" || Array.isArray(result[key])) {
      throw rejection("compile_result_document_type_invalid", result, requestSha, modelIdentity, {
        invalid_document_key: key,
      });
    }
  }
  return result;
}

function resolveModel(agentDir, provider, modelId) {
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const registry = ModelRegistry.create(authStorage, path.join(agentDir, "models.json"));
  let model = registry.find(provider, modelId);
  if (!model && provider === "coding-relay") {
    const template = registry.getAll().find(
      (candidate) => candidate.provider === provider && registry.hasConfiguredAuth(candidate),
    );
    if (template) model = { ...template, id: modelId, name: modelId };
  }
  if (!model || !registry.hasConfiguredAuth(model)) {
    throw new Error("requested_model_unavailable");
  }
  return { model, registry };
}

export function buildSubmissionTool(envelope, holder, modelIdentity) {
  holder.rawAttempts = holder.rawAttempts || 0;
  holder.validatedCandidates = holder.validatedCandidates || 0;
  holder.acceptedResults = holder.acceptedResults || 0;
  holder.rejectedRawAttempts = holder.rejectedRawAttempts || 0;
  holder.duplicateValidCandidates = holder.duplicateValidCandidates || 0;
  holder.pendingExecutions = holder.pendingExecutions || [];
  return defineTool({
    name: "coc_submit_epistemic_result",
    label: "Submit COC Epistemic Sidecars",
    description: "Submit the exact seven-key provenance-bound epistemic compile result.",
    promptGuidelines: ["Call exactly once.", "After the tool returns, stop."],
    executionMode: "sequential",
    parameters: buildResultParameters(envelope.request_sha256),
    prepareArguments(args) {
      holder.rawAttempts += 1;
      const submissionAttempt = holder.rawAttempts;
      if (holder.result || holder.validatedCandidateReserved) {
        holder.duplicateValidCandidates += 1;
        holder.pendingExecutions.push({ kind: "duplicate" });
        return neutralResult(envelope.request_sha256);
      }
      if (holder.rejection) {
        holder.pendingExecutions.push({ kind: "halted", diagnostic: holder.rejection });
        return neutralResult(envelope.request_sha256);
      }
      // pi 0.79.9 applies Value.Convert before TypeBox validation. Reject raw
      // values here so true can never be converted to numeric literal 1. An
      // invalid raw call is carried to execute through a private neutral value,
      // allowing this tool to terminate the session with a bounded diagnostic.
      try {
        validateResult(args, envelope.request_sha256, modelIdentity);
      } catch (diagnostic) {
        const safe = diagnostic && diagnostic.error_code
          ? {
            ...diagnostic,
            submission_attempt: submissionAttempt,
            accepted_result_count: holder.acceptedResults,
            failure_class: "raw_validation",
          }
          : rejection(
            "compile_result_validation_failed", args, envelope.request_sha256, modelIdentity,
            {
              submission_attempt: submissionAttempt,
              accepted_result_count: holder.acceptedResults,
              failure_class: "raw_validation",
            },
          );
        holder.rejectedRawAttempts += 1;
        holder.rejection ||= safe;
        holder.pendingExecutions.push({ kind: "rejection", diagnostic: safe });
        return neutralResult(envelope.request_sha256);
      }
      holder.validatedCandidates += 1;
      holder.validatedCandidateReserved = true;
      holder.pendingExecutions.push({ kind: "candidate", candidate: args });
      return args;
    },
    async execute(_id, params) {
      const pending = holder.pendingExecutions.shift();
      if (pending?.kind === "rejection" || pending?.kind === "halted") {
        return {
          content: [{ type: "text", text: JSON.stringify({
            ok: false, error_code: "epistemic_arguments_rejected",
          }) }],
          details: { diagnostic: pending.diagnostic },
          terminate: true,
        };
      }
      if (pending?.kind === "duplicate" || holder.result) {
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, already_received: true }) }],
          details: { ok: true, already_received: true },
          terminate: true,
        };
      }
      const candidate = pending?.kind === "candidate" ? pending.candidate : params;
      try {
        const validated = validateResult(candidate, envelope.request_sha256, modelIdentity);
        if (!holder.result) {
          holder.result = validated;
          holder.acceptedResults = 1;
        }
      } catch (diagnostic) {
        holder.rejection = diagnostic && diagnostic.error_code
          ? diagnostic
          : rejection(
            "compile_result_validation_failed", candidate, envelope.request_sha256, modelIdentity,
          );
      }
      return {
        content: [{ type: "text", text: JSON.stringify(
          holder.rejection ? { ok: false, diagnostic: holder.rejection } : { ok: true },
        ) }],
        details: holder.rejection ? { diagnostic: holder.rejection } : { ok: true },
        terminate: true,
      };
    },
  });
}

export async function run(envelope, dependencies = {}) {
  if (!envelope || typeof envelope !== "object" ||
      typeof envelope.compile_request_json !== "string") {
    throw new Error("invalid_epistemic_compiler_envelope");
  }
  let compileRequest;
  try { compileRequest = JSON.parse(envelope.compile_request_json); }
  catch { throw new Error("invalid_epistemic_compile_request_json"); }
  if (!compileRequest || typeof compileRequest !== "object" || Array.isArray(compileRequest)) {
    throw new Error("invalid_epistemic_compile_request");
  }
  const requestSha = crypto.createHash("sha256")
    .update(Buffer.from(envelope.compile_request_json, "utf8")).digest("hex");
  envelope = { ...envelope, compile_request: compileRequest, request_sha256: requestSha };
  const provider = dependencies.provider || process.env.COC_COMPILER_MODEL_PROVIDER || "coding-relay";
  const modelId = dependencies.modelId || process.env.COC_COMPILER_MODEL_ID || "gpt-5.6";
  const agentDir = dependencies.agentDir || getAgentDir();
  const resolved = dependencies.resolveModel
    ? dependencies.resolveModel(agentDir, provider, modelId)
    : resolveModel(agentDir, provider, modelId);
  const { model, registry } = resolved;
  const modelIdentity = { provider: model.provider, id: model.id };
  const holder = {
    result: null, rejection: null, rawAttempts: 0, validatedCandidates: 0,
    acceptedResults: 0, rejectedRawAttempts: 0, duplicateValidCandidates: 0,
    validatedCandidateReserved: false, pendingExecutions: [],
  };
  const tool = buildSubmissionTool(envelope, holder, modelIdentity);
  let created;
  if (dependencies.sessionFactory) {
    created = await dependencies.sessionFactory({ tool, model, registry });
  } else {
    const loader = new DefaultResourceLoader({
      cwd: __dirname, agentDir, noExtensions: true, noSkills: true,
      noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => SYSTEM_PROMPT,
      extensionsOverride: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    });
    await loader.reload();
    created = await createAgentSession({
      cwd: __dirname, agentDir, tools: ["coc_submit_epistemic_result"], customTools: [tool],
      model, modelRegistry: registry, resourceLoader: loader,
      sessionManager: SessionManager.inMemory(__dirname),
    });
  }
  const prompt = [
    "Compile the supplied structured scenario into epistemic sidecars.",
    `The tool parameters are the result itself: exactly these seven root keys and no wrapper: ${RESULT_ROOT_KEYS.join(", ")}.`,
    `Use this exact evaluation_provenance: ${JSON.stringify({ kind: EPISTEMIC_CONTRACT.provenance.kind, request_sha256: envelope.request_sha256, reviewed_artifact: EPISTEMIC_CONTRACT.provenance.reviewed_artifact })}`,
    "Critical questions and every reframe contract require a reasons entry. Confidence nodes must cover every critical question and reveal contract.",
    envelope.correction_feedback
      ? `Correct the prior rejected shape using only this safe diagnostic: ${JSON.stringify(envelope.correction_feedback)}`
      : "This is the initial epistemic attempt.",
    JSON.stringify(envelope.compile_request, null, 2),
  ].join("\n\n");
  try { await created.session.prompt(prompt); }
  finally { created.session.dispose(); }
  if (holder.result) {
    return {
      ok: true,
      compile_result: holder.result,
      model_identity: modelIdentity,
      submission_audit: {
        raw_attempts: holder.rawAttempts,
        validated_candidates: holder.validatedCandidates,
        accepted_results: holder.acceptedResults,
        rejected_raw_attempts: holder.rejectedRawAttempts,
        duplicate_valid_candidates: holder.duplicateValidCandidates,
      },
    };
  }
  if (holder.rejection) throw holder.rejection;
  if (!holder.result) {
    throw protocolDiagnostic(
      "compile_result_not_submitted", envelope.request_sha256, modelIdentity,
      { accepted_result_count: 0, failure_class: "not_submitted" },
    );
  }
}

export async function cliMain() {
  try {
    process.stdout.write(`${JSON.stringify(await run(await readStdinJson()))}\n`);
  } catch (error) {
    const diagnostic = error && error.error_code ? error : null;
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error_code: diagnostic?.error_code || "epistemic_runner_failed",
      diagnostic,
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await cliMain();
}
