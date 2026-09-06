/**
 * 建卡进程（契约 §14.4）：独立模式、独立工具面、一张七步表。
 *
 * 这里的用例都从表生成——断言里出现的步骤名、前置、顺序全部读自内核回的那张表
 * （假内核里的 `SETUP_STEPS`），没有一处把顺序抄第二遍。契约 §14.10 要的就是这个：
 * 「建卡进程的每一步拒绝与下一步说明只能追溯到七步表」。
 */

import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

/** 表由内核给；测试从假内核那一份读，跟扩展读的是同一张。 */
const { SETUP_STEPS } = await import("./fixtures/setup-steps.mjs");

function stepById(id) {
	const step = SETUP_STEPS.find((row) => row.id === id);
	assert.ok(step, `表里应该有 ${id}`);
	return step;
}

/** 表里第一步：没有前置、也不挑来源的那一个。 */
function firstStep() {
	const first = SETUP_STEPS.find(
		(row) => !row.applies_to && (!row.needs || (Array.isArray(row.needs) && row.needs.length === 0)),
	);
	assert.ok(first, "表里应该有一个无前置的头一步");
	return first;
}

/** 表里最后一步：没有别的步以它为前置。 */
function lastStep() {
	const needed = new Set();
	for (const row of SETUP_STEPS) {
		const needs = Array.isArray(row.needs) ? row.needs : Object.values(row.needs ?? {}).flat();
		for (const id of needs) needed.add(id);
	}
	const tail = SETUP_STEPS.filter((row) => !needed.has(row.id));
	assert.equal(tail.length, 1, "表里应该只有一个末步");
	return tail[0];
}

function setupCall(params) {
	return fauxAssistantMessage([fauxToolCall("setup", params)], { stopReason: "toolUse" });
}

/** 每次 `setup` 的结果原样解析出来，按调用顺序。 */
function setupResults(session) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === "setup")
		.map((message) =>
			JSON.parse(
				(message.content ?? [])
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join(""),
			),
		);
}

async function openSetup(responses) {
	return await openTable({ mode: "setup", campaign: null, responses });
}

test("建卡模式：只注册 setup 这一个工具，不开桌、不跑车道", async (t) => {
	const table = await openSetup([fauxAssistantMessage("我先问问玩家想玩哪一本。")]);
	t.after(() => table.dispose());

	assert.deepEqual(table.extensionErrors, [], "扩展应该无错加载");
	assert.deepEqual(table.activeTools(), ["setup"], "建卡进程的工具面只有 setup（契约 §14.4）");

	const methods = table.kernelRequests().map((entry) => entry.method);
	assert.ok(methods.includes("kernel.hello"), "建卡也要内核：campaign.*、module.*、setup.* 都在它那儿");
	assert.ok(methods.includes("setup.steps"), "开局就把七步表读回来");
	assert.ok(!methods.includes("table.open"), "建卡进程没有桌子，不 table.open");
	assert.ok(!methods.includes("table.capsule"), "建卡进程没有胶囊");
});

