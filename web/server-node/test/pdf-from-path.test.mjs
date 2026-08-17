// Hermetic HTTP tests for POST /api/uploads/pdf/from-path — the desktop
// shell's local-path PDF import transport. Spawns the real node bridge
// against a tmp workspace; no network beyond 127.0.0.1, no PDF parsing
// (the endpoint checks existence/suffix/hash only), no writes outside the
// per-run tmp dirs.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");

// Minimal byte string satisfying the endpoint's %PDF magic check; the bridge
// never parses content, so this never needs to be a renderable PDF.
const FAKE_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");

let server = null;

async function getServer() {
  if (server) return server;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pdf-from-path-ws-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(
    process.execPath,
    [SERVER, "--workspace", workspace, "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill("SIGTERM");
      throw new Error("server.mjs did not become healthy within 20s");
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  server = { base, workspace, child };
  return server;
}

after(() => {
  if (server) server.child.kill("SIGTERM");
});

function makePdf(dir, name, data = FAKE_PDF) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
}

async function postFromPath(base, body) {
  const res = await fetch(`${base}/api/uploads/pdf/from-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test("from-path registers a local PDF into .coc/uploads/pdfs (pending ingest)", async () => {
  const { base, workspace } = await getServer();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pdf-src-"));
  const pdfPath = makePdf(srcDir, "my module.pdf");

  const { status, json } = await postFromPath(base, { path: pdfPath });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  const result = json.result;
  assert.equal(result.status, "stored_pending_ingest");
  assert.equal(result.filename, "my module.pdf");
  assert.equal(result.file_sha256, createHash("sha256").update(FAKE_PDF).digest("hex"));
  // Stored copy lives inside the server workspace's .coc/uploads/pdfs/.
  const uploadsDir = path.join(workspace, ".coc", "uploads", "pdfs");
  assert.ok(
    result.stored_path.startsWith(uploadsDir),
    `stored_path ${result.stored_path} outside ${uploadsDir}`,
  );
  assert.ok(fs.existsSync(result.stored_path));
  assert.deepEqual(fs.readFileSync(result.stored_path), FAKE_PDF);
});

test("from-path is idempotent for the same file", async () => {
  const { base } = await getServer();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pdf-src-"));
  const pdfPath = makePdf(srcDir, "dup.pdf");

  const first = await postFromPath(base, { path: pdfPath });
  const second = await postFromPath(base, { path: pdfPath });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.json.result.stored_path, second.json.result.stored_path);
  const uploads = fs.readdirSync(path.dirname(first.json.result.stored_path));
  const copies = uploads.filter((n) => n.endsWith("_dup.pdf"));
  assert.equal(copies.length, 1, `expected one stored copy, got ${copies.join(",")}`);
});

test("from-path rejects a missing path field", async () => {
  const { base } = await getServer();
  const { status } = await postFromPath(base, {});
  assert.equal(status, 400);
});

test("from-path rejects a nonexistent file", async () => {
  const { base } = await getServer();
  const { status, json } = await postFromPath(base, {
    path: path.join(os.tmpdir(), "coc-pdf-from-path-no-such-file.pdf"),
  });
  assert.equal(status, 404);
  assert.match(json.error, /找不到文件/);
});

test("from-path rejects non-.pdf suffix and non-PDF content", async () => {
  const { base } = await getServer();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pdf-src-"));

  const txt = makePdf(srcDir, "notes.txt");
  const suffixRes = await postFromPath(base, { path: txt });
  assert.equal(suffixRes.status, 400);
  assert.match(suffixRes.json.error, /\.pdf/);

  const fake = makePdf(srcDir, "fake.pdf", Buffer.from("not a pdf at all", "latin1"));
  const magicRes = await postFromPath(base, { path: fake });
  assert.equal(magicRes.status, 400);
  assert.match(magicRes.json.error, /%PDF/);
});

// Regression guard for the registerPdfUpload extraction: the original
// multipart browser upload must behave exactly as before the refactor.
test("multipart upload still registers identically after the refactor", async () => {
  const { base, workspace } = await getServer();
  const boundary = "----cocTestBoundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="browser.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`,
    "latin1",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "latin1");
  const res = await fetch(`${base}/api/uploads/pdf`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([head, FAKE_PDF, tail]),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.result.status, "stored_pending_ingest");
  assert.equal(json.result.filename, "browser.pdf");
  assert.equal(
    json.result.file_sha256,
    createHash("sha256").update(FAKE_PDF).digest("hex"),
  );
  assert.ok(
    json.result.stored_path.startsWith(path.join(workspace, ".coc", "uploads", "pdfs")),
  );
});
