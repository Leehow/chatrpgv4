/**
 * Repo-local host resolver/installer for the canonical `grok-build-oauth`
 * extension package (PipiUI dual-half package, manifest id `grok-build-oauth`,
 * provider id `grok-build`).
 *
 * Consumption contract (docs/specs/grok-build-oauth-image-extension.md):
 * - ONE build artifact, TWO hosts. This module never copies TS source; it only
 *   installs/validates build outputs (`pipiui-extension.json`, `package.json`,
 *   `agent/dist/**`, `app/dist/**`) into the repo-local COC home
 *   (`<repoRoot>/.pi/coc-agent/extensions/grok-build-oauth`) via an atomic
 *   stage-swap.
 * - Runtime consumers (RPC `--extension` mount, provider login, portrait
 *   compat broker) resolve ONLY that repo-local install, so behavior is
 *   deterministic per checkout. Explicit env / PipiUI bundled runtime paths
 *   are INSTALL SOURCES for the CLI installer, not spawn-time mounts.
 * - Terminal pi-coc loads through the repo-local Pi home's official
 *   `settings.json` `extensions` key (Pi 0.84.2 has no
 *   `pipiui-extension.json` manifest discovery); all other settings keys are
 *   preserved and the write is atomic. The shared `pi-coc` launcher is never
 *   modified.
 * - Extension settings snapshots injected into child env are sanitized: keys
 *   the manifest marks `format: "secret"` (plus any token-like key) never
 *   enter the environment. OAuth credentials live only in Pi `auth.json`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GROK_BUILD_EXTENSION_ID = "grok-build-oauth";
export const GROK_BUILD_PROVIDER_ID = "grok-build";
/** Explicit install source: absolute path to a built package directory. */
export const GROK_BUILD_PACKAGE_ENV = "GROK_BUILD_OAUTH_PACKAGE";
/** PipiUI checkout root used to locate the bundled runtime extension tree. */
export const PIPIUI_REPO_ROOT_ENV = "PIPIUI_REPO_ROOT";
/** Comma-joined mounted extension ids minted by a PipiUI host spawn. */
export const MOUNTED_EXTENSIONS_ENV = "PIPIUI_MOUNTED_EXTENSIONS";
/** Settings snapshot env consumed by the extension (PipiUI §5.5 contract). */
export const GROK_BUILD_SETTINGS_ENV = "PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH";

export const MANIFEST_NAME = "pipiui-extension.json";
export const INSTALL_DIR_NAME = GROK_BUILD_EXTENSION_ID;
/** Canonical build outputs — the manifest must declare exactly these. */
export const CANONICAL_AGENT_ENTRY = "agent/dist/index.js";
export const CANONICAL_HOST_ENTRY = "agent/dist/host.js";
/** Producer-pinned host-entry hash receipt shipped by the PipiUI bundle. */
export const HOST_RECEIPT_NAME = "pipiui-host-receipt.json";
/** Non-secret, user-editable settings sidecar (survives artifact swaps). */
export const INSTALL_SETTINGS_SIDECAR = `${GROK_BUILD_EXTENSION_ID}.settings.json`;
export const INSTALL_RECEIPT_NAME = ".install-receipt.json";

