/**
 * 一个完整玩家回合走过扩展的所有接缝：工具面、胶囊注入、call_id 铸造、交付替换。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable } from "./harness.mjs";

const SEVEN = ["apply", "ask", "look", "lookup", "narrate", "recall", "resolve"];

test("一个玩家回合：七个工具、胶囊、call_id、rendered_text 交付", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: {
							intent: "investigate",
							goal: "看清门框上的痕迹",
							method: "用侦查细看门框",
							target: "  地窖门  ",
						},
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[
					fauxToolCall("apply", {
						effects: [
							{ kind: "clue", clue: "  地窖的\t抓痕 " },
							{ kind: "move", to: " 前院 ", travel_minutes: 1 },
							{ kind: "time", minutes: 10, why: "翻遍了门厅" },
						],
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门框上有一道深深的抓痕。" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("守秘人在 narrate 之后又写的正文，应该被换掉"),
		],
	});
	t.after(() => table.dispose());

	assert.deepEqual(table.extensionErrors, [], "扩展应该无错加载");
	assert.deepEqual([...table.activeTools()].sort(), SEVEN, "session_start 之后正好这七个工具是活的");

	await table.session.prompt("我检查地窖门的门框");

	const requests = table.kernelRequests();
	const methods = requests.map((entry) => entry.method);
	assert.deepEqual(methods.slice(0, 3), ["kernel.hello", "table.open", "table.player_input"]);

	const playerInput = requests.find((entry) => entry.method === "table.player_input");
	assert.equal(playerInput.params.text, "我检查地窖门的门框");
	assert.equal(playerInput.params.campaign, "test-camp");

	const capsules = customMessages(table.session, "coc-capsule");
	assert.equal(capsules.length, 1, "回合胶囊应该作为 coc-capsule 消息注入");
	assert.equal(capsules[0].display, false);
	const capsule = JSON.parse(
		typeof capsules[0].content === "string"
			? capsules[0].content
			: capsules[0].content.map((block) => block.text).join(""),
	);
	assert.equal(capsule.where.scene, "corbitt-house");

	const resolve = requests.find((entry) => entry.method === "table.resolve");
	const apply = requests.find((entry) => entry.method === "table.apply");
	assert.equal(resolve.params.call_id, "t1-c1", "第一个会改状态的调用是 t1-c1");
	assert.equal(apply.params.call_id, "t1-c2", "第二个是 t1-c2");
	assert.equal(resolve.params.action.target, "地窖门", "实体名做过空白归一化");
	assert.equal(apply.params.effects[0].clue, "地窖的 抓痕");
	assert.equal(apply.params.effects[1].to, "前院", "kind 判别联合里的三种都过校验");
	assert.equal(apply.params.effects[2].minutes, 10);

	const look = requests.find((entry) => entry.method === "table.look");
	assert.equal(look.params.call_id, undefined, "读调用不铸 call_id");

	const narrate = requests.find((entry) => entry.method === "table.narrate");
	assert.equal(narrate.params.call_id, "t1-c3");

	const texts = assistantTexts(table.session).filter((text) => text.length > 0);
	const delivered = texts.at(-1);
	assert.equal(
		delivered,
		"门框上有一道深深的抓痕。\n\n【明骰】侦查｜掷骰：42；基础值：55；门槛：普通（≤55）；结果：通过",
		"最后一条助手消息的正文就是内核渲染的 rendered_text",
	);
	assert.ok(!texts.includes("守秘人在 narrate 之后又写的正文，应该被换掉"), "守秘人自写的收尾正文被丢掉");
	const toolCallMessages = table.session.messages.filter(
		(message) => message.role === "assistant" && (message.content ?? []).some((block) => block.type === "toolCall"),
	);
	assert.ok(toolCallMessages.length >= 3, "这一回合有带工具调用的助手消息");
	assert.ok(
		toolCallMessages.every((message) => !(message.content ?? []).some((block) => block.type === "text")),
		"带工具调用的助手消息不再带文本：过程话不进记录",
	);

	const telemetry = table.telemetry();
	// 车道（记忆、校验）也写遥测，但它们不是工具调用：按 lane 列排除（契约 §12.8）。
	const tools = telemetry.filter((row) => row.ms !== undefined && row.lane === undefined).map((row) => row.tool);
	assert.deepEqual(tools, ["table.player_input", "look", "resolve", "apply", "narrate"]);
	assert.ok(telemetry.every((row) => typeof row.turn === "number"));
});

test("ask 也关闭回合：交付的是内核渲染的问题加选项", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[
					fauxToolCall("ask", {
						prompt: "你先看哪边？",
						options: ["地窖门", "楼梯"],
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("ask 之后守秘人不该再写的正文"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我站在门厅里犹豫");

	const ask = table.kernelRequests().find((entry) => entry.method === "table.ask");
	assert.equal(ask.params.call_id, "t1-c1");
	assert.equal(assistantTexts(table.session).at(-1), "你先看哪边？\n1. 地窖门\n2. 楼梯");
});

test("守秘人写了台词却没调 narrate：宿主替它 narrate，交付仍是内核渲染的文本", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[fauxToolCall("resolve", { action: { intent: "investigate", goal: "看门框", method: "侦查", skill: "Spot Hidden" } })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("门框上有一道深深的抓痕。\n【明骰】守秘人自己写的骰行，该被剥掉\n\n你退后一步。"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我看门框");

	const narrate = table.kernelRequests().find((entry) => entry.method === "table.narrate");
	assert.ok(narrate, "宿主替守秘人调了 table.narrate");
	assert.equal(narrate.params.call_id, "t1-c2");
	assert.equal(narrate.params.text, "门框上有一道深深的抓痕。\n\n你退后一步。", "自写的骰行被剥掉后才送进内核");
	const delivered = assistantTexts(table.session).filter((text) => text.length > 0).at(-1);
	assert.ok(delivered.startsWith("门框上有一道深深的抓痕。"), "交付的是内核渲染的文本");
	assert.ok(delivered.includes("【明骰】侦查｜掷骰：42"), "内核插入的骰行在交付里");
	const implicitRows = table.telemetry().filter((row) => row.tool === "narrate" && row.implicit === true);
	assert.ok(implicitRows.length >= 1, "遥测记录了隐式 narrate");
});
