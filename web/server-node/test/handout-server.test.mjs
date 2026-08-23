import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { HandoutSessionDelivery } from "../handout-delivery.mjs";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
const SERVER_SOURCE = fs.readFileSync(SERVER, "utf8");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function seedCampaign(workspace, { delivered = [] } = {}) {
  const campaignDir = path.join(workspace, ".coc", "campaigns", "camp-1");
  writeJson(path.join(campaignDir, "campaign.json"), {
    schema_version: 3,
    campaign_id: "camp-1",
    status: "active",
    play_language: "zh-Hans",
  });
  writeJson(path.join(campaignDir, "save", "world-state.json"), {
    schema_version: 2,
    campaign_id: "camp-1",
    ...(delivered.length ? { delivered_handout_ids: delivered } : {}),
  });
  writeJson(path.join(campaignDir, "scenario", "handouts.json"), {
    schema_version: 1,
    handouts: [
      {
        asset_id: "visible",
        kind: "map",
        title: "Visible map",
        image_ref: "assets/handouts/visible.png",
        player_visible: true,
      },
      {
        asset_id: "undelivered",
        kind: "map",
        title: "Undelivered map",
        image_ref: "assets/handouts/undelivered.png",
        player_visible: true,
      },
      {
        asset_id: "keeper-only",
        kind: "map",
        title: "Keeper map",
        image_ref: "assets/handouts/keeper-only.png",
        player_visible: false,
      },
      {
        asset_id: "malformed",
        kind: "map",
        title: "Malformed visibility",
        image_ref: "assets/handouts/malformed.png",
        player_visible: "false",
      },
    ],
  });
  writeJson(path.join(campaignDir, "index", "handout-assets.json"), {
    schema_version: 1,
    asset_root: "assets/handouts",
    assets: [],
  });
  for (const name of ["visible", "undelivered", "keeper-only", "malformed"]) {
    const file = path.join(campaignDir, "assets", "handouts", `${name}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(`png:${name}`));
  }
  return campaignDir;
}

test("per-session handout SSE cursor is exactly-once and retries failed writes", () => {
  let materials = [{ asset_id: "already" }];
  let presentations = [{
    asset_id: "already",
    presentation_id: "already:presentation:1",
    presentation_revision: 1,
  }];
  const delivery = new HandoutSessionDelivery({
    projectMaterials: () => materials,
    projectPresentations: () => presentations,
  });
  assert.deepEqual(delivery.hydrate("unused", "session-a", "camp-1"), materials);
  delivery.hydrate("unused", "session-b", "camp-1");

  materials = [{ asset_id: "already" }, { asset_id: "new-card" }];
  presentations = [
    presentations[0],
    { asset_id: "new-card", presentation_id: "new-card:presentation:1", presentation_revision: 1 },
  ];
  const a = [];
  const b = [];
  assert.equal(delivery.pushNew("unused", "session-a", "camp-1", (event, card) => {
    a.push([event, card.asset_id, card.presentation_id]);
    return true;
  }), 1);
  assert.equal(delivery.pushNew("unused", "session-a", "camp-1", () => true), 0);
  assert.equal(delivery.pushNew("unused", "session-b", "camp-1", (event, card) => {
    b.push([event, card.asset_id, card.presentation_id]);
    return true;
  }), 1);
  assert.deepEqual(a, [["handout", "new-card", "new-card:presentation:1"]]);
  assert.deepEqual(b, [["handout", "new-card", "new-card:presentation:1"]]);

  materials = [...materials, { asset_id: "retry-card" }];
  presentations = [...presentations, {
    asset_id: "retry-card",
    presentation_id: "retry-card:presentation:1",
    presentation_revision: 1,
  }];
  assert.equal(delivery.pushNew("unused", "session-a", "camp-1", () => false), 0);
  const retried = [];
  assert.equal(delivery.pushNew("unused", "session-a", "camp-1", (event, card) => {
    retried.push([event, card.asset_id, card.presentation_id]);
    return true;
  }), 1);
  assert.deepEqual(retried, [["handout", "retry-card", "retry-card:presentation:1"]]);
  assert.equal(delivery.pushNew("unused", "session-a", "camp-1", () => true), 0);

  // Replay reuses the material asset but advances the presentation identity.
  presentations = presentations.map((card) => card.asset_id === "already"
    ? { ...card, presentation_id: "already:presentation:2", presentation_revision: 2 }
    : card);
  const replayed = [];
  assert.equal(delivery.pushNew("unused", "session-a", "camp-1", (event, card) => {
    replayed.push([event, card.asset_id, card.presentation_id]);
    return true;
  }), 1);
  assert.deepEqual(replayed, [["handout", "already", "already:presentation:2"]]);
  assert.equal(delivery.materials("unused", "camp-1").length, 3);
});

test("state.materials production seam refreshes from authoritative delivery state", () => {
  assert.match(
    SERVER_SOURCE,
    /state\.materials = HANDOUT_DELIVERY\.materials\(WORKSPACE, info\.campaign_id\)/,
  );
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-handout-materials-"));
  const campaignDir = seedCampaign(workspace);
  const delivery = new HandoutSessionDelivery();
  assert.deepEqual(delivery.materials(workspace, "camp-1"), []);

  writeJson(path.join(campaignDir, "save", "world-state.json"), {
    schema_version: 2,
    campaign_id: "camp-1",
    delivered_handout_ids: ["visible", "keeper-only", "malformed"],
  });
  const refreshed = delivery.materials(workspace, "camp-1");
  assert.deepEqual(refreshed.map((card) => card.asset_id), ["visible"]);
});

let running = null;

async function getServer() {
  if (running) return running;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-handout-http-"));
  seedCampaign(workspace, {
    delivered: ["visible", "keeper-only", "malformed"],
  });
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
      const response = await fetch(`${base}/api/health`);
      if (response.ok) break;
    } catch {
      /* not ready */
    }
    if (Date.now() > deadline || child.exitCode != null) {
      child.kill("SIGTERM");
      throw new Error("server.mjs did not become healthy for handout HTTP test");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  running = { base, child };
  return running;
}

after(() => {
  running?.child.kill("SIGTERM");
});

test("actual HTTP handout asset route serves only a delivered valid visible card", async () => {
  const { base } = await getServer();
  const visible = await fetch(
    `${base}/api/campaigns/camp-1/handout-assets/assets/handouts/visible.png`,
  );
  assert.equal(visible.status, 200);
  assert.equal(Buffer.from(await visible.arrayBuffer()).toString(), "png:visible");
  assert.equal(visible.headers.get("content-type"), "image/png");

  for (const name of ["undelivered", "keeper-only", "malformed"]) {
    const response = await fetch(
      `${base}/api/campaigns/camp-1/handout-assets/assets/handouts/${name}.png`,
    );
    assert.equal(response.status, 404, name);
    assert.deepEqual(await response.json(), { error: "handout asset not found" });
  }
});
