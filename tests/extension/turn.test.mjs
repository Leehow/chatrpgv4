/**
 * 一个完整玩家回合走过扩展的所有接缝：工具面、胶囊注入、call_id 铸造、交付替换。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, waitForIdle } from "./harness.mjs";

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
	// 记忆车道的缺省派发（补抽，#20）也搭在这条连接上，开桌之后会来一次；
	// 这个用例看的是回合那条线，所以把车道的调用滤掉。
	const methods = requests.map((entry) => entry.method).filter((method) => !method.startsWith("memory."));
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
		"门框上有一道深深的抓痕。",
		"最后一条助手消息的正文就是守秘人写的那段，一字不改（契约 §16.1）",
	);
	// 机制是语言中立的 JSON 投影，只走会话条目与总线，不进正文（契约 §16.2）。
	const [projected] = table.entries("coc-mechanics");
	assert.equal(projected.turn, 1);
	assert.deepEqual(
		projected.mechanics.map((row) => row.kind),
		["roll", "clue", "scene", "time"],
		"本回合每条收据都在投影里，按发生顺序",
	);
	assert.deepEqual(
		projected.mechanics[0],
		{
			kind: "roll",
			actor: "托马斯·海耶斯",
			skill: "Spot Hidden",
			roll: 42,
			target: 55,
			threshold: 55,
			difficulty: "regular",
			level: "regular",
			passed: true,
			visibility: "public",
		},
		"明骰那条原样从内核过来，扩展不改写",
	);
	assert.deepEqual(table.mechanics().at(-1), { campaign: "test-camp", turn: 1, mechanics: projected.mechanics },
		"同一份投影也发上总线 coc:mechanics");
	// 桌况扩展从投影画一行紧凑的状态行，用的是语言中立的英文词；正文一个字都不动。
	const painted = table.ui.statuses.filter((entry) => entry.key === "coc-mechanics");
	assert.deepEqual(
		painted.map((entry) => entry.text),
		["t1  roll 42/55 pass  clue 地窖的 抓痕  move -> 前院  +10m"],
		"一回合画一行，机制词是英文，名字是数据",
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

test("守秘人写了台词却没调 narrate：宿主替它 narrate，正文原样送进内核", async (t) => {
	const prose = "门框上有一道深深的抓痕：侦查 42／55，通过。\n\n你退后一步。";
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[fauxToolCall("resolve", { action: { intent: "investigate", goal: "看门框", method: "侦查", skill: "Spot Hidden" } })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(prose),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我看门框");

	const narrate = table.kernelRequests().find((entry) => entry.method === "table.narrate");
	assert.ok(narrate, "宿主替守秘人调了 table.narrate");
	assert.equal(narrate.params.call_id, "t1-c2");
	assert.equal(narrate.params.text, prose, "正文一字不改地送进内核：宿主不再剥任何行（契约 §8）");
	const delivered = assistantTexts(table.session).filter((text) => text.length > 0).at(-1);
	assert.equal(delivered, prose, "交付就是守秘人的正文");
	const [projected] = table.entries("coc-mechanics");
	assert.deepEqual(projected.mechanics.map((row) => row.kind), ["roll"], "隐式 narrate 也带机制投影");
	const implicitRows = table.telemetry().filter((row) => row.tool === "narrate" && row.implicit === true);
	assert.ok(implicitRows.length >= 1, "遥测记录了隐式 narrate");
});

test("隐式 narrate 缺数字：内核退回 mechanics_missing，宿主拿它的 fix 催一次，下一轮才关回合", async (t) => {
	const missing = "门框上有一道深深的抓痕。";
	const complete = "门框上有一道深深的抓痕：侦查掷出 42，对着 55 的目标值，通过。";
	const table = await openTable({
		// 契约 §5 第 2 步的机制核对：本回合公开收据的数字必须出现在正文里。
		env: { FAKE_KERNEL_REQUIRE_NUMBERS: "1" },
		responses: [
			fauxAssistantMessage(
				[fauxToolCall("resolve", { action: { intent: "investigate", goal: "看门框", method: "侦查", skill: "Spot Hidden" } })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(missing),
			fauxAssistantMessage(complete),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我看门框");
	await waitForIdle(table.session);

	const narrates = table.kernelRequests().filter((entry) => entry.method === "table.narrate");
	assert.deepEqual(narrates.map((entry) => entry.params.text), [missing, complete], "第一次被退回，第二次才过");

	const steers = customMessages(table.session, "coc-host").filter(
		(message) => message.details?.kind === "mechanics-missing",
	);
	assert.equal(steers.length, 1, "缺数字只催一次");
	assert.match(String(steers[0].content), /mechanics_missing/);
	assert.match(String(steers[0].content), /42, 55/, "催的话里带着内核自己的 fix，点名缺哪些数");

	const refused = table.telemetry().filter((row) => row.tool === "narrate" && row.ok === false);
	assert.equal(refused.length, 1);
	assert.equal(refused[0].code_detail, "mechanics_missing");

	const texts = assistantTexts(table.session).filter((text) => text.length > 0);
	assert.equal(texts.at(-1), complete, "交付的是补齐数字之后那一版");
	assert.ok(!texts.includes(missing), "被内核退回的那一版不算交付，不留在记录里");
	const projected = table.entries("coc-mechanics");
	assert.equal(projected.length, 1, "被退回的那次不发投影：回合还没关");
	assert.deepEqual(projected[0].mechanics.map((row) => row.kind), ["roll"]);
});

test("隐式 narrate 不是玩家语言：内核退回 play_language_mismatch，宿主不交付、催一次", async (t) => {
	const leaked = "What does the Investigator do in the Scene?";
	const chinese = "门框上有一道深深的抓痕。";
	const table = await openTable({
		responses: [fauxAssistantMessage(leaked), fauxAssistantMessage(chinese)],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我检查地窖门的门框");
	await waitForIdle(table.session);

	const narrates = table.kernelRequests().filter((entry) => entry.method === "table.narrate");
	assert.deepEqual(narrates.map((entry) => entry.params.text), [leaked, chinese], "第一次被退回，第二次才过");

	const steers = customMessages(table.session, "coc-host").filter(
		(message) => message.details?.kind === "play-language-mismatch",
	);
	assert.equal(steers.length, 1, "语言核失败只催一次");
	assert.match(String(steers[0].content), /play_language_mismatch/);
	assert.match(String(steers[0].content), /text/, "催的话里带着内核自己的 fix，点名哪个字段");

	const refused = table.telemetry().filter((row) => row.tool === "narrate" && row.ok === false);
	assert.equal(refused.length, 1);
	assert.equal(refused[0].code_detail, "play_language_mismatch");

	const texts = assistantTexts(table.session).filter((text) => text.length > 0);
	assert.equal(texts.at(-1), chinese, "交付的是玩家语言那一版");
	assert.ok(!texts.includes(leaked), "被内核退回的英文草稿不算交付，不留在记录里");
});

test("物品与现金：item、cash 原样进内核，收据只进机制投影，不进正文（#19）", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[
					fauxToolCall("apply", {
						effects: [
							{
								kind: "item",
								name: "  点三八左轮  ",
								to: " 托马斯·海耶斯 ",
								from: "看门人",
								weapon: " 点三八左轮 ",
								quantity: 1,
								label: "左轮",
								why: "看门人把枪推过桌面",
							},
							{ kind: "cash", subject: "托马斯·海耶斯", delta: -30, why: "买了一盒子弹" },
						],
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "看门人把左轮推过桌面。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("narrate 之后不该再有的正文"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我问看门人要那把枪，再买一盒子弹");

	const apply = table.kernelRequests().find((entry) => entry.method === "table.apply");
	assert.equal(apply.params.call_id, "t1-c1");
	assert.deepEqual(
		apply.params.effects[0],
		{
			kind: "item",
			name: "点三八左轮",
			to: "托马斯·海耶斯",
			from: "看门人",
			weapon: "点三八左轮",
			quantity: 1,
			label: "左轮",
			why: "看门人把枪推过桌面",
		},
		"item 的字段一个不少地到内核；名字、来路与武器 profile 都做过空白归一化（契约 §5）",
	);
	assert.deepEqual(
		apply.params.effects[1],
		{ kind: "cash", subject: "托马斯·海耶斯", delta: -30, why: "买了一盒子弹" },
		"cash 的 delta 带正负号原样送，扩展不替内核算钱",
	);

	const receipts = table.session.messages
		.filter((message) => message.role === "toolResult")
		.map((message) => JSON.stringify(message))
		.join("\n");
	assert.match(receipts, /item:点三八左轮-t1-c1/, "物品收据带 slug 与回合序号，原样回到守秘人手上");
	assert.match(receipts, /cash:t1-c1/);

	const delivered = assistantTexts(table.session).filter((text) => text.length > 0).at(-1);
	assert.equal(delivered, "看门人把左轮推过桌面。", "交付就是守秘人的正文：内核不往里插机制行（契约 §16.2）");
	const [projected] = table.entries("coc-mechanics");
	assert.deepEqual(projected.mechanics, [
		{ kind: "item", name: "点三八左轮", label: "左轮", quantity: 1, to: "托马斯·海耶斯" },
		{ kind: "cash", subject: "托马斯·海耶斯", before: 50, after: 20 },
	], "item 与 cash 的前后账在投影里，语言中立");
});
