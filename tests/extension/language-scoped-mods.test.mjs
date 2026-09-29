/**
 * Contract §152: a language-scoped Mod against the real TS kernel -- `mods.install`, `campaign.create`, the capsule
 * and `voice.job` through the kernel's own handlers. The fixture package lives in tests/fixtures/mods/language-zh;
 * nothing here calls a model or plays a table.
 */
import assert from "node:assert/strict";
import {cp, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import test, {after} from "node:test";
import {build} from "esbuild";

const ROOT = resolve(import.meta.dirname, "../..");
const FIXTURE = join(ROOT, "tests/fixtures/mods/language-zh");
const ID = "language-zh";
const CAPABILITY = "npc.voice.language-addendum.v1";
const temporary = await mkdtemp(join(tmpdir(), "language-scoped-mods-"));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(ROOT, "node_modules"), join(temporary, "node_modules"), "dir");
await build({
	stdin: {contents: "export * from './kernel-ts/testing/api.ts'; export {createWriteRuntime} from './kernel-ts/write/index.ts';", resolveDir: ROOT, sourcefile: "language-scoped-mods.ts"},
	outfile: join(temporary, "kernel.mjs"), bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
});
const kernelApi = await import(pathToFileURL(join(temporary, "kernel.mjs")).href);

async function kernel(t, seed) {
	const home = await mkdtemp(join(tmpdir(), "language-mods-"));
	const context = await kernelApi.createKernelContext({
		workspace: home, content: join(ROOT, "content"), seed,
		locks: kernelApi.createAdvisoryLocks(async () => {}),
		env: {...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1"},
	});
	const runtime = kernelApi.createKernelRuntime(context);
	t.after(async () => {await runtime.close(); await rm(home, {recursive: true, force: true});});
	const call = (method, params = {}) => runtime.handlers[method](params);
	const create = (id, play_language) => call("campaign.create", {id, module: "the-haunting", pregen: "thomas-hayes", play_language});
	return {home, call, create, campaign: id => join(home, ".coc", "campaigns", id)};
}
/** A copy of the fixture with its manifest (and optionally its files) changed: the kernel's installer reads it from disk. */
async function variant(game, name, edit = manifest => manifest, files = {}) {
	const path = join(game.home, "packages", name);
	await cp(FIXTURE, path, {recursive: true});
	const manifest = JSON.parse(await readFile(join(path, "mod.json"), "utf8"));
	await writeFile(join(path, "mod.json"), JSON.stringify(edit(manifest)));
	for (const [file, text] of Object.entries(files)) await writeFile(join(path, file), text);
	return path;
}
const lockOf = async (game, campaign, id) => (await game.call("mods.list", {campaign})).mods.find(row => row.id === id && row.active)?.active ?? null;
const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const byMod = capsule => new Map(capsule.mods.instructions.map(row => [row.mod, row]));
/** The first turn carries full instructions; the next one, after a delivery, carries briefs (§30.7). */
async function briefTurn(game, campaign) {
	await game.call("table.open", {campaign});
	const first = await game.call("table.player_input", {campaign, text: "I look around the office."});
	await game.call("table.narrate", {campaign, call_id: "t1-c1", text: "The office is quiet."});
	const next = await game.call("table.player_input", {campaign, text: "I keep looking."});
	return {first: byMod(first.capsule), next: byMod(next.capsule)};
}
const text = async name => (await readFile(join(FIXTURE, name), "utf8"));
const ownerLane = async () => (await readFile(join(ROOT, "mods/narration-craft/voice-lane.md"), "utf8")).trim();
const addendum = (id, body) => `## Language addendum: ${id}\n\n${body.trim()}`;

test("a language-scoped package is on by default only in a new campaign declared in a tag it names", async t => {
	const game = await kernel(t, "language-defaults");
	await game.create("before-install", "zh-Hans");
	await game.call("mods.install", {path: FIXTURE});
	await game.call("mods.install", {path: await variant(game, "hans", manifest => ({...manifest, id: "language-zh-hans", play_languages: ["zh-Hans"]}))});
	const listed = await game.call("mods.list");
	assert.ok(listed.capabilities.includes(CAPABILITY), "the kernel advertises the addendum capability");
	assert.deepEqual(listed.mods.find(row => row.id === ID).play_languages, ["zh"], "the listing names the tags a package is scoped to");
	assert.equal(listed.mods.find(row => row.id === ID).default_enabled, true, "default_enabled stays the catalog default");
	// listed "zh": the tag itself or any tag under it, never a tag that merely starts with the same letters.
	const expected = {
		"zh-Hans": {[ID]: true, "language-zh-hans": true},
		"zh-Hant": {[ID]: true, "language-zh-hans": false},
		"zh": {[ID]: true, "language-zh-hans": false},
		"zh-Hans-CN": {[ID]: true, "language-zh-hans": true},
		"zhx": {[ID]: false, "language-zh-hans": false},
		"en": {[ID]: false, "language-zh-hans": false},
	};
	for (const [tag, on] of Object.entries(expected)) {
		const id = `c-${tag.toLowerCase()}`;
		await game.create(id, tag);
		for (const [mod, enabled] of Object.entries(on)) {
			const lock = await lockOf(game, id, mod);
			assert.ok(lock, `${mod} is locked in the new ${tag} world`);
			assert.equal(lock.enabled, enabled, `${mod} on a ${tag} campaign`);
		}
		// Unscoped packages keep their plain defaults on every campaign.
		assert.equal((await lockOf(game, id, "narration-craft")).enabled, true, `narration-craft on a ${tag} campaign`);
	}
	// Only a fresh world takes the default: the campaign created before the install has no lock for it at all.
	assert.equal(await lockOf(game, "before-install", ID), null);
	// The player can still switch it on by hand where it does not match.
	await game.call("mods.configure", {campaign: "c-en", id: ID, enabled: true});
	assert.equal((await lockOf(game, "c-en", ID)).enabled, true);
});

test("a fresh world for a campaign that declares no play language treats it as no match", async t => {
	const game = await kernel(t, "language-absent");
	await game.call("mods.install", {path: FIXTURE});
	// Campaigns whose locks are taken away, so the next mods call locks them afresh (§26), through each of the three
	// ways it can: a world without locks, and, before world.json exists, mods.configure and mods.order with nothing
	// staged. One of each pair keeps its declared tag; the other is a campaign from before the tag was recorded, and
	// the data default is never read as its language.
	for (const via of ["world", "configure", "order"])
		for (const keep of [true, false]) {
			const id = `${via}-${keep ? "declared" : "undeclared"}`, root = game.campaign(id);
			await game.create(id, "zh-Hans");
			const meta = await readJson(join(root, "campaign.json")), world = await readJson(join(root, "world.json"));
			if (!keep) delete meta.play_language;
			if (via === "world") {
				delete world.mods;
				await writeFile(join(root, "world.json"), JSON.stringify(world));
			} else {
				await rm(join(root, "world.json"));
				delete meta.mods_pending;
			}
			await writeFile(join(root, "campaign.json"), JSON.stringify(meta));
			if (via === "order") await game.call("mods.order", {campaign: id, order: (await game.call("mods.list", {campaign: id})).order});
			else await game.call("mods.configure", {campaign: id, id: "keeper-pacing", enabled: false});
			const locks = via === "world" ? (await readJson(join(root, "world.json"))).mods.active : (await readJson(join(root, "campaign.json"))).mods_pending.active;
			if (via !== "order") assert.equal(locks["keeper-pacing"].enabled, false, `${id}: the configure landed on a freshly locked set`);
			assert.equal(locks[ID].enabled, keep, `${id}: the scoped package's fresh default`);
			assert.equal(locks["narration-craft"].enabled, true, `${id}: unscoped packages keep their defaults`);
		}
});

test("the write runtime's own fresh-world plan, without the Mod runtime, applies the same scope", async t => {
	const home = await mkdtemp(join(tmpdir(), "language-mods-bare-"));
	const context = await kernelApi.createKernelContext({workspace: home, content: join(ROOT, "content"), seed: "language-bare",
		env: {...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1"}});
	t.after(async () => {await context.git.close(); await rm(home, {recursive: true, force: true});});
	// This runtime has no installer and serves built-in packages only: the fixture sits where an installed version lives.
	await cp(FIXTURE, join(home, ".coc", "mods", "packages", ID, "1.0.0"), {recursive: true});
	const writer = kernelApi.createWriteRuntime(context);
	const create = (id, play_language) => writer.handlers["campaign.create"]({id, module: "the-haunting", pregen: "thomas-hayes", play_language});
	await create("en", "en");
	assert.equal((await readJson(join(home, ".coc", "campaigns", "en", "world.json"))).mods.active[ID].enabled, false);
	// Where the scope matches, the plan would enable it, and this runtime refuses an installed package by name.
	await assert.rejects(create("zh", "zh-Hans"), error => error.code === "not_implemented" && /active Mod language-zh/.test(error.message));
});

test("the language brief rides the capsule of the matching campaign only", async t => {
	const game = await kernel(t, "language-brief");
	await game.call("mods.install", {path: FIXTURE});
	await game.create("zh", "zh-Hans");
	await game.create("en", "en");
	const zh = await briefTurn(game, "zh"), en = await briefTurn(game, "en");
	assert.equal(zh.first.get(ID)?.form, "full");
	assert.equal(zh.first.get(ID).instruction, await text("agent.md"));
	assert.equal(zh.next.get(ID)?.form, "brief");
	assert.equal(zh.next.get(ID).instruction, await text("brief.md"));
	assert.equal(en.first.has(ID), false);
	assert.equal(en.next.has(ID), false);
	assert.ok(en.next.has("narration-craft") && zh.next.has("narration-craft"), "the other packages are unaffected");
});

test("the voice lane appends each enabled package's addendum after the owner's words, in load order", async t => {
	const game = await kernel(t, "language-voice");
	await game.call("mods.install", {path: FIXTURE});
	const second = "Second fixture addendum: this one is ordered first by the campaign's load order.";
	await game.call("mods.install", {path: await variant(game, "second", manifest => ({...manifest, id: "language-zh-second"}), {"voice-addendum.md": `${second}\n`})});
	await game.create("zh", "zh-Hans");
	await game.create("en", "en");
	const owner = await ownerLane(), first = await text("voice-addendum.md");
	await game.call("table.open", {campaign: "en"});
	const english = await game.call("voice.job", {campaign: "en", backfill: true});
	assert.equal(typeof english.job_id, "string");
	assert.equal(english.instruction, owner, "no enabled addendum: the owner's words alone");

	// The load order decides, not the ids: put the second package ahead of the first on this campaign.
	const order = (await game.call("mods.list", {campaign: "zh"})).order;
	const moved = ["language-zh-second", ...order.filter(id => id !== "language-zh-second")];
	await game.call("mods.order", {campaign: "zh", order: moved});
	await game.call("table.open", {campaign: "zh"});
	const chinese = await game.call("voice.job", {campaign: "zh", backfill: true});
	assert.equal(chinese.instruction, [owner, addendum("language-zh-second", second), addendum(ID, first)].join("\n\n"));

	// A disabled package adds nothing; the other's addendum stays.
	await game.call("mods.configure", {campaign: "zh", id: "language-zh-second", enabled: false});
	const one = await game.call("voice.job", {campaign: "zh", backfill: true});
	assert.equal(one.instruction, [owner, addendum(ID, first)].join("\n\n"));
});

test("an owner that predates voice_lane keeps its frozen instruction, addendum or not", async t => {
	const game = await kernel(t, "language-compat");
	await game.call("mods.install", {path: FIXTURE});
	await game.create("zh", "zh-Hans");
	assert.equal((await lockOf(game, "zh", ID)).enabled, true);
	await game.call("mods.configure", {campaign: "zh", id: "narration-craft", enabled: false});
	await game.call("mods.configure", {campaign: "zh", id: "npc-voice", enabled: true});
	await game.call("table.open", {campaign: "zh"});
	const job = await game.call("voice.job", {campaign: "zh", backfill: true});
	const frozen = (await readFile(join(ROOT, "content/compat/npc-voice-lane.md"), "utf8")).trim();
	assert.equal(job.instruction, frozen);
});

test("manifest validation: play_languages shape, the addendum's capability and text, and the 400-byte language ceiling", async t => {
	const game = await kernel(t, "language-manifest");
	const refused = async (name, edit, files, reason, field) => {
		const path = await variant(game, name, edit, files);
		await assert.rejects(game.call("mods.install", {path}), error => {
			assert.equal(error.code, "invalid_params", `${name}: ${error.message}`);
			assert.equal(error.details?.reason, reason, `${name}: ${error.message}`);
			if (field) assert.equal(error.details.field, field);
			assert.match(error.message, /^language-zh 1\.0\.0: /, "the refusal names the package and its version");
			assert.ok(error.fix, "the refusal says what to do");
			return true;
		});
	};
	for (const [name, value] of [["empty", []], ["string", "zh"], ["underscore", ["zh_CN"]], ["twice", ["zh", "zh"]], ["number", [7]]])
		await refused(`tags-${name}`, manifest => ({...manifest, play_languages: value}), {}, "play_languages_shape", "play_languages");
	await refused("no-capability", manifest => ({...manifest, requires: manifest.requires.filter(cap => cap !== CAPABILITY)}), {},
		"voice_lane_addendum_capability", "contributes.voice_lane_addendum");
	await refused("blank-addendum", manifest => manifest, {"voice-addendum.md": " \n"}, "voice_lane_addendum_text", "contributes.voice_lane_addendum");

	// The ceiling is UTF-8 bytes, not characters: 201 two-byte characters are 402 bytes.
	const over = "é".repeat(201);
	await refused("brief-over", manifest => manifest, {"brief.md": over}, "language_brief_over_budget", "contributes.brief");
	await assert.rejects(game.call("mods.install", {path: await variant(game, "brief-over-details", manifest => ({...manifest, id: "language-zh-over"}), {"brief.md": over})}),
		error => error.details.bytes === 402 && error.details.limit === 400 && /402 UTF-8 bytes/.test(error.message));
	// Without a brief, the full instruction is what rides every later turn, so it is what is measured.
	await refused("no-brief", manifest => ({...manifest, package_files: ["agent.md", "voice-addendum.md"], contributes: {instructions: "agent.md", voice_lane_addendum: "voice-addendum.md"}}),
		{"agent.md": "x".repeat(401)}, "language_brief_over_budget", "contributes.instructions");

	// Exactly at the ceiling installs; the same brief on a package that declares no play_languages is not measured here.
	assert.equal((await game.call("mods.install", {path: await variant(game, "at-ceiling", manifest => ({...manifest, id: "language-zh-at"}), {"brief.md": "x".repeat(400)})})).id, "language-zh-at");
	const unscoped = await variant(game, "unscoped", manifest => {const {play_languages: _, ...rest} = manifest; return {...rest, id: "unscoped-long-brief"};}, {"brief.md": "x".repeat(1200)});
	assert.equal((await game.call("mods.install", {path: unscoped})).id, "unscoped-long-brief");
});
