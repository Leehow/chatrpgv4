#!/usr/bin/env node
/**
 * Assemble the packaged-app payload into desktop/build/:
 *
 *   build/payload     repo surface the web bridge drives, layout-anchored
 *                     (runtime/, plugins/coc-keeper/, web/server-node/,
 *                     web/frontend/dist/, root manifests)
 *   build/bin         node + uv binaries (contract-pinned uv 0.11.16)
 *   build/python      uv-managed CPython 3.14.6 install
 *   build/coc-tools   local pdf-inspector router (napi, no network/key)
 *
 * Deterministic and re-runnable: wipes the payload parts first. Binaries are
 * copied from the dev machine's contract-verified installs, never downloaded
 * ad hoc, so the bundle matches what the repo pins.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "..");
const buildDir = path.join(desktopDir, "build");
const payloadRoot = path.join(buildDir, "payload");
const binDir = path.join(buildDir, "bin");
const pythonDir = path.join(buildDir, "python");
const cocToolsDir = path.join(buildDir, "coc-tools");

const UV_VERSION = "0.11.16";
const NODE_VERSION = "v24.19.0";
const PBS_TAG = "20260804";
const PBS_NAME = `cpython-3.14.6+${PBS_TAG}-aarch64-apple-darwin-install_only.tar.gz`;

function log(step) {
  console.log(`[payload] ${step}`);
}

function sh(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8" }).trim();
}

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyTree(src, dst, { filter } = {}) {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (s) => (filter ? filter(s) : true),
  });
}

function dirSize(p) {
  let total = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const child = path.join(p, entry.name);
    if (entry.isSymbolicLink()) continue;
    total += entry.isDirectory() ? dirSize(child) : fs.statSync(child).size;
  }
  return total;
}

function human(bytes) {
  return bytes > 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    : `${Math.round(bytes / 1024 / 1024)} MB`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// --- bundled binaries -------------------------------------------------------

function resolveUv() {
  const candidates = [process.env.UV_BIN, "/Users/haoli/.local/bin/uv", "uv"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = sh(candidate, ["--version"]);
      if (version.startsWith(`uv ${UV_VERSION}`)) {
        return { bin: candidate, version };
      }
      throw new Error(`uv at ${candidate} is '${version}', contract requires ${UV_VERSION}`);
    } catch (err) {
      if (String(err.message).includes("contract requires")) throw err;
    }
  }
  throw new Error(`uv ${UV_VERSION} not found`);
}

function resolveNode() {
  const candidates = [process.env.NODE_BIN, "/Users/haoli/.local/bin/node", "node"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = sh(candidate, ["--version"]);
      if (version === NODE_VERSION) return { bin: fs.realpathSync(candidate), version };
      throw new Error(`node at ${candidate} is '${version}', expected ${NODE_VERSION}`);
    } catch (err) {
      if (String(err.message).includes("expected")) throw err;
    }
  }
  throw new Error(`node ${NODE_VERSION} not found`);
}

// --- payload ----------------------------------------------------------------

const SKIP_BASENAMES = new Set([".DS_Store", "__pycache__"]);
function repoFilter(src) {
  const name = path.basename(src);
  if (SKIP_BASENAMES.has(name)) return false;
  if (name.endsWith(".pyc")) return false;
  // All node_modules surfaces are re-added explicitly below; source trees only
  // ever ship code. Symlinks (e.g. node_modules -> node_modules.noindex) are
  // re-created where needed rather than copied blind.
  if (name === "node_modules" || name === "node_modules.noindex") return false;
  return true;
}

function assemblePayload() {
  rm(payloadRoot);
  fs.mkdirSync(payloadRoot, { recursive: true });
  log(`payload root ${payloadRoot}`);

  for (const rel of ["runtime", path.join("plugins", "coc-keeper")]) {
    const src = path.join(repoRoot, rel);
    log(`copy ${rel}/`);
    copyTree(src, path.join(payloadRoot, rel), { filter: repoFilter });
  }

  log("copy web/server-node/");
  copyTree(path.join(repoRoot, "web", "server-node"), path.join(payloadRoot, "web", "server-node"), {
    filter: (src) => repoFilter(src) && path.basename(src) !== "test",
  });

  log("copy web/frontend/dist/");
  copyTree(path.join(repoRoot, "web", "frontend", "dist"), path.join(payloadRoot, "web", "frontend", "dist"));

  for (const name of ["package.json", "pyproject.toml", "uv.lock", ".python-version"]) {
    fs.copyFileSync(path.join(repoRoot, name), path.join(payloadRoot, name));
  }

  // Keeper runner resolves @earendil-works/pi-coding-agent (pinned 0.84.2)
  // from its own node_modules; materialize the .noindex tree as a real
  // node_modules dir in the payload.
  const keeperNmSrc = path.join(repoRoot, "runtime", "adapters", "keeper", "node_modules.noindex");
  const keeperNmDst = path.join(payloadRoot, "runtime", "adapters", "keeper", "node_modules");
  if (!fs.existsSync(keeperNmSrc)) {
    throw new Error(`keeper node_modules source missing: ${keeperNmSrc}`);
  }
  log("copy runtime/adapters/keeper/node_modules/");
  copyTree(keeperNmSrc, keeperNmDst);
}

function assembleBinaries() {
  rm(binDir);
  fs.mkdirSync(binDir, { recursive: true });

  const uv = resolveUv();
  fs.copyFileSync(fs.realpathSync(uv.bin), path.join(binDir, "uv"));
  fs.chmodSync(path.join(binDir, "uv"), 0o755);
  log(`bundled uv: ${uv.version} (from ${uv.bin})`);

  const node = resolveNode();
  fs.copyFileSync(node.bin, path.join(binDir, "node"));
  fs.chmodSync(path.join(binDir, "node"), 0o755);
  log(`bundled node: ${node.version} (from ${node.bin})`);
}

function assemblePython() {
  // The dev machine's uv-managed 3.14.6 is a symlink to the python.org
  // framework build — not relocatable. Bundle the official python-build-
  // standalone install instead (the same artifact uv itself downloads),
  // pinned by release tag, and point the runtime at it via UV_PYTHON.
  const cacheDir = path.join(buildDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const tarball = path.join(cacheDir, PBS_NAME);
  if (!fs.existsSync(tarball)) {
    const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${PBS_NAME}`;
    log(`downloading ${PBS_NAME}`);
    execFileSync("curl", ["-fL", "--retry", "3", "-o", tarball, url], { stdio: "inherit" });
  }
  rm(pythonDir);
  const extractDir = path.join(buildDir, "python-extract");
  rm(extractDir);
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", extractDir]);
  fs.renameSync(path.join(extractDir, "python"), pythonDir);
  rm(extractDir);
  const pyBin = path.join(pythonDir, "bin", "python3.14");
  const version = sh(pyBin, ["--version"]);
  if (version !== "Python 3.14.6") {
    throw new Error(`bundled python reports '${version}', contract requires Python 3.14.6`);
  }
  log(`bundled CPython: ${version} (${PBS_NAME})`);
}

function assembleCocTools() {
  const src = path.join(process.env.HOME, ".pi", "coc-tools", "pdf-inspector");
  if (!fs.existsSync(path.join(src, "coc-pi-pdf-inspector-router"))) {
    throw new Error(`pdf-inspector router missing at ${src}`);
  }
  rm(cocToolsDir);
  fs.mkdirSync(cocToolsDir, { recursive: true });
  copyTree(src, path.join(cocToolsDir, "pdf-inspector"));
  log(`bundled pdf-inspector (from ${src})`);
}

function writeManifest() {
  const manifest = {
    built_at: new Date().toISOString(),
    track: "pi-coc",
    node: NODE_VERSION,
    uv: UV_VERSION,
    python: `python-build-standalone ${PBS_TAG} (CPython 3.14.6)`,
    sha256: {
      node: sha256(path.join(binDir, "node")),
      uv: sha256(path.join(binDir, "uv")),
      python_tarball: sha256(path.join(buildDir, "cache", PBS_NAME)),
    },
    sizes: {
      payload: dirSize(payloadRoot),
      bin: dirSize(binDir),
      python: dirSize(pythonDir),
      coc_tools: dirSize(cocToolsDir),
    },
  };
  fs.writeFileSync(path.join(buildDir, "payload-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  log(
    `sizes: payload=${human(manifest.sizes.payload)} bin=${human(manifest.sizes.bin)} ` +
      `python=${human(manifest.sizes.python)} coc-tools=${human(manifest.sizes.coc_tools)}`,
  );
}

assemblePayload();
assembleBinaries();
assemblePython();
assembleCocTools();
writeManifest();
log("done");
