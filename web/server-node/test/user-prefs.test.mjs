import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultDesktopUserData } from "../agent-dir.mjs";
import {
  LAYOUT_DEFAULTS,
  loadUserPrefs,
  resolveUserPrefsPath,
  saveUserPrefs,
} from "../user-prefs.mjs";

const SERVER_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs"),
  "utf8",
);

const DEFAULT_PREFS = {
  provider: "",
  model: "",
  thinking: "",
  appearance: "",
  layout: { ...LAYOUT_DEFAULTS },
  visionEnabled: false,
  visionProvider: "",
  visionModel: "",
  portraitImageProvider: "",
  portraitImageModel: "",
};

test("user-prefs path is product userData, never ~/.pi", () => {
  assert.equal(resolveUserPrefsPath({ agentDir: path.join(os.homedir(), ".pi", "agent") }), null);
  assert.equal(
    resolveUserPrefsPath({}),
    path.join(defaultDesktopUserData(), "coc-desktop-settings.json"),
  );
  const userData = "/tmp/coc-user-data-prefs";
  assert.equal(
    resolveUserPrefsPath({ userData }),
    path.join(userData, "coc-desktop-settings.json"),
  );
});

test("server.mjs wires GET and PUT /api/user-prefs", () => {
  assert.match(SERVER_SRC, /if \(urlPath === "\/api\/user-prefs"\) return handleUserPrefs/);
  assert.match(SERVER_SRC, /if \(urlPath === "\/api\/user-prefs"\) return handleSaveUserPrefs/);
});

test("saveUserPrefs merges UI keys without clobbering hiddenProviderIds", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-user-prefs-"));
  const settingsPath = path.join(root, "coc-desktop-settings.json");
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      onboarded: true,
      hiddenProviderIds: ["zhipu"],
      extraProviderIds: ["google"],
      customProviders: [{ id: "relay", label: "Relay", baseUrl: "https://relay.example" }],
    }) + "\n",
  );

  const empty = loadUserPrefs(settingsPath);
  assert.deepEqual(empty, DEFAULT_PREFS);

  const saved = saveUserPrefs(settingsPath, {
    provider: "xai",
    model: "grok-4.6",
    thinking: "off",
    appearance: "dark",
  });
  assert.deepEqual(saved, {
    provider: "xai",
    model: "grok-4.6",
    thinking: "off",
    appearance: "dark",
    layout: { ...LAYOUT_DEFAULTS },
    visionEnabled: false,
    visionProvider: "",
    visionModel: "",
    portraitImageProvider: "",
    portraitImageModel: "",
  });

  const disk = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(disk.onboarded, true);
  assert.deepEqual(disk.hiddenProviderIds, ["zhipu"]);
  assert.deepEqual(disk.extraProviderIds, ["google"]);
  assert.equal(disk.customProviders[0].id, "relay");
  assert.equal(disk.provider, "xai");
  assert.equal(disk.model, "grok-4.6");

  saveUserPrefs(settingsPath, { thinking: "high" });
  const again = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(again.provider, "xai");
  assert.equal(again.thinking, "high");
  assert.deepEqual(again.hiddenProviderIds, ["zhipu"]);

  assert.throws(() => saveUserPrefs(settingsPath, { appearance: 1 }), /must be a string/);
  assert.throws(() => saveUserPrefs(settingsPath, { appearance: "neon" }), /light, dark, or system/);
  const afterBad = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(afterBad.appearance, "dark");
  assert.deepEqual(afterBad.hiddenProviderIds, ["zhipu"]);

  fs.rmSync(root, { recursive: true, force: true });
});

test("PUT layout patch merges without wiping other layout or model keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-user-prefs-layout-"));
  const settingsPath = path.join(root, "coc-desktop-settings.json");
  saveUserPrefs(settingsPath, {
    provider: "xai",
    model: "grok-4.6",
    thinking: "off",
    appearance: "dark",
    layout: { leftSidebarCollapsed: true, rightSidebarWidth: 400 },
  });

  const left = saveUserPrefs(settingsPath, { layout: { leftSidebarWidth: 300 } });
  assert.equal(left.layout.leftSidebarWidth, 300);
  assert.equal(left.layout.rightSidebarWidth, 400);
  assert.equal(left.layout.leftSidebarCollapsed, true);
  assert.equal(left.layout.rightSidebarCollapsed, false);
  assert.equal(left.provider, "xai");
  assert.equal(left.model, "grok-4.6");
  assert.equal(left.appearance, "dark");

  const right = saveUserPrefs(settingsPath, { layout: { rightSidebarCollapsed: true } });
  assert.equal(right.layout.leftSidebarWidth, 300);
  assert.equal(right.layout.rightSidebarWidth, 400);
  assert.equal(right.layout.leftSidebarCollapsed, true);
  assert.equal(right.layout.rightSidebarCollapsed, true);
  assert.equal(right.thinking, "off");

  const disk = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(disk.model, "grok-4.6");
  assert.equal(disk.layout.leftSidebarWidth, 300);
  assert.equal(disk.layout.rightSidebarCollapsed, true);

  fs.rmSync(root, { recursive: true, force: true });
});

