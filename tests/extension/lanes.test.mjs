/**
 * narrate 之后的两条车道（契约 §12.5、§12.8）：记忆抽取与 advisory 校验。
 * 两条都在交付之后跑、都不阻塞、出错都只落遥测。
 *
 * 车道模型走的是 harness 里那两个专属的假 provider（verifier/v1、memory/m1），
 * 各有各的回答队列；想验「缺省与桌子同模型」的用例把环境变量显式删掉。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, waitFor } from "./harness.mjs";

const RENDERED = "门框上有一道深深的抓痕。\n\n【明骰】侦查｜掷骰：42；基础值：55；门槛：普通（≤55）；结果：通过";

function keeperTurn(text = "门框上有一道深深的抓痕。") {
	return [
		fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
		fauxAssistantMessage("守秘人在 narrate 之后又写的正文，应该被换掉"),
	];
}

function calls(table, method) {
	return table.kernelRequests().filter((entry) => entry.method === method);
}

function laneRows(table, lane) {
	return table.telemetry().filter((row) => row.lane === lane);
}

/** 遥测是车道自己写的最后一步，比内核那边的请求日志晚一点：断言前先等它落。 */
function waitForLaneRow(table, lane) {
	return waitFor(() => laneRows(table, lane).at(-1), { label: `${lane} 车道遥测` });
}

/** 打开一个闸门：车道的假模型停在这里，用来证明交付不等车道。 */
function gate() {
	let open;
	const promise = new Promise((resolve) => {
		open = resolve;
	});
	return { promise, open: () => open() };
}

test("记忆车道：narrate 之后 memory.job 取任务包，抽出的候选原样进 memory.submit", async (t) => {
	let seen;
	const table = await openTable({ responses: keeperTurn() });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([
		(context) => {
			seen = context;
			return fauxAssistantMessage(
				JSON.stringify({
					candidates: [
						{
							kind: "knowledge",
							subject: "托马斯·海耶斯",
							knowers: ["托马斯·海耶斯"],
							statement: "地窖门的门框上有指甲划痕。",
							privacy: "player_safe",
							state: "accurate",
							confidence: 0.8,
							// 机器键：契约 §12.3 说内核会整批拒，扩展在送出去之前就摘掉。
							turn: 1,
							commit: "abc1234",
						},
						{ kind: "不认识的种类", subject: "world", statement: "这条形状不对，应该被丢掉。" },
					],
				}),
			);
		},
	]);

	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.submit").length > 0, { label: "memory.submit" });

	const [job] = calls(table, "memory.job");
	assert.ok(job, "narrate 之后先取任务包");
	assert.deepEqual(job.params, { campaign: "test-camp", turn: 1 }, "任务包按已提交的那一回合取，不带 call_id");

	const [submit] = calls(table, "memory.submit");
	assert.equal(submit.params.job_id, "extract:test-camp:t1");
	assert.equal(submit.params.candidates.length, 1, "形状不对的那条在提交前就被丢掉");
	assert.deepEqual(submit.params.candidates[0], {
		kind: "knowledge",
		subject: "托马斯·海耶斯",
		statement: "地窖门的门框上有指甲划痕。",
		knowers: ["托马斯·海耶斯"],
		privacy: "player_safe",
		state: "accurate",
		confidence: 0.8,
	}, "闭合字段之外的机器键不往内核送");

	assert.ok(seen, "记忆车道确实起了一次子会话");
	assert.equal(seen.tools, undefined, "零工具会话：不给模型任何工具");
	assert.match(seen.systemPrompt, /只写这一回合新出现的事实/, "系统提示用的是任务包里内核写的那段指令");
	const input = seen.messages.map((message) => message.content.map((block) => block.text).join("")).join("\n");
	assert.match(input, /门框上有一道深深的抓痕。/, "守秘人交付的正文进了任务包");
	assert.match(input, /可用名字/, "名字清单进了任务包");
	assert.ok(!input.includes("abc1234"), "commit 只回填遥测，不进模型提示");

	const row = await waitForLaneRow(table, "memory");
	assert.equal(row.ok, true);
	assert.equal(row.turn, 1);
	assert.equal(row.job_id, "extract:test-camp:t1");
	assert.equal(row.candidates, 1);
	assert.equal(row.model, "memory/m1");
});

