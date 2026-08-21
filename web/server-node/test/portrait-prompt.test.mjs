import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PORTRAIT_ASPECT_RATIO,
  DEFAULT_PORTRAIT_FRAMING,
  PORTRAIT_SOURCE_PLAYER,
  PORTRAIT_SOURCE_SHEET_CONCEPT,
  buildPortraitPrompt,
  collectPortraitSeed,
  filterSafeBackground,
  isPlayerAppearanceLocked,
  portraitPromptMetadata,
} from "../portrait-prompt.mjs";

const require = createRequire(import.meta.url);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULE_SRC = fs.readFileSync(path.join(DIR, "..", "portrait-prompt.mjs"), "utf8");

const PLAYER_LOOK = "高瘦，rumpled 大衣领口别着铅笔。左眉一道旧疤。";

function adaSheet(extra = {}) {
  return {
    id: "ada",
    name: "Ada",
    age: 29,
    era: "1920s",
    occupation: "Journalist",
    nationality: "波士顿",
    living_standard: "Average",
    player_facing_sheet_zh: {
      display_name: "艾达",
      occupation: "记者",
      nationality: "波士顿",
      skills: [],
    },
    ...extra,
  };
}

test("player personal_description is a verbatim hard constraint", () => {
  const built = buildPortraitPrompt({
    character: adaSheet({
      backstory: { personal_description: PLAYER_LOOK },
      portrait: { source: "player", provenance: { appearance: PLAYER_LOOK } },
    }),
  });
  assert.equal(built.source, PORTRAIT_SOURCE_PLAYER);
  assert.equal(built.appearance_locked, true);
  assert.equal(built.provenance.appearance, PLAYER_LOOK);
  assert.ok(built.prompt.includes(`"""${PLAYER_LOOK}"""`));
  assert.match(built.prompt, /HARD APPEARANCE CONSTRAINT/);
  assert.match(built.prompt, /Do not rewrite, beautify/);
  assert.equal(built.prompt.includes("youthful glow"), false);
  assert.equal(built.prompt.includes("make her beautiful"), false);
});

test("source=player locks appearance even when a later description differs", () => {
  const built = buildPortraitPrompt({
    character: adaSheet({
      backstory: { personal_description: "a different look the player did not ask to replace" },
      portrait: {
        source: "player",
        provenance: { appearance: "original player look", appearance_field: "personal_description" },
      },
    }),
  });
  assert.equal(built.source, PORTRAIT_SOURCE_PLAYER);
  assert.equal(built.provenance.appearance, "original player look");
  assert.ok(built.prompt.includes("original player look"));
  assert.equal(built.prompt.includes("a different look the player did not ask to replace"), false);
});

test("personal_description without portrait.source still locks as player", () => {
  const built = buildPortraitPrompt(adaSheet({
    backstory: { personal_description: PLAYER_LOOK },
  }));
  assert.equal(built.source, PORTRAIT_SOURCE_PLAYER);
  assert.equal(isPlayerAppearanceLocked(adaSheet({
    backstory: { personal_description: PLAYER_LOOK },
  })), true);
  assert.ok(built.prompt.includes(PLAYER_LOOK));
});

test("missing appearance constructs from confirmed name/age/occupation/era/region/class/gear", () => {
  const built = buildPortraitPrompt(adaSheet({
    portrait: { source: "sheet_concept" },
    equipment: ["rumpled coat", "notebook"],
    backstory: { traits: "冷静" },
  }));
  assert.equal(built.source, PORTRAIT_SOURCE_SHEET_CONCEPT);
  assert.equal(built.appearance_locked, false);
  assert.equal(built.provenance.appearance, undefined);
  assert.match(built.prompt, /No player-specified appearance/);
  assert.match(built.prompt, /Name: Ada/);
  assert.match(built.prompt, /Age: 29/);
  assert.match(built.prompt, /Occupation: 记者/);
  assert.match(built.prompt, /Era: 1920s/);
  assert.match(built.prompt, /Region: 波士顿/);
  assert.match(built.prompt, /Social class \/ living standard: Average \(普通\)/);
  assert.match(built.prompt, /rumpled coat, notebook/);
  assert.match(built.prompt, /冷静/);
  assert.match(built.prompt, /Do not modernize, glamorize/);
});

