/**
 * The rules lane: the half of §23 the rules data never had (2026-09-11).
 *
 * `playerGlossary` is the kernel's union of `localized_labels` in `content/rulesets/coc7/rules-json`.
 * It is hand-seeded and the kernel may not call a model, so a table played in a tag the seeds do
 * not cover reads every skill and characteristic in English -- next to a card, possessions and
 * clues that are all in the play language, because each of those already has a lane.
 *
 * `rulesTexts` is that lane's collector, and the thing worth pinning is how it limits itself: it
 * reads the same glossary it completes, so a seeded language collects nothing and never starts a
 * run. A collector that asked for words the glossary already answers would burn a model round per
 * campaign forever, which is the failure this file exists to keep from coming back.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

const { rulesTexts } = await import("../../extensions/module/character-presentation.ts");

/** A sheet of the shape `table.view` carries, with the groups the lane reads. */
const sheet = {
	name: "Chen Shouchu",
	characteristics: { STR: 50, INT: 80, POW: 65 },
	derived: { HP: 11, SAN: 65, MP: 13, MOV: 8 },
	skills: { "Spot Hidden": 45, "Library Use": 70, "Fighting (Brawl)": 25 },
};

test("a language the seeds do not cover collects the words the table actually shows", () => {
	// No glossary at all is what the kernel answers for an unseeded tag.
	const words = rulesTexts({ play_language: "ja", investigators: [sheet], labels: {} });
	assert.deepEqual(words, [
		"Fighting (Brawl)", "HP", "INT", "Library Use", "MOV", "MP", "POW", "SAN", "STR", "Spot Hidden",
	]);
});

test("a seeded language collects nothing, so the lane never runs for it", () => {
	// What `playerGlossary('zh-Hans')` answers for this sheet: every term it shows.
	const glossary = {
		STR: "力量", INT: "智力", POW: "意志", HP: "耐久", SAN: "理智", MP: "魔法", MOV: "移动",
		"Spot Hidden": "侦查", "Library Use": "图书馆使用", "Fighting (Brawl)": "格斗（斗殴）",
	};
	assert.deepEqual(rulesTexts({ play_language: "zh-Hans", investigators: [sheet], labels: glossary }), []);

	// One unseeded term is one question, not a fresh translation of the sheet.
	const partial = { ...glossary };
	delete partial["Library Use"];
	assert.deepEqual(rulesTexts({ play_language: "zh-Hans", investigators: [sheet], labels: partial }), ["Library Use"]);
});

test("figures are not words, and a sheetless view asks for nothing", () => {
	const numeric = { characteristics: { "50": 1, "1D6": 2, "3/6": 3 }, skills: { "Spot Hidden": 45 } };
	assert.deepEqual(rulesTexts({ investigators: [numeric], labels: {} }), ["Spot Hidden"]);
	for (const view of [{}, { investigators: [] }, { investigators: [null] }, { investigators: "no" }])
		assert.deepEqual(rulesTexts(view), []);
});

test("the guard is not decoration: drop the glossary check and the seeded table starts paying", () => {
	// Mutation: were the collector to ignore `view.labels`, this is the run it would start on every
	// campaign in a language that already has every one of these words.
	const glossary = { STR: "力量", INT: "智力", POW: "意志", HP: "耐久", SAN: "理智", MP: "魔法",
		MOV: "移动", "Spot Hidden": "侦查", "Library Use": "图书馆使用", "Fighting (Brawl)": "格斗（斗殴）" };
	const seeded = rulesTexts({ investigators: [sheet], labels: glossary });
	const unseeded = rulesTexts({ investigators: [sheet], labels: {} });
	assert.equal(seeded.length, 0, "a seeded table asks for nothing");
	assert.equal(unseeded.length, 10, "an unseeded one asks for exactly what it shows");
	assert.ok(unseeded.length > seeded.length, "the glossary is what separates the two");
});
