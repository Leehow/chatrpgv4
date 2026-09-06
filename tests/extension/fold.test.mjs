/**
 * COC 自己的上下文折叠（契约 §19.2，票 #28）。
 *
 * Pi 的压缩接口只收一个切点加一段摘要：切点之前的条目全部换成那段摘要，切点之后原样留
 * （宿主的 `buildContextEntries`）。所以折叠做两件事：把切点放在倒数第二回合的开头，
 * 摘要自己确定性地写出来——不叫模型。
 *
 * 用例走的是真压缩：`session.compact()`（也就是 `/compact` 走的那条），以及
 * `before_agent_start` 里越过阈值时自己发起的那次。判据只有条目类型与回合距离，
 * 一行文本都不读。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";

/** 一回合：一次 look（工具往返）、一次 narrate（交付），再加一条会被替换掉的尾巴。 */
function keeperTurn(n) {
	return [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: `第 ${n} 回合的交付。` })], { stopReason: "toolUse" }),
		fauxAssistantMessage("守秘人在 narrate 之后又写的正文，应该被换掉"),
	];
}

/**
 * 压缩设置：`keepRecentTokens: 1` 让 Pi 自己的切点贴着最后一条，这样「有东西可压」这个
 * 前提成立；`enabled: false` 让 Pi 不会自己在回合中途压，回合才确定。
 */
const COMPACTION = { compaction: { enabled: false, reserveTokens: 16384, keepRecentTokens: 1 } };

function compactionEntry(table) {
	return table.rawEntries().findLast((entry) => entry.type === "compaction");
}

function foldRows(table) {
	return table.entries("coc-telemetry").filter((row) => row.lane === "fold");
}

/** 折叠之后模型真正看到的东西：角色加 customType，够判「丢对了没有」。 */
function contextShape(table) {
	return table.session.messages.map((message) => `${message.role}${message.customType ? `:${message.customType}` : ""}`);
}

async function threeTurns(t, options = {}) {
	const table = await openTable({
		uiMode: "tui",
		settings: COMPACTION,
		responses: [...keeperTurn(1), ...keeperTurn(2), ...keeperTurn(3)],
		...options,
	});
	t.after(() => table.dispose());
	await table.session.prompt("第一句");
	await table.session.prompt("第二句");
	await table.session.prompt("第三句");
	return table;
}

test("折叠按类型与回合距离丢：胶囊、机制、工具往返整段丢，玩家输入与交付原样留（契约 §19.2）", async (t) => {
	const table = await threeTurns(t);

	await table.session.compact();

	const entry = compactionEntry(table);
	assert.ok(entry, "压缩条目落了下来");
	assert.equal(entry.fromHook, true, "摘要是扩展写的，不是模型生成的");

	// 丢：第一回合的胶囊与两次工具往返；留：玩家那一句与守秘人的交付，一字不改。
	assert.match(entry.summary, /^\[COC context fold\]$/m);
	assert.match(entry.summary, /Dropped whole: 1 turn capsules, 0 mechanics projections, 2 tool calls and 2 tool results\./);
	assert.match(entry.summary, /^player: 第一句$/m, "玩家原文原样留下");
	assert.match(entry.summary, /^keeper: 第 1 回合的交付。$/m, "已交付的正文原样留下");
	assert.doesNotMatch(entry.summary, /corbitt-house/, "胶囊的内容一个字都没进摘要");
	assert.match(entry.summary, /next turn's capsule/, "补上那句「桌面状态在下一回合的胶囊里」");
	assert.match(entry.summary, /use recall/, "往事用 recall");

	// 折叠记录挂在压缩条目上：下一次折叠据此接着往下写，不用回头解析摘要。
	assert.deepEqual(entry.details.coc_fold.dropped, { capsules: 1, mechanics: 0, tool_calls: 2, tool_results: 2 });
	assert.deepEqual(
		entry.details.coc_fold.lines,
		[
			{ who: "player", text: "第一句" },
			{ who: "keeper", text: "第 1 回合的交付。" },
		],
		"留下来的就是逐字记录的对应物",
	);

	// 最近两回合原样在上下文里：两条玩家输入、两份胶囊、两轮工具往返都还在。
	const shape = contextShape(table);
	assert.equal(shape[0], "compactionSummary", "摘要排在最前");
	assert.equal(shape.filter((row) => row === "user").length, 2, "最近两回合的玩家输入都在");
	assert.equal(shape.filter((row) => row === "custom:coc-capsule").length, 2, "这两回合的胶囊也都在");
	assert.equal(shape.filter((row) => row === "toolResult").length, 4, "这两回合的工具结果都在");
	assert.ok(!shape.includes("user") || table.session.messages.filter((m) => m.role === "user").every((m) => JSON.stringify(m.content).includes("第二句") || JSON.stringify(m.content).includes("第三句")), "第一回合那句已经不在上下文里，只在摘要里");
});

test("折叠之后补一条宿主消息：桌面状态在下一回合的胶囊里，往事用 recall", async (t) => {
	const table = await threeTurns(t);

	await table.session.compact();

	const host = table.session.messages.filter(
		(message) => message.role === "custom" && message.customType === "coc-host",
	);
	assert.equal(host.length, 1, "只补一条");
	assert.equal(host[0].display, false, "不给玩家看，但进模型上下文");
	assert.match(host[0].content, /next turn's capsule/);
	assert.match(host[0].content, /recall/);
	assert.match(host[0].content, /obligation\(s\) are open/, "本回合的待决取自胶囊自己的字段");
});

test("折叠写一行遥测：丢了几条、留了几行、由什么触发", async (t) => {
	const table = await threeTurns(t);

	await table.session.compact();

	const rows = foldRows(table);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].ok, true);
	assert.equal(rows[0].trigger, "manual", "`/compact` 走的是 manual 那条");
	assert.equal(rows[0].kept_lines, 2);
	assert.deepEqual(rows[0].dropped, { capsules: 1, mechanics: 0, tool_calls: 2, tool_results: 2 });
	assert.ok(rows[0].folded_entries > 0);
});

