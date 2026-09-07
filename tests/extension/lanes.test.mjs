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

/** 交付就是守秘人的正文原样（契约 §16.1）：内核不再往里插机制行。 */
const RENDERED = "门框上有一道深深的抓痕。";

function keeperTurn(text = "门框上有一道深深的抓痕。") {
	return [
		fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
		fauxAssistantMessage("守秘人在 narrate 之后又写的正文，应该被换掉"),
	];
}

function calls(table, method) {
	return table.kernelRequests().filter((entry) => entry.method === method);
}

/**
 * 桌上那条抽取：刚提交的回合永远带显式 `turn`。补抽（#20）用的是缺省派发，
 * 不带 `turn`，每次开桌都会问一次内核「还有坑要补吗」——那条不算在这里。
 */
function turnJobs(table) {
	return calls(table, "memory.job").filter((entry) => entry.params.turn !== undefined);
}

/** 补抽那条：缺省派发不带 `turn`，内核自己挑还没抽过的回合（#20）。 */
function backfillJobs(table) {
	return calls(table, "memory.job").filter((entry) => entry.params.turn === undefined);
}

/** 让 fire-and-forget 的车道有机会再走一步；用来证明「没有下一个」而不是「还没到」。 */
function settle(ms = 120) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const noCandidates = () => fauxAssistantMessage(JSON.stringify({ candidates: [] }));

function laneRows(table, lane) {
	return table.telemetry().filter((row) => row.lane === lane);
}

/** 遥测是车道自己写的最后一步，比内核那边的请求日志晚一点：断言前先等它落。 */
function waitForLaneRow(table, lane) {
	return waitFor(() => laneRows(table, lane).at(-1), { label: `${lane} 车道遥测` });
}

/**
 * 等车道把第 n 个任务收完。
 *
 * 「收完」的判据只能是遥测行，不能是 `memory.submit` 的条数：那一笔是假内核**收到**请求就记的，
 * 而车道要等回执回来、再 `await` 一次落盘才写遥测行。等提交条数就会在最后一行还没落盘的时候放行，
 * 于是「四个任务都收尾」之后只看得见三行——#20 那两条用例间歇红的就是这个缝。
 * 任务之间是串行的（`pump` 一个跑完才起下一个），所以第 n 行落了，前 n 个任务的全部副作用都已落定。
 */
function waitForLaneRows(table, lane, count) {
	return waitFor(() => laneRows(table, lane).length >= count, { label: `${lane} 车道第 ${count} 行遥测` });
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
						{
							// §13.5：承诺是闭合枚举里的一种。这一条曾经既不被提示、也过不了车道自己的
							// 白名单——真桌十五回合抽出 101 条候选，promise 一条也没有，于是
							// obligations.promise 与 NPC 的 history.promises 永远是空的。
							kind: "promise",
							subject: "史蒂文·诺特",
							knowers: ["史蒂文·诺特"],
							entities: ["托马斯·海耶斯"],
							statement: "洗清宅子的名声就再付三十美元。",
							privacy: "player_safe",
							state: "accurate",
							confidence: 0.9,
						},
						{ kind: "不认识的种类", subject: "world", statement: "这条形状不对，应该被丢掉。" },
					],
				}),
			);
		},
	]);

	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.submit").length > 0, { label: "memory.submit" });

	const [job] = turnJobs(table);
	assert.ok(job, "narrate 之后先取任务包");
	assert.deepEqual(job.params, { campaign: "test-camp", turn: 1 }, "任务包按已提交的那一回合取，不带 call_id");

	const [submit] = calls(table, "memory.submit");
	assert.equal(submit.params.job_id, "extract:test-camp:t1");
	assert.equal(submit.params.candidates.length, 2, "形状不对的那条在提交前就被丢掉");
	assert.ok(seen.systemPrompt.includes("promise"), "字段规则里要列出 promise，否则模型根本不知道可以写");
	const promise = submit.params.candidates.find((row) => row.kind === "promise");
	assert.ok(promise, "承诺必须能过车道自己的白名单");
	assert.equal(promise.statement, "洗清宅子的名声就再付三十美元。");
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
	assert.match(input, /Available names/, "名字清单进了任务包");
	assert.ok(!input.includes("abc1234"), "commit 只回填遥测，不进模型提示");

	const row = await waitForLaneRow(table, "memory");
	assert.equal(row.ok, true);
	assert.equal(row.turn, 1);
	assert.equal(row.job_id, "extract:test-camp:t1");
	assert.equal(row.candidates, 2, "遥测数的是送进内核的条数：知识那条加承诺那条");
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
	assert.ok(!input.includes("Spot Hidden"), "机制投影不进车道：车道读的是正文加两份事实清单（契约 §12.5）");
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

