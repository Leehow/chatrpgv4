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
/** A person the table has not named yet: the speech pass keeps them as a label (§40.1), and the lane edits their line too. */
const STRANGER = "穿黑袍的女人";
const LINE_L = "「快走吧。」";
const EDIT_L = "「快走啊。」";
/** An investigator line, an NPC line, a receipt marker, a label line and a second NPC line. */
const delivery = marker => `{{say:${INVESTIGATOR}}}「我接了。」{{/say}}诺特把钥匙推过来。{{say:${KNOTT}}}${LINE_A}{{/say}}`
	+ `他翻了翻抽屉。{{${marker}}}角落里有人咳了一声。{{say:${STRANGER}}}${LINE_L}{{/say}}诺特没抬头。{{say:${KNOTT}}}${LINE_B}{{/say}}`;
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

test("section 166: a committed NPC line starts no edit, no facts review and no card patch", async t => {
	const game = await deliveredTable(t);
	const before = await game.record();
	const lane = await openLane(t, game, {responses: [answer(["A different line."])]});
	lane.commit();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(lane.seen.length, 0);
	assert.equal(lane.calls("speech.job").length, 0);
	assert.equal(lane.calls("speech.edit").length, 0);
	assert.equal(lane.entries("coc-card-patch").length, 0);
	assert.deepEqual(await game.record(), before);
});
