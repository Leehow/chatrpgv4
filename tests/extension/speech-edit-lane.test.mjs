/**
 * Contract §165 through the product's own pieces: the real speech-edit extension mounted in a Pi session, the real
 * kernel (`speech.job`, `speech.edit` through its handlers, the shipped zh-optimize 1.1.0 contributing the lane), the
 * real `runLane` against a faux provider, the real decision adapter against a controlled typed endpoint (`fetch`
 * answers the pinned Jev URL), and the real `patchCard` writing the session entry the backend reads.
 *
 * The lane's lines and Jev's nouls are scripted: whether a line reads like speech is the model's judgement and whether
 * a fact changed is Jev's, not this file's. What is under test is what the host does with them -- every §165.8 gate.
 */
import {strict as assert} from "node:assert";
import {mkdtempSync, rmSync} from "node:fs";
import {mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import test, {after} from "node:test";
import {build} from "esbuild";
import {fauxAssistantMessage, fauxProvider, getCurrentSystemPrompt} from "@earendil-works/pi-ai";
import {createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager} from "./pi.mjs";
import {waitFor} from "./wait.mjs";
import {keepQuotationMarks, shapeLines, spliceSpeech} from "../../extensions/speech-edit/lines.ts";
import {SPEECH_EDIT_FACT_QUESTION} from "../../runtime/jev/speech-edit-facts-domain.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const KNOTT = "Steven Knott";
const INVESTIGATOR = "托马斯·海斯";
const LINE_A = "「钥匙在这儿，地址写在租约上。」";
const LINE_B = "「马卡里奥一家搬去哪儿，我不知道。」";
const EDIT_A = "「行，钥匙在这儿，地址就写在租约上。」";
const EDIT_B = "「至于马卡里奥一家搬去哪儿，我也不知道。」";
/** An investigator line, an NPC line, a receipt marker, a label line and a second NPC line. */
const delivery = marker => `{{say:${INVESTIGATOR}}}「我接了。」{{/say}}诺特把钥匙推过来。{{say:${KNOTT}}}${LINE_A}{{/say}}`
	+ `他翻了翻抽屉。{{${marker}}}角落里有人咳了一声。{{say:穿黑袍的女人}}「快走吧。」{{/say}}诺特没抬头。{{say:${KNOTT}}}${LINE_B}{{/say}}`;
const LANE_FILE = join(ROOT, "mods/zh-optimize/speech-edit-lane.md");

const temporary = await mkdtemp(join(tmpdir(), "speech-edit-lane-"));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(ROOT, "node_modules"), join(temporary, "node_modules"), "dir");
await build({
	stdin: {contents: "export * from './kernel-ts/testing/api.ts';", resolveDir: ROOT, sourcefile: "speech-edit-lane.ts"},
	outfile: join(temporary, "kernel.mjs"), bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
});
const kernelApi = await import(pathToFileURL(join(temporary, "kernel.mjs")).href);

/** The real kernel with one zh-Hans campaign whose turn 1 delivered `delivery`: resolve first, so a receipt marker sits in it. */
async function deliveredTable(t, {language = "zh-Hans", text} = {}) {
	const home = await mkdtemp(join(tmpdir(), "speech-edit-lane-home-"));
	const context = await kernelApi.createKernelContext({
		workspace: home, content: join(ROOT, "content"), seed: "speech-edit-lane",
		locks: kernelApi.createAdvisoryLocks(async () => {}),
		env: {...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1"},
	});
	const runtime = kernelApi.createKernelRuntime(context);
	t.after(async () => {await runtime.close(); await rm(home, {recursive: true, force: true});});
	const call = (method, params = {}) => runtime.handlers[method](params);
	await call("campaign.create", {id: "zh", module: "the-haunting", pregen: "thomas-hayes", play_language: language});
	await call("table.narrate", {campaign: "zh", call_id: "t0-c1", text: "开场。\n\n诺特把钥匙拍在桌上。"});
	await call("table.player_input", {campaign: "zh", text: "我接下这活。钥匙和地址给我。"});
	const rolled = await call("table.resolve", {campaign: "zh", call_id: "t1-c1", action: {intent: "investigate", goal: "找线索", method: "翻找", skill: "Spot Hidden"}});
	const marker = rolled.markers[0];
	const narrated = await call("table.narrate", {campaign: "zh", call_id: "t1-c2", text: text ?? delivery(marker)});
	const recordPath = join(home, ".coc/campaigns/zh/turns/0001.json");
	return {home, call, marker, narrated, recordPath, record: async () => JSON.parse(await readFile(recordPath, "utf8"))};
}

/** A controlled typed endpoint: each fact question is answered by `noul(line)`, or the whole reply by `failure`. */
function installJev(t, noul = () => 0.05, {failure} = {}) {
	const original = globalThis.fetch, requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		if (failure) return new Response("unavailable", {status: failure});
		const answers = Object.fromEntries(Object.keys(body.questions).map((key, position) =>
			[key, {type: "noul", noul: noul(body.state.lines[position], position)}]));
		return new Response(JSON.stringify({model: "jev-1.13.0", answers, usage: {input_tokens: 400, output_tokens: 8}}), {status: 200});
	};
	t.after(() => {globalThis.fetch = original;});
	return requests;
}

