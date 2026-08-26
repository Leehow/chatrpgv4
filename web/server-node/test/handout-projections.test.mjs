import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  campaignBoundAssetRootIds,
  deliveredHandoutIds,
  deliveredHandoutPresentationsDisplay,
  deliveredHandoutsDisplay,
  handoutCardContractErrors,
  handoutAssetCandidates,
  handoutAssetImageUrl,
  loadHandoutCards,
  normalizeHandoutAssetRef,
  playerHandoutCard,
  resolveHandoutAssetFile,
} from "../projections.mjs";

/**
 * Fixtures mirror the plugin-side real producers field-for-field:
 *  - delivered ids: save/world-state.json (coc_toolbox._apply_handout_delivery)
 *  - card stores: index/handout-assets.json (coc_scenario skeleton +
 *    load_handout_assets), scenario/handouts.json as
 *    {"schema_version":1,"handouts":[...]} (coc_module_project
 *    merge_deep_handout_into_ir), and module-assets entity packs
 *    (coc_module_assets.put_entity + handout_card_from_pack projection).
 *  - module root binding: scenario/scenario.json progressive_asset_root_id
 *    (coc_module_project.campaign_asset_root_id).
 */

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coc-handout-test-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function writeBytes(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data));
}

function readHandouts(file) {
  const doc = JSON.parse(fs.readFileSync(file, "utf-8"));
  return Array.isArray(doc?.handouts) ? doc.handouts : [];
}

/** Campaign skeleton in the exact plugin shapes. */
function seedCampaign(ws, {
  delivered = [],
  presentationRevisions = {},
  assets = [],
  scenarioHandouts = null,
  playLanguage = "zh-Hans",
} = {}) {
  const campaignDir = path.join(ws, ".coc", "campaigns", "camp-1");
  writeJson(path.join(campaignDir, "campaign.json"), {
    schema_version: 3,
    campaign_id: "camp-1",
    ruleset_id: "coc7",
    status: "active",
    play_language: playLanguage,
    active_scenario_id: "scen-1",
    // Deliberately NOT a delivery source: the authoritative set lives in
    // save/world-state.json (regression guard for the review's A2-1).
    delivered_handout_ids: ["must-be-ignored"],
  });
  writeJson(path.join(campaignDir, "save", "world-state.json"), {
    // coc_state._initialize_campaign_runtime_files writes schema_version 2.
    schema_version: 2,
    campaign_id: "camp-1",
    status: "active",
    scenario_id: "scen-1",
    discovered_clue_ids: [],
    ...(delivered.length ? { delivered_handout_ids: [...delivered].sort() } : {}),
    ...(Object.keys(presentationRevisions).length
      ? { handout_presentation_revisions: presentationRevisions }
      : {}),
  });
  writeJson(path.join(campaignDir, "scenario", "scenario.json"), {
    schema_version: 1,
    scenario_id: "scen-1",
    title: "Fixture Module",
    progressive_asset_root_id: "root-1",
  });
  writeJson(path.join(campaignDir, "index", "handout-assets.json"), {
    schema_version: 1,
    scenario_id: "scen-1",
    asset_root: "assets/handouts",
    assets,
    display: {},
  });
  writeJson(
    path.join(campaignDir, "scenario", "handouts.json"),
    scenarioHandouts ?? { schema_version: 1, handouts: [] },
  );
  return campaignDir;
}

/** Entity pack in the coc_module_assets.put_entity shape. */
function handoutPack(overrides = {}) {
  return {
    schema_version: 3,
    handout_id: "handout-letter",
    asset_id: "handout-letter",
    kind: "document",
    title: "未署名的信",
    text: "The verbatim letter body from page 2.",
    localized_text: "第二页逐字信件正文。",
    when_to_deliver: "调查员检查书桌时",
    source_refs: ["pdf_index-2"],
    player_visible: true,
    parse_state: "deep",
    evidence_gap: false,
    origin: "source",
    provenance: { authority: "source_authored", basis: "test" },
    ingest_timing: { received_at: "2026-08-22T00:00:00Z" },
    updated_at: "2026-08-22T00:00:00Z",
    ...overrides,
  };
}

function putEntity(ws, rootId, pack) {
  writeJson(
    path.join(ws, ".coc", "module-assets", rootId, "entities", `handout-${pack.handout_id}.json`),
    pack,
  );
}

// ------------------------------------------------------------- delivery ids

test("deliveredHandoutIds reads save/world-state.json, never campaign.json", () => {
  const ws = makeWorkspace();
  seedCampaign(ws, { delivered: ["card-a", "card-b", "card-a", ""] });
  assert.deepEqual(deliveredHandoutIds(ws, "camp-1"), ["card-a", "card-b"]);
  // No delivery yet: the field may be absent until first delivery.
  seedCampaign(ws, { delivered: [] });
  assert.deepEqual(deliveredHandoutIds(ws, "camp-1"), []);
  assert.deepEqual(deliveredHandoutIds(ws, "missing"), []);
});

