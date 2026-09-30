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

test("B2 T9: a repeated pending purpose is checked without generating a separate routine NPC act", async (t) => {
	const { table, asked, npcAct, workspace } = await b2Table(t, { responses: (ws) => [narrate(ADDED), giveUp(ws), narrate(REWRITTEN)] });
	const papers = ledgerRef(workspace, PAPERS);
	assert.match(papers ?? "", /^intent:arty-wilmot:[0-9a-f]{12}$/, "the papers row is on Arty's ledger");
	// Ordinary conversation belongs to the Keeper; the existing pending purpose is still checked.
	assert.equal(npcAct.calls.length, 0);
	assert.deepEqual(npcActRows(table), []);

	// One batch per delivery: the first reads the added line against the papers row, by §143.14's own question.
	assert.equal(asked.length, 2, "one batch for each of the two deliveries");
	const [first] = asked;
	assert.deepEqual(Object.keys(first.questions), ["same_1"]);
	assert.equal(first.state.speakers.speaker_1.person, ARTY);
	assert.deepEqual(first.state.speakers.speaker_1.act, ["「侦探执照。」", "「楼要锁了。昨天的话不变：带纸来，带人来，随你挑。」"], "his lines, from his say tokens");
	assert.equal(first.questions.same_1.instructions.instruction, SAME_QUESTION.instructions, "the purpose question §143.14 asks of an act, word for word");
	assert.deepEqual(first.questions.same_1.criteria, { row_1: { intent: PAPERS, status: "attempted" }, none: SAME_QUESTION.none },
		"only the row never carried out; this turn's silent act is what the prose renders");
	assert.ok(!JSON.stringify(first.state).includes("按住电灯开关"), "no prose outside his lines is shown");

	// The kernel refused the first delivery, naming the row; the second went out.
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[false, "purpose_repeated"], [true, null]]);
	const [refusal] = refusedNarrates(table);
	assert.equal(refusal.code, "needs");
	assert.equal(refusal.details.reason, "purpose_repeated");
	assert.deepEqual(refusal.details.repeats.map((row) => [row.npc, row.ref, row.status, row.since_turn]), [["arty-wilmot", papers, "attempted", 1]]);
	assert.ok(refusal.message.includes(`already set out on turn 1 to "${PAPERS}" and it has no result`), refusal.message);
	assert.ok(refusal.fix.includes(`Render what ${ARTY} does this turn instead`) && refusal.fix.includes("do not have them say it again"), refusal.fix);
	assert.deepEqual(gateRows(table).map((row) => [row.ok, row.outcome]), [[false, "refused"]], "counted on the delivery lane");

	const record = turnRecord(table, 2);
	assert.equal(record.text, REWRITTEN);
	assert.equal(record.closed_by, "narrate");
	assert.equal((record.warnings ?? []).filter((row) => row.kind === "purpose_repeated").length, 0, "a clean rewrite carries no finding");
	assert.deepEqual(purposeRows(table).map((row) => [row.people, row.threads, row.hits]), [[1, 1, 1], [1, 1, 0]],
		"the given-up row is still his thread; the rewrite's line is a new purpose");
	// What the gate cost each delivery in this fixture (the kernel read, then the one batch against the stub endpoint).
	t.diagnostic(`purpose_check: ${JSON.stringify(purposeRows(table).map((row) => ({ read_ms: row.read_ms, jev_ms: row.jev_ms, jev_calls: row.jev_calls })))}`);
});

test("B2 T9, a line of a new purpose: not refused, one batch, no extra delivery", async (t) => {
	const { table, asked } = await b2Table(t, { responses: (ws) => [giveUp(ws), narrate(REWRITTEN)] });
	assert.equal(asked.length, 1, "one batch for the one delivery");
	assert.deepEqual(asked[0].questions.same_1.criteria.row_1, { intent: PAPERS, status: "abandoned" }, "given up this turn, still never carried out");
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[true, null]], "delivered the first time");
	assert.deepEqual(gateRows(table), []);
	assert.equal(turnRecord(table, 2).text, REWRITTEN);
});

