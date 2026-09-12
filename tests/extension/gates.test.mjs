/**
 * 回合闸门：narrate 之后同批次余下的调用一律拒；awaiting_player 期间拒写，
 * 但开桌那一回合的 narrate 例外（契约第 4、5、8 节）。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, waitForIdle } from "./harness.mjs";

function toolResults(session, toolName) {
	return session.messages.filter((message) => message.role === "toolResult" && message.toolName === toolName);
}

function resultText(message) {
	return (message.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

test("narrate 之后，同一批次余下的调用被拒", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[
					fauxToolCall("narrate", { text: "门在你身后合上。" }),
					fauxToolCall("look", { focus: "scene" }),
					fauxToolCall("apply", { effects: [{ kind: "time", minutes: 5 }] }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("这条应该被 rendered_text 换掉"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我关上门");

	const methods = table.kernelRequests().map((entry) => entry.method);
	assert.ok(methods.includes("table.narrate"));
	assert.ok(!methods.includes("table.look"), "narrate 之后的 look 不该到内核");
	assert.ok(!methods.includes("table.apply"), "narrate 之后的 apply 不该到内核");

	for (const name of ["look", "apply"]) {
		const [blocked] = toolResults(table.session, name);
		assert.ok(blocked, `${name} 应该有一条被拒的结果`);
		assert.equal(blocked.isError, true);
		assert.match(resultText(blocked), /the turn is closed, waiting for the player/);
	}

	assert.equal(
		assistantTexts(table.session).at(-1),
		"门在你身后合上。",
		"交付就是守秘人的正文原样（契约 §16.1）",
	);
	// 机制不进正文，只作为语言中立的投影进会话条目与总线（契约 §16.2）；
	// 这一回合一条收据都没落，所以投影是空的，也就不发条目。
	assert.deepEqual(table.entries("coc-mechanics"), []);
	assert.deepEqual(table.mechanics(), []);
});

test("开桌回合：awaiting_player 拒写，但 narrate 放行", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1" },
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: { intent: "investigate", goal: "先掷个骰", method: "用侦查看看" },
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "一九二五年的波士顿，雨还没停。" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("开场之后又多写的一段"),
		],
	});
	t.after(() => table.dispose());

	await waitForIdle(table.session);

	const hostMessages = customMessages(table.session, "coc-host");
	assert.ok(hostMessages.length >= 1, "opening_needed 时应该注入一条宿主消息");
	assert.match(String(hostMessages[0].content), /Use look to see the opening scene/);
	assert.equal(hostMessages[0].display, false);
	assert.equal(hostMessages[0].details.coc_host, true);

	const methods = table.kernelRequests().map((entry) => entry.method);
	assert.ok(!methods.includes("table.player_input"), "宿主消息不是玩家输入，不进 player_input");
	assert.ok(methods.includes("table.look"), "awaiting_player 期间读调用放行");
	assert.ok(!methods.includes("table.resolve"), "awaiting_player 期间写调用被拒");

	const [blocked] = toolResults(table.session, "resolve");
	assert.ok(blocked);
	assert.equal(blocked.isError, true);
	assert.match(resultText(blocked), /awaiting_player/);

	const narrate = table.kernelRequests().find((entry) => entry.method === "table.narrate");
	assert.ok(narrate, "开桌的 narrate 应该放行");
	assert.equal(narrate.params.call_id, "t0-c1", "开桌是第 0 回合");

	assert.equal(assistantTexts(table.session).at(-1), "一九二五年的波士顿，雨还没停。");
});


test("同名同参连发：被内核拒过两次之后第三次拦下，改了参数的照常放行", async (t) => {
	const same = { action: { intent: "social", goal: "压价", method: "摊牌", motive: { direction: "oppose" } } };
	const table = await openTable({
		env: {
			FAKE_KERNEL_ERRORS: JSON.stringify({
				"table.resolve": { code: "invalid_params", message: "action.motive 不对", fix: "direction 用 support|neutral|oppose" },
			}),
		},
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", same)], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", same)], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", same)], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", goal: "压价", method: "摊牌" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "他没有松口。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我压价");
	await waitForIdle(table.session);

	const results = toolResults(table.session, "resolve");
	assert.equal(results.length, 4);
	assert.match(resultText(results[0]), /invalid_params/);
	assert.match(resultText(results[1]), /invalid_params/);
	assert.match(resultText(results[2]), /refused these parameters 2 times/, "第三次原样重发被扩展拦下");
	assert.match(resultText(results[2]), /action.motive 不对/, "拦下时把上次的错误再念一遍");
	assert.match(resultText(results[3]), /invalid_params/, "改了参数的那次到了内核");
	const sent = table.kernelRequests().filter((entry) => entry.method === "table.resolve");
	assert.equal(sent.length, 3, "两次原样加一次改参，第三次原样没出扩展");
	const blocked = table.telemetry().filter((row) => row.code === "blocked");
	assert.equal(blocked.length, 1);
});


/**
 * A strike is an attempt, not a call (contract §34.12).
 *
 * Masks, Bar Cordano, 2026-09-12: the Keeper asked for three first impressions -- Larkin, Mendoza,
 * Elias -- in one message, and all three were refused because people on an imported book are staged
 * in the turn they are met. The three answers came back before the model had read any of them, so
 * the third one shut `resolve` for the turn; the Keeper staged all three correctly one call later
 * and could no longer roll. Three NPCs, no mechanics. One message is one attempt, whoever it names.
 */
