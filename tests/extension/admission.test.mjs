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
	// A refusal costs the player the whole batch, so the row has to say *why* and *what*: without
	// the grounds and the proposed effects, a run cannot be read for "the reviewer misjudged plain
	// words" against "the batch carried an effect nobody chose" (2026-09-15, turn 2).
	assert.equal(rows[0].grounds, "the player only mentioned newspapers");
	assert.equal(rows[0].missing, "where and how to look at the newspapers");
	assert.ok(Array.isArray(rows[0].proposed) && rows[0].proposed.length > 0, JSON.stringify(rows[0]));
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

test('different map regions are different admission proposals',async t=>{
	const table=await openTable({responses:[
		fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'map',name:'house-map',regions:['entry'],region_labels:{entry:'门厅'},level_labels:{'Ground Floor':'一层'},label:'宅邸地图',why:'seen'}]})],{stopReason:'toolUse'}),
		fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'map',name:'house-map',regions:['cellar'],region_labels:{cellar:'地窖'},level_labels:{Basement:'地下室'},label:'宅邸地图',why:'seen later'}]})],{stopReason:'toolUse'}),
		fauxAssistantMessage([fauxToolCall('narrate',{text:'你记下了两处格局。'})],{stopReason:'toolUse'}),
		fauxAssistantMessage('after'),
	],laneResponses:{admission:[verdict({verdict:'authorized',grounds:'entry seen'}),verdict({verdict:'authorized',grounds:'cellar seen'})]}});
	t.after(()=>table.dispose());
	await table.session.prompt('我依次查看门厅和地窖');
	assert.equal(table.lanes.admission.requests().length,2);
	assert.match(table.lanes.admission.requests()[0],/regions=\["entry"\]/);
	assert.match(table.lanes.admission.requests()[1],/regions=\["cellar"\]/);
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

