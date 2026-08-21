import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultDesktopUserData, resolveProductAgentDir } from "../agent-dir.mjs";
import {
  DEFAULT_SEARCH_ROUTING,
  WEB_SEARCH_CONFIG_NAME,
  WEB_SEARCH_DEFAULTS_MARKER,
  WEB_SEARCH_KEY_PROVIDERS,
  applyWebSearchDefaults,
  ensureWebSearchDefaults,
  hasPinnedProvider,
  loadWebSearchKeysView,
  parseWebSearchKeysPatch,
  reorderProvidersForKeyPriority,
  resolveWebSearchConfigPath,
  saveWebSearchApiKeys,
  webSearchConfigPath,
} from "../web-search-keys.mjs";

const SERVER_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs"),
  "utf8",
);

function tempAgentDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function readConfig(agentDir) {
  return JSON.parse(fs.readFileSync(webSearchConfigPath(agentDir), "utf8"));
}

function assertNoSecretInPublic(view, secret) {
  const text = JSON.stringify(view);
  assert.equal(text.includes(secret), false);
  assert.equal(Object.values(view.keys).every((flag) => flag === true), true);
}

test("web-search path is product PI_AGENT_DIR, never desktop settings JSON", () => {
  const settings = path.join(defaultDesktopUserData(), "coc-desktop-settings.json");
  const expected = path.join(resolveProductAgentDir({}), WEB_SEARCH_CONFIG_NAME);
  assert.equal(resolveWebSearchConfigPath({}), expected);
  assert.notEqual(expected, settings);
  assert.equal(path.basename(expected), "web-search.json");
  const override = "/tmp/coc-agent-web-search";
  assert.equal(
    resolveWebSearchConfigPath({ agentDir: override }),
    path.join(override, WEB_SEARCH_CONFIG_NAME),
  );
});

test("server.mjs wires GET and PUT /api/web-search-keys", () => {
  assert.match(SERVER_SRC, /if \(urlPath === "\/api\/web-search-keys"\) return handleWebSearchKeys/);
  assert.match(SERVER_SRC, /if \(urlPath === "\/api\/web-search-keys"\) return handleSaveWebSearchKeys/);
  assert.match(SERVER_SRC, /from "\.\/web-search-keys\.mjs"/);
});

test("v1 providers require Exa and never auto-insert explicit-only sources", () => {
  assert.equal(WEB_SEARCH_KEY_PROVIDERS[0].id, "exa");
  assert.equal(WEB_SEARCH_KEY_PROVIDERS[0].keyField, "exaApiKey");
  assert.deepEqual(
    WEB_SEARCH_KEY_PROVIDERS.map((p) => p.id),
    ["exa", "tavily", "perplexity", "openai", "searxng"],
  );
  assert.deepEqual(
    WEB_SEARCH_KEY_PROVIDERS.map((p) => p.keyField),
    ["exaApiKey", "tavilyApiKey", "perplexityApiKey", "openaiApiKey", "searxngApiKey"],
  );
  assert.equal(DEFAULT_SEARCH_ROUTING.providers[0], "exa");
  assert.deepEqual(DEFAULT_SEARCH_ROUTING.providers, ["exa", "tavily", "perplexity", "searxng", "openai"]);
  assert.ok(DEFAULT_SEARCH_ROUTING.providers.includes("searxng"));
  assert.ok(DEFAULT_SEARCH_ROUTING.providers.includes("openai"));
  for (const blocked of ["anysearch", "xai", "brightdata", "serpbase"]) {
    assert.equal(DEFAULT_SEARCH_ROUTING.providers.includes(blocked), false);
    assert.equal(WEB_SEARCH_KEY_PROVIDERS.some((p) => p.id === blocked), false);
  }
});

test("GET missing file returns configured flags only", () => {
  const agentDir = tempAgentDir("coc-web-search-empty-");
  const view = loadWebSearchKeysView(agentDir);
  assert.deepEqual(view.keys, {});
  assert.equal(view.providers[0].id, "exa");
  assert.equal(fs.existsSync(webSearchConfigPath(agentDir)), false);
  fs.rmSync(agentDir, { recursive: true, force: true });
});

test("PUT stores *ApiKey and GET never echoes the secret", () => {
  const agentDir = tempAgentDir("coc-web-search-put-");
  const secret = `tok_${process.pid}_a`;
  const view = saveWebSearchApiKeys(agentDir, { keys: { exaApiKey: secret } });
  assert.equal(view.keys.exaApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(view, "exaApiKey"), false);
  assertNoSecretInPublic(view, secret);
  assertNoSecretInPublic(loadWebSearchKeysView(agentDir), secret);

  const disk = readConfig(agentDir);
  assert.equal(typeof disk.exaApiKey, "string");
  assert.ok(disk.exaApiKey.length > 0);
  assert.equal(disk.searchRouting.providers[0], "exa");
  assert.equal(disk.workflow, "none");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(webSearchConfigPath(agentDir)).mode & 0o777, 0o600);
  }
  fs.rmSync(agentDir, { recursive: true, force: true });
});