// ---------------------------------------------------------- bound roots

test("campaignBoundAssetRootIds mirrors the plugin resolver (progressive pointer only)", () => {
  const ws = makeWorkspace();
  seedCampaign(ws);
  assert.deepEqual(campaignBoundAssetRootIds(ws, "camp-1"), ["root-1"]);

  // module-meta progressive fallback (canonical_module_id, then scenario_id).
  const campaignDir = path.join(ws, ".coc", "campaigns", "camp-1");
  writeJson(path.join(campaignDir, "scenario", "scenario.json"), {
    schema_version: 1,
    scenario_id: "scen-1",
  });
  writeJson(path.join(campaignDir, "scenario", "module-meta.json"), {
    schema_version: 1,
    scenario_id: "scen-1",
    progressive: { tier: 1 },
    module_identity: { canonical_module_id: "meta-root" },
  });
  assert.deepEqual(campaignBoundAssetRootIds(ws, "camp-1"), ["meta-root"]);
  writeJson(path.join(campaignDir, "scenario", "module-meta.json"), {
    schema_version: 1,
    scenario_id: "scen-meta",
    progressive: { tier: 1 },
  });
  assert.deepEqual(campaignBoundAssetRootIds(ws, "camp-1"), ["scen-meta"]);

  // source_cache_asset_root_id is NOT a card root — the Keeper-side
  // campaign_asset_root_id resolver never reads it (review A2 drift): a
  // campaign bound only through the opening/review cache carries no
  // handout entities, and Web must resolve exactly the same roots as KP.
  writeJson(path.join(campaignDir, "scenario", "scenario.json"), {
    schema_version: 1,
    scenario_id: "scen-1",
    source_cache_asset_root_id: "root-cache",
  });
  writeJson(path.join(campaignDir, "scenario", "module-meta.json"), {
    schema_version: 1,
    scenario_id: "scen-1",
  });
  assert.deepEqual(campaignBoundAssetRootIds(ws, "camp-1"), []);
  // Traversal-shaped ids are reduced to a single safe segment.
  writeJson(path.join(campaignDir, "scenario", "scenario.json"), {
    progressive_asset_root_id: "../../other",
  });
  assert.deepEqual(campaignBoundAssetRootIds(ws, "camp-1"), []);
});

test("campaignBoundAssetRootIds adds a nonprogressive handout overlay", () => {
  const ws = makeWorkspace();
  const campaignDir = seedCampaign(ws);
  writeJson(path.join(campaignDir, "scenario", "scenario.json"), {
    schema_version: 1,
    scenario_id: "the-haunting",
  });
  writeJson(path.join(campaignDir, "scenario", "module-meta.json"), {
    schema_version: 1,
    scenario_id: "the-haunting",
    handout_asset_root_id: "the-haunting-keeper-rulebook-40th",
  });

  assert.deepEqual(campaignBoundAssetRootIds(ws, "camp-1"), [
    "the-haunting-keeper-rulebook-40th",
  ]);
});

// --------------------------------------------------------- card resolution

test("loadHandoutCards merges the three stores with entity > scenario > index priority", () => {
  const ws = makeWorkspace();
  seedCampaign(ws, {
    assets: [
      {
        asset_id: "shared-id",
        kind: "document",
        title: "Index copy",
        text: "stale index body",
      },
      { asset_id: "index-only", kind: "map", title: "Index map" },
    ],
    scenarioHandouts: {
      schema_version: 1,
      handouts: [
        {
          asset_id: "shared-id",
          kind: "document",
          title: "Scenario copy",
          text: "scenario store body",
          localized_text: "战役卡存正文",
          source_refs: ["pdf_index-3"],
        },
      ],
    },
  });
  putEntity(ws, "root-1", handoutPack({
    handout_id: "shared-id",
    asset_id: "shared-id",
    title: "Entity copy",
    text: "freshest deep truth",
  }));
  putEntity(ws, "root-1", handoutPack({
    handout_id: "entity-only",
    asset_id: "entity-only",
    kind: "read_aloud",
    title: "朗读框",
    text: "Source read-aloud body.",
    localized_title: { "zh-Hans": "朗读框" },
    localized_text: { "zh-Hans": "朗读框正文。" },
    source_refs: ["pdf_index-5"],
  }));

  const cards = loadHandoutCards(ws, "camp-1");
  assert.deepEqual([...cards.keys()].sort(), ["entity-only", "index-only", "shared-id"]);
  // Duplicate id: the deep entity projection wins over both older stores.
  assert.equal(cards.get("shared-id").title, "Entity copy");
  assert.equal(cards.get("shared-id").text, "freshest deep truth");
  // Entity projection drops machinery fields and defaults player_visible.
  const entityOnly = cards.get("entity-only");
  assert.equal("ingest_timing" in entityOnly, false);
  assert.equal("provenance" in entityOnly, false);
  assert.equal(entityOnly.player_visible, true);
  const projected = playerHandoutCard(ws, "camp-1", entityOnly);
  assert.equal(projected.kind, "read_aloud");
});

