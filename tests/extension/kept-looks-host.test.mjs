/**
 * Contract §255, the host side over the product path: after a delivery the kernel extension asks `table.looks.job`, the
 * first-sight lane answers the look questions in the background, and `table.looks` receives only the delivered text's
 * own spans. The delivery never waits for it.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor, waitForIdle } from "./harness.mjs";

const OPENING = "烈日下，一座旧加油站。棚下坐着一个高瘦的男人，衬衫袖子卷到肘上。他朝你点了点头。";
const TARGETS = [{ kind: "place", id: "fs-esso-station", name: "埃索加油站", want: ["look"] },
	{ kind: "person", id: "fs-lars", name: "高个子", want: ["look", "pronoun"] }];
const narrate = (text) => fauxAssistantMessage([fauxToolCall("output", { text })], { stopReason: "toolUse" });
const calls = (table, method) => table.kernelRequests().filter((row) => row.method === method);

test("a delivery's looks are asked after it, in the background, and only delivered spans reach table.looks", async (t) => {
	let release, asked;
	const answer = new Promise((resolve) => { release = resolve; }), request = new Promise((resolve) => { asked = resolve; });
	const step = async (context) => {
		asked((context?.messages ?? []).flatMap((m) => (m.role === "user" ? m.content : [])).map((b) => b.text ?? "").join(""));
		return fauxAssistantMessage(JSON.stringify(await answer));
	};
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1", FAKE_KERNEL_LOOKS: JSON.stringify(TARGETS) },
		responses: [narrate(OPENING), fauxAssistantMessage("after")],
		laneResponses: { firstSight: [step] },
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 5_000 });
	const input = JSON.parse(await Promise.race([request, new Promise((_, reject) => setTimeout(() => reject(new Error("no look check")), 10_000).unref())]));
	assert.deepEqual(input, { prose: OPENING, targets: TARGETS.map(({ id, kind, name, want }) => ({ id, kind, name, want })) });
	assert.equal(table.session.isStreaming, false, "the turn is over while its look check is still held");
	assert.equal(calls(table, "table.looks").length, 0, "the delivery did not wait for it");
	release({ targets: [{ id: "fs-lars", excerpts: ["棚下坐着一个高瘦的男人，衬衫袖子卷到肘上。", "他戴着一顶牛仔帽。"], pronoun: "he" },
		{ id: "fs-esso-station", excerpts: [] }] });
	const [recorded] = await waitFor(() => calls(table, "table.looks").length && calls(table, "table.looks"), { label: "table.looks" });
	assert.deepEqual(recorded.params, { campaign: "test-camp", turn: 0,
		items: [{ kind: "person", id: "fs-lars", excerpts: ["棚下坐着一个高瘦的男人，衬衫袖子卷到肘上。"], pronoun: "he" }] });
	const row = await waitFor(() => table.telemetry().find((entry) => entry.event === "looks" && entry.ok === true), { label: "looks row" });
	assert.deepEqual([row.turn, row.targets, row.kept.people, row.pronouns], [0, 2, 1, 1]);
});
