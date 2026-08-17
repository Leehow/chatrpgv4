import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Shared web/server-node modules live at <payloadRoot>/web/server-node/.
// Dev: payloadRoot is the repo. Packaged: <Resources>/payload.
// A static ../../web import from app.asar/electron/ resolves to
// <Resources>/web (missing) instead of <Resources>/payload/web.

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ELECTRON_DIR, "..", "..");

export function resolvePayloadRoot({ resourcesPath = process.resourcesPath } = {}) {
  if (resourcesPath) {
    const packaged = path.join(resourcesPath, "payload");
    if (fs.existsSync(path.join(packaged, "web", "server-node"))) return packaged;
  }
  return REPO_ROOT;
}

export function resolvePayloadModule(rel, opts) {
  const abs = path.join(resolvePayloadRoot(opts), ...String(rel).split("/"));
  if (!fs.existsSync(abs)) {
    throw new Error(`payload module missing: ${rel} (${abs})`);
  }
  return pathToFileURL(abs).href;
}