test("never blocked twice: the Keeper sends the added line again after the refusal -- it goes out, with the finding for the next turn", async (t) => {
	const { table, asked } = await b2Table(t, { responses: (ws) => [narrate(ADDED), giveUp(ws), narrate(ADDED)] });
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[false, "purpose_repeated"], [true, null]]);
	assert.equal(asked.length, 2, "each delivery asked once");
	const record = turnRecord(table, 2);
	assert.equal(record.text, ADDED, "the Keeper's words, as written");
	const finding = (record.warnings ?? []).filter((row) => row.kind === "purpose_repeated");
	assert.deepEqual(finding.map((row) => [row.lane, row.ref]), [["speech", ledgerRef(table.workspace, PAPERS)]]);
	assert.ok(finding[0].fix.startsWith("Already delivered: do not rewrite it."), finding[0].fix);
	assert.deepEqual(gateRows(table).map((row) => [row.ok, row.outcome]), [[false, "refused"], [true, "delivered"]]);
});

test("an implicit close with the turn's one steer spent: the refused draft is sent again once, with the reading it already had", async (t) => {
	const look = () => fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" });
	const nothing = () => fauxAssistantMessage([{ type: "thinking", thinking: "Nothing to add." }], { stopReason: "stop" });
	// A read, then nothing to deliver: the turn-close steer is spent on this; the steered leg is prose that closes the turn.
	const { table, asked } = await b2Table(t, { responses: () => [look(), nothing(), fauxAssistantMessage(ADDED)] });
	assert.equal(customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "steer").length, 1, "the one steer went out");
	const rows = narrateRows(table);
	// Refused for the purpose, sent again (the gate spent), then refused once for the papers row's owed result and sent again.
	assert.deepEqual(rows.map((row) => [row.ok, row.reason ?? null, row.implicit ?? false]),
		[[false, "purpose_repeated", true], [false, "intent_result_owed", true], [true, null, true]]);
	const resent = table.telemetry(CAMPAIGN).filter((row) => row.lane === "delivery" && row.ok === false && typeof row.reason === "string" && row.reason.endsWith("_resent"));
	assert.deepEqual(resent.map((row) => [row.reason, row.kernel_reason]), [["purpose_repeated_resent", "purpose_repeated"], ["intent_result_owed_resent", "intent_result_owed"]]);
	assert.equal(asked.length, 1, "the same draft keeps its reading: no second batch");
	const record = turnRecord(table, 2);
	assert.equal(record.closed_how, "implicit");
	assert.equal(record.text, ADDED);
	assert.deepEqual((record.warnings ?? []).map((row) => row.kind).sort(), ["intent_result_owed", "purpose_repeated"]);
	assert.equal(shownText(table), record.rendered_text, "the player reads the delivered turn");
});

test("nobody speaking has a row never carried out: the kernel is read, no batch is asked, nothing is refused", async (t) => {
	const { table, asked } = await b2Table(t, { prepareWorkspace: nothingSetOut, responses: () => [narrate(ADDED)] });
	assert.equal(asked.length, 0, "no batch");
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[true, null]]);
	const [row] = purposeRows(table);
	assert.equal(row.people, 0, "the read found no one to ask about");
	assert.equal(typeof row.read_ms, "number");
});

test("the control arm (PI_COC_PURPOSE_GATE=0): nothing is read or asked, and the added line goes out", async (t) => {
	const { table, asked } = await b2Table(t, { env: { PI_COC_PURPOSE_GATE: "0" }, responses: (ws) => [giveUp(ws), narrate(ADDED)] });
	assert.equal(asked.length, 0);
	assert.deepEqual(purposeRows(table), []);
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[true, null]]);
	assert.ok(!(turnRecord(table, 2).warnings ?? []).some((row) => row.kind === "purpose_repeated"));
});
