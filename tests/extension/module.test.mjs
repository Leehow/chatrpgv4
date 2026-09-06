/**
 * 模组扩展：无人值守构建的驱动循环（契约 §14.5）与按需深读车道（契约 §14.6）。
 *
 * 读者是一个子 `pi` 进程；测试里由 `PI_COC_READER_CMD` 换成假读者
 * （`fixtures/fake-reader.mjs`，接缝写在 docs/pi-host-contract.md 第 3.2 节），
 * 它做的正是读者对外可见的那件事：在工作目录里写下 `shard.json`。
 * 闸门过不过由假内核说了算（`FAKE_KERNEL_MODULE.review_pass`）。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor, waitForIdle } from "./harness.mjs";

const MODULE_ID = "they-did-not-think-it-too-many";

/** 内核收到的模组调用，按到达顺序：`方法:section`。 */
function moduleCalls(table) {
	return table
		.kernelRequests()
		.filter((entry) => entry.method.startsWith("module."))
		.map((entry) => (entry.params.section_id ? `${entry.method}:${entry.params.section_id}` : entry.method));
}

test("构建循环：计划、按 priority 逐段读、过门、接受、合并，开场就绪发总线，最后安装", async (t) => {
	const table = await openTable({
		mode: "setup",
		campaign: null,
		responses: [fauxAssistantMessage("在读书了。")],
		env: {
			FAKE_KERNEL_MODULE: JSON.stringify({
				module_id: MODULE_ID,
				sections: [
					{ id: "appendix", title: "附录", priority: 10, kind: "appendix" },
					{ id: "opening-scene", title: "开场", priority: 90, kind: "scene" },
					{ id: "front", title: "前言", priority: 100, kind: "front" },
				],
				// 开场那一段第一轮不过：带着 findings 原样重来一轮（契约 §14.5）。
				review_pass: { "opening-scene": 2 },
				opening_after: 2,
			}),
		},
	});
	t.after(() => table.dispose());

	table.emit("coc:module-build", { module_id: MODULE_ID, campaign: "setup-camp" });
	await waitFor(() => table.bus("coc:module-build-done").length > 0, { label: "构建跑完" });

	const calls = moduleCalls(table);
	// 计划：机器切法归内核，分类归一次读者，然后 plan.accept（契约 §14.3）。
	assert.equal(calls[0], "module.status", "先看看这本书读到哪儿了");
	assert.ok(calls.includes("module.plan"), "没切过 section 的书先切");
	assert.ok(calls.indexOf("module.plan.accept") > calls.indexOf("module.plan"), "分类读者跑完才接受计划");

	// priority 高的先读：front(100) → opening-scene(90) → appendix(10)。
	const packets = calls.filter((row) => row.startsWith("module.packet:"));
	assert.deepEqual(packets, [
		"module.packet:front",
		"module.packet:opening-scene",
		"module.packet:appendix",
	]);

	// 一段的次序：packet → review → accept → assemble（契约 §14.5）。
	const front = calls.slice(calls.indexOf("module.packet:front"));
	assert.equal(front[0], "module.packet:front");
	assert.equal(front[1], "module.review:front");
	assert.equal(front[2], "module.accept:front");
	assert.equal(front[3], "module.assemble", "每接受一片就增量合并");

	// 第一轮没过的那一段重来一轮，findings 原样进 brief。
	const reviews = calls.filter((row) => row === "module.review:opening-scene");
	assert.equal(reviews.length, 2, "至多三轮，这一段第二轮才过");
	const rounds = table.readerRuns().filter((row) => row.section === "opening-scene");
	assert.equal(rounds.length, 2, "读者也跑了两轮");
	assert.ok(!rounds[0].brief.includes("unknown_evidence_span"), "第一轮没有 findings");
	assert.ok(rounds[1].brief.includes("unknown_evidence_span"), "第二轮把上一轮的 findings 原样带上");
	assert.ok(rounds[1].brief.includes("grounding"), "闸门名也原样带上");

	// 开场就绪一到就发总线：建卡的 build-opening 那一步等的就是它（契约 §14.3、§14.4）。
	const ready = table.bus("coc:module-opening-ready");
	assert.equal(ready.length, 1, "只发一次");
	assert.equal(ready[0].data.module_id, MODULE_ID);
	assert.equal(ready[0].data.campaign, "setup-camp");
	const readyAt = calls.indexOf("module.packet:appendix");
	assert.ok(readyAt > 0, "开场就绪之后剩下的 section 继续读");

	assert.equal(calls.at(-1), "module.install", "全部结束才安装");
	const report = table.bus("coc:module-build-done")[0].data.report;
	assert.deepEqual(report.accepted.sort(), ["appendix", "front", "opening-scene"]);
	assert.deepEqual(report.failed, []);
	assert.equal(report.installed, true);

	// 构建遥测：每 section 每轮一行（契约 §14.1 的 build.jsonl）。
	const log = table.buildLog(MODULE_ID);
	const openingRows = log.filter((row) => row.section_id === "opening-scene");
	assert.deepEqual(
		openingRows.map((row) => [row.round, row.accepted]),
		[
			[1, false],
			[2, true],
		],
	);
	assert.deepEqual(openingRows[0].findings_codes, ["unknown_evidence_span"]);
	assert.ok(typeof openingRows[0].ms === "number", "每轮记耗时");
});