test("内核不回 facts 时校验车道不跑，但「没跑」也留一行带原因码的遥测（#28）", async (t) => {
	const table = await openTable({ env: { FAKE_KERNEL_NO_FACTS: "1" }, responses: keeperTurn() });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([fauxAssistantMessage(JSON.stringify({ candidates: [] }))]);
	table.lanes.verifier.setResponses([fauxAssistantMessage(JSON.stringify({ findings: [] }))]);

	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.submit").length > 0, { label: "memory.submit" });

	assert.equal(calls(table, "table.warn").length, 0, "切片 0、1 的内核没有 facts，校验车道整条不起");
	assert.equal(table.lanes.verifier.getPendingResponseCount(), 1, "校验车道那个模型一次都没被叫过");

	// 真桌证据（toomany-s4 第 3、4、14 回合）：不跑就一行都不留，事后没人看得出来。
	const rows = await waitFor(() => (laneRows(table, "verifier").length > 0 ? laneRows(table, "verifier") : undefined), {
		label: "校验车道「没跑」的遥测",
	});
	assert.equal(rows.length, 1, "narrate 关掉的回合恰好一行校验车道遥测");
	assert.equal(rows[0].ok, false);
	assert.equal(rows[0].ran, false, "这一行说的是「没跑」，不是「跑了没发现」");
	assert.equal(rows[0].reason, "no_facts");
	assert.equal(rows[0].turn, 1);

	assert.equal((await waitForLaneRow(table, "memory")).ok, true, "记忆车道照跑：任务包由内核按回合出，不看 facts");
});

test("车道超时也留一行：模型不回答时按 PI_COC_LANE_TIMEOUT_MS 掐断并记 timeout（#28）", async (t) => {
	const held = gate();
	const table = await openTable({
		responses: keeperTurn(),
		// 校验车道 30 毫秒就掐；记忆车道不给 timeoutMs，走它自己的老路。
		env: { PI_COC_LANE_TIMEOUT_MS: "30" },
	});
	t.after(() => {
		held.open();
		return table.dispose();
	});
	table.lanes.memory.setResponses([fauxAssistantMessage(JSON.stringify({ candidates: [] }))]);
	// 一个永远不回答的模型：以前它会让车道一直挂着，一行遥测都不留。
	table.lanes.verifier.setResponses([
		async () => {
			await held.promise;
			return fauxAssistantMessage(JSON.stringify({ findings: [] }));
		},
	]);

	await table.session.prompt("我检查地窖门的门框");
	const row = await waitForLaneRow(table, "verifier");

	assert.equal(row.ok, false);
	assert.equal(row.reason, "timeout");
	assert.equal(row.turn, 1);
	assert.equal(row.model, "verifier/v1", "超时那一行照样说得出用的是哪个模型");
	assert.match(String(row.detail), /30 ms/);
	assert.equal(calls(table, "table.warn").length, 0, "超时不往内核送空发现");
	assert.equal(assistantTexts(table.session).filter((text) => text.length > 0).at(-1), RENDERED, "掐断车道不动交付");
});