/** The lane mounted the way Pi mounts it, its own faux model `edit/e1`, and the real kernel as its bridge. */
async function openLane(t, game, {responses = [], env = {}, intercept} = {}) {
	const workspace = mkdtempSync(join(tmpdir(), "speech-edit-session-"));
	const values = {PI_COC_MODE: "play", PI_COC_HOME: workspace, PI_OFFLINE: "1", PI_COC_SPEECH_EDIT_MODEL: "edit/e1",
		EXT_JEV_APIKEY: "test-jev-key", TYPESAFE_API_KEY: undefined, PIPIUI_SPAWN_CONTRACT: undefined, PIPIUI_HOST_PROTOCOL: undefined,
		PIPIUI_EXT_SETTINGS_JEV: undefined, ...env};
	const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	let session;
	t.after(async () => {
		if (session) {
			await session._extensionRunner.emit({type: "session_shutdown", reason: "quit"});
			session.dispose();
		}
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(workspace, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
	});
	const edit = fauxProvider({api: "openai-completions", provider: "edit", models: [{id: "e1"}]});
	const seen = [];
	edit.setResponses(responses.map(response => context => {seen.push(context); return typeof response === "function" ? response(context) : response;}));
	const modelRuntime = await ModelRuntime.create({authPath: join(workspace, "auth.json"), modelsPath: null,
		modelsStorePath: join(workspace, "models-store.json"), refreshOnCreate: false});
	modelRuntime.registerNativeProvider(edit.provider);
	const settingsManager = SettingsManager.inMemory({compaction: {enabled: false}, retry: {enabled: false}});
	const sessionManager = SessionManager.inMemory();
	let api;
	const resourceLoader = new DefaultResourceLoader({cwd: workspace, agentDir: join(workspace, "agent"), settingsManager, noContextFiles: true,
		additionalExtensionPaths: [join(ROOT, "extensions/speech-edit")],
		extensionFactories: [{name: "probe", factory: pi => {api = pi;}}]});
	await resourceLoader.reload();
	const created = await createAgentSession({cwd: workspace, agentDir: join(workspace, "agent"), model: edit.getModel(), modelRuntime,
		thinkingLevel: "off", noTools: "all", resourceLoader, settingsManager, sessionManager});
	session = created.session;
	assert.deepEqual(created.extensionsResult.errors, []);
	const requests = [], errors = [];
	const call = async (method, params) => {
		requests.push({method, params});
		if (intercept) await intercept(method, params);
		return game.call(method, params);
	};
	api.events.emit("coc:kernel-bridge", {campaign: "zh", call});
	await session.bindExtensions({mode: "print", onError: error => errors.push(error)});
	t.after(() => assert.deepEqual(errors, [], "Pi must not swallow an extension lifecycle error"));
	const entries = type => sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === type).map(entry => entry.data);
	const rows = () => entries("coc-telemetry").filter(row => row.lane === "speech-edit" && row.outcome !== undefined);
	return {
		seen, edit, entries, rows,
		calls: method => requests.filter(row => row.method === method),
		commit: (payload = {}) => api.events.emit("coc:turn-committed", {campaign: "zh", turn: 1,
			rendered_text: game.narrated.rendered_text, speech: game.narrated.speech, ...payload}),
		finished: async (count = 1) => {await waitFor(() => rows().length >= count, {label: `speech-edit row ${count}`}); return rows().at(-1);},
	};
}
const answer = lines => fauxAssistantMessage(JSON.stringify({lines}));
const inputOf = context => context.messages.filter(message => message.role !== "system").flatMap(message => message.content).map(block => block.text ?? "").join("\n");

