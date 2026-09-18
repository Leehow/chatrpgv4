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
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("the existing memory lane submits one bounded story assessment when the kernel supplies causal context", async (t) => {
	let seen;
	const table = await openTable({ responses: keeperTurn(), env: {FAKE_KERNEL_STORY: "1"} });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([(context) => {
		seen = context;
		return fauxAssistantMessage(JSON.stringify({candidates: [], story: {
			status: "misframed", thread: "house-haunting", frame: "我检查地窖门的门框",
			bridge_delivered: false, delivery_quote: null
		}}));
	}]);
	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.submit").length > 0, {label: "story assessment submission"});
	const submit = calls(table, "memory.submit")[0];
	assert.deepEqual(submit.params.story, {status: "misframed", thread: "house-haunting", frame: "我检查地窖门的门框",
		bridge_delivered: false, delivery_quote: null});
	assert.match(seen.systemPrompt, /refusing a commission.*never aligned/);
	const input = seen.messages.map(message => message.content.map(block => block.text).join("")).join("\n");
	assert.match(input, /Keeper-only story context/);
	await waitFor(() => laneRows(table, "memory").some(row => row.story_status === "misframed"), {label: "story assessment telemetry"});
});

test("a repeated JSON value after the first complete lane object cannot corrupt a valid story assessment", async (t) => {
	const table = await openTable({ responses: keeperTurn(), env: {FAKE_KERNEL_STORY: "1"} });
	t.after(() => table.dispose());
	const first = {candidates: [], story: {status: "misframed", thread: "house-haunting",
		frame: "我检查地窖门的门框", bridge_delivered: false, delivery_quote: null}};
	table.lanes.memory.setResponses([fauxAssistantMessage(`${JSON.stringify(first)}\n${JSON.stringify({ignored: true})}`)]);
	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.submit").length > 0, {label: "first complete JSON submitted"});
	assert.deepEqual(calls(table, "memory.submit")[0].params.story, first.story);
});

test("a malformed first story object gives its parse failure to the one existing retry", async (t) => {
	let repairedContext;
	const table = await openTable({ responses: keeperTurn(), env: {FAKE_KERNEL_STORY: "1"} });
	t.after(() => table.dispose());
	const valid = {candidates: [], story: {status: "detached", thread: "house-haunting",
		frame: "我检查地窖门的门框", bridge_delivered: false, delivery_quote: null}};
	table.lanes.memory.setResponses([
		fauxAssistantMessage('{"candidates":[],"story":'),
		(context) => { repairedContext = context; return fauxAssistantMessage(JSON.stringify(valid)); },
	]);
	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.submit").length > 0, {label: "repaired story submission"});
	assert.deepEqual(calls(table, "memory.submit")[0].params.story, valid.story);
	const input = repairedContext.messages.map(message => message.content.map(block => block.text).join("")).join("\n");
	assert.match(input, /Previous attempt failed/);
	assert.match(input, /no JSON object/);
});