test("pdf 那条路：资料包没到手就等，绑定与构建各归各的，开场就绪才建卡", async (t) => {
	const last = lastStep();
	const table = await openTable({
		mode: "setup",
		campaign: null,
		env: {
			FAKE_KERNEL_MODULE: JSON.stringify({
				module_id: "they-did-not-think-it-too-many",
				sections: [
					{ id: "front", title: "前言", priority: 100 },
					{ id: "opening-scene", title: "开场", priority: 90 },
				],
				opening_after: 1,
			}),
		},
		responses: [],
	});
	t.after(() => table.dispose());

	const bundle = join(table.workspace, "bundle");
	table.faux.setResponses([
		setupCall({ step: "choose-source", kind: "pdf", bundle }),
		setupCall({ step: "build-bundle" }),
		fauxAssistantMessage("我先等你把资料包做出来。"),
	]);
	await table.session.prompt("我有一本 PDF");
	await waitForIdle(table.session);

	const waiting = setupResults(table.session).at(-1);
	assert.equal(waiting.ok, false, "资料包还不在，这一步不算做完");
	assert.equal(waiting.path, bundle);
	assert.match(waiting.hint, /PDF 技能/, "告诉玩家怎么用宿主的技能产出它（契约 §14.2：仓库不解析 PDF）");

	// 宿主的技能产出了资料包（这里只要形状对：清单 + 每页一份 Markdown）。
	mkdirSync(join(bundle, "pages"), { recursive: true });
	writeFileSync(join(bundle, "manifest.json"), JSON.stringify({ contract: "coc.pdf-bundle.v1", pages: [] }));

	table.faux.setResponses([
		setupCall({ step: "build-bundle" }),
		setupCall({ step: "create-campaign", title: "他们也没想太多", play_language: "zh-Hans" }),
		setupCall({ step: "bind-source" }),
		setupCall({ step: "build-opening" }),
		setupCall({ step: "create-investigator", name: "林素", occupation: "journalist" }),
		setupCall({ step: last.id }),
		fauxAssistantMessage("建好了。"),
	]);
	await table.session.prompt("资料包做好了");
	await waitForIdle(table.session, { timeoutMs: 30_000 });

	const results = setupResults(table.session);
	const bound = results.find((row) => row.step === "bind-source");
	assert.equal(bound.ok, true);
	// 一步两次调用，次序由表定：先 bind 再 plan（契约 §14.4）。
	const methods = table.kernelRequests().map((entry) => entry.method);
	assert.ok(methods.indexOf("module.bind") < methods.indexOf("module.plan"), "表里 bind-source 的两次调用按序走");
	assert.equal(
		table.kernelRequests().find((entry) => entry.method === "module.bind").params.bundle,
		bundle,
		"资料包目录从来源那一步的回执里取",
	);

	const opening = results.find((row) => row.step === "build-opening");
	assert.equal(opening.ok, true, "等到了开场就绪");
	assert.equal(opening["module.build"].opening_ready, true);
	assert.equal(table.bus("coc:module-build").length, 1, "构建由 module 扩展跑，这一步只发起并等（契约 §14.5）");
	assert.ok(table.readerRuns().length >= 1, "读者真的跑了");

	const finished = results.at(-1);
	assert.equal(finished.ok, true);
	assert.match(finished.handoff_command, /^bin\/pi-coc --campaign /);
});

test("闸门：表里没有的步、前置没做完的步、重复的步，三种拒绝都能追回表", async (t) => {
	const first = firstStep();
	const last = lastStep();
	const table = await openSetup([
		setupCall({ step: "读一读模组" }),
		setupCall({ step: last.id }),
		setupCall({ step: first.id, kind: "starter", module: "the-haunting" }),
		setupCall({ step: first.id, kind: "starter", module: "the-haunting" }),
		fauxAssistantMessage("好的，我去问玩家。"),
	]);
	t.after(() => table.dispose());

	await table.session.prompt("我们开始吧");
	await waitForIdle(table.session);

	const [unknown, tooEarly, done, repeated] = setupResults(table.session);

	assert.equal(unknown.ok, false);
	assert.match(unknown.rejected, /读一读模组/, "拒绝语点名这个步不在表里");
	for (const row of SETUP_STEPS) {
		assert.ok(unknown.rejected.includes(row.id), `拒绝语列出表里的 ${row.id}`);
	}
	assert.match(unknown.rejected, new RegExp(first.id), "并指向表里的第一步");

	assert.equal(tooEarly.ok, false);
	const needs = Array.isArray(last.needs) ? last.needs : Object.values(last.needs ?? {}).flat();
	for (const need of needs) {
		assert.ok(tooEarly.rejected.includes(need), `拒绝语点名表里写的前置 ${need}`);
	}
	assert.match(tooEarly.rejected, new RegExp(first.id), "并指向表里的第一步");

	assert.equal(done.ok, true, "第一步做得成");
	assert.equal(repeated.ok, false);
	assert.match(repeated.rejected, new RegExp(`${first.id} 已经做过了`), "重复的步被拒");

	const stepsCalls = table.kernelRequests().filter((entry) => entry.method === "setup.steps");
	assert.equal(stepsCalls.length, 1, "表只读一次，之后都从它派生");
});