test("loadHandoutCards skips non-deep and evidence-gap entity packs", () => {
  const ws = makeWorkspace();
  seedCampaign(ws);
  putEntity(ws, "root-1", handoutPack({
    handout_id: "stub-card", asset_id: "stub-card",
    parse_state: "named_only", text: null, source_refs: null,
  }));
  putEntity(ws, "root-1", handoutPack({
    handout_id: "gap-card", asset_id: "gap-card", evidence_gap: true,
  }));
  const cards = loadHandoutCards(ws, "camp-1");
  assert.equal(cards.has("stub-card"), false);
  assert.equal(cards.has("gap-card"), false);
});

test("all card stores reject the same malformed visibility, body, and asset shapes", () => {
  const ws = makeWorkspace();
  const malformed = [
    {
      asset_id: "bad-visible",
      kind: "document",
      text: "must stay secret",
      source_refs: ["pdf_index-1"],
      player_visible: "false",
    },
    {
      asset_id: "bad-localized",
      kind: "document",
      localized_text: { "zh-Hans": ["must stay secret"] },
    },
    {
      asset_id: "bad-localized-language",
      kind: "document",
      localized_text: { "": "must stay secret" },
    },
    {
      asset_id: "bad-body",
      kind: "document",
      text: { body: "must stay secret" },
      source_refs: ["pdf_index-2"],
    },
    {
      asset_id: "bad-asset",
      kind: "map",
      image_ref: ["assets/handouts/secret.png"],
    },
    {
      asset_id: 17,
      kind: "document",
      text: "numeric id must stay secret",
      source_refs: ["pdf_index-3"],
    },
  ];
  const delivered = [
    "bad-visible", "bad-localized", "bad-localized-language", "bad-body", "bad-asset", "17",
    ...malformed.slice(0, 5).map((card) => `entity-${card.asset_id}`),
    "entity-bad-id",
  ];
  const campaignDir = seedCampaign(ws, {
    delivered,
    assets: malformed,
    scenarioHandouts: { schema_version: 1, handouts: malformed },
  });
  for (const card of malformed.slice(0, 5)) {
    const id = `entity-${card.asset_id}`;
    putEntity(ws, "root-1", handoutPack({
      ...card,
      handout_id: id,
      asset_id: id,
    }));
  }
  putEntity(ws, "root-1", handoutPack({
    handout_id: "entity-bad-id",
    asset_id: 17,
  }));
  writeBytes(
    path.join(campaignDir, "assets", "handouts", "secret.png"),
    "must stay secret",
  );

  const cards = loadHandoutCards(ws, "camp-1");
  for (const id of delivered) assert.equal(cards.has(id), false, id);
  const materialsAndSseSource = JSON.stringify(deliveredHandoutsDisplay(ws, "camp-1"));
  assert.equal(materialsAndSseSource, "[]");
  assert.ok(!materialsAndSseSource.includes("must stay secret"));
  assert.equal(
    resolveHandoutAssetFile(ws, "camp-1", "assets/handouts/secret.png"),
    null,
  );
});

test("present invalid content_origin never defaults or reaches Materials and SSE", () => {
  const ws = makeWorkspace();
  const invalidOrigins = [null, 7, "", {}, [], "unknown"];
  const scenarioCards = [];
  const indexCards = [];
  const delivered = [];

  invalidOrigins.forEach((content_origin, index) => {
    const scenarioId = `bad-origin-scenario-${index}`;
    const indexId = `bad-origin-index-${index}`;
    const entityId = `bad-origin-entity-${index}`;
    const base = {
      kind: "document",
      content_origin,
      title: "MUST NOT DISPLAY",
      text: "MUST NOT REACH MATERIALS OR SSE",
      source_refs: ["pdf_index-1"],
      player_visible: true,
    };
    scenarioCards.push({ asset_id: scenarioId, ...base });
    indexCards.push({ asset_id: indexId, ...base });
    putEntity(ws, "root-1", handoutPack({
      handout_id: entityId,
      asset_id: entityId,
      ...base,
    }));
    delivered.push(scenarioId, indexId, entityId);
    assert.ok(handoutCardContractErrors({ asset_id: scenarioId, ...base }).length);
    assert.equal(
      playerHandoutCard(ws, "camp-1", { asset_id: scenarioId, ...base }),
      null,
    );
  });

  seedCampaign(ws, {
    delivered,
    assets: indexCards,
    scenarioHandouts: { schema_version: 1, handouts: scenarioCards },
  });
  const cards = loadHandoutCards(ws, "camp-1");
  for (const id of delivered) assert.equal(cards.has(id), false, id);
  const materialsAndSseSource = JSON.stringify(
    deliveredHandoutsDisplay(ws, "camp-1"),
  );
  assert.equal(materialsAndSseSource, "[]");
  assert.ok(!materialsAndSseSource.includes("MUST NOT"));
});