test("layout widths clamp and booleans are strict", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-user-prefs-clamp-"));
  const settingsPath = path.join(root, "coc-desktop-settings.json");

  const clamped = saveUserPrefs(settingsPath, {
    layout: { leftSidebarWidth: 10, rightSidebarWidth: 9999 },
  });
  assert.equal(clamped.layout.leftSidebarWidth, 192);
  assert.equal(clamped.layout.rightSidebarWidth, 560);

  assert.throws(
    () => saveUserPrefs(settingsPath, { layout: { leftSidebarCollapsed: "1" } }),
    /must be a boolean/,
  );
  assert.throws(
    () => saveUserPrefs(settingsPath, { layout: { rightSidebarWidth: "320" } }),
    /must be a number/,
  );
  assert.throws(
    () => saveUserPrefs(settingsPath, { layout: { extra: 1 } }),
    /unknown layout field/,
  );
  assert.throws(
    () => saveUserPrefs(settingsPath, { layout: [] }),
    /layout must be an object/,
  );

  const afterBad = loadUserPrefs(settingsPath);
  assert.equal(afterBad.layout.leftSidebarWidth, 192);
  assert.equal(afterBad.layout.rightSidebarWidth, 560);
  assert.equal(afterBad.layout.leftSidebarCollapsed, false);

  saveUserPrefs(settingsPath, { mysteryTopLevel: "nope" });
  const afterUnknown = loadUserPrefs(settingsPath);
  assert.equal(afterUnknown.provider, "");
  assert.equal(afterUnknown.layout.leftSidebarWidth, 192);

  fs.rmSync(root, { recursive: true, force: true });
});

test("atomic write cleans up tmp on failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-user-prefs-tmp-"));
  const settingsPath = path.join(root, "coc-desktop-settings.json");
  fs.writeFileSync(settingsPath, "{}\n");
  fs.chmodSync(root, 0o555);
  try {
    assert.throws(() => saveUserPrefs(settingsPath, { provider: "xai" }));
  } finally {
    fs.chmodSync(root, 0o755);
  }
  const leftovers = fs.readdirSync(root).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
  fs.rmSync(root, { recursive: true, force: true });
});

/** Same GET/PUT contract as server.mjs, without spawning sidecar. */
function listenPrefsHttp(userData) {
  const settingsPath = path.join(userData, "coc-desktop-settings.json");
  const server = http.createServer((req, res) => {
    const send = (status, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
    };
    const urlPath = new URL(req.url, "http://127.0.0.1").pathname;
    if (urlPath !== "/api/user-prefs") {
      send(404, { error: "not found" });
      return;
    }
    if (req.method === "GET") {
      send(200, loadUserPrefs(settingsPath));
      return;
    }
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const patch = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          send(200, saveUserPrefs(settingsPath, patch));
        } catch (err) {
          send(Number.isInteger(err?.status) ? err.status : 400, { error: err?.message || String(err) });
        }
      });
      return;
    }
    send(405, { error: "method not allowed" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        userData,
        settingsPath,
        close: () => server.close(),
      });
    });
  });
}

let httpServer = null;

async function getHttpServer() {
  if (httpServer) return httpServer;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "coc-user-prefs-ud-"));
  httpServer = await listenPrefsHttp(userData);
  return httpServer;
}

after(() => {
  httpServer?.close();
});

test("GET /api/user-prefs defaults to empty strings and layout defaults", async () => {
  const { base } = await getHttpServer();
  const res = await fetch(`${base}/api/user-prefs`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), DEFAULT_PREFS);
});

test("GET /api/user-prefs reads existing settings file", async () => {
  const { base, settingsPath } = await getHttpServer();
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinking: "off",
      appearance: "light",
      layout: { leftSidebarWidth: 220, rightSidebarCollapsed: true },
    }) + "\n",
  );
  const res = await fetch(`${base}/api/user-prefs`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    thinking: "off",
    appearance: "light",
    layout: {
      leftSidebarWidth: 220,
      rightSidebarWidth: 320,
      leftSidebarCollapsed: false,
      rightSidebarCollapsed: true,
    },
    visionEnabled: false,
    visionProvider: "",
    visionModel: "",
    portraitImageProvider: "",
    portraitImageModel: "",
  });
});