test("an edit lands as the overlay and one card patch: only the edited span bodies change, markers and receipts intact", async t => {
	const game = await deliveredTable(t);
	const before = await game.record(), jev = installJev(t);
	const lane = await openLane(t, game, {responses: [answer([EDIT_A, EDIT_B])]});
	lane.commit();
	const row = await lane.finished();

	// §165.3: the v2 prompt -- the package's words, the player's text, the prose and the NPC lines only.
	const [context] = lane.seen;
	const system = getCurrentSystemPrompt(context.messages);
	assert.ok(system.startsWith((await readFile(LANE_FILE, "utf8")).trim()), "the package's instruction and demonstrations, whole");
	assert.match(system, /exactly as many lines as given, in the same order/);
	const input = inputOf(context);
	assert.ok(input.includes("[Player this turn]\n我接下这活。钥匙和地址给我。"));
	assert.ok(input.includes(`[Turn prose]\n${before.rendered_text}`));
	assert.ok(input.endsWith(`[Spoken lines to edit]\n1. speaker: ${KNOTT}\n   line: ${LINE_A}\n2. speaker: ${KNOTT}\n   line: ${LINE_B}`),
		"investigator and label rows are not sent");

	// §165.4 gate 3: one fanned-out request, a Noul per changed line over the two versions.
	assert.equal(jev.length, 1);
	assert.equal(jev[0].model, "jev-1.13.0");
	assert.deepEqual(Object.values(jev[0].questions).map(question => question.type), ["noul", "noul"]);
	// The contract's question (§165.4 gate 3, amended 2026-10-01), asked of each line on its own.
	assert.deepEqual(Object.values(jev[0].questions).map(question => [question.instructions.instruction.includes(SPEECH_EDIT_FACT_QUESTION), question.instructions.target]),
		[[true, "lines[0]"], [true, "lines[1]"]]);
	assert.deepEqual(jev[0].state.lines, [{original: LINE_A, edited: EDIT_A}, {original: LINE_B, edited: EDIT_B}]);

	// §165.5.1: the kernel keeps the delivery and holds the edit beside it.
	assert.deepEqual(lane.calls("speech.edit").map(row => row.params.lines), [[{index: 1, original: LINE_A, edited: EDIT_A}, {index: 3, original: LINE_B, edited: EDIT_B}]]);
	const after = await game.record();
	for (const key of ["text", "rendered_text", "marked_text", "speech"]) assert.deepEqual(after[key], before[key], key);
	assert.deepEqual(after.speech_edit.lines.map(line => line.edited), [EDIT_A, EDIT_B]);
	assert.equal(after.speech_edit.model, "edit/e1");

	// §165.5.2: one patch of that turn's card. Only the two bodies change; the receipt marker, the other spans and every
	// byte between them are as delivered, and the card still has one span per speech row.
	const patches = lane.entries("coc-card-patch");
	assert.equal(patches.length, 1);
	assert.deepEqual(patches[0].card, {turn: 1});
	assert.equal(patches[0].source, "speech-edit");
	const expected = before.marked_text.replace(LINE_A, EDIT_A).replace(LINE_B, EDIT_B);
	assert.equal(patches[0].patch.marked_text, expected);
	assert.ok(patches[0].patch.marked_text.includes(`{{${game.marker}}}`), "the receipt marker stays where it was");
	const spans = text => (text.match(/\{\{say:[^}\n]*\}\}/g) ?? []).length;
	assert.equal(spans(patches[0].patch.marked_text), spans(before.marked_text));
	assert.equal(spans(before.marked_text), before.speech.length);
	assert.deepEqual(patches[0].patch.speech, before.speech.map((line, index) => index === 1 ? {...line, text: EDIT_A} : index === 3 ? {...line, text: EDIT_B} : line));
	assert.deepEqual(patches[0].patch.speech_original, {marked_text: before.marked_text});

	// §165.7: one row for the run.
	assert.equal(row.outcome, "applied");
	assert.equal(row.ok, true);
	assert.equal(row.turn, 1);
	assert.equal(row.lines, 2);
	assert.equal(row.changed, 2);
	assert.equal(row.model, "edit/e1");
	assert.equal(typeof row.wall_ms, "number");
	assert.deepEqual(row.verdicts, [{index: 1, noul: 0.05, verdict: "edited"}, {index: 3, noul: 0.05, verdict: "edited"}]);
	assert.equal(lane.rows().length, 1, "one run, one row");
	// §165.3: one zero-tool round at effort low, on the lane's own model variable.
	const start = lane.entries("coc-telemetry").filter(entry => entry.lane === "lane-call" && entry.phase === "start");
	assert.deepEqual(start.map(entry => [entry.subsession, entry.model, entry.lane_thinking, entry.thinking_source]), [["speech-edit", "edit/e1", "low", "caller"]]);
});

