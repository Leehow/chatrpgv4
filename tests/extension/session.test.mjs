/**
 * 会话接缝：选战役、恢复未关的回合、内核错误怎么回到模型、回合没关时催一次、内核死了再拉起来。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { extensionWords } from "../../extensions/ui/words.ts";
import { createFakeUI, customMessages, openTable, waitFor, waitForIdle } from "./harness.mjs";

function resultText(message) {
	return (message.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

test("没有 PI_COC_CAMPAIGN 时用 ctx.ui 列出战役让人选", async (t) => {
	const table = await openTable({
		campaign: null,
		ui: createFakeUI({ selections: [0] }),
		env: {
			FAKE_KERNEL_CAMPAIGNS: JSON.stringify([
				{ id: "camp-a", title: "闹鬼的房子", module_id: "the-haunting", status: "active", turn: 3 },
				{ id: "camp-b", title: "另一张桌子", module_id: "the-haunting", status: "active", turn: 0 },
			]),
		},
		responses: [fauxAssistantMessage("好的")],
	});
	t.after(() => table.dispose());

	const [prompt] = table.ui.prompts;
	assert.ok(prompt, "应该弹过一次选择");
	assert.equal(prompt.options.length, 2);
	assert.match(prompt.options[0], /camp-a/);

	const open = table.kernelRequests().find((entry) => entry.method === "table.open");
	assert.equal(open.params.campaign, "camp-a");
});

test("没有界面又没有 PI_COC_CAMPAIGN 时，报清楚并拦下工具", async (t) => {
	const table = await openTable({
		campaign: null,
		ui: null,
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("没开成"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我看看四周");

	const methods = table.kernelRequests().map((entry) => entry.method);
	assert.deepEqual(methods, ["kernel.hello", "campaign.list"], "开桌应该停在选战役这一步");

	const [blocked] = table.session.messages.filter((message) => message.role === "toolResult");
	assert.equal(blocked.isError, true);
	assert.match(resultText(blocked), /PI_COC_CAMPAIGN/);
});

test("pending_turn：注入恢复消息，玩家原文与欠的步骤都在里面", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_PENDING: "1" },
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你摸到墙上的开关。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await waitForIdle(table.session);

	const [host] = customMessages(table.session, "coc-host");
	assert.ok(host, "pending_turn 时应该注入宿主恢复消息");
	assert.match(String(host.content), /我下地窖/);
	assert.match(String(host.content), /narrate/);

	const methods = table.kernelRequests().map((entry) => entry.method);
	assert.ok(!methods.includes("table.player_input"), "恢复消息不是玩家输入");
	const narrate = table.kernelRequests().find((entry) => entry.method === "table.narrate");
	assert.ok(narrate, "恢复的回合要能被 narrate 关掉");
	assert.equal(narrate.params.call_id, "t1-c2", "接着做的是原来那个回合，序号从死掉的进程之后接着铸");
});

test("内核报错：模型拿到 code: message 与 fix，结果标成错误", async (t) => {
	const table = await openTable({
		env: {
			FAKE_KERNEL_ERRORS: JSON.stringify({
				"table.resolve": {
					code: "needs",
					message: "认不出你要掷的技能",
					fix: "在 action.skill 里写明技能名，比如「侦查」",
					details: { needs: { field: "skill", options: ["侦查", "聆听"] } },
				},
			}),
		},
		responses: [
			fauxAssistantMessage(
				[fauxToolCall("resolve", { action: { intent: "investigate", goal: "找线索", method: "翻箱倒柜" } })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你翻了一遍抽屉。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我翻抽屉");

	const [failed] = table.session.messages.filter(
		(message) => message.role === "toolResult" && message.toolName === "resolve",
	);
	assert.equal(failed.isError, true, "内核错误要标成工具错误");
	assert.match(resultText(failed), /^needs: 认不出你要掷的技能/);
	assert.match(resultText(failed), /fix: 在 action.skill 里写明技能名/);
	assert.equal(failed.details.coc_error.code, "needs");

	const telemetry = table.telemetry();
	const row = telemetry.find((entry) => entry.tool === "resolve");
	assert.equal(row.ok, false);
	assert.equal(row.code, "needs");

	// 失败的调用不复用序号：narrate 拿的是下一个。
	const narrate = table.kernelRequests().find((entry) => entry.method === "table.narrate");
	assert.equal(narrate.params.call_id, "t1-c2");
});

/**
 * 造物代理跑了三分多钟然后没跑完，守秘人只收到「重试同一批」——超时和中途夭折是两回事：
 * 超时说明这一批本身太大，照原样重试还会超时。details 里的 reason 必须活过投影，
 * 遥测那条也得能分辨，否则失败车道只看得见一个 needs。
 */