test("校验车道：读正文与两份事实清单，发现交给 table.warn", async (t) => {
	let seen;
	const table = await openTable({ responses: keeperTurn() });
	t.after(() => table.dispose());
	table.lanes.verifier.setResponses([
		(context) => {
			seen = context;
			return fauxAssistantMessage(
				`\`\`\`json\n${JSON.stringify({
					findings: [
						{ kind: "reveal", quote: "门框上有一道深深的抓痕。", why: "地窖的抓痕还没被玩家发现。" },
						{ kind: "没这一类", quote: "随便", why: "闭合枚举之外的整条丢掉" },
						{ kind: "player_agency", quote: "缺 why 的一条" },
					],
				})}\n\`\`\``,
			);
		},
	]);

	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "table.warn").length > 0, { label: "table.warn" });

	const [warn] = calls(table, "table.warn");
	assert.equal(warn.params.campaign, "test-camp");
	assert.equal(warn.params.turn, 1);
	assert.equal(warn.params.lane, "verifier");
	assert.equal(warn.params.call_id, undefined, "车道的 RPC 不带 call_id");
	assert.deepEqual(warn.params.findings, [
		{ kind: "reveal", quote: "门框上有一道深深的抓痕。", why: "地窖的抓痕还没被玩家发现。" },
	]);

	assert.ok(seen, "校验车道确实起了一次子会话");
	assert.equal(seen.tools, undefined, "零工具会话");
	const input = seen.messages.map((message) => message.content.map((block) => block.text).join("")).join("\n");
	assert.match(input, /门框上有一道深深的抓痕。/, "读的是交付的正文");
	assert.ok(!input.includes("【明骰】"), "机制行不进车道：那是内核按收据插的，不是叙述");
	assert.match(input, /托马斯·海耶斯用侦查看门框，通过。/, "已提交事实清单在输入里");
	assert.match(input, /看门人的秘密/, "守秘人专属事实清单在输入里");

	const row = await waitForLaneRow(table, "verifier");
	assert.equal(row.ok, true);
	assert.equal(row.turn, 1);
	assert.equal(row.findings, 1);
	assert.equal(row.model, "verifier/v1");
});

test("提交载荷上总线：campaign、turn、commit、job_id、facts、rendered_text 一个不少", async (t) => {
	const table = await openTable({ responses: keeperTurn() });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([fauxAssistantMessage(JSON.stringify({ candidates: [] }))]);
	table.lanes.verifier.setResponses([fauxAssistantMessage(JSON.stringify({ findings: [] }))]);

	await table.session.prompt("我检查地窖门的门框");

	const [payload] = table.committed();
	assert.ok(payload, "narrate 成功后总线上应该有一条 coc:turn-committed");
	assert.equal(payload.campaign, "test-camp");
	assert.equal(payload.turn, 1);
	assert.equal(payload.commit, "abc1234");
	assert.equal(payload.job_id, "extract:test-camp:t1");
	assert.equal(payload.rendered_text, RENDERED);
	assert.deepEqual(Object.keys(payload.facts).sort(), ["committed", "keeper_only"]);
});

test("内核不回 facts 时校验车道不跑：没有事实清单就没有可校验的", async (t) => {
	const table = await openTable({ env: { FAKE_KERNEL_NO_FACTS: "1" }, responses: keeperTurn() });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([fauxAssistantMessage(JSON.stringify({ candidates: [] }))]);
	table.lanes.verifier.setResponses([fauxAssistantMessage(JSON.stringify({ findings: [] }))]);

	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.submit").length > 0, { label: "memory.submit" });

	assert.equal(calls(table, "table.warn").length, 0, "切片 0、1 的内核没有 facts，校验车道整条不起");
	assert.deepEqual(laneRows(table, "verifier"), [], "不起就不落遥测，也不算失败");
	assert.equal(table.lanes.verifier.getPendingResponseCount(), 1, "校验车道那个模型一次都没被叫过");
	assert.equal((await waitForLaneRow(table, "memory")).ok, true, "记忆车道照跑：任务包由内核按回合出，不看 facts");
});

