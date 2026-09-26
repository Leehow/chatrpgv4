/** Unified expression seams against the real TS kernel. Fixtures only; no model and no play. */
import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import test, {after} from "node:test";
import {build} from "esbuild";

const ROOT = resolve(import.meta.dirname, "../..");
const temporary = await mkdtemp(join(tmpdir(), "unified-voice-kernel-"));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(ROOT, "node_modules"), join(temporary, "node_modules"), "dir");
await build({
	stdin: {contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: ROOT, sourcefile: "unified-voice-kernel.ts"},
	outfile: join(temporary, "kernel.mjs"), bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
});
const kernelApi = await import(pathToFileURL(join(temporary, "kernel.mjs")).href);

async function writePackage(directory, manifest, files) {
	await mkdir(directory, {recursive: true});
	await writeFile(join(directory, "mod.json"), JSON.stringify(manifest));
	for (const [name, value] of Object.entries(files)) {
		const path = join(directory, name);
		await mkdir(dirname(path), {recursive: true});
		await writeFile(path, typeof value === "string" ? value : JSON.stringify(value));
	}
	return directory;
}

const NPC = "fixture-npc-zeta";
const KNOTT = "npc-steven-knott";
const field = (key, lines) => ({value: lines, label: key === "voice_mask" ? "mask" : "in exchange", turn: 1, mod: "npc-voice", shape: "lines"});
const CARD = {
	voice_mask: field("voice_mask", ["quiet, exact, no slogan"]),
	exchanges: field("exchanges", ["hello → good morning", "where → down the hall", "thanks → of course"]),
	sample_lines: {value: ["archived catchphrase"], label: "sample", turn: 0, mod: "npc-voice", shape: "lines"},
	aside: {note: "not a voice field"},
};
const COPIED = {voice_mask: CARD.voice_mask, exchanges: CARD.exchanges};
const OTHER = {
	voice_mask: field("voice_mask", ["already on the target card"]),
	exchanges: field("exchanges", ["a → b", "c → d", "e → f"]),
};
const V1 = {legacy_voice: {value: ["archived v1 sample"], label: "legacy", shape: "lines"}};

