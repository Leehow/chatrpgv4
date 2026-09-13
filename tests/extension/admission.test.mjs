/**
 * Action admission (contract §32): before a `resolve` or an `apply` that settles a voluntary
 * investigator action reaches the kernel, the host puts it to an independent review of the
 * player's exact words and the player-visible context. These cases travel the product path —
 * the real extension's tools, the real lane runner, a scripted review model — and read the
 * evidence the way a real table would: what reached the fake kernel, what the Keeper was told,
 * and the telemetry rows.
 *
 * Nothing here asserts a phrase of the review prompt. The verdicts are scripted, because the
 * judgement is the model's; what is under test is what the host does with a verdict.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

const verdict = (row) => fauxAssistantMessage(JSON.stringify(row));

function toolResultTexts(session, tool) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""));
}

const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");

/** A Keeper turn that walks the investigator to the morgue and lands a clue there, then narrates. */
function newspaperTurn() {
	return [
		fauxAssistantMessage(
			[
				fauxToolCall("apply", {
					effects: [
						{ kind: "move", to: "newspaper-morgue", travel_minutes: 30 },
						{ kind: "clue", clue: "globe-unpublished-story" },
						{ kind: "time", minutes: 45 },
					],
				}),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "报纸的事，你还没说要去哪里查。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("after"),
	];
}

test("a refused batch draws no dice, moves no scene and lands no clue: nothing reaches the kernel", async (t) => {
	const table = await openTable({
		responses: newspaperTurn(),
		laneResponses: {
			admission: [verdict({ verdict: "not_authorized", grounds: "the player only mentioned newspapers", missing: "where and how to look at the newspapers" })],
		},
	});
	t.after(() => table.dispose());
	await table.session.prompt("那看看报纸");

	assert.equal(kernelCalls(table, "table.apply").length, 0, "the refused apply never reached the kernel");
	const [text] = toolResultTexts(table.session, "apply");
	assert.match(text, /^needs: The player has not chosen this action$/m);
	assert.match(text, /^fix: .*details\.missing.*/m);
	// What the fix names travels; the Keeper reads the missing choice as one line it can act on.
	assert.match(text, /^missing: "where and how to look at the newspapers"$/m);
	// The turn still closed with the narrate that followed: the player is asked, not left hanging.
	assert.equal(kernelCalls(table, "table.narrate").length, 1);

	const rows = admissionRows(table);
	assert.equal(rows.length, 1, JSON.stringify(rows));
	assert.equal(rows[0].verdict, "not_authorized");
	assert.equal(rows[0].admitted, false);
	assert.equal(rows[0].reused, false);
	assert.equal(rows[0].verb, "apply");
	assert.equal(rows[0].model, "admission/a1");
	// The tool row records the refusal under its reason, so a run can be read for false refusals.
	const refusal = table.telemetry().find((row) => row.tool === "apply" && !row.lane && row.ok === false);
	assert.equal(refusal?.reason, "action_not_authorized");
});

test("an admitted batch goes through unchanged, and the review saw the player's exact words and the visible context", async (t) => {
	const table = await openTable({
		responses: newspaperTurn(),
		laneResponses: {
			admission: [verdict({ verdict: "authorized", grounds: "the player named the Globe morgue" })],
		},
	});
	t.after(() => table.dispose());
	await table.session.prompt("我去环球报的剪报室查那栋房子的旧闻");

	const [apply] = kernelCalls(table, "table.apply");
	assert.ok(apply, "the admitted apply reached the kernel");
	assert.equal(apply.params.effects.length, 3);
	assert.equal(apply.params.call_id, "t1-c1");

	const [request] = table.lanes.admission.requests();
	assert.ok(request, "the review model was called once");
	assert.match(request, /我去环球报的剪报室查那栋房子的旧闻/);
	// The visible context: who plays, where they are as the player knows it, who is on stage.
	assert.match(request, /托马斯·海耶斯 \(记者\)/);
	assert.match(request, /科比特宅/);
	assert.match(request, /看门人/);
	// The proposal, every effect of the batch, in one place.
	assert.match(request, /apply move: to="newspaper-morgue"/);
	assert.match(request, /apply clue: clue="globe-unpublished-story"/);
	// Keeper-only material is not the player's context and does not reach the reviewer.
	assert.doesNotMatch(request, /科比特在地窖下面/);
	assert.doesNotMatch(request, /他知道地窖下面有东西/);

	const [row] = admissionRows(table);
	assert.equal(row.verdict, "authorized");
	assert.equal(row.admitted, true);
});

test("a rewording of a refused action within the turn is still refused; the same proposal reuses its verdict without a second review", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "newspaper-morgue" }] })], { stopReason: "toolUse" }),
			// The same proposal again, with a rationale bolted on: same key, same verdict, no model call.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "newspaper-morgue", why: "the player wants the papers" }] })], { stopReason: "toolUse" }),
			// A different proposal: reviewed afresh, with the earlier refusal in its context.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "central-library" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你还没说要去哪里。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: {
			admission: [
				verdict({ verdict: "not_authorized", grounds: "no destination chosen", missing: "where to go" }),
				verdict({ verdict: "not_authorized", grounds: "still no destination chosen", missing: "where to go" }),
			],
		},
	});
	t.after(() => table.dispose());
	await table.session.prompt("那看看报纸");

	assert.equal(kernelCalls(table, "table.apply").length, 0);
	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 2, "two distinct proposals were reviewed; the resend reused its verdict");
	assert.match(requests[1], /\[Already refused this turn\]\n- apply move: to="newspaper-morgue"/);
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.verdict, row.reused]), [
		["not_authorized", false],
		["not_authorized", true],
		["not_authorized", false],
	]);
});