test("读者三轮都没过：这一段记 failed，循环继续，其余照样装", async (t) => {
	const table = await openTable({
		mode: "setup",
		campaign: null,
		responses: [fauxAssistantMessage("在读书了。")],
		env: {
			FAKE_KERNEL_MODULE: JSON.stringify({
				module_id: MODULE_ID,
				sections: [
					{ id: "bad", title: "读不下来的一段", priority: 100 },
					{ id: "good", title: "读得下来的一段", priority: 50 },
				],
				review_pass: { bad: 99 },
				opening_after: 1,
			}),
		},
	});
	t.after(() => table.dispose());

	table.emit("coc:module-build", { module_id: MODULE_ID });
	await waitFor(() => table.bus("coc:module-build-done").length > 0, { label: "构建跑完" });

	const calls = moduleCalls(table);
	assert.equal(calls.filter((row) => row === "module.review:bad").length, 3, "至多三轮（契约 §14.5）");
	assert.ok(!calls.includes("module.accept:bad"), "没过的分片不进 shards/");
	assert.ok(calls.includes("module.accept:good"), "坏的那一段不挡住后面的");

	const report = table.bus("coc:module-build-done")[0].data.report;
	assert.deepEqual(report.failed, ["bad"]);
	assert.deepEqual(report.accepted, ["good"]);
	assert.equal(report.installed, true, "有失败的段也照样安装（材料不全由可玩性报告说）");

	const final = table.kernelRequests().filter((entry) => entry.method === "module.review" && entry.params.section_id === "bad");
	assert.equal(final[2].params.final, true, "最后一轮告诉内核：这一段记 failed");
	assert.deepEqual(final.map((entry) => entry.params.round), [1, 2, 3], "轮次送进内核，sections.json 才写得出 rounds");
});

test("按需深读：一次认领一段，回合还在跑的时候不认领", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "前院" }] })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你走到前院。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("交付之后的一句"),
		],
		env: {
			FAKE_KERNEL_MODULE: JSON.stringify({
				module_id: "the-haunting",
				planned: true,
				sections: [
					{ id: "cellar", title: "地窖", priority: 100 },
					{ id: "attic", title: "阁楼", priority: 80 },
				],
				deepen: ["cellar", "attic"],
			}),
		},
	});
	t.after(() => table.dispose());

	await table.session.prompt("我走到前院");
	await waitForIdle(table.session);
	// 队列空了（第三次认领拿回 null）才算这条车道跑完。
	await waitFor(
		() => table.kernelRequests().filter((entry) => entry.method === "module.deepen.claim").length >= 3,
		{ label: "深读队列跑空" },
	);

	const methods = table.kernelRequests().map((entry) => entry.method);
	const narrateAt = methods.indexOf("table.narrate");
	const firstClaimAt = methods.indexOf("module.deepen.claim");
	assert.ok(narrateAt >= 0 && firstClaimAt > narrateAt, "认领排在回合关闭之后，不在交付路上（契约 §14.6）");

	// 一次一段：认领与完成成对出现，第二次认领在第一次完成之后。
	const lane = moduleCalls(table).filter((row) => row.startsWith("module.deepen."));
	assert.deepEqual(lane, [
		"module.deepen.claim",
		"module.deepen.complete:cellar",
		"module.deepen.claim",
		"module.deepen.complete:attic",
		"module.deepen.claim",
	]);

	const claimed = table.kernelRequests().filter((entry) => entry.method === "module.deepen.complete");
	assert.deepEqual(
		claimed.map((entry) => entry.params.status),
		["accepted", "accepted"],
	);
	// 深读走的是同一个读者与同一条闸门（契约 §14.6）。
	assert.deepEqual(
		table.readerRuns().map((row) => row.section),
		["cellar", "attic"],
	);
	const calls = moduleCalls(table);
	assert.ok(calls.includes("module.packet:cellar") && calls.includes("module.accept:cellar"));
	assert.ok(calls.includes("module.assemble"), "读完一段就合并，图长了战役看得到");
});

test("手卡：apply 回的附件跟着交付到玩家，路径与遥测都留下", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[fauxToolCall("apply", { effects: [{ kind: "handout", name: "诺特的信", label: "诺特的信" }] })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "他把信推过桌面。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("交付之后的一句"),
		],
		env: {
			FAKE_KERNEL_HANDOUT: JSON.stringify({
				path: "/tmp/pi-coc-assets/knott-letter.png",
				media_type: "image/png",
				name: "诺特的信",
			}),
		},
	});
	t.after(() => table.dispose());

	await table.session.prompt("我伸手去接那封信");
	await waitForIdle(table.session);

	const delivered = table.session.messages
		.filter((message) => message.role === "assistant")
		.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""))
		.filter((text) => text.length > 0)
		.at(-1);
	assert.ok(delivered.startsWith("他把信推过桌面。"), "交付仍是内核渲染的文本");
	assert.ok(delivered.includes("【手卡】诺特的信"), "手卡在交付里点名（契约 §14.8）");
	assert.ok(
		delivered.includes("/tmp/pi-coc-assets/knott-letter.png"),
		"Pi 的助手消息装不下附件，所以路径落进交付（docs/pi-host-contract.md 第 5 节）",
	);

	const rows = table.telemetry().filter((row) => row.lane === "handout");
	assert.ok(rows.length >= 2, "apply 一行、交付一行");
	assert.ok(rows.every((row) => row.path === "/tmp/pi-coc-assets/knott-letter.png"));
	assert.ok(rows.some((row) => row.media_type === "image/png"));
	assert.ok(rows.some((row) => row.delivered_as === "rendered_text"));
});
