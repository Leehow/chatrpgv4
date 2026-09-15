/**
 * The engine's own words reach the player through the chrome, not raw (contract §16.1 + §23).
 *
 * Three producers write player-visible English into a receipt: the die the engine rolled for
 * itself (`Bout of Madness`, `HP Damage`), the outcome a session settled on, and the resource a
 * mod moved. The system language is English, so those literals are correct where they are written
 * -- what was missing is a play-language word to draw instead of them.
 *
 * The rules glossary cannot supply one. `playerGlossary` is the union of `localized_labels` in
 * `content/rulesets/coc7/rules-json`, which is a hand-seeded set: today it carries 180 rows for
 * `zh-Hans` and 57 for `en` and nothing for any other tag, and no lane tops it up. A word the
 * engine invents has no row there at all, so `term()` returns the English identifier and the card
 * shows it. That is what this guard is for: the engine may add a name, but it may not ship one
 * the chrome has no key for, because the chrome is the half that a lane projects per tag.
 *
 * The check reads the kernel's own sources rather than a list written here, so a name added
 * tomorrow is caught by the same assertion that caught today's.
 */

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sources(dir) {
	const path = join(REPO, dir);
	const stats = statSync(path);
	if (!stats.isDirectory()) return [path];
	return readdirSync(path, { withFileTypes: true }).flatMap(entry =>
		entry.name === "testing" || entry.name === "node_modules" ? []
			: sources(join(dir, entry.name)));
}

const KERNEL = sources("kernel-ts").filter(path => path.endsWith(".ts"));
const chrome = JSON.parse(readFileSync(join(REPO, "content/ui/en/mechanics.json"), "utf8"));

/** The keys `playerGlossary` claims from the rules data: a row's own key, its name, its abbreviation. */
function rulesGlossary() {
	const dir = join(REPO, "content/rulesets/coc7/rules-json");
	const keys = new Set();
	const visit = value => {
		if (Array.isArray(value)) { for (const item of value) visit(item); return; }
		if (!value || typeof value !== "object") return;
		if (value.localized_labels && typeof value.localized_labels === "object")
			for (const claim of [value.name, value.abbreviation])
				if (typeof claim === "string" && claim.trim()) keys.add(claim.trim());
		for (const [child, inner] of Object.entries(value)) {
			if (child === "localized_labels") continue;
			if (inner && typeof inner === "object" && inner.localized_labels) keys.add(child);
			visit(inner);
		}
	};
	for (const name of readdirSync(dir).filter(file => file.endsWith(".json")).sort())
		visit(JSON.parse(readFileSync(join(dir, name), "utf8")));
	return keys;
}

/** Every `<field>: '<literal>'` the kernel writes, with where it wrote it. */
function literals(field) {
	const pattern = new RegExp(`\\b${field}\\s*:\\s*'([^'\\n]{1,48})'`, "g");
	const found = new Map();
	for (const path of KERNEL) {
		const text = readFileSync(path, "utf8");
		for (const [, value] of text.matchAll(pattern))
			if (value.trim() && !found.has(value)) found.set(value, path.slice(REPO.length + 1));
	}
	return found;
}

test("every die the engine names itself carries a stable id the chrome has a word for", () => {
	// `kind` on a roll record is the engine's stable id; `recordDice` carries it onto the receipt as
	// `word` and the card looks up `die.<word>`. A record with a die expression and no `kind` would
	// reach the player as the English `skill`, so both halves are asserted.
	const missing = [];
	for (const path of KERNEL) {
		const text = readFileSync(path, "utf8");
		for (const match of text.matchAll(/pendingRolls\.push\(\{([\s\S]{0,900}?)\}\);/g)) {
			const record = match[1];
			const dice = /die_expression\s*:/.test(record) || /roll_role\s*:\s*'amount'/.test(record);
			if (!dice) continue;
			const id = record.match(/\bkind\s*:\s*'([^'\n]+)'/) ?? record.match(/\bkind\s*:\s*`([^`\n$]*)\$\{(\w+)\}([^`\n]*)`/);
			const where = `${path.slice(REPO.length + 1)}: ${(record.match(/skill\s*:\s*'([^'\n]+)'/) ?? [, "?"])[1]}`;
			if (!id) { missing.push(`${where} -- the record has no \`kind\`, so the card can only draw its English skill`); continue; }
			// A templated id (`${trait}_table`) is a family of keys; assert the ones the data can fill.
			const keys = id[2] ? ["phobia", "mania"].map(value => `die.${id[1]}${value}${id[3]}`) : [`die.${id[1]}`];
			for (const key of keys)
				if (typeof chrome[key] !== "string" || !chrome[key].trim())
					missing.push(`${where} -- content/ui/en/mechanics.json has no ${key}`);
		}
	}
	assert.deepEqual(missing, [], `the engine names a die the player cannot read:\n${missing.join("\n")}`);
});

