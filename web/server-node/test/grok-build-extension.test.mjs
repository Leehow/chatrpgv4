import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  grokBuildExtensionMountArgs,
  grokBuildExtensionStatus,
  installGrokBuildExtension,
  resolveGrokBuildInstallSource,
  resolveInstalledGrokBuildPackage,
  sanitizeGrokBuildSettingsSnapshot,
  validateGrokBuildPackage,
  runGrokBuildInstallerCli,
} from "../grok-build-extension.mjs";
import {
  DEFAULT_XAI_IMAGE_MODEL,
  resolveXaiImageTransport,
} from "../xai-image.mjs";
import { buildChildEnv, buildPiCocArgs } from "../pi-coc-rpc.mjs";
import { FEATURED_OAUTH, providerSummary } from "../model-editor.mjs";
import { registerGrokBuildProviderOnRuntime } from "../provider-login.mjs";

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

const FIXTURE_MANIFEST = {
  id: GROK_BUILD_EXTENSION_ID,
  name: "Grok Build",
  version: "0.1.0",
  agent: { extension: "agent/dist/index.js" },
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

const STUB_BROKER_JS = `export function createBroker(opts = {}) {
  const state = { opts };
  return {
    async hasCredential() { return state.hasCredential ?? false; },
    async getAccessToken() {
      if (state.throwOnAccess) throw new Error(state.throwOnAccess);
      return state.token ?? "";
    },
    __setState(patch) { Object.assign(state, patch); },
  };
}
`;

const STUB_CONFIG_JS = `export function resolveImagesConfig() {
  return {
    baseUrl: process.env.STUB_GROK_BASE_URL || "https://api.x.ai/v1",
    model: process.env.STUB_GROK_MODEL || "grok-imagine-image-quality",
    compatFallback: false,
    tier: undefined,
    sessionId: "stub",
  };
}
`;

const STUB_PROVIDER_JS = `export const GROK_BUILD_PROVIDER_ID = "grok-build";
export function createGrokBuildProvider() {
  return { name: "Grok Build", api: "openai-completions", models: [], oauth: { name: "Grok Build" } };
}
`;

function makeBuiltPackage(dir, { manifest = FIXTURE_MANIFEST } = {}) {
  writeJson(path.join(dir, "pipiui-extension.json"), manifest);
  writeJson(path.join(dir, "package.json"), {
    name: "@pipiui/grok-build-oauth-extension",
    version: manifest.version,
    private: true,
    type: "module",
  });
  writeText(path.join(dir, "README.md"), "# fixture\n");
  writeText(path.join(dir, "agent/dist/index.js"), "export default function () {}\n");
  writeText(path.join(dir, "agent/dist/provider.js"), STUB_PROVIDER_JS);
  writeText(path.join(dir, "agent/dist/oauth/broker.js"), STUB_BROKER_JS);
  writeText(path.join(dir, "agent/dist/images/config.js"), STUB_CONFIG_JS);
  writeText(path.join(dir, "app/dist/panel.js"), "export default function () {}\n");
  // Source + deps that must never be copied.
  writeText(path.join(dir, "agent/index.ts"), "export default function () {}\n");
  writeText(path.join(dir, "node_modules/dep/index.js"), "export {};\n");
  return dir;
}

function installedEntryOf(repoRoot) {
  return path.join(
    repoRoot,
    ".pi",
    "coc-agent",
    "extensions",
    GROK_BUILD_EXTENSION_ID,
    "agent",
    "dist",
    "index.js",
  );
}

test("validateGrokBuildPackage accepts a built package and hashes the entry", () => {
  const src = makeBuiltPackage(tempDir("grok-pkg-ok-"));
  try {
    const result = validateGrokBuildPackage(src);
    assert.equal(result.ok, true);
    assert.equal(result.version, "0.1.0");
    assert.equal(result.entryPath, path.join(src, "agent/dist/index.js"));
    assert.match(result.entrySha256, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test("validateGrokBuildPackage rejects wrong id, bad version, missing and escaping entries", () => {
  const root = tempDir("grok-pkg-bad-");
  try {
    const wrongId = makeBuiltPackage(path.join(root, "wrong-id"), {
      manifest: { ...FIXTURE_MANIFEST, id: "other-extension" },
    });
    assert.equal(validateGrokBuildPackage(wrongId).ok, false);

    const badVersion = makeBuiltPackage(path.join(root, "bad-version"), {
      manifest: { ...FIXTURE_MANIFEST, version: "latest" },
    });
    assert.equal(validateGrokBuildPackage(badVersion).ok, false);

    const missingEntry = makeBuiltPackage(path.join(root, "missing-entry"));
    fs.rmSync(path.join(missingEntry, "agent/dist/index.js"));
    assert.equal(validateGrokBuildPackage(missingEntry).ok, false);

    const escaping = makeBuiltPackage(path.join(root, "escaping"), {
      manifest: {
        ...FIXTURE_MANIFEST,
        agent: { extension: "../../escape/dist/index.js" },
      },
    });
    const result = validateGrokBuildPackage(escaping);
    assert.equal(result.ok, false);
    assert.match(result.error, /escapes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test("install copies only build artifacts, verifies hash, and swaps atomically", () => {
  const root = tempDir("grok-install-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    const result = installGrokBuildExtension({ source, repoRoot, env: {} });
    assert.equal(result.ok, true);
    assert.equal(result.noop, false);
    const installedDir = path.join(repoRoot, ".pi/coc-agent/extensions", GROK_BUILD_EXTENSION_ID);
    assert.equal(fs.existsSync(path.join(installedDir, "pipiui-extension.json")), true);
    assert.equal(fs.existsSync(path.join(installedDir, "agent/dist/index.js")), true);
    assert.equal(fs.existsSync(path.join(installedDir, "agent/dist/oauth/broker.js")), true);
    assert.equal(fs.existsSync(path.join(installedDir, ".install-receipt.json")), true);
    // No source, no deps.
    assert.equal(fs.existsSync(path.join(installedDir, "agent/index.ts")), false);
    assert.equal(fs.existsSync(path.join(installedDir, "node_modules")), false);
    const receipt = JSON.parse(fs.readFileSync(path.join(installedDir, ".install-receipt.json"), "utf8"));
    assert.equal(receipt.entry_sha256, result.entrySha256);
    assert.equal(
      receipt.entry_sha256,
      validateGrokBuildPackage(source).entrySha256,
    );
    // No stage/trash residue.
    const extensionsRoot = path.dirname(installedDir);
    assert.deepEqual(
      fs.readdirSync(extensionsRoot).filter((name) => name.startsWith(".")),
      [],
    );

    // Upgrade via stage-swap: old file content replaced, still no residue.
    writeText(path.join(source, "agent/dist/index.js"), "export default function () { /* v2 */ }\n");
    const upgraded = installGrokBuildExtension({ source, repoRoot, env: {} });
    assert.equal(upgraded.ok, true);
    const newIndex = fs.readFileSync(installedEntryOf(repoRoot), "utf8");
    assert.match(newIndex, /v2/);
    assert.deepEqual(
      fs.readdirSync(extensionsRoot).filter((name) => name.startsWith(".")),
      [],
    );

    // Installing from the installed dir itself is a no-op reconfigure.
    const noop = installGrokBuildExtension({ source: installedDir, repoRoot, env: {} });
    assert.equal(noop.ok, true);
    assert.equal(noop.noop, true);
    assert.equal(noop.copied, 0);
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
    const installedDir = path.join(repoRoot, ".pi/coc-agent/extensions", GROK_BUILD_EXTENSION_ID);
    const before = fs.readFileSync(installedEntryOf(repoRoot), "utf8");

    // Invalid source: throws, install unchanged.
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
    assert.equal(
      fs.existsSync(path.join(installedDir, "agent/dist/provider.js")),
      true,
    );
    const leaked = fs.readFileSync(path.join(installedDir, "agent/dist/provider.js"), "utf8");
    assert.equal(leaked.includes("secret = 1"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("configureTerminalGrokBuildExtension amends settings.json atomically and idempotently", () => {
  const root = tempDir("grok-terminal-");
  try {
    const cocHome = path.join(root, ".pi/coc-agent");
    // Missing settings.json: never created here (pi-coc bootstrap owns that).
    const missing = configureTerminalGrokBuildExtension({
      cocHome,
      entryPath: "/x/grok-build-oauth/agent/dist/index.js",
    });
    assert.equal(missing.configured, false);
    assert.equal(fs.existsSync(path.join(cocHome, "settings.json")), false);

    writeJson(path.join(cocHome, "settings.json"), {
      packages: ["/repo"],
      defaultProvider: "grok-relay",
      defaultModel: "grok-4.5",
      theme: "light",
      extensions: ["/Users/x/.pi/agent/extensions/xai-server-tools.ts"],
    });
    const entry = path.join(cocHome, "extensions", GROK_BUILD_EXTENSION_ID, "agent/dist/index.js");
    const first = configureTerminalGrokBuildExtension({ cocHome, entryPath: entry });
    assert.equal(first.added, true);
    const settings = JSON.parse(fs.readFileSync(path.join(cocHome, "settings.json"), "utf8"));
    assert.deepEqual(settings.extensions, [
      "/Users/x/.pi/agent/extensions/xai-server-tools.ts",
      entry,
    ]);
    assert.equal(settings.defaultProvider, "grok-relay");
    assert.equal(settings.theme, "light");
    assert.deepEqual(settings.packages, ["/repo"]);

    const second = configureTerminalGrokBuildExtension({ cocHome, entryPath: entry });
    assert.equal(second.added, false);
    const after = JSON.parse(fs.readFileSync(path.join(cocHome, "settings.json"), "utf8"));
    assert.equal(after.extensions.length, 2);

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

    // Sidecar only.
    const envA = {};
    applyGrokBuildExtensionSettingsEnv(envA, { repoRoot });
    const parsedA = JSON.parse(envA[GROK_BUILD_SETTINGS_ENV]);
    assert.deepEqual(parsedA, { "ext.grok-build-oauth.compatFallback": true });

    // Host-minted parent value wins, still sanitized.
    const envB = {
      [GROK_BUILD_SETTINGS_ENV]: JSON.stringify({
        "ext.grok-build-oauth.defaultModel": "grok-imagine-image",
        "ext.grok-build-oauth.accessToken": "parent-secret",
      }),
    };
    applyGrokBuildExtensionSettingsEnv(envB, { repoRoot });
    const parsedB = JSON.parse(envB[GROK_BUILD_SETTINGS_ENV]);
    assert.deepEqual(parsedB, { "ext.grok-build-oauth.defaultModel": "grok-imagine-image" });

    // Token-only snapshot removes the env var entirely.
    const envC = {
      [GROK_BUILD_SETTINGS_ENV]: JSON.stringify({ "ext.grok-build-oauth.accessToken": "only-secret" }),
    };
    applyGrokBuildExtensionSettingsEnv(envC, { repoRoot });
    assert.equal(GROK_BUILD_SETTINGS_ENV in envC, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("grokBuildExtensionMountArgs mounts repo-local installs only once and respects host mounts", () => {
  const root = tempDir("grok-mount-");
  try {
    const repoRoot = path.join(root, "repo");
    // Not installed: no mount.
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

    // Corrupted install: mount skipped, spawn still works.
    writeText(
      path.join(repoRoot, ".pi/coc-agent/extensions", GROK_BUILD_EXTENSION_ID, "pipiui-extension.json"),
      "broken",
    );
    assert.deepEqual(grokBuildExtensionMountArgs({ repoRoot, env: {} }), []);
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

test("installer CLI installs from --source and reports status", () => {
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
    assert.equal(status.version, "0.1.0");
    assert.equal(status.mountedViaHostEnv, false);
    assert.equal(status.terminalConfigured, false); // no settings.json in fresh home

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

function makeStubAuth(agentDir, grokBuild) {
  fs.mkdirSync(agentDir, { recursive: true });
  const auth = {};
  if (grokBuild) auth["grok-build"] = grokBuild;
  writeJson(path.join(agentDir, "auth.json"), auth);
}

async function installStubRuntimePackage(root, { brokerState = {} } = {}) {
  const repoRoot = path.join(root, "repo");
  const source = makeBuiltPackage(path.join(root, "source"));
  installGrokBuildExtension({ source, repoRoot, env: {} });
  const installedDir = path.join(repoRoot, ".pi/coc-agent/extensions", GROK_BUILD_EXTENSION_ID);
  // Rebind the stub broker to the desired per-test state via a state file the
  // stub reads at construction (the installed copy is what gets imported).
  writeText(
    path.join(installedDir, "agent/dist/oauth/broker.js"),
    `import fs from "node:fs";
export function createBroker(opts = {}) {
  let state = { hasCredential: false, token: "", throwOnAccess: "" };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(opts.authPath + ".stub-broker", "utf8")) }; } catch {}
  return {
    async hasCredential() { return Boolean(state.hasCredential); },
    async getAccessToken() {
      if (state.throwOnAccess) throw new Error(state.throwOnAccess);
      return state.token;
    },
  };
}
`,
  );
  const agentDir = path.join(root, "agent-home");
  makeStubAuth(agentDir, null);
  const writeBrokerState = (patch) => {
    writeJson(path.join(agentDir, "auth.json.stub-broker"), patch);
  };
  writeBrokerState(brokerState);
  return { repoRoot, agentDir, writeBrokerState };
}

test("portrait transport prefers the canonical grok-build provider auth", async () => {
  const root = tempDir("grok-compat-");
  try {
    const { repoRoot, agentDir, writeBrokerState } = await installStubRuntimePackage(root, {
      brokerState: { hasCredential: true, token: "grok-oauth-access-token" },
    });
    const transport = await resolveXaiImageTransport({
      env: { XAI_API_KEY: "compat-xai-key", PI_AGENT_DIR: agentDir },
      agentDir,
      repoRoot,
    });
    assert.equal(transport.backend, "grok-build-oauth");
    assert.equal(transport.canonical, true);
    assert.equal(transport.token, "grok-oauth-access-token");
    assert.equal(transport.tokenSource, "pi-auth:grok-build");
    assert.equal(transport.url, "https://api.x.ai/v1/images/generations");
    assert.equal(transport.model, "grok-imagine-image-quality");

    // Auth error (refresh failed) degrades to the labeled compat layer.
    writeBrokerState({ hasCredential: true, token: "", throwOnAccess: "network down" });
    const compat = await resolveXaiImageTransport({
      env: { XAI_API_KEY: "compat-xai-key", PI_AGENT_DIR: agentDir },
      agentDir,
      repoRoot,
    });
    assert.equal(compat.backend, "official");
    assert.equal(compat.compatFallback, true);
    assert.equal(compat.token, "compat-xai-key");
    assert.match(compat.compatReason, /grok-build/);

    // No grok-build credential: unchanged compat ordering.
    writeBrokerState({ hasCredential: false });
    const plain = await resolveXaiImageTransport({
      env: { XAI_API_KEY: "compat-xai-key", PI_AGENT_DIR: agentDir },
      agentDir,
      repoRoot,
    });
    assert.equal(plain.backend, "official");
    assert.equal(plain.model, DEFAULT_XAI_IMAGE_MODEL);
    assert.equal(plain.tokenSource, "env");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("portrait relay compat path stays deprecated-labeled and auth errors mention grok-build login", async () => {
  const root = tempDir("grok-relay-");
  try {
    const { repoRoot, agentDir } = await installStubRuntimePackage(root, {
      brokerState: { hasCredential: false },
    });
    const transport = await resolveXaiImageTransport({
      env: {
        PIPIUI_GROK_RELAY: "http://127.0.0.1:18891/v1",
        PI_AGENT_DIR: agentDir,
      },
      agentDir,
      repoRoot,
      probeImpl: async () => true,
    });
    assert.equal(transport.backend, "pipiui-relay");
    assert.equal(transport.compatFallback, true);
    assert.equal(transport.deprecated, true);

    await assert.rejects(
      resolveXaiImageTransport({
        env: { PI_AGENT_DIR: agentDir },
        agentDir,
        repoRoot,
      }),
      (err) => err.status === 401 && /login grok-build/.test(err.message),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

    // No artifact installed: graceful no-op.
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
    assert.equal(
      result.dir,
      path.join(repoRoot, ".pi/coc-agent/extensions", GROK_BUILD_EXTENSION_ID),
    );
    assert.equal(fs.existsSync(path.join(ambientHome, "extensions")), false);

    // With settings.json present, the registered entry is the FINAL path
    // (never the already-swapped-away stage dir).
    const cocHome = path.join(repoRoot, ".pi/coc-agent");
    writeJson(path.join(cocHome, "settings.json"), { packages: [repoRoot] });
    installGrokBuildExtension({ source, repoRoot, env: {} });
    const settings = JSON.parse(fs.readFileSync(path.join(cocHome, "settings.json"), "utf8"));
    assert.equal(settings.extensions.length, 1);
    assert.equal(settings.extensions[0], installedEntryOf(repoRoot));
    assert.match(settings.extensions[0], new RegExp(`${GROK_BUILD_EXTENSION_ID}/agent/dist/index.js$`));

    // Explicit PI_COC_AGENT_DIR (terminal override) still redirects.
    const overrideHome = path.join(root, "coc-override");
    const overridden = installGrokBuildExtension({
      source,
      repoRoot,
      env: { PI_COC_AGENT_DIR: overrideHome },
    });
    assert.equal(overridden.ok, true);
    assert.equal(
      overridden.dir,
      path.join(overrideHome, "extensions", GROK_BUILD_EXTENSION_ID),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveInstalledGrokBuildPackage and status report through one repo-local source", () => {
  const root = tempDir("grok-status-");
  try {
    const repoRoot = path.join(root, "repo");
    const source = makeBuiltPackage(path.join(root, "source"));
    installGrokBuildExtension({ source, repoRoot, env: {} });
    const resolved = resolveInstalledGrokBuildPackage({ repoRoot, env: {} });
    assert.equal(resolved.ok, true);
    const status = grokBuildExtensionStatus({ repoRoot, env: {} });
    assert.equal(status.installed, true);
    assert.equal(status.terminalConfigured, false);
    assert.equal(status.error, null);
    writeJson(path.join(repoRoot, ".pi/coc-agent/settings.json"), {
      packages: [repoRoot],
    });
    const installedDir = path.join(
      repoRoot,
      ".pi/coc-agent/extensions",
      GROK_BUILD_EXTENSION_ID,
    );
    const rerun = installGrokBuildExtension({ source: installedDir, repoRoot, env: {} });
    assert.equal(rerun.noop, true);
    assert.equal(rerun.terminalConfigured, true);
    const configured = grokBuildExtensionStatus({ repoRoot, env: {} });
    assert.equal(configured.terminalConfigured, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