test("交付不等车道：正文换完的时候两条车道都还没跑完", async (t) => {
	const held = gate();
	const table = await openTable({ responses: keeperTurn() });
	t.after(() => {
		held.open();
		return table.dispose();
	});
	table.lanes.memory.setResponses([
		async () => {
			await held.promise;
			return fauxAssistantMessage(JSON.stringify({ candidates: [] }));
		},
	]);
	table.lanes.verifier.setResponses([
		async () => {
			await held.promise;
			return fauxAssistantMessage(JSON.stringify({ findings: [] }));
		},
	]);

	await table.session.prompt("我检查地窖门的门框");

	assert.equal(assistantTexts(table.session).filter((text) => text.length > 0).at(-1), RENDERED, "交付已经是内核渲染的文本");
	assert.equal(calls(table, "memory.submit").length, 0, "记忆车道还卡在模型那儿");
	assert.equal(calls(table, "table.warn").length, 0, "校验车道也还没回来");

	held.open();
	await waitFor(() => calls(table, "memory.submit").length > 0 && calls(table, "table.warn").length > 0, {
		label: "两条车道收尾",
	});
	assert.equal(assistantTexts(table.session).filter((text) => text.length > 0).at(-1), RENDERED, "车道跑完也不改交付");
});

test("车道模型出错：记忆落 memory.fail，校验只落遥测，都不催守秘人、不动回合", async (t) => {
	// 两个车道的假 provider 都不给回答：每次调用都回一条错误消息。
	const table = await openTable({ responses: keeperTurn() });
	t.after(() => table.dispose());

	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.fail").length > 0, { label: "memory.fail" });
	const verifier = await waitForLaneRow(table, "verifier");
	const failed = await waitForLaneRow(table, "memory");

	const [fail] = calls(table, "memory.fail");
	assert.equal(fail.params.job_id, "extract:test-camp:t1");
	assert.equal(fail.params.reason, "model_error", "reason 取的是 backlog 的闭合枚举");
	assert.match(String(fail.params.detail), /faux/i);
	assert.equal(calls(table, "memory.submit").length, 0, "抽不出来就不提交");
	assert.equal(
		table.telemetry().filter((row) => row.method === "memory.job").length + calls(table, "memory.job").length,
		1,
		"一个任务包只取一次，重试重试的是子会话与提交",
	);

	assert.equal(failed.ok, false);
	assert.equal(failed.reason, "model_error");
	assert.equal(verifier.ok, false);
	assert.equal(calls(table, "table.warn").length, 0, "校验车道自己出错时不写 warn");

	assert.deepEqual(customMessages(table.session, "coc-host"), [], "车道失败不发宿主消息，不催守秘人");
	assert.equal(calls(table, "table.player_input").length, 1, "回合数没变");
	assert.equal(calls(table, "table.narrate").length, 1, "也没重开回合");
	assert.equal(assistantTexts(table.session).filter((text) => text.length > 0).at(-1), RENDERED, "交付不受影响");
});

test("连着两次提交：记忆车道排队，不重叠", async (t) => {
	const first = gate();
	let inFlight = 0;
	let maxInFlight = 0;
	const table = await openTable({
		responses: [...keeperTurn("第一回合的正文。"), ...keeperTurn("第二回合的正文。")],
	});
	t.after(() => {
		first.open();
		return table.dispose();
	});
	const responder = (blockOn) => async () => {
		inFlight += 1;
		maxInFlight = Math.max(maxInFlight, inFlight);
		try {
			if (blockOn) await blockOn.promise;
			return fauxAssistantMessage(JSON.stringify({ candidates: [] }));
		} finally {
			inFlight -= 1;
		}
	};
	table.lanes.memory.setResponses([responder(first), responder(undefined)]);

	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.job").length === 1, { label: "第一个任务包" });
	await table.session.prompt("我推开地窖门");

	assert.equal(calls(table, "memory.job").length, 1, "第一个任务还没跑完，第二个只排队，不去取任务包");

	first.open();
	await waitFor(() => calls(table, "memory.submit").length === 2, { label: "两个任务都收尾" });
	assert.equal(maxInFlight, 1, "同一时刻只有一个子会话在跑");
	assert.deepEqual(
		calls(table, "memory.job").map((entry) => entry.params.turn),
		[1, 2],
		"两个回合各取一次任务包，按提交顺序",
	);
});

