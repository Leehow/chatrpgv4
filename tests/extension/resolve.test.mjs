/**
 * 切片 1 的 resolve（契约第 11 节）走过扩展的接缝：
 * needs_choice 的候选怎么回到模型、战斗会话里的待决防御怎么用 ask 交回玩家、
 * 会话摘要怎么上状态行、遥测记了哪一族。规则本身在内核那边，这里只看接缝。
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

function statusLines(table) {
	return table.ui.statuses.filter((entry) => entry.key === "coc-session");
}

test("needs_choice：候选与修正都到模型手上，补 decision 再调一次就过", async (t) => {
	const goal = "看出他有没有说谎（歧义）";
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[fauxToolCall("resolve", { action: { intent: "investigate", goal, method: "盯着他的手" } })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: {
							intent: "investigate",
							goal,
							method: "盯着他的手",
							decision: " psychology:observe-concealed ",
						},
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "他的手指在袖口上蹭了一下。" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我盯着他看，想知道他在瞒什么");

	const [failed, passed] = toolResults(table.session, "resolve");
	assert.equal(failed.isError, true, "needs_choice 要标成工具错误");
	const text = resultText(failed);
	assert.match(text, /^needs_choice: 这一下有两种规则都接得住/);
	assert.match(text, /fix: 在 action\.decision 里点名一个候选/);
	// details 只到扩展和界面：候选必须落进正文，否则守秘人挑不出来。
	assert.match(text, /candidates:/);
	assert.match(text, /- core-check:ordinary-check: 只是想看清楚/);
	assert.match(text, /- psychology:observe-concealed: 想读出他藏着的情绪/);
	assert.equal(failed.details.coc_error.details.candidates.length, 2);

	assert.equal(passed.isError, false, "补上 decision 之后这一次该通过");
	const resolves = table.kernelRequests().filter((entry) => entry.method === "table.resolve");
	assert.equal(resolves.length, 2);
	assert.equal(resolves[1].params.action.decision, "psychology:observe-concealed", "decision 做过空白归一化");
	assert.equal(resolves[0].params.call_id, "t1-c1");
	assert.equal(resolves[1].params.call_id, "t1-c2", "失败的那次不复用序号");
});

test("攻击没写武器：内核报 needs 并列出可选，补上 weapon 再来一次", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: { intent: "combat", goal: "打倒看门人", method: "扑上去", target: "看门人" },
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: {
							intent: "combat",
							goal: "打倒看门人",
							method: "扑上去用拳头",
							target: "看门人",
							weapon: " unarmed ",
						},
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你扑了上去。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我扑向看门人");

	const [failed] = toolResults(table.session, "resolve");
	assert.equal(failed.isError, true);
	assert.match(resultText(failed), /missing weapon, one of: 点三八左轮, 撬棍, unarmed/);

	const resolves = table.kernelRequests().filter((entry) => entry.method === "table.resolve");
	assert.equal(resolves[1].params.action.weapon, "unarmed", "武器名做过空白归一化");
});

test("战斗：待决防御用 ask 交回玩家，下一回合用 defense 作答，会话上状态行", async (t) => {
	const table = await openTable({
		responses: [
			// 第一回合：攻击 → 内核给出会话与给玩家的待决 → ask 交回去。
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: {
							intent: "combat",
							goal: "把看门人放倒",
							method: "抡起铁撬砸他",
							target: " 看门人 ",
							weapon: "撬棍",
						},
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[
					fauxToolCall("ask", {
						kind: "mechanics", text: "撬棍朝你的肩膀砸下来。",
						options: ["dodge", "fight_back"],
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("ask 之后不该再写的正文"),
			// 第二回合：玩家答了，守秘人用 defense 解这次待决。
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: {
							intent: "combat",
							actor: "托马斯·海耶斯",
							goal: "躲开砸下来的撬棍",
							method: "侧身闪开",
							defense: "dodge",
						},
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你侧身让过那一下，撬棍砸在门框上。" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我抄起铁撬砸他");

	const ask = table.kernelRequests().find((entry) => entry.method === "table.ask");
	assert.ok(ask, "会话在跑不该拦住 ask：待决防御就是靠它交回玩家的");
	assert.equal(ask.params.call_id, "t1-c2");
	assert.equal(
		assistantTexts(table.session).at(-1),
		"撬棍朝你的肩膀砸下来。",
		"这一回合交付的是 ask 渲染出来的问题加选项",
	);

	const attack = table.kernelRequests().find((entry) => entry.method === "table.resolve");
	assert.equal(attack.params.action.weapon, "撬棍");
	assert.equal(attack.params.action.target, "看门人");

	// ask 也关回合，所以它同样带机制投影（契约 §16.2）：这一回合那次攻击的明骰在里面。
	const [asked] = table.entries("coc-mechanics");
	assert.equal(asked.turn, 1);
	assert.deepEqual(asked.mechanics, [
		{
			kind: "roll",
			actor: "托马斯·海耶斯",
			skill: "Fighting (Brawl)",
			roll: 31,
			target: 50,
			level: "regular",
			passed: true,
			visibility: "public",
		},
	]);

	const opened = statusLines(table);
	assert.equal(opened.length, 1, "战斗开起来时状态行写一次");
	assert.equal(opened[0].text, "combat  round 1  turn: 看门人  defence: player (dodge/fight_back)");

	const attackRow = table.telemetry().find((row) => row.tool === "resolve");
	assert.equal(attackRow.outcome_kind, "combat");
	assert.equal(attackRow.session_kind, "combat");

	const closedRow = table.telemetry().find((row) => row.event === "turn-closed");
	assert.equal(closedRow.session_kind, "combat", "这一回合是在战斗里关掉的，算账时分得出来");

	await table.session.prompt("我闪开");

	const resolves = table.kernelRequests().filter((entry) => entry.method === "table.resolve");
	assert.equal(resolves.length, 2);
	assert.equal(resolves[1].params.action.defense, "dodge", "玩家的回答变成 action.defense");
	assert.equal(resolves[1].params.action.actor, "托马斯·海耶斯");
	assert.equal(resolves[1].params.call_id, "t2-c1", "答防御是新回合的第一个写调用");

	const closed = statusLines(table);
	assert.equal(closed.length, 2, "会话结束时状态行摘一次");
	assert.equal(closed[1].text, undefined);

	const defenseRow = table.telemetry().filter((row) => row.tool === "resolve").at(-1);
	assert.equal(defenseRow.outcome_kind, "combat");
	assert.equal(defenseRow.session_kind, undefined, "会话结束了就不记 session_kind");
});

test("推骰：push 与 stakes 原样送到内核，遥测记下这一族", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: {
							intent: "investigate",
							goal: "再从抽屉里找出点什么",
							method: "把抽屉整个抽出来翻",
							push: true,
							stakes: "翻乱了会惊动楼下的看门人",
						},
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你把抽屉整个抽了出来。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我不甘心，再翻一次");

	const resolve = table.kernelRequests().find((entry) => entry.method === "table.resolve");
	assert.equal(resolve.params.action.push, true);
	assert.equal(resolve.params.action.stakes, "翻乱了会惊动楼下的看门人");

	const [result] = toolResults(table.session, "resolve");
	assert.equal(result.isError, false);
	assert.equal(result.details.outcome.kind, "push");

	const row = table.telemetry().find((entry) => entry.tool === "resolve");
	assert.equal(row.outcome_kind, "push");
	assert.equal(row.session_kind, undefined, "没有会话就不记 session_kind");
	assert.equal(statusLines(table).length, 0, "没有会话就不动状态行");
});

test("待决防御没交回去就收工：宿主不替它问，丢掉草稿催一次，守秘人自己用玩家的语言问（契约 §16.1）", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: {
							intent: "combat",
							goal: "把看门人放倒",
							method: "抡起铁撬砸他",
							target: "看门人",
							weapon: "撬棍",
						},
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("撬棍带着风声砸下来，你只来得及看见它的影子。"),
			fauxAssistantMessage(
				[
					fauxToolCall("ask", {
						text: "撬棍带着风声砸下来，你只来得及看见它的影子。",
						kind:"mechanics", options:["dodge","fight_back"],
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我抄起铁撬砸他");
	await waitForIdle(table.session);

	// 内核留下的待决 prompt 是英文的守秘人用语；宿主不许把它摆到玩家面前，
	// 所以这一轮不替它 ask，草稿正文也不留下当交付。
	const asks = table.kernelRequests().filter((entry) => entry.method === "table.ask");
	assert.equal(asks.length, 1, "只有守秘人自己那一次 ask 到了内核");
	assert.equal(asks[0].params.kind,"mechanics");
	assert.equal(asks[0].params.binds, "combat-defense-t1", "仍然绑内核那条待决");
	assert.deepEqual(asks[0].params.options, ["dodge", "fight_back"]);

	const steers = customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "steer");
	assert.equal(steers.length, 1, "催一次，且只有一次");

	const delivered = assistantTexts(table.session).filter((text) => text.length > 0).at(-1);
	assert.ok(delivered.startsWith("撬棍带着风声砸下来"), "交付是守秘人的正文");
	assert.deepEqual(table.entries("coc-choice").at(-1).options,["dodge","fight_back"]);
	assert.ok(!delivered.includes("dodge"), "内核的英文选项不出现在玩家看的字里");
});

test("守秘人自己 ask 却漏填 binds：宿主用内核留下的待决名补上", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: { intent: "combat", goal: "把看门人放倒", method: "抡起铁撬砸他", target: "看门人", weapon: "撬棍" },
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[fauxToolCall("ask", { text: "撬棍砸下来。", kind:"mechanics", options:["dodge","fight_back"] })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我抄起铁撬砸他");
	await waitForIdle(table.session);

	const ask = table.kernelRequests().find((entry) => entry.method === "table.ask");
	assert.ok(ask, "守秘人的 ask 到了内核");
	assert.equal(ask.params.binds, "combat-defense-t1", "漏填的 binds 由宿主补上");
	assert.deepEqual(ask.params.options, ["dodge", "fight_back"], "守秘人自己的选项原样保留");
});