async function open(t, id, {beforeCreate} = {}) {
	const home = await mkdtemp(join(tmpdir(), "unified-voice-"));
	const context = await kernelApi.createKernelContext({
		workspace: home, content: join(ROOT, "content"), seed: id,
		locks: kernelApi.createAdvisoryLocks(async () => {}),
		env: {...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1"},
	});
	const runtime = kernelApi.createKernelRuntime(context);
	t.after(async () => {await runtime.close(); await rm(home, {recursive: true, force: true});});
	const call = (method, params = {}) => runtime.handlers[method]({campaign: id, ...params});
	if (beforeCreate) await beforeCreate(call, home);
	await call("campaign.create", {id, module: "the-haunting", pregen: "thomas-hayes", play_language: "en"});
	return {home, call, id, campaign: join(home, ".coc", "campaigns", id)};
}
const rowOf = (list, id) => list.mods.find(row => row.id === id && (row.active?.version ? row.version === row.active.version : row.version === list.mods.filter(item => item.id === id).at(-1).version));
const lockOf = (list, id) => list.mods.find(row => row.id === id && row.active)?.active;
async function installOld(game) {
	const narration = join(game.home, "narration-1.6");
	const voice = join(game.home, "npc-voice-1.2");
	await writePackage(narration, {
		id: "narration-craft", version: "1.6.0", game_api: "pipicoc.game.v1", state_version: 1, author: "Test",
		name: {en: "Narration Craft"}, description: {en: "Old expression fixture"}, default_enabled: true,
		requires: ["mods.package-files.v1"],
		package_files: ["agent.md", "brief.md"],
		dependencies: {}, conflicts: [], settings: {density_guide: "off"},
		settings_schema: {density_guide: {enum: ["off", "on"]}},
		contributes: {instructions: "agent.md", brief: "brief.md"},
	}, {"agent.md": "Old narration.", "brief.md": "Old brief."});
	await writePackage(voice, {
		id: "npc-voice", version: "1.2.0", game_api: "pipicoc.game.v1", state_version: 2, author: "Test",
		name: {en: "NPC Voice"}, description: {en: "Old voice fixture"}, default_enabled: true,
		requires: ["graph.vocabulary.v1", "graph.vocabulary.table.v1", "context.npc.v1", "mods.package-files.v1", "npc.voice.generation.v2"],
		package_files: ["agent.md", "brief.md"], dependencies: {}, conflicts: [],
		migrations: [{from: 1, to: 2, operations: [{op: "rename", from: "dossier", to: "legacy_voice_dossier"}, {op: "default", key: "dossier", value: {}}]}],
		settings: {coarse_language: true}, settings_schema: {},
		contributes: {instructions: "agent.md", brief: "brief.md", vocabulary: {actor_profile_keys: [
			{key: "voice_mask", label: "mask", shape: "lines", ask: "one line"},
			{key: "exchanges", label: "in exchange", shape: "lines", ask: "up to three exchanges"},
		]}},
	}, {"agent.md": "Old voice guidance.", "brief.md": "Old voice brief."});
	const narrationInstall = await game.call("mods.install", {path: narration});
	const voiceInstall = await game.call("mods.install", {path: voice});
	return {narration: narrationInstall.digest, voice: voiceInstall.digest};
}
async function world(game) {
	return JSON.parse(await readFile(join(game.campaign, "world.json"), "utf8"));
}
async function writeWorld(game, value) {
	await writeFile(join(game.campaign, "world.json"), JSON.stringify(value));
}
/** An existing world already holds the old locks. Downgrading 1.7 has no migration, so the fixture writes the installed digests. */
async function seedLegacy(game, {enabled = true, coarse = false, dossier = {[NPC]: CARD}, archived = {[NPC]: V1}, target = {}} = {}) {
	const digests = await installOld(game);
	const current = await world(game);
	current.mods.active["narration-craft"] = {version: "1.6.0", digest: digests.narration, state_version: 1, enabled: true,
		settings: {density_guide: "off"}};
	current.mods.active["npc-voice"] = {version: "1.2.0", digest: digests.voice, state_version: 2, enabled, settings: {coarse_language: coarse}};
	current.mods.state["npc-voice"] = {dossier, legacy_voice_dossier: archived};
	current.mods.state["narration-craft"] = {dossier: target};
	await writeWorld(game, current);
}

test("a new world enables unified expression once and ignores a cached npc-voice default", async t => {
	const game = await open(t, "uv-new", {beforeCreate: call => call("mods.defaults", {id: "npc-voice", enabled: true})});
	const listed = await game.call("mods.list");
	const narration = lockOf(listed, "narration-craft");
	const voice = lockOf(listed, "npc-voice");
	assert.equal(narration.version, "2.0.1");
	assert.equal(narration.enabled, true);
	assert.deepEqual(Object.keys(narration.settings).sort(), ["coarse_language", "density_guide"]);
	assert.equal(voice.version, "1.3.0");
	assert.equal(voice.enabled, false);
	assert.equal(listed.mods.filter(row => row.id === "npc-voice").every(row => row.compatibility_visible === false), true);
	await game.call("table.open");
	const capsule = await game.call("table.capsule");
	const words = capsule.mods.vocabulary.words.filter(word => ["voice_mask", "exchanges"].includes(word.key));
	assert.deepEqual(words.map(word => word.key), ["voice_mask", "exchanges"]);
	assert.equal(words.every(word => word.mod === "narration-craft"), true);
	assert.ok(Array.isArray(capsule.voices));
	assert.deepEqual(Object.keys(capsule.mods).filter(key => key.includes("craft")), [], "no retired selector slot reaches the capsule");
	assert.equal(capsule.mods.instructions.some(row => row.mod === "npc-voice"), false);
	// §40.7 Owner: 2.0.0 declares npc.voice.generation.v2, so a new world's lane belongs to it from the first turn.
	const issued = await game.call("voice.job");
	assert.equal(typeof issued.job_id, "string");
	assert.equal(issued.generation.version, "2.0.1");
	assert.deepEqual((await game.call("table.capsule")).voices, capsule.voices);
});

test("installing the unified packages does not retarget an explicit old world", async t => {
	const game = await open(t, "uv-old");
	await seedLegacy(game);
	const before = await world(game);
	const snapshot = {active: before.mods.active, state: before.mods.state};
	await game.call("mods.list");
	const after = await world(game);
	assert.deepEqual({active: after.mods.active, state: after.mods.state}, snapshot);
	assert.equal(after.mods.active["narration-craft"].version, "1.6.0");
	assert.equal(after.mods.active["npc-voice"].enabled, true);
});

test("an enabled unified upgrade copies whole v2 cards, keeps the old namespace, and reports counts only", async t => {
	const game = await open(t, "uv-hand");
	await seedLegacy(game, {target: {[NPC]: OTHER}});
	const listed = await game.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true,
		settings: {density_guide: "off", coarse_language: false}});
	const saved = await world(game);
	assert.equal(saved.mods.active["npc-voice"].enabled, false);
	assert.deepEqual(saved.mods.state["npc-voice"].dossier[NPC], CARD);
	assert.deepEqual(saved.mods.state["npc-voice"].legacy_voice_dossier[NPC], V1);
	assert.deepEqual(saved.mods.state["narration-craft"].dossier[NPC], OTHER);
	assert.equal(Object.hasOwn(saved.mods.state["narration-craft"].dossier[NPC], "sample_lines"), false);
	assert.equal(Object.hasOwn(saved.mods.state["narration-craft"].dossier[NPC], "aside"), false);
	assert.deepEqual(saved.mods.state["npc-voice"].dossier[NPC].sample_lines, CARD.sample_lines);
	assert.deepEqual(saved.mods.state["npc-voice"].dossier[NPC].aside, CARD.aside);
	assert.equal(Object.hasOwn(saved.mods.state["narration-craft"], "legacy_voice_dossier"), false);
	const handover = listed.mods.find(row => row.id === "narration-craft" && row.version === "2.0.1").voice_handover;
	assert.deepEqual(Object.keys(handover).sort(), ["conflict_count", "copied_count", "from", "from_version", "legacy_v1_retained", "schema_version", "skipped_count", "to_version"]);
	assert.equal(handover.copied_count, 0);
	assert.equal(handover.conflict_count, 1);
	assert.equal("from_digest" in handover, false);
	assert.equal(JSON.stringify(listed).includes(NPC), false);
	assert.equal(saved.mods.active["narration-craft"].settings.coarse_language, false);
});

