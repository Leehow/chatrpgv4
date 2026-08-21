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
 * Validate one built package directory: manifest id/version shape, agent
 * entry declared by the manifest, entry file exists, and the declared entry
 * does not escape the package dir (path traversal guard).
 */
export function validateGrokBuildPackage(packageDir) {
  const dir = path.resolve(String(packageDir || ""));
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, dir, error: "package directory not found" };
  }
  const manifestPath = path.join(dir, MANIFEST_NAME);
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
  if (!entryRel || entryRel.includes("\0")) {
    return { ok: false, dir, error: "manifest agent.extension missing" };
  }
  const entryPath = path.resolve(dir, entryRel);
  if (!isInsideDir(dir, entryPath)) {
    return { ok: false, dir, error: "manifest agent.extension escapes the package directory" };
  }
  let stat;
  try {
    stat = fs.statSync(entryPath);
  } catch {
    return { ok: false, dir, error: `agent entry missing: ${entryRel}` };
  }
  if (!stat.isFile()) {
    return { ok: false, dir, error: `agent entry is not a file: ${entryRel}` };
  }
  return {
    ok: true,
    dir,
    manifest,
    version,
    entryRel,
    entryPath,
    entrySha256: sha256File(entryPath),
  };
}

/**
 * Runtime resolution: the repo-local installed package ONLY. Deterministic
 * per checkout; spawn mounts and compat consumers never reach for a sibling
 * PipiUI checkout implicitly.
 */
export function resolveInstalledGrokBuildPackage({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = {},
} = {}) {
  const dir = installedGrokBuildDir({ repoRoot, cocHome, env });
  if (!fs.existsSync(dir)) return { ok: false, dir, error: "not installed" };
  const validated = validateGrokBuildPackage(dir);
  return validated;
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
  for (const name of COPY_ALLOWLIST) {
    const file = path.join(sourceDir, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) rels.push(name);
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
 * Install the canonical build artifact into the repo-local COC home with an
 * atomic stage-swap. Only build outputs and manifests are copied — never TS
 * sources, node_modules, or anything outside the allowlist. The staged copy
 * is hash-verified against the source entry before the swap; any failure
 * leaves an existing install untouched.
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
        `no valid grok-build-oauth package found — tried ${trail}`,
        { code: "NO_SOURCE" },
      );
    }
  }
  const home = resolveCocAgentHome({ repoRoot, cocHome, env });
  const extensionsRoot = path.join(home, "extensions");
  const finalDir = path.join(extensionsRoot, INSTALL_DIR_NAME);
  if (path.resolve(resolvedSource.dir) === path.resolve(finalDir)) {
    // Already installed from itself: just (re)configure the terminal entry.
    const configured = configureTerminalGrokBuildExtension({ cocHome: home, entryPath: resolvedSource.entryPath });
    log?.("grok_build_install_noop", { dir: finalDir, version: resolvedSource.version });
    return {
      ok: true,
      dir: finalDir,
      version: resolvedSource.version,
      entrySha256: resolvedSource.entrySha256,
      copied: 0,
      noop: true,
      terminalConfigured: configured.configured,
    };
  }
  const stamp = `${process.pid}.${now()}`;
  const stageDir = path.join(extensionsRoot, `.grok-build-oauth.stage.${stamp}`);
  const trashDir = path.join(extensionsRoot, `.grok-build-oauth.trash.${stamp}`);
  rmTree(stageDir);
  rmTree(trashDir);
  try {
    fs.mkdirSync(stageDir, { recursive: true });
    const copied = copyPackageArtifacts(resolvedSource.dir, stageDir);
    fs.writeFileSync(
      path.join(stageDir, INSTALL_RECEIPT_NAME),
      `${JSON.stringify(
        {
          installed_at: new Date(now()).toISOString(),
          source: resolvedSource.source,
          source_dir: resolvedSource.dir,
          version: resolvedSource.version,
          entry_sha256: resolvedSource.entrySha256,
          copied_files: copied.length,
        },
        null,
        2,
      )}\n`,
    );
    const staged = validateGrokBuildPackage(stageDir);
    if (!staged.ok) {
      throw new GrokBuildExtensionError(`staged copy invalid: ${staged.error}`, {
        code: "STAGE_INVALID",
      });
    }
    if (staged.entrySha256 !== resolvedSource.entrySha256) {
      throw new GrokBuildExtensionError("staged entry hash mismatch", { code: "HASH_MISMATCH" });
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
    // Register the FINAL entry path (the stage dir no longer exists).
    const configured = configureTerminalGrokBuildExtension({
      cocHome: home,
      entryPath: path.join(finalDir, staged.entryRel),
    });
    log?.("grok_build_install", {
      dir: finalDir,
      version: staged.version,
      entry_sha256: staged.entrySha256,
      copied_files: copied.length,
      replaced: hadPrevious,
    });
    return {
      ok: true,
      dir: finalDir,
      version: staged.version,
      entrySha256: staged.entrySha256,
      copied: copied.length,
      noop: false,
      terminalConfigured: configured.configured,
    };
  } finally {
    rmTree(stageDir);
    rmTree(trashDir);
  }
}