test("a continuation is reviewed beside the immediately preceding stranded declaration", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_INTERRUPTED_PLAYER_TEXT: "我骑车去镇里的酒馆。" },
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "last-stop" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你沿主街骑到酒馆门前。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: { admission: [verdict({ verdict: "authorized", grounds: "continue resumes the immediately preceding unfinished ride to the bar" })] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("继续？");

	const [request] = table.lanes.admission.requests();
	assert.match(request, /\[The player's exact words this turn \(turn \d+\)\]\n继续？/);
	assert.match(request, /\[Immediately preceding unfinished player declaration\]\n我骑车去镇里的酒馆。/);
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the existing semantic lane may admit the resumed action");
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


// §32.1 exempts a resolve that settles the closed option the player was just asked. The combat
// defence is no longer such an option: §11.5 "调查员守方改由 §11.5 的常驻防御偏好自动结算真实待决攻击，
// 不再 `ask` 每轮的 dodge/fight_back/none", and §11.5.1 "The combat choice buttons are retired for new
// player defenses", so a defence ask is refused as stale before it reaches the kernel. The exemption
// is exercised through the closed option it still covers: a push the player was offered and took.
test("the player's answer to an ask is not a new proposal: the resolve that settles it is not reviewed", async (t) => {
	const table = await openTable({
		responses: [
			// Turn 1: the Keeper hands the failed search back with a push offer.
			fauxAssistantMessage([fauxToolCall("ask", { kind: "mechanics", text: "抽屉里什么也没有。", options: ["push", "accept"] })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after ask"),
			// Turn 2: the player answered in their own words; the Keeper settles the push, then proposes something new.
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "再翻一遍抽屉", method: "把抽屉整个倒出来", push: true } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "combat", goal: "夺下那把刀", method: "扑上去抢", target: "看门人", weapon: "unarmed" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "抽屉底下压着一张纸。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: { admission: [verdict({ verdict: "authorized", grounds: "the player said they lunge for the knife" })] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我翻一下抽屉");
	await table.session.prompt("再翻一次，全倒出来");

	assert.equal(kernelCalls(table, "table.ask").length, 1, "the push offer reached the player");
	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 1, "only the new proposal was reviewed; the answered push was not");
	assert.match(requests[0], /goal="夺下那把刀"/);
	const model = kernelCalls(table, "table.resolve").filter((entry) => !entry.params._standing_defense);
	assert.equal(model.length, 2, "both of the Keeper's resolves reached the kernel");
	assert.equal(model[0].params.action.push, true);
	assert.deepEqual(admissionRows(table).map((row) => row.verdict), ["authorized"]);
});

test("a kernel-required authored encounter move stays inside the player's admitted attack", async (t) => {
	const attack = {
		intent: "combat",
		goal: "砸向床板上人形的头部",
		method: "双手抡长柄钢撬棍砸头",
		target: "Walter Corbitt",
		weapon: "长柄钢撬棍",
	};
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: attack })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", {
				effects: [{ kind: "move", to: "corbitt-confrontation", travel_minutes: 5 }],
			})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", {
				effects: [{ kind: "move", to: "corbitt-confrontation", via: "the chosen attack reaches the authored encounter" }],
			})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", { action: attack })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "撬棍落下。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		env: {
			FAKE_KERNEL_ERRORS: JSON.stringify({
				"table.resolve": {
					code: "needs",
					message: "Walter Corbitt has source-authored combat rules in corbitt-confrontation, not corbitt-house",
					fix: "enter the authored encounter first, then retry this same chosen attack",
					details: {
						reason: "combat_scene_required",
						target: "walter-corbitt",
						current: "corbitt-house",
						destinations: [{ scene: "corbitt-confrontation", name: "Corbitt's hidden chamber" }],
					},
				},
			}),
			FAKE_KERNEL_ERRORS_ONCE: "1",
		},
		laneResponses: {
			admission: [
				verdict({ verdict: "authorized", grounds: "the player chose this attack on Walter Corbitt" }),
				verdict({ verdict: "not_authorized", grounds: "the player did not name that scene", missing: "whether to enter the authored encounter" }),
			],
		},
	});
	t.after(() => table.dispose());
	await table.session.prompt("我抡起长柄钢撬棍砸向床板上的科比特");

	// The retried attack leaves the investigator a live pending defence (the fake kernel's caretaker
	// swings back), which §11.5.1 settles host-side: "Only a live `combat.pending_attack` whose
	// defender is an investigator permits automatic resolution … calls the existing `resolve` combat
	// defense path **once**". That third resolve is the host's, carries `_standing_defense`, and is
	// not a Keeper proposal, so it is counted apart and never reviewed.
	const resolves = kernelCalls(table, "table.resolve");
	const chosen = resolves.filter((entry) => !entry.params._standing_defense);
	assert.equal(chosen.length, 2, "the refused start and same chosen retry both reach the kernel");
	assert.deepEqual(chosen.map((entry) => entry.params.action.target), ["Walter Corbitt", "Walter Corbitt"]);
	const standing = resolves.filter((entry) => entry.params._standing_defense);
	assert.equal(standing.length, 1, "the live investigator defence is settled exactly once");
	assert.equal(standing[0].params._standing_defense.attack_command_id, chosen[1].params.call_id,
		"the standing defence answers the admitted retry, not the refused start");
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the kernel-required scene transition is not refused as a new player action");
	assert.equal(table.lanes.admission.requests().length, 2, "the external attack and an added time cost are reviewed; the exact internal move is not");
	assert.deepEqual(admissionRows(table).map((row) => [row.verb, row.verdict ?? row.skipped, row.reused ?? null]), [
		["resolve", "authorized", false],
		["apply", "not_authorized", false],
		["apply", "combat_scene_required", null],
		["resolve", "authorized", true],
	]);
});

