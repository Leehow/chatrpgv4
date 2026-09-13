/**
 * 一个完整玩家回合走过扩展的所有接缝：工具面、胶囊注入、call_id 铸造、交付替换。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { extensionWords } from "../../extensions/ui/words.ts";
import { assistantTexts, customMessages, openTable, waitForIdle } from "./harness.mjs";

const SEVEN = ["apply", "ask", "look", "lookup", "narrate", "recall", "resolve"];

test("source preparation preserves an empty question while explicit rechecks retain their question", async t => {
	const table = await openTable({ responses: [
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "Tower" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "Tower", question: "What is on the upper floor?" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "The tower stands ahead." })], { stopReason: "toolUse" }),
		fauxAssistantMessage("The tower stands ahead."),
	] });
	t.after(() => table.dispose());
	const requests = [];
	table.emit("coc:reading-bridge", { async ensure(_mid, params) { requests.push(params); return { state: "ready" }; } });
	await table.session.prompt("Continue the existing tower preparation, then check its upper floor.");
	assert.deepEqual(requests.map(r => r.question), ["", "What is on the upper floor?"]);
	assert.ok(requests.every(r => r.focus === "Tower" && r.foreground === true));
});

test("a source timeout yields the turn instead of allowing another source query", async t => {
	const table = await openTable({ responses: [
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "Lena", question: "Her testimony" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "Tower", question: "Her testimony" })], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxToolCall("narrate", {text:"The source is still being read."})], { stopReason: "toolUse" }),
		fauxAssistantMessage("The source is still being read. Continue waiting?"),
	] });
	t.after(() => table.dispose());
	let reads = 0;
	table.emit("coc:reading-bridge", { async ensure() {
		reads++;
		throw Object.assign(new Error("source read timed out"), { details: { reason: "reading_timeout" } });
	} });
	await table.session.prompt("Please verify this in the original book.");
	assert.equal(reads, 1);
	assert.equal(table.kernelRequests().filter(r => r.method === "table.narrate").length, 1);
	assert.equal(table.kernelRequests().filter(r => r.method === "table.ask").length, 0);
});

test("a pending adaptation owns the rest of the turn and cannot fall through into ordinary work", async t => {
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "adaptation", action: "prepare", name: "athens-study", purpose: "new_destination", request: "A second persistent base", anchors: ["scene: commission-briefing"] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "wait for the room" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "书房还在准备中；这期间你没有移动，也没有花钱。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("书房还在准备中；这期间你没有移动，也没有花钱。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("先准备那间书房，没准备好之前我不移动也不花钱。");
	const requests = table.kernelRequests();
	assert.equal(requests.filter(row => row.method === "adaptation.prepare").length, 1);
	assert.equal(requests.filter(row => row.method === "table.apply").length, 0, "background preparation blocks unrelated writes");
	assert.equal(requests.filter(row => row.method === "table.narrate").length, 1, "the Keeper can only yield honestly");
	assert.equal(table.entries("coc-adaptation-status").at(-1)?.status, "pending");
	assert.equal(assistantTexts(table.session).filter(Boolean).at(-1), "书房还在准备中；这期间你没有移动，也没有花钱。");
});

test("一个玩家回合：七个工具、胶囊、call_id、rendered_text 交付", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: {
							intent: "investigate",
							goal: "看清门框上的痕迹",
							method: "用侦查细看门框",
							target: "  地窖门  ",
						},
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[
					fauxToolCall("apply", {
						effects: [
							{ kind: "clue", clue: "  地窖的\t抓痕 " },
							{ kind: "move", to: " 前院 ", travel_minutes: 1 },
							{ kind: "time", minutes: 10, why: "翻遍了门厅" },
						],
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门框上有一道深深的抓痕。" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("守秘人在 narrate 之后又写的正文，应该被换掉"),
		],
	});
	t.after(() => table.dispose());

	assert.deepEqual(table.extensionErrors, [], "扩展应该无错加载");
	assert.deepEqual([...table.activeTools()].sort(), SEVEN, "session_start 之后正好这七个工具是活的");

	await table.session.prompt("我检查地窖门的门框");

	const requests = table.kernelRequests();
	// 记忆车道的缺省派发（补抽，#20）也搭在这条连接上，开桌之后会来一次；
	// 这个用例看的是回合那条线，所以把车道的调用滤掉。
	const methods = requests.map((entry) => entry.method).filter((method) => !method.startsWith("memory."));
	assert.deepEqual(methods.slice(0, 3), ["kernel.hello", "table.open", "table.player_input"]);

	const playerInput = requests.find((entry) => entry.method === "table.player_input");
	assert.equal(playerInput.params.text, "我检查地窖门的门框");
	assert.equal(playerInput.params.campaign, "test-camp");

	const capsules = customMessages(table.session, "coc-capsule");
	assert.equal(capsules.length, 1, "回合胶囊应该作为 coc-capsule 消息注入");
	assert.equal(capsules[0].display, false);
	const capsule = JSON.parse(
		typeof capsules[0].content === "string"
			? capsules[0].content
			: capsules[0].content.map((block) => block.text).join(""),
	);
	assert.equal(capsule.where.scene, "corbitt-house");

	const resolve = requests.find((entry) => entry.method === "table.resolve");
	const apply = requests.find((entry) => entry.method === "table.apply");
	assert.equal(resolve.params.call_id, "t1-c1", "第一个会改状态的调用是 t1-c1");
	assert.equal(apply.params.call_id, "t1-c2", "第二个是 t1-c2");
	assert.equal(resolve.params.action.target, "地窖门", "实体名做过空白归一化");
	assert.equal(apply.params.effects[0].clue, "地窖的 抓痕");
	assert.equal(apply.params.effects[1].to, "前院", "kind 判别联合里的三种都过校验");
	assert.equal(apply.params.effects[2].minutes, 10);

	const look = requests.find((entry) => entry.method === "table.look");
	assert.equal(look.params.call_id, undefined, "读调用不铸 call_id");

	const narrate = requests.find((entry) => entry.method === "table.narrate");
	assert.equal(narrate.params.call_id, "t1-c3");

	const texts = assistantTexts(table.session).filter((text) => text.length > 0);
	const delivered = texts.at(-1);
	assert.equal(
		delivered,
		"门框上有一道深深的抓痕。",
		"最后一条助手消息的正文就是守秘人写的那段，一字不改（契约 §16.1）",
	);
	// 机制是语言中立的 JSON 投影，只走会话条目与总线，不进正文（契约 §16.2）。
	const [projected] = table.entries("coc-mechanics");
	assert.equal(projected.turn, 1);
	assert.deepEqual(
		projected.mechanics.map((row) => row.kind),
		["roll", "clue", "scene", "time"],
		"本回合每条收据都在投影里，按发生顺序",
	);
	assert.deepEqual(
		projected.mechanics[0],
		{
			kind: "roll",
			actor: "托马斯·海耶斯",
			skill: "Spot Hidden",
			roll: 42,
			target: 55,
			threshold: 55,
			difficulty: "regular",
			level: "regular",
			passed: true,
			visibility: "public",
		},
		"明骰那条原样从内核过来，扩展不改写",
	);
	assert.deepEqual(table.mechanics().at(-1), { campaign: "test-camp", turn: 1, mechanics: projected.mechanics },
		"同一份投影也发上总线 coc:mechanics");
	// The table extension draws one compact status line from the projection. The numbers and the
	// names are the kernel's, untouched; the words around them come from the campaign's own
	// `extension` surface (contract §23), never from a literal written in the extension.
	const painted = table.ui.statuses.filter((entry) => entry.key === "coc-mechanics");
	const words = await extensionWords("zh-Hans");
	const expected = [
		words.line("mechanics_turn", { turn: 1 }),
		words.line("receipt_roll", { roll: 42, target: 55, outcome: words.word("receipt_roll_pass") }),
		words.line("receipt_clue", { name: "地窖的 抓痕" }),
		words.line("receipt_move", { scene: "前院" }),
		words.line("receipt_time", { minutes: 10 }),
	].join("  ");
	assert.deepEqual(painted.map((entry) => entry.text), [expected], "一回合画一行，机制词按战役语言，名字是数据");
	assert.ok(/42\/55/.test(painted[0].text) && painted[0].text.includes("地窖的 抓痕"), "the roll and the clue name are the kernel's own, verbatim");
	const english = await extensionWords("en");
	assert.notEqual(
		words.line("receipt_roll", { roll: 42, target: 55, outcome: words.word("receipt_roll_pass") }),
		english.line("receipt_roll", { roll: 42, target: 55, outcome: english.word("receipt_roll_pass") }),
		"a second language draws the same receipt with its own words",
	);
	assert.ok(!texts.includes("守秘人在 narrate 之后又写的正文，应该被换掉"), "守秘人自写的收尾正文被丢掉");
	const toolCallMessages = table.session.messages.filter(
		(message) => message.role === "assistant" && (message.content ?? []).some((block) => block.type === "toolCall"),
	);
	assert.ok(toolCallMessages.length >= 3, "这一回合有带工具调用的助手消息");
	assert.ok(
		toolCallMessages.every((message) => !(message.content ?? []).some((block) => block.type === "text")),
		"带工具调用的助手消息不再带文本：过程话不进记录",
	);

	const telemetry = table.telemetry();
	// 车道（记忆、校验）也写遥测，但它们不是工具调用：按 lane 列排除（契约 §12.8）。
	const tools = telemetry.filter((row) => row.ms !== undefined && row.lane === undefined).map((row) => row.tool);
	assert.deepEqual(tools, ["table.player_input", "look", "resolve", "apply", "narrate"]);
	assert.ok(telemetry.every((row) => typeof row.turn === "number"));
});

test("every Keeper call leaves its own duration, so a slow turn can be attributed", async (t) => {
	// The provider rows bracketed the request and the arrival of its headers and carried no duration,
	// so a turn with a six-minute hole in it could not be attributed to the model, to the host, or to
	// anything else -- the evidence was never kept (contract §12.8.1, §32.9).
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里落满灰。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("守秘人在 narrate 之后又写的正文，应该被换掉"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我推门进去。");
	await waitForIdle(table.session);

	const calls = table.telemetry().filter((row) => row.lane === "provider-call");
	assert.ok(calls.length >= 2, `one row per Keeper call, got ${calls.length}`);
	for (const row of calls) {
		assert.equal(typeof row.ms, "number", JSON.stringify(row));
		assert.ok(row.ms >= 0 && row.ms < 60_000, `a plausible duration, got ${row.ms}`);
		assert.ok(Array.isArray(row.blocks), "and what the message carried");
	}
	assert.deepEqual(calls[0].blocks, ["toolCall"], "the call that made the tool call says so");
	assert.equal(calls[0].stop_reason, "toolUse");
});

test("ordinary questions use free prose and never create story action controls", async t=>{
 const table=await openTable({responses:[
  fauxAssistantMessage([fauxToolCall("ask",{kind:"story",prompt:"Choose?",options:["A","B"]})],{stopReason:"toolUse"}),
  fauxAssistantMessage([fauxToolCall("narrate",{text:"门厅很安静，你准备怎么做？"})],{stopReason:"toolUse"}),
  fauxAssistantMessage("")
 ]});t.after(()=>table.dispose());
 await table.session.prompt("我看看门厅。");
 assert.equal(table.kernelRequests().filter(x=>x.method==="table.ask").length,0);
 assert.equal(table.entries("coc-choice").length,0);
 assert.equal(assistantTexts(table.session).at(-1),"门厅很安静，你准备怎么做？");
});

test("守秘人写了台词却没调 narrate：宿主替它 narrate，正文原样送进内核", async (t) => {
	const prose = "门框上有一道深深的抓痕：侦查 42／55，通过。\n\n你退后一步。";
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[fauxToolCall("resolve", { action: { intent: "investigate", goal: "看门框", method: "侦查", skill: "Spot Hidden" } })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(prose),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我看门框");

	const narrate = table.kernelRequests().find((entry) => entry.method === "table.narrate");
	assert.ok(narrate, "宿主替守秘人调了 table.narrate");
	assert.equal(narrate.params.call_id, "t1-c2");
	assert.equal(narrate.params.text, prose, "正文一字不改地送进内核：宿主不再剥任何行（契约 §8）");
	const delivered = assistantTexts(table.session).filter((text) => text.length > 0).at(-1);
	assert.equal(delivered, prose, "交付就是守秘人的正文");
	const [projected] = table.entries("coc-mechanics");
	assert.deepEqual(projected.mechanics.map((row) => row.kind), ["roll"], "隐式 narrate 也带机制投影");
	const implicitRows = table.telemetry().filter((row) => row.tool === "narrate" && row.implicit === true);
	assert.ok(implicitRows.length >= 1, "遥测记录了隐式 narrate");
});


/**
 * 契约 §23（2026-09-09，开放语言）：内核不再按脚本退回交付，宿主也不再为此催守秘人。
 * 标签集合是开的，字符类是一种探测器，开集没有表可查。正文有没有用玩家语言，由校验车道读了以后
 * 报 `play_language_mismatch`——是建议，不是拒绝，见 lanes.test.mjs。这里钉的是「不催」这一半：
 * 写成系统语言的隐式 narrate 照样一回合关掉，宿主一句都不多说。
 */