test("coarse preference is inherited only when the target has not established it and the caller did not set it", async t => {
	const game = await open(t, "uv-coarse");
	await seedLegacy(game, {coarse: false, target: {}});
	const inherited = await game.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true});
	assert.equal(lockOf(inherited, "narration-craft").settings.coarse_language, false);
	const again = await open(t, "uv-coarse-set");
	await seedLegacy(again, {coarse: false, target: {}});
	const explicit = await again.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true,
		settings: {coarse_language: true}});
	assert.equal(lockOf(explicit, "narration-craft").settings.coarse_language, true);
	assert.equal(lockOf(explicit, "narration-craft").settings.density_guide, "off");
	const partial = await open(t, "uv-coarse-partial");
	await seedLegacy(partial, {coarse: true, target: {}});
	const prior = await world(partial);
	prior.mods.active["narration-craft"].settings.density_guide = "on";
	await writeWorld(partial, prior);
	const kept = await partial.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true, settings: {coarse_language: false}});
	const settings = lockOf(kept, "narration-craft").settings;
	assert.equal(settings.coarse_language, false);
	assert.equal(settings.density_guide, "on");
});

test("a disabled legacy lock is not revived and a disabled target does not take the owner", async t => {
	const off = await open(t, "uv-legacy-off");
	await seedLegacy(off, {enabled: false});
	await off.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true});
	const saved = await world(off);
	assert.deepEqual(saved.mods.state["narration-craft"].dossier, {});
	assert.equal(JSON.stringify(saved.mods.state["narration-craft"]).includes("archived v1 sample"), false);
	assert.deepEqual(saved.mods.state["npc-voice"].dossier[NPC], CARD);
	assert.deepEqual(saved.mods.state["npc-voice"].legacy_voice_dossier[NPC], V1);
	assert.equal(saved.mods.active["npc-voice"].enabled, false);
	const target = await open(t, "uv-target-off");
	await seedLegacy(target);
	await target.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: false,
		settings: {density_guide: "off"}});
	const kept = await world(target);
	assert.equal(kept.mods.active["npc-voice"].enabled, true);
	assert.equal(Object.hasOwn(kept.mods.state["narration-craft"].dossier, NPC), false);
});

