import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

import {
  generateInvestigatorPortrait,
  parseInvestigatorPortraitBody,
  resolvePortraitStaticFile,
} from "../portrait-generate.mjs";
import { XaiImageError } from "../xai-image.mjs";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_B64, "base64");
const OLD_BYTES = Buffer.from("old-portrait-bytes");
const SECRET = "xai-test-secret-value-do-not-leak";
const COMPAT = {
  PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH: JSON.stringify({ "ext.grok-build-oauth.compatFallback": true }),
};

const SERVER_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs"),
  "utf8",
);

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function seedWorkspace() {
  const ws = tempDir("coc-portrait-ui-");
  writeJson(path.join(ws, ".coc/campaigns/camp-1/campaign.json"), { campaign_id: "camp-1" });
  const oldPath = path.join(ws, ".coc/investigators/ada/portraits/old.png");
  fs.mkdirSync(path.dirname(oldPath), { recursive: true });
  fs.writeFileSync(oldPath, OLD_BYTES);
  writeJson(path.join(ws, ".coc/investigators/ada/character.json"), {
    id: "ada",
    name: "Ada",
    age: 29,
    era: "1920s",
    occupation: { name: "Journalist" },
    backstory: { personal_description: "高瘦，大衣领口别着铅笔。" },
    portrait: {
      asset_path: ".coc/investigators/ada/portraits/old.png",
      source: "player",
      status: "generated",
      generated_at: "2026-01-01T00:00:00Z",
      prompt: "previous prompt",
    },
  });
  return ws;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function mockImagine(calls, { status = 200, body } = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    if (status !== 200) {
      return jsonResponse(status, body ?? { error: { message: `fail ${status}` } });
    }
    return jsonResponse(200, body ?? { data: [{ b64_json: PNG_B64, mime_type: "image/png" }] });
  };
}

function fakeCliSpawn(workspace) {
  return (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write() {}, end() {} };
    queueMicrotask(() => {
      const jsonIdx = args.indexOf("--json");
      const payload = JSON.parse(args[jsonIdx + 1]);
      const sheetPath = path.join(workspace, ".coc/investigators/ada/character.json");
      const sheet = JSON.parse(fs.readFileSync(sheetPath, "utf8"));
      sheet.portrait = {
        ...(sheet.portrait || {}),
        asset_path: payload.asset_path,
        source: payload.source,
        status: "generated",
        generated_at: payload.generated_at,
        prompt: payload.prompt,
        provenance: payload.provenance,
        tool: payload.tool,
        host: payload.host,
      };
      fs.writeFileSync(sheetPath, JSON.stringify(sheet, null, 2));
      child.stdout.emit(
        "data",
        `${JSON.stringify({
          ok: true,
          portrait: {
            portrait_path: payload.asset_path,
            portrait_source: payload.source,
            portrait_status: "generated",
            portrait_generated_at: payload.generated_at,
          },
        })}\n`,
      );
      child.emit("close", 0);
    });
    return child;
  };
}

test("server.mjs serves investigator portraits and host generate path", () => {
  assert.match(SERVER_SRC, /generateInvestigatorPortrait/);
  assert.match(SERVER_SRC, /handleInvestigatorPortrait/);
  assert.match(SERVER_SRC, /attachPortraitToDisplayCharacter/);
  assert.equal(SERVER_SRC.includes("PIPIUI_GROK_RELAY"), false);
});

test("parseInvestigatorPortraitBody ignores client prompt", () => {
  const parsed = parseInvestigatorPortraitBody({
    campaign_id: "camp-1",
    investigator_id: "ada",
    prompt: "client must not inject this",
  });
  assert.deepEqual(parsed, { campaignId: "camp-1", investigatorId: "ada" });
});

