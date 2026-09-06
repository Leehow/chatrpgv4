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
		assert.match(resultText(blocked), /回合已关闭，等待玩家/);
	}

	assert.equal(assistantTexts(table.session).at(-1),
		"门在你身后合上。\n\n【明骰】侦查｜掷骰：42；基础值：55；门槛：普通（≤55）；结果：通过");
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
	assert.match(String(hostMessages[0].content), /先用 look/);
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

	assert.equal(
		assistantTexts(table.session).at(-1),
		"一九二五年的波士顿，雨还没停。\n\n【明骰】侦查｜掷骰：42；基础值：55；门槛：普通（≤55）；结果：通过",
	);
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
	assert.match(resultText(results[2]), /拒了 2 次/, "第三次原样重发被扩展拦下");
	assert.match(resultText(results[2]), /action.motive 不对/, "拦下时把上次的错误再念一遍");
	assert.match(resultText(results[3]), /invalid_params/, "改了参数的那次到了内核");
	const sent = table.kernelRequests().filter((entry) => entry.method === "table.resolve");
	assert.equal(sent.length, 3, "两次原样加一次改参，第三次原样没出扩展");
	const blocked = table.telemetry().filter((row) => row.code === "blocked");
	assert.equal(blocked.length, 1);
});