test("a new player input is a new context: the verdict cache does not outlive the turn", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "newspaper-morgue" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "去哪里查？" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "newspaper-morgue" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你到了剪报室。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: {
			admission: [
				verdict({ verdict: "not_authorized", grounds: "no destination", missing: "where to look" }),
				verdict({ verdict: "authorized", grounds: "the player chose the morgue" }),
			],
		},
	});
	t.after(() => table.dispose());
	await table.session.prompt("那看看报纸");
	assert.equal(kernelCalls(table, "table.apply").length, 0);
	await table.session.prompt("去环球报的剪报室");
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the same proposal was re-evaluated against the new words");
	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 2);
	// The second review reads the first turn's delivery as what the player was already told.
	assert.match(requests[1], /Keeper delivered: 去哪里查？/);
	assert.match(requests[1], /player said: 那看看报纸/);
	assert.match(requests[1], /\[The player's exact words this turn \(turn 2\)\]\n去环球报的剪报室/);
});

test("an unavailable review refuses with a service status; the Keeper is not told to fill the gap with fiction", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "翻剪报", method: "用图书馆使用查旧闻" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "桌子暂时没法结算这个动作。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		// No provider by that name: the lane cannot resolve its model.
		env: { PI_COC_ADMISSION_MODEL: "nobody/home" },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我翻剪报");

	assert.equal(kernelCalls(table, "table.resolve").length, 0, "no authority, no roll");
	const [text] = toolResultTexts(table.session, "resolve");
	assert.match(text, /^needs: The action review is unavailable, so this action cannot be settled now$/m);
	assert.match(text, /as a service notice and not as fiction/);
	// What already landed this turn is not un-narrated by the refusal of this batch.
	assert.match(text, /already settled with a receipt .* did happen/);
	const [row] = admissionRows(table);
	assert.equal(row.ok, false);
	assert.equal(row.reason, "model_unavailable");
	const refusal = table.telemetry().find((row) => row.tool === "resolve" && !row.lane && row.ok === false);
	assert.equal(refusal?.reason, "admission_unavailable");
});

