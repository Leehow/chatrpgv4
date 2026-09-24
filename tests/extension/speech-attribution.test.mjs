/**
 * Contract §128.3 through the product path: the real kernel extension's delivery paths (the explicit
 * narrate handler and the implicit close after the §40.5 steer), the real shared decision adapter and
 * preparation budget, and a controlled typed endpoint behind them -- `fetch` answers the pinned Jev
 * URL the way the typed API does. The fake kernel runs the kernel's own say-token repair over what it
 * is sent (FAKE_KERNEL_SAY_PASS), so `speech[]` follows the text that actually reached it.
 *
 * The answers are scripted: who speaks is the model's judgement, not this file's. What is under test
 * is what the host does with a typed answer -- wrap, leave, or fall back -- and that the Keeper's words
 * never change.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitFor, waitForIdle } from "./harness.mjs";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const KNOTT = "史蒂文·诺特";
const PRESENT = JSON.stringify([{ name: KNOTT, voice: "干脆" }]);
const SAY_PASS = JSON.stringify({
	[KNOTT]: { npc: "steven-knott", name: KNOTT },
	"托马斯·海耶斯": { investigator: "thomas-hayes", name: "托马斯·海耶斯" },
});
const ENV = { EXT_JEV_APIKEY: "test-jev-key", FAKE_KERNEL_PRESENT: PRESENT, FAKE_KERNEL_SAY_PASS: SAY_PASS };

/** Live evidence: jev-gui-20260922, game-9456da03 turn 2, the explicit narrate that followed the steer. */
const TURN2 =
	"你把钥匙、便笺和两张十块钱一并塞进西装内袋。{{handout:the-haunting-handout-1-knott-commission}}便笺上是诺特自己的字。\n\n" +
	"史蒂文·诺特用下巴朝窗外的街一扬。「先去《环球报》。你是记者，剪报室比我这张嘴快，近年的意外、生病、寻短见，都在那儿。」" +
	"他用指节点了点桌面。「再早的产权和诉讼，去中央图书馆和档案厅。街坊和疗养院那边，等你手里有了名字再问也不迟。别在我这儿坐着。」";
const LINE1 = "「先去《环球报》。你是记者，剪报室比我这张嘴快，近年的意外、生病、寻短见，都在那儿。」";
const LINE2 = "「再早的产权和诉讼，去中央图书馆和档案厅。街坊和疗养院那边，等你手里有了名字再问也不迟。别在我这儿坐着。」";
/** Turn 1 wrapped Knott's line, which is how the table learned it writes speech in 「」 (§128.2). */
const TURN1 = `诺特抬起头。{{say:${KNOTT}}}「坐吧，海耶斯先生。」{{/say}}`;

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}

/**
 * A controlled typed endpoint. Attribution questions (`speaker_<i>`) go to `attribute(passage, state)`;
 * every other family that happens to run (the post-delivery verifier) is answered with its first
 * issued option. `failure` replaces the whole reply for attribution requests.
 */
function installJev(t, attribute, { failure } = {}) {
	const original = globalThis.fetch;
	const attribution = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		const mine = Object.keys(body.questions).some((key) => key.startsWith("speaker_"));
		if (mine) {
			attribution.push(body);
			if (failure === "throw") throw new TypeError("fetch failed");
			if (failure) return new Response("unavailable", { status: failure });
		}
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria);
			const { choice, confidence } = mine
				? attribute(body.state.passages[Number(key.slice("speaker_".length))], body.state)
				: { choice: keys[0], confidence: 0.99 };
			return [key, { type: "choice", choice, confidence, probabilities: distribution(keys, choice, confidence) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 700, output_tokens: 30 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return attribution;
}

const knott = () => ({ choice: "npc:1", confidence: 0.97 });
const narrateTexts = (table) => table.kernelRequests().filter((entry) => entry.method === "table.narrate").map((entry) => entry.params.text);
const speechRows = (table) => table.telemetry().filter((row) => row.lane === "speech" && !row.steered);
const narrateResults = (table) => table.session.messages
	.filter((message) => message.role === "toolResult" && message.toolName === "narrate").map((message) => message.details);

/** Turn 1 delivers a wrapped line; turn 2 is the live shape: a bare draft, the steer, then an explicit narrate. */
function liveTurns(text = TURN2) {
	return [
		// A successful narrate terminates its run (no follow-up provider call), so no text follows it.
		fauxAssistantMessage([fauxToolCall("narrate", { text: TURN1 })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "问先去哪儿", method: "交谈", skill: "Psychology" } })], { stopReason: "toolUse" }),
		fauxAssistantMessage("史蒂文·诺特用下巴朝窗外的街一扬，说先去报社。"),
		fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
	];
}

