import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_ASPECT_RATIOS,
  DEFAULT_XAI_IMAGE_MODEL,
  XAI_IMAGES_GENERATIONS_URL,
  XaiImageError,
  buildImagineRequest,
  generateCampaignPortrait,
  parseGeneratePortraitBody,
  redactSecrets,
  resolvePortraitOutputPath,
  resolveXaiToken,
  runGeneratePortraitHttp,
  safeImageLogFields,
  tokenFromXaiEntry,
} from "../xai-image.mjs";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_B64, "base64");
const SECRET = "xai-test-secret-value-do-not-leak";

const SERVER_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs"),
  "utf8",
);

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function writeAuth(dir, xai) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ xai }));
}

function makeCampaign(workspace, campaignId = "amaranthine-16") {
  const dir = path.join(workspace, ".coc", "campaigns", campaignId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "campaign.json"), JSON.stringify({ campaign_id: campaignId }));
  return campaignId;
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function mockImagine(calls, { status = 200, body } = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    if (status !== 200) {
      return jsonResponse(status, body ?? { error: { message: `fail ${status}` } });
    }
    return jsonResponse(
      200,
      body ?? { data: [{ b64_json: PNG_B64, mime_type: "image/png" }] },
    );
  };
}

test("server.mjs wires POST /api/portraits/generate and does not port PipiUI relays", () => {
  assert.match(SERVER_SRC, /from "\.\/xai-image\.mjs"/);
  assert.match(
    SERVER_SRC,
    /if \(urlPath === "\/api\/portraits\/generate"\) return handleGeneratePortrait/,
  );
  assert.equal(SERVER_SRC.includes("PIPIUI_GROK_RELAY"), false);
  assert.equal(SERVER_SRC.includes("PIPIUI_CODING_RELAY"), false);
  assert.equal(SERVER_SRC.includes("127.0.0.1:18891"), false);
});