test("a busy upgrade waits for the next safe boundary and then applies the whole handover", async t => {
	const game = await open(t, "uv-busy");
	await seedLegacy(game);
	await game.call("table.open");
	await game.call("table.player_input", {text: "I stay by the desk."});
	const queued = await game.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true});
	const narration = queued.mods.find(row => row.id === "narration-craft" && row.version === "1.6.0");
	assert.equal(narration.active.version, "1.6.0");
	assert.equal(narration.pending.version, "2.0.1");
	assert.equal(narration.pending.enabled, true);
	let saved = await world(game);
	assert.equal(saved.mods.active["npc-voice"].enabled, true);
	assert.equal(Object.hasOwn(saved.mods.state["narration-craft"].dossier, NPC), false);
	await assert.rejects(game.call("mods.configure", {id: "npc-voice", version: "1.2.0", enabled: true, settings: {coarse_language: true}}),
		error => error.code === "invalid_params" && /handover is pending/.test(error.message));
	saved = await world(game);
	assert.equal(saved.mods.active["npc-voice"].enabled, true);
	await game.call("table.narrate", {call_id: "t1-c1", text: "The office stays quiet."});
	saved = await world(game);
	assert.equal(saved.mods.active["narration-craft"].version, "1.6.0");
	assert.equal(saved.mods.active["npc-voice"].enabled, true);
	await game.call("table.player_input", {text: "I ask one plain question."});
	saved = await world(game);
	assert.equal(saved.mods.active["narration-craft"].version, "2.0.1");
	assert.equal(saved.mods.active["narration-craft"].enabled, true);
	assert.equal(saved.mods.active["npc-voice"].enabled, false);
	assert.deepEqual(saved.mods.state["narration-craft"].dossier[NPC], COPIED);
	assert.deepEqual(saved.mods.state["npc-voice"].legacy_voice_dossier[NPC], V1);
});

test("after narrate the queued handover still rejects a legacy change until the next accepted input", async t => {
	const game = await open(t, "uv-idle");
	await seedLegacy(game);
	await game.call("table.open");
	await game.call("table.player_input", {text: "I stay by the desk."});
	await game.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true});
	await game.call("table.narrate", {call_id: "t1-c1", text: "The office stays quiet."});
	const before = await world(game);
	await assert.rejects(game.call("mods.configure", {id: "npc-voice", version: "1.2.0", enabled: true, settings: {coarse_language: true}}),
		error => error.code === "invalid_params" && /handover is pending/.test(error.message));
	assert.deepEqual(await world(game), before);
	assert.equal(before.mods.active["narration-craft"].version, "1.6.0");
	assert.equal(before.mods.active["npc-voice"].enabled, true);
	await game.call("table.player_input", {text: "I ask one plain question."});
	const saved = await world(game);
	assert.equal(saved.mods.active["narration-craft"].version, "2.0.1");
	assert.equal(saved.mods.active["npc-voice"].enabled, false);
	assert.deepEqual(saved.mods.state["narration-craft"].dossier[NPC], COPIED);
});

test("a queued legacy preference and a later queued handover land together", async t => {
	const game = await open(t, "uv-queue");
	await seedLegacy(game, {coarse: true});
	await game.call("table.open");
	await game.call("table.player_input", {text: "I stay by the desk."});
	const legacy = await game.call("mods.configure", {id: "npc-voice", version: "1.2.0", enabled: true, settings: {coarse_language: false}});
	assert.equal(legacy.mods.find(row => row.id === "npc-voice" && row.pending).pending.settings.coarse_language, false);
	const queued = await game.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true});
	assert.equal(queued.mods.find(row => row.id === "narration-craft" && row.version === "1.6.0").pending.version, "2.0.1");
	let saved = await world(game);
	assert.equal(saved.mods.active["npc-voice"].settings.coarse_language, true);
	assert.equal(saved.mods.active["narration-craft"].version, "1.6.0");
	await game.call("table.narrate", {call_id: "t1-c1", text: "The office stays quiet."});
	await game.call("table.player_input", {text: "I ask one plain question."});
	saved = await world(game);
	assert.equal(saved.mods.active["narration-craft"].version, "2.0.1");
	assert.equal(saved.mods.active["narration-craft"].enabled, true);
	assert.equal(saved.mods.active["narration-craft"].settings.coarse_language, false);
	assert.equal(saved.mods.active["npc-voice"].enabled, false);
	assert.deepEqual(saved.mods.state["narration-craft"].dossier[NPC], COPIED);
});