export const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const BUNDLED_RELPATH = path.join(
  "Electron",
  "resources",
  "runtime",
  "extensions",
  INSTALL_DIR_NAME,
);
const COPY_ALLOWLIST = Object.freeze([
  MANIFEST_NAME,
  "package.json",
  "README.md",
]);
const COPY_DIST_DIRS = Object.freeze(["agent/dist", "app/dist"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_COUNT = 400;
const SECRET_KEY_RE = /(token|secret|bearer|authorization|api[_-]?key|password|credential)/i;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function lstatRegularFile(file, label, code = "SYMLINK_REJECTED") {
  let lstat;
  try {
    lstat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (lstat.isSymbolicLink()) {
    throw new GrokBuildExtensionError(`${label} is a symlink: ${file}`, { code });
  }
  if (!lstat.isFile()) return null;
  return lstat;
}

/** realpath containment: the resolved real path must stay inside `dir`. */
function realpathInsideDir(dir, file) {
  try {
    const realDir = fs.realpathSync(dir);
    const realFile = fs.realpathSync(file);
    return realFile === realDir || realFile.startsWith(realDir + path.sep);
  } catch {
    return false;
  }
}

function isInsideDir(root, candidate) {
  const base = path.resolve(root);
  const full = path.resolve(candidate);
  return full === base || full.startsWith(base + path.sep);
}

export class GrokBuildExtensionError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "GrokBuildExtensionError";
    if (code) this.code = code;
  }
}

/**
 * Repo-local COC home (terminal pi-coc home / install target).
 * Honors an explicit param or the COC-specific `PI_COC_AGENT_DIR` override
 * only — ambient `PI_AGENT_DIR` / `PI_CODING_AGENT_DIR` (set by coding
 * sessions and the web host) must never hijack the COC install target.
 */
export function resolveCocAgentHome({ repoRoot = DEFAULT_REPO_ROOT, cocHome, env = {} } = {}) {
  const explicit = path.isAbsolute(String(cocHome || "")) ? String(cocHome) : trimStr(cocHome);
  if (explicit) return path.resolve(explicit);
  const fromEnv = trimStr(env.PI_COC_AGENT_DIR);
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(path.resolve(repoRoot), ".pi", "coc-agent");
}

export function installedGrokBuildDir({ repoRoot = DEFAULT_REPO_ROOT, cocHome, env = {} } = {}) {
  return path.join(
    resolveCocAgentHome({ repoRoot, cocHome, env }),
    "extensions",
    INSTALL_DIR_NAME,
  );
}

/**
 * Validate one built package directory:
 * - manifest id/version shape;
 * - the manifest declares the CANONICAL agent entry `agent/dist/index.js` and
 *   host entry `agent/dist/host.js` (nothing else becomes executable/importable);
 * - package dir, manifest, and both entries are regular files — no symlinks;
 * - realpath containment: neither entry resolves outside the package dir.
 */
export function validateGrokBuildPackage(packageDir) {
  const dir = path.resolve(String(packageDir || ""));
  if (!dir) return { ok: false, dir, error: "package directory not found" };
  if (!fs.existsSync(dir)) return { ok: false, dir, error: "package directory not found" };
  const dirStat = fs.lstatSync(dir);
  if (dirStat.isSymbolicLink()) {
    return { ok: false, dir, error: "package directory is a symlink" };
  }
  if (!dirStat.isDirectory()) return { ok: false, dir, error: "package directory not found" };
  const manifestPath = path.join(dir, MANIFEST_NAME);
  try {
    if (fs.lstatSync(manifestPath).isSymbolicLink()) {
      return { ok: false, dir, error: `${MANIFEST_NAME} is a symlink` };
    }
  } catch (err) {
    return { ok: false, dir, error: `${MANIFEST_NAME} unreadable: ${err?.message || err}` };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    return { ok: false, dir, error: `${MANIFEST_NAME} unreadable: ${err?.message || err}` };
  }
  if (!asObject(manifest)) return { ok: false, dir, error: `${MANIFEST_NAME} is not an object` };
  if (trimStr(manifest.id) !== GROK_BUILD_EXTENSION_ID) {
    return { ok: false, dir, error: `manifest id mismatch: ${trimStr(manifest.id) || "(none)"}` };
  }
  const version = trimStr(manifest.version);
  if (!SEMVER_RE.test(version)) {
    return { ok: false, dir, error: `manifest version invalid: ${version || "(none)"}` };
  }
  const entryRel = trimStr(manifest.agent?.extension);
  if (entryRel !== CANONICAL_AGENT_ENTRY) {
    return {
      ok: false,
      dir,
      error: `manifest agent.extension must be ${CANONICAL_AGENT_ENTRY}, got ${entryRel || "(none)"}`,
    };
  }
  const hostEntryRel = trimStr(manifest.host?.entry);
  if (hostEntryRel !== CANONICAL_HOST_ENTRY) {
    return {
      ok: false,
      dir,
      error: `manifest host.entry must be ${CANONICAL_HOST_ENTRY}, got ${hostEntryRel || "(none)"}`,
    };
  }
  const entryPath = path.join(dir, entryRel);
  const hostEntryPath = path.join(dir, hostEntryRel);
  for (const [rel, file] of [[entryRel, entryPath], [hostEntryRel, hostEntryPath]]) {
    let lstat;
    try {
      lstat = fs.lstatSync(file);
    } catch {
      return { ok: false, dir, error: `${rel} missing` };
    }
    if (lstat.isSymbolicLink()) {
      return { ok: false, dir, error: `${rel} is a symlink` };
    }
    if (!lstat.isFile()) {
      return { ok: false, dir, error: `${rel} is not a file` };
    }
    if (!realpathInsideDir(dir, file)) {
      return { ok: false, dir, error: `${rel} realpath escapes the package directory` };
    }
  }
  return {
    ok: true,
    dir,
    manifest,
    version,
    entryRel,
    entryPath,
    entrySha256: sha256File(entryPath),
    hostEntryRel,
    hostEntryPath,
    hostEntrySha256: sha256File(hostEntryPath),
  };
}

/**
 * Runtime resolution: the repo-local installed package ONLY, re-verified
 * against its install receipt (id/version + every file hash + no extras)
 * before any spawn mount or dynamic import. Deterministic per checkout;
 * spawn mounts and compat consumers never reach for a sibling PipiUI
 * checkout implicitly.
 */
export function resolveInstalledGrokBuildPackage({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = {},
} = {}) {
  const dir = installedGrokBuildDir({ repoRoot, cocHome, env });
  if (!fs.existsSync(dir)) return { ok: false, dir, error: "not installed" };
  const validated = validateGrokBuildPackage(dir);
  if (!validated.ok) return validated;
  const verified = verifyInstalledGrokBuildPackage(validated);
  if (!verified.ok) {
    return {
      ok: false,
      dir,
      error: `install verification failed: ${verified.error}`,
      verified: false,
    };
  }
  return { ...validated, verified: true, receipt: verified.receipt };
}

/** True when a PipiUI host spawn already mounted the extension id. */
export function grokBuildMountedViaHostEnv(env = process.env) {
  const raw = trimStr(env?.[MOUNTED_EXTENSIONS_ENV]);
  if (!raw) return false;
  return raw
    .split(",")
    .map((id) => trimStr(id))
    .includes(GROK_BUILD_EXTENSION_ID);
}

/**
 * Install-source candidates (priority order) for the CLI installer:
 * explicit env path → PipiUI bundled runtime (env root, then sibling
 * checkout) → already-installed repo-local dir (no-op reconfigure).
 */
export function grokBuildInstallSourceCandidates({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = process.env,
} = {}) {
  const candidates = [];
  const explicit = trimStr(env[GROK_BUILD_PACKAGE_ENV]);
  if (explicit) {
    candidates.push({
      source: `env:${GROK_BUILD_PACKAGE_ENV}`,
      dir: path.resolve(explicit),
    });
  }
  const roots = [];
  const envRoot = trimStr(env[PIPIUI_REPO_ROOT_ENV]);
  if (envRoot) roots.push(path.resolve(envRoot));
  roots.push(path.resolve(path.resolve(repoRoot), "..", "pipiui"));
  for (const root of roots) {
    candidates.push({
      source: `pipiui-bundled:${root}`,
      dir: path.join(root, BUNDLED_RELPATH),
    });
  }
  candidates.push({
    source: "repo-local-installed",
    dir: installedGrokBuildDir({ repoRoot, cocHome, env }),
  });
  return candidates;
}

/** First valid install source, or the full failure trail. */
export function resolveGrokBuildInstallSource({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = process.env,
} = {}) {
  const tried = [];
  for (const candidate of grokBuildInstallSourceCandidates({ repoRoot, cocHome, env })) {
    const validated = validateGrokBuildPackage(candidate.dir);
    if (validated.ok) {
      return {
        ok: true,
        source: candidate.source,
        dir: validated.dir,
        manifest: validated.manifest,
        version: validated.version,
        entryPath: validated.entryPath,
        entrySha256: validated.entrySha256,
        hostEntryPath: validated.hostEntryPath,
        hostEntrySha256: validated.hostEntrySha256,
      };
    }
    tried.push({ source: candidate.source, dir: candidate.dir, error: validated.error });
  }
  return { ok: false, tried };
}

function listDistFiles(sourceDir, distRel) {
  const root = path.join(sourceDir, distRel);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (!isInsideDir(root, full)) {
        throw new GrokBuildExtensionError(`path escapes ${distRel}: ${entry.name}`, {
          code: "PATH_TRAVERSAL",
        });
      }
      const lstat = fs.lstatSync(full);
      if (lstat.isSymbolicLink()) {
        throw new GrokBuildExtensionError(`symlink rejected in ${distRel}: ${entry.name}`, {
          code: "SYMLINK_REJECTED",
        });
      }
      if (lstat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!lstat.isFile()) continue;
      if (lstat.size > MAX_FILE_BYTES) {
        throw new GrokBuildExtensionError(`file too large in ${distRel}: ${entry.name}`, {
          code: "FILE_TOO_LARGE",
        });
      }
      out.push(path.relative(sourceDir, full));
    }
  };
  walk(root);
  return out;
}