test("does not send secrets, Mythos, or KP-only fields to the image prompt", () => {
  const built = buildPortraitPrompt(adaSheet({
    portrait: {
      source: "sheet_concept",
      provenance: {
        concept: "Ada",
        background: {
          traits: "冷静",
          encounters: "saw Nyarlathotep at the salon",
          scenario_bound: "investigating the Amaranthine murders",
          phobias_manias: "fear of the Yellow Sign",
        },
      },
    },
    backstory: {
      traits: "冷静",
      encounters: "saw Nyarlathotep at the salon",
      scenario_bound: "investigating the Amaranthine murders",
      ideology_beliefs: "the module villain is right",
    },
    skills: { "Cthulhu Mythos": 15 },
    cash: { amount: 50, currency: "USD" },
    keeper_notes: "NPC is the killer",
  }));
  assert.equal(built.prompt.includes("Nyarlathotep"), false);
  assert.equal(built.prompt.includes("Amaranthine"), false);
  assert.equal(built.prompt.includes("Yellow Sign"), false);
  assert.equal(built.prompt.includes("module villain"), false);
  assert.equal(built.prompt.includes("Cthulhu Mythos"), false);
  assert.equal(built.prompt.includes("killer"), false);
  assert.equal(JSON.stringify(built.provenance).includes("Nyarlathotep"), false);
  assert.equal(built.provenance.background.traits, "冷静");
  assert.equal(built.provenance.background.encounters, undefined);
});

test("filterSafeBackground drops module-truth keys", () => {
  assert.deepEqual(
    filterSafeBackground({
      personal_description: "thin",
      encounters: "mythos",
      scenario_bound: "hook",
      traits: "calm",
    }),
    { personal_description: "thin", traits: "calm" },
  );
});

test("default framing is a vertical bust with period style and no watermark", () => {
  const built = buildPortraitPrompt(adaSheet());
  assert.equal(built.aspect_ratio, DEFAULT_PORTRAIT_ASPECT_RATIO);
  assert.equal(built.aspect_ratio, "2:3");
  assert.equal(built.framing, DEFAULT_PORTRAIT_FRAMING);
  assert.match(built.prompt, /vertical half-body/);
  assert.match(built.prompt, /historically accurate period clothing/);
  assert.match(built.prompt, /Do not include any text, letters, captions, signatures, logos, or watermarks/i);
  assert.match(built.prompt, /No modern clothing/);
});

test("result records source and provenance for API metadata", () => {
  const built = buildPortraitPrompt(adaSheet({
    backstory: { personal_description: PLAYER_LOOK },
    equipment: ["pencil"],
  }));
  const meta = portraitPromptMetadata(built);
  assert.equal(meta.source, PORTRAIT_SOURCE_PLAYER);
  assert.equal(meta.appearance_locked, true);
  assert.equal(meta.provenance.concept, "Ada");
  assert.equal(meta.provenance.age, 29);
  assert.equal(meta.provenance.occupation, "记者");
  assert.equal(meta.provenance.era, "1920s");
  assert.equal(meta.provenance.region, "波士顿");
  assert.equal(meta.provenance.appearance, PLAYER_LOOK);
  assert.equal(meta.aspect_ratio, "2:3");
  assert.deepEqual(Object.keys(meta).sort(), [
    "appearance_locked",
    "aspect_ratio",
    "framing",
    "provenance",
    "source",
  ]);
});

test("collectPortraitSeed fills confirmed facts and does not invent appearance", () => {
  const seed = collectPortraitSeed(adaSheet({ backstory: { traits: "冷静" } }));
  assert.equal(seed.concept, "Ada");
  assert.equal(seed.age, 29);
  assert.equal(seed.occupation, "记者");
  assert.equal(seed.appearance, undefined);
  assert.equal(seed.background.traits, "冷静");
});

test("constructed prompt does not include cash or credit numbers", () => {
  const built = buildPortraitPrompt(adaSheet({
    cash: { amount: 90, currency: "USD" },
    assets: { amount: 2250, currency: "USD" },
    spending_level: { amount: 10, currency: "USD" },
    skills: { "Credit Rating": 50 },
  }));
  assert.equal(built.prompt.includes("90"), false);
  assert.equal(built.prompt.includes("2250"), false);
  assert.equal(built.prompt.includes("Credit Rating"), false);
  assert.match(built.prompt, /Average \(普通\)/);
});

test("module is a pure function: no fetch, no fs, no HTTP", () => {
  assert.equal(MODULE_SRC.includes("createServer"), false);
  assert.equal(MODULE_SRC.includes("node:http"), false);
  assert.equal(MODULE_SRC.includes("node:fs"), false);
  assert.equal(/fetch\(/.test(MODULE_SRC), false);
  assert.equal(MODULE_SRC.includes("writeFile"), false);
  const loaded = require.resolve("../portrait-prompt.mjs");
  assert.equal(path.basename(loaded), "portrait-prompt.mjs");
});
