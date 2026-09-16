/**
 * 扩展接缝接真内核：开桌、开场 narrate、一个玩家回合，落盘与 git 提交都是真的。
 * 这是规格里说的「后者接真内核子进程不做 stub」。
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, waitForIdle } from "./harness.mjs";

const CAMPAIGN = "haunting-seam";

test("a source wait closes without creating a story action menu", async t => {
	const notice = "资料仍在准备，要继续等待还是暂停？";
	const table = await openTable({ realKernel: true, campaign: "source-wait-seam", responses: [
		fauxAssistantMessage([fauxToolCall("narrate", { text: "委托人把文件放在桌上，等你开口。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("开场后不应再交付的文字。"),
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "Knott", question: "The original commission" })], { stopReason: "toolUse" }),
		fauxAssistantMessage(notice),
		fauxAssistantMessage([fauxToolCall("narrate", { text: notice })], { stopReason: "toolUse" }),
		fauxAssistantMessage("不应泄漏的系统说明。"),
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	table.emit("coc:reading-bridge", { async ensure() {
		throw Object.assign(new Error("source read timed out"), { details: { reason: "reading_timeout" } });
	} });
	await table.session.prompt("请核实原书里的委托内容。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	const record = JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns/source-wait-seam/turns/0001.json"), "utf8"));
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.rendered_text, notice);
	assert.equal(table.entries("coc-choice").length, 0);
	assert.ok(!assistantTexts(table.session).some(text => text.includes("不应泄漏")));
	assert.ok(!table.telemetry().some(row => row.tool === "ask" && row.ok === false));
});

test("真内核：开场与一个回合走通，收据、渲染、git 提交齐全", async (t) => {
	const table = await openTable({
		realKernel: true,
		campaign: CAMPAIGN,
		responses: [
			// 开桌那一轮：宿主消息触发，look 之后 narrate 开场。
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(
				[fauxToolCall("narrate", { text: "1920 年的波士顿。诺特律师把一把钥匙放在桌上，房子在查珀尔街。\n\n他说前一家租户出了事。" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("开场之后守秘人多写的一句，应被替换"),
			// 玩家回合。
			fauxAssistantMessage(
				[
					fauxToolCall("resolve", {
						action: {
							intent: "investigate",
							goal: "从诺特的神色里看出他没说的事",
							method: "仔细观察他的表情和手上的文件",
							skill: "Spot Hidden",
						},
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				[fauxToolCall("apply", { effects: [{ kind: "clue", clue: "clue-knott-research-leads", how: "诺特提到可以去查档案" }] })],
				{ stopReason: "toolUse" },
			),
			// The prose names no figure (§16.3, 2026-09-09): the roll reaches the player as a projection row.
			fauxAssistantMessage(
				[fauxToolCall("narrate", { text: "诺特抬起眼，手指在文件上停了一下。\n\n他说，市政厅和报社都有这栋房子的旧档。" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("回合之后守秘人多写的一句，应被替换"),
		],
	});
	t.after(() => table.dispose());

	assert.deepEqual(table.extensionErrors, [], "扩展应该无错加载");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	const campaignDir = join(table.workspace, ".coc", "campaigns", CAMPAIGN);
	assert.ok(existsSync(join(campaignDir, "turns", "0000.json")), "开场 narrate 关闭了 turn 0");

	await table.session.prompt("我看着诺特，问他这房子以前到底出过什么事。");

	assert.ok(existsSync(join(campaignDir, "turns", "0001.json")), "玩家回合关闭了 turn 1");
	const turn1 = JSON.parse(readFileSync(join(campaignDir, "turns", "0001.json"), "utf8"));
	const receipts = JSON.stringify(turn1);
	assert.match(receipts, /roll:spot-hidden-t1-c1/, "检定收据用语义 id");
	assert.match(receipts, /clue:knott-research-leads-t1|knott-research-leads/, "线索收据落在回合记录里");

	const capsules = customMessages(table.session, "coc-capsule");
	assert.equal(capsules.length, 1, "玩家回合注入一份胶囊");
	const capsule = JSON.parse(capsules[0].content);
	assert.equal(capsule.where.scene, "commission-briefing");
	assert.ok(capsule.present.some((npc) => /Knott/i.test(npc.name)), "在场者里有诺特");

	const texts = assistantTexts(table.session).filter((text) => text.length > 0);
	const delivered = texts.at(-1);
	// 交付就是内核 narrate 回的 `rendered_text`，一字节不差：扩展不往里插东西、也不剥东西
	// （契约 §8、§16.1）。内核那边 `rendered_text` 就是守秘人的正文原样。
	const narrateResult = table.session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === "narrate")
		.map((message) => message.details)
		.at(-1);
	assert.ok(narrateResult?.rendered_text, "真内核的 narrate 回了 rendered_text");
	assert.equal(delivered, narrateResult.rendered_text, "最后一条助手消息就是内核回的那段文本");
	assert.ok(delivered.startsWith("诺特抬起眼"), "交付就是守秘人写的那段，没有被插入任何机制行");
	assert.ok(!texts.some((text) => text.includes("应被替换")), "守秘人自写的收尾正文被丢掉");

	// 机制是语言中立的 JSON 投影，走会话条目（契约 §16.2）：Pi RPC 的 `entry_appended` 因此带着它。
	const projected = table.entries("coc-mechanics").at(-1);
	assert.ok(projected, "真内核的 narrate 也带 mechanics，扩展把它落成 coc-mechanics 条目");
	assert.equal(projected.turn, 1);
	const kinds = projected.mechanics.map((row) => row.kind);
	assert.ok(kinds.includes("roll"), `这一回合的明骰在投影里：${kinds.join(",")}`);
	assert.ok(kinds.includes("clue"), `这一回合的线索在投影里：${kinds.join(",")}`);

	const log = execFileSync(
		"git",
		["--git-dir", join(table.workspace, ".coc", "repos", `${CAMPAIGN}.git`), "log", "--oneline"],
		{ encoding: "utf8" },
	)
		.trim()
		.split("\n");
	assert.ok(log.length >= 3, `建桌、开场、回合各一次提交，实际 ${log.length}: ${log.join(" | ")}`);
});

test("a placed marker leaves the delivery and reaches the frontend on the projection entry", async t => {
	// 契约 §16.6：守秘人把内核发给它的标记放进正文；正文交付里没有标记，`marked_text` 只走投影条目。
	// 这条走真内核，因为要验的正是「内核铸的标记穿过扩展到达前端」这一段接缝，stub 验不了。
	const table = await openTable({ realKernel: true, campaign: "marker-seam", responses: [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特把钥匙推过桌面，等你开口。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("开场之后多写的一句，应被替换"),
		fauxAssistantMessage([fauxToolCall("resolve", { action: {
			intent: "investigate", goal: "看清他没说的事", method: "打量他的神色", skill: "Spot Hidden",
		} })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "clue", clue: "clue-knott-research-leads", how: "他提到旧档" }] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", {
			text: "你打量他的神色{{check:spot-hidden}}，他松口提起了市政厅的旧档{{clue:knott-research-leads}}。",
		})], { stopReason: "toolUse" }),
		fauxAssistantMessage("回合之后多写的一句，应被替换"),
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("我盯着诺特，看他还瞒着什么。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	const delivered = assistantTexts(table.session).filter(text => text.length > 0).at(-1);
	assert.ok(!delivered.includes("{{"), `交付里没有标记，终端读到的还是散文：${delivered}`);
	assert.match(delivered, /你打量他的神色，他松口提起了市政厅的旧档。/);

	const projected = table.entries("coc-mechanics").at(-1);
	assert.match(projected.marked_text, /\{\{check:spot-hidden\}\}/, "带标记的那份走投影条目，给能挂组件的前端");
	const markers = Object.fromEntries(projected.mechanics.map(row => [row.kind, row.marker]));
	assert.equal(markers.roll, "check:spot-hidden");
	assert.equal(markers.clue, "clue:knott-research-leads");
});

/**
 * Contract §22. An unread page is a fact about *that* material, not about the campaign. On
 * 2026-09-15 (campaign game-3dd94f0a, turns 35 onward) one source read that timed out set a
 * session-wide `preparationWait` no later turn ever cleared, and from that moment the tool gate
 * blocked every verb but `narrate`: the player walked to his own hotel room to hold his own
 * photographic negatives up to the window and was refused, because a museum he was not in had not
 * been read. This goes through the real kernel because the seam being tested is exactly host gate
 * -> kernel verb -> receipt; a stub cannot show that the roll and the clue really landed.
 */
