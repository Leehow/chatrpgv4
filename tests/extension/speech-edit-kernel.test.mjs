/**
 * Contract §165 against the real TS kernel: `speech.job` and `speech.edit` through the kernel's own handlers, the
 * shipped `zh-optimize` 1.1.0 as the package that contributes the lane, and package variants installed through
 * `mods.install`. Nothing here calls a model or plays a table.
 */
import assert from "node:assert/strict";
import {cp, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import test, {after} from "node:test";
import {build} from "esbuild";

const ROOT = resolve(import.meta.dirname, "../..");
const SHIPPED = join(ROOT, "mods/zh-optimize");
const KNOTT = "Steven Knott";
const INVESTIGATOR = "托马斯·海斯";
const LINE_A = "「钥匙在这儿，地址写在租约上。」";
const LINE_B = "「马卡里奥一家搬去哪儿，我不知道。」";
/** A person the table has not named yet: the speech pass keeps them as a label (§40.1). */
const STRANGER = "穿黑袍的女人";
const LINE_L = "「快走吧。」";
/** An investigator line, an NPC line, a label line and a second NPC line, with a mechanics-free prose run between. */
const DELIVERY = `{{say:${INVESTIGATOR}}}「我接了。」{{/say}}诺特把钥匙推过来。{{say:${KNOTT}}}${LINE_A}{{/say}}`
	+ `角落里有人咳了一声。{{say:${STRANGER}}}${LINE_L}{{/say}}诺特没抬头。{{say:${KNOTT}}}${LINE_B}{{/say}}`;

const temporary = await mkdtemp(join(tmpdir(), "speech-edit-kernel-"));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(ROOT, "node_modules"), join(temporary, "node_modules"), "dir");
await build({
	stdin: {contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: ROOT, sourcefile: "speech-edit-kernel.ts"},
	outfile: join(temporary, "kernel.mjs"), bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
});
const kernelApi = await import(pathToFileURL(join(temporary, "kernel.mjs")).href);