test("a count mismatch or marker syntax drops the whole edit before Jev or the kernel hears of it", async t => {
	for (const [label, lines] of [["count", [EDIT_A]], ["marker", [EDIT_A, `「至于{{say:x}}马卡里奥一家，我也不知道。」`]], ["blank", [EDIT_A, "  "]]]) {
		const game = await deliveredTable(t), jev = installJev(t);
		const lane = await openLane(t, game, {responses: [answer(lines)]});
		lane.commit();
		const row = await lane.finished();
		assert.equal(row.outcome, "dropped:shape", label);
		assert.equal(row.ok, false, label);
		assert.equal(jev.length, 0, `${label}: no Jev question`);
		assert.equal(lane.calls("speech.edit").length, 0, `${label}: nothing landed`);
		assert.deepEqual(lane.entries("coc-card-patch"), [], `${label}: no patch`);
		assert.equal((await game.record()).speech_edit, undefined, label);
	}
});

test("a quotation-mark failure keeps that line's original; retyped marks come back as the delivered ones", async t => {
	const game = await deliveredTable(t), jev = installJev(t);
	// Line A lost its closing mark; line B came back in curly quotes, which §139 counts as the same marks.
	const lane = await openLane(t, game, {responses: [answer(["「行，钥匙在这儿，地址就写在租约上。", "“至于马卡里奥一家搬去哪儿，我也不知道。”"])]});
	lane.commit();
	const row = await lane.finished();
	assert.equal(row.outcome, "applied");
	assert.deepEqual(row.quote_reverted, [1]);
	assert.deepEqual(jev[0].state.lines, [{original: LINE_B, edited: EDIT_B}], "only the line that passed is asked about, in its own marks");
	assert.deepEqual(lane.calls("speech.edit")[0].params.lines, [{index: 3, original: LINE_B, edited: EDIT_B}]);
	const [patch] = lane.entries("coc-card-patch");
	assert.ok(patch.patch.marked_text.includes(LINE_A), "line A is as the Keeper wrote it");
	assert.ok(patch.patch.marked_text.includes(EDIT_B));
	// Every changed line failing the marks is a dropped edit, not an empty patch.
	const second = await deliveredTable(t), jev2 = installJev(t);
	const quoted = await openLane(t, second, {responses: [answer(["行，钥匙在这儿。", "至于他们，我也不知道。"])]});
	quoted.commit();
	assert.equal((await quoted.finished()).outcome, "dropped:quotes");
	assert.equal(jev2.length, 0);
	assert.deepEqual(quoted.entries("coc-card-patch"), []);
});

test("a noul at or above 0.5 keeps that line's original; an unchanged line is never asked", async t => {
	const game = await deliveredTable(t);
	// Line A changed and Jev reads a changed fact at exactly the gate; line B came back unchanged.
	const jev = installJev(t, () => 0.5);
	const lane = await openLane(t, game, {responses: [answer([EDIT_A, LINE_B])]});
	lane.commit();
	const row = await lane.finished();
	assert.deepEqual(jev[0].state.lines, [{original: LINE_A, edited: EDIT_A}], "line B is not asked about");
	assert.equal(row.outcome, "nothing_changed");
	assert.deepEqual(row.verdicts, [{index: 1, noul: 0.5, verdict: "kept_original"}]);
	assert.equal(lane.calls("speech.edit").length, 0);
	assert.deepEqual(lane.entries("coc-card-patch"), []);
	// One line over the gate, one under: only the one under lands.
	const second = await deliveredTable(t);
	installJev(t, line => line.original === LINE_A ? 0.8 : 0.1);
	const mixed = await openLane(t, second, {responses: [answer([EDIT_A, EDIT_B])]});
	mixed.commit();
	const landed = await mixed.finished();
	assert.equal(landed.outcome, "applied");
	assert.equal(landed.changed, 1);
	assert.deepEqual(mixed.calls("speech.edit")[0].params.lines.map(line => line.index), [3]);
	const [patch] = mixed.entries("coc-card-patch");
	assert.ok(patch.patch.marked_text.includes(LINE_A) && patch.patch.marked_text.includes(EDIT_B));
});

