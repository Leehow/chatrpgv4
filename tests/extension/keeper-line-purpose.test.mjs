/**
 * Contract §143.24 (docs/specs/npc-acts-first-tickets/25-the-keepers-added-lines-pass-the-same-gate.md; the spec's
 * section 九, table B2) through the product path: the hybrid engine's table on the emitted kernel, the kernel
 * extension's explicit narrate and implicit close, the real shared decision adapter behind a controlled typed endpoint
 * (`fetch` answers the pinned Jev URL the way the typed API does), and the fixture generation port.
 *
 * Table B2, turn 9: the table's act of Arty was a silent one (keys in his pocket, a hand on the light switch, a stare),
 * and the Keeper added a line of its own -- "yesterday's word stands: bring the papers" -- the same purpose a third time.
 * §143.5/§143.14 held only the generated act to "not the same thing twice". Now the lines the Keeper wraps in a
 * person's say token are asked §143.14's purpose question against that person's rows never carried out, once per
 * delivery; a row it names refuses the delivery once, with a fix that names the row, and the next delivery goes out.
 *
 * Whether a line is the same purpose is the model's judgement, not this file's: the endpoint's answers are scripted.
 * What is under test is what the host asks, what the kernel does with the answer, and that delivery is never blocked
 * twice. No live model is called.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { createFixtureNpcActPort } from "../../runtime/jev/npc-act.ts";
import { NPC_ACT_BIND_FAMILY, SAME_QUESTION } from "../../runtime/jev/npc-act-step.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const ARTY = "阿蒂";
/** B2 T6's generated act of Arty, the row under way since turn 1 here. */
const PAPERS = "阿蒂从柜台后走出来，冲楼梯口扬了扬下巴：「楼要锁了。明天带纸来，我照单给你办。」";
/** B2 T9's generated act: no words. */
const SILENT = "阿蒂把钥匙从锁孔里拔出来揣进口袋，绕过柜台走到楼梯口，抬手按住电灯开关，回头瞪着你。";
/** B2 T9's delivery: the silent act rendered, and a line the Keeper added -- the same purpose a third time. */
const ADDED = `阿蒂从柜台后站起来，手指捏着那把钥匙，先看你伸出去的手，又看门口。{{say:${ARTY}}}「侦探执照。」{{/say}}\n\n` +
	`他绕过柜台走到楼梯口，抬手按住电灯开关，没有关，就那样按着，回头看你。{{say:${ARTY}}}「楼要锁了。昨天的话不变：带纸来，带人来，随你挑。」{{/say}}`;
/** The same turn with the added line gone: the act, and a line of a new purpose. */
const REWRITTEN = `阿蒂从柜台后站起来，手指捏着那把钥匙，先看你伸出去的手，又看门口。{{say:${ARTY}}}「侦探执照是你吃饭的家伙，押在我这儿，你明天拿什么查案？」{{/say}}\n\n` +
	"他绕过柜台走到楼梯口，抬手按住电灯开关，没有关，就那样按着，回头看你。";

// ---------------------------------------------------------------------------------------------------
// The engine's own Jev (injected): the act binds as the intention alone and is no row of his; everything else is unclear.
// ---------------------------------------------------------------------------------------------------

const choice = (value, confidence = 0.9) => ({ status: "answered", type: "choice", choice: value, confidence, probabilities: { [value]: confidence } });
const complete = (batch, answers) => ({ batchId: batch.id, status: "complete", answers, issues: [],
	coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] } });
function engineAnswer(batch) {
	const answers = {};
	for (const question of batch.questions) {
		const criteria = Object.keys(question.criteria ?? {});
		if (batch.family === NPC_ACT_BIND_FAMILY)
			answers[question.key] = choice(question.key === "way" ? "intention_only" : question.key === "same" ? "none" : criteria[0] ?? "unknown");
		else answers[question.key] = choice(question.key === "exit" ? "finish" : criteria[0] === "now" ? "later" : criteria.includes("unclear") ? "unclear"
			: criteria.includes("no") && criteria.includes("yes") ? "no" : "unknown");
	}
	return complete(batch, answers);
}

// ---------------------------------------------------------------------------------------------------
// The host's typed endpoint (the kernel extension's own adapter reaches it through `fetch`).
// ---------------------------------------------------------------------------------------------------

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}
/**
 * `purpose(speaker, question)` answers this family's questions (`same_<n>` over the speaker's rows); every other request
 * that reaches the endpoint is answered with its first issued option.
 */