test("a source read that times out refuses only that material: the rest of the table still settles", async t => {
	const campaign = "blocked-source-seam";
	const table = await openTable({ realKernel: true, campaign, responses: [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特把钥匙推过桌面，等你开口。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("开场之后多写的一句，应被替换"),
		// The player reaches for the unread book, and then for what is already in front of him.
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "the-ruins", question: "What waits at the ruins?" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("resolve", { action: {
			intent: "investigate", goal: "看清诺特没说的事", method: "打量他的神色和手上的文件", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "clue", clue: "clue-knott-research-leads", how: "诺特提到可以去查档案" }] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特抬起眼，手指在文件上停了一下。遗址那几页还在核读，他说不出更多。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("回合之后多写的一句，应被替换"),
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	let reads = 0;
	table.emit("coc:reading-bridge", { async ensure() {
		reads++;
		throw Object.assign(new Error("the source is still being read"), {
			code: "needs", details: { reason: "reading_timeout", job_id: "read-5" },
			toToolText() { return "needs: the source is still being read"; },
		});
	} });

	await table.session.prompt("我先去查那处遗址的原书页；查不到就先看着诺特。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	assert.equal(reads, 1, "the refused read was attempted once");
	// The refusal names the material and what is still available; it is not a table-wide stop order.
	const refusal = table.session.messages
		.filter(message => message.role === "toolResult" && message.toolName === "lookup")
		.map(message => (message.content ?? []).filter(block => block.type === "text").map(block => block.text).join("")).at(-1);
	assert.ok(refusal, "the source lookup returned a tool result");
	assert.match(refusal, /the-ruins/, "the refusal names what is being read");
	assert.match(refusal, /nothing else at this table is blocked/i, "the refusal says what the table can still do");
	assert.match(refusal, /do not invent another question/, "the read identity guidance of #65 survives the rewrite");

	// The table settled while that read was outstanding: both verbs reached the kernel and both left receipts.
	const settled = table.telemetry().filter(row => row.ok === true).map(row => row.tool);
	assert.ok(settled.includes("resolve"), `a check on someone already on stage is not blocked by an unread page elsewhere: ${settled.join(",")}`);
	assert.ok(settled.includes("apply"), `an effect that needs nothing unread still lands: ${settled.join(",")}`);
	assert.equal(table.telemetry().filter(row => row.tool === "resolve" && row.ok === false).length, 0);
	const record = JSON.parse(readFileSync(join(table.workspace, ".coc", "campaigns", campaign, "turns", "0001.json"), "utf8"));
	assert.equal(record.closed_by, "narrate");
	const receipts = JSON.stringify(record);
	assert.match(receipts, /roll:spot-hidden-t1-c/, "the roll of the unaffected action has its receipt");
	assert.match(receipts, /knott-research-leads/, "the clue of the unaffected action has its receipt");
	const mechanics = table.entries("coc-mechanics").at(-1);
	assert.deepEqual([mechanics.mechanics.some(row => row.kind === "roll"), mechanics.mechanics.some(row => row.kind === "clue")], [true, true]);

	// §16.1: the host's own instruction is Keeper-facing text and never reaches the player.
	const delivered = assistantTexts(table.session).filter(text => text.length > 0).at(-1);
	assert.ok(delivered.startsWith("诺特抬起眼"), delivered);
	assert.ok(!delivered.includes("nothing else at this table"), "the source-wait instruction is not narrated at the player");
});

test("a source wait dies with its turn instead of owning the rest of the session", async t => {
	const campaign = "source-wait-lifetime";
	const table = await openTable({ realKernel: true, campaign, responses: [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特把钥匙推过桌面，等你开口。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("开场之后多写的一句，应被替换"),
		// Turn 1: the source read times out and the Keeper closes on what it has.
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "the-ruins", question: "What waits at the ruins?" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "遗址那几页还在核读。诺特还坐在你对面。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("多写的一句，应被替换"),
		// Turn 2: a new player input is a new context. The Keeper may reach for that page again -- the
		// wait of turn 1 is not a standing order, and the player is never left without a way back to it.
		fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "the-ruins", question: "What waits at the ruins?" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("resolve", { action: {
			intent: "investigate", goal: "看清诺特没说的事", method: "打量他的神色", skill: "Spot Hidden" } })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "他的手指在文件边缘停住。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("多写的一句，应被替换"),
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	let reads = 0;
	table.emit("coc:reading-bridge", { async ensure() {
		reads++;
		throw Object.assign(new Error("the source is still being read"), {
			code: "needs", details: { reason: "reading_timeout" },
			toToolText() { return "needs: the source is still being read"; },
		});
	} });

	await table.session.prompt("我先去查那处遗址的原书页。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	assert.equal(reads, 1, "one source query, one reading attempt");

	await table.session.prompt("再试一次那几页；不行就继续盯着诺特。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	assert.equal(reads, 2,
		"the new player turn may reach for the same page again: the wait belonged to the turn that raised it, not to the session");
	const record = JSON.parse(readFileSync(join(table.workspace, ".coc", "campaigns", campaign, "turns", "0002.json"), "utf8"));
	assert.equal(record.closed_by, "narrate");
	assert.match(JSON.stringify(record), /roll:spot-hidden-t2-c/,
		"and the rest of that turn settles as usual, with its own receipt");
});
