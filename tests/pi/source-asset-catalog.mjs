#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const catalogUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/source-asset-catalog.ts"),
).href;
const mod = await import(catalogUrl);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J3S8AAAAASUVORK5CYII=",
  "base64",
);
const pngSha = `sha256:${createHash("sha256").update(PNG).digest("hex")}`;
const bundleSha = `sha256:${"ab".repeat(32)}`;

const mapAsset = {
  path: "assets/map.png",
  sha256: pngSha,
  pdf_index: 16,
  region: { x: 12, y: 40, width: 400, height: 280 },
  asset_ref: "producer:map-1",
  kind: "map",
};
const briefingAsset = {
  path: "assets/briefing-card.png",
  sha256: `sha256:${"cd".repeat(32)}`,
  pdf_index: 3,
  kind: "briefing",
  player_visible: true,
};
const kpAsset = {
  path: "assets/keeper-notes.png",
  sha256: `sha256:${"ef".repeat(32)}`,
  pdf_index: 8,
  kind: "kp-only",
};
const decoyNamedMap = {
  path: "assets/map-of-farmhouse.png",
  sha256: `sha256:${"11".repeat(32)}`,
};

const first = mod.buildSourceAssetCatalog({
  bundle_sha256: bundleSha,
  asset_root_id: "cold-harvest",
  source_bundle_path: ".coc/source-bundles/cold-harvest",
  assets: [mapAsset, briefingAsset, kpAsset, decoyNamedMap],
});
const second = mod.buildSourceAssetCatalog({
  bundle_sha256: bundleSha,
  asset_root_id: "cold-harvest",
  source_bundle_path: ".coc/source-bundles/cold-harvest",
  assets: [decoyNamedMap, kpAsset, briefingAsset, mapAsset],
});

assert.equal(first.assets.length, 4);
assert.deepEqual(
  first.assets.map((row) => row.asset_id),
  second.assets.map((row) => row.asset_id),
);
for (const row of first.assets) {
  assert.match(row.asset_id, /^srcasset-[0-9a-f]{32}$/);
  assert.equal(
    row.asset_id,
    mod.deriveSourceAssetId({
      bundle_sha256: bundleSha,
      path: row.path,
      sha256: row.sha256,
    }),
  );
}

const ignored = mod.buildSourceAssetCatalog({
  bundle_sha256: bundleSha,
  asset_root_id: "cold-harvest",
  source_bundle_path: ".coc/source-bundles/cold-harvest",
  assets: [{ ...mapAsset, asset_id: "i-am-a-model", id: "uuid-from-prompt" }],
});
assert.equal(ignored.assets[0].asset_id, first.assets.find((row) => row.path === "assets/map.png").asset_id);
assert.notEqual(ignored.assets[0].asset_id, "i-am-a-model");

const map = first.assets.find((row) => row.path === "assets/map.png");
const briefing = first.assets.find((row) => row.path === "assets/briefing-card.png");
const kpOnly = first.assets.find((row) => row.path === "assets/keeper-notes.png");
const decoy = first.assets.find((row) => row.path === "assets/map-of-farmhouse.png");
assert.equal(map.kind, "map");
assert.equal(briefing.kind, "briefing");
assert.equal(kpOnly.kind, "unclassified");
assert.equal(kpOnly.declared_player_visible, false);
assert.equal(decoy.kind, "unclassified");
assert.equal(map.source.pdf_index, 16);
assert.equal(map.source.page_ref, "pdf_index-16");
assert.deepEqual(map.source.region, { x: 12, y: 40, width: 400, height: 280 });
assert.equal(map.source.asset_ref, "producer:map-1");
assert.equal(map.source.original_hash, pngSha);

assert.throws(
  () => mod.recordSemanticAssociation(first, {
    asset_id: map.asset_id,
    target_kind: "scene",
    target_id: "farmhouse",
    reason: "title contains farmhouse",
    source: "keyword",
  }),
  /semantic result/,
);
assert.throws(
  () => mod.recordSemanticAssociation(first, {
    asset_id: map.asset_id,
    target_kind: "scene",
    target_id: "farmhouse",
    reason: "",
    source: "semantic_worker",
  }),
  /reason/,
);

const linked = mod.recordSemanticAssociation(first, {
  asset_id: map.asset_id,
  target_kind: "scene",
  target_id: "farmhouse",
  reason: "semantic worker: this plate is the authored farmhouse floorplan for the opening scene",
  source: "semantic_worker",
});
const again = mod.recordSemanticAssociation(linked.catalog, {
  asset_id: map.asset_id,
  target_kind: "scene",
  target_id: "farmhouse",
  reason: "semantic worker: this plate is the authored farmhouse floorplan for the opening scene",
  source: "semantic_worker",
});
assert.equal(linked.association.association_id, again.association.association_id);
assert.match(linked.association.association_id, /^assoc-[0-9a-f]{32}$/);
assert.equal(
  linked.association.association_id,
  mod.deriveAssociationId({
    asset_id: map.asset_id,
    target_kind: "scene",
    target_id: "farmhouse",
  }),
);

