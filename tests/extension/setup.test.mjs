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

test("选内置 starter 就是 starter 来源，不是 pdf，也不会被要资料包（#32）", async (t) => {
	const table = await openSetup([]);
	t.after(() => table.dispose());

	table.faux.setResponses([
		setupCall({ step: "choose-source", starter: "the-haunting" }),
		fauxAssistantMessage("好，就它了。"),
	]);
	await table.session.prompt("我们玩 The Haunting");
	await waitForIdle(table.session);

	const chosen = setupResults(table.session).at(-1);
	assert.equal(chosen.ok, true, "内置 starter 是现成的，选了就该过");
	assert.equal(chosen.source.kind, "starter", "玩家点名了 starter，来源就是 starter");
	assert.equal(chosen.source.module_id, "the-haunting");
	assert.ok(chosen.kinds.includes("starter"), "来源词表来自表声明的 sources");
	assert.ok(!String(chosen.next ?? "").includes("build-bundle"), "starter 不该被要资料包");
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
	assert.match(waiting.hint, /PDF skill/, "告诉玩家怎么用宿主的技能产出它（契约 §14.2：仓库不解析 PDF）");

	// 宿主的技能产出了资料包（这里只要形状对：清单 + 每页一份 Markdown）。
	mkdirSync(join(bundle, "pages"), { recursive: true });
	writeFileSync(join(bundle, "manifest.json"), JSON.stringify({ contract: "coc.pdf-bundle.v1", pages: [] }));

	table.faux.setResponses([
		setupCall({ step: "build-bundle" }),
		setupCall({ step: "bind-source" }),
		setupCall({ step: "create-campaign", title: "他们也没想太多", play_language: "zh-Hans" }),
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

test("two opening scenes: build-opening asks within one round and never waits for what a build cannot settle (§14.14)", async (t) => {
	const candidates = [
		{ node_id: "scene-nkvd-briefing-opening1", scene: "nkvd-briefing-opening1", name: "开场一：逮捕令" },
		{ node_id: "scene-nkvd-briefing-opening2", scene: "nkvd-briefing-opening2", name: "开场二：调查减产" },
	];
	const table = await openTable({
		mode: "setup",
		campaign: null,
		env: {
			FAKE_KERNEL_MODULE: JSON.stringify({
				module_id: "cold-harvest",
				sections: [{ id: "section-01", title: "整本", priority: 100 }],
				opening_after: 1,
				opening_candidates: candidates,
			}),
		},
		responses: [],
	});
	t.after(() => table.dispose());

	const bundle = join(table.workspace, "bundle");
	mkdirSync(join(bundle, "pages"), { recursive: true });
	writeFileSync(join(bundle, "manifest.json"), JSON.stringify({ contract: "coc.pdf-bundle.v1", pages: [] }));

	table.faux.setResponses([
		setupCall({ step: "choose-source", kind: "pdf", bundle }),
		setupCall({ step: "build-bundle" }),
		setupCall({ step: "bind-source" }),
		// The model reaches for a language tag the kernel does not take.
		setupCall({ step: "create-campaign", title: "冰冷的收获", play_language: "zh" }),
		setupCall({ step: "create-campaign", title: "冰冷的收获", play_language: "zh-Hans" }),
		setupCall({ step: "build-opening" }),
		setupCall({ step: "build-opening", start_scene: "开场二：调查减产" }),
		fauxAssistantMessage("开场定了。"),
	]);
	await table.session.prompt("我有一本 PDF");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	const results = setupResults(table.session);
	// A closed vocabulary refused without naming what is allowed is what made the real model
	// try zh, then zh-CN, then drop the parameter (#33): the kernel's fix and details must survive.
	const refusedLanguage = results.find((row) => row.step === "create-campaign" && row.ok === false);
	assert.equal(refusedLanguage.code, "invalid_params");
	assert.deepEqual(refusedLanguage.details.options, ["zh-Hans", "en"], "拒绝里带得出候选");
	assert.ok(refusedLanguage.fix, "内核的 fix 活过了工具结果这一层");

	const asked = results.filter((row) => row.step === "build-opening");
	assert.equal(asked.length, 2, "问一次、答一次，没有第 216 次重试");
	assert.equal(asked[0].ok, false);
	assert.deepEqual(asked[0].needs, ["start_scene"]);
	assert.deepEqual(
		asked[0].candidates.map((row) => row.name),
		candidates.map((row) => row.name),
		"候选场景连名字一起交给建卡助手",
	);
	assert.ok(!asked[0].still_building, "歧义不是「还在读」，等下去也不会好");

	assert.equal(asked[1].ok, true, "玩家点了一个，这一步就过");
	assert.equal(asked[1]["module.build"].opening_ready, true);
	const chose = table.kernelRequests().find((entry) => entry.method === "module.opening.choose");
	assert.equal(chose.params.scene, "开场二：调查减产", "玩家的答案原样送进内核，内核自己认候选");
	assert.equal(
		table.kernelRequests().filter((entry) => entry.method === "module.opening.choose").length,
		1,
		"定一次就够",
	);
});

test("build-opening exits when the book is installed and playable but its opening stays undecided (§14.14)", async (t) => {
	const table = await openTable({
		mode: "setup",
		campaign: null,
		env: {
			FAKE_KERNEL_MODULE: JSON.stringify({
				module_id: "cold-harvest",
				sections: [{ id: "section-01", title: "整本", priority: 100 }],
				opening_after: 99,
				opening_candidates: [
					{ node_id: "scene-a", scene: "a", name: "开场一" },
					{ node_id: "scene-b", scene: "b", name: "开场二" },
				],
			}),
			// A wait this short would still be a wait: the point is that this step never reaches it.
			PI_COC_BUILD_WAIT_MS: "600000",
		},
		responses: [],
	});
	t.after(() => table.dispose());

	const bundle = join(table.workspace, "bundle");
	mkdirSync(join(bundle, "pages"), { recursive: true });
	writeFileSync(join(bundle, "manifest.json"), JSON.stringify({ contract: "coc.pdf-bundle.v1", pages: [] }));

	table.faux.setResponses([
		setupCall({ step: "choose-source", kind: "pdf", bundle }),
		setupCall({ step: "build-bundle" }),
		setupCall({ step: "bind-source" }),
		setupCall({ step: "create-campaign", title: "冰冷的收获", play_language: "zh-Hans" }),
		setupCall({ step: "build-opening" }),
		// The assistant asks again without an answer: the step finishes rather than looping.
		setupCall({ step: "build-opening" }),
		fauxAssistantMessage("开场待定，先建卡。"),
	]);
	await table.session.prompt("我有一本 PDF");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	const asked = setupResults(table.session).filter((row) => row.step === "build-opening");
	assert.equal(asked.length, 2);
	assert.equal(asked[0].ok, false, "第一次交出候选");
	assert.equal(asked[1].ok, true, "第二次收尾：模组已安装、可玩性 playable，开场待定");
	assert.equal(asked[1]["module.build"].opening_ready, false);
	assert.equal(asked[1]["module.build"].opening_pending, true);
	assert.ok(String(asked[1].next ?? "").length > 0, "并把下一步交出去，流程不死在这里");
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
	assert.match(repeated.rejected, new RegExp(`${first.id} is already done`), "重复的步被拒");

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
	assert.equal(finished.next, "Every setup step is done.");
	assert.ok(
		table.ui.notifications.some((row) => row.message.includes(finished.handoff_command)),
		"开桌命令也报给玩家",
	);

	// pdf 才要的那几步在 starter 这条路上从头到尾没被要求过。
	const pdfOnly = SETUP_STEPS.filter((row) => row.applies_to?.includes("pdf")).map((row) => row.id);
	assert.ok(pdfOnly.length > 0, "表里确实有只属于 pdf 的步");
	const progress = finished.progress;
	assert.match(progress, /^setup \d+\/\d+/, "状态行上的进度是从表数出来的");
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
