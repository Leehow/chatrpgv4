/**
 * SL-51 (contract §11.5.4): a person the carried source text names is known to the run.
 *
 * SL-29A batch 5, t7 (campaign `sl29ab5-xuese-5001`): SL-47 landed the party on `esso-station`'s index page 17 and carried
 * the page; it names the three men under the canopy verbatim. The Keeper's batch placed two of them (`npc … to: here`,
 * `person who: …`) before the scene's record landed and was refused whole: `unknown_entity: no npc named '内特·帕特森' in
 * the module graph` (a near-name book NPC was a candidate, so §87 did not mint) and `'内特·帕特森' is nobody at this table`.
 *
 * - The kernel (in process; the module is published into the home's store, so a later generation can name the person): the t7 shape lands with
 *   `established: "passage"` and the page and sentence when the host's `_passage` holds the name; the same batch without
 *   it, or with a sentence that does not hold the name, is refused `unknown_entity` as before; a pin stays refused; once a
 *   later graph names the person, the next write replaces the entry once (presence and label re-keyed, the name resolving
 *   to the book's person), and a further write changes nothing.
 * - The host's lookup: the name exactly, whitespace removed on both sides (page 17 breaks a name across two lines); never
 *   a name the text does not hold, nor one shorter than two characters.
 * - The extension seam (legacy engine, faux Keeper, the emitted kernel): the host marks the effect only for a name in the
 *   turn's carried text, strips a `_passage` the model sent, and forgets the text at the next turn.
 * - The engine's report of what its note carried, and the typed reviewer's `bookText`.
 *
 * Assertions read receipts, world state, rows and refusal codes -- never prose.
 */
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { CarriedText, bookText, findPassage } from "../../extensions/kernel/carried-text.ts";
import { carriedPassages } from "../../runtime/jev/hybrid-engine.ts";
import { admissionJevBatches } from "../../runtime/jev/admission-domain.ts";