test("a malformed story assessment is retained as the existing memory backlog and never partially submitted", async (t) => {
	const table = await openTable({ responses: keeperTurn(), env: {FAKE_KERNEL_STORY: "1"} });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([
		fauxAssistantMessage(JSON.stringify({candidates: []})),
		fauxAssistantMessage(JSON.stringify({candidates: [], story: {status: "misframed", thread: "house-haunting",
			frame: "not in player input", bridge_delivered: false, delivery_quote: null}})),
	]);
	await table.session.prompt("我检查地窖门的门框");
	await waitFor(() => calls(table, "memory.fail").length > 0, {label: "malformed story backlog"});
	assert.equal(calls(table, "memory.submit").length, 0);
	assert.equal(calls(table, "memory.fail")[0].params.reason, "model_error");
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
						{ kind: "play_language_mismatch", quote: "门框上有一道深深的抓痕。", why: "这一句不是战役的玩家语言。" },
						{ kind: "investigator_identity_mismatch", quote: "门框上有一道深深的抓痕。", why: "称呼与调查员身份冲突。" },
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
		// 第四类（§23，2026-09-09）：内核不再按脚本拒交付，用没用玩家语言由车道读了以后报，
		// 和另外三类一样是建议。`why` 仍写在战役的语言里。
		{ kind: "play_language_mismatch", quote: "门框上有一道深深的抓痕。", why: "这一句不是战役的玩家语言。" },
		{ kind: "investigator_identity_mismatch", quote: "门框上有一道深深的抓痕。", why: "称呼与调查员身份冲突。" },
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
	assert.equal(row.findings, 3, "三条留下来了：闭合枚举之外那条和缺 why 那条被丢掉");
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

test("不点名环境变量的车道跟 App 的车道模型设置；点了名的仍以变量为准（§109.3）", async (t) => {
	// 直到 §109，面板里那一个「车道模型」只到得了 mod 子进程；准入、校验、记忆这些零工具车道
	// 仍跟桌子，于是把桌子放在慢模型上时，玩家等的恰是没被设置动到的那条（准入 p50 20 s / p90 79 s）。
	const agentHome = mkdtempSync(join(tmpdir(), "pi-coc-lane-setting-"));
	writeFileSync(join(agentHome, "pipiui-settings.json"), JSON.stringify({
		extensions: { "coc-keeper": { settings: { "ext.coc-keeper.laneModel": { model: "verifier/v1" } } } },
	}));
	const table = await openTable({
		responses: keeperTurn(),
		// 校验车道不点名变量：应当跟设置里的 verifier/v1（那条假供应商自己的队列），而不是桌子的 faux/faux-1。
		// 记忆车道仍点名 memory/m1。
		env: { PI_COC_VERIFIER_MODEL: undefined, PI_CODING_AGENT_DIR: agentHome },
		laneResponses: { verifier: [fauxAssistantMessage(JSON.stringify({ findings: [] }))], memory: [noCandidates()] },
	});
	t.after(() => table.dispose());

	await table.session.prompt("我检查地窖门的门框");
	const verifier = await waitForLaneRow(table, "verifier");
	assert.deepEqual([verifier.model, verifier.ok], ["verifier/v1", true], "没点名变量的车道跟设置，不跟桌子");
	assert.equal((await waitForLaneRow(table, "memory")).model, "memory/m1", "点了名的变量仍然赢过设置");
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

// ---- 车道调用的四行（契约 §12.8.1，#67 第 1 步）------------------------------
//
// `ctx.modelRegistry.complete()` 不经过扩展运行器，所以 `before_provider_request` /
// `after_provider_response` 对车道一行都不写（依据在 docs/pi-host-contract.md 的
// Provider latency evidence 一节）。`runLane` 因此自己在 `complete()` 前后各记一行，
// 并把 provider 那一跳的两个回调记成中间两行。

/** 某条车道这一局留下的 `lane: "lane-call"` 行，按到达顺序。 */
function laneCallRows(table, subsession) {
	return table.telemetry().filter((row) => row.lane === "lane-call" && row.subsession === subsession);
}

function laneCallPhase(table, subsession, phase) {
	return laneCallRows(table, subsession).filter((row) => row.phase === phase);
}

function waitForLaneCallPhase(table, subsession, phase) {
	return waitFor(() => laneCallPhase(table, subsession, phase).at(-1), { label: `${subsession} 车道的 ${phase} 行` });
}

test("车道调用留四行：补全自己计时，与车道其余部分分开（#67）", async (t) => {
	const table = await openTable({ responses: keeperTurn() });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([noCandidates()]);
	table.lanes.verifier.setResponses([fauxAssistantMessage(JSON.stringify({ findings: [] }))]);

	await table.session.prompt("我检查地窖门的门框");
	const laneRow = await waitForLaneRow(table, "verifier");
	await waitForLaneCallPhase(table, "verifier", "end");

	const rows = laneCallRows(table, "verifier");
	assert.deepEqual(
		rows.map((row) => row.phase),
		["start", "request", "response", "end"],
		"一次车道调用恰好四行，顺序就是请求体上线、响应头到、补全落定",
	);
	for (const row of rows) {
		assert.equal(row.subsession, "verifier", "每一行都说得出自己是哪条车道的");
		assert.equal(row.turn, 1, "每一行都落在这一回合上");
		assert.match(String(row.at), /^\d{4}-\d{2}-\d{2}T/, "每一行都有 ISO 时间戳");
	}

	const [start, request, response, end] = rows;
	assert.equal(start.model, "verifier/v1", "起跑行记的是解析出来的 provider/model");
	assert.equal(start.ms, undefined, "起跑行不记 ms：它就是 ms 的原点");
	assert.equal(request.model, "v1", "请求行记的是请求体里的模型 id");
	assert.equal(response.status, 200);
	assert.equal(end.ok, true);
	assert.equal(end.stop_reason, "stop");

	for (const row of [request, response, end]) assert.equal(typeof row.ms, "number", `${row.phase} 行带 ms`);
	assert.ok(request.ms <= response.ms, "ms 都从起跑行算起，所以请求不晚于响应");
	assert.ok(response.ms <= end.ms, "响应头不晚于补全落定");

	// 这就是拆不开的那个数被拆开：车道那一行仍然只有一个 ms，但它现在减得动了。
	assert.equal(laneRows(table, "verifier").length, 1, "原来那一行还是恰好一行，条数与字段都没被动过");
	assert.equal(laneRow.ok, true);
	assert.ok(laneRow.ms >= end.ms, "车道那一行盖住补全，二者之差就是提示拼装、验形与 table.warn 那段");
});

test("reasoning 档记的是出站请求体里真写着的那个（#67）", async (t) => {
	const table = await openTable({ responses: [...keeperTurn("第一回合的交付。"), ...keeperTurn("第二回合的交付。")] });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([noCandidates(), noCandidates()]);
	table.lanes.verifier.setResponses([
		fauxAssistantMessage(JSON.stringify({ findings: [] })),
		fauxAssistantMessage(JSON.stringify({ findings: [] })),
	]);

	// 第一回合：请求体里根本没有 reasoning 字段。xai/grok-4.6 的 `thinkingLevelMap.off` 是 null，
	// 而 runLane 一个 thinking 档都不传，真实的车道请求就是这个形状——档由供应商自己定。
	await table.session.prompt("第一句");
	await waitForLaneCallPhase(table, "verifier", "end");
	assert.equal(laneCallPhase(table, "verifier", "request").at(-1).reasoning_effort, null, "请求体里没有 reasoning 字段就记 null，不猜");

	// 第二回合：请求体里嵌套着 reasoning.effort。同一行改口，证明它读的是请求体不是常量。
	table.lanes.verifier.setTransport({ body: { model: "v1", messages: [], stream: true, reasoning: { effort: "low" } } });
	await table.session.prompt("第二句");
	await waitFor(() => laneCallPhase(table, "verifier", "request").length === 2, { label: "第二回合的请求行" });
	assert.equal(laneCallPhase(table, "verifier", "request").at(-1).reasoning_effort, "low", "嵌套的 reasoning.effort 读得到");
});

test("扁平的 reasoning_effort 也读得到，与 provider 行同一条读法（#67）", async (t) => {
	const table = await openTable({ responses: keeperTurn() });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([noCandidates()]);
	table.lanes.verifier.setResponses([fauxAssistantMessage(JSON.stringify({ findings: [] }))]);
	table.lanes.verifier.setTransport({ body: { model: "v1", messages: [], stream: true, reasoning_effort: "medium" } });

	await table.session.prompt("我检查地窖门的门框");
	const request = await waitForLaneCallPhase(table, "verifier", "request");
	assert.equal(request.reasoning_effort, "medium");
});

test("响应行只记状态与白名单 request-id，别的头一个字都不进遥测（#67）", async (t) => {
	const table = await openTable({ responses: keeperTurn() });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([noCandidates()]);
	table.lanes.verifier.setResponses([fauxAssistantMessage(JSON.stringify({ findings: [] }))]);
	table.lanes.verifier.setTransport({
		status: 429,
		headers: {
			"X-Request-Id": "req-42",
			authorization: "Bearer sk-绝不能进遥测",
			"set-cookie": "session=也不能",
			"x-ratelimit-remaining": "9",
		},
	});

	await table.session.prompt("我检查地窖门的门框");
	const response = await waitForLaneCallPhase(table, "verifier", "response");

	assert.equal(response.status, 429, "状态码原样");
	assert.equal(response.request_id, "req-42", "大小写不同的 X-Request-Id 也认得");
	const everything = JSON.stringify(laneCallRows(table, "verifier"));
	assert.ok(!everything.includes("sk-绝不能进遥测"), "凭据不进遥测");
	assert.ok(!everything.includes("set-cookie") && !everything.includes("session=也不能"), "cookie 不进遥测");
	assert.ok(!everything.includes("ratelimit"), "没登记的头一律不记");
	assert.ok(!everything.includes("门框上有一道深深的抓痕"), "车道的输入是守秘人正文，出不了这条路");
});

test("同一处埋点让两条车道都可见：记忆车道也留同样的四行（#67）", async (t) => {
	const table = await openTable({ responses: keeperTurn() });
	t.after(() => table.dispose());
	table.lanes.memory.setResponses([noCandidates()]);
	table.lanes.verifier.setResponses([fauxAssistantMessage(JSON.stringify({ findings: [] }))]);
	table.lanes.memory.setTransport({ headers: { "request-id": "mem-7" } });

	await table.session.prompt("我检查地窖门的门框");
	await waitForLaneCallPhase(table, "memory", "end");

	const rows = laneCallRows(table, "memory");
	assert.deepEqual(
		rows.map((row) => row.phase),
		["start", "request", "response", "end"],
	);
	assert.equal(rows[0].model, "memory/m1");
	assert.equal(rows[2].request_id, "mem-7", "另一个白名单名字也认得");
	assert.equal(rows[3].ok, true);
	for (const row of rows) {
		assert.equal(row.subsession, "memory");
		assert.equal(row.job_id, "extract:test-camp:t1", "记忆车道的行还说得出是哪个任务");
	}
	// 记忆车道那一行是任务收尾时才写的，比 `end` 晚：等它落，再数。
	await waitForLaneRow(table, "memory");
	assert.equal(laneRows(table, "memory").length, 1, "记忆车道原来那一行也还是一行");
});

test("等响应头时被砍：只有请求行、没有响应行，那就是这次超时的形状（#67）", async (t) => {
	const held = gate();
	const table = await openTable({ responses: keeperTurn(), env: { PI_COC_LANE_TIMEOUT_MS: "30" } });
	t.after(() => {
		held.open();
		return table.dispose();
	});
	table.lanes.memory.setResponses([noCandidates()]);
	table.lanes.verifier.setResponses([fauxAssistantMessage(JSON.stringify({ findings: [] }))]);
	// 停在响应头到达之前：请求发出去了，头一直不来。
	table.lanes.verifier.setTransport({ holdHeaders: held.promise });

	await table.session.prompt("我检查地窖门的门框");
	const row = await waitForLaneRow(table, "verifier");
	assert.equal(row.reason, "timeout");

	const phases = laneCallRows(table, "verifier").map((entry) => entry.phase);
	assert.deepEqual(phases, ["start", "request"], "请求行有、响应行没有——这一次是在等响应头，不是在等流");
});