test("PUT tavily and perplexity keys expose public booleans only", () => {
  const agentDir = tempAgentDir("coc-web-search-tvly-");
  const tavilySecret = `tvly_${process.pid}_secret`;
  const pplxSecret = `pplx_${process.pid}_secret`;
  const view = saveWebSearchApiKeys(agentDir, {
    keys: { tavilyApiKey: tavilySecret, perplexityApiKey: pplxSecret },
  });
  assert.equal(view.keys.tavilyApiKey, true);
  assert.equal(view.keys.perplexityApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(view, "tavilyApiKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(view, "perplexityApiKey"), false);
  assertNoSecretInPublic(view, tavilySecret);
  assertNoSecretInPublic(view, pplxSecret);
  assertNoSecretInPublic(loadWebSearchKeysView(agentDir), tavilySecret);
  const disk = readConfig(agentDir);
  assert.equal(disk.tavilyApiKey, tavilySecret);
  assert.equal(disk.perplexityApiKey, pplxSecret);
  assert.deepEqual(disk.searchRouting.providers[0], "tavily");
  assert.ok(disk.searchRouting.providers.includes("perplexity"));
  fs.rmSync(agentDir, { recursive: true, force: true });
});

test("empty string deletes a key and unknown fields are rejected", () => {
  const agentDir = tempAgentDir("coc-web-search-del-");
  const secret = `tok_${process.pid}_b`;
  saveWebSearchApiKeys(agentDir, { exaApiKey: secret });
  const cleared = saveWebSearchApiKeys(agentDir, { keys: { exaApiKey: "" } });
  assert.equal(cleared.keys.exaApiKey, undefined);
  const disk = readConfig(agentDir);
  assert.equal(Object.prototype.hasOwnProperty.call(disk, "exaApiKey"), false);

  assert.throws(() => parseWebSearchKeysPatch({ keys: { token: "x" } }), /unknown web-search key field/);
  assert.throws(() => parseWebSearchKeysPatch({ keys: { exaApiKey: 1 } }), /must be a string/);
  assert.throws(() => parseWebSearchKeysPatch(null), /JSON object/);
  assert.throws(() => saveWebSearchApiKeys(agentDir, { keys: { searchRouting: [] } }), /unknown/);
  const afterBad = readConfig(agentDir);
  assert.equal(Object.prototype.hasOwnProperty.call(afterBad, "exaApiKey"), false);
  fs.rmSync(agentDir, { recursive: true, force: true });
});

test("keyed providers reorder ahead of Exa default without inserting explicit-only ids", () => {
  const secret = `tok_${process.pid}_c`;
  const reordered = reorderProvidersForKeyPriority({ openaiApiKey: secret, brightdataApiKey: secret });
  assert.deepEqual(reordered, ["openai", "exa", "tavily", "perplexity", "searxng"]);
  assert.equal(reordered.includes("brightdata"), false);
  assert.equal(reorderProvidersForKeyPriority({}), null);
});

test("user pin skips managed routing refresh and key reorder", () => {
  const agentDir = tempAgentDir("coc-web-search-pin-");
  const secret = `tok_${process.pid}_d`;
  const pinned = {
    provider: "searxng",
    workflow: "summary-review",
    searchRouting: { providers: ["searxng"], fallbackOn: ["quota"] },
  };
  fs.writeFileSync(webSearchConfigPath(agentDir), JSON.stringify(pinned, null, 2) + "\n");
  assert.equal(hasPinnedProvider(pinned), true);

  const applied = applyWebSearchDefaults(pinned, {
    workflow: "none",
    searchRouting: DEFAULT_SEARCH_ROUTING,
  });
  assert.equal(applied.next.provider, "searxng");
  assert.equal(applied.next.workflow, "summary-review");
  assert.deepEqual(applied.next.searchRouting, pinned.searchRouting);

  const view = saveWebSearchApiKeys(agentDir, { keys: { openaiApiKey: secret } });
  assert.equal(view.keys.openaiApiKey, true);
  assertNoSecretInPublic(view, secret);
  const disk = readConfig(agentDir);
  assert.equal(disk.provider, "searxng");
  assert.deepEqual(disk.searchRouting.providers, ["searxng"]);
  assert.equal(disk.searchRouting.providers[0] === "openai", false);
  fs.rmSync(agentDir, { recursive: true, force: true });
});

test("ensureWebSearchDefaults seeds Exa-first routing via marker without inventing keys", () => {
  const agentDir = tempAgentDir("coc-web-search-def-");
  assert.equal(ensureWebSearchDefaults(agentDir), "created");
  assert.equal(ensureWebSearchDefaults(agentDir), "unchanged");
  const disk = readConfig(agentDir);
  assert.deepEqual(disk.searchRouting.providers, [...DEFAULT_SEARCH_ROUTING.providers]);
  assert.equal(disk.workflow, "none");
  assert.equal(Object.keys(disk).some((k) => k.endsWith("ApiKey")), false);
  const marker = JSON.parse(fs.readFileSync(path.join(agentDir, WEB_SEARCH_DEFAULTS_MARKER), "utf8"));
  assert.equal(marker.version, 1);
  assert.deepEqual(marker.managed.searchRouting.providers[0], "exa");
  fs.rmSync(agentDir, { recursive: true, force: true });
});

test("PUT preserves unrelated fields and reorders when unpinned", () => {
  const agentDir = tempAgentDir("coc-web-search-merge-");
  const secret = `tok_${process.pid}_e`;
  fs.writeFileSync(
    webSearchConfigPath(agentDir),
    JSON.stringify({ workflow: "none", firecrawlBaseUrl: "https://crawl.example", note: "keep" }, null, 2) + "\n",
  );
  saveWebSearchApiKeys(agentDir, { keys: { openaiApiKey: secret } });
  const disk = readConfig(agentDir);
  assert.equal(disk.note, "keep");
  assert.equal(disk.firecrawlBaseUrl, "https://crawl.example");
  assert.deepEqual(disk.searchRouting.providers, ["openai", "exa", "tavily", "perplexity", "searxng"]);
  fs.rmSync(agentDir, { recursive: true, force: true });
});

test("atomic write cleans up tmp on failure", () => {
  const agentDir = tempAgentDir("coc-web-search-tmp-");
  fs.writeFileSync(webSearchConfigPath(agentDir), "{}\n");
  fs.chmodSync(agentDir, 0o555);
  try {
    assert.throws(() => saveWebSearchApiKeys(agentDir, { keys: { exaApiKey: "x" } }));
  } finally {
    fs.chmodSync(agentDir, 0o755);
  }
  const leftovers = fs.readdirSync(agentDir).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
  fs.rmSync(agentDir, { recursive: true, force: true });
});

/** Same GET/PUT contract as server.mjs, without spawning sidecar. */
function listenKeysHttp(agentDir) {
  const server = http.createServer((req, res) => {
    const send = (status, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
    };
    const urlPath = new URL(req.url, "http://127.0.0.1").pathname;
    if (urlPath !== "/api/web-search-keys") {
      send(404, { error: "not found" });
      return;
    }
    if (req.method === "GET") {
      send(200, loadWebSearchKeysView(agentDir));
      return;
    }
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const patch = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          send(200, saveWebSearchApiKeys(agentDir, patch));
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
        agentDir,
        close: () => server.close(),
      });
    });
  });
}

