import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_OCR_SECRETS_RELATIVE,
  OCR_TOKEN_KEY,
  defaultOcrSecretsPath,
  loadOcrTokenView,
  parseOcrTokenPatch,
  resolveOcrSecretsPath,
  saveOcrToken,
} from "../ocr-secrets.mjs";

const SERVER_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs"),
  "utf8",
);
const API_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/api.ts"),
  "utf8",
);
const PANE_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/components/OcrSecretsPane.tsx"),
  "utf8",
);
const GENERAL_SRC = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../frontend/src/components/SettingsGeneralPane.tsx",
  ),
  "utf8",
);

function tempHome(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function secretsPathForHome(home) {
  return path.join(home, DEFAULT_OCR_SECRETS_RELATIVE);
}

function assertPublicView(view, configured, secret) {
  assert.deepEqual(Object.keys(view).sort(), ["configured"]);
  assert.equal(view.configured, configured);
  const text = JSON.stringify(view);
  assert.equal(text.includes(OCR_TOKEN_KEY), false);
  if (secret) assert.equal(text.includes(secret), false);
}

function readDisk(file) {
  return fs.readFileSync(file, "utf8");
}

test("canonical path is COC_KEEPER_ENV_FILE or ~/.config/coc-keeper/secrets.env, never PI_AGENT_DIR", () => {
  const home = tempHome("coc-ocr-home-");
  try {
    assert.equal(defaultOcrSecretsPath(home), secretsPathForHome(home));
    assert.equal(resolveOcrSecretsPath({ home, envFile: "" }), secretsPathForHome(home));
    const override = path.join(home, "custom", "secrets.env");
    assert.equal(resolveOcrSecretsPath({ home, envFile: override }), override);
    assert.throws(() => resolveOcrSecretsPath({ envFile: "relative.env" }), /must be absolute/);
    const resolved = resolveOcrSecretsPath({ home });
    assert.equal(resolved.includes("PI_AGENT_DIR"), false);
    assert.equal(path.basename(resolved), "secrets.env");
    assert.equal(resolved.includes("web-search.json"), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("server.mjs wires GET and PUT /api/ocr-token independently of web-search-keys", () => {
  assert.match(SERVER_SRC, /from "\.\/ocr-secrets\.mjs"/);
  assert.match(SERVER_SRC, /if \(urlPath === "\/api\/ocr-token"\) return handleOcrToken/);
  assert.match(SERVER_SRC, /if \(urlPath === "\/api\/ocr-token"\) return handleSaveOcrToken/);
  assert.match(SERVER_SRC, /if \(urlPath === "\/api\/web-search-keys"\) return handleWebSearchKeys/);
  assert.match(API_SRC, /fetchWebSearchKeys/);
  assert.match(API_SRC, /saveWebSearchKeys/);
  assert.match(API_SRC, /\/api\/ocr-token/);
  assert.match(GENERAL_SRC, /<OcrSecretsPane \/>/);
  assert.match(PANE_SRC, /type="password"/);
  assert.match(PANE_SRC, /ocr-token-save/);
  assert.match(PANE_SRC, /ocr-token-clear/);
  assert.match(PANE_SRC, /ocr-token-reset/);
});

test("GET missing file is not configured and does not create the file", () => {
  const home = tempHome("coc-ocr-missing-");
  const file = secretsPathForHome(home);
  try {
    const view = loadOcrTokenView(file);
    assertPublicView(view, false);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("PUT stores BAIDUOCR_TOKEN, GET returns configured only, modes are 0700/0600", () => {
  const home = tempHome("coc-ocr-put-");
  const file = secretsPathForHome(home);
  const secret = `tok_${process.pid}_a`;
  try {
    const view = saveOcrToken({ token: secret }, file);
    assertPublicView(view, true, secret);
    assertPublicView(loadOcrTokenView(file), true, secret);

    const disk = readDisk(file);
    assert.equal(disk.includes(`${OCR_TOKEN_KEY}=`), true);
    assert.equal(disk.includes(secret), true);
    assert.equal(JSON.stringify(loadOcrTokenView(file)).includes(secret), false);

    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("PUT preserves other lines and empty token deletes only BAIDUOCR_TOKEN", () => {
  const home = tempHome("coc-ocr-keep-");
  const file = path.join(home, "secrets.env");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file, "# keep me\nOTHER_KEY=stay\nBAIDUOCR_TOKEN=old\nTRAIL=1\n", { mode: 0o600 });
  const secret = `tok_${process.pid}_b`;
  try {
    saveOcrToken({ token: secret }, file);
    const afterSet = readDisk(file);
    assert.equal(afterSet.includes("# keep me"), true);
    assert.equal(afterSet.includes("OTHER_KEY=stay"), true);
    assert.equal(afterSet.includes("TRAIL=1"), true);
    assert.equal(afterSet.includes("old"), false);

    const cleared = saveOcrToken({ token: "  " }, file);
    assertPublicView(cleared, false, secret);
    const afterDel = readDisk(file);
    assert.equal(afterDel.includes("BAIDUOCR_TOKEN="), false);
    assert.equal(afterDel.includes("# keep me"), true);
    assert.equal(afterDel.includes("OTHER_KEY=stay"), true);
    assert.equal(afterDel.includes("TRAIL=1"), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("empty PUT on a token-only file removes the file", () => {
  const home = tempHome("coc-ocr-unlink-");
  const file = path.join(home, "secrets.env");
  try {
    saveOcrToken({ token: `tok_${process.pid}_c` }, file);
    assert.equal(fs.existsSync(file), true);
    saveOcrToken({ token: "" }, file);
    assert.equal(fs.existsSync(file), false);
    assertPublicView(loadOcrTokenView(file), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("newlines and invalid patches are rejected without writing", () => {
  const home = tempHome("coc-ocr-reject-");
  const file = path.join(home, "secrets.env");
  try {
    assert.throws(() => parseOcrTokenPatch({ token: "a\nb" }), /newlines/);
    assert.throws(() => parseOcrTokenPatch({ token: "a\r" }), /newlines/);
    assert.throws(() => parseOcrTokenPatch({ token: 1 }), /must be a string/);
    assert.throws(() => parseOcrTokenPatch({}), /token is required/);
    assert.throws(() => parseOcrTokenPatch(null), /JSON object/);
    assert.throws(() => saveOcrToken({ token: "line\nbreak" }, file), /newlines/);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("symlink file is rejected", () => {
  if (process.platform === "win32") return;
  const home = tempHome("coc-ocr-symlink-");
  const real = path.join(home, "real.env");
  const link = path.join(home, "secrets.env");
  fs.writeFileSync(real, "BAIDUOCR_TOKEN=nope\n", { mode: 0o600 });
  fs.symlinkSync(real, link);
  try {
    assert.throws(() => loadOcrTokenView(link), /regular non-symlink file/);
    assert.throws(() => saveOcrToken({ token: "x" }, link), /regular non-symlink file/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/** Same GET/PUT contract as server.mjs, without spawning sidecar. */
function listenOcrHttp(envFile) {
  const server = http.createServer((req, res) => {
    const send = (status, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
    };
    const urlPath = new URL(req.url, "http://127.0.0.1").pathname;
    if (urlPath !== "/api/ocr-token") {
      send(404, { error: "not found" });
      return;
    }
    if (req.method === "GET") {
      try {
        send(200, loadOcrTokenView(envFile));
      } catch (err) {
        send(Number.isInteger(err?.status) ? err.status : 500, { error: err?.message || String(err) });
      }
      return;
    }
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const patch = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          send(200, saveOcrToken(patch, envFile));
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
        envFile,
        close: () => server.close(),
      });
    });
  });
}

let httpServer = null;
let httpHome = null;

async function getHttpServer() {
  if (httpServer) return httpServer;
  httpHome = tempHome("coc-ocr-http-");
  const envFile = path.join(httpHome, "secrets.env");
  httpServer = await listenOcrHttp(envFile);
  return httpServer;
}

after(() => {
  httpServer?.close();
  if (httpHome) fs.rmSync(httpHome, { recursive: true, force: true });
});

test("GET/PUT /api/ocr-token round-trip uses env file and never echoes token", async () => {
  const { base, envFile } = await getHttpServer();
  const secret = `tok_${process.pid}_http`;
  const empty = await fetch(`${base}/api/ocr-token`);
  assert.equal(empty.status, 200);
  assertPublicView(await empty.json(), false, secret);

  const put = await fetch(`${base}/api/ocr-token`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: secret }),
  });
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assertPublicView(putBody, true, secret);

  const get = await fetch(`${base}/api/ocr-token`);
  assertPublicView(await get.json(), true, secret);
  assert.equal(readDisk(envFile).includes(`${OCR_TOKEN_KEY}=`), true);

  const bad = await fetch(`${base}/api/ocr-token`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "a\nb" }),
  });
  assert.equal(bad.status, 400);
  const badBody = await bad.json();
  assert.equal(JSON.stringify(badBody).includes(secret), false);

  const clear = await fetch(`${base}/api/ocr-token`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "" }),
  });
  assertPublicView(await clear.json(), false, secret);
});

test("COC_KEEPER_ENV_FILE wins over HOME for resolve", () => {
  const home = tempHome("coc-ocr-env-");
  const envFile = path.join(home, "override.env");
  const prevFile = process.env.COC_KEEPER_ENV_FILE;
  const prevHome = process.env.HOME;
  try {
    process.env.HOME = home;
    process.env.COC_KEEPER_ENV_FILE = envFile;
    assert.equal(resolveOcrSecretsPath(), envFile);
    delete process.env.COC_KEEPER_ENV_FILE;
    assert.equal(resolveOcrSecretsPath({ home }), secretsPathForHome(home));
  } finally {
    if (prevFile === undefined) delete process.env.COC_KEEPER_ENV_FILE;
    else process.env.COC_KEEPER_ENV_FILE = prevFile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
