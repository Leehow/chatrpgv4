/**
 * narrate 之后的两条车道（契约 §12.5、§12.8）：记忆抽取与 advisory 校验。
 * 两条都在交付之后跑、都不阻塞、出错都只落遥测。
 *
 * 车道模型走的是 harness 里那两个专属的假 provider（verifier/v1、memory/m1），
 * 各有各的回答队列；想验「缺省与桌子同模型」的用例把环境变量显式删掉。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, waitFor } from "./harness.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 交付就是守秘人的正文原样（契约 §16.1）：内核不再往里插机制行。 */
const RENDERED = "门框上有一道深深的抓痕。";

/** Current prompt after replaying every system message in a TranscriptContext. */
const promptOf = (context) => getCurrentSystemPrompt(context.messages);
/** Conversational text only. System messages carry a string, not content blocks. */
const conversationalText = (messages) => messages
	.filter((message) => message.role !== "system")
	.map((message) => message.content.map((block) => block.text).join(""))
	.join("\n");

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
	assert.ok(promptOf(seen).includes("promise"), "字段规则里要列出 promise，否则模型根本不知道可以写");
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
	assert.deepEqual(getCurrentTools(seen.messages), [], "零工具会话：不给模型任何工具");
	assert.match(promptOf(seen), /只写这一回合新出现的事实/, "系统提示用的是任务包里内核写的那段指令");
	const input = conversationalText(seen.messages);
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
	assert.match(promptOf(seen), /refusing a commission.*never aligned/);
	const input = conversationalText(seen.messages);
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
	const input = conversationalText(repairedContext.messages);
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



// Section 166 retires automatic prose-review integration cases.
// Current no-review delivery coverage: single-pass-narration.test.mjs and post-delivery-continuity.test.mjs.