test("车道模型来自环境变量：认 provider/model，认不出就只落遥测不动内核", async (t) => {
	const table = await openTable({
		responses: keeperTurn(),
		// 校验车道点名一个不存在的模型；记忆车道用默认的 memory/m1。
		env: { PI_COC_VERIFIER_MODEL: "verifier/没这个模型" },
	});
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([fauxAssistantMessage(JSON.stringify({ candidates: [] }))]);

	await table.session.prompt("我检查地窖门的门框");
	const verifier = await waitForLaneRow(table, "verifier");
	await waitFor(() => calls(table, "memory.submit").length > 0, { label: "memory.submit" });

	assert.equal(verifier.ok, false);
	assert.equal(verifier.reason, "model_unavailable");
	assert.match(String(verifier.detail), /PI_COC_VERIFIER_MODEL/);
	assert.equal(calls(table, "table.warn").length, 0, "模型都解析不出来，不写 warn");

	assert.equal((await waitForLaneRow(table, "memory")).model, "memory/m1", "另一条车道照走 PI_COC_MEMORY_MODEL");
});

test("不点名模型时两条车道都跟桌子同模型", async (t) => {
	// 队列里的每一步都按 systemPrompt 判断是谁在问，所以三方谁先要都拿得到对的回答。
	const responder = (context) => {
		if (/校验/.test(context.systemPrompt ?? "")) {
			return fauxAssistantMessage(JSON.stringify({ findings: [] }));
		}
		if (/候选/.test(context.systemPrompt ?? "")) {
			return fauxAssistantMessage(JSON.stringify({ candidates: [] }));
		}
		return fauxAssistantMessage("守秘人在 narrate 之后又写的正文，应该被换掉");
	};
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门框上有一道深深的抓痕。" })], { stopReason: "toolUse" }),
			responder,
			responder,
			responder,
		],
		env: { PI_COC_VERIFIER_MODEL: undefined, PI_COC_MEMORY_MODEL: undefined },
	});
	t.after(() => table.dispose());

	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "table.warn").length > 0 && calls(table, "memory.submit").length > 0, {
		label: "两条车道收尾",
	});

	assert.equal((await waitForLaneRow(table, "verifier")).model, "faux/faux-1", "校验车道缺省用桌子的模型");
	assert.equal((await waitForLaneRow(table, "memory")).model, "faux/faux-1", "记忆车道同理");
	assert.equal(assistantTexts(table.session).filter((text) => text.length > 0).at(-1), RENDERED);
});

test("重开桌子：胶囊自己带 resume，宿主不为它多发一条消息", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_RESUME: "1" },
		responses: keeperTurn(),
	});
	t.after(() => table.dispose());

	await table.session.prompt("我检查地窖门的门框");

	assert.deepEqual(
		customMessages(table.session, "coc-host"),
		[],
		"平常的重开不注入宿主消息：恢复说明在胶囊的 resume 节里（契约 §12.2）",
	);
	assert.equal(calls(table, "table.player_input").length, 1, "重开后第一条玩家输入照常进内核");
});

test("回合中途断了：恢复消息里带检查点的那一句话", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_PENDING: "1", FAKE_KERNEL_RESUME: "1" },
		responses: keeperTurn("接着把这一回合做完。"),
	});
	t.after(() => table.dispose());

	const host = await waitFor(() => customMessages(table.session, "coc-host")[0], { label: "恢复消息" });
	assert.match(String(host.content), /上次提交停在：第 0 回合：科比特宅/, "resume.one_line 进了恢复消息");
	assert.match(String(host.content), /我下地窖/, "玩家原文照旧在里面");
	assert.match(String(host.content), /还欠：narrate/);
});