const withBriefing = mod.recordSemanticAssociation(linked.catalog, {
  asset_id: briefing.asset_id,
  target_kind: "clue",
  target_id: "letter-from-uncle",
  reason: "semantic router: this card is the uncle letter the investigators receive",
  source: "semantic_router",
});

const farmhouse = mod.querySourceAssets({
  catalog: withBriefing.catalog,
  target: { kind: "scene", id: "farmhouse" },
  audience: "keeper",
});
assert.equal(farmhouse.length, 1);
assert.equal(farmhouse[0].asset_id, map.asset_id);
const byTitle = mod.querySourceAssets({
  catalog: withBriefing.catalog,
  target: { kind: "scene", id: "map-of-farmhouse" },
  audience: "keeper",
});
assert.equal(byTitle.length, 0);

const handouts = [
  { asset_id: map.asset_id, player_visible: true, kind: "map", image_ref: map.image_ref },
  { asset_id: briefing.asset_id, player_visible: true, kind: "document" },
  { asset_id: "kp-card", player_visible: false, image_ref: kpOnly.image_ref },
];
assert.equal(mod.projectAssetVisibility({ entry: map, handout: handouts[0] }), "undiscovered");
assert.equal(mod.projectAssetVisibility({
  entry: map,
  handout: handouts[0],
  delivered_handout_ids: [map.asset_id],
}), "delivered");
assert.equal(mod.projectAssetVisibility({ entry: kpOnly, handout: handouts[2] }), "kp_only");
assert.equal(mod.projectAssetVisibility({ entry: kpOnly }), "kp_only");

const playerFace = mod.querySourceAssets({
  catalog: withBriefing.catalog,
  audience: "player",
  handouts,
  delivered_handout_ids: [briefing.asset_id],
});
assert.deepEqual(playerFace.map((row) => row.asset_id), [briefing.asset_id]);
assert.equal(playerFace[0].visibility, "delivered");

const keeperVisible = mod.querySourceAssets({
  catalog: withBriefing.catalog,
  audience: "keeper",
  visibility: "player_visible",
  handouts,
});
assert.ok(keeperVisible.every((row) => row.visibility === "undiscovered" || row.visibility === "delivered"));
assert.ok(!keeperVisible.some((row) => row.asset_id === kpOnly.asset_id));

assert.deepEqual(
  mod.planAssetDelivery({ entry: map, visibility: "undiscovered", handout: handouts[0] }),
  { path: "state.deliver_handout", handout_id: map.asset_id },
);
assert.deepEqual(
  mod.planAssetDelivery({ entry: kpOnly, visibility: "kp_only", handout: handouts[2] }),
  { path: "coc_map_supply.present", image_ref: kpOnly.image_ref },
);
assert.deepEqual(
  mod.planAssetDelivery({ entry: map, visibility: "delivered", handout: handouts[0] }),
  { path: "none", reason: "already_delivered" },
);
assert.deepEqual(
  mod.planAssetDelivery({ entry: decoy, visibility: "undiscovered", handout: null }),
  { path: "none", reason: "no_player_handout_card" },
);

const pack = mod.handoutPackFromCatalogEntry({
  entry: map,
  player_visible: true,
  associations: withBriefing.catalog.associations,
  title: "Farmhouse",
});
assert.equal(pack.asset_id, map.asset_id);
assert.equal(pack.kind, "map");
assert.deepEqual(pack.source_refs, ["pdf_index-16"]);
assert.deepEqual(pack.scene_refs, ["farmhouse"]);

const workspace = await mkdtemp(path.join(os.tmpdir(), "coc-source-assets-"));
const bundle = path.join(workspace, ".coc", "source-bundles", "cold-harvest");
await mkdir(path.join(bundle, "assets"), { recursive: true });
await writeFile(path.join(bundle, "assets", "map.png"), PNG);
await writeFile(path.join(bundle, "manifest.json"), `${JSON.stringify({
  schema_version: 1,
  bundle_sha256: bundleSha,
  assets: [mapAsset, briefingAsset, kpAsset, decoyNamedMap],
}, null, 2)}\n`);

const built = await mod.executeSourceAssetTool({
  cwd: workspace,
  params: {
    operation: "catalog",
    asset_root_id: "cold-harvest",
    source_bundle_path: bundle,
  },
});

