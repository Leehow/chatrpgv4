import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  GROK_BUILD_EXTENSION_ID,
  GROK_BUILD_PACKAGE_ENV,
  GROK_BUILD_SETTINGS_ENV,
  MOUNTED_EXTENSIONS_ENV,
  PIPIUI_REPO_ROOT_ENV,
  GrokBuildExtensionError,
  applyGrokBuildExtensionSettingsEnv,
  configureTerminalGrokBuildExtension,
  grokBuildCompatFallbackEnabled,
  grokBuildExtensionMountArgs,
  grokBuildExtensionStatus,
  installGrokBuildExtension,
  resolveGrokBuildInstallSource,
  resolveInstalledGrokBuildPackage,
  sanitizeGrokBuildSettingsSnapshot,
  validateGrokBuildPackage,
  verifyInstalledGrokBuildPackage,
  runGrokBuildInstallerCli,
} from "../grok-build-extension.mjs";
import {
  XaiImageError,
  generateCampaignPortrait,
  hostErrorAllowsCompatFallback,
  resolveXaiImageTransport,
} from "../xai-image.mjs";
import { buildChildEnv, buildPiCocArgs } from "../pi-coc-rpc.mjs";
import { FEATURED_OAUTH, providerSummary } from "../model-editor.mjs";
import { registerGrokBuildProviderOnRuntime } from "../provider-login.mjs";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function sha256Of(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const FIXTURE_MANIFEST = {
  id: GROK_BUILD_EXTENSION_ID,
  name: "Grok Build",
  version: "0.1.0",
  agent: { extension: "agent/dist/index.js" },
  host: { entry: "agent/dist/host.js" },
  app: {
    settings: {
      scope: "app",
      schema: {
        type: "object",
        properties: {
          "ext.grok-build-oauth.compatFallback": { type: "boolean", default: false },
          "ext.grok-build-oauth.defaultModel": { type: "string", default: "grok-imagine-image-quality" },
          "ext.grok-build-oauth.accessToken": { type: "string", format: "secret" },
        },
      },
    },
  },
};

const STUB_PROVIDER_JS = `export const GROK_BUILD_PROVIDER_ID = "grok-build";
export function createGrokBuildProvider() {
  return { name: "Grok Build", api: "openai-completions", models: [], oauth: { name: "Grok Build" } };
}
`;

/**
 * Stub host library mirroring the real host-entry contract
 * (`createGrokBuildHostLibrary`). Behavior is driven by a JSON state file at
 * `authPath + ".host-stub"` so each test controls usable/error paths.
 */
const STUB_HOST_JS = `import fs from "node:fs";
function readState(authPath) {
  const base = { usable: false, loggedIn: false, expired: false };
  try { return { ...base, ...JSON.parse(fs.readFileSync(authPath + ".host-stub", "utf8")) }; }
  catch { return base; }
}
export function createGrokBuildHostLibrary(options = {}) {
  const authPath = options.authPath ?? "";
  return {
    async status() {
      const s = readState(authPath);
      return { loggedIn: !!s.loggedIn, expired: !!s.expired, hasRefresh: false, usable: !!s.usable };
    },
    async generateImage(req) {
      const s = readState(authPath);
      if (s.generateError) {
        const err = new Error(s.generateError.message);
        err.code = s.generateError.code;
        throw err;
      }
      const png = s.pngB64 || ${JSON.stringify(PNG_B64)};
      return {
        bytes: Buffer.from(png, "base64"),
        b64: png,
        mime: "image/png",
        path: "/tmp/attachments/stub.png",
        model: s.model || "grok-imagine-image-quality",
        backend: s.backend || "grok-build",
      };
    },
    async editImage(req) { return this.generateImage(req); },
    broker() { throw new Error("not used by the stub"); },
  };
}
export const HOST_LIBRARY_VERSION = "1.0.0";
`;

function makeBuiltPackage(dir, { manifest = FIXTURE_MANIFEST, hostReceipt } = {}) {
  writeJson(path.join(dir, "pipiui-extension.json"), manifest);
  writeJson(path.join(dir, "package.json"), {
    name: "@pipiui/grok-build-oauth-extension",
    version: manifest.version,
    private: true,
    type: "module",
  });
  writeText(path.join(dir, "README.md"), "# fixture\n");
  writeText(path.join(dir, "agent/dist/index.js"), "export default function () {}\n");
  writeText(path.join(dir, "agent/dist/host.js"), STUB_HOST_JS);
  writeText(path.join(dir, "agent/dist/provider.js"), STUB_PROVIDER_JS);
  writeText(path.join(dir, "app/dist/panel.js"), "export default function () {}\n");
  if (hostReceipt !== undefined) {
    writeJson(path.join(dir, "pipiui-host-receipt.json"), hostReceipt);
  }
  // Source + deps that must never be copied.
  writeText(path.join(dir, "agent/index.ts"), "export default function () {}\n");
  writeText(path.join(dir, "node_modules/dep/index.js"), "export {};\n");
  return dir;
}

function withHostReceipt(dir, overrides = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "pipiui-extension.json"), "utf8"));
  const hostFile = path.join(dir, manifest.host.entry);
  return {
    version: 1,
    extensionId: GROK_BUILD_EXTENSION_ID,
    manifestVersion: manifest.version,
    hostEntry: manifest.host.entry,
    sha256: sha256Of(hostFile),
    bytes: fs.statSync(hostFile).size,
    generatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

function installedDirOf(repoRoot) {
  return path.join(repoRoot, ".pi", "coc-agent", "extensions", GROK_BUILD_EXTENSION_ID);
}

function installedEntryOf(repoRoot) {
  return path.join(installedDirOf(repoRoot), "agent", "dist", "index.js");
}

function compatEnv(extra = {}) {
  return {
    [GROK_BUILD_SETTINGS_ENV]: JSON.stringify({ "ext.grok-build-oauth.compatFallback": true }),
    ...extra,
  };
}

// ---------------------------------------------------------------- validation

test("validateGrokBuildPackage accepts a built package with canonical entries and hashes both", () => {
  const src = makeBuiltPackage(tempDir("grok-pkg-ok-"));
  try {
    const result = validateGrokBuildPackage(src);
    assert.equal(result.ok, true);
    assert.equal(result.version, "0.1.0");
    assert.equal(result.entryPath, path.join(src, "agent/dist/index.js"));
    assert.equal(result.hostEntryPath, path.join(src, "agent/dist/host.js"));
    assert.match(result.entrySha256, /^[0-9a-f]{64}$/);
    assert.match(result.hostEntrySha256, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test("validateGrokBuildPackage rejects wrong id, bad version, noncanonical and missing entries", () => {
  const root = tempDir("grok-pkg-bad-");
  try {
    const wrongId = makeBuiltPackage(path.join(root, "wrong-id"), {
      manifest: { ...FIXTURE_MANIFEST, id: "other-extension" },
    });
    assert.match(validateGrokBuildPackage(wrongId).error, /manifest id mismatch/);

    const badVersion = makeBuiltPackage(path.join(root, "bad-version"), {
      manifest: { ...FIXTURE_MANIFEST, version: "latest" },
    });
    assert.match(validateGrokBuildPackage(badVersion).error, /version invalid/);

    // Noncanonical agent entry declared by the manifest must be refused.
    const noncanonical = makeBuiltPackage(path.join(root, "noncanonical"), {
      manifest: {
        ...FIXTURE_MANIFEST,
        agent: { extension: "agent/dist/provider.js" },
      },
    });
    assert.match(validateGrokBuildPackage(noncanonical).error, /agent\.extension must be agent\/dist\/index\.js/);

    // Missing host entry declaration.
    const noHost = makeBuiltPackage(path.join(root, "no-host"), {
      manifest: { ...FIXTURE_MANIFEST, host: undefined },
    });
    const noHostResult = validateGrokBuildPackage(noHost);
    assert.equal(noHostResult.ok, false);
    assert.match(noHostResult.error, /host\.entry must be agent\/dist\/host\.js/);

    // Host entry declared but file missing.
    const missingHostFile = makeBuiltPackage(path.join(root, "missing-host-file"));
    fs.rmSync(path.join(missingHostFile, "agent/dist/host.js"));
    assert.match(validateGrokBuildPackage(missingHostFile).error, /host\.js missing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("validateGrokBuildPackage rejects symlinked package dir, manifest, and entries", () => {
  const root = tempDir("grok-pkg-symlink-");
  try {
    const real = makeBuiltPackage(path.join(root, "real"));
    // Package dir itself a symlink.
    fs.symlinkSync(real, path.join(root, "pkg-link"));
    assert.match(validateGrokBuildPackage(path.join(root, "pkg-link")).error, /symlink/);

    // Manifest symlinked to an outside file.
    const manifestSwap = makeBuiltPackage(path.join(root, "manifest-swap"));
    fs.rmSync(path.join(manifestSwap, "pipiui-extension.json"));
    fs.symlinkSync(
      path.join(real, "pipiui-extension.json"),
      path.join(manifestSwap, "pipiui-extension.json"),
    );
    assert.match(validateGrokBuildPackage(manifestSwap).error, /pipiui-extension\.json is a symlink/);

    // Agent entry symlinked to a file OUTSIDE the package (realpath escape).
    const entrySwap = makeBuiltPackage(path.join(root, "entry-swap"));
    fs.rmSync(path.join(entrySwap, "agent/dist/index.js"));
    fs.symlinkSync(
      path.join(real, "agent/dist/index.js"),
      path.join(entrySwap, "agent/dist/index.js"),
    );
    const entryResult = validateGrokBuildPackage(entrySwap);
    assert.equal(entryResult.ok, false);
    assert.match(entryResult.error, /agent\/dist\/index\.js is a symlink/);

    // Host entry symlinked outside.
    const hostSwap = makeBuiltPackage(path.join(root, "host-swap"));
    fs.rmSync(path.join(hostSwap, "agent/dist/host.js"));
    fs.symlinkSync(
      path.join(real, "agent/dist/host.js"),
      path.join(hostSwap, "agent/dist/host.js"),
    );
    const hostResult = validateGrokBuildPackage(hostSwap);
    assert.equal(hostResult.ok, false);
    assert.match(hostResult.error, /agent\/dist\/host\.js is a symlink/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- source lookup

test("resolveGrokBuildInstallSource prefers explicit env then PipiUI bundled runtime", () => {
  const root = tempDir("grok-src-order-");
  try {
    const explicit = makeBuiltPackage(path.join(root, "explicit"));
    const bundled = makeBuiltPackage(
      path.join(root, "pipiui", "Electron", "resources", "runtime", "extensions", GROK_BUILD_EXTENSION_ID),
    );
    const env = { [GROK_BUILD_PACKAGE_ENV]: explicit, [PIPIUI_REPO_ROOT_ENV]: path.join(root, "pipiui") };
    const fromEnv = resolveGrokBuildInstallSource({ repoRoot: root, env });
    assert.equal(fromEnv.ok, true);
    assert.equal(fromEnv.dir, explicit);

    const fromBundled = resolveGrokBuildInstallSource({
      repoRoot: root,
      env: { [PIPIUI_REPO_ROOT_ENV]: path.join(root, "pipiui") },
    });
    assert.equal(fromBundled.ok, true);
    assert.equal(fromBundled.dir, bundled);

    const none = resolveGrokBuildInstallSource({ repoRoot: root, env: {} });
    assert.equal(none.ok, false);
    assert.ok(none.tried.length >= 2); // sibling pipiui probe + repo-local
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- installer

test("install copies only build artifacts, writes a per-file receipt, and verifies it", () => {
  const root = tempDir("grok-install-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    const result = installGrokBuildExtension({ source, repoRoot, env: {} });
    assert.equal(result.ok, true);
    assert.equal(result.noop, false);
    assert.equal(result.settingsCreated, true); // fresh checkout: settings created
    const installedDir = installedDirOf(repoRoot);
    assert.equal(fs.existsSync(path.join(installedDir, "pipiui-extension.json")), true);
    assert.equal(fs.existsSync(path.join(installedDir, "agent/dist/index.js")), true);
    assert.equal(fs.existsSync(path.join(installedDir, "agent/dist/host.js")), true);
    assert.equal(fs.existsSync(path.join(installedDir, ".install-receipt.json")), true);
    // No source, no deps.
    assert.equal(fs.existsSync(path.join(installedDir, "agent/index.ts")), false);
    assert.equal(fs.existsSync(path.join(installedDir, "node_modules")), false);
    const receipt = JSON.parse(fs.readFileSync(path.join(installedDir, ".install-receipt.json"), "utf8"));
    assert.equal(receipt.schema, 2);
    assert.equal(receipt.extension_id, GROK_BUILD_EXTENSION_ID);
    assert.equal(receipt.version, "0.1.0");
    assert.ok(Array.isArray(receipt.files) && receipt.files.length >= 6);
    for (const file of receipt.files) {
      assert.equal(
        sha256Of(path.join(installedDir, file.path)),
        file.sha256,
        `receipt hash mismatch for ${file.path}`,
      );
    }
    // No stage/trash residue.
    const extensionsRoot = path.dirname(installedDir);
    assert.deepEqual(
      fs.readdirSync(extensionsRoot).filter((name) => name.startsWith(".")),
      [],
    );

    // Runtime resolution reports verified against the receipt.
    const resolved = resolveInstalledGrokBuildPackage({ repoRoot, env: {} });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.verified, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("install upgrades via stage-swap and is a receipt-verified no-op from itself", () => {
  const root = tempDir("grok-upgrade-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    installGrokBuildExtension({ source, repoRoot, env: {} });

    writeText(path.join(source, "agent/dist/index.js"), "export default function () { /* v2 */ }\n");
    writeText(path.join(source, "agent/dist/host.js"), STUB_HOST_JS.replace("HOST_LIBRARY_VERSION", "HOST_LIBRARY_VERSION_V2"));
    const upgraded = installGrokBuildExtension({ source, repoRoot, env: {} });
    assert.equal(upgraded.ok, true);
    assert.equal(fs.readFileSync(installedEntryOf(repoRoot), "utf8").includes("v2"), true);
    assert.deepEqual(
      fs.readdirSync(path.dirname(installedDirOf(repoRoot))).filter((name) => name.startsWith(".")),
      [],
    );

    const rerun = installGrokBuildExtension({ source: installedDirOf(repoRoot), repoRoot, env: {} });
    assert.equal(rerun.ok, true);
    assert.equal(rerun.noop, true);
    assert.equal(rerun.copied, 0);
    assert.equal(rerun.terminalConfigured, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("install failures leave an existing install untouched", () => {
  const root = tempDir("grok-install-fail-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    installGrokBuildExtension({ source, repoRoot, env: {} });
    const before = fs.readFileSync(installedEntryOf(repoRoot), "utf8");

    assert.throws(
      () => installGrokBuildExtension({ source: path.join(root, "nope"), repoRoot, env: {} }),
      GrokBuildExtensionError,
    );
    assert.equal(fs.readFileSync(installedEntryOf(repoRoot), "utf8"), before);

    // Symlink inside the copy set is rejected (path traversal guard).
    const badSource = makeBuiltPackage(path.join(root, "bad-source"));
    fs.rmSync(path.join(badSource, "agent/dist/provider.js"));
    fs.symlinkSync(
      path.join(root, "secret-target.js"),
      path.join(badSource, "agent/dist/provider.js"),
    );
    writeText(path.join(root, "secret-target.js"), "export const secret = 1;\n");
    assert.throws(
      () => installGrokBuildExtension({ source: badSource, repoRoot, env: {} }),
      (err) => err.code === "SYMLINK_REJECTED",
    );
    assert.equal(fs.readFileSync(installedEntryOf(repoRoot), "utf8"), before);
    const leaked = fs.readFileSync(path.join(installedDirOf(repoRoot), "agent/dist/provider.js"), "utf8");
    assert.equal(leaked.includes("secret = 1"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("producer host receipt pins the host entry at install time", () => {
  const root = tempDir("grok-producer-");
  try {
    const repoRoot = path.join(root, "repo");
    const good = makeBuiltPackage(path.join(root, "good"), {
      hostReceipt: "PENDING",
    });
    writeJson(path.join(good, "pipiui-host-receipt.json"), withHostReceipt(good));
    const okResult = installGrokBuildExtension({ source: good, repoRoot, env: {} });
    assert.equal(okResult.ok, true);
    const status = grokBuildExtensionStatus({ repoRoot, env: {} });
    assert.equal(status.producerHostReceiptSha256, sha256Of(path.join(good, "agent/dist/host.js")));
    // The producer receipt is part of the copied tree and thus of our receipt.
    const receipt = JSON.parse(
      fs.readFileSync(path.join(installedDirOf(repoRoot), ".install-receipt.json"), "utf8"),
    );
    assert.ok(receipt.files.some((f) => f.path === "pipiui-host-receipt.json"));

    // Wrong pinned hash -> install refused before touching anything.
    const bad = makeBuiltPackage(path.join(root, "bad"), {
      hostReceipt: withHostReceipt(path.join(root, "good"), {
        sha256: "0".repeat(64),
      }),
    });
    assert.throws(
      () => installGrokBuildExtension({ source: bad, repoRoot, env: {} }),
      (err) => err.code === "PRODUCER_RECEIPT_MISMATCH",
    );
    assert.equal(fs.existsSync(installedDirOf(repoRoot)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -------------------------------------------------- runtime receipt checks

test("runtime resolution fails closed on tampered files, symlinks, extras, or receipt drift", () => {
  const root = tempDir("grok-tamper-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    installGrokBuildExtension({ source, repoRoot, env: {} });
    const dir = installedDirOf(repoRoot);
    const checkFails = (expected) => {
      const resolved = resolveInstalledGrokBuildPackage({ repoRoot, env: {} });
      assert.equal(resolved.ok, false, `expected failure: ${expected}`);
      assert.match(resolved.error, new RegExp(expected));
      // Mount args also refuse a tampered tree.
      assert.deepEqual(grokBuildExtensionMountArgs({ repoRoot, env: {} }), []);
    };

    // Tampered non-entry file (per-file receipt verification, not entry-only).
    const providerFile = path.join(dir, "agent/dist/provider.js");
    const original = fs.readFileSync(providerFile, "utf8");
    writeText(providerFile, original + "// tampered\n");
    checkFails("hash mismatch");

    // File replaced by a symlink.
    writeText(providerFile, original);
    fs.rmSync(providerFile);
    fs.symlinkSync(path.join(source, "agent/dist/provider.js"), providerFile);
    checkFails("symlink");

    // Unexpected extra file inside the install dir.
    fs.rmSync(providerFile);
    writeText(providerFile, original);
    writeText(path.join(dir, "sneak.js"), "export const x = 1;\n");
    checkFails("unexpected file");

    // Receipt version drift vs manifest.
    fs.rmSync(path.join(dir, "sneak.js"));
    const receiptPath = path.join(dir, ".install-receipt.json");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    receipt.version = "9.9.9";
    writeJson(receiptPath, receipt);
    checkFails("version");

    // Restore: runtime works again.
    installGrokBuildExtension({ source, repoRoot, env: {} });
    const restored = resolveInstalledGrokBuildPackage({ repoRoot, env: {} });
    assert.equal(restored.ok, true);
    assert.equal(restored.verified, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verifyInstalledGrokBuildPackage flags a missing install receipt", () => {
  const root = tempDir("grok-noreceipt-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    installGrokBuildExtension({ source, repoRoot, env: {} });
    fs.rmSync(path.join(installedDirOf(repoRoot), ".install-receipt.json"));
    const resolved = resolveInstalledGrokBuildPackage({ repoRoot, env: {} });
    assert.equal(resolved.ok, false);
    assert.match(resolved.error, /receipt unreadable|schema/);
    assert.equal(typeof verifyInstalledGrokBuildPackage(resolved), "object");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -------------------------------------------------------- terminal settings

test("install targets the repo-local COC home and registers the final entry path", () => {
  const root = tempDir("grok-home-override-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    const ambientHome = path.join(root, "ambient-coding-home");
    fs.mkdirSync(ambientHome, { recursive: true });
    // Ambient coding-session / web-host agent env must not hijack the target.
    const result = installGrokBuildExtension({
      source,
      repoRoot,
      env: { PI_AGENT_DIR: ambientHome, PI_CODING_AGENT_DIR: ambientHome },
    });
    assert.equal(result.ok, true);
    assert.equal(result.dir, installedDirOf(repoRoot));
    assert.equal(fs.existsSync(path.join(ambientHome, "extensions")), false);

    // The registered entry is the FINAL path (never the swapped-away stage dir).
    const cocHome = path.join(repoRoot, ".pi/coc-agent");
    const settings = JSON.parse(fs.readFileSync(path.join(cocHome, "settings.json"), "utf8"));
    assert.equal(settings.extensions.length, 1);
    assert.equal(settings.extensions[0], installedEntryOf(repoRoot));

    // Explicit PI_COC_AGENT_DIR (terminal override) still redirects.
    const overrideHome = path.join(root, "coc-override");
    const overridden = installGrokBuildExtension({
      source,
      repoRoot,
      env: { PI_COC_AGENT_DIR: overrideHome },
    });
    assert.equal(overridden.ok, true);
    assert.equal(overridden.dir, path.join(overrideHome, "extensions", GROK_BUILD_EXTENSION_ID));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("configureTerminalGrokBuildExtension creates missing settings atomically and preserves existing keys", () => {
  const root = tempDir("grok-terminal-");
  try {
    const cocHome = path.join(root, ".pi/coc-agent");
    const entry = path.join(cocHome, "extensions", GROK_BUILD_EXTENSION_ID, "agent/dist/index.js");

    // Missing settings.json: created with the repo-pinned bootstrap + entry.
    const created = configureTerminalGrokBuildExtension({ cocHome, entryPath: entry, repoRoot: root });
    assert.equal(created.created, true);
    const settings = JSON.parse(fs.readFileSync(path.join(cocHome, "settings.json"), "utf8"));
    assert.deepEqual(settings.extensions, [entry]);
    assert.deepEqual(settings.packages, [root]);
    assert.equal(settings.theme, "light");

    // Existing settings: amend, preserving every other key; idempotent.
    writeJson(path.join(cocHome, "settings.json"), {
      packages: ["/repo"],
      defaultProvider: "grok-relay",
      defaultModel: "grok-4.5",
      theme: "light",
      quietStartup: true,
      extensions: ["/Users/x/.pi/agent/extensions/xai-server-tools.ts"],
    });
    const first = configureTerminalGrokBuildExtension({ cocHome, entryPath: entry });
    assert.equal(first.added, true);
    assert.equal(first.created, false);
    const amended = JSON.parse(fs.readFileSync(path.join(cocHome, "settings.json"), "utf8"));
    assert.deepEqual(amended.extensions, [
      "/Users/x/.pi/agent/extensions/xai-server-tools.ts",
      entry,
    ]);
    assert.equal(amended.defaultProvider, "grok-relay");
    assert.equal(amended.defaultModel, "grok-4.5");
    assert.equal(amended.theme, "light");
    assert.deepEqual(amended.packages, ["/repo"]);

    const second = configureTerminalGrokBuildExtension({ cocHome, entryPath: entry });
    assert.equal(second.added, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cocHome, "settings.json"), "utf8")).extensions.length, 2);

    // Corrupt settings: fail closed, file untouched.
    writeText(path.join(cocHome, "settings.json"), "{ not json");
    assert.throws(
      () => configureTerminalGrokBuildExtension({ cocHome, entryPath: entry }),
      GrokBuildExtensionError,
    );
    assert.equal(fs.readFileSync(path.join(cocHome, "settings.json"), "utf8"), "{ not json");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fresh checkout install actually installs and wires the terminal settings (no silent no-op)", () => {
  const root = tempDir("grok-fresh-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    // No settings.json, no prior install — the documented one-shot install.
    const result = installGrokBuildExtension({ source, repoRoot, env: {} });
    assert.equal(result.ok, true);
    assert.equal(result.noop, false);
    assert.equal(result.copied > 0, true);
    assert.equal(result.settingsCreated, true);
    assert.equal(result.terminalConfigured, true);
    const settingsPath = path.join(repoRoot, ".pi/coc-agent/settings.json");
    assert.equal(fs.existsSync(settingsPath), true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.deepEqual(settings.extensions, [installedEntryOf(repoRoot)]);
    const status = grokBuildExtensionStatus({ repoRoot, env: {} });
    assert.equal(status.installed, true);
    assert.equal(status.verified, true);
    assert.equal(status.terminalConfigured, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- settings env

test("settings snapshots are sanitized: manifest secrets and token-like keys never survive", () => {
  const snapshot = {
    "ext.grok-build-oauth.compatFallback": true,
    "ext.grok-build-oauth.defaultModel": "grok-imagine-image-quality",
    "ext.grok-build-oauth.accessToken": "super-secret-token",
    "ext.grok-build-oauth.refreshToken": "another-secret",
    myAuthorizationHeader: "Bearer x",
  };
  const sanitized = sanitizeGrokBuildSettingsSnapshot(snapshot, { manifest: FIXTURE_MANIFEST });
  assert.deepEqual(sanitized, {
    "ext.grok-build-oauth.compatFallback": true,
    "ext.grok-build-oauth.defaultModel": "grok-imagine-image-quality",
  });
});

test("applyGrokBuildExtensionSettingsEnv prefers host env, falls back to sidecar, drops secrets", () => {
  const root = tempDir("grok-env-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    installGrokBuildExtension({ source, repoRoot, env: {} });
    const sidecar = path.join(
      repoRoot,
      ".pi/coc-agent/extensions",
      `${GROK_BUILD_EXTENSION_ID}.settings.json`,
    );
    writeJson(sidecar, {
      "ext.grok-build-oauth.compatFallback": true,
      "ext.grok-build-oauth.accessToken": "sidecar-secret",
    });

    const envA = {};
    applyGrokBuildExtensionSettingsEnv(envA, { repoRoot });
    const parsedA = JSON.parse(envA[GROK_BUILD_SETTINGS_ENV]);
    assert.deepEqual(parsedA, { "ext.grok-build-oauth.compatFallback": true });

    const envB = {
      [GROK_BUILD_SETTINGS_ENV]: JSON.stringify({
        "ext.grok-build-oauth.defaultModel": "grok-imagine-image",
        "ext.grok-build-oauth.accessToken": "parent-secret",
      }),
    };
    applyGrokBuildExtensionSettingsEnv(envB, { repoRoot });
    const parsedB = JSON.parse(envB[GROK_BUILD_SETTINGS_ENV]);
    assert.deepEqual(parsedB, { "ext.grok-build-oauth.defaultModel": "grok-imagine-image" });

    const envC = {
      [GROK_BUILD_SETTINGS_ENV]: JSON.stringify({ "ext.grok-build-oauth.accessToken": "only-secret" }),
    };
    applyGrokBuildExtensionSettingsEnv(envC, { repoRoot });
    assert.equal(GROK_BUILD_SETTINGS_ENV in envC, false);

    // Gate: env snapshot wins over the sidecar; default is off.
    assert.equal(grokBuildCompatFallbackEnabled({ repoRoot, env: envA }), true);
    assert.equal(grokBuildCompatFallbackEnabled({ repoRoot, env: {} }), true); // sidecar
    const sidecarOff = JSON.parse(JSON.stringify(sidecar));
    void sidecarOff;
    writeJson(sidecar, { "ext.grok-build-oauth.compatFallback": false });
    assert.equal(grokBuildCompatFallbackEnabled({ repoRoot, env: {} }), false);
    assert.equal(
      grokBuildCompatFallbackEnabled({
        repoRoot,
        env: { [GROK_BUILD_SETTINGS_ENV]: JSON.stringify({ "ext.grok-build-oauth.compatFallback": true }) },
      }),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------- RPC mounts

test("grokBuildExtensionMountArgs mounts verified installs only once and respects host mounts", () => {
  const root = tempDir("grok-mount-");
  try {
    const repoRoot = path.join(root, "repo");
    assert.deepEqual(grokBuildExtensionMountArgs({ repoRoot, env: {} }), []);

    const source = makeBuiltPackage(path.join(root, "source"));
    installGrokBuildExtension({ source, repoRoot, env: {} });
    const entry = installedEntryOf(repoRoot);
    assert.deepEqual(grokBuildExtensionMountArgs({ repoRoot, env: {} }), ["--extension", entry]);

    // PipiUI host already mounted the id: no double mount.
    assert.deepEqual(
      grokBuildExtensionMountArgs({
        repoRoot,
        env: { [MOUNTED_EXTENSIONS_ENV]: "pipiui-media,grok-build-oauth" },
      }),
      [],
    );
    // A stale/other mounted list does not suppress the repo-local mount.
    assert.deepEqual(
      grokBuildExtensionMountArgs({
        repoRoot,
        env: { [MOUNTED_EXTENSIONS_ENV]: "pipiui-media" },
      }),
      ["--extension", entry],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildPiCocArgs appends the grok-build extension mount with dedup and a sanitized settings env", () => {
  const root = tempDir("grok-args-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    installGrokBuildExtension({ source, repoRoot, env: {} });
    const entry = installedEntryOf(repoRoot);

    const args = buildPiCocArgs({
      campaignId: "haunting-1",
      sessionId: "web-haunting-1",
      repoRoot,
      env: {},
    });
    const mounts = args.filter((value, idx) => args[idx - 1] === "--extension" && value === entry);
    assert.equal(mounts.length, 1);

    const hostMounted = buildPiCocArgs({
      campaignId: "haunting-1",
      sessionId: "web-haunting-1",
      repoRoot,
      env: { [MOUNTED_EXTENSIONS_ENV]: GROK_BUILD_EXTENSION_ID },
    });
    assert.equal(
      hostMounted.some((value, idx) => hostMounted[idx - 1] === "--extension" && value === entry),
      false,
    );

    const env = buildChildEnv({
      workspace: path.join(root, "ws"),
      repoRoot,
      campaignId: "haunting-1",
      sessionId: "web-haunting-1",
      parentEnv: {
        [GROK_BUILD_SETTINGS_ENV]: JSON.stringify({
          "ext.grok-build-oauth.compatFallback": true,
          "ext.grok-build-oauth.accessToken": "leak-attempt",
        }),
      },
    });
    const snapshot = JSON.parse(env[GROK_BUILD_SETTINGS_ENV]);
    assert.equal(snapshot["ext.grok-build-oauth.compatFallback"], true);
    assert.equal(snapshot["ext.grok-build-oauth.accessToken"], undefined);
    assert.equal(Object.values(env).includes("leak-attempt"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------- CLI

test("installer CLI installs from --source, reports status, and fails closed without a source", () => {
  const root = tempDir("grok-cli-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    const out = [];
    const err = [];
    const code = runGrokBuildInstallerCli({
      argv: ["install", "--source", source, "--repo-root", repoRoot],
      env: {},
      stdout: { write: (line) => out.push(line) },
      stderr: { write: (line) => err.push(line) },
    });
    assert.equal(code, 0, err.join(""));
    const installed = JSON.parse(out.filter(Boolean).at(-1));
    assert.equal(installed.ok, true);
    assert.equal(installed.settingsCreated, true);

    const statusLines = [];
    const statusCode = runGrokBuildInstallerCli({
      argv: ["status", "--repo-root", repoRoot],
      env: {},
      stdout: { write: (line) => statusLines.push(line) },
      stderr: { write: () => {} },
    });
    assert.equal(statusCode, 0);
    const status = JSON.parse(statusLines.filter(Boolean).at(-1));
    assert.equal(status.installed, true);
    assert.equal(status.verified, true);
    assert.equal(status.version, "0.1.0");
    assert.equal(status.hostEntryPath, path.join(installedDirOf(repoRoot), "agent/dist/host.js"));
    assert.equal(status.terminalConfigured, true);
    assert.equal(status.compatFallback, false);
    assert.deepEqual(status.compatFallbackAllowlist, [
      "tier_restricted",
      "auth_expired",
      "not_logged_in",
      "NoAgentHomeError",
    ]);
    assert.equal(status.mountedViaHostEnv, false);

    // Fresh checkout with no source: non-zero + actionable instructions.
    const freshOut = [];
    const freshErr = [];
    const freshCode = runGrokBuildInstallerCli({
      argv: ["install", "--repo-root", path.join(root, "fresh-repo")],
      env: {},
      stdout: { write: (line) => freshOut.push(line) },
      stderr: { write: (line) => freshErr.push(line) },
    });
    assert.equal(freshCode, 1);
    const message = freshErr.join("");
    assert.match(message, /--source/);
    assert.match(message, /grok-build-oauth/);
    assert.match(message, /GROK_BUILD_OAUTH_PACKAGE|PIPIUI_REPO_ROOT/);

    const failCode = runGrokBuildInstallerCli({
      argv: ["install", "--source", path.join(root, "missing"), "--repo-root", repoRoot],
      env: {},
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });
    assert.equal(failCode, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------ canonical portrait path

function makeCampaign(workspace, campaignId = "amaranthine-16") {
  const dir = path.join(workspace, ".coc", "campaigns", campaignId);
  fs.mkdirSync(path.join(dir, "assets", "portraits"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tmp", "portraits"), { recursive: true });
  fs.writeFileSync(path.join(dir, "campaign.json"), JSON.stringify({ campaign_id: campaignId }));
  return campaignId;
}

function stubHostState(agentDir, patch) {
  writeJson(path.join(agentDir, "auth.json.host-stub"), patch);
}

async function installHostStubPackage(root, { hostState = {} } = {}) {
  const repoRoot = path.join(root, "repo");
  const source = makeBuiltPackage(path.join(root, "source"));
  installGrokBuildExtension({ source, repoRoot, env: {} });
  const agentDir = path.join(root, "agent-home");
  fs.mkdirSync(agentDir, { recursive: true });
  stubHostState(agentDir, hostState);
  return { repoRoot, agentDir };
}

test("canonical portrait path calls the artifact host library and returns its typed result", async () => {
  const root = tempDir("grok-canonical-");
  try {
    const { repoRoot, agentDir } = await installHostStubPackage(root, {
      hostState: { usable: true, loggedIn: true, model: "grok-imagine-image-quality" },
    });
    const workspace = path.join(root, "ws");
    const campaignId = makeCampaign(workspace);
    const legacyCalls = [];
    const result = await generateCampaignPortrait({
      workspace,
      campaignId,
      prompt: "a keeper",
      outputPath: "tmp/portraits/portrait.png",
      env: { PI_AGENT_DIR: agentDir, XAI_API_KEY: "compat-key-that-must-not-be-used" },
      agentDir,
      repoRoot,
      fetchImpl: async (url, init) => {
        legacyCalls.push({ url, init });
        throw new Error("legacy request path must not run on the canonical route");
      },
    });
    assert.equal(legacyCalls.length, 0);
    assert.equal(result.ok, true);
    assert.equal(result.backend, "grok-build");
    assert.equal(result.canonical, true);
    assert.equal(result.model, "grok-imagine-image-quality");
    assert.equal(result.mime_type, "image/png");
    assert.equal(result.bytes_written > 0, true);
    const written = fs.readFileSync(path.join(workspace, ".coc/campaigns", campaignId, "tmp/portraits/portrait.png"));
    assert.equal(written.length, result.bytes_written);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** Matrix: what the canonical host error + compat gate together decide. */
test("canonical tier_restricted surfaces without compat when compatFallback=false", async () => {
  const root = tempDir("grok-tier-off-");
  try {
    const { repoRoot, agentDir } = await installHostStubPackage(root, {
      hostState: {
        usable: true,
        loggedIn: true,
        generateError: { code: "tier_restricted", message: "需要订阅" },
      },
    });
    const workspace = path.join(root, "ws");
    const campaignId = makeCampaign(workspace);
    const compatCalls = [];
    // Gate closed (default): even with XAI_API_KEY present, no fallback — the
    // user is told to log in / upgrade.
    await assert.rejects(
      generateCampaignPortrait({
        workspace,
        campaignId,
        prompt: "x",
        outputPath: "tmp/portraits/p.png",
        env: { PI_AGENT_DIR: agentDir, XAI_API_KEY: "must-not-be-used" },
        agentDir,
        repoRoot,
        fetchImpl: async (url) => {
          compatCalls.push(url);
          throw new Error("compat must not run");
        },
      }),
      (err) => err instanceof XaiImageError && /SuperGrok|订阅|compatFallback/.test(err.message) && err.code === "NO_IMAGE_BACKEND",
    );
    assert.equal(compatCalls.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tier_restricted with explicit compatFallback=true falls back to the deprecated API-key path", async () => {
  const root = tempDir("grok-tier-on-");
  try {
    const { repoRoot, agentDir } = await installHostStubPackage(root, {
      hostState: {
        usable: true,
        loggedIn: true,
        generateError: { code: "tier_restricted", message: "需要订阅" },
      },
    });
    const workspace = path.join(root, "ws");
    const campaignId = makeCampaign(workspace);
    const calls = [];
    const result = await generateCampaignPortrait({
      workspace,
      campaignId,
      prompt: "x",
      outputPath: "tmp/portraits/p.png",
      env: compatEnv({ XAI_API_KEY: "legacy-tier-compat-key", PI_AGENT_DIR: agentDir }),
      agentDir,
      repoRoot,
      fetchImpl: async (url, init) => {
        calls.push({ url, auth: init.headers.Authorization });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
          },
        };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.x.ai/v1/images/generations");
    assert.equal(calls[0].auth, "Bearer legacy-tier-compat-key");
    assert.equal(result.ok, true);
    assert.equal(result.backend, "official");
    assert.equal(result.deprecated, true);
    assert.equal(result.canonical, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tier_restricted with compatFallback=true and a reachable relay uses the deprecated relay", async () => {
  const root = tempDir("grok-tier-relay-");
  try {
    const { repoRoot, agentDir } = await installHostStubPackage(root, {
      hostState: {
        usable: true,
        loggedIn: true,
        generateError: { code: "tier_restricted", message: "需要订阅" },
      },
    });
    const workspace = path.join(root, "ws");
    const campaignId = makeCampaign(workspace);
    const calls = [];
    const result = await generateCampaignPortrait({
      workspace,
      campaignId,
      prompt: "x",
      outputPath: "tmp/portraits/p.png",
      env: compatEnv({
        PI_AGENT_DIR: agentDir,
        PIPIUI_GROK_RELAY: "http://127.0.0.1:18891/v1",
      }),
      agentDir,
      repoRoot,
      probeImpl: async () => true,
      fetchImpl: async (url, init) => {
        calls.push({ url, auth: init.headers.Authorization });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
          },
        };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:18891/v1/images/generations");
    assert.equal(calls[0].auth, "Bearer local");
    assert.equal(result.backend, "pipiui-relay");
    assert.equal(result.deprecated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("non-allowlisted canonical errors never fall back, regardless of compatFallback", async () => {
  const root = tempDir("grok-nonfall-");
  try {
    const workspace = path.join(root, "ws");
    const campaignId = makeCampaign(workspace);
    const codes = ["invalid_params", "invalid_response", "rate_limited", "upstream_error"];
    for (const code of codes) {
      const { repoRoot, agentDir } = await installHostStubPackage(path.join(root, code), {
        hostState: {
          usable: true,
          loggedIn: true,
          generateError: { code, message: `${code} detail` },
        },
      });
      const calls = [];
      await assert.rejects(
        generateCampaignPortrait({
          workspace,
          campaignId,
          prompt: "x",
          outputPath: `tmp/portraits/${code}.png`,
          env: compatEnv({ XAI_API_KEY: "must-not-run", PI_AGENT_DIR: agentDir }),
          agentDir,
          repoRoot,
          fetchImpl: async (url) => {
            calls.push(url);
            throw new Error("compat must not run");
          },
        }),
        (err) => {
          assert.equal(err instanceof XaiImageError, true, `${code} should surface as XaiImageError`);
          assert.match(err.message, new RegExp(code.replace(/_/g, "[ _]?")));
          return true;
        },
        `${code} must surface without fallback`,
      );
      assert.equal(calls.length, 0, `${code} must not hit compat transports`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hostErrorAllowsCompatFallback allow-list is exact", () => {
  assert.equal(hostErrorAllowsCompatFallback({ code: "tier_restricted" }), true);
  assert.equal(hostErrorAllowsCompatFallback({ code: "auth_expired" }), true);
  assert.equal(hostErrorAllowsCompatFallback({ code: "not_logged_in" }), true);
  assert.equal(hostErrorAllowsCompatFallback({ name: "NoAgentHomeError" }), true);
  for (const code of [
    "invalid_params",
    "invalid_response",
    "rate_limited",
    "upstream_error",
    "path_escaped",
    "ETIMEDOUT",
    "ABORTED",
    "network_error",
  ]) {
    assert.equal(hostErrorAllowsCompatFallback({ code }), false, code);
  }
  assert.equal(hostErrorAllowsCompatFallback(null), false);
  assert.equal(hostErrorAllowsCompatFallback(new Error("plain")), false);
});

test("AbortError from the canonical path is not swallowed into compat", async () => {
  const root = tempDir("grok-abort-");
  try {
    const { repoRoot, agentDir } = await installHostStubPackage(root, {
      hostState: {
        usable: true,
        loggedIn: true,
        generateError: { code: "ABORTED", message: "cancelled" },
      },
    });
    const workspace = path.join(root, "ws");
    const campaignId = makeCampaign(workspace);
    const calls = [];
    await assert.rejects(
      generateCampaignPortrait({
        workspace,
        campaignId,
        prompt: "x",
        outputPath: "tmp/portraits/a.png",
        env: compatEnv({ XAI_API_KEY: "must-not-run", PI_AGENT_DIR: agentDir }),
        agentDir,
        repoRoot,
        fetchImpl: async (url) => {
          calls.push(url);
          throw new Error("compat must not run");
        },
      }),
      (err) => err instanceof XaiImageError,
    );
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("compatFallback=false never uses legacy XAI_API_KEY or relay; true enables deprecated compat", async () => {
  const root = tempDir("grok-gate-");
  try {
    const { repoRoot, agentDir } = await installHostStubPackage(root, {
      hostState: { usable: false, loggedIn: false },
    });

    // Gate closed (default): XAI_API_KEY and relay env are refused outright.
    await assert.rejects(
      resolveXaiImageTransport({
        env: { XAI_API_KEY: "legacy-key", PIPIUI_GROK_RELAY: "http://127.0.0.1:18891/v1", PI_AGENT_DIR: agentDir },
        agentDir,
        repoRoot,
      }),
      (err) => err.status === 401 && /compatFallback/.test(err.message) && /login grok-build/.test(err.message),
    );

    // Gate open via explicit env snapshot: legacy official key path, labeled deprecated.
    const open = await resolveXaiImageTransport({
      env: compatEnv({ XAI_API_KEY: "legacy-key", PI_AGENT_DIR: agentDir }),
      agentDir,
      repoRoot,
    });
    assert.equal(open.backend, "official");
    assert.equal(open.token, "legacy-key");
    assert.equal(open.compatFallback, true);
    assert.equal(open.deprecated, true);

    // Same gate through the portrait flow: canonical absent -> deprecated relay.
    const workspace = path.join(root, "ws");
    const campaignId = makeCampaign(workspace);
    const relayCalls = [];
    const result = await generateCampaignPortrait({
      workspace,
      campaignId,
      prompt: "x",
      outputPath: "tmp/portraits/r.png",
      env: compatEnv({
        PIPIUI_GROK_RELAY: "http://127.0.0.1:18891/v1",
        PI_AGENT_DIR: agentDir,
      }),
      agentDir,
      repoRoot,
      probeImpl: async () => true,
      fetchImpl: async (url, init) => {
        relayCalls.push({ url, init });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
          },
        };
      },
    });
    assert.equal(relayCalls.length, 1);
    assert.equal(relayCalls[0].url, "http://127.0.0.1:18891/v1/images/generations");
    assert.equal(result.backend, "pipiui-relay");
    assert.equal(result.deprecated, true);
    assert.equal(result.canonical, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("canonical usable credential wins even with compatFallback enabled", async () => {
  const root = tempDir("grok-canonical-wins-");
  try {
    const { repoRoot, agentDir } = await installHostStubPackage(root, {
      hostState: { usable: true, loggedIn: true },
    });
    const workspace = path.join(root, "ws");
    const campaignId = makeCampaign(workspace);
    const legacyCalls = [];
    const result = await generateCampaignPortrait({
      workspace,
      campaignId,
      prompt: "x",
      outputPath: "tmp/portraits/c.png",
      env: compatEnv({ XAI_API_KEY: "legacy-key", PI_AGENT_DIR: agentDir }),
      agentDir,
      repoRoot,
      fetchImpl: async () => {
        legacyCalls.push(1);
        throw new Error("must not reach legacy");
      },
    });
    assert.equal(legacyCalls.length, 0);
    assert.equal(result.canonical, true);
    assert.equal(result.backend, "grok-build");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("no installed artifact: portrait still works only through the gated compat layer", async () => {
  const root = tempDir("grok-absent-");
  try {
    const repoRoot = path.join(root, "empty-repo");
    const agentDir = path.join(root, "agent-home");
    fs.mkdirSync(agentDir, { recursive: true });
    const workspace = path.join(root, "ws");
    const campaignId = makeCampaign(workspace);

    // Gate closed: nothing usable.
    await assert.rejects(
      generateCampaignPortrait({
        workspace,
        campaignId,
        prompt: "x",
        outputPath: "tmp/portraits/n.png",
        env: { XAI_API_KEY: "legacy-key", PI_AGENT_DIR: agentDir },
        agentDir,
        repoRoot,
      }),
      (err) => err.status === 401 && /compatFallback/.test(err.message),
    );

    // Gate open: deprecated official compat works.
    const result = await generateCampaignPortrait({
      workspace,
      campaignId,
      prompt: "x",
      outputPath: "tmp/portraits/n2.png",
      env: compatEnv({ XAI_API_KEY: "legacy-key", PI_AGENT_DIR: agentDir }),
      agentDir,
      repoRoot,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: [{ b64_json: PNG_B64 }] });
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.deprecated, true);
    assert.equal(result.backend, "official");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- provider login UI

test("registerGrokBuildProviderOnRuntime registers the artifact provider idempotently", async () => {
  const root = tempDir("grok-provider-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    installGrokBuildExtension({ source, repoRoot, env: {} });
    const agentDir = path.join(root, "agent-home");
    fs.mkdirSync(agentDir, { recursive: true });

    const registered = [];
    const runtime = {
      getProviders: () => registered.map((id) => ({ id })),
      registerProvider: (id, config) => registered.push(id, config),
    };
    assert.equal(
      await registerGrokBuildProviderOnRuntime(runtime, { agentDir, repoRoot, env: {} }),
      true,
    );
    assert.deepEqual(registered.slice(0, 1), ["grok-build"]);
    assert.equal(registered[1].name, "Grok Build");
    assert.equal(
      await registerGrokBuildProviderOnRuntime(runtime, { agentDir, repoRoot, env: {} }),
      false,
    );
    assert.equal(registered.length, 2);

    const emptyRoot = path.join(root, "empty-repo");
    assert.equal(
      await registerGrokBuildProviderOnRuntime(runtime, {
        agentDir,
        repoRoot: emptyRoot,
        env: {},
      }),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("model editor surfaces grok-build login status from Pi auth without a second OAuth UI", () => {
  const card = FEATURED_OAUTH.find((p) => p.id === "grok-build");
  assert.ok(card, "grok-build featured card present");
  assert.deepEqual(card.methods, ["oauth"]);
  assert.match(card.note, /grok-build-oauth/);

  const agentDir = tempDir("grok-models-");
  try {
    writeJson(path.join(agentDir, "auth.json"), {
      providers: { "grok-build": { type: "oauth", access: "a", expires: 1 } },
    });
    const summary = providerSummary(agentDir);
    const entry = summary.find((p) => p.id === "grok-build");
    assert.ok(entry, "authed grok-build appears in provider summary");
    assert.equal(entry.hasAuth, true);
    assert.equal(entry.name, card.label);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});