test("一条消息里的三次同类拒绝只算一次：模型没看见回答之前不算它撞墙", async (t) => {
	const impression = (target) => fauxToolCall("resolve", { action: { intent: "social", goal: "初见印象", method: "打招呼、握手", target, decision: "natural-npc:first-impression" } });
	const table = await openTable({
		env: {
			FAKE_KERNEL_ERRORS: JSON.stringify({
				"table.resolve": { code: "not_here", message: "Larkin is not in Bar Cordano", details: { field: "target" } },
			}),
		},
		responses: [
			fauxAssistantMessage([impression("Augustus Larkin"), impression("Luis de Mendoza"), impression("Jackson Elias")], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "npc", name: "Augustus Larkin", to: "here", why: "他起身迎过来" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([impression("Augustus Larkin")], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "拉金绕过桌角。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我们走进 Bar Cordano");
	await waitForIdle(table.session);

	// The batch is one strike, so the fourth resolve -- the one after the person was staged -- still
	// reaches the kernel. Under the old accounting it was blocked and the impression was unrollable.
	const sent = table.kernelRequests().filter((entry) => entry.method === "table.resolve");
	assert.equal(sent.length, 4, "批量三次加上补救那次，四次都到了内核");
	const results = toolResults(table.session, "resolve");
	assert.equal(results.length, 4);
	for (const index of [0, 1, 2, 3]) assert.doesNotMatch(resultText(results[index]), /refused 3 times this turn/, `第 ${index + 1} 次不该被预算拦下`);
	assert.equal(table.telemetry().filter((row) => row.lane === "refusals" && row.reason === "class_limit").length, 0, "一条消息不该耗尽同类预算");
});

/**
 * The refusal budget (contract §34.12). Table F, 2026-09-11: twenty-eight refusals of two classes in one
 * turn, every retry reworded so the identical-resend guard above never fired, 300 s gone. The third refusal
 * of one class — tool, code, the field the kernel named — shuts that tool for the rest of the turn; only
 * narrate and ask remain, and the block says so.
 */
test("同类拒绝三次：第四次换了措辞也拦下，只剩 narrate 收回合", async (t) => {
	const attempt = (goal) => fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "combat", goal, method: "挥拳", target: "Steven Knott" } })], { stopReason: "toolUse" });
	const table = await openTable({
		env: {
			FAKE_KERNEL_ERRORS: JSON.stringify({
				"table.resolve": { code: "turn_state", message: "it is steven-knott's turn, not thomas-hayes's", details: { turn_of: "steven-knott" } },
			}),
		},
		responses: [
			attempt("扑上去给诺特一拳"),
			attempt("越过写字台打他"),
			attempt("趁他后退追上去打"),
			attempt("再来一拳"),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "拳头停在半空。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我冲上去揍诺特");
	await waitForIdle(table.session);

	const results = toolResults(table.session, "resolve");
	assert.equal(results.length, 4);
	for (const index of [0, 1, 2]) assert.match(resultText(results[index]), /turn_state/, `第 ${index + 1} 次到了内核，被拒`);
	assert.match(resultText(results[3]), /refused 3 times this turn for the same reason/, "第四次换了措辞照样拦下");
	assert.match(resultText(results[3]), /close the turn with narrate/, "拦下时说清只剩收回合");
	const sent = table.kernelRequests().filter((entry) => entry.method === "table.resolve");
	assert.equal(sent.length, 3, "三次到内核，第四次没出扩展");
	const narrates = table.kernelRequests().filter((entry) => entry.method === "table.narrate");
	assert.equal(narrates.length, 1, "narrate 不受预算影响");
	const rows = table.telemetry().filter((row) => row.lane === "refusals");
	assert.deepEqual(rows.map((row) => row.reason), ["class_limit"]);
	assert.equal(rows[0].tool, "resolve");
	const blocked = table.telemetry().filter((row) => row.code === "blocked" && row.reason === "refusal_budget");
	assert.equal(blocked.length, 1);
});