test("repeating the upgrade is idempotent and a later legacy enable conflicts", async t => {
	const game = await open(t, "uv-idem");
	await seedLegacy(game, {target: {}});
	await game.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true});
	const once = await world(game);
	const again = await game.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true});
	const twice = await world(game);
	assert.deepEqual(once.mods.state["narration-craft"].dossier[NPC], COPIED);
	assert.equal(Object.hasOwn(once.mods.state["narration-craft"].dossier[NPC], "sample_lines"), false);
	assert.deepEqual(once.mods.state["npc-voice"].dossier[NPC].sample_lines, CARD.sample_lines);
	assert.deepEqual(once.mods.state["npc-voice"].dossier[NPC].aside, CARD.aside);
	assert.deepEqual(twice.mods.state["narration-craft"].dossier, once.mods.state["narration-craft"].dossier);
	assert.deepEqual(twice.mods.state["narration-craft"].voice_handover, once.mods.state["narration-craft"].voice_handover);
	assert.equal(once.mods.state["narration-craft"].voice_handover.copied_count, 1);
	assert.deepEqual(twice.mods.state["npc-voice"], once.mods.state["npc-voice"]);
	const stored = once.mods.state["narration-craft"].voice_handover;
	const {from_digest: _digest, ...projected} = stored;
	assert.equal(typeof _digest, "string");
	assert.deepEqual(again.mods.find(row => row.id === "narration-craft" && row.version === "2.0.1").voice_handover, projected);
	await assert.rejects(game.call("mods.configure", {id: "npc-voice", version: "1.3.0", enabled: true}),
		error => error.code === "invalid_params" && /conflicts with npc-voice|conflicts with narration-craft/.test(error.message));
	assert.equal((await world(game)).mods.active["npc-voice"].enabled, false);
});

test("a malformed recognized field rejects the whole handover and an inherited key is only an own property", async t => {
	const bad = await open(t, "uv-bad");
	const broken = {voice_mask: {...CARD.voice_mask}, exchanges: CARD.exchanges};
	delete broken.voice_mask.turn;
	await seedLegacy(bad, {dossier: {[NPC]: broken, "npc-walter-corbitt": COPIED}, target: {}});
	const before = await world(bad);
	await assert.rejects(bad.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true}),
		error => error.code === "invalid_params" && /malformed/.test(error.message));
	assert.deepEqual(await world(bad), before);
	const proto = await open(t, "uv-proto");
	const inherited = {};
	Object.defineProperty(inherited, "__proto__", {value: COPIED, enumerable: true, writable: true, configurable: true});
	await seedLegacy(proto, {dossier: inherited, archived: {}, target: {}});
	await proto.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true});
	const saved = await world(proto);
	assert.equal(Object.hasOwn(saved.mods.state["narration-craft"].dossier, "__proto__"), true);
	assert.deepEqual(Object.getOwnPropertyDescriptor(saved.mods.state["narration-craft"].dossier, "__proto__").value, COPIED);
	assert.equal(Object.prototype.voice_mask, undefined);
});

test("a copied v2 card is still read from capsule.voices after the legacy owner is disabled", async t => {
	const game = await open(t, "uv-voices");
	await seedLegacy(game, {dossier: {[KNOTT]: COPIED}, archived: {}, target: {}});
	await game.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true});
	await game.call("table.open");
	const capsule = await game.call("table.capsule");
	const knott = capsule.voices.find(row => row.name === "Steven Knott");
	assert.ok(knott, "Steven Knott is present and his copied lines are in voices");
	assert.equal(knott.mask, CARD.voice_mask.value[0]);
	assert.deepEqual(knott["in exchange"], CARD.exchanges.value);
	assert.equal((await world(game)).mods.active["npc-voice"].enabled, false);
});

test("an in-flight legacy voice result cannot publish after handover", async t => {
	const game = await open(t, "uv-job");
	await seedLegacy(game, {dossier: {}, archived: {}, target: {}});
	await game.call("table.open");
	const job = await game.call("voice.job", {backfill: true});
	assert.equal(typeof job.job_id, "string");
	await game.call("mods.configure", {id: "narration-craft", version: "2.0.1", enabled: true, settings: {density_guide: "off"}});
	const voice = {mask: "flat and brief", exchanges: ["hello → hello", "where → here", "thanks → right"]};
	await assert.rejects(game.call("voice.submit", {job_id: job.job_id, voice}),
		error => error.code === "invalid_params" && error.details?.job_id === job.job_id);
	const saved = await world(game);
	assert.equal(Object.hasOwn(saved.mods.state["npc-voice"]?.dossier ?? {}, job.npc), false);
	assert.equal(Object.hasOwn(saved.mods.state["narration-craft"]?.dossier ?? {}, job.npc), false);
	// §40.7 Owner: the handover target declares the generation lane, so the lane is its now: a fresh job under its
	// own generation, never the legacy job that was in flight.
	const reissued = await game.call("voice.job", {backfill: true});
	assert.equal(typeof reissued.job_id, "string");
	assert.notEqual(reissued.job_id, job.job_id);
	assert.equal(reissued.generation.version, "2.0.1");
});
