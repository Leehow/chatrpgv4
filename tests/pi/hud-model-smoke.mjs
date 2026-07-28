/**
 * Smoke: player-safe HUD model hides secrets and formats footer lines.
 */
import {
  buildHudSnapshot,
  formatHudDetail,
  formatHudFooterLines,
} from "../../plugins/coc-keeper/pi/lib/hud-model.ts";

const scene = {
  active_scene_id: "previous-tenants",
  turn_number: 13,
  time: { display: "1920-10-13 15:42" },
  scene: { location_tags: ["sanitarium", "ward"] },
  party_investigators: [{
    investigator_id: "thomas-hayes",
    name: "托马斯·海斯",
    occupation: "私家侦探",
    hp: { current: 12, max: 12 },
    san: { current: 55, max: 60 },
    mp: { current: 11, max: 11 },
    luck: 50,
    conditions: [],
  }],
  clues_here: [
    {
      clue_id: "secret-a",
      discovered: false,
      secret: true,
      player_safe_summary: null,
      keeper_only: { secret: true },
    },
  ],
  discovered_clue_count: 2,
  discovered_clues_public: [
    {
      clue_id: "found-a",
      discovered: true,
      player_safe_summary: "House built in 1835",
      localized_text: { "zh-Hans": "宅邸建于 1835 年" },
    },
    {
      clue_id: "found-b",
      discovered: true,
      player_safe_summary: "Corbitt bought the house",
    },
  ],
};

const inventory = {
  items: [{ item_id: "keys", kind: "gear", label: "科比特宅钥匙" }],
  weapons: [{ weapon_id: "unarmed", label: "徒手" }],
};

const snap = buildHudSnapshot({
  campaignId: "haunting-persist-kp-20260719",
  scene,
  inventory,
});

if (snap.investigators[0]?.name !== "托马斯·海斯") throw new Error("name missing");
if (snap.investigators[0]?.hp !== "12/12") throw new Error(`hp ${snap.investigators[0]?.hp}`);
if (snap.timeDisplay !== "1920-10-13 15:42") throw new Error("time missing");
if (snap.placeDisplay !== "sanitarium") throw new Error(`place ${snap.placeDisplay}`);
if (snap.items.length !== 2) throw new Error(`items ${snap.items.length}`);
if (snap.clues.length !== 2) throw new Error(`clues ${snap.clues.length}`);
if (snap.clues.some((c) => c.id === "secret-a")) throw new Error("secret clue leaked");
if (!snap.clues.some((c) => c.summary.includes("1835") || c.summary.includes("宅邸"))) {
  throw new Error(`clue summary bad: ${JSON.stringify(snap.clues)}`);
}

const lines = formatHudFooterLines(snap, 80);
if (lines.length !== 2) throw new Error(`footer lines ${lines.length}`);
if (lines.some((line) => /token|grok|R\d+k|CH\d/i.test(line))) {
  throw new Error("coding chrome leaked into game footer");
}
if (!lines[0].includes("托马斯") || !lines[0].includes("HP")) {
  throw new Error(`footer1 ${lines[0]}`);
}
if (!lines[1].includes("物品 2") || !lines[1].includes("线索 2")) {
  throw new Error(`footer2 ${lines[1]}`);
}

const clueDetail = formatHudDetail("clues", snap).join("\n");
if (clueDetail.includes("secret") || clueDetail.includes("keeper")) {
  throw new Error("detail leaked secret labels");
}

const secretOnly = buildHudSnapshot({
  campaignId: "x",
  scene: {
    clues_here: [{ clue_id: "s", discovered: false, secret: true, player_safe_summary: "NO" }],
  },
});
if (secretOnly.clues.length !== 0) throw new Error("undiscovered clue projected");

const prelink = buildHudSnapshot({
  campaignId: "opening-before-link",
  scene: {
    active_scene_id: "MUST_NOT_SHOW_OPENING_PLACE",
    turn_number: 0,
    time: { display: "MUST_NOT_SHOW_OPENING_TIME" },
    scene: { location_tags: ["MUST_NOT_SHOW_OPENING_TAG"] },
    party_investigators: [],
    discovered_clue_count: 1,
    discovered_clues_public: [{
      clue_id: "MUST_NOT_SHOW_OPENING_CLUE",
      discovered: true,
      player_safe_summary: "MUST_NOT_SHOW_OPENING_TEXT",
    }],
  },
  inventory: {
    items: [{ item_id: "MUST_NOT_SHOW_OPENING_ITEM", label: "OPENING ITEM" }],
  },
});
const prelinkSerialized = JSON.stringify({
  snapshot: prelink,
  footer: formatHudFooterLines(prelink, 120),
  time: formatHudDetail("time", prelink),
  inventory: formatHudDetail("inv", prelink),
  clues: formatHudDetail("clues", prelink),
});
if (
  prelink.timeDisplay !== null
  || prelink.placeDisplay !== null
  || prelink.turn !== null
  || prelink.items.length !== 0
  || prelink.clues.length !== 0
  || prelink.clueCount !== 0
  || /MUST_NOT_SHOW|OPENING ITEM/.test(prelinkSerialized)
) throw new Error(`pre-link HUD leaked opening projection: ${prelinkSerialized}`);
if (!prelinkSerialized.includes("尚未开桌")) {
  throw new Error(`pre-link HUD omitted onboarding boundary: ${prelinkSerialized}`);
}
const retainedRouteError = buildHudSnapshot({
  campaignId: "opening-route-blocked",
  error: (
    "MUST_NOT_SHOW_RETAINED_ROUTE "
    + '{"phase":"opening_character_setup_required"}'
  ),
});
const retainedRouteUi = JSON.stringify({
  footer: formatHudFooterLines(retainedRouteError, 120),
  sheet: formatHudDetail("sheet", retainedRouteError),
  time: formatHudDetail("time", retainedRouteError),
  inventory: formatHudDetail("inv", retainedRouteError),
  clues: formatHudDetail("clues", retainedRouteError),
});
if (
  retainedRouteUi.includes("MUST_NOT_SHOW_RETAINED_ROUTE")
  || retainedRouteUi.includes("opening_character_setup_required")
  || !retainedRouteUi.includes("尚未开桌")
) {
  throw new Error(`setup HUD leaked retained route error: ${retainedRouteUi}`);
}

process.stdout.write(JSON.stringify({
  ok: true,
  footer: lines,
  clueCount: snap.clues.length,
  itemCount: snap.items.length,
  prelinkOpeningHidden: true,
}));