async function playLive(t, { env = {}, attribute = knott, failure, text } = {}) {
	const requests = installJev(t, attribute, { failure });
	const table = await openTable({ env: { ...ENV, ...env }, responses: liveTurns(text) });
	t.after(() => table.dispose());
	await table.session.prompt("我坐下");
	await waitForIdle(table.session);
	await table.session.prompt("我接下这活。先去哪儿查？");
	await waitForIdle(table.session);
	await waitFor(() => speechRows(table).length >= 2, { label: "the second delivery's speech row" });
	return { table, requests };
}

test("the live turn-2 narrate: after the steer, both of Knott's lines are attributed and wrapped, words untouched", async (t) => {
	const { table, requests } = await playLive(t);

	// The steer was the first leg, exactly as before.
	const steers = customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "speech");
	assert.equal(steers.length, 1);
	assert.equal(table.telemetry().find((row) => row.lane === "speech" && row.steered)?.reason, "no_token");

	// One batch, one question per passage; the title inside a line is part of that line, never its own passage.
	assert.equal(requests.length, 1);
	assert.deepEqual(Object.keys(requests[0].questions), ["speaker_0", "speaker_1"]);
	assert.deepEqual(requests[0].state.passages.map((row) => row.text), [LINE1, LINE2]);
	assert.ok(requests[0].state.passages[0].before.includes("史蒂文·诺特用下巴朝窗外的街一扬。"), "the sentence around it is the material");
	assert.ok(requests[0].state.passages[1].before.includes("他用指节点了点桌面。"));
	assert.deepEqual(requests[0].state.present.map((row) => row.names[0]), [KNOTT]);
	assert.deepEqual(requests[0].state.investigators.map((row) => row.names[0]), ["托马斯·海耶斯"]);
	assert.deepEqual(requests[0].state.spokenEarlier, [{ speaker: KNOTT, text: "「坐吧，海耶斯先生。」" }], "earlier speech[] of this session");
	assert.ok(!JSON.stringify(requests[0].state).includes("你把钥匙"), "no prose beyond the surrounding sentences");

	const sent = narrateTexts(table).at(-1);
	assert.equal(sent, TURN2.replace(LINE1, `{{say:${KNOTT}}}${LINE1}{{/say}}`).replace(LINE2, `{{say:${KNOTT}}}${LINE2}{{/say}}`));
	const result = narrateResults(table).at(-1);
	assert.equal(result.rendered_text, TURN2, "the player reads the Keeper's words, byte for byte");
	assert.deepEqual(result.speech.map((row) => [row.who.npc, row.text]), [["steven-knott", LINE1], ["steven-knott", LINE2]]);

	const row = speechRows(table).at(-1);
	assert.equal(row.lines, 2);
	assert.equal(row.resolved, 2);
	assert.equal(row.attributed, 2);
	assert.equal(row.not_speech, 0);
	assert.equal(row.undecided, 0);
	assert.equal(typeof row.jev_ms, "number");
	assert.equal(row.present, 1);
	// Turn 1's row carried no attribution: nothing was outside a token.
	assert.equal(speechRows(table)[0].attributed, undefined);
});

