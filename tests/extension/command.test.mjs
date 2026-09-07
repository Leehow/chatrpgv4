/**
 * `/coc` 命令面（契约 §19.1，票 #28）。
 *
 * 走的是产品路径：`session.prompt("/coc ...")`——Pi 在建提示之前先派命令，命令处理器跑完
 * `prompt()` 就返回。用例断言的正是这一条法则：**输出只给人，永不进模型上下文**。
 *
 * 命令只在交互模式下工作，所以这里的桌子用 `uiMode: "tui"`；降级那个用例用测试台缺省的
 * `print` 模式，跟驾驭器（`--mode rpc`）站在同一侧。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";

/** 一个完整回合：一次 look，一次 narrate，再加一条会被交付替换掉的尾巴。 */
function keeperTurn(text) {
	return [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
		fauxAssistantMessage("守秘人在 narrate 之后又写的正文，应该被换掉"),
	];
}

/** 起一张已经走过一回合的桌子：胶囊、遥测、模组状态都到位，面板才有东西可读。 */
async function tableAfterOneTurn(t, options = {}) {
	const table = await openTable({ uiMode: "tui", responses: keeperTurn("门框上有一道深深的抓痕。"), ...options });
	t.after(() => table.dispose());
	await table.session.prompt("我检查地窖门的门框");
	table.ui.notifications.length = 0;
	return table;
}

/** `/coc` 之后 ctx.ui 上最后一条通知。 */
function lastNotice(table) {
	return table.ui.notifications.at(-1);
}

test("/coc：桌况面板走 ctx.ui，不占回合、不动回合状态机、不进模型上下文（契约 §19.1）", async (t) => {
	const table = await tableAfterOneTurn(t);
	const messagesBefore = table.session.messages.length;
	const requestsBefore = table.kernelRequests().length;

	await table.session.prompt("/coc");

	const notice = lastNotice(table);
	assert.equal(table.ui.notifications.length, 1, "面板恰好一条通知");
	assert.equal(notice.type, "info");
	// 面板取的是 table.open、本回合胶囊与一次 table.status，全部只读。
	assert.match(notice.message, /^table {3}test-camp {2}闹鬼的房子$/m, "战役 id 与标题");
	assert.match(notice.message, /^turn {4}1 \(awaiting_player\) {3}scene 科比特宅$/m, "回合号、状态与场景");
	assert.match(notice.message, /^clock {3}9 小时 15 分钟/m, "时钟");
	assert.match(notice.message, /^party {3}托马斯·海耶斯 {2}HP 12 {2}SAN 55 {2}MP 11 {2}LUCK 60$/m, "队伍数值");
	assert.match(notice.message, /^session none$/m, "活跃会话");
	assert.match(notice.message, /^beat {4}REVEAL {2}这一场还有没被翻出来的东西$/m, "Director 上一个节拍与理由");
	assert.match(notice.message, /^module {2}the-haunting/m, "模组材料就绪度");
	assert.match(notice.message, /^model {3}faux\/faux-1 {3}thinking off$/m, "当前模型与思考等级");

	assert.equal(table.session.messages.length, messagesBefore, "一条消息都没往会话里加");
	assert.equal(
		table.session.messages.filter((message) => message.role === "user").length,
		1,
		"`/coc` 没有变成一条玩家输入",
	);
	// 按需深读那条车道是异步的（契约 §14.6），它的 claim 什么时候落进来不归这个用例管。
	const methods = table
		.kernelRequests()
		.slice(requestsBefore)
		.map((row) => row.method);
	assert.deepEqual(methods, ["table.status", "module.status"], "只做两次读调用");
	assert.equal(
		table.kernelRequests().filter((row) => row.method === "table.player_input").length,
		1,
		"回合状态机没被碰过：还是那一个回合",
	);
});