test("造物代理超时：批量太大这件事要到守秘人手上，遥测记得下 reason", async (t) => {
	const table = await openTable({
		env: {
			FAKE_KERNEL_ERRORS: JSON.stringify({
				"table.apply": {
					code: "needs",
					message: "The Mod agent did not finish its task",
					fix: "Retry the same request to resume the retained job",
					details: { reason: "mod_agent_failed", role: "create", timed_out: true },
				},
			}),
		},
		responses: [
			fauxAssistantMessage(
				[fauxToolCall("apply", { effects: [{ kind: "define", name: "火柴", category: "item", description: "一盒火柴" }] })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你摸了摸口袋。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我清点随身的东西");

	const [failed] = table.session.messages.filter(
		(message) => message.role === "toolResult" && message.toolName === "apply",
	);
	assert.equal(failed.isError, true);
	assert.match(resultText(failed), /fix: Retry the same request/);
	assert.match(resultText(failed), /ran out of time: retry with fewer define effects/);

	const row = table.telemetry().find((entry) => entry.tool === "apply");
	assert.equal(row.ok, false);
	assert.equal(row.code, "needs");
	assert.equal(row.reason, "mod_agent_failed");
});

test("审计代理超时：说的是审计，不是叫守秘人去删 define 效果", async (t) => {
	// A real table hit this: the audit lane ran past its deadline on a turn that defined nothing, and
	// the refusal told the Keeper to "retry with fewer define effects". It retried the same narration
	// three times and burned the turn. What the Keeper can do about a timeout depends on which agent
	// timed out, so the refusal has to say which.
	const table = await openTable({
		env: {
			FAKE_KERNEL_ERRORS: JSON.stringify({
				"table.narrate": {
					code: "needs",
					message: "The Mod agent did not finish its task",
					fix: "Retry the same request to resume the retained job",
					details: { reason: "mod_agent_failed", role: "audit", timed_out: true },
				},
			}),
		},
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "她把手套拧得更紧。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("收尾"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我再问她一次");

	const [failed] = table.session.messages.filter(
		(message) => message.role === "toolResult" && message.toolName === "narrate",
	);
	assert.equal(failed.isError, true);
	assert.match(resultText(failed), /the audit agent ran out of time/);
	assert.match(resultText(failed), /nothing about it needs changing to retry/);
	assert.doesNotMatch(resultText(failed), /define effects/);
});

test("回合没关时催一次，且只催一次", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			// 只想不说：没有正文可当叙述，宿主才需要催。写了正文的情况走隐式 narrate，见 turn.test。
			fauxAssistantMessage([fauxThinking("我先想想。")]),
			fauxAssistantMessage([fauxThinking("还是想想。")]),
			fauxAssistantMessage([fauxThinking("再想想。")]),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我盯着那扇门看");
	await waitForIdle(table.session);

	const steers = customMessages(table.session, "coc-host").filter(
		(message) => message.details?.kind === "steer",
	);
	assert.equal(steers.length, 1, "回合没关只催一次");
	assert.match(String(steers[0].content), /narrate/);
});

test("内核意外退出后重新拉起并重开桌", async (t) => {
	const table = await openTable({
		// 补抽（#20）也会在开桌后发一次 `memory.job`，会把「第三个请求」挪到别处；
		// 这个用例看的是开桌那条线，所以这张桌子不补抽。
		env: { FAKE_KERNEL_EXIT_AFTER: "3", PI_COC_MEMORY_BACKFILL: "0" },
		responses: [fauxAssistantMessage("我先看看情况。")],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我推门进去");
	await waitForIdle(table.session);
	// 重新拉起是内核客户端在子进程退出时自己发起的，落到请求日志上比这一轮结束晚一点。
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline && table.kernelRequests().length < 5) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	// 按需深读的认领（契约 §14.6）也搭在这条内核连接上，开桌之后会来一次；
	// 这个用例看的是开桌与重开桌那条线，所以把车道的调用滤掉。
	const methods = table
		.kernelRequests()
		.map((entry) => entry.method)
		.filter((method) => !method.startsWith("module."));
	assert.deepEqual(
		methods,
		["kernel.hello", "table.open", "table.player_input", "kernel.hello", "table.open"],
		"第三个请求把内核带走之后，扩展重新拉起并重新 table.open",
	);

	const [failure] = customMessages(table.session, "coc-host").filter(
		(message) => message.details?.kind === "player-input-failed",
	);
	assert.ok(failure, "内核在玩家输入上死掉时，守秘人要被告知");
});

test("开桌欢迎：战役、场景、调查员各报一次", async (t) => {
	const table = await openTable({ responses: [fauxAssistantMessage("好")] });
	t.after(() => table.dispose());

	// Both welcome lines read their caption from the campaign's `extension` surface (contract §23);
	// the title, the scene and the investigator inside them are the kernel's own words. Reading the
	// surface is a file read, so the welcome lands one turn of the loop after the table opens.
	const words = await extensionWords("zh-Hans");
	const english = await extensionWords("en");
	const caption = (drawn) => drawn.word("kernel_table_open").split("{")[0];
	assert.ok(caption(words).trim().length > 0, "the open line has a caption of its own");
	assert.notEqual(caption(words), caption(english), "a second language opens the table with its own caption");
	const messages = () => table.ui.notifications.map((entry) => entry.message);
	await waitFor(
		() => messages().some((message) => message.startsWith(caption(words)) && /科比特宅/.test(message)),
		{ label: "内核扩展报一行桌况" },
	);
	await waitFor(
		() => messages().some((message) => /闹鬼的房子/.test(message) && /托马斯·海耶斯/.test(message) && /SAN 55/.test(message)),
		{ label: "table 扩展报欢迎：战役、场景、调查员" },
	);
});
