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

process.stdout.write(JSON.stringify({
  ok: true,
  footer: lines,
  clueCount: snap.clues.length,
  itemCount: snap.items.length,
}));