let httpServer = null;

async function getHttpServer() {
  if (httpServer) return httpServer;
  const agentDir = tempAgentDir("coc-web-search-http-");
  httpServer = await listenKeysHttp(agentDir);
  return httpServer;
}

after(() => {
  httpServer?.close();
  if (httpServer?.agentDir) fs.rmSync(httpServer.agentDir, { recursive: true, force: true });
});

test("settings pane lists Tavily and Perplexity without secret echo placeholders", () => {
  const pane = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/components/WebSearchKeysPane.tsx"),
    "utf8",
  );
  assert.match(pane, /tavilyApiKey/);
  assert.match(pane, /perplexityApiKey/);
  assert.match(pane, /已配置/);
  assert.doesNotMatch(pane, /tavilyApiKey:\s*view/);
});

test("GET /api/web-search-keys defaults to empty configured map", async () => {
  const { base } = await getHttpServer();
  const res = await fetch(`${base}/api/web-search-keys`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.keys, {});
  assert.equal(body.providers[0].id, "exa");
});

test("PUT then GET /api/web-search-keys exposes configured without secret", async () => {
  const { base } = await getHttpServer();
  const secret = `tok_${process.pid}_http`;
  const put = await fetch(`${base}/api/web-search-keys`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: { exaApiKey: secret } }),
  });
  assert.equal(put.status, 200);
  const saved = await put.json();
  assert.equal(saved.keys.exaApiKey, true);
  assert.equal(JSON.stringify(saved).includes(secret), false);

  const get = await fetch(`${base}/api/web-search-keys`);
  const body = await get.json();
  assert.equal(body.keys.exaApiKey, true);
  assert.equal(JSON.stringify(body).includes(secret), false);
});