async function writeFreshPdfCampaign(campaignId, assetRootId) {
  const scenarioDir = path.join(
    workspace, ".coc", "campaigns", campaignId, "scenario",
  );
  await mkdir(scenarioDir, { recursive: true });
  await writeFile(path.join(scenarioDir, "scenario.json"), `${JSON.stringify({
    schema_version: 1,
    source_cache_asset_root_id: assetRootId,
    source: {
      bundle_sha256: bundleSha,
      source_bundle_path: bundle,
    },
  }, null, 2)}\n`);
}

const freshCampaignId = "fresh-pdf-direct";
await writeFreshPdfCampaign(freshCampaignId, "fresh-pdf-direct-root");
const freshCatalog = await mod.executeSourceAssetTool({
  cwd: workspace,
  campaign_id: freshCampaignId,
  params: { operation: "catalog" },
});
assert.equal(freshCatalog.status, "cataloged");
assert.equal(freshCatalog.catalog.asset_root_id, "fresh-pdf-direct-root");
assert.equal(
  freshCatalog.catalog.source_bundle_path,
  path.relative(workspace, bundle),
);
assert.ok(freshCatalog.catalog.assets.length > 0);
const freshPlan = await mod.executeSourceAssetTool({
  cwd: workspace,
  campaign_id: freshCampaignId,
  params: {
    operation: "plan_delivery",
    asset_id: freshCatalog.asset_ids[0],
    handouts: [{
      asset_id: freshCatalog.asset_ids[0],
      player_visible: true,
      image_ref: freshCatalog.catalog.assets[0].image_ref,
    }],
  },
});
assert.deepEqual(freshPlan.delivery, {
  path: "state.deliver_handout",
  handout_id: freshCatalog.asset_ids[0],
});
assert.equal(built.status, "cataloged");
assert.equal(built.catalog.assets.length, 4);
assert.deepEqual(built.asset_ids, first.assets.map((row) => row.asset_id));

const associated = await mod.executeSourceAssetTool({
  cwd: workspace,
  params: {
    operation: "associate",
    asset_root_id: "cold-harvest",
    asset_id: map.asset_id,
    target_kind: "location",
    target_id: "farmhouse",
    reason: "semantic worker: plate depicts the farmhouse grounds",
    source: "semantic_worker",
  },
});
assert.equal(associated.status, "associated");
assert.match(associated.association.association_id, /^assoc-[0-9a-f]{32}$/);

const queried = await mod.executeSourceAssetTool({
  cwd: workspace,
  params: {
    operation: "query",
    asset_root_id: "cold-harvest",
    target_kind: "location",
    target_id: "farmhouse",
    audience: "keeper",
    handouts,
  },
});
assert.equal(queried.assets.length, 1);
assert.equal(queried.assets[0].asset_id, map.asset_id);

const planned = await mod.executeSourceAssetTool({
  cwd: workspace,
  params: {
    operation: "plan_delivery",
    asset_root_id: "cold-harvest",
    asset_id: map.asset_id,
    handouts,
    delivered_handout_ids: [],
  },
});
assert.deepEqual(planned.delivery, { path: "state.deliver_handout", handout_id: map.asset_id });

await assert.rejects(
  () => mod.executeSourceAssetTool({
    cwd: workspace,
    params: {
      operation: "associate",
      asset_root_id: "cold-harvest",
      asset_id: map.asset_id,
      target_kind: "location",
      target_id: "farmhouse",
      reason: "filename says farmhouse",
      source: "regex",
    },
  }),
  /semantic result/,
);

const domain = await import(pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts"),
).href);
const typed = await import(pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts"),
).href);
assert.ok(domain.activeToolsForPhase("live_turn", "play").includes("coc_source_assets"));
assert.ok(domain.activeToolsForPhase("opening", "setup").includes("coc_source_assets"));
assert.ok(typed.RESERVED_HOST_TOOL_NAMES.has("coc_source_assets"));
const indexSource = await readFile(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"),
  "utf8",
);
assert.match(indexSource, /name: SOURCE_ASSET_TOOL_NAME/);
assert.match(indexSource, /executeSourceAssetTool/);
assert.match(indexSource, /campaign_id: startupResumeGate\?\.campaignId/);

process.stdout.write(JSON.stringify({
  ok: true,
  asset_id: map.asset_id,
  association_id: associated.association.association_id,
  checks: [
    "catalog-id-deterministic",
    "producer-id-ignored",
    "filename-does-not-classify",
    "semantic-associate-and-query",
    "visibility-and-delivery",
    "tool-persist-roundtrip",
    "fresh-campaign-auto-binding-and-delivery",
    "host-tool-wired-static",
  ],
}));