function copyPackageArtifacts(sourceDir, stageDir) {
  const rels = [];
  for (const name of [...COPY_ALLOWLIST, HOST_RECEIPT_NAME]) {
    const file = path.join(sourceDir, name);
    // Allowlist files must be regular files — a symlinked manifest/package.json
    // could point outside the source tree.
    const stat = lstatRegularFile(file, `allowlist file ${name}`);
    if (stat) rels.push(name);
  }
  for (const distRel of COPY_DIST_DIRS) {
    rels.push(...listDistFiles(sourceDir, distRel));
  }
  if (!rels.includes(MANIFEST_NAME)) {
    throw new GrokBuildExtensionError(`source missing ${MANIFEST_NAME}`, {
      code: "MANIFEST_MISSING",
    });
  }
  if (!rels.some((rel) => rel.startsWith("agent/dist/"))) {
    throw new GrokBuildExtensionError("source missing agent/dist build output", {
      code: "AGENT_DIST_MISSING",
    });
  }
  if (rels.length > MAX_FILE_COUNT) {
    throw new GrokBuildExtensionError(`too many files to copy: ${rels.length}`, {
      code: "TOO_MANY_FILES",
    });
  }
  for (const rel of rels) {
    const dest = path.join(stageDir, rel);
    if (!isInsideDir(stageDir, dest)) {
      throw new GrokBuildExtensionError(`destination escapes stage: ${rel}`, {
        code: "PATH_TRAVERSAL",
      });
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(sourceDir, rel), dest);
  }
  return rels;
}

