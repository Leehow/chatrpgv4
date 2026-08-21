/**
 * Workspace PDF source-bundle parse-cache helpers.
 * Deletes only `{workspace}/.coc/source-bundles/<bundle_id>/`.
 * Never touches campaigns, uploads, or module-assets.
 */
import fs from "node:fs";
import path from "node:path";

import { cocRoot, readJsonFile } from "./projections.mjs";

function httpishError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function sourceBundlesRoot(workspace) {
  return path.join(cocRoot(workspace), "source-bundles");
}

/** Reject traversal, absolute paths, and ids that are not a single directory name. */
export function assertSafeBundleId(bundleId) {
  const id = String(bundleId ?? "");
  if (!id || id === "." || id === "..") {
    throw httpishError(400, "非法源包编号");
  }
  if (
    path.isAbsolute(id)
    || id.includes("\0")
    || id.includes("..")
    || id.includes("/")
    || id.includes("\\")
    || id.includes(path.sep)
  ) {
    throw httpishError(400, "非法源包编号");
  }
  return id;
}

export function resolveSourceBundleDir(workspace, bundleId) {
  const id = assertSafeBundleId(bundleId);
  const root = path.resolve(sourceBundlesRoot(workspace));
  const dir = path.resolve(root, id);
  const rel = path.relative(root, dir);
  if (
    !rel
    || rel === ".."
    || rel.startsWith(`..${path.sep}`)
    || path.isAbsolute(rel)
    || rel.split(path.sep).length !== 1
  ) {
    throw httpishError(400, "非法源包编号");
  }
  return dir;
}

function boundPathFromScenario(doc) {
  if (!doc || typeof doc !== "object") return "";
  const source = doc.source;
  const fromSource =
    source && typeof source === "object"
      ? String(source.source_bundle_path || "").trim()
      : "";
  return fromSource || String(doc.source_bundle_path || "").trim();
}

function listCampaignDirs(root) {
  const out = [];
  let names;
  try {
    names = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "." || entry.name === ".." || entry.name.includes("..")) continue;
    out.push({ campaignId: entry.name, dir: path.join(root, entry.name) });
  }
  return out;
}

/** Live (and trash) campaigns whose bind_pdf ref points at this bundle dir. */
export function campaignsBoundToSourceBundle(workspace, bundleId) {
  const bundleDir = resolveSourceBundleDir(workspace, bundleId);
  const wanted = path.resolve(bundleDir);
  const roots = [
    path.join(cocRoot(workspace), "campaigns"),
    path.join(cocRoot(workspace), "trash", "campaigns"),
  ];
  const bound = [];
  for (const root of roots) {
    for (const { campaignId, dir } of listCampaignDirs(root)) {
      const scenario = readJsonFile(path.join(dir, "scenario", "scenario.json"));
      const stored = boundPathFromScenario(scenario);
      if (!stored) continue;
      if (path.resolve(stored) === wanted) bound.push(campaignId);
    }
  }
  return bound;
}

export function deleteSourceBundle(workspace, bundleId) {
  const dir = resolveSourceBundleDir(workspace, bundleId);
  const root = path.resolve(sourceBundlesRoot(workspace));
  if (!dir.startsWith(`${root}${path.sep}`)) {
    throw httpishError(400, "非法源包编号");
  }
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    throw httpishError(404, "找不到该解析结果");
  }
  if (!st.isDirectory()) {
    throw httpishError(404, "找不到该解析结果");
  }
  const bound = campaignsBoundToSourceBundle(workspace, bundleId);
  if (bound.length > 0) {
    throw httpishError(
      409,
      `该解析结果仍被战役「${bound[0]}」绑定，无法清除。`,
    );
  }
  // Re-assert containment immediately before unlink.
  const again = resolveSourceBundleDir(workspace, bundleId);
  if (again !== dir || !again.startsWith(`${root}${path.sep}`)) {
    throw httpishError(400, "非法源包编号");
  }
  fs.rmSync(dir, { recursive: true, force: false });
  return { ok: true, bundle_id: bundleId };
}
