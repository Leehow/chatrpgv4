/**
 * The launcher's notices to the person at the table (contract §135.27.1.3).
 *
 * `piLaunch` decides them before Pi starts, so it has no Pi UI to show them in. It hands them to the Pi child in its
 * environment, and the kernel extension places each one in the transcript as a §55 service notice at `session_start`.
 * This module is the hand-off both ends share: the shapes, the variable, and the English line.
 */

export const HOST_NOTICES_ENV = "PI_COC_HOST_NOTICES";

export type HostNotice =
  | { readonly notice: "models_json_unparsable"; readonly path: string; readonly error: string }
  | { readonly notice: "models_json_operator_comments"; readonly path: string; readonly missing: readonly string[] };

/** The English line: what a terminal and the launch log get, and what the App gets if its words cannot be read. */
export function hostNoticeText(notice: HostNotice): string {
  // §135.27.1.2: Pi drops every custom model and override in a file it cannot parse, and shows its error only in its
  // interactive TUI; the Keeper runs Pi in RPC mode, so nothing else would say so.
  if (notice.notice === "models_json_unparsable")
    return `${notice.path} does not parse the way Pi reads it (${notice.error}), so Pi ignores every custom `
      + `provider, model and override in it, and the product merged none of its provider model corrections (contract §135.27.1.2). `
      + `Pi accepts // line comments and trailing commas in this file, and nothing else beyond strict JSON (no /* */ comments); `
      + `fix the file and launch again.`;
  // §135.27.1.1: an operator's comments keep the file untouched; Pi loads it fine, so nothing else would say so.
  return `${notice.path} carries your own comments, so the product left it untouched `
    + `and did not merge its provider model corrections for ${notice.missing.join(", ")} `
    + `(contract §135.27.1.1). Add those overrides yourself, or remove the comments and launch again.`;
}

/** The Pi child's environment: this launch's notices, never a value inherited from the launcher's own parent. */
export function withHostNotices<Env extends Record<string, string | undefined>>(env: Env, notices: readonly HostNotice[]): Env {
  const next: Record<string, string | undefined> = { ...env };
  delete next[HOST_NOTICES_ENV];
  if (notices.length) next[HOST_NOTICES_ENV] = JSON.stringify(notices);
  return next as Env;
}

/**
 * This process's notices, taken once: the variable is removed, so a reload or a replaced session in the same process
 * does not place them again and a lane child never inherits them. An entry of any other shape is dropped.
 */
export function takeHostNotices(env: Record<string, string | undefined> = process.env): HostNotice[] {
  const raw = env[HOST_NOTICES_ENV];
  delete env[HOST_NOTICES_ENV];
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  return Array.isArray(parsed) ? parsed.filter(isHostNotice) : [];
}

function isHostNotice(value: unknown): value is HostNotice {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row !== "object" || typeof row.path !== "string" || !row.path) return false;
  if (row.notice === "models_json_unparsable") return typeof row.error === "string";
  return row.notice === "models_json_operator_comments" && Array.isArray(row.missing)
    && row.missing.length > 0 && row.missing.every(entry => typeof entry === "string");
}