function rmTree(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * Read the producer-pinned host-entry receipt (`pipiui-host-receipt.json`)
 * shipped inside a built package, and verify host.js against its full sha256.
 * The chatrpg side always reads the complete hash from the receipt at
 * runtime — never a truncated or hardcoded constant.
 */
function verifyProducerHostReceipt(dir, { hostEntryPath, hostEntrySha256 } = {}) {
  const receiptPath = path.join(dir, HOST_RECEIPT_NAME);
  if (!fs.existsSync(receiptPath)) return { present: false, ok: true };
  try {
    if (fs.lstatSync(receiptPath).isSymbolicLink()) {
      return { present: true, ok: false, error: `${HOST_RECEIPT_NAME} is a symlink` };
    }
  } catch (err) {
    return { present: true, ok: false, error: `${HOST_RECEIPT_NAME} unreadable: ${err?.message || err}` };
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (err) {
    return { present: true, ok: false, error: `${HOST_RECEIPT_NAME} invalid JSON` };
  }
  if (!asObject(receipt)) {
    return { present: true, ok: false, error: `${HOST_RECEIPT_NAME} is not an object` };
  }
  if (trimStr(receipt.extensionId) !== GROK_BUILD_EXTENSION_ID) {
    return { present: true, ok: false, error: `${HOST_RECEIPT_NAME} extensionId mismatch` };
  }
  const declaredEntry = trimStr(receipt.hostEntry);
  if (declaredEntry && declaredEntry !== CANONICAL_HOST_ENTRY) {
    return { present: true, ok: false, error: `${HOST_RECEIPT_NAME} hostEntry is not canonical` };
  }
  const sha = trimStr(receipt.sha256);
  if (!/^[0-9a-f]{64}$/i.test(sha)) {
    return { present: true, ok: false, error: `${HOST_RECEIPT_NAME} sha256 malformed` };
  }
  if (sha.toLowerCase() !== String(hostEntrySha256 || "").toLowerCase()) {
    return {
      present: true,
      ok: false,
      error: `host entry sha256 does not match ${HOST_RECEIPT_NAME} (receipt pins ${sha.slice(0, 12)}…)`,
    };
  }
  if (Number.isFinite(receipt.bytes) && fs.statSync(hostEntryPath).size !== receipt.bytes) {
    return { present: true, ok: false, error: `host entry byte size does not match ${HOST_RECEIPT_NAME}` };
  }
  return { present: true, ok: true, sha256: sha.toLowerCase() };
}

function buildInstallReceipt({ sourceLabel, sourceDir, validated, copied, files, nowMs, producerSha }) {
  return {
    schema: 2,
    installed_at: new Date(nowMs).toISOString(),
    source: sourceLabel,
    source_dir: sourceDir,
    extension_id: GROK_BUILD_EXTENSION_ID,
    version: validated.version,
    entry: validated.entryRel,
    entry_sha256: validated.entrySha256,
    host_entry: validated.hostEntryRel,
    host_entry_sha256: validated.hostEntrySha256,
    ...(producerSha ? { producer_host_receipt_sha256: producerSha } : {}),
    copied_files: copied.length,
    files,
  };
}

/**
 * Verify an installed tree against its install receipt: id/version against
 * the manifest, every recorded file present with an unchanged sha256, and no
 * unexpected extra files inside the install dir. Runtime resolution refuses
 * a tree that fails any check.
 */
export function verifyInstalledGrokBuildPackage(validated) {
  if (!validated?.ok) {
    return { ok: false, error: validated?.error || "package invalid" };
  }
  const receiptPath = path.join(validated.dir, INSTALL_RECEIPT_NAME);
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (err) {
    return { ok: false, error: `install receipt unreadable: ${err?.message || err}` };
  }
  if (!asObject(receipt) || receipt.schema !== 2 || !Array.isArray(receipt.files)) {
    return { ok: false, error: "install receipt schema mismatch — reinstall the artifact" };
  }
  if (receipt.extension_id !== GROK_BUILD_EXTENSION_ID) {
    return { ok: false, error: `install receipt id mismatch: ${receipt.extension_id}` };
  }
  if (trimStr(receipt.version) !== validated.version) {
    return {
      ok: false,
      error: `install receipt version ${receipt.version} != manifest ${validated.version}`,
    };
  }
  if (trimStr(receipt.host_entry_sha256) !== validated.hostEntrySha256) {
    return { ok: false, error: "installed host entry hash != install receipt" };
  }
  const recorded = new Set(receipt.files.map((f) => String(f?.path || "")));
  for (const file of receipt.files) {
    const rel = String(file?.path || "");
    const sha = trimStr(file?.sha256);
    if (!rel || !/^[0-9a-f]{64}$/i.test(sha)) {
      return { ok: false, error: `install receipt file entry malformed: ${rel || "(none)"}` };
    }
    const full = path.join(validated.dir, rel);
    if (!isInsideDir(validated.dir, full)) {
      return { ok: false, error: `install receipt path escapes install dir: ${rel}` };
    }
    let lstat;
    try {
      lstat = fs.lstatSync(full);
    } catch {
      return { ok: false, error: `installed file missing: ${rel}` };
    }
    if (lstat.isSymbolicLink()) {
      return { ok: false, error: `installed file replaced by symlink: ${rel}` };
    }
    if (!lstat.isFile()) {
      return { ok: false, error: `installed path is not a file: ${rel}` };
    }
    if (sha256File(full).toLowerCase() !== sha.toLowerCase()) {
      return { ok: false, error: `installed file hash mismatch: ${rel}` };
    }
  }
  // No unexpected extras (the receipt itself is expected).
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = path.relative(validated.dir, full);
      const lstat = fs.lstatSync(full);
      if (lstat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!recorded.has(rel) && rel !== INSTALL_RECEIPT_NAME) {
        throw new GrokBuildExtensionError(`unexpected file in install dir: ${rel}`, {
          code: "UNEXPECTED_FILE",
        });
      }
    }
  };
  try {
    walk(validated.dir);
  } catch (err) {
    if (err instanceof GrokBuildExtensionError) return { ok: false, error: err.message };
    return { ok: false, error: `install dir scan failed: ${err?.message || err}` };
  }
  return { ok: true, receipt };
}

