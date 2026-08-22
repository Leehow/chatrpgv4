import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { decodeRequestPath, serveStatic } from "../static-files.mjs";

let fixtureRoot;
let distDir;
let server;
let baseUrl;
let bridge;

before(async () => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coc-static-files-"));
  distDir = path.join(fixtureRoot, "dist");
  const siblingDir = path.join(fixtureRoot, "dist-sibling");
  const outsideDir = path.join(fixtureRoot, "outside");
  fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
  fs.mkdirSync(siblingDir);
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(distDir, "index.html"), "<main>spa shell</main>");
  fs.writeFileSync(path.join(distDir, "assets", "app.js"), "export const ok = true;");
  fs.writeFileSync(path.join(siblingDir, "secret.txt"), "sibling secret");
  fs.writeFileSync(path.join(outsideDir, "secret.txt"), "symlink secret");
  fs.symlinkSync(path.join(outsideDir, "secret.txt"), path.join(distDir, "escape.txt"));

  server = http.createServer((req, res) => {
    try {
      serveStatic(req, res, decodeRequestPath(req.url), { distDir });
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(error?.stack || String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (bridge) {
    bridge.child.kill("SIGTERM");
    if (bridge.child.exitCode === null) await once(bridge.child, "exit");
    fs.rmSync(bridge.workspace, { recursive: true, force: true });
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

async function get(urlPath) {
  const response = await fetch(`${baseUrl}${urlPath}`);
  return { status: response.status, body: await response.text() };
}

test("static HTTP seam serves in-root files and the SPA shell", async () => {
  const asset = await get("/assets/app.js");
  assert.equal(asset.status, 200);
  assert.equal(asset.body, "export const ok = true;");

  const spa = await get("/campaign/example");
  assert.equal(spa.status, 200);
  assert.equal(spa.body, "<main>spa shell</main>");
});

test("static HTTP seam rejects encoded sibling-prefix traversal", async () => {
  const response = await get("/%2e%2e%2fdist-sibling%2fsecret.txt");
  assert.equal(response.status, 403);
  assert.doesNotMatch(response.body, /sibling secret/);
});

test("static HTTP seam rejects encoded traversal outside dist", async () => {
  const response = await get("/%2e%2e%2foutside%2fsecret.txt");
  assert.equal(response.status, 403);
  assert.doesNotMatch(response.body, /symlink secret/);
});

test("static HTTP seam rejects absolute URL-path attempts", async () => {
  const response = await get("//etc/passwd");
  assert.equal(response.status, 403);
});

test("static HTTP seam rejects symlinks that resolve outside dist", async () => {
  const response = await get("/escape.txt");
  assert.equal(response.status, 403);
  assert.doesNotMatch(response.body, /symlink secret/);
});

test("the real bridge keeps unknown API GETs out of the SPA fallback", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-static-api-"));
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const serverPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "server.mjs",
  );
  const child = spawn(
    process.execPath,
    [serverPath, "--workspace", workspace, "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  bridge = { child, workspace };
  const apiUrl = `http://127.0.0.1:${port}/api/not-a-real-route`;
  const deadline = Date.now() + 10_000;
  let response;
  while (!response) {
    try {
      response = await fetch(apiUrl);
    } catch {
      if (Date.now() >= deadline) {
        throw new Error("real bridge did not start within 10 seconds");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not found" });
});
