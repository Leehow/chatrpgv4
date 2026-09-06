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
	assert.match(delivered, /【明骰】/, "交付文本含内核渲染的明骰行");
	assert.match(delivered, /【变化】线索/, "交付文本含线索变化块");
	assert.ok(!texts.some((text) => text.includes("应被替换")), "守秘人自写的收尾正文被丢掉");

	const log = execFileSync(
		"git",
		["--git-dir", join(table.workspace, ".coc", "repos", `${CAMPAIGN}.git`), "log", "--oneline"],
		{ encoding: "utf8" },
	)
		.trim()
		.split("\n");
	assert.ok(log.length >= 3, `建桌、开场、回合各一次提交，实际 ${log.length}: ${log.join(" | ")}`);
});
