/**
 * Startup resume identity. Typed `coc_session_resume` may carry optional
 * contract fields (investigator, host_session_id, context_epoch). Those are
 * not a different campaign and must not fail the exact-resume gate.
 */
import { isCanonicalInvokeSurface } from "./domain-tools.ts";
import type { JsonObject } from "./runtime.ts";

export type StartupResumeIdentity = {
  phase: string;
  workspaceRoot: string;
  campaignId: string;
};

const IDENTITY_ARG_KEYS = new Set([
  "campaign",
  "campaign_id",
  "root",
  "investigator",
  "host_session_id",
  "context_epoch",
]);

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function identityArgsMatch(
  args: JsonObject,
  gate: StartupResumeIdentity,
): boolean {
  for (const key of Object.keys(args)) {
    if (!IDENTITY_ARG_KEYS.has(key)) return false;
  }
  const campaign = args.campaign ?? args.campaign_id;
  if (typeof campaign === "string" && campaign !== gate.campaignId) return false;
  if (typeof args.root === "string" && args.root !== gate.workspaceRoot) {
    return false;
  }
  return true;
}

export function isExactStartupResumeParams(
  name: string,
  params: JsonObject,
  gate: StartupResumeIdentity | null,
): boolean {
  if (gate === null || gate.phase !== "pending") return false;
  if (!isCanonicalInvokeSurface(name) || params.operation !== "session.resume") {
    return false;
  }
  if (params.root !== gate.workspaceRoot || params.campaign !== gate.campaignId) {
    return false;
  }
  const args = objectOrNull(params.arguments);
  return args !== null && identityArgsMatch(args, gate);
}

export function bindStartupResumeParams(
  name: string,
  params: JsonObject,
  gate: StartupResumeIdentity | null,
): JsonObject {
  if (gate === null || gate.phase !== "pending") return params;
  if (!isCanonicalInvokeSurface(name) || params.operation !== "session.resume") {
    return params;
  }
  const args = objectOrNull(params.arguments);
  if (args === null || !identityArgsMatch(args, gate)) return params;
  return {
    ...params,
    root: gate.workspaceRoot,
    campaign: gate.campaignId,
  };
}
