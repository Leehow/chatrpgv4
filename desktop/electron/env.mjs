import { app } from "electron";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";

// Path + env assembly for the desktop shell. The shell never reimplements any
// Keeper behavior: it spawns the canonical web bridge (web/server-node) with
// an environment equivalent to the pi-coc TUI launcher, and keeps campaign
// state in a user-writable workspace.
//
// Two modes:
//   dev      — payload = repository checkout; uv/node come from the ambient
//              PATH; the repo .venv serves Python.
//   packaged — payload = <resources>/payload copy of runtime/, plugins/,
//              web/; uv/node binaries under <resources>/bin; CPython under
//              <resources>/python (copied to userData on first run because
//              the app bundle is read-only and uv may write there).

export function resolvePaths() {
  const packaged = app.isPackaged;
  const payloadRoot = packaged
    ? path.join(process.resourcesPath, "payload")
    : path.resolve(app.getAppPath(), "..");
  // QA override for clean-first-run tests of the packaged app.
  // Pin the data dir to the stable app id. `productName` / app.setName()
  // only change the dock label — they must not relocate the workspace.
  const userData = process.env.COC_DESKTOP_USER_DATA
    || path.join(app.getPath("appData"), "coc-keeper-desktop");
  return {
    packaged,
    payloadRoot,
    serverMjs: path.join(payloadRoot, "web", "server-node", "server.mjs"),
    userData,
    workspace: path.join(userData, "coc-workspace"),
    // One app-owned Pi directory on every platform and in both dev/packaged
    // modes. COC_DESKTOP_USER_DATA still relocates the whole app for QA, but
    // the desktop shell never reads or writes the user's global ~/.pi/agent.
    agentDir: path.join(userData, "pi-agent"),
    logsDir: path.join(userData, "logs"),
    bundledBin: packaged ? path.join(process.resourcesPath, "bin") : null,
    // Relocatable python-build-standalone install (bin/python3.14 inside).
    bundledPython: packaged ? path.join(process.resourcesPath, "python") : null,
    uvCacheDir: path.join(userData, "uv-cache"),
    projectEnv: path.join(userData, "coc-venv"),
    bundledPdfInspector: packaged
      ? path.join(process.resourcesPath, "coc-tools", "pdf-inspector")
      : null,
  };
}

/** Node binary used to run the web bridge. Packaged: the bundled runtime. */
export function nodeBinary(paths) {
  if (paths.bundledBin) {
    const bundled = path.join(paths.bundledBin, "node");
    if (fs.existsSync(bundled)) return bundled;
  }
  return "node";
}

/** uv binary used for the first-run `uv sync`. Packaged: bundled 0.11.16. */
export function uvBinary(paths) {
  if (paths.bundledBin) {
    const bundled = path.join(paths.bundledBin, "uv");
    if (fs.existsSync(bundled)) return bundled;
  }
  return "uv";
}

/**
 * Environment for the web bridge and every descendant (Python sidecar,
 * pi-coc RPC children, adapter children). Mirrors the pi-coc TUI launcher
 * where the web path does not already arm defaults, and never lets TUI
 * session selectors leak into the desktop app (the Node bridge sets
 * PI_COC_CAMPAIGN_ID per RPC child).
 */
export function buildChildEnv(paths) {
  const env = { ...process.env };
  delete env.PI_COC_CAMPAIGN_ID;
  delete env.PI_COC_SESSION_ID;
  delete env.PI_COC_AGENT_DIR;
  delete env.COC_PI_COMMAND;
  delete env.ELECTRON_RUN_AS_NODE;

  if (paths.bundledBin && fs.existsSync(paths.bundledBin)) {
    env.PATH = paths.bundledBin + path.delimiter + (env.PATH || "");
  }
  // The model dropdown reads PI_AGENT_DIR (web/server-node/projections.mjs)
  // while the pi-coding-agent library reads PI_CODING_AGENT_DIR; one dir,
  // both names.
  env.PI_AGENT_DIR = paths.agentDir;
  env.PI_CODING_AGENT_DIR = paths.agentDir;
  env.COC_DESKTOP_USER_DATA = paths.userData;

  // Quiet, offline children: no version/update checks in nested pi spawns.
  env.PI_OFFLINE = "1";
  env.PI_SKIP_VERSION_CHECK = "1";

  // TUI parity: arm the steward scene-supply gate on state.move_scene.
  // Turning this off must stay an explicit, user-visible decision.
  env.COC_PI_SCENE_SUPPLY = "1";

  if (paths.bundledPdfInspector) {
    const router = path.join(paths.bundledPdfInspector, "coc-pi-pdf-inspector-router");
    if (fs.existsSync(router)) env.COC_PI_PDF_INSPECTOR_COMMAND = router;
  }
  if (paths.packaged) {
    // Relocate every writable uv artifact out of the read-only app bundle and
    // pin the interpreter to the bundled python-build-standalone install.
    env.UV_PROJECT_ENVIRONMENT = paths.projectEnv;
    env.UV_CACHE_DIR = paths.uvCacheDir;
    env.UV_PYTHON = path.join(paths.bundledPython, "bin", "python3.14");
    // Runtime deps are stdlib-only; skipping the dev group keeps the first
    // run fully offline (no wheel downloads for pytest/jsonschema/etc).
    env.UV_NO_DEV = "1";
  }
  return env;
}

/** Grab one free loopback port (server.mjs has no EADDRINUSE fallback). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Default bridge port. The UI loads from http://127.0.0.1:<port>/ and
 *  localStorage is origin-scoped, so a stable port is what keeps model /
 *  appearance / last-campaign preferences across app restarts. */
export const DESKTOP_BRIDGE_PORT = 8790;

/** Prefer the stable port so the UI origin survives restarts; fall back to
 *  any free port when it is occupied (second app instance, squatting process). */
export function preferredPort(preferred = DESKTOP_BRIDGE_PORT) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(freePort()));
    probe.listen(preferred, "127.0.0.1", () => {
      probe.close(() => resolve(preferred));
    });
  });
}

/** Poll the bridge health endpoint until it answers or the timeout hits. */
export async function waitHealth(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