const root = resolve(import.meta.dirname, "../..");
const temporary = await mkdtemp(join(tmpdir(), "passage-person-"));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(root, "node_modules"), join(temporary, "node_modules"), "dir");
await build({ stdin: { contents: "export * from './kernel-ts/testing/api.ts'; export { ModuleStore } from './kernel-ts/modules/store.ts';", resolveDir: root, sourcefile: "passage-api.ts" },
	outfile: join(temporary, "api.mjs"), bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent" });
const api = await import(pathToFileURL(join(temporary, "api.mjs")).href);

/** Page 17 as the batch-5 table carried it (the lines as the PDF breaks them). */
const PAGE_17 = "NPC\n：白天通常有三个人会待在这里：拉斯·威廉姆\n斯，内特·帕特森和史蒂夫·布朗。一般情况下，他\n们会坐在加油站宽敞的顶棚底下抽烟喝啤酒。";
/** A name the haunting does not have, with a near-name book NPC (Ruth Blake) among its candidates, like t7's. */
const NEWCOMER = "Ruth Blakemore";
const SENTENCE = "Behind the counter stands Ruth Blakemore, the day clerk.";
const passage = (sentence = SENTENCE) => ({ scene: "newspaper-morgue", page: 17, label: null, sentence });

/** A haunting table at turn 1 (its module registered in the home's store, so a test can publish a later generation). */
async function table(t) {
	const home = await mkdtemp(join(temporary, "home-")), content = join(root, "content");
	const context = await api.createKernelContext({ workspace: home, content, seed: "passage-person", locks: api.createAdvisoryLocks(async () => {}),
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
	const runtime = api.createKernelRuntime(context);
	t.after(() => runtime.close());
	const call = (method, params = {}) => runtime.handlers[method]({ campaign: "c1", ...params });
	await call("campaign.create", { id: "c1", module: "the-haunting", pregen: "thomas-hayes", play_language: "en" });
	await call("table.open");
	await call("table.narrate", { call_id: "t0-c1", text: "Knott is waiting in his office." });
	await call("table.player_input", { text: "I go and ask at the counter." });
	let ordinal = 1;
	const directory = join(home, ".coc/campaigns/c1");
	return {
		call,
		apply: (effects) => call("table.apply", { call_id: `t1-c${ordinal++}`, effects }),
		world: async () => JSON.parse(await readFile(join(directory, "world.json"), "utf8")),
		/** A later graph generation names the person (the scene's reviewed record landed), published through the module store. */
		async publish(name) {
			const store = new api.ModuleStore(context), meta = await store.module("the-haunting"), graph = await store.readGraph("the-haunting");
			graph.nodes.push({ node_id: `npc-${name.toLowerCase().replaceAll(" ", "-")}`, node_kind: "npc", name, visibility: "keeper-only", aliases: [],
				summary: "The day clerk.", evidence_span_ids: [], properties: {}, source_refs: [] });
			await store.writeModule(await store.writeGraph(meta, graph));
		},
	};
}
const refusal = async (promise) => { try { await promise; } catch (error) { return error; } return null; };
const receipts = async (game, kind) => ((await game.call("table.status", {})).receipts ?? []).filter((receipt) => receipt.kind === kind);

test("t7's shape: a person the carried passage names is established from it, npc and person alike", async (t) => {
	const game = await table(t);
	await game.apply([
		{ kind: "npc", name: NEWCOMER, to: "here", why: "the book puts her behind the counter", _passage: passage() },
		{ kind: "person", who: NEWCOMER, name: "露丝·布莱克莫尔", why: "what the table calls her", _passage: passage() },
	]);
	const [npc] = await receipts(game, "npc"), [person] = await receipts(game, "person");
	assert.equal(npc.established, "passage", "the receipt says the person came from the book's text, not the table");
	assert.deepEqual(npc.from_passage, { scene: "newspaper-morgue", page: 17, label: null, sentence: SENTENCE });
	assert.equal(person.who, NEWCOMER, "the label is written on the same person");
	const world = await game.world();
	const entry = (world.table_people ?? []).find((row) => row.name === NEWCOMER);
	assert.deepEqual(entry?.from_passage, { scene: "newspaper-morgue", page: 17, label: null, sentence: SENTENCE }, "the record keeps page and sentence");
	assert.equal(world.npc_presence[NEWCOMER], world.active_scene, "and she is here");
	assert.equal(world.person_labels[NEWCOMER]?.name, "露丝·布莱克莫尔");
	const view = await game.call("table.look", { focus: "npc", name: NEWCOMER });
	assert.equal(view.origin?.kind, "table", "the card says she is not (yet) the book's record");
});

test("a person write alone establishes the person its passage names, and writes the label on them", async (t) => {
	const game = await table(t);
	await game.apply([{ kind: "person", who: NEWCOMER, name: "露丝·布莱克莫尔", why: "what the table calls her", _passage: passage() }]);
	const [person] = await receipts(game, "person");
	assert.equal(person.established, "passage");
	assert.equal(person.from_passage?.page, 17);
	const world = await game.world();
	assert.equal((world.table_people ?? []).find((row) => row.name === NEWCOMER)?.from_passage?.page, 17);
	assert.equal(world.person_labels[NEWCOMER]?.name, "露丝·布莱克莫尔");
});

test("a person named nowhere is still refused, npc and person alike", async (t) => {
	const game = await table(t);
	const npc = await refusal(game.apply([{ kind: "npc", name: NEWCOMER, to: "here", why: "placed" }]));
	assert.equal(npc?.code, "unknown_entity");
	assert.ok((npc.details?.candidates ?? []).length, "the near-name candidates still come back");
	const person = await refusal(game.apply([{ kind: "person", who: NEWCOMER, name: "露丝", why: "named" }]));
	assert.equal(person?.code, "unknown_entity");
	// A `_passage` whose sentence does not hold the name counts as absent.
	const elsewhere = await refusal(game.apply([{ kind: "npc", name: NEWCOMER, to: "here", why: "placed",
		_passage: passage("Behind the counter stands a clerk.") }]));
	assert.equal(elsewhere?.code, "unknown_entity");
	assert.equal(((await game.world()).table_people ?? []).length, 0, "nothing was established");
});

test("a passage vouches for a name, never for numbers: a pin stays refused", async (t) => {
	const game = await table(t);
	const pinned = await refusal(game.apply([{ kind: "npc", name: NEWCOMER, archetype: "ordinary_adult", why: "numbers", _passage: passage() }]));
	assert.equal(pinned?.code, "unknown_entity");
	assert.equal(((await game.world()).table_people ?? []).length, 0);
});

test("the record landing replaces the provisional entry by name, once", async (t) => {
	const game = await table(t);
	await game.apply([
		{ kind: "npc", name: NEWCOMER, to: "here", why: "the book puts her here", _passage: passage() },
		{ kind: "person", who: NEWCOMER, name: "露丝·布莱克莫尔", why: "what the table calls her", _passage: passage() },
	]);
	await game.publish(NEWCOMER);
	// The next write is about her under the same name; it resolves to the book's person now.
	await game.apply([{ kind: "npc", name: NEWCOMER, stance: "wary", why: "she has been asked twice" }]);
	const world = await game.world();
	const entries = (world.table_people ?? []).filter((row) => row.name === NEWCOMER);
	assert.equal(entries.length, 1, "one entry");
	assert.equal(entries[0].replaced_by, "ruth-blakemore", "replaced by the book's person");
	assert.equal(world.npc_presence["ruth-blakemore"], world.active_scene, "her presence moved to the book's handle");
	assert.equal(world.npc_presence[NEWCOMER], undefined, "and left the provisional one");
	assert.equal(world.person_labels["ruth-blakemore"]?.name, "露丝·布莱克莫尔", "the table's word for her moved too");
	const [, stance] = await receipts(game, "npc");
	assert.equal(stance.handle, "ruth-blakemore", "the write landed on the book's person");
	assert.equal(stance.established, undefined, "who is the book's, not the table's");
	const view = await game.call("table.look", { focus: "npc", name: NEWCOMER });
	assert.notEqual(view.origin?.kind, "table", "the name reads the book's record, with no ambiguity");
	// Once: a further write finds nothing to replace and changes nothing of it.
	await game.apply([{ kind: "npc", name: NEWCOMER, stance: "warm", why: "she softened" }]);
	const again = await game.world();
	assert.deepEqual((again.table_people ?? []).filter((row) => row.name === NEWCOMER), entries);
	assert.equal(again.npc_presence["ruth-blakemore"], world.active_scene);
});

test("the host's lookup is the name exactly, whitespace removed on both sides", () => {
	const carried = [{ scene: "welcome-to-abattoir", page: 17, label: null, text: PAGE_17 }];
	const nate = findPassage(carried, "内特·帕特森");
	assert.equal(nate?.page, 17);
	assert.ok(nate.sentence.includes("内特·帕特森"), "the sentence that holds the name");
	assert.ok(findPassage(carried, "拉斯·威廉姆斯"), "a name the page breaks across two lines is still the name");
	assert.equal(findPassage(carried, "内特·帕特逊"), undefined, "a near name is not the name");
	assert.equal(findPassage(carried, "拉"), undefined, "one character is never looked up");
	assert.equal(findPassage([{ scene: null, page: 3, label: null, text: "Three men: Nate\nPatterson and Steve Brown." }], "nate patterson")?.page, 3);
	// The turn's list: a new turn forgets the last one's.
	const list = new CarriedText();
	list.note("c1", 4, [{ scene: "s", page: 17, text: PAGE_17 }]);
	assert.equal(list.of("c1", 4).length, 1);
	assert.equal(list.of("c1", 5).length, 0);
	list.note("c1", 5, [{ scene: "t", page: 18, text: "Other page." }]);
	assert.deepEqual(list.of("c1", 5).map((row) => row.page), [18]);
});

test("the engine reports what its note carried: a scene_text view's pages as they went, a source view's book passages", () => {
	const views = [
		{ focus: "scene_text", name: "esso-station", view: { "page 17": PAGE_17 } },
		{ focus: "source", name: "esso-station", view: { "Page 18": { authority: "module_source", content: "Steve Brown sleeps in the cab." },
			"scene:esso-station": { entity: { name: "esso-station" } } } },
		{ focus: "npc", name: "拉塞尔·威廉姆斯", view: { name: "拉塞尔·威廉姆斯" } },
	];
	const pages = [{ scene: "esso-station", pages: [{ page: 17, text: PAGE_17 }, { page: 19, text: "a page the ceiling dropped" }] }];
	assert.deepEqual(carriedPassages(views, pages), [
		{ scene: "esso-station", page: 17, label: null, text: PAGE_17 },
		{ scene: "esso-station", page: null, label: "Page 18", text: "Steve Brown sleeps in the cab." },
	]);
});

test("the typed reviewer's state carries the carried passages as bookText, and only then", () => {
	const input = { campaign: "c1", turn: 7, tool: "apply", proposal: ["apply move to=esso-station"], playerText: "我把车开到加油机前。",
		investigators: [{ name: "雷·卡特" }], scene: "esso-station", present: [], delivered: [], landed: [], refused: [] };
	const plain = admissionJevBatches(input).batches[0].state;
	assert.equal(plain.bookText, undefined);
	const book = bookText([{ scene: "esso-station", page: 17, label: null, text: PAGE_17 }]);
	const withBook = admissionJevBatches({ ...input, bookText: book });
	assert.ok(withBook.batches[0].state.bookText?.length, "the passages ride in the state");
	assert.ok([...withBook.passages.keys()].some((alias) => alias.startsWith("book:")), "and a basis may name one");
});

/** Turn 1 walked into the morgue and closed; the player speaks next at turn 2 (the emitted kernel, through its own RPC). */
function turnOneClosed(workspace) {
	const input = [["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: "newspaper-morgue" }] }],
		["table.narrate", { call_id: "t1-c2", text: "报馆的剪报室很安静。" }]]
		.map(([method, params], index) => JSON.stringify({ id: String(index), method, params: { campaign: "test-camp", ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(root, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(root, "content")], { cwd: root, input: `${input}\n`, encoding: "utf8" });
	for (const frame of run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress))
		if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}

test("the seam: the host marks a name the turn carried, strips a model-sent _passage, and forgets at the next turn", async (t) => {
	const npc = (name, extra = {}) => ({ kind: "npc", name, to: "here", why: "the book puts them at the counter", ...extra });
	// Two names the haunting does not have, each with a near-name book NPC among its candidates (as t7's had); the page breaks
	// the first across two lines.
	const page = "The morgue is quiet.\nBehind the counter stand Ruth\nBlakemore and Kim Debrunner, sorting clippings.";
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed, responses: [
		fauxAssistantMessage([fauxToolCall("apply", { effects: [npc(NEWCOMER), { kind: "person", who: NEWCOMER, name: "露丝", why: "named" }] })], { stopReason: "toolUse" }),
		// A name the carried text does not hold, with a `_passage` the model made up: the host strips it.
		fauxAssistantMessage([fauxToolCall("apply", { effects: [npc("Walter Corbitts", { _passage: { scene: "x", page: 1, sentence: "Walter Corbitts is here." } })] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "柜台后面站着两个人。" })], { stopReason: "toolUse" }),
		// The next turn: the page was the last turn's, not this one's.
		fauxAssistantMessage([fauxToolCall("apply", { effects: [npc("Kim Debrunner")] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "他没抬头。" })], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	table.emit("coc:carried-text", { campaign: "test-camp", turn: 2, run: "r1", passages: [{ scene: "newspaper-morgue", page: 17, text: page }] });
	await table.session.prompt("我去柜台问问。");
	await waitForIdle(table.session);
	const rows = table.telemetry();
	const named = rows.filter((row) => row.lane === "people" && row.event === "passage_named");
	// Rows are appended without awaiting each other, so their order in the file is not the effects' order.
	assert.deepEqual(named.map((row) => [row.name, row.kind, row.page]).sort(), [[NEWCOMER, "npc", 17], [NEWCOMER, "person", 17]],
		"the host marks both effects about the person the page names, and nothing else");
	const applies = () => table.telemetry().filter((row) => row.tool === "apply" && !row.event && row.turn >= 2);
	assert.equal(applies()[0]?.ok, true, "the batch about the person the page names lands");
	assert.equal(applies()[1]?.ok, false, "a name the text does not hold is refused");
	assert.equal(applies()[1]?.code, "unknown_entity", "even with a _passage the model sent");
	await table.session.prompt("我再问另一个人。");
	await waitForIdle(table.session);
	assert.equal(applies()[2]?.turn, 3);
	assert.equal(applies()[2]?.ok, false, "the next turn does not read the last turn's carried text");
	assert.equal(applies()[2]?.code, "unknown_entity");
	assert.equal(table.telemetry().filter((row) => row.lane === "people").length, 2);
});

test("the typed reviewer is shown the turn's carried passages at the seam, and nothing when none were carried", async (t) => {
	const original = globalThis.fetch, requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== "https://api.typesafe.ai/v1/systemone") return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria), choice = key.startsWith("verdict_") ? "authorized" : keys.includes("none") ? "none" : keys[0];
			return [key, { type: "choice", choice, confidence: 0.97, probabilities: Object.fromEntries(keys.map((value) => [value, value === choice ? 0.97 : 0.03 / Math.max(1, keys.length - 1)])) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	const turn = () => [fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "newspaper-morgue", travel_minutes: 30 }] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "你走进了剪报室。" })], { stopReason: "toolUse" })];
	const table = await openTable({ responses: [...turn(), ...turn()], env: { PI_COC_ADMISSION_REVIEWER: "jev", EXT_JEV_APIKEY: "test-jev-key" } });
	t.after(() => table.dispose());
	table.emit("coc:carried-text", { campaign: "test-camp", turn: 1, run: "r1", passages: [{ scene: "newspaper-morgue", page: 17, text: "Ruth Blakemore sorts the clippings." }] });
	await table.session.prompt("我去环球报的剪报室");
	await waitForIdle(table.session);
	assert.equal(requests.length, 1);
	assert.deepEqual(requests[0].state.bookText?.map((row) => row.text), ["Ruth Blakemore sorts the clippings."], "the passage rides in the typed state");
	await table.session.prompt("我再去一次剪报室");
	await waitForIdle(table.session);
	assert.equal(requests.length, 2);
	assert.equal(requests[1].state.bookText, undefined, "a turn that carried nothing shows nothing");
});
