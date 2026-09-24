/** Real TS kernel reads for mods.craft.read. Fixture packages only; no model and no play. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readdir, readFile} from "node:fs/promises";
import {join} from "node:path";
import test from "node:test";
import {CRAFT_DESCRIPTOR, ROOT, craftManifest, oneCard, openKernel, writePackage} from "./craft-reference-test-kit.mjs";

const GENERATION = ["id", "title", "purpose", "useWhen", "avoidWhen", "context", "acceptable", "stronger", "alternative", "elaboration"];
const CANDIDATE = ["id", "title", "purpose", "useWhen", "avoidWhen"];
const cards = JSON.parse(await readFile(join(ROOT, "mods/narration-craft/cards.en.json"), "utf8"));
const starters = JSON.parse(await readFile(join(ROOT, "mods/narration-craft/starter-ids.json"), "utf8"));
const hidden = cards.flatMap(card => [card.nearMiss, card.diagnosis, card.boundaryText, card.why]);

async function tree(directory) {
	const out = {};
	const walk = async prefix => {
		const entries = await readdir(join(directory, prefix), {withFileTypes: true});
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(rel);
			else out[rel] = createHash("sha256").update(await readFile(join(directory, rel))).digest("hex");
		}
	};
	await walk("");
	return out;
}
const craftOf = capsule => capsule.mods.craft_reference;
const instructionIds = capsule => capsule.mods.instructions.map(row => row.mod);

test("default off reports no card body and capsule metadata names only the provider", async t => {
	const game = await openKernel(t, "craft-off");
	await game.call("table.open");
	const opened = await game.call("table.player_input", {text: "I stay by the desk."});
	assert.deepEqual(Object.keys(craftOf(opened.capsule).provider).sort(), ["mod", "version"]);
	assert.equal(craftOf(opened.capsule).provider.mod, "narration-craft");
	assert.equal(craftOf(opened.capsule).provider.version, "1.5.0");
	assert.equal(craftOf(opened.capsule).mode, "off");
	assert.equal("digest" in craftOf(opened.capsule).provider, false);
	const read = await game.call("mods.craft.read", {mode: "index"});
	assert.deepEqual(read, {status: "unavailable", reason: "disabled"});
	assert.equal("candidates" in read, false);
	assert.equal(JSON.stringify(read).includes("NEARMISS") , false);
});

test("jev index returns at most twelve summaries and card returns the generation allowlist", async t => {
	const game = await openKernel(t, "craft-on");
	await game.call("table.open");
	await game.call("mods.configure", {id: "narration-craft", settings: {reference_mode: "jev"}});
	const turn = await game.call("table.player_input", {text: "I look at the desk."});
	assert.equal(craftOf(turn.capsule).mode, "jev");
	assert.deepEqual(Object.keys(craftOf(turn.capsule)).sort(), ["mode", "provider"]);
	const index = await game.call("mods.craft.read", {mode: "index"});
	assert.equal(index.status, "ready");
	assert.equal(index.provider.mod, "narration-craft");
	assert.equal(typeof index.provider.digest, "string");
	assert.equal(typeof index.catalog_revision, "string");
	assert.equal(typeof index.binding.npc_revision, "string");
	assert.equal(typeof index.binding.memory_revision, "string");
	assert.ok(index.candidates.length > 0 && index.candidates.length <= 12);
	assert.deepEqual(index.candidates.map(row => row.id), starters);
	for (const row of index.candidates) assert.deepEqual(Object.keys(row).sort(), [...CANDIDATE].sort());
	assert.equal(hidden.some(text => JSON.stringify(index).includes(text)), false);
	const card = await game.call("mods.craft.read", {mode: "card", card_id: starters[0], expected: {
		provider: index.provider, catalog_revision: index.catalog_revision, binding: index.binding,
	}});
	assert.equal(card.status, "ready");
	assert.deepEqual(Object.keys(card.card), GENERATION);
	assert.equal(card.card.id, starters[0]);
	assert.equal(hidden.some(text => JSON.stringify(card.card).includes(text)), false);
	const foreign = await game.call("mods.craft.read", {mode: "card", card_id: "CRAFT-EXC-99", expected: {
		provider: index.provider, catalog_revision: index.catalog_revision, binding: index.binding,
	}});
	assert.deepEqual(foreign, {status: "unavailable", reason: "card_not_issued"});
	const staleDigest = await game.call("mods.craft.read", {mode: "card", card_id: starters[0], expected: {
		provider: index.provider, catalog_revision: "0".repeat(64), binding: index.binding,
	}});
	assert.deepEqual(staleDigest, {status: "unavailable", reason: "stale_reference"});
	const staleBinding = await game.call("mods.craft.read", {mode: "card", card_id: starters[0], expected: {
		provider: index.provider, catalog_revision: index.catalog_revision,
		binding: {...index.binding, npc_revision: `${index.binding.npc_revision}-stale`},
	}});
	assert.deepEqual(staleBinding, {status: "unavailable", reason: "stale_reference"});
});

test("a ready read does not change the campaign world, turn, or logs", async t => {
	const game = await openKernel(t, "craft-readonly");
	await game.call("table.open");
	await game.call("mods.configure", {id: "narration-craft", settings: {reference_mode: "jev"}});
	await game.call("table.player_input", {text: "I wait."});
	const before = await tree(game.campaign);
	const index = await game.call("mods.craft.read", {mode: "index"});
	await game.call("mods.craft.read", {mode: "card", card_id: index.candidates[0].id, expected: {
		provider: index.provider, catalog_revision: index.catalog_revision, binding: index.binding,
	}});
	assert.deepEqual(await tree(game.campaign), before);
});

test("pending reference_mode does not become active before the next accepted input", async t => {
	const game = await openKernel(t, "craft-pending");
	await game.call("table.open");
	await game.call("table.player_input", {text: "I open the turn."});
	const configured = await game.call("mods.configure", {id: "narration-craft", settings: {reference_mode: "jev"}});
	const row = configured.mods.find(mod => mod.id === "narration-craft");
	assert.equal(row.active.settings.reference_mode, "off");
	assert.equal(row.pending.settings.reference_mode, "jev");
	assert.deepEqual(await game.call("mods.craft.read", {mode: "index"}), {status: "unavailable", reason: "disabled"});
	assert.equal(craftOf(await game.call("table.capsule")).mode, "off");
	await game.call("table.narrate", {call_id: "t1-c1", text: "The office stays quiet."});
	assert.equal(craftOf(await game.call("table.capsule")).mode, "off", "closing the turn still does not apply a pending mode");
	const next = await game.call("table.player_input", {text: "I ask one plain question."});
	assert.equal(craftOf(next.capsule).mode, "jev");
	assert.equal((await game.call("mods.craft.read", {mode: "index"})).status, "ready");
});

test("the later craft provider replaces the earlier one without dropping additive instructions", async t => {
	const game = await openKernel(t, "craft-order");
	const directory = join(game.home, "craft-later");
	await writePackage(directory, craftManifest("craft-later"), {
		"agent.md": "LATER CRAFT INSTRUCTIONS", "brief.md": "Later brief.",
		"craft-reference.json": CRAFT_DESCRIPTOR, "cards.en.json": oneCard("Later card"), "starter-ids.json": ["CRAFT-EXC-01"],
	});
	await game.call("mods.install", {path: directory});
	await game.call("table.open");
	await game.call("mods.configure", {id: "narration-craft", settings: {reference_mode: "jev"}});
	await game.call("mods.configure", {id: "craft-later", version: "1.0.0", enabled: true, settings: {reference_mode: "jev"}});
	const listed = await game.call("mods.list");
	const laterLast = listed.order.filter(id => id !== "craft-later").concat("craft-later");
	await game.call("mods.order", {order: laterLast});
	const first = await game.call("table.player_input", {text: "I compare the two packages."});
	const firstRead = await game.call("mods.craft.read", {mode: "index"});
	assert.equal(firstRead.provider.mod, "craft-later");
	assert.deepEqual(firstRead.candidates.map(row => row.id), ["CRAFT-EXC-01"]);
	assert.equal(firstRead.candidates.length, 1);
	assert.ok(instructionIds(first.capsule).includes("narration-craft"));
	assert.ok(instructionIds(first.capsule).includes("craft-later"));
	await game.call("table.narrate", {call_id: "t1-c1", text: "Both packages remain installed."});
	const narrationLast = laterLast.filter(id => id !== "narration-craft").concat("narration-craft");
	await game.call("mods.order", {order: narrationLast});
	const secondRead = await game.call("mods.craft.read", {mode: "index"});
	assert.equal(secondRead.provider.mod, "narration-craft");
	assert.equal(secondRead.candidates.length, starters.length);
	const second = await game.call("table.player_input", {text: "I ask again."});
	assert.ok(instructionIds(second.capsule).includes("narration-craft"));
	assert.ok(instructionIds(second.capsule).includes("craft-later"));
});

test("an unknown capability stays incompatible and a descriptor that escapes the package is refused", async t => {
	const game = await openKernel(t, "craft-reject");
	const unknown = join(game.home, "future-craft");
	await writePackage(unknown, {
		id: "future-craft", version: "1.0.0", game_api: "pipicoc.game.v1", state_version: 1, author: "Test",
		name: {en: "Future"}, description: {en: "Unknown capability fixture"}, default_enabled: true,
		requires: ["context.craft-reference.v99"], dependencies: {}, conflicts: [], settings: {}, contributes: {instructions: "agent.md"},
	}, {"agent.md": "Future instructions."});
	await game.call("mods.install", {path: unknown});
	const opened = await game.call("table.open");
	const gap = opened.mods_unreadable.find(row => row.package === "future-craft");
	assert.equal(gap.reason, "unknown_capability");
	assert.deepEqual(gap.unknown, ["context.craft-reference.v99"]);
	const playable = await game.call("table.player_input", {text: "I continue with the known packages."});
	assert.ok(instructionIds(playable.capsule).includes("narration-craft"));
	assert.equal(instructionIds(playable.capsule).includes("future-craft"), false);
	const escaped = join(game.home, "escaped-craft");
	await writePackage(escaped, craftManifest("escaped-craft"), {
		"agent.md": "Escaped.", "brief.md": "Escaped brief.",
		"craft-reference.json": {...CRAFT_DESCRIPTOR, catalog: "../cards.en.json"},
		"cards.en.json": oneCard("Unused"), "starter-ids.json": ["CRAFT-EXC-01"],
	});
	await assert.rejects(game.call("mods.install", {path: escaped}), error => error.code === "invalid_params" && /Craft reference paths/.test(error.message));
	const listed = await game.call("mods.list");
	assert.equal(listed.mods.some(mod => mod.id === "escaped-craft"), false);
	assert.equal(listed.unavailable?.some(mod => mod.id === "narration-craft") ?? false, false);
	assert.ok(instructionIds(await game.call("table.capsule")).includes("narration-craft"));
});

test("a valid descriptor with a corrupt catalog is unavailable and the ordinary capsule still assembles", async t => {
	const game = await openKernel(t, "craft-corrupt");
	const directory = join(game.home, "craft-corrupt");
	await writePackage(directory, craftManifest("craft-corrupt"), {
		"agent.md": "CORRUPT PROVIDER INSTRUCTIONS", "brief.md": "Corrupt brief.",
		"craft-reference.json": CRAFT_DESCRIPTOR, "cards.en.json": {not: "a catalog"}, "starter-ids.json": [],
	});
	await game.call("mods.install", {path: directory});
	await game.call("table.open");
	await game.call("mods.configure", {id: "narration-craft", settings: {reference_mode: "jev"}});
	await game.call("mods.configure", {id: "craft-corrupt", version: "1.0.0", enabled: true, settings: {reference_mode: "jev"}});
	const order = (await game.call("mods.list")).order.filter(id => id !== "craft-corrupt").concat("craft-corrupt");
	await game.call("mods.order", {order});
	const turn = await game.call("table.player_input", {text: "I stay with the ordinary table."});
	assert.equal(craftOf(turn.capsule).provider.mod, "craft-corrupt");
	assert.equal(craftOf(turn.capsule).mode, "jev");
	assert.ok(instructionIds(turn.capsule).includes("narration-craft"));
	assert.ok(instructionIds(turn.capsule).includes("craft-corrupt"));
	assert.deepEqual(await game.call("mods.craft.read", {mode: "index"}), {status: "unavailable", reason: "invalid_assets"});
	await game.call("table.narrate", {call_id: "t1-c1", text: "The table continues."});
	const next = await game.call("table.player_input", {text: "I ask the next ordinary question."});
	assert.ok(next.capsule.mods.instructions.length > 1);
});