/**
 * Install the canonical build artifact into the repo-local COC home with an
 * atomic stage-swap. Only build outputs and manifests are copied — never TS
 * sources, node_modules, or anything outside the allowlist. The staged copy
 * carries a per-file sha256 receipt (and honors the producer-pinned host
 * receipt); the staged tree is verified file-by-file before the swap, and
 * the terminal settings entry is configured BEFORE the swap so a settings
 * failure leaves any existing install untouched.
 */
export function installGrokBuildExtension({
  source,
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = process.env,
  now = () => Date.now(),
  log,
} = {}) {
  let resolvedSource;
  if (trimStr(source)) {
    resolvedSource = validateGrokBuildPackage(path.resolve(trimStr(source)));
    if (!resolvedSource.ok) {
      throw new GrokBuildExtensionError(
        `invalid grok-build-oauth source: ${resolvedSource.error}`,
        { code: "INVALID_SOURCE" },
      );
    }
    resolvedSource.source = "explicit";
  } else {
    resolvedSource = resolveGrokBuildInstallSource({ repoRoot, cocHome, env });
    if (!resolvedSource.ok) {
      const trail = resolvedSource.tried
        .map((t) => `${t.source}(${t.error})`)
        .join("; ");
      throw new GrokBuildExtensionError(
        `no valid grok-build-oauth package found — tried ${trail}. ` +
          "Install it explicitly: node web/server-node/grok-build-extension.mjs install --source <pipiui-bundle>/grok-build-oauth " +
          "(PipiUI app bundle: <PipiUI.app>/Contents/Resources/pipiui-runtime/extensions/grok-build-oauth; " +
          "source checkout: <pipiui>/Electron/resources/runtime/extensions/grok-build-oauth), " +
          `or export ${GROK_BUILD_PACKAGE_ENV}=<dir> / ${PIPIUI_REPO_ROOT_ENV}=<pipiui-root> and re-run.`,
        { code: "NO_SOURCE" },
      );
    }
  }
  const home = resolveCocAgentHome({ repoRoot, cocHome, env });
  const repoRootAbs = path.resolve(repoRoot);
  const extensionsRoot = path.join(home, "extensions");
  const finalDir = path.join(extensionsRoot, INSTALL_DIR_NAME);
  // Producer pin: when the source ships a host receipt, host.js must match it.
  const producer = verifyProducerHostReceipt(resolvedSource.dir, resolvedSource);
  if (!producer.ok) {
    throw new GrokBuildExtensionError(
      `source fails producer host receipt: ${producer.error}`,
      { code: "PRODUCER_RECEIPT_MISMATCH" },
    );
  }
  if (path.resolve(resolvedSource.dir) === path.resolve(finalDir)) {
    // Already installed from itself: re-verify, then (re)configure the entry.
    const verified = verifyInstalledGrokBuildPackage(resolvedSource);
    if (!verified.ok) {
      throw new GrokBuildExtensionError(
        `installed tree fails its receipt: ${verified.error} — reinstall from a valid bundle`,
        { code: "RECEIPT_MISMATCH" },
      );
    }
    const configured = configureTerminalGrokBuildExtension({
      cocHome: home,
      repoRoot: repoRootAbs,
      entryPath: path.join(finalDir, resolvedSource.entryRel),
    });
    log?.("grok_build_install_noop", { dir: finalDir, version: resolvedSource.version });
    return {
      ok: true,
      dir: finalDir,
      version: resolvedSource.version,
      entrySha256: resolvedSource.entrySha256,
      hostEntrySha256: resolvedSource.hostEntrySha256,
      copied: 0,
      noop: true,
      terminalConfigured: configured.configured,
      settingsCreated: configured.created || false,
    };
  }
  // Terminal settings first: the entry path is deterministic, so configuring
  // before the swap means a settings failure leaves the install untouched.
  const configured = configureTerminalGrokBuildExtension({
    cocHome: home,
    repoRoot: repoRootAbs,
    entryPath: path.join(finalDir, CANONICAL_AGENT_ENTRY),
  });
  const stamp = `${process.pid}.${now()}`;
  const stageDir = path.join(extensionsRoot, `.grok-build-oauth.stage.${stamp}`);
  const trashDir = path.join(extensionsRoot, `.grok-build-oauth.trash.${stamp}`);
  rmTree(stageDir);
  rmTree(trashDir);
  try {
    fs.mkdirSync(stageDir, { recursive: true });
    const copied = copyPackageArtifacts(resolvedSource.dir, stageDir);
    const files = copied
      .map((rel) => ({
        path: rel,
        sha256: sha256File(path.join(stageDir, rel)),
        bytes: fs.statSync(path.join(stageDir, rel)).size,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const staged = validateGrokBuildPackage(stageDir);
    if (!staged.ok) {
      throw new GrokBuildExtensionError(`staged copy invalid: ${staged.error}`, {
        code: "STAGE_INVALID",
      });
    }
    if (staged.entrySha256 !== resolvedSource.entrySha256
      || staged.hostEntrySha256 !== resolvedSource.hostEntrySha256) {
      throw new GrokBuildExtensionError("staged entry hash mismatch", { code: "HASH_MISMATCH" });
    }
    const stagedProducer = verifyProducerHostReceipt(stageDir, staged);
    if (!stagedProducer.ok) {
      throw new GrokBuildExtensionError(
        `staged copy fails producer host receipt: ${stagedProducer.error}`,
        { code: "PRODUCER_RECEIPT_MISMATCH" },
      );
    }
    fs.writeFileSync(
      path.join(stageDir, INSTALL_RECEIPT_NAME),
      `${JSON.stringify(
        buildInstallReceipt({
          sourceLabel: resolvedSource.source,
          sourceDir: resolvedSource.dir,
          validated: staged,
          copied,
          files,
          nowMs: now(),
          producerSha: stagedProducer.sha256,
        }),
        null,
        2,
      )}\n`,
    );
    // File-by-file receipt verification of the staged tree before the swap.
    const stagedVerified = verifyInstalledGrokBuildPackage(staged);
    if (!stagedVerified.ok) {
      throw new GrokBuildExtensionError(
        `staged copy fails its own receipt: ${stagedVerified.error}`,
        { code: "STAGE_RECEIPT_MISMATCH" },
      );
    }
    fs.mkdirSync(extensionsRoot, { recursive: true });
    const hadPrevious = fs.existsSync(finalDir);
    if (hadPrevious) {
      fs.renameSync(finalDir, trashDir);
    }
    try {
      fs.renameSync(stageDir, finalDir);
    } catch (err) {
      if (hadPrevious) {
        fs.renameSync(trashDir, finalDir);
      }
      throw err;
    }
    rmTree(trashDir);
    log?.("grok_build_install", {
      dir: finalDir,
      version: staged.version,
      entry_sha256: staged.entrySha256,
      host_entry_sha256: staged.hostEntrySha256,
      copied_files: copied.length,
      replaced: hadPrevious,
      settings_created: configured.created || false,
    });
    return {
      ok: true,
      dir: finalDir,
      version: staged.version,
      entrySha256: staged.entrySha256,
      hostEntrySha256: staged.hostEntrySha256,
      copied: copied.length,
      noop: false,
      terminalConfigured: configured.configured,
      settingsCreated: configured.created || false,
    };
  } finally {
    rmTree(stageDir);
    rmTree(trashDir);
  }
}

/**
 * Register the installed entry in the repo-local Pi home's official
 * `settings.json` `extensions` key (Pi 0.84.2 loads plain absolute paths from
 * there; it has no `pipiui-extension.json` manifest discovery). A missing
 * settings.json is created atomically with the same bootstrap shape the
 * pi-coc launcher writes (packages pinned to the repo, plus the entry), so a
 * fresh checkout is fully wired by the installer alone; an existing file is
 * amended with every other key preserved. The write is atomic (tmp + rename)
 * and idempotent. Never touches the shared `pi-coc` launcher.
 */
export function configureTerminalGrokBuildExtension({ cocHome, entryPath, repoRoot } = {}) {
  const home = resolveCocAgentHome({ cocHome });
  const settingsPath = path.join(home, "settings.json");
  let settings;
  let created = false;
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch (err) {
      throw new GrokBuildExtensionError(
        `cannot read ${settingsPath}: ${err?.message || err} — leaving it untouched`,
        { code: "SETTINGS_UNREADABLE" },
      );
    }
    if (!asObject(settings)) {
      throw new GrokBuildExtensionError(`${settingsPath} is not a JSON object`, {
        code: "SETTINGS_UNREADABLE",
      });
    }
  } else {
    // Fresh checkout bootstrap (mirrors the pi-coc launcher's attached-UI
    // bootstrap): packages pinned to this repo; default provider/model seeded
    // from models.json when present; the extension entry appended below.
    settings = {
      packages: [path.resolve(repoRoot || DEFAULT_REPO_ROOT)],
      theme: "light",
      quietStartup: true,
    };
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(home, "models.json"), "utf8"));
      const providers = raw.providers && typeof raw.providers === "object" ? raw.providers : raw;
      const ids = Object.keys(providers || {});
      if (ids.length) {
        settings.defaultProvider = ids[0];
        const models = providers[ids[0]] && providers[ids[0]].models;
        if (Array.isArray(models) && models[0] && models[0].id) {
          settings.defaultModel = models[0].id;
        }
      }
    } catch {
      /* models.json is optional; set_model from the UI fills this in */
    }
    created = true;
  }
  const entry = path.resolve(entryPath);
  const list = Array.isArray(settings.extensions)
    ? settings.extensions.map((value) => trimStr(value)).filter(Boolean)
    : [];
  if (list.includes(entry) && !created) {
    return { settingsPath, configured: true, added: false, created: false, extensions: list };
  }
  const nextSettings = created || !list.includes(entry)
    ? { ...settings, extensions: [...list, entry] }
    : settings;
  const tmp = `${settingsPath}.tmp.${process.pid}.${Date.now()}`;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(nextSettings, null, 2)}\n`);
  fs.renameSync(tmp, settingsPath);
  return {
    settingsPath,
    configured: true,
    added: true,
    created,
    extensions: nextSettings.extensions,
  };
}

/**
 * Drop manifest-declared secret settings (format: "secret") plus any
 * token-like key. Snapshots injected into child env can never carry
 * credentials.
 */
export function sanitizeGrokBuildSettingsSnapshot(snapshot, { manifest } = {}) {
  const obj = asObject(snapshot);
  if (!obj) return undefined;
  const schemaProps = asObject(
    asObject(asObject(manifest?.app)?.settings)?.schema,
  )?.properties;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const name = String(key || "");
    if (SECRET_KEY_RE.test(name)) continue;
    const declared = asObject(schemaProps?.[name]);
    if (declared?.format === "secret") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[name] = value;
    }
  }
  return out;
}

/** User-editable non-secret settings sidecar next to the installed dir. */
export function grokBuildSettingsSidecarPath({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = {},
} = {}) {
  const extensionsRoot = path.dirname(
    installedGrokBuildDir({ repoRoot, cocHome, env }),
  );
  return path.join(extensionsRoot, INSTALL_SETTINGS_SIDECAR);
}

function readGrokBuildSettingsSidecar({ repoRoot, cocHome, env } = {}) {
  try {
    return asObject(
      JSON.parse(fs.readFileSync(grokBuildSettingsSidecarPath({ repoRoot, cocHome, env }), "utf8")),
    );
  } catch {
    return undefined;
  }
}

/**
 * Settings snapshot for the child env. A host-minted parent value (PipiUI
 * §5.5) wins over the repo-local sidecar; either way the snapshot is
 * sanitized so `format: secret` / token-like keys never survive. Empty
 * snapshots remove the env var entirely.
 */
export function applyGrokBuildExtensionSettingsEnv(env, { repoRoot = DEFAULT_REPO_ROOT, cocHome } = {}) {
  if (!env || typeof env !== "object") return env;
  let snapshot;
  const raw = trimStr(env[GROK_BUILD_SETTINGS_ENV]);
  if (raw) {
    try {
      snapshot = JSON.parse(raw);
    } catch {
      snapshot = undefined;
    }
  }
  if (!snapshot) {
    snapshot = readGrokBuildSettingsSidecar({ repoRoot, cocHome, env: {} });
  }
  const installed = resolveInstalledGrokBuildPackage({ repoRoot, cocHome, env: {} });
  const sanitized = sanitizeGrokBuildSettingsSnapshot(snapshot, {
    manifest: installed.ok ? installed.manifest : undefined,
  });
  if (sanitized && Object.keys(sanitized).length) {
    env[GROK_BUILD_SETTINGS_ENV] = JSON.stringify(sanitized);
  } else {
    delete env[GROK_BUILD_SETTINGS_ENV];
  }
  return env;
}

/**
 * `--extension` mount args for new pi-coc RPC sessions: repo-local install
 * only, skipped when a PipiUI host spawn already mounted the extension id.
 */
export function grokBuildExtensionMountArgs({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = process.env,
} = {}) {
  if (grokBuildMountedViaHostEnv(env)) return [];
  const installed = resolveInstalledGrokBuildPackage({ repoRoot, cocHome, env: {} });
  if (!installed.ok) return [];
  return ["--extension", installed.entryPath];
}

/**
 * Resolve the installed agent entry for spawn mounting (null when absent).
 */
export function installedGrokBuildExtensionEntry({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = process.env,
} = {}) {
  if (grokBuildMountedViaHostEnv(env)) return null;
  const installed = resolveInstalledGrokBuildPackage({ repoRoot, cocHome, env: {} });
  if (!installed.ok) return null;
  return {
    entryPath: installed.entryPath,
    version: installed.version,
    entrySha256: installed.entrySha256,
  };
}

async function importInstalledModule(relPath, { repoRoot, cocHome, env } = {}) {
  const installed = resolveInstalledGrokBuildPackage({ repoRoot, cocHome, env: {} });
  if (!installed.ok) return null;
  const file = path.join(installed.dir, relPath);
  let lstat;
  try {
    lstat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) return null;
  // Cache-bust by the imported file's OWN hash (not just the entry's): a
  // stage-swap install changes file content under the same path, and the
  // Node ESM cache is URL-keyed.
  const url = `${pathToFileURL(file).href}?v=${sha256File(file)}`;
  try {
    return {
      dir: installed.dir,
      version: installed.version,
      module: await import(url),
    };
  } catch {
    return null;
  }
}

/**
 * Compat-fallback gate (spec D6 / US-27): the deprecated legacy xAI
 * API-key / loopback-relay portrait paths are usable ONLY when the user
 * explicitly enabled `ext.grok-build-oauth.compatFallback` (default off).
 * A host-minted settings snapshot env (PipiUI §5.5) wins over the
 * repo-local sidecar.
 */
export function grokBuildCompatFallbackEnabled({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = {},
} = {}) {
  let snapshot;
  const raw = trimStr(env?.[GROK_BUILD_SETTINGS_ENV]);
  if (raw) {
    try {
      snapshot = JSON.parse(raw);
    } catch {
      snapshot = undefined;
    }
  }
  if (!snapshot) {
    snapshot = readGrokBuildSettingsSidecar({ repoRoot, cocHome, env: {} });
  }
  return asObject(snapshot)?.["ext.grok-build-oauth.compatFallback"] === true;
}

/**
 * Canonical host library from the installed artifact: dynamically imports
 * the manifest-declared `host.entry` (`agent/dist/host.js`) after receipt
 * verification. Its stable host API (`createGrokBuildHostLibrary`) is the
 * ONLY canonical image path for out-of-session consumers — the broker
 * (early refresh / 401 single retry / cross-process lock), tier gate,
 * resolution=1k, `x-grok-session-id`, and typed results all live in the
 * single-source package. This repo never re-implements them.
 */
export async function loadGrokBuildHostLibrary({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = process.env,
} = {}) {
  const installed = resolveInstalledGrokBuildPackage({ repoRoot, cocHome, env: {} });
  if (!installed.ok) return null;
  const loaded = await importInstalledModule(installed.hostEntryRel, { repoRoot, cocHome, env });
  if (!loaded || typeof loaded.module.createGrokBuildHostLibrary !== "function") return null;
  return {
    dir: installed.dir,
    version: installed.version,
    hostEntryPath: installed.hostEntryPath,
    hostEntrySha256: installed.hostEntrySha256,
    createHostLibrary: loaded.module.createGrokBuildHostLibrary,
  };
}

/** Provider factory from the installed artifact (host ModelRuntime login). */
export async function loadGrokBuildProviderFactory({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = process.env,
} = {}) {
  const loaded = await importInstalledModule(path.join("agent", "dist", "provider.js"), {
    repoRoot,
    cocHome,
    env,
  });
  if (!loaded) return null;
  const { createGrokBuildProvider, GROK_BUILD_PROVIDER_ID: providerId } = loaded.module;
  if (typeof createGrokBuildProvider !== "function") return null;
  return {
    dir: loaded.dir,
    version: loaded.version,
    createGrokBuildProvider,
    providerId: trimStr(providerId) || GROK_BUILD_PROVIDER_ID,
  };
}

export function grokBuildExtensionStatus({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = process.env,
} = {}) {
  const installed = resolveInstalledGrokBuildPackage({ repoRoot, cocHome, env: {} });
  const home = resolveCocAgentHome({ repoRoot, cocHome, env: {} });
  const settingsPath = path.join(home, "settings.json");
  let terminalConfigured = false;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    terminalConfigured = Array.isArray(settings.extensions)
      && settings.extensions.some(
        (value) => typeof value === "string" && path.resolve(value) === path.resolve(installed.entryPath || ""),
      );
  } catch {
    terminalConfigured = false;
  }
  const compatFallback = grokBuildCompatFallbackEnabled({ repoRoot, cocHome, env: {} });
  // What a compatFallback=true setting would actually unlock (mirrors the
  // xai-image allow-list): tier gate / auth unconfigured / host unavailable.
  const compatFallbackAllowlist = ["tier_restricted", "auth_expired", "not_logged_in", "NoAgentHomeError"];
  return {
    installed: installed.ok,
    verified: installed.ok && installed.verified === true,
    installDir: installed.dir,
    version: installed.ok ? installed.version : null,
    entryPath: installed.ok ? installed.entryPath : null,
    entrySha256: installed.ok ? installed.entrySha256 : null,
    hostEntryPath: installed.ok ? installed.hostEntryPath : null,
    hostEntrySha256: installed.ok ? installed.hostEntrySha256 : null,
    producerHostReceiptSha256: installed.ok ? installed.receipt?.producer_host_receipt_sha256 ?? null : null,
    mountedViaHostEnv: grokBuildMountedViaHostEnv(env),
    terminalConfigured,
    compatFallback,
    compatFallbackAllowlist,
    cocHome: home,
    settingsPath,
    sidecarPath: grokBuildSettingsSidecarPath({ repoRoot, cocHome, env: {} }),
    receipt: installed.ok ? installed.receipt ?? null : null,
    error: installed.ok ? null : installed.error,
  };
}

/**
 * Installer CLI:
 *   install [--source DIR] [--coc-home DIR] [--repo-root DIR]  — exit 0 only
 *     when a valid package was actually installed (or verified no-op) AND the
 *     terminal settings entry exists; exit 1 with instructions otherwise.
 *   status [--coc-home DIR] [--repo-root DIR]
 */
export function runGrokBuildInstallerCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const flag = (name) => {
    const idx = argv.indexOf(name);
    if (idx === -1) return "";
    const value = trimStr(argv[idx + 1]);
    return value && !value.startsWith("--") ? value : "";
  };
  const command = trimStr(argv[0]) || "status";
  const repoRoot = flag("--repo-root") ? path.resolve(flag("--repo-root")) : DEFAULT_REPO_ROOT;
  const cocHome = flag("--coc-home");
  const write = (stream, obj) => stream.write(`${JSON.stringify(obj, null, 2)}\n`);
  if (command === "status") {
    write(stdout, grokBuildExtensionStatus({ repoRoot, cocHome, env }));
    return 0;
  }
  if (command === "install") {
    const source = flag("--source") || trimStr(env[GROK_BUILD_PACKAGE_ENV]);
    try {
      const result = installGrokBuildExtension({
        source,
        repoRoot,
        cocHome,
        env,
        log: (event, fields) => write(stdout, { event, ...fields }),
      });
      write(stdout, { ok: true, ...result });
      if (!result.terminalConfigured) {
        write(stderr, {
          ok: false,
          error: "install finished but the terminal settings entry is missing",
        });
        return 1;
      }
      return 0;
    } catch (err) {
      write(stderr, { ok: false, error: String(err?.message || err), code: err?.code });
      return 1;
    }
  }
  stderr.write(
    "usage: grok-build-extension.mjs install [--source DIR] [--coc-home DIR] [--repo-root DIR]\n" +
      "       grok-build-extension.mjs status [--coc-home DIR] [--repo-root DIR]\n" +
      "source resolution: --source / GROK_BUILD_OAUTH_PACKAGE > PipiUI bundled runtime\n" +
      "  (PIPIUI_REPO_ROOT, or sibling ../pipiui checkout).\n",
  );
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runGrokBuildInstallerCli();
}