test("七步表走完：starter 那条路到 complete，交出开桌命令", async (t) => {
	const first = firstStep();
	const last = lastStep();
	const investigator = stepById("create-investigator");
	const table = await openSetup([
		setupCall({ step: first.id, kind: "starter", module: "the-haunting" }),
		setupCall({ step: "create-campaign", title: "闹鬼的房子", play_language: "zh-Hans" }),
		// 第一次不给职业：工具把职业清单交给模型，模型自己挑（契约 §14.7，绝不做关键词表）。
		setupCall({ step: investigator.id, name: "托马斯·海耶斯" }),
		setupCall({ step: investigator.id, name: "托马斯·海耶斯", occupation: "journalist", concept: "从战场回来的记者" }),
		setupCall({ step: last.id }),
		fauxAssistantMessage("建好了。"),
	]);
	t.after(() => table.dispose());

	await table.session.prompt("我想玩闹鬼的房子");
	await waitForIdle(table.session);

	const results = setupResults(table.session);
	assert.equal(results.length, 5, "五次调用（第三次是问职业）");

	const [source, campaign, needOccupation, made, finished] = results;
	assert.equal(source.ok, true);
	assert.equal(source.source.module_id, "the-haunting");
	assert.ok(Array.isArray(source.starters) && source.starters.includes("the-haunting"), "starter 名单来自内容目录");

	assert.equal(campaign.ok, true);
	const created = table.kernelRequests().find((entry) => entry.method === "campaign.create");
	assert.equal(created.params.module, "the-haunting", "模组从上一步的回执里取，不必模型再说一遍");
	assert.equal(created.params.play_language, "zh-Hans");

	assert.equal(needOccupation.ok, false, "没给职业时这一步不算做完");
	assert.deepEqual(needOccupation.needs, ["occupation"], "缺的是表里点名的那个参数");
	const listed = needOccupation.results["setup.occupations"].occupations.map((row) => row.id);
	assert.ok(listed.includes("journalist"), "职业清单原样进结果，交给模型挑");

	assert.equal(made.ok, true);
	const built = table.kernelRequests().find((entry) => entry.method === "setup.investigator");
	assert.equal(built.params.name, "托马斯·海耶斯", "名字原样送进内核");
	assert.equal(built.params.occupation, "journalist", "职业 id 是模型挑的");
	assert.ok(built.params.campaign, "建卡的调用带战役 id");
	const occupationCalls = table.kernelRequests().filter((entry) => entry.method === "setup.occupations");
	assert.equal(occupationCalls.length, 1, "清单查一次就够，补参数再来时不重查");

	assert.equal(finished.ok, true);
	assert.match(finished.handoff_command, /^bin\/pi-coc --campaign /, "最后一步交出开桌命令（契约 §14.4）");
	assert.equal(finished.next, "建卡的步都做完了。");
	assert.ok(
		table.ui.notifications.some((row) => row.message.includes(finished.handoff_command)),
		"开桌命令也报给玩家",
	);

	// pdf 才要的那几步在 starter 这条路上从头到尾没被要求过。
	const pdfOnly = SETUP_STEPS.filter((row) => row.applies_to?.includes("pdf")).map((row) => row.id);
	assert.ok(pdfOnly.length > 0, "表里确实有只属于 pdf 的步");
	const progress = finished.progress;
	assert.match(progress, /^建卡 \d+\/\d+/, "状态行上的进度是从表数出来的");
	assert.equal(
		table.ui.statuses.filter((row) => row.key === "coc-setup").length >= 1,
		true,
		"进度落在状态行上",
	);
	for (const id of pdfOnly) {
		assert.ok(
			!setupResults(table.session).some((row) => row.step === id),
			`starter 这条路不该走 ${id}`,
		);
	}
});