test("card identities with surrounding whitespace are rejected in every Web store", () => {
  const ws = makeWorkspace();
  const card = {
    asset_id: " handout-space ",
    kind: "document",
    title: "MUST NOT DISPLAY",
    text: "MUST NOT REACH MATERIALS OR SSE",
    source_refs: ["pdf_index-1"],
  };
  seedCampaign(ws, {
    delivered: ["handout-space"],
    assets: [card],
    scenarioHandouts: { schema_version: 1, handouts: [card] },
  });
  putEntity(ws, "root-1", handoutPack({
    handout_id: " handout-space ",
    ...card,
  }));

  assert.ok(handoutCardContractErrors(card).some((error) =>
    error.includes("surrounding whitespace")
  ));
  assert.equal(loadHandoutCards(ws, "camp-1").has("handout-space"), false);
  assert.equal(playerHandoutCard(ws, "camp-1", card), null);
  assert.deepEqual(deliveredHandoutsDisplay(ws, "camp-1"), []);
});

// ----------------------------------------------------------- player projection

test("deliveredHandoutsDisplay projects delivered cards only, localized text first", () => {
  const ws = makeWorkspace();
  const campaignDir = seedCampaign(ws, { delivered: ["doc-1", "map-1", "secret-1"] });
  writeJson(path.join(campaignDir, "scenario", "handouts.json"), {
    schema_version: 1,
    handouts: [
      {
        asset_id: "doc-1",
        kind: "document",
        title: "Letter from Chicago",
        text: "verbatim english body",
        localized_text: "芝加哥来信的完整译文",
        source_refs: ["pdf_index-16"],
        player_visible: true,
        when_to_deliver: "after the archive scene",
        parse_state: "deep",
        origin: "source",
      },
      {
        asset_id: "map-1",
        kind: "map",
        title: "Farmhouse map",
        summary: "A farmhouse map",
        image_ref: "images/map-supply/page-0016.png",
        source_refs: ["pdf_index-16"],
      },
      {
        // Delivered but flagged player-invisible: fail closed, never shown.
        asset_id: "secret-1",
        kind: "document",
        title: "Invisible",
        text: "delivered but forbidden body",
        player_visible: false,
      },
      {
        asset_id: "undelivered",
        kind: "document",
        title: "Secret letter",
        text: "keeper-only body",
      },
    ],
  });

  // The URL projection only publishes serviceable files: materialize the
  // referenced map image before reading the display projection.
  writeBytes(
    path.join(ws, ".coc", "module-assets", "root-1", "images", "map-supply", "page-0016.png"),
    "map",
  );
  const cards = deliveredHandoutsDisplay(ws, "camp-1");
  assert.deepEqual(cards.map((c) => c.asset_id), ["doc-1", "map-1"]);
  const doc = cards[0];
  assert.equal(doc.text, "芝加哥来信的完整译文");
  assert.equal(doc.kind, "document");
  assert.deepEqual(doc.source_pages, ["pdf_index-16"]);
  assert.equal(doc.image_url, undefined);
  assert.equal("when_to_deliver" in doc, false);
  assert.equal("parse_state" in doc, false);
  const map = cards[1];
  assert.equal(
    map.image_url,
    "/api/campaigns/camp-1/handout-assets/images/map-supply/page-0016.png",
  );
  // Neither undelivered nor player-invisible bodies may leak.
  const projection = JSON.stringify(cards);
  assert.ok(!projection.includes("keeper-only body"));
  assert.ok(!projection.includes("Secret letter"));
  assert.ok(!projection.includes("delivered but forbidden body"));
  assert.ok(!projection.includes("Invisible"));
});