test("隐式 narrate 用了系统语言：照样交付，宿主不催（§23 取消了脚本地板）", async (t) => {
	const english = "A deep set of scratches runs down the door frame.";
	const table = await openTable({ responses: [fauxAssistantMessage(english)] });
	t.after(() => table.dispose());

	await table.session.prompt("我检查地窖门的门框");
	await waitForIdle(table.session);

	const narrates = table.kernelRequests().filter((entry) => entry.method === "table.narrate");
	assert.deepEqual(narrates.map((entry) => entry.params.text), [english], "一次就过，没有第二次重写");

	const steers = customMessages(table.session, "coc-host").filter(
		(message) => message.details?.kind === "play-language-mismatch",
	);
	assert.deepEqual(steers, [], "内核不报语言拒绝，宿主也就没有催的理由");

	const refused = table.telemetry().filter((row) => row.tool === "narrate" && row.ok === false);
	assert.deepEqual(refused, [], "没有被拒的交付");

	const texts = assistantTexts(table.session).filter((text) => text.length > 0);
	assert.equal(texts.at(-1), english, "守秘人写的那一版就是交付");
});

test("物品与现金：item、cash 原样进内核，收据只进机制投影，不进正文（#19）", async (t) => {
	const table = await openTable({
		responses: [
			fauxAssistantMessage(
				[
					fauxToolCall("apply", {
						effects: [
							{
								kind: "item",
								name: "  点三八左轮  ",
								to: " 托马斯·海耶斯 ",
								from: "看门人",
								weapon: " 点三八左轮 ",
								quantity: 1,
								label: "左轮",
								why: "看门人把枪推过桌面",
							},
							{ kind: "cash", subject: "托马斯·海耶斯", delta: -30, why: "买了一盒子弹" },
						],
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "看门人把左轮推过桌面。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("narrate 之后不该再有的正文"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我问看门人要那把枪，再买一盒子弹");

	const apply = table.kernelRequests().find((entry) => entry.method === "table.apply");
	assert.equal(apply.params.call_id, "t1-c1");
	assert.deepEqual(
		apply.params.effects[0],
		{
			kind: "item",
			name: "点三八左轮",
			to: "托马斯·海耶斯",
			from: "看门人",
			weapon: "点三八左轮",
			quantity: 1,
			label: "左轮",
			why: "看门人把枪推过桌面",
		},
		"item 的字段一个不少地到内核；名字、来路与武器 profile 都做过空白归一化（契约 §5）",
	);
	assert.deepEqual(
		apply.params.effects[1],
		{ kind: "cash", subject: "托马斯·海耶斯", delta: -30, why: "买了一盒子弹" },
		"cash 的 delta 带正负号原样送，扩展不替内核算钱",
	);

	const receipts = table.session.messages
		.filter((message) => message.role === "toolResult")
		.map((message) => JSON.stringify(message))
		.join("\n");
	assert.match(receipts, /item:点三八左轮-t1-c1/, "物品收据带 slug 与回合序号，原样回到守秘人手上");
	assert.match(receipts, /cash:t1-c1/);

	const delivered = assistantTexts(table.session).filter((text) => text.length > 0).at(-1);
	assert.equal(delivered, "看门人把左轮推过桌面。", "交付就是守秘人的正文：内核不往里插机制行（契约 §16.2）");
	const [projected] = table.entries("coc-mechanics");
	assert.deepEqual(projected.mechanics, [
		{ kind: "item", name: "点三八左轮", label: "左轮", quantity: 1, to: "托马斯·海耶斯" },
		{ kind: "cash", subject: "托马斯·海耶斯", before: 50, after: 20 },
	], "item 与 cash 的前后账在投影里，语言中立");
});

test("player input during an automatic opening is opened exactly once after delivery", async t => {
    const table = await openTable({ env: { FAKE_KERNEL_OPENING: "1" }, responses: [
        fauxAssistantMessage([fauxToolCall("narrate", { text: "The door stands open." })], { stopReason: "toolUse" }),
        fauxAssistantMessage("The door stands open."),
        fauxAssistantMessage([fauxToolCall("narrate", { text: "You enter the house." })], { stopReason: "toolUse" }),
        fauxAssistantMessage("You enter the house."),
    ] });
    t.after(() => table.dispose());
    await table.session.prompt("I enter the house.", { streamingBehavior: "followUp" });
    await waitForIdle(table.session);
    const inputs = table.kernelRequests().filter(r => r.method === "table.player_input");
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].params.text, "I enter the house.");
});


/**
 * Turn floor (docs/specs/turn-floor.md D4): a turn the Keeper closes on prose alone, having called no
 * tool at all, is steered once toward the capsule; the second leg is honoured however it comes, and
 * the implicit close carries `implicit: true` so the kernel records how the turn closed.
 */
test("守秘人整回合没碰工具就写散文：宿主先催一次 floor，第二段照常隐式交付", async (t) => {
	const thin = "诺特靠回椅背，等着你下一步。";
	const full = "诺特把钥匙推到桌沿，指了指窗外。「西区，科比特宅。天黑前回来。」他已经在看表。";
	const table = await openTable({ responses: [fauxAssistantMessage(thin), fauxAssistantMessage(full)] });
	t.after(() => table.dispose());

	await table.session.prompt("然后呢");
	await waitForIdle(table.session);

	const steers = customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "floor");
	assert.equal(steers.length, 1, "one floor steer, no more");
	assert.match(steers[0].content, /director\.offer/);
	assert.match(steers[0].content, /hand the move back/);

	const narrates = table.kernelRequests().filter((entry) => entry.method === "table.narrate");
	assert.deepEqual(narrates.map((entry) => entry.params.text), [full], "the thin draft never reached the kernel; the second leg did");
	assert.equal(narrates[0].params.implicit, true, "the host says it closed the turn for the Keeper");
	const delivered = assistantTexts(table.session).filter((text) => text.length > 0);
	assert.ok(!delivered.includes(thin), "the dropped draft is not in the transcript");
	assert.equal(delivered.at(-1), full);

	const floorRows = table.telemetry().filter((row) => row.lane === "floor");
	assert.equal(floorRows.length, 1);
	assert.equal(floorRows[0].steered, true);
});

test("碰过工具再写散文不催：一次工具调用就够，被拒的也算", async (t) => {
	const prose = "门框上有一道深深的抓痕。你退后一步。";
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "investigate", goal: "看门框", method: "侦查", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage(prose),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我看门框");
	await waitForIdle(table.session);

	assert.deepEqual(customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "floor"), []);
	const narrates = table.kernelRequests().filter((entry) => entry.method === "table.narrate");
	assert.deepEqual(narrates.map((entry) => entry.params.text), [prose]);
	assert.equal(narrates[0].params.implicit, true);
	assert.deepEqual(table.telemetry().filter((row) => row.lane === "floor"), []);
});

test("第二段还是散文：催过一次就接受，不再催", async (t) => {
	const table = await openTable({ responses: [fauxAssistantMessage("他等着你。"), fauxAssistantMessage("他还是等着你。")] });
	t.after(() => table.dispose());

	await table.session.prompt("然后呢");
	await waitForIdle(table.session);

	assert.equal(customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "floor").length, 1);
	const narrates = table.kernelRequests().filter((entry) => entry.method === "table.narrate");
	assert.deepEqual(narrates.map((entry) => entry.params.text), ["他还是等着你。"]);
	const closed = table.telemetry().filter((row) => row.event === "turn-closed");
	assert.equal(closed.length, 1);
	assert.equal(closed[0].implicit, true);
});


/**
 * A refused implicit delivery never leaves the draft on screen (contract §34.14). 2026-09-12: two
 * implicit narrates were refused for markers naming receipts that never landed, the host returned
 * without replacing the assistant message, and the Keeper's raw prose — `{{scene:...}}` and all —
 * stood in front of the player twice.
 */
test("隐式交付被拒：原稿不留在屏幕上，回合仍等着被关掉", async (t) => {
	const draft = "{{scene:corbitt-house-ground}}你站在人行道上，从屋顶看到台阶。";
	const table = await openTable({
		env: { FAKE_KERNEL_ERRORS: JSON.stringify({ "table.narrate": { code: "invalid_params", message: "no receipt in this turn is named by scene:corbitt-house-ground", code_detail: "unknown_marker" } }) },
		responses: [fauxAssistantMessage(draft), fauxAssistantMessage("")],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我去科比特宅");
	await waitForIdle(table.session);

	const delivered = assistantTexts(table.session).filter((text) => text.length > 0);
	assert.deepEqual(delivered, [], "被拒的原稿一个字都没留下");
	assert.ok(!delivered.some((text) => text.includes("{{")), "玩家读不到花括号");
	const refused = table.telemetry().filter((row) => row.tool === "narrate" && row.ok === false);
	assert.equal(refused.length, 1);
	assert.equal(refused[0].code_detail, "unknown_marker");
	const closed = table.telemetry().filter((row) => row.event === "turn-closed");
	assert.deepEqual(closed, [], "被拒的交付没有关掉回合");
	assert.deepEqual(table.entries("coc-mechanics"), [], "没有机制投影发出去");
});