test("generateInvestigatorPortrait writes a new file and does not leak prompt", async () => {
  const ws = seedWorkspace();
  const calls = [];
  try {
    const result = await generateInvestigatorPortrait({
      workspace: ws,
      campaignId: "camp-1",
      investigatorId: "ada",
      env: { ...COMPAT, XAI_API_KEY: SECRET },
      fetchImpl: mockImagine(calls),
      spawnFn: fakeCliSpawn(ws),
      now: new Date("2026-08-21T12:00:00.000Z"),
      prefs: { provider: "xai", model: "grok-4.6" },
      clientBody: { provider: "openai", model: "gpt-image-1" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.portrait.portrait_status, "generated");
    assert.equal(
      result.portrait.image_url,
      "/api/investigators/ada/portraits/portrait-20260821T120000Z.png",
    );
    assert.equal(result.portrait.prompt, undefined);
    assert.equal(JSON.stringify(result).includes("高瘦"), false);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    const dumped = JSON.stringify(calls[0].init.body);
    assert.match(dumped, /HARD APPEARANCE CONSTRAINT/);
    assert.match(dumped, /高瘦，大衣领口别着铅笔/);
    const old = fs.readFileSync(path.join(ws, ".coc/investigators/ada/portraits/old.png"));
    assert.deepEqual(old, OLD_BYTES);
    const next = fs.readFileSync(
      path.join(ws, ".coc/investigators/ada/portraits/portrait-20260821T120000Z.png"),
    );
    assert.deepEqual(next, PNG_BYTES);
    const sheet = JSON.parse(
      fs.readFileSync(path.join(ws, ".coc/investigators/ada/character.json"), "utf8"),
    );
    assert.equal(
      sheet.portrait.asset_path,
      ".coc/investigators/ada/portraits/portrait-20260821T120000Z.png",
    );
    assert.ok(sheet.portrait.prompt.includes("HARD APPEARANCE CONSTRAINT"));
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("generate failure does not overwrite the previous portrait", async () => {
  const ws = seedWorkspace();
  const before = fs.readFileSync(path.join(ws, ".coc/investigators/ada/character.json"), "utf8");
  try {
    await assert.rejects(
      () => generateInvestigatorPortrait({
        workspace: ws,
        campaignId: "camp-1",
        investigatorId: "ada",
        env: { ...COMPAT, XAI_API_KEY: SECRET },
        fetchImpl: mockImagine([], { status: 500 }),
        prefs: { provider: "xai" },
        spawnFn: () => {
          throw new Error("CLI must not run after image failure");
        },
      }),
      (err) => err instanceof XaiImageError && err.status === 500,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(ws, ".coc/investigators/ada/portraits/old.png")),
      OLD_BYTES,
    );
    assert.equal(
      fs.readFileSync(path.join(ws, ".coc/investigators/ada/character.json"), "utf8"),
      before,
    );
    const portraits = fs.readdirSync(path.join(ws, ".coc/investigators/ada/portraits"));
    assert.deepEqual(portraits, ["old.png"]);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("non-xAI OpenAI route uses selected model and keeps the old file on HTTP failure", async () => {
  const ws = seedWorkspace();
  const agentDir = tempDir("coc-portrait-oai-fail-");
  const before = fs.readFileSync(path.join(ws, ".coc/investigators/ada/character.json"), "utf8");
  try {
    fs.writeFileSync(
      path.join(agentDir, "auth.json"),
      JSON.stringify({ openai: { type: "api_key", key: "sk-test-openai-key-xxxx" } }),
    );
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          openai: {
            api: "openai-completions",
            baseUrl: "https://api.openai.com/v1",
            models: [{ id: "gpt-image-1" }],
          },
        },
      }),
    );
    await assert.rejects(
      () => generateInvestigatorPortrait({
        workspace: ws,
        campaignId: "camp-1",
        investigatorId: "ada",
        agentDir,
        prefs: {
          provider: "openai",
          portraitImageProvider: "openai",
          portraitImageModel: "gpt-image-1",
        },
        fetchImpl: async (url) => {
          assert.equal(String(url).includes("api.x.ai"), false);
          return { ok: false, status: 500, async text() { return "{}"; } };
        },
        spawnFn: () => {
          throw new Error("CLI must not run after image failure");
        },
      }),
      (err) => err instanceof XaiImageError && err.status === 500,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(ws, ".coc/investigators/ada/portraits/old.png")),
      OLD_BYTES,
    );
    assert.equal(
      fs.readFileSync(path.join(ws, ".coc/investigators/ada/character.json"), "utf8"),
      before,
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("resolvePortraitStaticFile confines reads to investigator portraits", () => {
  const ws = seedWorkspace();
  try {
    const secret = path.join(ws, ".coc/campaigns/camp-1/campaign.json");
    const ok = resolvePortraitStaticFile(ws, "ada", "old.png");
    assert.equal(ok.mime, "image/png");
    assert.ok(ok.file.endsWith(`${path.sep}old.png`));
    assert.equal(resolvePortraitStaticFile(ws, "ada", "../campaigns/camp-1/campaign.json"), null);
    assert.equal(resolvePortraitStaticFile(ws, "ada", "missing.png"), null);
    assert.equal(resolvePortraitStaticFile(ws, "..", "old.png"), null);
    assert.equal(fs.existsSync(secret), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