test("XAI_API_KEY wins over auth.json", () => {
  const agentDir = tempDir("coc-xai-auth-");
  try {
    writeAuth(agentDir, { key: "auth-json-key-value-xx" });
    const resolved = resolveXaiToken({
      env: { XAI_API_KEY: SECRET, PI_AGENT_DIR: agentDir },
      agentDir,
    });
    assert.equal(resolved.source, "env");
    assert.equal(resolved.token, SECRET);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("product auth.json prefers unexpired access then key", () => {
  const agentDir = tempDir("coc-xai-oauth-");
  try {
    writeAuth(agentDir, {
      access: "oauth-access-token-xx",
      key: "fallback-key-value-xx",
      expires: Date.now() + 60_000,
    });
    const live = resolveXaiToken({ env: { PI_AGENT_DIR: agentDir }, agentDir });
    assert.equal(live.source, "auth.json");
    assert.equal(live.token, "oauth-access-token-xx");

    const expired = tokenFromXaiEntry(
      { access: "old-access-token-xx", key: "fallback-key-value-xx", expires: 1 },
      Date.now(),
    );
    assert.equal(expired, "fallback-key-value-xx");
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("missing token is none and never invents a relay token", () => {
  const agentDir = tempDir("coc-xai-none-");
  try {
    const resolved = resolveXaiToken({
      env: { PIPIUI_GROK_RELAY: "http://127.0.0.1:18891/v1", PI_AGENT_DIR: agentDir },
      agentDir,
    });
    assert.equal(resolved.source, "none");
    assert.equal(resolved.token, "");
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("imagine request is official generations n=1 b64_json", () => {
  const body = buildImagineRequest({ prompt: "1920s flapper in Arkham fog", aspectRatio: "1:1" });
  assert.equal(body.model, DEFAULT_XAI_IMAGE_MODEL);
  assert.equal(body.n, 1);
  assert.equal(body.response_format, "b64_json");
  assert.equal(body.prompt, "1920s flapper in Arkham fog");
  assert.equal(body.aspect_ratio, "1:1");
  assert.ok(ALLOWED_ASPECT_RATIOS.includes("1:1"));
});

test("generateCampaignPortrait writes caller tmp portrait path only", async () => {
  const workspace = tempDir("coc-xai-ws-");
  const agentDir = tempDir("coc-xai-agent-");
  const logs = [];
  try {
    const campaignId = makeCampaign(workspace);
    fs.writeFileSync(
      path.join(workspace, ".coc", "campaigns", campaignId, "character.json"),
      JSON.stringify({ name: "untouched" }),
    );
    const calls = [];
    const result = await generateCampaignPortrait({
      workspace,
      campaignId,
      prompt: "confirmed appearance: dark coat, grey eyes",
      outputPath: "tmp/portraits/pending.png",
      env: { XAI_API_KEY: SECRET, PIPIUI_GROK_RELAY: "http://127.0.0.1:18891/v1" },
      agentDir,
      fetchImpl: mockImagine(calls),
      log: (event, fields) => logs.push({ event, ...fields }),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, XAI_IMAGES_GENERATIONS_URL);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SECRET}`);
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.n, 1);
    assert.equal(sent.model, DEFAULT_XAI_IMAGE_MODEL);
    assert.equal(sent.response_format, "b64_json");
    const dest = path.join(workspace, ".coc", "campaigns", campaignId, "tmp", "portraits", "pending.png");
    assert.equal(fs.readFileSync(dest).equals(PNG_BYTES), true);
    assert.equal(result.ok, true);
    assert.equal(result.output_path, path.relative(workspace, dest));
    assert.equal(result.model, DEFAULT_XAI_IMAGE_MODEL);
    const character = JSON.parse(
      fs.readFileSync(path.join(workspace, ".coc", "campaigns", campaignId, "character.json"), "utf8"),
    );
    assert.deepEqual(character, { name: "untouched" });
    assert.equal(fs.existsSync(path.join(workspace, ".pi", "attachments")), false);
    const dump = JSON.stringify({ logs, result, calls: calls.map((c) => ({ url: c.url, body: c.init.body })) });
    assert.equal(dump.includes(SECRET), false);
    assert.equal(JSON.stringify(safeImageLogFields({ token: SECRET, model: "x" })).includes(SECRET), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("target assets/portraits path is allowed; traversal is not", () => {
  const workspace = tempDir("coc-xai-path-");
  try {
    const campaignId = makeCampaign(workspace);
    const dest = resolvePortraitOutputPath({
      workspace,
      campaignId,
      outputPath: "assets/portraits/hero.png",
    });
    assert.equal(
      dest,
      path.join(workspace, ".coc", "campaigns", campaignId, "assets", "portraits", "hero.png"),
    );
    assert.throws(
      () =>
        resolvePortraitOutputPath({
          workspace,
          campaignId,
          outputPath: "tmp/portraits/../../../../etc/passwd.png",
        }),
      /assets\/portraits or tmp\/portraits/,
    );
    assert.throws(
      () =>
        resolvePortraitOutputPath({
          workspace,
          campaignId,
          outputPath: path.join(os.tmpdir(), "escape.png"),
        }),
      /assets\/portraits or tmp\/portraits/,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("401/403/429/5xx map to clear errors without leaking the token", async () => {
  const workspace = tempDir("coc-xai-err-");
  try {
    const campaignId = makeCampaign(workspace);
    for (const status of [401, 403, 429, 503]) {
      const calls = [];
      await assert.rejects(
        () =>
          generateCampaignPortrait({
            workspace,
            campaignId,
            prompt: "a face",
            outputPath: "tmp/portraits/x.png",
            env: { XAI_API_KEY: SECRET },
            fetchImpl: mockImagine(calls, {
              status,
              body: { error: { message: `nope ${SECRET}` } },
            }),
            log() {},
          }),
        (err) => {
          assert.equal(err instanceof XaiImageError, true);
          assert.equal(err.status, status);
          assert.equal(err.message.includes(SECRET), false);
          if (status === 401) assert.match(err.message, /unauthorized/i);
          if (status === 403) assert.match(err.message, /forbidden/i);
          if (status === 429) assert.match(err.message, /rate limited/i);
          if (status === 503) assert.match(err.message, /upstream/i);
          return true;
        },
      );
    }
    assert.equal(
      redactSecrets(`Bearer ${SECRET} and ${SECRET}`, [SECRET]).includes(SECRET),
      false,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("AbortSignal cancels the official fetch", async () => {
  const workspace = tempDir("coc-xai-abort-");
  try {
    const campaignId = makeCampaign(workspace);
    const ac = new AbortController();
    await assert.rejects(
      () =>
        generateCampaignPortrait({
          workspace,
          campaignId,
          prompt: "a face",
          outputPath: "tmp/portraits/x.png",
          env: { XAI_API_KEY: SECRET },
          signal: ac.signal,
          timeoutMs: 30_000,
          fetchImpl: (_url, init) =>
            new Promise((_, reject) => {
              init.signal.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              });
              ac.abort();
            }),
          log() {},
        }),
      (err) => {
        assert.equal(err.status, 499);
        assert.match(err.message, /cancelled/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("timeout maps to 504", async () => {
  const workspace = tempDir("coc-xai-timeout-");
  try {
    const campaignId = makeCampaign(workspace);
    await assert.rejects(
      () =>
        generateCampaignPortrait({
          workspace,
          campaignId,
          prompt: "a face",
          outputPath: "tmp/portraits/x.png",
          env: { XAI_API_KEY: SECRET },
          timeoutMs: 20,
          fetchImpl: (_url, init) =>
            new Promise((_, reject) => {
              init.signal.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              });
            }),
          log() {},
        }),
      (err) => {
        assert.equal(err.status, 504);
        assert.match(err.message, /timed out/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("HTTP mock service boundary writes portrait and returns path JSON", async () => {
  const workspace = tempDir("coc-xai-http-");
  const agentDir = tempDir("coc-xai-http-agent-");
  try {
    const campaignId = makeCampaign(workspace);
    const calls = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        runGeneratePortraitHttp({
          workspace,
          body,
          env: { XAI_API_KEY: SECRET },
          agentDir,
          fetchImpl: mockImagine(calls),
          log() {},
        })
          .then((result) => {
            const buf = Buffer.from(JSON.stringify(result));
            res.writeHead(200, { "Content-Type": "application/json", "Content-Length": buf.length });
            res.end(buf);
          })
          .catch((err) => {
            const buf = Buffer.from(JSON.stringify({ error: err.message }));
            res.writeHead(err.status || 500, {
              "Content-Type": "application/json",
              "Content-Length": buf.length,
            });
            res.end(buf);
          });
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/portraits/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign_id: campaignId,
        prompt: "player-confirmed appearance",
        output_path: "assets/portraits/sheet.png",
      }),
    });
    const json = await res.json();
    server.close();
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.model, DEFAULT_XAI_IMAGE_MODEL);
    assert.equal(JSON.stringify(json).includes(SECRET), false);
    assert.equal(JSON.stringify(json).includes(PNG_B64), false);
    const dest = path.join(
      workspace,
      ".coc",
      "campaigns",
      campaignId,
      "assets",
      "portraits",
      "sheet.png",
    );
    assert.equal(fs.existsSync(dest), true);
    assert.equal(calls[0].url, XAI_IMAGES_GENERATIONS_URL);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("parseGeneratePortraitBody rejects empty prompt and bad aspect", () => {
  assert.throws(() => parseGeneratePortraitBody({ campaign_id: "c1", output_path: "tmp/portraits/a.png" }), /prompt/);
  assert.throws(
    () =>
      parseGeneratePortraitBody({
        campaign_id: "c1",
        prompt: "x",
        output_path: "tmp/portraits/a.png",
        aspect_ratio: "99:1",
      }),
    /aspect_ratio/,
  );
});