test("authored derivative uses localized player language and truthful labels without source pages", () => {
  const ws = makeWorkspace();
  seedCampaign(ws, {
    delivered: ["prop-1"],
    scenarioHandouts: {
      schema_version: 1,
      handouts: [{
        asset_id: "prop-1",
        kind: "document",
        content_origin: "authored_derivative",
        title: "Held city-desk copy",
        summary: "Contributor-authored in-world prop.",
        authored_text: "An original in-world clipping.",
        localized_language: "zh-Hans",
        localized_title: "城市新闻部暂缓稿",
        localized_summary: "由项目贡献者创作的剧情资料。",
        localized_text: "这是一份原创的战役内剪报。",
        player_visible: true,
      }],
    },
  });

  const [card] = deliveredHandoutsDisplay(ws, "camp-1");
  assert.equal(card.title, "城市新闻部暂缓稿");
  assert.equal(card.summary, "由项目贡献者创作的剧情资料。");
  assert.equal(card.text, "这是一份原创的战役内剪报。");
  assert.equal(card.content_origin, "authored_derivative");
  assert.equal(card.card_label, "剧情资料");
  assert.equal(card.kind_label, "文献");
  assert.deepEqual(card.source_pages, []);
  assert.equal(card.source_label, null);
});

test("authored derivative selects the active Japanese language map", () => {
  const ws = makeWorkspace();
  seedCampaign(ws, {
    delivered: ["prop-ja"],
    playLanguage: "ja-JP",
    scenarioHandouts: {
      schema_version: 1,
      handouts: [{
        asset_id: "prop-ja",
        kind: "document",
        content_origin: "authored_derivative",
        title: "Held city-desk copy",
        summary: "Contributor-authored in-world prop.",
        authored_text: "An original in-world clipping.",
        localized_title: {
          "zh-Hans": "城市新闻部暂缓稿",
          "ja-JP": "市政部掲載保留稿",
        },
        localized_summary: {
          "zh-Hans": "由项目贡献者创作的剧情资料。",
          "ja-JP": "プロジェクト貢献者が創作した劇中資料。",
        },
        localized_text: {
          "zh-Hans": "这是一份原创的战役内剪报。",
          "ja-JP": "これはシナリオ用に創作された新聞記事である。",
        },
        player_visible: true,
      }],
    },
  });

  const [card] = deliveredHandoutsDisplay(ws, "camp-1");
  assert.equal(card.title, "市政部掲載保留稿");
  assert.equal(card.summary, "プロジェクト貢献者が創作した劇中資料。");
  assert.equal(card.text, "これはシナリオ用に創作された新聞記事である。");
  assert.equal(card.card_label, "劇中資料");
  assert.equal(card.kind_label, "文書");
  assert.equal(card.source_label, null);
});

test("presentation projection keeps stable material identity and advances event identity", () => {
  const ws = makeWorkspace();
  const campaignDir = seedCampaign(ws, {
    delivered: ["doc-1"],
    presentationRevisions: { "doc-1": 2 },
  });
  writeJson(path.join(campaignDir, "scenario", "handouts.json"), {
    schema_version: 1,
    handouts: [{
      asset_id: "doc-1",
      kind: "read_aloud",
      title: "门后的声音",
      text: "The hinges groan.",
      localized_title: { "zh-Hans": "门后的声音" },
      localized_text: { "zh-Hans": "门轴发出低沉的呻吟。" },
      source_refs: ["pdf_index-9"],
      player_visible: true,
    }],
  });

  const materials = deliveredHandoutsDisplay(ws, "camp-1");
  const presentations = deliveredHandoutPresentationsDisplay(ws, "camp-1");
  assert.equal(materials.length, 1);
  assert.equal("presentation_id" in materials[0], false);
  assert.deepEqual(presentations, [{
    ...materials[0],
    presentation_id: "doc-1:presentation:2",
    presentation_revision: 2,
  }]);
});

test("read-aloud projection uses only the exact campaign play language", () => {
  const ws = makeWorkspace();
  const campaignDir = seedCampaign(ws, {
    delivered: ["read-ja", "read-missing-ja"],
    playLanguage: "ja-JP",
  });
  writeJson(path.join(campaignDir, "scenario", "handouts.json"), {
    schema_version: 1,
    handouts: [
      {
        asset_id: "read-ja",
        kind: "read_aloud",
        title: "At the door",
        text: "The hinges groan in the dark.",
        localized_title: { "ja-JP": "扉の前" },
        localized_text: { "ja-JP": "暗闇で蝶番が低くきしむ。" },
        source_refs: ["pdf_index-9"],
        player_visible: true,
      },
      {
        asset_id: "read-missing-ja",
        kind: "read_aloud",
        title: "Source title must not leak",
        text: "Source body must not leak",
        localized_title: { "zh-Hans": "门前" },
        localized_text: { "zh-Hans": "黑暗中门轴低鸣。" },
        source_refs: ["pdf_index-10"],
        player_visible: true,
      },
    ],
  });

  assert.deepEqual(deliveredHandoutsDisplay(ws, "camp-1"), [{
    asset_id: "read-ja",
    kind: "read_aloud",
    content_origin: "source_verbatim",
    title: "扉の前",
    text: "暗闇で蝶番が低くきしむ。",
    source_pages: ["pdf_index-9"],
    kind_label: "読み上げ",
    card_label: "原文資料",
    source_label: "出典ページ",
  }]);
});