async function kernel(t, seed) {
	const home = await mkdtemp(join(tmpdir(), "speech-edit-kernel-home-"));
	const context = await kernelApi.createKernelContext({
		workspace: home, content: join(ROOT, "content"), seed,
		locks: kernelApi.createAdvisoryLocks(async () => {}),
		env: {...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1"},
	});
	const runtime = kernelApi.createKernelRuntime(context);
	t.after(async () => {await runtime.close(); await rm(home, {recursive: true, force: true});});
	const call = (method, params = {}) => runtime.handlers[method](params);
	const dir = id => join(home, ".coc", "campaigns", id);
	return {home, call, dir, record: async (id, turn) => JSON.parse(await readFile(join(dir(id), "turns", `${String(turn).padStart(4, "0")}.json`), "utf8"))};
}
/** Create, deliver the opening, take one player line, and close turn 1 with `text`: the product's own path to a record. */
async function delivered(game, id, {language = "zh-Hans", text = DELIVERY} = {}) {
	await game.call("campaign.create", {id, module: "the-haunting", pregen: "thomas-hayes", play_language: language});
	await game.call("table.narrate", {campaign: id, call_id: "t0-c1", text: "开场。\n\n诺特把钥匙拍在桌上。"});
	await game.call("table.player_input", {campaign: id, text: "我接下这活。钥匙和地址给我。"});
	return game.call("table.narrate", {campaign: id, call_id: "t1-c1", text});
}
/** A copy of the shipped package under another id, its manifest edited: the kernel's installer reads it from disk. */
async function variant(game, name, edit, files = {}) {
	const path = join(game.home, "packages", name);
	await cp(SHIPPED, path, {recursive: true});
	const manifest = JSON.parse(await readFile(join(path, "mod.json"), "utf8"));
	await writeFile(join(path, "mod.json"), JSON.stringify(edit({...manifest, id: name, version: "1.0.0", default_enabled: false})));
	for (const [file, text] of Object.entries(files)) await writeFile(join(path, file), text);
	return path;
}
const bytes = (record, keys) => JSON.stringify(keys.map(key => record[key]));
const DELIVERED = ["text", "rendered_text", "marked_text", "speech"];

test("speech.job hands the lane zh-optimize's words, the turn, and one row per line not the investigator's, indexed into speech", async t => {
	const game = await kernel(t, "speech-job");
	const result = await delivered(game, "zh");
	assert.deepEqual(result.speech.map(row => Object.keys(row.who).sort()), [["investigator", "name"], ["name", "npc"], ["label"], ["name", "npc"]],
		"the delivery interleaves an investigator, an NPC, a label and the NPC again");
	// §40.7: a mask the table established for the person reaches the lane beside their lines.
	const worldPath = join(game.dir("zh"), "world.json"), world = JSON.parse(await readFile(worldPath, "utf8"));
	world.mods.state["narration-craft"] ??= {};
	world.mods.state["narration-craft"].dossier ??= {};
	world.mods.state["narration-craft"].dossier["npc-steven-knott"] = {
		voice_mask: {value: ["话少，急着把事交代完。"], label: "mask", turn: 1, mod: "narration-craft", shape: "lines"}};
	await writeFile(worldPath, JSON.stringify(world));

	const job = await game.call("speech.job", {campaign: "zh", turn: 1});
	const record = await game.record("zh", 1);
	assert.deepEqual(job.lane, {mod: "zh-optimize", version: "1.1.0"});
	assert.equal(job.instruction, (await readFile(join(SHIPPED, "speech-edit-lane.md"), "utf8")).trim(), "the package's file, whole");
	assert.equal(job.player_text, "我接下这活。钥匙和地址给我。");
	for (const key of ["rendered_text", "marked_text", "speech"]) assert.deepEqual(job[key], record[key], key);
	// §165.3 as amended 2026-10-01: every line but the investigator's; a label row speaks under its label, with no mask.
	assert.deepEqual(job.lines, [
		{index: 1, speaker: KNOTT, voice_mask: "话少，急着把事交代完。", text: LINE_A},
		{index: 2, speaker: STRANGER, text: LINE_L},
		{index: 3, speaker: KNOTT, voice_mask: "话少，急着把事交代完。", text: LINE_B},
	], "the investigator's row is never sent");
});

test("speech.edit lands the overlay and leaves every delivered field and the transcript byte for byte", async t => {
	const game = await kernel(t, "speech-edit-lands");
	await delivered(game, "zh");
	const before = await game.record("zh", 1), transcript = await readFile(join(game.dir("zh"), "transcript.jsonl"), "utf8");
	const lines = [{index: 3, original: LINE_B, edited: "「至于马卡里奥一家搬去哪儿，我也不知道。」"}, {index: 1, original: LINE_A, edited: "「行，钥匙在这儿，地址就写在租约上。」"},
		{index: 2, original: LINE_L, edited: "「快走啊。」"}];
	assert.deepEqual(await game.call("speech.edit", {campaign: "zh", turn: 1, lines, model: "edit/e1"}), {ok: true, turn: 1});
	const after = await game.record("zh", 1);
	assert.equal(bytes(after, DELIVERED), bytes(before, DELIVERED), "text, rendered_text, marked_text and speech are untouched");
	assert.equal(await readFile(join(game.dir("zh"), "transcript.jsonl"), "utf8"), transcript, "the transcript row is untouched");
	assert.deepEqual(after.speech_edit.lines, [...lines].sort((a, b) => a.index - b.index));
	assert.equal(after.speech_edit.model, "edit/e1");
	assert.match(after.speech_edit.at, /^\d{4}-\d\d-\d\dT/);
	const {speech_edit: _overlay, ...rest} = after;
	assert.deepEqual(rest, before, "the overlay is the only change to the record");
	// The same edit again is a replay and writes nothing new.
	assert.deepEqual(await game.call("speech.edit", {campaign: "zh", turn: 1, lines, model: "edit/e1"}), {ok: true, turn: 1, replayed: true});
	assert.equal((await game.record("zh", 1)).speech_edit.at, after.speech_edit.at);
});

test("a record whose speech changed is stale and nothing is written", async t => {
	const game = await kernel(t, "speech-edit-stale");
	await delivered(game, "zh");
	const path = join(game.dir("zh"), "turns", "0001.json"), record = JSON.parse(await readFile(path, "utf8"));
	// The turn was replaced: the same index now holds another line.
	record.speech[3].text = "「我什么都不知道。」";
	await writeFile(path, JSON.stringify(record));
	const stored = await readFile(path, "utf8");
	const lines = [{index: 3, original: LINE_B, edited: "「至于马卡里奥一家搬去哪儿，我也不知道。」"}];
	assert.deepEqual(await game.call("speech.edit", {campaign: "zh", turn: 1, lines, model: "edit/e1"}), {ok: false, reason: "stale"});
	assert.equal(await readFile(path, "utf8"), stored, "no write");
	// A turn with no record at all (rolled back) is stale too.
	assert.deepEqual(await game.call("speech.edit", {campaign: "zh", turn: 7, lines, model: "edit/e1"}), {ok: false, reason: "stale"});
	// And one line out of date is enough to land none of them.
	const mixed = [{index: 1, original: LINE_A, edited: "「行，钥匙在这儿。」"}, ...lines];
	assert.deepEqual(await game.call("speech.edit", {campaign: "zh", turn: 1, lines: mixed, model: "edit/e1"}), {ok: false, reason: "stale"});
	assert.equal(await readFile(path, "utf8"), stored);
});

test("the known boundary: an ask delivery is not edited", async t => {
	const game = await kernel(t, "speech-edit-ask");
	await game.call("campaign.create", {id: "zh", module: "the-haunting", pregen: "thomas-hayes", play_language: "zh-Hans"});
	await game.call("table.narrate", {campaign: "zh", call_id: "t0-c1", text: "开场。\n\n诺特把钥匙拍在桌上。"});
	await game.call("table.player_input", {campaign: "zh", text: "钥匙和地址给我。"});
	const asked = await game.call("table.ask", {campaign: "zh", call_id: "t1-c1", prompt: "接不接？", options: ["接", "不接"],
		text: `{{say:${KNOTT}}}${LINE_A}{{/say}}`});
	assert.equal(asked.speech[0].who.npc, "steven-knott", "the ask carried an NPC line");
	const record = await game.record("zh", 1);
	assert.equal(record.closed_by, "ask");
	assert.equal(record.marked_text, undefined, "an ask record stores no marked text, which is why it is the boundary");
	assert.deepEqual(await game.call("speech.job", {campaign: "zh", turn: 1}), {turn: 1, lane: null, reason: "no_record"});
	const stored = await readFile(join(game.dir("zh"), "turns", "0001.json"), "utf8");
	assert.deepEqual(await game.call("speech.edit", {campaign: "zh", turn: 1, model: "edit/e1",
		lines: [{index: 0, original: LINE_A, edited: "「行，钥匙在这儿。」"}]}), {ok: false, reason: "stale"});
	assert.equal(await readFile(join(game.dir("zh"), "turns", "0001.json"), "utf8"), stored);
});

test("the lane runs only with exactly one enabled contributing package", async t => {
	const game = await kernel(t, "speech-edit-owners");
	// zh-optimize is scoped to zh: an English campaign locks it off, so nobody contributes the lane.
	await delivered(game, "en", {language: "en"});
	assert.deepEqual(await game.call("speech.job", {campaign: "en", turn: 1}), {turn: 1, lane: null, reason: "none"});
	await delivered(game, "zh");
	await game.call("mods.configure", {campaign: "zh", id: "zh-optimize", enabled: false});
	assert.deepEqual(await game.call("speech.job", {campaign: "zh", turn: 1}), {turn: 1, lane: null, reason: "none"});
	await game.call("mods.configure", {campaign: "zh", id: "zh-optimize", enabled: true});
	// A second package that contributes it: the lane does not run, and both are named.
	await game.call("mods.install", {path: await variant(game, "zh-speech-second", manifest => manifest)});
	await game.call("mods.configure", {campaign: "zh", id: "zh-speech-second", version: "1.0.0", enabled: true});
	const conflict = await game.call("speech.job", {campaign: "zh", turn: 1});
	assert.equal(conflict.lane, null);
	assert.equal(conflict.reason, "conflict");
	assert.deepEqual(conflict.contributors.map(row => row.mod).sort(), ["zh-optimize", "zh-speech-second"]);
	assert.equal(conflict.instruction, undefined, "a conflicted lane is handed no words");
	// A delivery with no line but the investigator's, or none at all, has nothing to edit.
	await delivered(game, "plain", {text: "诺特把钥匙推过来，没说话。"});
	assert.deepEqual(await game.call("speech.job", {campaign: "plain", turn: 1}), {turn: 1, lane: null, reason: "no_npc_lines"});
	await delivered(game, "own", {text: `{{say:${INVESTIGATOR}}}「我接了。」{{/say}}诺特把钥匙推过来。`});
	assert.deepEqual(await game.call("speech.job", {campaign: "own", turn: 1}), {turn: 1, lane: null, reason: "no_npc_lines"});
});

test("a package that contributes the lane needs its capability and non-empty words", async t => {
	const game = await kernel(t, "speech-edit-manifest");
	const refused = async (name, edit, files, reason) => {
		await assert.rejects(game.call("mods.install", {path: await variant(game, name, edit, files)}), error => {
			assert.equal(error.code, "invalid_params", name);
			assert.equal(error.details?.reason, reason, name);
			assert.equal(error.details?.field, "contributes.speech_edit_lane", name);
			return true;
		});
	};
	await refused("no-capability", manifest => ({...manifest, requires: manifest.requires.filter(cap => cap !== "speech.edit.lane.v1")}), {}, "speech_edit_lane_capability");
	await refused("blank-lane", manifest => manifest, {"speech-edit-lane.md": " \n"}, "speech_edit_lane_text");
	const listed = await game.call("mods.list");
	assert.ok(listed.capabilities.includes("speech.edit.lane.v1"), "the kernel advertises the lane's capability");
});

test("speech.edit refuses the investigator's row and marker syntax by shape", async t => {
	const game = await kernel(t, "speech-edit-shape");
	await delivered(game, "zh");
	const edit = lines => game.call("speech.edit", {campaign: "zh", turn: 1, lines, model: "edit/e1"});
	await assert.rejects(edit([{index: 0, original: "「我接了。」", edited: "「行，我接了。」"}]),
		error => error.code === "invalid_params" && error.details?.index === 0 && /investigator rows are never sent/.test(error.fix));
	// The same row beside a line the lane may edit refuses the whole call: nothing lands.
	await assert.rejects(edit([{index: 2, original: LINE_L, edited: "「快走啊。」"}, {index: 0, original: "「我接了。」", edited: "「行，我接了。」"}]),
		error => error.code === "invalid_params" && error.details?.index === 0);
	await assert.rejects(edit([{index: 1, original: LINE_A, edited: "「钥匙{{say:x}}在这儿。」"}]), error => error.code === "invalid_params");
	await assert.rejects(edit([{index: 1, original: LINE_A, edited: "   "}]), error => error.code === "invalid_params");
	await assert.rejects(edit([]), error => error.code === "invalid_params");
	assert.equal((await game.record("zh", 1)).speech_edit, undefined);
});