test("每个 narrate 关掉的回合恰好一行校验车道遥测：三种收尾都不留静默的洞（#28）", async (t) => {
	const table = await openTable({
		responses: [
			// 第一回合：车道跑通，落 ok
			...keeperTurn("第一回合的交付。"),
			// 第二回合：车道模型出错（假 provider 的回答队列空了），落 model_error
			...keeperTurn("第二回合的交付。"),
			// 第三回合：车道模型出错，再落一行
			...keeperTurn("第三回合的交付。"),
		],
	});
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([noCandidates(), noCandidates(), noCandidates()]);
	table.lanes.verifier.setResponses([fauxAssistantMessage(JSON.stringify({ findings: [] }))]);

	await table.session.prompt("第一句");
	await table.session.prompt("第二句");
	await table.session.prompt("第三句");
	const rows = await waitFor(() => (laneRows(table, "verifier").length >= 3 ? laneRows(table, "verifier") : undefined), {
		label: "三行校验车道遥测",
	});

	assert.equal(calls(table, "table.narrate").length, 3, "三个回合都由 narrate 关掉");
	assert.equal(rows.length, 3, "一个回合一行，不多不少");
	assert.deepEqual(
		rows.map((row) => row.turn),
		[1, 2, 3],
		"每一行认得出自己是哪一回合",
	);
	assert.equal(rows[0].ok, true, "第一回合车道跑通");
	for (const row of rows.slice(1)) {
		assert.equal(row.ok, false);
		assert.ok(typeof row.reason === "string" && row.reason.length > 0, "失败的行必须带原因码");
	}
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
		table.telemetry().filter((row) => row.method === "memory.job").length + turnJobs(table).length,
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
	await waitFor(() => turnJobs(table).length === 1, { label: "第一个任务包" });
	await table.session.prompt("我推开地窖门");

	assert.equal(turnJobs(table).length, 1, "第一个任务还没跑完，第二个只排队，不去取任务包");

	first.open();
	await waitFor(() => calls(table, "memory.submit").length === 2, { label: "两个任务都收尾" });
	assert.equal(maxInFlight, 1, "同一时刻只有一个子会话在跑");
	assert.deepEqual(
		turnJobs(table).map((entry) => entry.params.turn),
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
		if (/after-the-fact verification/.test(context.systemPrompt ?? "")) {
			return fauxAssistantMessage(JSON.stringify({ findings: [] }));
		}
		if (/candidates/.test(context.systemPrompt ?? "")) {
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
	assert.match(String(host.content), /The last commit stopped at: 第 0 回合：科比特宅/, "resume.one_line 进了恢复消息");
	assert.match(String(host.content), /我下地窖/, "玩家原文照旧在里面");
	assert.match(String(host.content), /Still owed: narrate/);
});

test("补抽：开桌后按缺省派发一个一个补，内核回空就收手（#20）", async (t) => {
	const table = await openTable({
		// 上次会话留下两个没抽的回合；缺省派发按序把它们交出来，之后回 job_id: null。
		env: { FAKE_KERNEL_BACKFILL: "[3,4]" },
		laneResponses: { memory: [noCandidates(), noCandidates()] },
	});
	t.after(() => table.dispose());

	// 收手那一下才是终点：内核回空的第三次缺省派发。等它，而不是等提交条数——
	// 第二个任务的提交一送到假内核就记了一笔，那时第三次派发还没发出去。
	await waitFor(() => backfillJobs(table).length >= 3, { label: "补抽收手" });
	await settle();

	assert.deepEqual(
		backfillJobs(table).map((entry) => entry.params),
		[{ campaign: "test-camp" }, { campaign: "test-camp" }, { campaign: "test-camp" }],
		"缺省派发不带 turn：两个任务包，加上最后那次回空的",
	);
	assert.deepEqual(
		calls(table, "memory.submit").map((entry) => entry.params.job_id),
		["extract:test-camp:t3", "extract:test-camp:t4"],
		"补的是内核挑的那两个回合，不是扩展猜的",
	);
	assert.equal(turnJobs(table).length, 0, "没有桌上的回合提交，就没有带 turn 的派发");

	const rows = laneRows(table, "memory");
	assert.deepEqual(rows.map((row) => row.turn), [3, 4]);
	assert.ok(rows.every((row) => row.backfill === true), "补抽的遥测行都带 backfill: true（契约 §12.8）");
	assert.ok(rows.every((row) => row.ok === true));
});

test("补抽有上限：PI_COC_MEMORY_BACKFILL 说几个就几个（#20）", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_BACKFILL: "[3,4,5]", PI_COC_MEMORY_BACKFILL: "2" },
		laneResponses: { memory: [noCandidates(), noCandidates(), noCandidates()] },
	});
	t.after(() => table.dispose());

	// 两行遥测落了，泵才轮到「还要不要第三个」那个判断；再 settle 一下证明它答的是不要。
	await waitForLaneRows(table, "memory", 2);
	await settle();

	assert.equal(backfillJobs(table).length, 2, "预算用完就不再问内核，哪怕它那边还有得补");
	assert.deepEqual(
		calls(table, "memory.submit").map((entry) => entry.params.job_id),
		["extract:test-camp:t3", "extract:test-camp:t4"],
	);
	assert.equal(table.lanes.memory.getPendingResponseCount(), 1, "第三个任务没起，模型也就没被叫第三次");
});

test("PI_COC_MEMORY_BACKFILL=0：整条补抽关掉，桌上的抽取照旧（#20）", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_BACKFILL: "[3,4]", PI_COC_MEMORY_BACKFILL: "0" },
		responses: keeperTurn(),
		laneResponses: { memory: [noCandidates()] },
	});
	t.after(() => table.dispose());

	await table.session.prompt("我检查地窖门的门框");
	await waitForLaneRows(table, "memory", 1);
	await settle();

	assert.equal(backfillJobs(table).length, 0, "关掉之后一次缺省派发都不发");
	assert.deepEqual(
		turnJobs(table).map((entry) => entry.params.turn),
		[1],
		"刚提交的回合照样抽",
	);
	assert.equal(laneRows(table, "memory").length, 1);
	assert.equal(laneRows(table, "memory")[0].backfill, undefined, "桌上那条不是补抽，遥测行不带这个旗");
});