test("/coc model：无参列候选并标出当前，有参切换并写一行遥测", async (t) => {
	const table = await tableAfterOneTurn(t);

	await table.session.prompt("/coc model");
	const listed = lastNotice(table).message;
	assert.match(listed, /^model {3}faux\/faux-1$/m, "第一行是当前值");
	assert.match(listed, /^ {2}\* faux\/faux-1$/m, "当前的那个带星号");
	assert.match(listed, /^ {4}verifier\/v1$/m, "注册表里的别的模型也列出来");

	await table.session.prompt("/coc model verifier/v1");
	assert.match(lastNotice(table).message, /^model {3}faux\/faux-1 -> verifier\/v1$/m);
	assert.match(lastNotice(table).message, /next model call/, "说清楚回合中途切了下一回合才生效");
	assert.equal(table.session.model.provider, "verifier", "桌子的模型真的换了");
	assert.equal(table.session.model.id, "v1");

	await table.session.prompt("/coc model 没有这个/模型");
	assert.match(lastNotice(table).message, /is not in the model registry/);
	assert.equal(table.session.model.provider, "verifier", "认不出的名字不动当前模型");

	await table.session.prompt("/coc model 不是一个引用");
	assert.match(lastNotice(table).message, /is not provider\/model/);

	const rows = table.entries("coc-telemetry").filter((row) => row.lane === "command" && row.command === "model");
	assert.equal(rows.length, 2, "切换与认不出各写一行；形状不对的连注册表都不查");
	assert.deepEqual(
		{ ok: rows[0].ok, from: rows[0].from, to: rows[0].to },
		{ ok: true, from: "faux/faux-1", to: "verifier/v1" },
	);
	assert.equal(rows[1].ok, false);
	assert.equal(rows[1].reason, "not_in_registry");
});

test("/coc thinking：切换按 Pi 的闭合等级，认不出就列出等级", async (t) => {
	const table = await tableAfterOneTurn(t);

	await table.session.prompt("/coc thinking");
	assert.match(lastNotice(table).message, /^thinking off$/m);
	assert.match(lastNotice(table).message, /off, minimal, low, medium, high, xhigh, max/);

	await table.session.prompt("/coc thinking high");
	// Pi 会把等级夹到模型支持的范围，所以答案是读回来的，不是照着请求写的。
	assert.match(lastNotice(table).message, /^thinking off -> /m);
	const row = table.entries("coc-telemetry").find((entry) => entry.lane === "command" && entry.command === "thinking");
	assert.equal(row.requested, "high");
	assert.equal(row.to, table.session.thinkingLevel, "遥测记的是真的生效值");

	await table.session.prompt("/coc thinking 侧着想");
	assert.match(lastNotice(table).message, /is not a thinking level/);
	assert.equal(
		table.entries("coc-telemetry").filter((entry) => entry.lane === "command" && entry.command === "thinking").length,
		1,
		"认不出的等级不写遥测",
	);
});

test("/coc lanes：两条车道的模型，加最近的车道遥测（失败的那些也在）", async (t) => {
	// 两条车道的假模型都不给回答：于是两条都失败，正是这条命令唯一能看见的东西。
	const table = await tableAfterOneTurn(t);
	await new Promise((resolve) => setTimeout(resolve, 150));

	await table.session.prompt("/coc lanes");
	const view = lastNotice(table).message;
	assert.match(view, /^lanes {3}verifier verifier\/v1 {3}memory memory\/m1$/m, "两条车道各报自己的模型");
	assert.match(view, /^ {2}FAIL {2}verifier {2}t1/m, "失败的校验车道看得见");
	assert.match(view, /reason model_error/, "带原因码");
	assert.match(view, /^ {2}FAIL {2}memory {4}t1/m, "记忆车道那一行也在");
});