test("PUT /api/user-prefs persists and does not clobber hiddenProviderIds", async () => {
  const { base, userData, settingsPath } = await getHttpServer();
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ onboarded: true, hiddenProviderIds: ["anthropic"] }) + "\n",
  );

  const put = await fetch(`${base}/api/user-prefs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", model: "deepseek-v4-flash", thinking: "off" }),
  });
  assert.equal(put.status, 200);
  assert.equal((await put.json()).provider, "deepseek");

  const get = await fetch(`${base}/api/user-prefs`);
  const body = await get.json();
  assert.equal(body.provider, "deepseek");
  assert.equal(body.model, "deepseek-v4-flash");
  assert.equal(body.thinking, "off");
  assert.deepEqual(body.layout, LAYOUT_DEFAULTS);

  const disk = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(disk.onboarded, true);
  assert.deepEqual(disk.hiddenProviderIds, ["anthropic"]);
  assert.equal(path.dirname(settingsPath), userData);
  assert.ok(!settingsPath.includes(`${path.sep}.pi${path.sep}`));
});

test("PUT /api/user-prefs rejects invalid types", async () => {
  const { base } = await getHttpServer();
  const res = await fetch(`${base}/api/user-prefs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ["nope"] }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(String(body.error), /must be a string/);
});

test("saveUserPrefs persists vision fields and never writes pdfVisionModel", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-user-prefs-vision-"));
  const settingsPath = path.join(root, "coc-desktop-settings.json");
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      onboarded: true,
      hiddenProviderIds: ["zhipu"],
      pdfVisionModel: "xai/grok-4.6",
    }) + "\n",
  );

  const saved = saveUserPrefs(settingsPath, {
    visionEnabled: true,
    visionProvider: "xai",
    visionModel: "grok-4.6",
  });
  assert.equal(saved.visionEnabled, true);
  assert.equal(saved.visionProvider, "xai");
  assert.equal(saved.visionModel, "grok-4.6");

  const disk = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(disk.onboarded, true);
  assert.deepEqual(disk.hiddenProviderIds, ["zhipu"]);
  assert.equal(disk.visionEnabled, true);
  assert.equal(disk.visionProvider, "xai");
  assert.equal(disk.visionModel, "grok-4.6");
  assert.equal(Object.hasOwn(disk, "pdfVisionModel"), false);

  const cleared = saveUserPrefs(settingsPath, { visionEnabled: false });
  assert.equal(cleared.visionEnabled, false);
  assert.equal(cleared.visionProvider, "");
  assert.equal(cleared.visionModel, "");
  const after = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(after.visionEnabled, false);
  assert.equal(after.visionProvider, "");
  assert.equal(after.visionModel, "");
  assert.equal(after.onboarded, true);
  assert.deepEqual(after.hiddenProviderIds, ["zhipu"]);

  assert.throws(
    () => saveUserPrefs(settingsPath, { visionEnabled: "true" }),
    /must be a boolean/,
  );
  const afterBad = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(afterBad.visionEnabled, false);
  assert.deepEqual(afterBad.hiddenProviderIds, ["zhipu"]);

  fs.rmSync(root, { recursive: true, force: true });
});

test("GET/PUT /api/user-prefs round-trips vision selection", async () => {
  const { base } = await getHttpServer();
  const put = await fetch(`${base}/api/user-prefs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      visionEnabled: true,
      visionProvider: "openai",
      visionModel: "gpt-5",
    }),
  });
  assert.equal(put.status, 200);
  const saved = await put.json();
  assert.equal(saved.visionEnabled, true);
  assert.equal(saved.visionProvider, "openai");
  assert.equal(saved.visionModel, "gpt-5");

  const get = await fetch(`${base}/api/user-prefs`);
  const body = await get.json();
  assert.equal(body.visionEnabled, true);
  assert.equal(body.visionProvider, "openai");
  assert.equal(body.visionModel, "gpt-5");
});

test("saveUserPrefs persists portrait image provider/model without secrets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coc-user-prefs-portrait-"));
  const settingsPath = path.join(root, "coc-desktop-settings.json");
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ onboarded: true, hiddenProviderIds: ["zhipu"] }) + "\n",
  );
  const saved = saveUserPrefs(settingsPath, {
    portraitImageProvider: "openai",
    portraitImageModel: "gpt-image-1",
  });
  assert.equal(saved.portraitImageProvider, "openai");
  assert.equal(saved.portraitImageModel, "gpt-image-1");
  const disk = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(disk.portraitImageProvider, "openai");
  assert.equal(disk.portraitImageModel, "gpt-image-1");
  assert.equal(disk.onboarded, true);
  assert.equal(JSON.stringify(disk).toLowerCase().includes("sk-"), false);
  assert.throws(
    () => saveUserPrefs(settingsPath, { portraitImageProvider: 1 }),
    /must be a string/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});
