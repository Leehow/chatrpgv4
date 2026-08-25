/** Handwritten Pi policy adapter over generated canonical operation facts. */
import {
  AUDIENCES,
  PLAY_PHASES,
  KP_SURFACES,
  EXECUTION_CLASSES,
  OPERATION_POLICY,
  OPERATIONS_BY_SURFACE,
  type PlayPhase,
  type KpSurface,
  type ExecutionClass,
  type OperationPolicy,
} from "./operation-policy.generated.ts";

export {
  AUDIENCES,
  PLAY_PHASES,
  KP_SURFACES,
  EXECUTION_CLASSES,
  OPERATION_POLICY,
  OPERATIONS_BY_SURFACE,
};
export type { PlayPhase, KpSurface, ExecutionClass, OperationPolicy };

/** Consumer for canonical toolbox execution_class; absent/unknown values fail closed. */
export function executionClassForPolicy(
  policy: Pick<OperationPolicy, "execution_class"> | undefined,
): ExecutionClass {
  return policy?.execution_class === "parallel_read" || policy?.execution_class === "serial_global"
    ? policy.execution_class
    : "serial_campaign";
}

/** Pi dual-session role. Canonical caller: domain-tools sessionRoleFromEnv / evaluateExecuteAcl. Consumer: execute-time ACL + tool visibility. */
export const SESSION_ROLES = ["setup", "play"] as const;
export type SessionRole = typeof SESSION_ROLES[number];

/** Shared across setup|play. Audience alone cannot mark these: setup.inspect is audience=setup, session.resume is audience=host. Chargen dice/read-face rules are audience=keeper but required in the setup session. Consumer: sessionRolesForPolicy. */
export const SESSION_ROLE_SHARED_OPERATIONS = new Set<string>([
  "setup.inspect",
  "setup.phase",
  "session.resume",
  "progressive.prepare_opening",
  "progressive.opening_bootstrap",
  "evidence.table_opening",
  "rules.roll_dice",
  "rules.cash_assets",
  "rules.skill_describe",
]);

export const SOURCE_WORKER_LIFECYCLE_OPERATIONS = new Set([
  "progressive.claim_host_work",
  "progressive.fulfill_host_work",
  "progressive.publish_skeleton",
  "progressive.release_host_work_leases",
  "progressive.renew_host_work_leases",
]);

export const HOST_INVOKE_COMPAT_OPERATIONS = new Set([
  "progressive.project_opening",
  "progressive.register_source_bundle",
  "progressive.request_locator_pass",
  "progressive.request_opening_pack",
  "progressive.retry_full_parse",
  "progressive.status",
  "session.begin",
  "session.continuation_detail",
  "session.delivery_ack",
  "session.delivery_text",
]);

export const DOMAIN_TOOL_NAMES = [
  "coc_context",
  "coc_rules",
  "coc_state",
  "coc_npc",
  "coc_turn",
  "coc_setup",
  "coc_advice",
  "coc_subsystem",
] as const;
export type DomainToolName = typeof DOMAIN_TOOL_NAMES[number];

/** Session-role projection of audience (+ shared set). Caller: evaluateExecuteAcl / activeToolsForPhase. */
export function sessionRolesForPolicy(
  operation: string,
  policy: OperationPolicy,
): readonly SessionRole[] {
  if (SESSION_ROLE_SHARED_OPERATIONS.has(operation)) {
    return SESSION_ROLES;
  }
  if (policy.audience === "setup") return ["setup"];
  if (policy.audience === "keeper") return ["play"];
  return [];
}