test("连着折叠两次：上一次留下的逐字记录接着往下写，不会丢掉", async (t) => {
	const table = await openTable({
		uiMode: "tui",
		settings: COMPACTION,
		responses: [...keeperTurn(1), ...keeperTurn(2), ...keeperTurn(3), ...keeperTurn(4), ...keeperTurn(5)],
	});
	t.after(() => table.dispose());
	await table.session.prompt("第一句");
	await table.session.prompt("第二句");
	await table.session.prompt("第三句");
	await table.session.compact();
	await table.session.prompt("第四句");
	await table.session.prompt("第五句");
	await table.session.compact();

	const entry = compactionEntry(table);
	assert.deepEqual(
		entry.details.coc_fold.lines.map((line) => line.text),
		["第一句", "第 1 回合的交付。", "第二句", "第 2 回合的交付。", "第三句", "第 3 回合的交付。"],
		"第一次折叠留下的两行也在，没有被第二次折叠吃掉；上一次那条折叠说明被这一次顶掉了",
	);
	assert.ok(
		entry.details.coc_fold.lines.every((line) => !line.text.includes("context was folded")),
		"上一次折叠的说明不会一层层堆进逐字记录",
	);
	assert.match(entry.summary, /^player: 第一句$/m);
	assert.match(entry.summary, /^player: 第三句$/m);
	assert.equal(
		table.rawEntries().filter((row) => row.type === "compaction").length,
		2,
		"两次压缩，两条压缩条目",
	);
});

test("阈值到了就在回合之前先压：`before_agent_start` 自己发起，不等 Pi 在工具往返中间压", async (t) => {
	// 5%：第一回合走完上下文已经过线，第二回合的 before_agent_start 里就该先压再进回合。
	const table = await openTable({
		uiMode: "tui",
		settings: COMPACTION,
		env: { PI_COC_COMPACT_AT: "5" },
		responses: [...keeperTurn(1), ...keeperTurn(2)],
	});
	t.after(() => table.dispose());

	await table.session.prompt("第一句");
	assert.deepEqual(foldRows(table), [], "第一回合之前上下文还是空的，不压");
	const usage = table.session.getContextUsage();
	assert.ok(usage.percent > 5, `第一回合之后上下文占用应该过线，实测 ${usage.percent}`);

	await table.session.prompt("第二句");

	const rows = foldRows(table);
	const preemptive = rows.find((row) => row.event === "pre-emptive");
	assert.ok(preemptive, "有一行说的是「阈值到了，先压」");
	assert.equal(preemptive.ok, true);
	assert.equal(preemptive.threshold, 5);
	assert.ok(preemptive.percent > 5);
	assert.ok(
		rows.some((row) => row.ok === true && row.trigger !== undefined),
		"那次压缩走的就是 COC 自己的折叠",
	);
	assert.equal(table.rawEntries().filter((row) => row.type === "compaction").length, 1, "只压一次");

	// 压缩落在回合之前：第二回合的工具往返全在压缩条目之后。
	const entries = table.rawEntries();
	const compactionIndex = entries.findIndex((row) => row.type === "compaction");
	const lastToolResult = entries.findLastIndex((row) => row.type === "message" && row.message.role === "toolResult");
	assert.ok(compactionIndex < lastToolResult, "第二回合的工具往返排在压缩之后，压缩没插进往返中间");
});

test("阈值没到就不压：缺省 70%，一回合远远不到", async (t) => {
	const table = await openTable({
		uiMode: "tui",
		settings: COMPACTION,
		responses: [...keeperTurn(1), ...keeperTurn(2)],
	});
	t.after(() => table.dispose());

	await table.session.prompt("第一句");
	await table.session.prompt("第二句");

	assert.deepEqual(foldRows(table), [], "没过线就一行遥测都不写");
	assert.equal(table.rawEntries().filter((row) => row.type === "compaction").length, 0, "也没有压缩");
});
