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
import { extensionWords } from "../../extensions/ui/words.ts";
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

test('uncached installed-module guidance uses the bridge owner for both author and review', async t => {
  // This is a transport fixture; the real driver regression supplies gameplay evidence separately.
  const table = await openSetup([
    setupCall({step:'choose-source',kind:'starter',module:'the-haunting'}),
    setupCall({step:'create-campaign',id:'setup-fixture',title:'Prepared source',play_language:'en'}),
    fauxAssistantMessage('Ready for the investigator.'),
  ]);
  t.after(() => table.dispose());
  const folder=join(table.workspace,'.coc/modules/the-haunting');
  mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,'module.json'),JSON.stringify({id:'the-haunting'}));
  writeFileSync(join(folder,'module-graph.json'),JSON.stringify({nodes:[{node_id:'module-the-haunting',node_kind:'module',name:'Prepared source',summary:'An opening meeting.'}]}));
  const guidance={opening:'Who joins the meeting?',advice:'Choose a source-fitting investigator.',scene:'The meeting begins.',guide:'',handoff:'Continue the meeting.'};
  const tasks=[],current=table.runtimeBridges().at(-1);
  table.emit('coc:kernel-bridge',{...current,async call(method,params){
    const result=await current.call(method,params);
    if(method==='setup.occupations')table.emit('coc:kernel-bridge',{...current,runtime:{...current.runtime,
      runTask(){throw new Error('A new bridge must not receive the previous owner task');}}});
    return result;
  },runtime:{...current.runtime,async runTask(task,signal){
    tasks.push(task);assert.equal(task.kind,'reader');assert.equal(signal.aborted,false);
    const review=task.request.systemPrompt.endsWith('character-guidance-review.md');
    writeFileSync(join(task.request.cwd,review?'review.json':'guidance.json'),JSON.stringify(review?{approved:true,issues:[]}:guidance));
    return {ok:true};
  }}});
  await table.session.prompt('Start with this prepared source.');
  await waitForIdle(table.session);
  const result=setupResults(table.session).find(row=>row.step==='create-campaign'||row.code==='guidance_failed');
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(result.character_guidance,guidance);
  assert.equal(tasks.length,2);
  assert.equal(tasks[0].request.cwd,tasks[1].request.cwd);
});

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
		setupCall({ step: "create-campaign", id: "setup-fixture", title: "闹鬼的房子", play_language: "zh-Hans" }),
		// 第一次不给职业：工具把职业清单交给模型，模型自己挑（契约 §14.7，绝不做关键词表）。
		setupCall({ step: investigator.id, confirmed: true, name: "托马斯·海耶斯" }),
		setupCall({ step: investigator.id, profile: {name: "托马斯·海耶斯", occupation: "journalist", concept: "从战场回来的记者"} }),
        setupCall({step:"confirm-investigator",consent:"approved"}),
		setupCall({ step: last.id }),
		fauxAssistantMessage("建好了。"),
	]);
	t.after(() => table.dispose());

	await table.session.prompt("我想玩闹鬼的房子");
	await waitForIdle(table.session);

	const results = setupResults(table.session);
	assert.equal(results.length, 6, "五次调用（第三次是问职业）");

	const [source, campaign, needOccupation, made, confirmed, finished] = results;
	assert.equal(source.ok, true);
	assert.equal(source.source.module_id, "the-haunting");
	assert.ok(Array.isArray(source.starters) && source.starters.includes("the-haunting"), "starter 名单来自内容目录");

	assert.equal(campaign.ok, true);
	const created = table.kernelRequests().find((entry) => entry.method === "campaign.create");
	assert.equal(created.params.module, "the-haunting", "模组从上一步的回执里取，不必模型再说一遍");
	assert.equal(created.params.play_language, "zh-Hans");

	assert.equal(needOccupation.ok, false, "没给职业时这一步不算做完");
	assert.deepEqual(needOccupation.needs, ["profile"], "缺的是表里点名的那个参数");

	assert.equal(made.ok, true);
	// §97: the model is handed the card's numbers and words, never the creation trace or the seed.
	const summary = made['setup.draft'];
	assert.equal(summary.card.name, '托马斯·海耶斯');
	assert.equal(summary.card.skills.Law, 45);
	assert.ok(summary.budget && summary.pins, 'budget and pins ride with the summary');
	assert.equal(summary.sheet, undefined);
	assert.equal(JSON.stringify(summary).includes('private-seed'), false, 'the seed never reaches the model');
	const built = table.kernelRequests().find((entry) => entry.method === "setup.draft");
	assert.equal(built.params.profile.name, "托马斯·海耶斯", "名字原样送进内核");
	assert.equal(built.params.profile.occupation, "journalist", "职业 id 是模型挑的");
	assert.ok(built.params.campaign, "建卡的调用带战役 id");
	const occupationCalls = table.kernelRequests().filter((entry) => entry.method === "setup.occupations");
	assert.equal(occupationCalls.length, 0, "this step forwards the supplied occupation without another lookup");

	const confirmCall = table.kernelRequests().find((entry) => entry.method === "setup.confirm");
	assert.ok(confirmCall, "the confirm step calls setup.confirm");
	assert.equal(confirmCall.params.revision, undefined, "revision stays omitted: the kernel defaults it to the campaign's current draft (contract §23.4)");
	assert.ok(confirmCall.params.input_key, "input_key is still injected");
	assert.ok("last_exchange" in confirmCall.params, "last_exchange is still injected");
	assert.ok(Array.isArray(confirmCall.params.player_requests), "player_requests is still injected");

	assert.equal(finished.ok, true);
	assert.match(finished.handoff_command, /^bin\/pi-coc --campaign /, "最后一步交出开桌命令（契约 §14.4）");
	assert.equal(finished.next, "Every setup step is done.");
	// The handoff line is the campaign's sentence around the command (contract §23): the command is
	// a command and reads the same everywhere, the words about it come from the `extension` surface.
	const words = await extensionWords("zh-Hans");
	const english = await extensionWords("en");
	assert.notEqual(words.word("setup_complete"), english.word("setup_complete"), "a second language hands off in its own words");
	assert.ok(
		table.ui.notifications.some((row) => row.message === words.line("setup_complete", { command: finished.handoff_command })),
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

test("setup packages: the campaign's enabled Mods reach the setup prompt through mods.context, and only once a campaign exists (contract §26)", async (t) => {
	const first = firstStep();
	const investigator = stepById("create-investigator");
	const prompts = [];
	const capture = (message) => (context) => { prompts.push(context.systemPrompt ?? ""); return message; };
	const table = await openSetup([
		capture(setupCall({ step: first.id, kind: "starter", module: "the-haunting" })),
		capture(setupCall({ step: "create-campaign", id: "setup-fixture", title: "闹鬼的房子", play_language: "zh-Hans" })),
		capture(fauxAssistantMessage("先说说你是谁。")),
		// The next player message starts a new agent run, whose prompt is composed with the campaign in hand.
		capture(fauxAssistantMessage("记下了。")),
	]);
	t.after(() => table.dispose());

	await table.session.prompt("我想玩闹鬼的房子");
	await waitForIdle(table.session);
	await table.session.prompt("我叫托马斯，是个记者。");
	await waitForIdle(table.session);

	const contexts = table.kernelRequests().filter((entry) => entry.method === "mods.context");
	assert.ok(contexts.length >= 1, "the onboarding extension asks the kernel what the campaign's packages say about setup");
	assert.ok(contexts.every((entry) => entry.params.campaign === "setup-fixture"), "always for the campaign that was created, never a guess");
	assert.equal(prompts.length, 4, "three model requests in the first run, one in the second");
	assert.ok(prompts.slice(0, 3).every((prompt) => !prompt.includes("FAKE-SETUP-INSTRUCTION")), "the first run's prompt was composed before a campaign existed: no package to consult, the core policy stands");
	const after = prompts[3];
	assert.ok(after.includes("FAKE-SETUP-INSTRUCTION"), "once the campaign exists the package's setup instruction is in the system prompt");
	assert.ok(after.includes("[guided-creation 1.0.0] settings: {\"max_guided_turns\":3}"), "the instruction is labeled with its package, version and settings");
	assert.ok(after.includes("Active setup packages (guided-creation)"), "the prompt names which packages are speaking");
});

test("creation brief: the host computes the move from the package's slots and the kernel's notes, and the draft waits for it (contract §26)", async (t) => {
	const first = firstStep();
	const investigator = stepById("create-investigator");
	const prompts = [];
	const capture = (message) => (context) => { prompts.push(context.systemPrompt ?? ""); return message; };
	const table = await openTable({ mode: "setup", campaign: null, env: { FAKE_SETUP_SLOTS: "1" }, responses: [
		capture(setupCall({ step: first.id, kind: "starter", module: "the-haunting" })),
		capture(setupCall({ step: "create-campaign", id: "brief-fixture", title: "闹鬼的房子", play_language: "zh-Hans" })),
		capture(fauxAssistantMessage("先说说你是谁。")),
		// Second run: the model tries to draft before the brief is filled, records notes, then drafts.
		capture(setupCall({ step: investigator.id, profile: { name: "大牛皮", occupation: "farmer", concept: "屠夫" } })),
		capture(setupCall({ step: "note", slot: "trade", value: "屠夫，落在 Farmer 一栏" })),
		capture(setupCall({ step: "note", slot: "built_for", value: "膀子力气", origin: "player" })),
		capture(setupCall({ step: investigator.id, profile: { name: "大牛皮", occupation: "farmer", concept: "屠夫" } })),
		capture(fauxAssistantMessage("卡在这里。")),
	] });
	t.after(() => table.dispose());

	await table.session.prompt("我想玩闹鬼的房子");
	await waitForIdle(table.session);
	await table.session.prompt("我叫大牛皮，是个屠夫。");
	await waitForIdle(table.session);

	const results = setupResults(table.session);
	const [, , refused, noteTrade, noteBuilt, drafted] = results;
	assert.equal(refused.ok, false, "the first draft is refused while a required slot is missing");
	assert.equal(refused.code, "brief_incomplete");
	assert.deepEqual(refused.missing, ["trade", "built_for"]);
	assert.match(refused.brief, /Move: ask trade/);
	assert.equal(noteTrade.ok, true);
	assert.match(noteTrade.brief, /trade \(required\): FILLED/);
	assert.match(noteTrade.brief, /Move: ask built_for/, "after one note the move is the next missing required slot");
	assert.equal(noteBuilt.ok, true);
	assert.match(noteBuilt.brief, /Move: draft — every required slot is filled/);
	assert.equal(drafted.ok, true, "with the brief complete the same draft call goes through");
	const notes = table.kernelRequests().filter((entry) => entry.method === "setup.note");
	assert.deepEqual(notes.map((entry) => entry.params.slot), ["trade", "built_for"], "notes reach the kernel, one slot each, no advance before any note exists");
	assert.ok(prompts[3].includes("Creation brief") && prompts[3].includes("Move: ask trade"), "the second run's prompt carries the host-computed brief and its one move");
	assert.ok(!prompts[2].includes("Creation brief"), "the first run's prompt, composed before the campaign existed, carries no brief");
});

/**
 * §92: the model's own door to the card's numbers.
 *
 * Until this existed the setup table routed `create-investigator` to `setup.draft` and named
 * `setup.override` nowhere, so the only answer to "change this number" was to draft again — the one
 * call that rebuilds from the stored seed and puts the auto-allocated numbers back. A live table
 * reported exactly that: the edit saved, the next turn reverted it, and asking in words did nothing.
 */
test('§97 revise changes the card in place: words move no number, numbers pin, and each revision reaches the transcript', async (t) => {
	const first = firstStep();
	const table = await openSetup([
		setupCall({ step: first.id, kind: 'starter', module: 'the-haunting' }),
		setupCall({ step: 'create-campaign', id: 'setup-revise', title: '闹鬼的房子', play_language: 'zh-Hans' }),
		setupCall({ step: 'revise', numbers: { skills: { Law: 60 } } }),
		setupCall({ step: 'create-investigator', profile: { name: '托马斯·海耶斯', occupation: 'journalist', concept: '记者' } }),
		setupCall({ step: 'revise', numbers: { skills: { Law: 60 } } }),
		setupCall({ step: 'revise', profile: { equipment: ['相机'] } }),
		setupCall({ step: 'revise', numbers: { skills: { Unlisted: 60 } } }),
		setupCall({ step: 'create-investigator', profile: { age: 40 } }),
		fauxAssistantMessage('改好了。'),
	]);
	t.after(() => table.dispose());

	await table.session.prompt('我想玩闹鬼的房子，法律给我调到 60');
	await waitForIdle(table.session);

	const [, , tooEarly, drafted, pinned, worded, unlisted, again] = setupResults(table.session);
	assert.equal(tooEarly.ok, false, 'there is no card to revise before one is drafted');
	assert.match(tooEarly.rejected, /draft one with create-investigator/);
	assert.equal(drafted.ok, true);
	const drawn = drafted['setup.draft'];
	assert.ok(drawn.card && drawn.card.skills && drawn.budget && drawn.pins, 'the model is handed the summary: card, pins, budget');
	assert.equal(drawn.sheet, undefined, 'and not the whole sheet with its creation trace');

	assert.equal(pinned.ok, true, 'a number on the drafted card is changed as a number');
	const revises = table.kernelRequests().filter((entry) => entry.method === 'setup.revise');
	assert.deepEqual(revises[0].params.numbers, { skills: { Law: 60 } });
	assert.equal(revises[0].params.revision, 1, 'the revision applies to the card the draft step put on the table');
	assert.equal(revises[0].params.by, 'model', 'a number the model relays is pinned as the model\'s');
	assert.equal(pinned.card.skills.Law, 60);
	assert.deepEqual(pinned.pins.skills.Law, { value: 60, by: 'model' });

	assert.equal(worded.ok, true);
	assert.deepEqual(revises[1].params.profile, { equipment: ['相机'] }, 'words travel as a profile patch');
	assert.equal(worded.card.skills.Law, 60, 'and the pinned number is still there');

	// A refusal is the answer, not a transport failure: its details name the field and candidates.
	assert.equal(unlisted.ok, false);
	assert.equal(unlisted.code, 'needs');
	assert.equal(unlisted.details.field, 'Unlisted', "the kernel's details survive the projection");

	// A second create-investigator with a card on the table is a revision, never a redraw.
	assert.equal(again.ok, true);
	assert.equal(again.step, 'revise');
	assert.deepEqual(revises.at(-1).params.profile, { age: 40 });
	assert.equal(table.kernelRequests().filter((entry) => entry.method === 'setup.draft').length, 1, 'the kernel drew the card once');

	const cards = table.entries('coc-character-draft');
	assert.deepEqual(cards.map((card) => card.revision), [1, 2, 3, 4], 'every revision reaches the transcript as a card');
	assert.equal(table.kernelRequests().filter((entry) => entry.method === 'setup.previewed').length, 0, 'and nothing asks the kernel to acknowledge a display');
});

test('§97 a confirmed card is no longer a draft edit', async (t) => {
	const first = firstStep();
	const table = await openSetup([
		setupCall({ step: first.id, kind: 'starter', module: 'the-haunting' }),
		setupCall({ step: 'create-campaign', id: 'setup-revise-late', title: '闹鬼的房子', play_language: 'zh-Hans' }),
		setupCall({ step: 'create-investigator', profile: { name: '托马斯·海耶斯', occupation: 'journalist', concept: '记者' } }),
		setupCall({ step: 'confirm-investigator', consent: 'approved' }),
		setupCall({ step: 'revise', numbers: { skills: { Law: 60 } } }),
		fauxAssistantMessage('已经定卡了。'),
	]);
	t.after(() => table.dispose());

	await table.session.prompt('就这张卡吧');
	await waitForIdle(table.session);

	const tooLate = setupResults(table.session).at(-1);
	assert.equal(tooLate.ok, false, 'the numbers of a committed card are not a draft edit');
	assert.match(tooLate.rejected, /confirmed/);
	assert.equal(table.kernelRequests().filter((entry) => entry.method === 'setup.revise').length, 0,
		'and the kernel is never asked, so the refusal cannot depend on its window');
});

/**
 * §97: a refused draft must not lock the player out of confirmation, and nothing un-books a step.
 */
test('§97 a refused revision leaves the card confirmable', async (t) => {
	const first = firstStep();
	const table = await openSetup([
		setupCall({ step: first.id, kind: 'starter', module: 'the-haunting' }),
		setupCall({ step: 'create-campaign', id: 'setup-refused-draft', title: '闹鬼的房子', play_language: 'zh-Hans' }),
		setupCall({ step: 'create-investigator', profile: { name: '托马斯·海耶斯', occupation: 'journalist', concept: '记者' } }),
		setupCall({ step: 'revise', numbers: { skills: { Unlisted: 60 } } }),
		setupCall({ step: 'confirm-investigator', consent: 'approved' }),
		fauxAssistantMessage('定了。'),
	]);
	t.after(() => table.dispose());

	await table.session.prompt('就这张卡');
	await waitForIdle(table.session);

	const [, , drafted, refused, confirmed] = setupResults(table.session);
	assert.equal(drafted.ok, true, 'the first draft lands');
	assert.equal(refused.ok, false, 'the revision is refused by the kernel');
	assert.equal(refused.code, 'needs');

	assert.equal(confirmed.ok, true, 'and confirmation is still reachable: the refusal un-did nothing');
	assert.ok(table.kernelRequests().some(entry => entry.method === 'setup.confirm'),
		'the gate let it through to the kernel rather than refusing on a prerequisite');
	assert.ok(!JSON.stringify(confirmed).includes('are not done'),
		'no prerequisite refusal for a step that was done');
});

test('§97 the catalog is given to the setup prompt once a campaign exists', async (t) => {
	const first = firstStep();
	const table = await openSetup([
		setupCall({ step: first.id, kind: 'starter', module: 'the-haunting' }),
		setupCall({ step: 'create-campaign', id: 'setup-catalog', title: '闹鬼的房子', play_language: 'zh-Hans' }),
		fauxAssistantMessage('好。'),
		fauxAssistantMessage('继续。'),
	]);
	t.after(() => table.dispose());

	await table.session.prompt('我想玩闹鬼的房子');
	await waitForIdle(table.session);
	await table.session.prompt('接着来');
	await waitForIdle(table.session);

	const prompts = table.systemPrompts ? table.systemPrompts() : null;
	const catalogCalls = table.kernelRequests().filter((entry) => entry.method === 'setup.catalog');
	assert.equal(catalogCalls.length, 1, 'the catalog is fetched once per session');
	if (prompts) assert.ok(prompts.at(-1).includes('Journalist / 记者') && prompts.at(-1).includes('Law / 法律'), 'the trade and skill labels reach the prompt');
});
