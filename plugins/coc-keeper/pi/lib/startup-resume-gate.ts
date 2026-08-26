/**
 * Startup resume identity. Typed `coc_session_resume` may carry optional
 * contract fields (investigator, host_session_id, context_epoch). Those are
 * not a different campaign and must not fail the exact-resume gate.
 */
import { isCanonicalInvokeSurface } from "./domain-tools.ts";
import type { JsonObject } from "./runtime.ts";

export type StartupResumeIdentity = {
  origin?: "startup_selector" | "role_null_handoff";
  phase: string;
  workspaceRoot: string;
  campaignId: string;
};

function isResumeGateActive(gate: StartupResumeIdentity): boolean {
  return gate.phase === "pending" || (
    gate.origin === "role_null_handoff" && gate.phase === "terminal_failure"
  );
}

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

export function startupResumeIdentityArgumentsMatch(
  value: unknown,
  gate: Pick<StartupResumeIdentity, "workspaceRoot" | "campaignId">,
): boolean {
  const args = objectOrNull(value);
  if (args === null) return false;
  for (const key of Object.keys(args)) {
    if (!IDENTITY_ARG_KEYS.has(key)) return false;
  }
  for (const key of ["campaign", "campaign_id"] as const) {
    if (
      Object.hasOwn(args, key)
      && (typeof args[key] !== "string" || args[key] !== gate.campaignId)
    ) return false;
  }
  if (
    Object.hasOwn(args, "root")
    && (typeof args.root !== "string" || args.root !== gate.workspaceRoot)
  ) return false;
  for (const key of ["investigator", "host_session_id"] as const) {
    if (Object.hasOwn(args, key) && typeof args[key] !== "string") return false;
  }
  if (
    Object.hasOwn(args, "context_epoch")
    && (!Number.isInteger(args.context_epoch) || Number(args.context_epoch) < 1)
  ) return false;
  return true;
}

export function isExactStartupResumeParams(
  name: string,
  params: JsonObject,
  gate: StartupResumeIdentity | null,
): boolean {
  if (gate === null || !isResumeGateActive(gate)) return false;
  if (!isCanonicalInvokeSurface(name) || params.operation !== "session.resume") {
    return false;
  }
  if (params.root !== gate.workspaceRoot || params.campaign !== gate.campaignId) {
    return false;
  }
  return startupResumeIdentityArgumentsMatch(params.arguments, gate);
}

export function bindStartupResumeParams(
  name: string,
  params: JsonObject,
  gate: StartupResumeIdentity | null,
): JsonObject {
  if (gate === null || !isResumeGateActive(gate)) return params;
  if (!isCanonicalInvokeSurface(name) || params.operation !== "session.resume") {
    return params;
  }
  const rejectVisibleIdentityDrift = (
    gate.origin === "role_null_handoff" && gate.phase === "terminal_failure"
  );
  if (
    rejectVisibleIdentityDrift
    && (
      (params.root !== undefined && params.root !== gate.workspaceRoot)
      || (params.campaign !== undefined && params.campaign !== gate.campaignId)
    )
  ) return params;
  if (!startupResumeIdentityArgumentsMatch(params.arguments, gate)) return params;
  return {
    ...params,
    root: gate.workspaceRoot,
    campaign: gate.campaignId,
  };
}