// --------------------------------------------------------- ref normalization

test("normalizeHandoutAssetRef rejects traversal and absolute paths", () => {
  assert.equal(normalizeHandoutAssetRef("../etc/passwd"), null);
  assert.equal(normalizeHandoutAssetRef("assets/../../secret.png"), null);
  assert.equal(normalizeHandoutAssetRef("/abs/path.png"), null);
  assert.equal(normalizeHandoutAssetRef("C:/win.png"), null);
  assert.equal(normalizeHandoutAssetRef("a//b.png"), null);
  assert.equal(normalizeHandoutAssetRef(""), null);
  assert.equal(normalizeHandoutAssetRef("assets/handouts/page.png"), "assets/handouts/page.png");
  assert.equal(normalizeHandoutAssetRef("./assets/handouts/page.png"), "assets/handouts/page.png");
});

test("handoutAssetImageUrl publishes only serviceable delivered-image URLs", () => {
  const ws = makeWorkspace();
  const campaignDir = seedCampaign(ws, {
    delivered: ["url-doc", "url-map"],
    scenarioHandouts: {
      schema_version: 1,
      handouts: [
        {
          asset_id: "url-doc",
          kind: "document",
          title: "Doc",
          image_ref: "assets/handouts/旧 剪报.png",
          source_refs: ["pdf_index-1"],
        },
        {
          asset_id: "url-map",
          kind: "map",
          title: "Map",
          image_ref: "images/map-supply/page.png",
          source_refs: ["pdf_index-2"],
        },
      ],
    },
  });
  writeBytes(path.join(campaignDir, "assets", "handouts", "旧 剪报.png"), "x");
  writeBytes(
    path.join(ws, ".coc", "module-assets", "root-1", "images", "map-supply", "page.png"),
    "y",
  );
  assert.equal(
    handoutAssetImageUrl(ws, "camp-1", "assets/handouts/旧 剪报.png"),
    "/api/campaigns/camp-1/handout-assets/assets/handouts/%E6%97%A7%20%E5%89%AA%E6%8A%A5.png",
  );
  assert.equal(
    handoutAssetImageUrl(ws, "camp-1", "images/map-supply/page.png"),
    "/api/campaigns/camp-1/handout-assets/images/map-supply/page.png",
  );
  // Non-image extensions, unauthorized locations, and missing files publish
  // no URL at all (the route would 404 them).
  assert.equal(handoutAssetImageUrl(ws, "camp-1", "assets/handouts/page.txt"), null);
  assert.equal(handoutAssetImageUrl(ws, "camp-1", "private/secret.png"), null);
  assert.equal(
    handoutAssetImageUrl(ws, "camp-1", ".coc/campaigns/camp-1/private/x.png"),
    null,
  );
  assert.equal(
    handoutAssetImageUrl(ws, "camp-1", "assets/handouts/missing.png"),
    null,
  );
});

// ----------------------------------------------------- authorization roots

test("handoutAssetCandidates confines refs to the bound module root and campaign subtree", () => {
  const ws = makeWorkspace();
  seedCampaign(ws); // bound root-1
  const campaignDir = path.join(ws, ".coc", "campaigns", "camp-1");
  const boundRoot = path.join(ws, ".coc", "module-assets", "root-1");

  // Module-root-relative ref.
  assert.deepEqual(handoutAssetCandidates(ws, "camp-1", "images/map-supply/x.png"), [
    path.resolve(boundRoot, "images/map-supply/x.png"),
  ]);
  // Workspace-rooted ref inside the bound module root.
  assert.deepEqual(
    handoutAssetCandidates(ws, "camp-1", ".coc/module-assets/root-1/images/y.png"),
    [path.resolve(ws, ".coc/module-assets/root-1/images/y.png")],
  );
  // Workspace-rooted ref inside another module root: no candidate.
  assert.deepEqual(
    handoutAssetCandidates(ws, "camp-1", ".coc/module-assets/root-other/images/y.png"),
    [],
  );
  // Another campaign: no candidate.
  assert.deepEqual(
    handoutAssetCandidates(ws, "camp-1", ".coc/campaigns/other-camp/assets/handouts/y.png"),
    [],
  );
  // Arbitrary .coc paths: no candidate.
  assert.deepEqual(handoutAssetCandidates(ws, "camp-1", ".coc/runtime.json"), []);
  // Campaign subtree under the declared asset_root.
  assert.deepEqual(handoutAssetCandidates(ws, "camp-1", "assets/handouts/z.png"), [
    path.resolve(boundRoot, "assets/handouts/z.png"),
    path.resolve(campaignDir, "assets/handouts/z.png"),
  ]);
  // Campaign paths outside the asset subtree stay out of the campaign dir,
  // but a bare ref may still address the bound module root — the route's
  // image-extension + delivered-card + existence gates reject the rest.
  assert.deepEqual(handoutAssetCandidates(ws, "camp-1", "save/world-state.json"), [
    path.resolve(boundRoot, "save/world-state.json"),
  ]);
  assert.equal(resolveHandoutAssetFile(ws, "camp-1", "save/world-state.json"), null);
});