test("Jev unavailable drops the whole edit, and with no key the model is never asked", async t => {
	const game = await deliveredTable(t);
	installJev(t, undefined, {failure: 503});
	const lane = await openLane(t, game, {responses: [answer([EDIT_A, EDIT_B])]});
	lane.commit();
	const row = await lane.finished();
	assert.equal(row.outcome, "dropped:jev_unavailable");
	assert.equal(row.ok, false);
	assert.equal(lane.calls("speech.edit").length, 0);
	assert.deepEqual(lane.entries("coc-card-patch"), []);
	assert.equal((await game.record()).speech_edit, undefined);

	const second = await deliveredTable(t), jev = installJev(t);
	const keyless = await openLane(t, second, {responses: [answer([EDIT_A, EDIT_B])], env: {EXT_JEV_APIKEY: undefined}});
	keyless.commit();
	assert.equal((await keyless.finished()).outcome, "dropped:jev_unavailable");
	assert.equal(keyless.seen.length, 0, "no gate, no edit, so no model call is spent on one");
	assert.equal(jev.length, 0);
});

test("a record that changed under the lane is stale: no overlay, no patch", async t => {
	const game = await deliveredTable(t);
	installJev(t);
	// Between the lane's read and its landing the turn is replaced: the line at index 3 is not the one it edited.
	const lane = await openLane(t, game, {responses: [answer([EDIT_A, EDIT_B])], intercept: async method => {
		if (method !== "speech.edit") return;
		const record = JSON.parse(await readFile(game.recordPath, "utf8"));
		record.speech[3].text = "「我什么都不知道。」";
		await writeFile(game.recordPath, JSON.stringify(record));
	}});
	lane.commit();
	const row = await lane.finished();
	assert.equal(row.outcome, "dropped:stale");
	assert.equal((await game.record()).speech_edit, undefined);
	assert.deepEqual(lane.entries("coc-card-patch"), []);
});

test("without exactly one enabled contributing package the lane does not run", async t => {
	// zh-optimize switched off: nobody contributes, so no model call, no row, no patch.
	const game = await deliveredTable(t);
	await game.call("mods.configure", {campaign: "zh", id: "zh-optimize", enabled: false});
	const lane = await openLane(t, game, {responses: [answer([EDIT_A, EDIT_B])]});
	lane.commit();
	await waitFor(() => lane.calls("speech.job").length === 1, {label: "speech.job"});
	await new Promise(settle => setTimeout(settle, 100));
	assert.equal(lane.seen.length, 0);
	assert.deepEqual(lane.rows(), []);
	assert.deepEqual(lane.entries("coc-card-patch"), []);
	// A second contributor: the lane does not run, and the row names both.
	const second = await deliveredTable(t);
	const variant = join(await mkdtemp(join(tmpdir(), "speech-edit-variant-")), "zh-speech-second");
	t.after(() => rm(resolve(variant, ".."), {recursive: true, force: true}));
	const {cp} = await import("node:fs/promises");
	await cp(join(ROOT, "mods/zh-optimize"), variant, {recursive: true});
	const manifest = JSON.parse(await readFile(join(variant, "mod.json"), "utf8"));
	await writeFile(join(variant, "mod.json"), JSON.stringify({...manifest, id: "zh-speech-second", version: "1.0.0", default_enabled: false}));
	await second.call("mods.install", {path: variant});
	await second.call("mods.configure", {campaign: "zh", id: "zh-speech-second", version: "1.0.0", enabled: true});
	const conflicted = await openLane(t, second, {responses: [answer([EDIT_A, EDIT_B])]});
	conflicted.commit();
	const row = await conflicted.finished();
	assert.equal(row.outcome, "dropped:conflict");
	assert.equal(row.ok, false);
	assert.deepEqual(row.contributors.map(entry => entry.mod).sort(), ["zh-optimize", "zh-speech-second"]);
	assert.equal(conflicted.seen.length, 0);
	assert.deepEqual(conflicted.entries("coc-card-patch"), []);
});