/**
 * Register the installed entry in the repo-local Pi home's official
 * `settings.json` `extensions` key (Pi 0.84.2 loads plain absolute paths from
 * there; it has no `pipiui-extension.json` manifest discovery). All other
 * settings keys are preserved; the write is atomic (tmp + rename) and
 * idempotent. Never touches the shared `pi-coc` launcher.
 */
export function configureTerminalGrokBuildExtension({ cocHome, entryPath }) {
  const home = resolveCocAgentHome({ cocHome });
  const settingsPath = path.join(home, "settings.json");
  // Never create settings.json ourselves: the terminal pi-coc bootstrap owns
  // first creation (packages/theme/model). We only amend an existing file.
  if (!fs.existsSync(settingsPath)) {
    return {
      settingsPath,
      configured: false,
      added: false,
      reason: "settings-missing (terminal pi-coc will bootstrap it; re-run install after first launch)",
    };
  }
  let settings;
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
  const entry = path.resolve(entryPath);
  const list = Array.isArray(settings.extensions)
    ? settings.extensions.map((value) => trimStr(value)).filter(Boolean)
    : [];
  if (list.includes(entry)) {
    return { settingsPath, configured: true, added: false, extensions: list };
  }
  const nextSettings = { ...settings, extensions: [...list, entry] };
  const tmp = `${settingsPath}.tmp.${process.pid}.${Date.now()}`;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(nextSettings, null, 2)}\n`);
  fs.renameSync(tmp, settingsPath);
  return { settingsPath, configured: true, added: true, extensions: nextSettings.extensions };
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
  if (!fs.existsSync(file)) return null;
  // Cache-bust by artifact hash: a stage-swap install changes file content
  // under the same path, and the Node ESM cache is URL-keyed.
  const url = `${pathToFileURL(file).href}?v=${installed.entrySha256}`;
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
 * Canonical broker + images-config modules from the installed artifact
 * (refresh/dedup/lock lifecycle stays in the single source package; this
 * repo never re-implements it).
 */
export async function loadGrokBuildRuntimeModules({
  repoRoot = DEFAULT_REPO_ROOT,
  cocHome,
  env = process.env,
} = {}) {
  const [broker, images] = await Promise.all([
    importInstalledModule(path.join("agent", "dist", "oauth", "broker.js"), { repoRoot, cocHome, env }),
    importInstalledModule(path.join("agent", "dist", "images", "config.js"), { repoRoot, cocHome, env }),
  ]);
  if (!broker || typeof broker.module.createBroker !== "function") return null;
  return {
    dir: broker.dir,
    version: broker.version,
    createBroker: broker.module.createBroker,
    resolveImagesConfig:
      typeof images?.module.resolveImagesConfig === "function"
        ? images.module.resolveImagesConfig
        : undefined,
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
  let receipt = null;
  if (installed.ok) {
    try {
      receipt = JSON.parse(
        fs.readFileSync(path.join(installed.dir, INSTALL_RECEIPT_NAME), "utf8"),
      );
    } catch {
      receipt = null;
    }
  }
  return {
    installed: installed.ok,
    installDir: installed.dir,
    version: installed.ok ? installed.version : null,
    entryPath: installed.ok ? installed.entryPath : null,
    entrySha256: installed.ok ? installed.entrySha256 : null,
    mountedViaHostEnv: grokBuildMountedViaHostEnv(env),
    terminalConfigured,
    cocHome: home,
    settingsPath,
    sidecarPath: grokBuildSettingsSidecarPath({ repoRoot, cocHome, env: {} }),
    receipt,
    error: installed.ok ? null : installed.error,
  };
}

/** Installer CLI: `install [--source DIR] [--coc-home DIR] [--repo-root DIR]` / `status`. */
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
      return 0;
    } catch (err) {
      write(stderr, { ok: false, error: String(err?.message || err), code: err?.code });
      return 1;
    }
  }
  stderr.write(`usage: grok-build-extension.mjs install [--source DIR] [--coc-home DIR] [--repo-root DIR]\n       grok-build-extension.mjs status [--coc-home DIR] [--repo-root DIR]\n`);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runGrokBuildInstallerCli();
}
