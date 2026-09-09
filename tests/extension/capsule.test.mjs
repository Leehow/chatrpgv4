/**
 * 切片 3 的胶囊接缝（契约 §13.9）：九节胶囊仍是一条 `coc-capsule` 宿主消息、
 * 内容跟内核发出来的一字不差（扩展不做二次渲染），Director 的建议节拍与硬规则
 * 经总线上到桌况状态行。打分与依据本身是内核的事，这里只看接缝。
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { extensionWords } from "../../extensions/ui/words.ts";
import { customMessages, openTable } from "./harness.mjs";

/** The harness opens its campaign in this play language; the status lines must come back in it. */
const PLAYED = "zh-Hans";

/** 契约 §13.1 的九节；`head` 与 `turn` 不计预算，`recent` 是切片 0 就有的。 */
const NINE = [
	"where",
	"present",
	"known",
	"pressures",
	"obligations",
	"director",
	"situations",
	"memory",
	"style",
];

/** 注入的那条胶囊消息的正文；Pi 可能把 content 规范成文本块数组，两种都收。 */
function capsuleContent(session) {
	const [message] = customMessages(session, "coc-capsule");
	if (!message) return undefined;
	return typeof message.content === "string"
		? message.content
		: (message.content ?? []).map((block) => block.text).join("");
}

function directorStatuses(table) {
	return table.ui.statuses.filter((entry) => entry.key === "coc-director");
}

const CLOSE_THE_TURN = [
	fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里落满灰。" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("收尾"),
];

test("九节胶囊原样注入：内容跟内核序列化出来的一字不差", async (t) => {
	const table = await openTable({ responses: CLOSE_THE_TURN });
	t.after(() => table.dispose());

	await table.session.prompt("我推门进去");

	const messages = customMessages(table.session, "coc-capsule");
	assert.equal(messages.length, 1, "胶囊仍是一条 coc-capsule 消息，没有拆成几条");
	assert.equal(messages[0].display, false, "胶囊守秘人专属：不显示给玩家");

	const injected = capsuleContent(table.session);
	const logged = table.kernelRequests().find((entry) => entry.method === "table.player_input")?.capsule_json;
	assert.ok(logged, "假内核记下了它自己序列化出来的胶囊原文");
	assert.equal(injected, logged, "注入的胶囊跟内核发出来的逐字节相同：扩展不做二次渲染");

	const capsule = JSON.parse(injected);
	assert.deepEqual(
		NINE.filter((section) => capsule[section] !== undefined),
		NINE,
		"九节齐全",
	);
	// head 说清胶囊里已经有什么，look/lookup 才只查它没答的（契约 §13.8）。
	assert.match(capsule.head, /不必再 look/);
	assert.ok(capsule.where.clock?.elapsed, "时钟在胶囊里，不必再 look focus=time");
	assert.ok(capsule.where.back?.length >= 1, "来路在胶囊里");
	assert.equal(capsule.known.clues_here[0].discovered, false, "本场景未发现的线索在胶囊里");
	assert.ok(capsule.present[0].secret, "在场者的秘密在胶囊里，不必再 lookup kind=secret");
});

test("状态行挂上 Director 的建议节拍", async (t) => {
	const table = await openTable({ responses: CLOSE_THE_TURN });
	t.after(() => table.dispose());

	await table.session.prompt("我推门进去");

	const painted = directorStatuses(table);
	assert.equal(painted.length, 1, "一回合一次，节拍没变就不重画");
	// The beat name is the kernel's closed enum; the word in front of it is the campaign's
	// (contract §23), read from content/ui/<tag>/extension.json rather than written here.
	const played = await extensionWords(PLAYED);
	const other = await extensionWords("en");
	assert.equal(painted[0].text, played.line("director_beat", { beat: "REVEAL" }));
	assert.notEqual(
		played.line("director_beat", { beat: "REVEAL" }),
		other.line("director_beat", { beat: "REVEAL" }),
		"a second language draws the same row with its own word",
	);
});

test("有 override 时状态行把硬规则一起显示", async (t) => {
	const table = await openTable({
		responses: CLOSE_THE_TURN,
		env: { FAKE_KERNEL_DIRECTOR: JSON.stringify({ beat: "SUBSYSTEM", override: "session-active" }) },
	});
	t.after(() => table.dispose());

	await table.session.prompt("我朝它冲过去");

	const painted = directorStatuses(table);
	const words = await extensionWords(PLAYED);
	assert.equal(painted.at(-1)?.text, words.line("director_beat_override", { beat: "SUBSYSTEM", override: "session-active" }));
	assert.ok(painted.at(-1)?.text.includes("SUBSYSTEM") && painted.at(-1)?.text.includes("session-active"), "the two closed enums are still shown verbatim");
});

test("内核不给 director 节时状态行上不挂东西", async (t) => {
	const table = await openTable({
		responses: CLOSE_THE_TURN,
		env: { FAKE_KERNEL_NO_DIRECTOR: "1" },
	});
	t.after(() => table.dispose());

	await table.session.prompt("我推门进去");

	assert.deepEqual(directorStatuses(table), [], "切片 0–2 的内核不该被显示成有节拍");
	const capsule = JSON.parse(capsuleContent(table.session));
	assert.equal(capsule.director, undefined);
});