test("补抽让位给桌子：回合开着不起新的，刚提交的回合插在补抽前面（#20）", async (t) => {
	const firstBackfill = gate();
	const keeperHeld = gate();
	let keeperCalled = false;
	const table = await openTable({
		env: { FAKE_KERNEL_BACKFILL: "[3,4,5]", PI_COC_MEMORY_BACKFILL: "3" },
		responses: [
			async () => {
				keeperCalled = true;
				await keeperHeld.promise;
				return fauxAssistantMessage([fauxToolCall("narrate", { text: "门框上有一道深深的抓痕。" })], {
					stopReason: "toolUse",
				});
			},
			fauxAssistantMessage("守秘人在 narrate 之后又写的正文，应该被换掉"),
		],
		laneResponses: {
			memory: [
				async () => {
					await firstBackfill.promise;
					return noCandidates();
				},
				noCandidates(),
				noCandidates(),
				noCandidates(),
			],
		},
	});
	t.after(() => {
		firstBackfill.open();
		keeperHeld.open();
		return table.dispose();
	});

	// 开桌就起了第一个补抽任务，它卡在模型那儿。
	await waitFor(() => backfillJobs(table).length === 1, { label: "第一个补抽任务" });

	// 玩家开口：这一回合从此开着，守秘人也卡住。
	const turn = table.session.prompt("我检查地窖门的门框");
	await waitFor(() => keeperCalled, { label: "守秘人这一轮起跑" });

	// 放掉补抽的第一个：它跑完了，但回合还开着，所以不该有第二个补抽。
	firstBackfill.open();
	await waitForLaneRows(table, "memory", 1);
	await settle();
	assert.equal(calls(table, "memory.submit").length, 1, "回合开着的时候第二个补抽不该起跑");
	assert.equal(backfillJobs(table).length, 1, "回合开着的时候不起新的补抽");
	assert.equal(turnJobs(table).length, 0, "这一回合还没提交，也就还没有它的任务包");

	// 回合提交：它排在剩下的补抽前面。
	keeperHeld.open();
	await turn;
	await waitForLaneRows(table, "memory", 4);
	await settle();

	assert.deepEqual(
		calls(table, "memory.job").map((entry) => entry.params.turn),
		[undefined, 1, undefined, undefined],
		"刚提交的回合插在剩下的补抽前面（契约 §12.8）",
	);
	assert.deepEqual(
		calls(table, "memory.submit").map((entry) => entry.params.job_id),
		["extract:test-camp:t3", "extract:test-camp:t1", "extract:test-camp:t4", "extract:test-camp:t5"],
	);
	const rows = laneRows(table, "memory");
	assert.deepEqual(
		rows.map((row) => [row.turn, row.backfill ?? false]),
		[
			[3, true],
			[1, false],
			[4, true],
			[5, true],
		],
		"桌上那条不带 backfill 旗，补抽那三条带",
	);
});

/**
 * 上一条用例里 narrate 是回合跑到一半时提交的，`agentRunning` 还是真，所以那个顺序单靠
 * 「回合开着不起补抽」这一条就成立了——把 `nextJob` 改成先挑补抽，它照样绿。真要验
 * 「刚提交的回合插在补抽前面」，得让泵在**回合已经结束**、队列里躺着一个回合、补抽预算
 * 也还有的那一刻做选择：把第一个补抽卡在模型那儿卡过整轮，放开它时就是这个局面。
 */
test("刚提交的回合插在还没跑的补抽前面：泵先挑队列，不挑补抽（#20）", async (t) => {
	const firstBackfill = gate();
	const table = await openTable({
		env: { FAKE_KERNEL_BACKFILL: "[3,4]", PI_COC_MEMORY_BACKFILL: "2" },
		responses: keeperTurn(),
		laneResponses: {
			memory: [
				async () => {
					await firstBackfill.promise;
					return noCandidates();
				},
				noCandidates(),
				noCandidates(),
			],
		},
	});
	t.after(() => {
		firstBackfill.open();
		return table.dispose();
	});

	// 第一个补抽卡在模型那儿；整个回合从头到尾跑完，它都还没回来。
	await waitFor(() => backfillJobs(table).length === 1, { label: "第一个补抽任务" });
	await table.session.prompt("我检查地窖门的门框");
	await settle();
	assert.equal(turnJobs(table).length, 0, "泵还占着，刚提交的回合只在队列里排着，还没去取任务包");
	assert.equal(backfillJobs(table).length, 1, "也还没起第二个补抽");

	// 回合已经结束（`agentRunning` 是假），补抽预算还剩一个：泵现在真要在两者之间挑。
	firstBackfill.open();
	await waitForLaneRows(table, "memory", 3);
	await settle();

	assert.deepEqual(
		laneRows(table, "memory").map((row) => [row.turn, row.backfill ?? false]),
		[
			[3, true],
			[1, false],
			[4, true],
		],
		"队列里的回合先跑，剩下的补抽排在它后面（契约 §12.8）",
	);
	assert.deepEqual(
		calls(table, "memory.submit").map((entry) => entry.params.job_id),
		["extract:test-camp:t3", "extract:test-camp:t1", "extract:test-camp:t4"],
	);
});