// --------------------------------------------------- static file resolution

test("index cards failing the card contract are skipped (fail-closed)", () => {
  const ws = makeWorkspace();
  seedCampaign(ws, {
    delivered: ["bad-visible", "bad-kind", "bad-text"],
    assets: [
      {
        // player_visible must be boolean — the plugin skips this card, Web
        // must never display its body even though the id is delivered.
        asset_id: "bad-visible",
        kind: "document",
        title: "String-flagged invisible",
        text: "string false body",
        player_visible: "false",
      },
      {
        asset_id: "bad-kind",
        kind: "hologram",
        title: "Bad kind",
        text: "bad kind body",
        source_refs: ["pdf_index-1"],
      },
      {
        // text without source_refs is meaningless — plugin rejects it.
        asset_id: "bad-text",
        kind: "document",
        title: "Untraced text",
        text: "untraced body",
      },
    ],
  });
  const cards = loadHandoutCards(ws, "camp-1");
  assert.equal(cards.has("bad-visible"), false);
  assert.equal(cards.has("bad-kind"), false);
  assert.equal(cards.has("bad-text"), false);
  const display = JSON.stringify(deliveredHandoutsDisplay(ws, "camp-1"));
  assert.equal(display, "[]");
  assert.ok(!display.includes("string false body"));
  assert.ok(!display.includes("bad kind body"));
});

test("entity projection keeps opening_card/parse_state/origin and tagged source_refs", () => {
  const ws = makeWorkspace();
  seedCampaign(ws, { delivered: ["handout-letter"] });
  putEntity(ws, "root-1", handoutPack({
    opening_card: true,
    source_refs: ["pdf_index-2", "pdf_index-3"],
  }));
  const cards = loadHandoutCards(ws, "camp-1");
  const card = cards.get("handout-letter");
  assert.equal(card.opening_card, true);
  assert.equal(card.parse_state, "deep");
  assert.equal(card.origin, "source");
  assert.deepEqual(card.source_refs, ["pdf_index-2", "pdf_index-3"]);
  const projected = playerHandoutCard(ws, "camp-1", card);
  assert.deepEqual(projected.source_pages, ["pdf_index-2", "pdf_index-3"]);
  // Machinery fields stay out of the card record.
  assert.equal("ingest_timing" in card, false);
  assert.equal("provenance" in card, false);
});