test("not_speech leaves a quoted title as written; a title nested inside a line is never asked about on its own", async (t) => {
	// The table has written speech in 「」 and 『』, so both are learned marks (§128.2).
	const turn1 = `{{say:${KNOTT}}}「坐吧。」{{/say}}{{say:${KNOTT}}}『喝茶。』{{/say}}`;
	const draft = "他桌上摊着一份『环球报』。诺特敲了敲它。「先去『环球报』的剪报室。」";
	const requests = installJev(t, (passage) => passage.text.startsWith("『") ? { choice: "not_speech", confidence: 0.95 } : knott());
	const table = await openTable({ env: ENV, responses: [
		fauxAssistantMessage([fauxToolCall("narrate", { text: turn1 })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: draft })], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我坐下");
	await waitForIdle(table.session);
	await table.session.prompt("先去哪儿？");
	await waitForIdle(table.session);
	await waitFor(() => speechRows(table).length >= 2, { label: "the second speech row" });

	assert.equal(requests.length, 1);
	assert.deepEqual(requests[0].state.passages.map((row) => row.text), ["『环球报』", "「先去『环球报』的剪报室。」"],
		"the nested 『环球报』 inside the line is the line, not a third passage");
	assert.equal(narrateTexts(table).at(-1), `他桌上摊着一份『环球报』。诺特敲了敲它。{{say:${KNOTT}}}「先去『环球报』的剪报室。」{{/say}}`);
	const row = speechRows(table).at(-1);
	assert.deepEqual([row.attributed, row.not_speech, row.undecided], [1, 1, 0]);
});

test("low confidence leaves every passage as written and says so", async (t) => {
	const { table, requests } = await playLive(t, { attribute: () => ({ choice: "npc:1", confidence: 0.55 }) });
	assert.equal(requests.length, 1);
	assert.equal(narrateTexts(table).at(-1), TURN2, "nothing wrapped, nothing changed");
	const row = speechRows(table).at(-1);
	assert.deepEqual([row.lines, row.attributed, row.not_speech, row.undecided], [0, 0, 0, 2]);
	assert.equal(row.attribute_failure, undefined, "an answer below the bar is a decision, not a failure");
});

test("someone_else is undecided: a line spoken by a person off the roster is never pinned on someone who is", async (t) => {
	const { table } = await playLive(t, { attribute: () => ({ choice: "someone_else", confidence: 0.99 }) });
	assert.equal(narrateTexts(table).at(-1), TURN2);
	const row = speechRows(table).at(-1);
	assert.deepEqual([row.attributed, row.not_speech, row.undecided], [0, 0, 2]);
});

for (const [label, failure, reason] of [
	["an unavailable endpoint", 503, "service_error"],
	["a transport that throws", "throw", "service_error"],
]) {
	test(`${label}: the delivery goes out exactly as today and the failure is on the row`, async (t) => {
		const { table, requests } = await playLive(t, { failure });
		assert.equal(requests.length, 1);
		assert.equal(narrateTexts(table).at(-1), TURN2);
		const row = speechRows(table).at(-1);
		assert.equal(row.attribute_failure, reason);
		assert.deepEqual([row.attributed, row.undecided], [0, 2]);
	});
}

test("no Jev credential: nothing is sent, the delivery is unchanged, the row says unconfigured", async (t) => {
	const { table, requests } = await playLive(t, { env: { EXT_JEV_APIKEY: undefined } });
	assert.equal(requests.length, 0);
	assert.equal(narrateTexts(table).at(-1), TURN2);
	assert.equal(speechRows(table).at(-1).attribute_failure, "unconfigured");
});

test("PI_COC_SPEECH_ATTRIBUTE=0 is the control arm: no request, no change, no attribution fields", async (t) => {
	const { table, requests } = await playLive(t, { env: { PI_COC_SPEECH_ATTRIBUTE: "0" } });
	assert.equal(requests.length, 0);
	assert.equal(narrateTexts(table).at(-1), TURN2);
	const row = speechRows(table).at(-1);
	assert.equal(row.attributed, undefined);
	assert.equal(row.jev_ms, undefined);
});

test("a person the player has not been told about is wrapped only under the table's epithet, never the book's name", async (t) => {
	const present = JSON.stringify([{ name: KNOTT, untold: { use: "Private until introduced" } }]);
	const { table } = await playLive(t, { env: { FAKE_KERNEL_PRESENT: present } });
	assert.equal(narrateTexts(table).at(-1), TURN2, "no epithet exists, so the book's name is not put in a token");
	assert.deepEqual([speechRows(table).at(-1).attributed, speechRows(table).at(-1).undecided], [0, 2]);
});

test("the steer is still the first leg: an implicit draft is steered before any attribution, and what the second leg leaves is attributed", async (t) => {
	const partial = `诺特抬起头。{{say:${KNOTT}}}「你来了。」{{/say}}他看了看表。「坐吧。」`;
	const second = `诺特抬起头。{{say:${KNOTT}}}「你来了。」{{/say}}他看了看表。「坐吧。」他把椅子推过来。`;
	const requests = installJev(t, knott);
	const table = await openTable({ env: ENV, responses: [
		fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "看表", method: "侦查", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
		fauxAssistantMessage(partial),
		fauxAssistantMessage(second),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我等他开口");
	await waitForIdle(table.session);
	await waitFor(() => speechRows(table).length >= 1, { label: "the delivery's speech row" });

	const steers = customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "speech");
	assert.equal(steers.length, 1, "the steer fired first");
	assert.equal(requests.length, 1, "one attribution batch, on the second leg only");
	assert.deepEqual(requests[0].state.passages.map((row) => row.text), ["「坐吧。」"]);
	assert.deepEqual(narrateTexts(table), [second.replace("「坐吧。」", `{{say:${KNOTT}}}「坐吧。」{{/say}}`)]);
	assert.equal(speechRows(table).at(-1).attributed, 1);
});

test("with the steer switched off, an implicit draft goes straight to attribution", async (t) => {
	const partial = `诺特抬起头。{{say:${KNOTT}}}「你来了。」{{/say}}他看了看表。「坐吧。」`;
	const requests = installJev(t, knott);
	const table = await openTable({ env: { ...ENV, PI_COC_SPEECH_STEER: "0" }, responses: [
		fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "看表", method: "侦查", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
		fauxAssistantMessage(partial),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("我等他开口");
	await waitForIdle(table.session);
	await waitFor(() => speechRows(table).length >= 1, { label: "the delivery's speech row" });

	assert.deepEqual(customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "speech"), []);
	assert.equal(requests.length, 1);
	assert.deepEqual(narrateTexts(table), [partial.replace("他看了看表。「坐吧。」", `他看了看表。{{say:${KNOTT}}}「坐吧。」{{/say}}`)]);
});

/**
 * §128.3 against the real kernel. §113 D refuses a line the Keeper wrapped when it repeats the same
 * person; a line the HOST wrapped is never refused for it. The delivery is published formatted and the
 * repeat lands as a `repeated_line` finding on the turn record's `warnings` -- the rows the verifier's
 * `unmarked_speech` lands in, which the next capsule shows the Keeper.
 */
test("real kernel: a host-attributed line that repeats the same NPC is published, and the repeat is a finding, not a refusal", async (t) => {
	const line = "「这房子的事，你得先去报社和档案厅查清楚，别在我这儿耗着。」";
	const campaign = "attribute-repeat";
	const requests = installJev(t, knott);
	const table = await openTable({ realKernel: true, campaign, env: { EXT_JEV_APIKEY: "test-jev-key" }, responses: [
		// The opening: the Keeper wraps Knott's line itself, which names him to the player and teaches 「」.
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: `诺特把钥匙推过来。{{say:Steven Knott}}${line}{{/say}}` })], { stopReason: "toolUse" }),
		// The player's turn: the same words again, outside any token, in an explicit narrate.
		fauxAssistantMessage([fauxToolCall("narrate", { text: `诺特又敲了敲桌面。${line}他没再抬头。` })], { stopReason: "toolUse" }),
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("那我先去哪儿？");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	assert.equal(requests.length, 1, "one attribution batch, for the player's turn");
	const narrateRows = table.telemetry().filter((row) => row.tool === "narrate" && row.call_id);
	assert.deepEqual(narrateRows.map((row) => row.ok), [true, true], "the attributed delivery landed first time, no refusal, no repair");
	const result = narrateResults(table).at(-1);
	assert.equal(result.rendered_text, `诺特又敲了敲桌面。${line}他没再抬头。`, "published, words untouched");
	assert.deepEqual(result.speech.map((row) => [row.who.npc, row.text]), [["steven-knott", line]]);
	assert.deepEqual(result.repeated_lines.lines.map((row) => [row.line, row.earlier_turn]), [[line, 0]]);

	const record = JSON.parse(readFileSync(join(table.workspace, `.coc/campaigns/${campaign}/turns/0001.json`), "utf8"));
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.text, `诺特又敲了敲桌面。{{say:Steven Knott}}${line}{{/say}}他没再抬头。`, "the host's wrap is what the kernel committed");
	const finding = (record.warnings ?? []).find((row) => row.kind === "repeated_line");
	assert.ok(finding, "the repeat is recorded on the delivery as a finding");
	assert.equal(finding.lane, "speech");
	assert.equal(finding.quote, line);
	assert.ok(!table.telemetry().some((row) => row.tool === "narrate" && row.ok === false), "no refused narrate");
	const row = speechRows(table).at(-1);
	assert.deepEqual([row.attributed, row.repeated], [1, 1]);
});

test("real kernel: the Keeper's own repeated line is still §113 D's, and a Keeper-supplied host_attributed is ignored", async (t) => {
	const line = "「这房子的事，你得先去报社和档案厅查清楚，别在我这儿耗着。」";
	const campaign = "keeper-repeat";
	installJev(t, knott);
	const table = await openTable({ realKernel: true, campaign, env: { EXT_JEV_APIKEY: "test-jev-key" }, responses: [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: `诺特把钥匙推过来。{{say:Steven Knott}}${line}{{/say}}` })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: `诺特又说。{{say:Steven Knott}}${line}{{/say}}`, host_attributed: [0] })], { stopReason: "toolUse" }),
		fauxAssistantMessage("诺特摆摆手，不再多说。"),
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("那我先去哪儿？");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	// Had the Keeper's `host_attributed` reached the kernel, this repeat would have been exempt and delivered.
	assert.ok(table.telemetry().some((row) => row.tool === "narrate" && row.ok === false && row.code === "needs"),
		"the Keeper's own repeat is refused as before, so the host stripped the Keeper's claim to the exemption");
});

/**
 * Live gate #4 (2026-09-24, `gate4-haunting-0214` turn 1) on the legacy engine, which shares the seam
 * (`message_end` and `takeTurnCloseSteer`), against the real kernel. The first draft carries the NPC's
 * line bare and is dropped for the §40 speech steer; the steered second leg wraps the same line the
 * NPC already said at the opening, and §113 D refuses it. The turn's one steer is spent, so before
 * §135.11's 2026-09-24 addendum both drafts were lost. Now the dropped first draft is narrated
 * instead: the host wraps its line (§128.3) and the repeat is a finding, not a refusal.
 */
test("real kernel, legacy: a steered second leg refused as a repeat falls back to the dropped draft, which is published", async (t) => {
	const line = "「这房子的事，你得先去报社和档案厅查清楚，别在我这儿耗着。」";
	const campaign = "steered-repeat";
	const bare = `诺特又敲了敲桌面。${line}他没再抬头。`;
	installJev(t, knott);
	const table = await openTable({ realKernel: true, campaign, env: { EXT_JEV_APIKEY: "test-jev-key" }, responses: [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: `诺特把钥匙推过来。{{say:Steven Knott}}${line}{{/say}}` })], { stopReason: "toolUse" }),
		// The player's turn: a read, then the line again with no token (the speech steer), then the steered leg wrapping it.
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage(bare),
		fauxAssistantMessage(`诺特又敲了敲桌面。{{say:Steven Knott}}${line}{{/say}}他没再抬头。`),
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("那我先去哪儿？");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	assert.equal(customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "speech").length, 1, "the speech steer fired once");
	const narrateRows = table.telemetry().filter((row) => row.tool === "narrate" && row.call_id);
	assert.deepEqual(narrateRows.map((row) => [row.ok, row.reason ?? null]), [[true, null], [false, "repeated_line"], [true, null]],
		"the opening, the steered leg refused by §113 D, then the dropped draft delivered");
	const drop = table.telemetry().find((row) => row.lane === "delivery" && row.reason === "steered_leg_refused");
	assert.equal(drop?.kernel_reason, "repeated_line");
	const record = JSON.parse(readFileSync(join(table.workspace, `.coc/campaigns/${campaign}/turns/0001.json`), "utf8"));
	assert.equal(record.closed_by, "narrate");
	const shown = (table.session.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? [])
		.filter((block) => block.type === "text").map((block) => block.text).join("");
	assert.equal(shown, bare, "the player reads the first draft, words untouched");
});
