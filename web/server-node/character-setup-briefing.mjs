/**
 * Path-safe, size-capped read of player-safe character-creation briefing.
 * Failures are silent: setup still opens from resume/adopt player-safe facts.
 */
import fs from "node:fs";
import path from "node:path";

export const BRIEFING_MAX_BYTES = 12 * 1024;

export function campaignDir(workspace, campaignId) {
  return path.resolve(String(workspace || ""), ".coc", "campaigns", String(campaignId || ""));
}

function isInsideDir(filePath, rootDir) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(filePath);
  const rel = path.relative(root, resolved);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve briefing_path against campaignDir, or workspace when the stored
 * value is already `.coc/campaigns/<id>/...`. Final containment is always
 * campaignDir; sibling campaigns and workspace escapes stay rejected.
 */
export function resolveBriefingFilePath({ workspace, campaignId, briefingPath, campaignRoot } = {}) {
  const raw = String(briefingPath || "").trim();
  const id = String(campaignId || "").trim();
  const root = path.resolve(campaignRoot || campaignDir(workspace, id));
  if (!raw || !id) return null;
  if (path.isAbsolute(raw)) {
    const resolved = path.resolve(raw);
    return isInsideDir(resolved, root) ? resolved : null;
  }
  const posix = raw.replace(/\\/g, "/");
  const prefix = `.coc/campaigns/${id}/`;
  const fromWorkspace =
    posix === `.coc/campaigns/${id}` || posix.startsWith(prefix);
  const resolved = fromWorkspace
    ? path.resolve(String(workspace || ""), posix)
    : path.resolve(root, raw);
  return isInsideDir(resolved, root) ? resolved : null;
}

export function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @returns {{ briefingText: string, title: string, campaignId: string }}
 */
export function readCharacterSetupBriefing({ workspace, campaignId } = {}) {
  const id = String(campaignId || "").trim();
  const empty = { briefingText: "", title: "", campaignId: id };
  if (!id || !workspace) return empty;
  const root = campaignDir(workspace, id);
  const campaignFile = path.join(root, "campaign.json");
  const campaign = readJsonSafe(campaignFile);
  if (!campaign || typeof campaign !== "object") return empty;
  const title = typeof campaign.title === "string" ? campaign.title.trim() : "";
  const briefingPath = campaign.character_creation?.briefing_path;
  if (typeof briefingPath !== "string" || !briefingPath.trim()) {
    return { briefingText: "", title, campaignId: id };
  }
  const resolved = resolveBriefingFilePath({
    workspace,
    campaignId: id,
    briefingPath,
    campaignRoot: root,
  });
  if (!resolved) {
    return { briefingText: "", title, campaignId: id };
  }
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { briefingText: "", title, campaignId: id };
    const fd = fs.openSync(resolved, "r");
    try {
      const size = Math.min(stat.size, BRIEFING_MAX_BYTES);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, 0);
      return { briefingText: buf.toString("utf8").trim(), title, campaignId: id };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { briefingText: "", title, campaignId: id };
  }
}