test("every outcome a session can settle on, and every resource a mod moves, has an authored word", () => {
	// The closed sets the kernel declares. Read from the declarations rather than restated here, so
	// widening one of them without a caption fails this test.
	const declared = (file, name) => {
		const text = readFileSync(join(REPO, file), "utf8");
		const line = text.match(new RegExp(`${name}\\s*=\\s*(?:new Set<[^>]*>\\()?\\[([^\\]]*)\\]`));
		assert.ok(line, `${name} is declared in ${file}`);
		return [...line[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
	};
	const outcomes = [
		...declared("kernel-ts/combat/engine.ts", "VALID_OUTCOMES"),
		...declared("kernel-ts/chase/model.ts", "CHASE_OUTCOMES"),
	];
	assert.ok(outcomes.length >= 6, `the outcome sets were found (${outcomes.length})`);
	const missing = outcomes.filter(value => typeof chrome[`outcome.${value}`] !== "string")
		.map(value => `outcome.${value}`);
	// A resource the rules already name reaches the card through the glossary: the renderer
	// uppercases the identifier (`hp` -> `HP`) and `term()` finds the seeded row. Only a resource
	// neither half can answer is a gap, so this mirrors that whole chain rather than the chrome alone.
	const glossary = rulesGlossary();
	const resources = [...literals("resource")].filter(([value]) => /^[a-z][a-z_]*$/.test(value));
	for (const [value, where] of resources)
		if (typeof chrome[`resource.${value}`] !== "string" && !glossary.has(value.toUpperCase()) && !glossary.has(value))
			missing.push(`resource.${value} (${where})`);
	assert.deepEqual(missing, [], `content/ui/en/mechanics.json is missing:\n${missing.join("\n")}`);
});

test("every difficulty the rules tabulate has a word, and the chip that carries it keeps both figures", () => {
	// A non-regular difficulty moves the bar the die is compared against, and until 2026-09-15 the
	// card drew neither the difficulty nor the threshold: a hard check against a 15 was settled at
	// 7, and `10 /15` under a failure stamp read as the product getting CoC's arithmetic backwards.
	// The bar is now drawn, so the same rule as the dice above applies to its gloss -- the levels
	// are rules data (`divisor` rows in difficulty-levels.json), and a level the chrome has no
	// caption for would reach a player as the engine's English key.
	const levels = JSON.parse(readFileSync(join(REPO, "content/rulesets/coc7/rules-json/difficulty-levels.json"), "utf8"));
	const graded = Object.entries(levels).filter(([, block]) => block && typeof block === "object" && Object.hasOwn(block, "divisor"));
	assert.ok(graded.length >= 3, `the difficulty table was found (${graded.length} graded levels)`);
	const missing = graded.map(([name]) => `difficulty.${name}`)
		.filter(key => typeof chrome[key] !== "string" || !chrome[key].trim());
	assert.deepEqual(missing, [], `content/ui/en/mechanics.json is missing:\n${missing.join("\n")}`);
	// The chip is one caption with two holes in it. A template that lost either one would still be
	// a string the renderer prints, and the figure the whole fix exists for would vanish silently.
	const needs = chrome.needs;
	assert.equal(typeof needs, "string", "content/ui/en/mechanics.json has a `needs` caption");
	for (const slot of ["{level}", "{n}"])
		assert.ok(needs.includes(slot), `the \`needs\` caption still carries ${slot}`);
});

test("the guard is not decoration: it still catches a word with no caption", () => {
	// Mutation: the assertions above are only worth their runtime if removing a caption fails them.
	for (const key of ["die.bout_of_madness_table", "outcome.investigators_win", "resource.document", "difficulty.hard", "needs"])
		assert.ok(typeof chrome[key] === "string" && chrome[key].trim(), `${key} is the caption this guard checks for`);
	assert.equal(chrome["die.no_such_die"], undefined, "an unnamed die has no caption to find");
	assert.ok(literals("skill").size > 5, "the kernel's own skill literals are still readable from source");
});