test("a repeated outage stops promising a resend and notifies the operator once per streak", async (t) => {
	const table = await openTable({
		responses: [
			// Turn 1: two gated calls, and the lane cannot resolve its model for either.
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "翻剪报", method: "用图书馆使用查旧闻" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 30 }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "桌子暂时没法结算。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
			// Turn 2: the player resends, the outage continues.
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "翻剪报", method: "再翻一次旧闻" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "还是结算不了。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		// No provider by that name: every review fails before it starts.
		env: { PI_COC_ADMISSION_MODEL: "nobody/home" },
	});
	t.after(() => table.dispose());
	await table.session.prompt("我翻剪报");

	// The first failure of the streak reads as transient: the next input may try again.
	const [firstResolve] = toolResultTexts(table.session, "resolve");
	assert.match(firstResolve, /The player's next input can try again/);
	assert.doesNotMatch(firstResolve, /notified outside the game/);

	// The second consecutive failure is an outage: no resend promise, the operator has been told.
	const [firstApply] = toolResultTexts(table.session, "apply");
	assert.match(firstApply, /failed 2 times in a row/);
	assert.match(firstApply, /notified outside the game/);
	assert.doesNotMatch(firstApply, /next input can try again/);
	assert.equal(kernelCalls(table, "table.apply").length, 0);

	// The operator's surface fired once, out of fiction, with the cause and the fix.
	const notices = table.entries("coc-admission-status");
	assert.equal(notices.length, 1, JSON.stringify(notices));
	assert.equal(notices[0].status, "down");
	assert.equal(notices[0].streak, 2);
	assert.equal(notices[0].cause, "model_unavailable");
	assert.match(notices[0].fix, /PI_COC_ADMISSION_MODEL/);

	// A later turn in the same outage stays persistent and does not notify again.
	await table.session.prompt("我再试一次");
	const [, secondResolve] = toolResultTexts(table.session, "resolve");
	assert.match(secondResolve, /failed 3 times in a row/);
	assert.match(secondResolve, /notified outside the game/);
	assert.equal(table.entries("coc-admission-status").length, 1);
});

test("a live verdict resets the outage streak: the next failure reads as transient again", async (t) => {
	const badVerdict = () => fauxAssistantMessage(JSON.stringify({ verdict: "sure, go ahead" }));
	const moveTurn = (to, narration) => [
		fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to }] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: narration })], { stopReason: "toolUse" }),
		fauxAssistantMessage("after"),
	];
	const table = await openTable({
		responses: [
			...moveTurn("reading-room", "结算不了。"),
			...moveTurn("clip-archive", "还是结算不了。"),
			...moveTurn("stack-room", "你到了书库。"),
			...moveTurn("photo-morgue", "又结算不了了。"),
		],
		laneResponses: {
			admission: [
				badVerdict(), // turn 1: bad_output, streak 1 — transient
				badVerdict(), // turn 2: bad_output, streak 2 — persistent, notified
				verdict({ verdict: "authorized", grounds: "the player named the stacks" }), // turn 3: live verdict — reset
				badVerdict(), // turn 4: bad_output, streak 1 again — transient
			],
		},
	});
	t.after(() => table.dispose());

	await table.session.prompt("我去阅览室");
	const [first] = toolResultTexts(table.session, "apply");
	assert.match(first, /next input can try again/);

	await table.session.prompt("我去剪报库");
	const [, second] = toolResultTexts(table.session, "apply");
	assert.match(second, /notified outside the game/);
	assert.equal(table.entries("coc-admission-status").length, 1);

	await table.session.prompt("我去书库");
	assert.equal(kernelCalls(table, "table.apply").length, 1, "the live verdict admitted the third move");

	await table.session.prompt("我去照片室");
	const [, , , fourth] = toolResultTexts(table.session, "apply");
	assert.match(fourth, /next input can try again/);
	assert.doesNotMatch(fourth, /notified outside the game/);
	assert.equal(table.entries("coc-admission-status").length, 1, "the new streak has not reached two");
});