test("the trigger reads the bus payload: a delivery with no NPC line is never queued", async t => {
	const game = await deliveredTable(t);
	const lane = await openLane(t, game, {responses: [answer([EDIT_A, EDIT_B])]});
	lane.commit({speech: game.narrated.speech.filter(line => !line.who.npc)});
	lane.commit({speech: undefined});
	await new Promise(settle => setTimeout(settle, 100));
	assert.equal(lane.calls("speech.job").length, 0);
});

test("the known boundary: an ask delivery is not edited", async t => {
	const home = await mkdtemp(join(tmpdir(), "speech-edit-ask-"));
	const context = await kernelApi.createKernelContext({workspace: home, content: join(ROOT, "content"), seed: "speech-edit-ask",
		locks: kernelApi.createAdvisoryLocks(async () => {}), env: {...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1"}});
	const runtime = kernelApi.createKernelRuntime(context);
	t.after(async () => {await runtime.close(); await rm(home, {recursive: true, force: true});});
	const call = (method, params = {}) => runtime.handlers[method](params);
	await call("campaign.create", {id: "zh", module: "the-haunting", pregen: "thomas-hayes", play_language: "zh-Hans"});
	await call("table.narrate", {campaign: "zh", call_id: "t0-c1", text: "开场。\n\n诺特把钥匙拍在桌上。"});
	await call("table.player_input", {campaign: "zh", text: "钥匙和地址给我。"});
	const asked = await call("table.ask", {campaign: "zh", call_id: "t1-c1", prompt: "接不接？", options: ["接", "不接"], text: `{{say:${KNOTT}}}${LINE_A}{{/say}}`});
	installJev(t);
	// Even a commit event for that turn (the host emits none for an ask) finds nothing to edit.
	const lane = await openLane(t, {call, narrated: asked}, {responses: [answer([EDIT_A])]});
	lane.commit();
	const row = await lane.finished();
	assert.equal(row.outcome, "dropped:stale");
	assert.equal(lane.seen.length, 0);
	assert.deepEqual(lane.entries("coc-card-patch"), []);
});

test("splicing pairs spans with rows by order and keeps every byte outside the edited bodies", () => {
	const speech = [{who: {investigator: "inv", name: "I"}, text: "「我接了。」"}, {who: {npc: "k", name: "K"}, text: "「好。」"}, {who: {label: "L"}, text: "「走。」"}];
	const marked = "{{say:I}}「我接了。」{{/say}}他说。{{say:K}} 「好。」\n{{/say}}{{check:spot-hidden}}{{say:L}}「走。」{{/say}}";
	const spliced = spliceSpeech(marked, speech, new Map([[1, "「好吧。」"]]));
	assert.equal(spliced.marked_text, "{{say:I}}「我接了。」{{/say}}他说。{{say:K}} 「好吧。」\n{{/say}}{{check:spot-hidden}}{{say:L}}「走。」{{/say}}");
	assert.deepEqual(spliced.speech.map(row => row.text), ["「我接了。」", "「好吧。」", "「走。」"]);
	// A card whose spans do not pair with its rows is not addressed at all.
	assert.equal(spliceSpeech(marked, speech.slice(0, 2), new Map([[1, "「好吧。」"]])), undefined);
	assert.equal(spliceSpeech(marked.replace("「好。」", "「不好。」"), speech, new Map([[1, "「好吧。」"]])), undefined);
	assert.equal(spliceSpeech(marked, speech, new Map([[5, "「好吧。」"]])), undefined);
});

test("the shape and quotation-mark gates are structural", () => {
	assert.deepEqual(shapeLines({lines: [" 「好。」 ", "「走。」"]}, 2), {ok: true, lines: ["「好。」", "「走。」"]});
	assert.equal(shapeLines({lines: ["「好。」"]}, 2).ok, false);
	assert.equal(shapeLines({lines: ["「好。}}」", "「走。」"]}, 2).ok, false);
	assert.equal(shapeLines({lines: ["「好。」", 3]}, 2).ok, false);
	assert.equal(shapeLines(["「好。」"], 1).ok, false);
	assert.equal(keepQuotationMarks("「好。」", "\"好吧。\""), "「好吧。」");
	assert.equal(keepQuotationMarks("「他说『好』。」", "「他说『好』吧。」"), "「他说『好』吧。」", "inner marks are words, not the frame");
	assert.equal(keepQuotationMarks("「好。」", "「好吧。"), undefined);
	assert.equal(keepQuotationMarks("好。", "「好吧。」"), undefined);
	assert.equal(keepQuotationMarks("好。", "嗯，好吧。"), "嗯，好吧。");
});