test("resolveHandoutAssetFile serves delivered images and 404s everything else", () => {
  const ws = makeWorkspace();
  const campaignDir = seedCampaign(ws, {
    delivered: ["map-1", "doc-1"],
    scenarioHandouts: {
      schema_version: 1,
      handouts: [
        {
          asset_id: "map-1",
          kind: "map",
          title: "Map",
          image_ref: "images/map-supply/page-0016.png",
          source_refs: ["pdf_index-16"],
        },
        {
          asset_id: "doc-1",
          kind: "document",
          title: "Doc",
          image_ref: "assets/handouts/clipping.png",
          source_refs: ["pdf_index-12"],
        },
        {
          asset_id: "undelivered-map",
          kind: "map",
          title: "Hidden",
          image_ref: "assets/handouts/hidden-map.png",
        },
        {
          asset_id: "invisible-map",
          kind: "map",
          title: "Forbidden",
          image_ref: "images/map-supply/forbidden.png",
          player_visible: false,
        },
      ],
    },
  });
  // Bound module root image (map-supply layout).
  writeBytes(
    path.join(ws, ".coc", "module-assets", "root-1", "images", "map-supply", "page-0016.png"),
    "map",
  );
  writeBytes(
    path.join(ws, ".coc", "module-assets", "root-1", "images", "map-supply", "forbidden.png"),
    "forbidden",
  );
  // Campaign handout asset subtree.
  writeBytes(path.join(campaignDir, "assets", "handouts", "clipping.png"), "clip");
  writeBytes(path.join(campaignDir, "assets", "handouts", "hidden-map.png"), "secret");
  writeBytes(path.join(campaignDir, "assets", "handouts", "orphan.png"), "x");
  // Another campaign's and another module root's images.
  writeBytes(path.join(ws, ".coc", "campaigns", "other", "assets", "leak.png"), "leak");
  writeBytes(path.join(ws, ".coc", "module-assets", "root-other", "leak.png"), "leak");

  const served = resolveHandoutAssetFile(ws, "camp-1", "images/map-supply/page-0016.png");
  assert.equal(served?.mime, "image/png");
  assert.equal(fs.readFileSync(served.file).toString(), "map");
  const clipping = resolveHandoutAssetFile(ws, "camp-1", "assets/handouts/clipping.png");
  assert.equal(clipping?.mime, "image/png");
  assert.equal(fs.readFileSync(clipping.file).toString(), "clip");

  // Undelivered card's image — file exists, must 404.
  assert.equal(resolveHandoutAssetFile(ws, "camp-1", "assets/handouts/hidden-map.png"), null);
  // Delivered but player-invisible card's image — must 404.
  assert.equal(resolveHandoutAssetFile(ws, "camp-1", "images/map-supply/forbidden.png"), null);
  // Unreferenced file — must 404.
  assert.equal(resolveHandoutAssetFile(ws, "camp-1", "assets/handouts/orphan.png"), null);
  // Cross-campaign and cross-module-root refs — no authorization, must 404.
  assert.equal(
    resolveHandoutAssetFile(ws, "camp-1", ".coc/campaigns/other/assets/leak.png"),
    null,
  );
  assert.equal(
    resolveHandoutAssetFile(ws, "camp-1", ".coc/module-assets/root-other/leak.png"),
    null,
  );
  // Campaign state files are never handout assets.
  assert.equal(resolveHandoutAssetFile(ws, "camp-1", "save/world-state.json"), null);
  // A PNG inside the campaign but OUTSIDE assets/handouts — even when a
  // delivered card's image_ref points at it — must 404: the campaign-side
  // authorization root is the declared handout asset subtree only (the
  // review's campaign-directory bypass).
  writeBytes(path.join(campaignDir, "private", "secret.png"), "secret");
  writeJson(path.join(campaignDir, "scenario", "handouts.json"), {
    schema_version: 1,
    handouts: [
      ...readHandouts(path.join(campaignDir, "scenario", "handouts.json")),
      {
        asset_id: "escape-card",
        kind: "document",
        title: "Escape",
        image_ref: "private/secret.png",
        source_refs: ["pdf_index-1"],
      },
    ],
  });
  const withEscape = resolveHandoutAssetFile(ws, "camp-1", "private/secret.png");
  assert.equal(withEscape, null);
  // The campaign-side candidate is gone; the bare ref only addresses the
  // bound module root, where the file does not exist (and creating one
  // requires module-assets write access, outside untrusted import content).
  assert.deepEqual(
    handoutAssetCandidates(ws, "camp-1", "private/secret.png"),
    [path.resolve(ws, ".coc", "module-assets", "root-1", "private", "secret.png")],
  );
  // The delivered displays never emit an image_url for that card either.
  const escapeDisplay = deliveredHandoutsDisplay(ws, "camp-1")
    .find((c) => c.asset_id === "escape-card");
  assert.equal(escapeDisplay?.image_url, undefined);
  // Traversal and non-image suffixes.
  assert.equal(
    resolveHandoutAssetFile(ws, "camp-1", "assets/../../../campaigns/camp-1/campaign.json"),
    null,
  );
  assert.equal(resolveHandoutAssetFile(ws, "camp-1", "assets/handouts/clipping.txt"), null);
  // Unknown campaign.
  assert.equal(resolveHandoutAssetFile(ws, "no-such", "images/map-supply/page-0016.png"), null);
});

test("entity-store cards authorize their delivered images too (mid-queue deep packs)", () => {
  const ws = makeWorkspace();
  seedCampaign(ws, { delivered: ["handout-letter"] });
  putEntity(ws, "root-1", handoutPack());
  writeBytes(
    path.join(ws, ".coc", "module-assets", "root-1", "images", "letter.png"),
    "letter",
  );

  // The card exists only in the entity store (queue merge pending).
  const display = deliveredHandoutsDisplay(ws, "camp-1");
  assert.deepEqual(display.map((c) => c.asset_id), ["handout-letter"]);
  assert.equal(display[0].text, "第二页逐字信件正文。");

  // Image referenced by that entity card resolves for delivery.
  putEntity(ws, "root-1", handoutPack({ image_ref: "images/letter.png" }));
  const served = resolveHandoutAssetFile(ws, "camp-1", "images/letter.png");
  assert.equal(served?.mime, "image/png");
  assert.equal(fs.readFileSync(served.file).toString(), "letter");
});