test("bookkeeping, NPC actors and sanity checks bypass admission while a display rename is checked against its registered scene", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "flag", name: "door-barred" }, { kind: "note", name: "the-knock", text: "owe the knock" }, { kind: "threat", name: "corbitt-awareness" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "npc", name: "看门人", to: "away" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "corbitt-house", label: "科比特老宅" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", { action: { actor: "看门人", intent: "social", goal: "把人赶走", method: "恐吓" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "看见了那东西", method: "目睹", decision: "sanity:check", san_loss: "0/1D6", involuntary: "freeze" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "看门人走了。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: { admission: [verdict({ verdict: "not_player_action", grounds: "the label presents the same registered scene" })] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我站着不动");

	assert.equal(table.lanes.admission.requests().length, 1, "only the scene label is reviewed");
	assert.match(table.lanes.admission.requests()[0], /registered_destination=.*Registered scene corbitt-house/);
	assert.equal(kernelCalls(table, "table.apply").length, 3);
	assert.equal(kernelCalls(table, "table.resolve").length, 2);
	assert.equal(admissionRows(table).length, 1);
});

test("a recovered turn is reviewed against the words the broken turn was answering", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_PENDING: "1" },
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "cellar" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你摸到墙上的开关。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: { admission: [verdict({ verdict: "authorized", grounds: "the player said they go down to the cellar" })] },
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session);

	const [request] = table.lanes.admission.requests();
	assert.ok(request, "the recovered turn's apply was reviewed");
	// The pending turn's own player text, carried over from table.open, is what the review reads.
	assert.match(request, /\[The player's exact words this turn \(turn \d+\)\]\n我下地窖/);
	assert.equal(kernelCalls(table, "table.apply").length, 1);
});

test("an uncertain verdict refuses too, naming what is unclear", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "撬开柜子", method: "用力量撬", skill: "STR" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "柜子钉死了。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: { admission: [verdict({ verdict: "uncertain", grounds: "looking at a cupboard is not prying it", missing: "whether to force the nailed cupboard open" })] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我看看那个柜子");

	assert.equal(kernelCalls(table, "table.resolve").length, 0);
	const [text] = toolResultTexts(table.session, "resolve");
	assert.match(text, /^needs: It is not clear from the player's words that they chose this action$/m);
	assert.match(text, /^missing: "whether to force the nailed cupboard open"$/m);
	assert.equal(admissionRows(table)[0].verdict, "uncertain");
});

test("a malformed verdict is no verdict: the action is refused as unavailable, never admitted by default", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 60 }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "时间没有过去。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: { admission: [fauxAssistantMessage(JSON.stringify({ verdict: "sure, go ahead" }))] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我等一会儿");

	assert.equal(kernelCalls(table, "table.apply").length, 0);
	const [row] = admissionRows(table);
	assert.equal(row.ok, false);
	assert.equal(row.reason, "bad_output");
});


test("the player's answer to an ask is not a new proposal: the resolve that settles it is not reviewed", async (t) => {
	const table = await openTable({
		responses: [
			// Turn 1: the Keeper hands the pending defence back with ask.
			fauxAssistantMessage([fauxToolCall("ask", { kind: "mechanics", options: ["dodge", "fight_back"], binds: "defense" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after ask"),
			// Turn 2: the player answered in their own words; the Keeper settles the defence, then proposes something new.
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "combat", goal: "躲开这一刀", method: "侧身闪避", defense: "dodge" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "combat", goal: "夺下那把刀", method: "扑上去抢", target: "看门人", weapon: "unarmed" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你侧身让过刀锋。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: { admission: [verdict({ verdict: "authorized", grounds: "the player said they lunge for the knife" })] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我先躲一下");
	await table.session.prompt("我往旁边一闪");

	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 1, "only the new proposal was reviewed; the answered defence was not");
	assert.match(requests[0], /goal="夺下那把刀"/);
	assert.equal(kernelCalls(table, "table.resolve").length, 2, "both resolves reached the kernel");
	assert.deepEqual(admissionRows(table).map((row) => row.verdict), ["authorized"]);
});