test("/coc lanes：车道模型指不到时，命令本身照样答得出来", async (t) => {
	const table = await tableAfterOneTurn(t, { env: { PI_COC_VERIFIER_MODEL: "verifier/没这个模型" } });

	await table.session.prompt("/coc lanes");
	assert.match(lastNotice(table).message, /verifier unavailable \(/, "指不到就说指不到，不抛");
	assert.match(lastNotice(table).message, /memory memory\/m1/);
});

test("/coc evidence：证据路径，给人开另一个终端看", async (t) => {
	const table = await tableAfterOneTurn(t);

	await table.session.prompt("/coc evidence");
	const view = lastNotice(table).message;
	for (const label of ["campaign", "telemetry", "transcript", "events", "turns", "module", "playtests"]) {
		assert.match(view, new RegExp(`^ {2}${label} `, "m"), `${label} 那一行在`);
	}
	assert.match(view, /\.coc\/campaigns\/test-camp\/telemetry\.jsonl$/m);
	assert.match(view, /\.coc\/playtests$/m);
});

test("/coc investigator：库的名册，最新的在前（契约 §21.5）", async (t) => {
	const table = await tableAfterOneTurn(t, {
		env: {
			FAKE_KERNEL_INVESTIGATORS: JSON.stringify([
				{
					library_id: "ada-lovelace-1", name: "Ada Lovelace", occupation: "Journalist", era: "1920s",
					current_hp: 12, current_san: 55, last_campaign: "old-camp", last_turn: 7,
					updated_at: "2026-02-01T00:00:00Z",
				},
				{
					library_id: "bob-reed-1", name: "Bob Reed", occupation: "Artist", era: "1920s",
					current_hp: 10, current_san: 60, updated_at: "2026-01-01T00:00:00Z",
				},
			]),
		},
	});
	const requestsBefore = table.kernelRequests().length;

	await table.session.prompt("/coc investigator");
	const view = lastNotice(table).message;
	assert.match(view, /^investigators$/m, "抬头");
	assert.match(view, /^ {2}ada-lovelace-1.*Ada Lovelace.*Journalist.*1920s.*HP 12 SAN 55.*old-camp t7$/m, "第一张卡，带上一局与回合");
	assert.match(view, /^ {2}bob-reed-1.*Bob Reed.*Artist.*1920s.*HP 10 SAN 60.*never played$/m, "没玩过的那张卡");
	assert.match(view, /\/coc investigator save/, "说清楚存卡的命令");

	// 一次读调用，不占回合、不进模型上下文（按需深读那条车道是异步的，跟这条命令无关）
	assert.deepEqual(
		table
			.kernelRequests()
			.slice(requestsBefore)
			.map((row) => row.method),
		["investigator.list"],
	);
	assert.equal(
		table.session.messages.filter((message) => message.role === "user").length,
		1,
		"没有变成玩家输入",
	);
});

test("/coc investigator：库是空的", async (t) => {
	const table = await tableAfterOneTurn(t);

	await table.session.prompt("/coc investigator");
	assert.match(lastNotice(table).message, /^investigators$/m);
	assert.match(lastNotice(table).message, /the library is empty/);
});

test("/coc investigator save：把当前桌子的卡手动存进库（契约 §21.5，回流之外的保险）", async (t) => {
	const table = await tableAfterOneTurn(t);
	const requestsBefore = table.kernelRequests().length;

	await table.session.prompt("/coc investigator save");
	assert.match(lastNotice(table).message, /^investigator {2}saved 托马斯·海耶斯 to the library as thomas-hayes-1 {2}\(new row\)\.$/m);
	assert.deepEqual(
		table
			.kernelRequests()
			.slice(requestsBefore)
			.map((row) => row.method),
		["investigator.save"],
	);
	const rows = table.entries("coc-telemetry").filter((row) => row.lane === "command" && row.command === "investigator save");
	assert.equal(rows.length, 1);
	assert.deepEqual(
		{ ok: rows[0].ok, library_id: rows[0].library_id, created: rows[0].created },
		{ ok: true, library_id: "thomas-hayes-1", created: true },
	);

	// 再存一次：假内核这次回 created: false，命令原样报告「更新」
	await table.session.prompt("/coc investigator save");
	assert.match(lastNotice(table).message, /\(updated\)\.$/m);
});

test("/coc 认不出的子命令：一条警告，把子命令表说清楚", async (t) => {
	const table = await tableAfterOneTurn(t);

	await table.session.prompt("/coc 没有这个子命令");
	assert.equal(lastNotice(table).type, "warning");
	assert.match(lastNotice(table).message, /\/coc model \[provider\/model\]/);
	assert.match(lastNotice(table).message, /\/coc lanes/);
});

test("非交互模式：`/coc` 只回一行 interactive only，别的什么都不做（契约 §19.1）", async (t) => {
	// 测试台缺省绑 print 模式，跟 `--mode rpc` 的驾驭器站在同一侧。
	const table = await openTable({ responses: keeperTurn("门框上有一道深深的抓痕。") });
	t.after(() => table.dispose());
	await table.session.prompt("我检查地窖门的门框");
	table.ui.notifications.length = 0;
	const requestsBefore = table.kernelRequests().length;

	for (const command of [
		"/coc", "/coc model", "/coc model verifier/v1", "/coc thinking high", "/coc lanes", "/coc evidence",
		"/coc investigator", "/coc investigator save",
	]) {
		await table.session.prompt(command);
	}

	assert.equal(table.ui.notifications.length, 8, "每次一行，不多");
	for (const note of table.ui.notifications) {
		assert.equal(note.type, "warning");
		assert.match(note.message, /^\/coc is interactive only/);
	}
	assert.deepEqual(
		table
			.kernelRequests()
			.slice(requestsBefore)
			.map((row) => row.method),
		[],
		"一个内核调用都不发",
	);
	assert.equal(table.session.model.provider, "faux", "模型没被换");
	assert.deepEqual(
		table.entries("coc-telemetry").filter((row) => row.lane === "command"),
		[],
		"降级时连遥测都不写",
	);
});