function installJev(t, purpose) {
	const original = globalThis.fetch;
	const asked = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		const mine = body.state?.speakers !== undefined;
		if (mine) asked.push(body);
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria ?? {});
			const speaker = mine ? body.state.speakers[`speaker_${key.slice("same_".length)}`] : undefined;
			const { choice: chosen, confidence } = mine ? purpose(speaker, question) : { choice: keys[0], confidence: 0.99 };
			return [key, { type: "choice", choice: chosen, confidence, probabilities: distribution(keys, chosen, confidence) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 600, output_tokens: 20 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return asked;
}
/** The scripted reading: a line that asks for the papers again is the papers row; anything else is none. */
const papersAgain = (speaker, question) => {
	const row = Object.entries(question.criteria).find(([alias, value]) => alias !== "none" && String(value.intent).includes("带纸来"))?.[0];
	return speaker.act.some((line) => line.includes("带纸来")) && row ? { choice: row, confidence: 0.92 } : { choice: "none", confidence: 0.9 };
};

// ---------------------------------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------------------------------

function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: CAMPAIGN, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
/**
 * Turn 1 at the morgue: the investigator came to the Globe, Arty is the one at the counter (the table calls him 阿蒂),
 * and the table's act of him (the clerk's opener, the host's mark) asked for papers -- still under way. He said it.
 */
const papersAsked = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我去《环球报》的剪报室，想借1918年那沓旧报。" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: "newspaper-morgue" }] }],
	["table.apply", { call_id: "t1-c2", effects: [{ kind: "person", who: "Arty Wilmot", name: ARTY }] }],
	["table.apply", { call_id: "t1-c3", effects: [{ kind: "npc", name: "Arty Wilmot", intends: PAPERS, outcome: "attempted", _generated: true }] }],
	["table.narrate", { call_id: "t1-c4", text: `阿蒂从柜台后走出来。{{say:${ARTY}}}「楼要锁了。明天带纸来，我照单给你办。」{{/say}}` }],
]);
/** The same room, and Arty spoke, but nothing of his was ever set out. */
const nothingSetOut = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我去《环球报》的剪报室。" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: "newspaper-morgue" }] }],
	["table.apply", { call_id: "t1-c2", effects: [{ kind: "person", who: "Arty Wilmot", name: ARTY }] }],
	["table.narrate", { call_id: "t1-c3", text: `阿蒂抬起头。{{say:${ARTY}}}「找什么？」{{/say}}` }],
]);

const ledgerRef = (workspace, line) => Object.values(JSON.parse(readFileSync(join(workspace, ".coc/campaigns", CAMPAIGN, "npc-ledger.json"), "utf8")))
	.flatMap((entry) => entry.intents ?? []).find((row) => row.text === line)?.ref;
const turnRecord = (table, turn) => JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));
const narrateRows = (table) => table.telemetry(CAMPAIGN).filter((row) => row.tool === "narrate" && row.call_id && row.event === undefined);
const purposeRows = (table) => table.telemetry(CAMPAIGN).filter((row) => row.lane === "purpose" && row.event === "purpose_check");
const gateRows = (table) => table.telemetry(CAMPAIGN).filter((row) => row.lane === "delivery" && row.reason === "purpose_repeated");
const refusedNarrates = (table) => table.session.messages
	.filter((message) => message.role === "toolResult" && message.toolName === "narrate" && message.details?.coc_error).map((message) => message.details.coc_error);
const shownText = (table) => (table.session.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? [])
	.filter((block) => block.type === "text").map((block) => block.text).join("");
const npcActRows = (table) => table.telemetry(CAMPAIGN).filter((row) => row.lane === "run" && row.event === "npc_act");

/** The Keeper gives the papers row up (the overrule of §143.7): a function step, so it names the ref the ledger holds. */
const giveUp = (workspace) => () => fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "npc", name: "Arty Wilmot",
	intent_ref: ledgerRef(workspace.path, PAPERS), intent_outcome: "abandoned", why: "他不再提纸的事，只按着灯等人走" }] })], { stopReason: "toolUse" });
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });

async function b2Table(t, { prepareWorkspace = papersAsked, responses, purpose = papersAgain, env = {} }) {
	const asked = installJev(t, purpose);
	const npcAct = createFixtureNpcActPort({ "arty-wilmot": SILENT });
	const engine = createHybridEngine({ env: {}, npcAct, decision: { decide: async (batch) => engineAnswer(batch) } });
	const workspace = { path: "" };
	const table = await openTable({ realKernel: true, prepareWorkspace: (path) => { workspace.path = path; return prepareWorkspace(path); },
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: "1", EXT_JEV_APIKEY: "test-jev-key", ...env }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }], responses: responses(workspace) });
	t.after(() => table.dispose());
	await table.session.prompt("我推门进去，走到柜台前找阿蒂，好声好气地说：阿蒂先生，就一晚，我拿我的侦探执照押在你这儿，行不行？");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	return { table, asked, npcAct, workspace: workspace.path };
}











test("the control arm (PI_COC_PURPOSE_GATE=0): nothing is read or asked, and the added line goes out", async (t) => {
	const { table, asked } = await b2Table(t, { env: { PI_COC_PURPOSE_GATE: "0" }, responses: (ws) => [giveUp(ws), narrate(ADDED)] });
	assert.equal(asked.length, 0);
	assert.deepEqual(purposeRows(table), []);
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[true, null]]);
	assert.ok(!(turnRecord(table, 2).warnings ?? []).some((row) => row.kind === "purpose_repeated"));
});

for (const [name, draft] of [["repeated purpose", ADDED], ["new purpose", REWRITTEN]])
 test(`section 166: the first ${name} draft is delivered without a purpose review`, async (t) => {
	const {table, asked, npcAct, workspace} = await b2Table(t, {responses: () => [narrate(draft)]});
	assert.equal(asked.length, 0);
	assert.equal(npcAct.calls.length, 0, "ordinary conversation does not create an extra NPC act");
	assert.equal(gateRows(table).length, 0);
	const record = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns/0002.json"), "utf8"));
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.text, draft);
});
