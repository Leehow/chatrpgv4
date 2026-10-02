/**
 * Contract §168.5 (docs/specs/first-sight.md 2.4), the host side over the product path: the real kernel extension and
 * context hook, the fake kernel carrying a `first_sight` section, a scripted Keeper and a scripted first-sight lane.
 *
 * Blood Road (game-717a9e4b, 2026-10-02): the opening described one man of three and not the station. The check runs
 * after each delivery whose capsule carried the section, in the background; it is watched, never waited for.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor, waitForIdle } from "./harness.mjs";

const STATION = "标志陈旧仍可辨埃索；两台旧加油机仍可用；左侧生锈可乐机嗡鸣，香烟贩卖机手写“故障”。";
const LARS = "中年、高瘦、被晒得黝黑，一头灰白头发。穿白色系扣衬衫和意外很干净的工装服。";
const NATE = "中等身高，发际线后退，啤酒肚，一口烂牙。";
const SECTION = { place: { id: "fs-esso-station", name: "埃索加油站", described: STATION },
	people: [{ id: "fs-lars", name: "拉塞尔", described: LARS }, { id: "fs-nate", name: "内特", described: NATE }] };
const OPENING = "烈日下，一座旧加油站。棚下坐着一个高瘦的男人。";

/** A lane step held until `release(answer)`; `asked` resolves with the user text the lane sent. */
function heldLane() {
	let release, asked;
	const answer = new Promise((resolve) => { release = resolve; });
	const request = new Promise((resolve) => { asked = resolve; });
	const step = async (context) => {
		asked((context?.messages ?? []).flatMap((m) => (m.role === "user" ? m.content : [])).map((b) => b.text ?? "").join(""));
		return fauxAssistantMessage(JSON.stringify(await answer));
	};
	return { step, release, request };
}
/** A promise or a refusal after `ms`: a check that never starts must fail the case, not hang it. */
const within = (promise, label, ms = 10_000) => Promise.race([promise,
	new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms).unref())]);
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });
const calls = (table, method) => table.kernelRequests().filter((row) => row.method === method);
const sentCapsule = (context) => (context?.messages ?? []).filter((m) => m.role === "user")
	.flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }])).map((b) => b.text ?? "").join("\n");

test("the opening's first sight is checked after delivery, in the background, and lands through table.first_sight", async (t) => {
	const lane = heldLane();
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1", FAKE_KERNEL_FIRST_SIGHT: JSON.stringify(SECTION) },
		responses: [narrate(OPENING), fauxAssistantMessage("after")],
		laneResponses: { firstSight: [lane.step] },
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 5_000 });
	assert.equal(calls(table, "table.narrate").length, 1, "the opening was delivered");
	const input = JSON.parse(await within(lane.request, "the first-sight check"));
	assert.equal(table.session.isStreaming, false, "the turn is over while its check is still held");
	assert.deepEqual(input, { prose: OPENING, items: [{ id: "fs-esso-station", kind: "place", described: STATION },
		{ id: "fs-lars", kind: "person", described: LARS }, { id: "fs-nate", kind: "person", described: NATE }] },
		"the delivered prose and what the opening's capsule carried");
	assert.equal(calls(table, "table.first_sight").length, 0, "the delivery did not wait for the check");

	lane.release({ items: [{ id: "fs-esso-station", details: [{ excerpt: "两台旧加油机仍可用", visible: true, shown: false }, { excerpt: "香烟贩卖机手写\"故障\"", visible: true, shown: false }] }, { id: "fs-lars", details: [] },
		// Every excerpt unanchored: the person is neither shown nor given an open row.
		{ id: "fs-nate", details: [{ excerpt: "戴一顶牛仔帽", visible: true, shown: false }] }] });
	const [recorded] = await waitFor(() => calls(table, "table.first_sight").length && calls(table, "table.first_sight"), { label: "table.first_sight" });
	assert.deepEqual(recorded.params, { campaign: "test-camp", turn: 0, items: [
		{ id: "fs-esso-station", kind: "place", missing: ["两台旧加油机仍可用", "香烟贩卖机手写“故障”"] },
		{ id: "fs-lars", kind: "person", missing: [] }] });
	const row = await waitFor(() => table.telemetry().find((entry) => entry.lane === "first-sight" && entry.ok === true), { label: "lane row" });
	assert.deepEqual([row.turn, row.items, row.shown, row.missing, row.unanchored, row.model], [0, 3, 1, 1, 1, "firstsight/f1"]);
});

test("while a check is in flight the Keeper is not handed its items; once it lands they return as what is still missing", async (t) => {
	const lane = heldLane(), seen = [];
	const keeper = (text) => (context) => { seen.push(sentCapsule(context)); return narrate(text); };
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1", FAKE_KERNEL_FIRST_SIGHT: JSON.stringify(SECTION) },
		// A narrate closes its turn: no reply follows it.
		responses: [narrate(OPENING), keeper("你把车停在油泵旁。"), keeper("拉塞尔抬起头。")],
		laneResponses: { firstSight: [lane.step] },
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session);
	await within(lane.request, "the opening's check");

	// Turn 1 opens while the opening's check still runs: none of its items reaches the Keeper.
	await table.session.prompt("我把车开到油泵旁边，打量棚子底下的人。");
	await waitForIdle(table.session);
	assert.equal(seen.length, 1);
	for (const id of ["fs-esso-station", "fs-lars", "fs-nate"]) assert.ok(!seen[0].includes(id), `${id} is in flight and left out`);
	const capsule = JSON.parse(table.session.messages.filter((m) => m.role === "custom" && m.customType === "coc-capsule").at(-1).content);
	assert.equal(capsule.first_sight, undefined, "the emptied section is left out of the persisted capsule too");
	const omitted = table.telemetry().find((entry) => entry.lane === "first-sight" && entry.event === "in_flight");
	assert.deepEqual(omitted.omitted, ["place:fs-esso-station", "person:fs-lars", "person:fs-nate"]);
	assert.equal(table.lanes.firstSight.requests().length, 1, "turn 1 carried no first sight, so its delivery is not checked");

	lane.release({ items: [{ id: "fs-esso-station", details: [] }, { id: "fs-lars", details: [{ excerpt: "穿白色系扣衬衫", visible: true, shown: false }] }, { id: "fs-nate", details: [] }] });
	await waitFor(() => calls(table, "table.first_sight").length === 1, { label: "the check landed" });

	// The next read carries what the check found still unshown, and its delivery is checked against that.
	table.lanes.firstSight.setResponses([async () => fauxAssistantMessage(JSON.stringify({ items: [{ id: "fs-lars", details: [] }] }))]);
	await table.session.prompt("我走过去跟那个高个子打招呼。");
	await waitForIdle(table.session);
	assert.equal(seen.length, 2);
	assert.ok(seen[1].includes("fs-lars") && seen[1].includes("穿白色系扣衬衫"), "the missing detail is back for the Keeper");
	assert.ok(!seen[1].includes("fs-esso-station"), "the shown place is not");
	await waitFor(() => calls(table, "table.first_sight").length === 2, { label: "turn 2 checked" });
	assert.deepEqual(JSON.parse(table.lanes.firstSight.requests().at(-1)).items, [{ id: "fs-lars", kind: "person", described: "穿白色系扣衬衫" }]);
	assert.deepEqual(calls(table, "table.first_sight").at(-1).params.items, [{ id: "fs-lars", kind: "person", missing: [] }]);
});

test("a failed check records nothing: the items stay owed in full", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1", FAKE_KERNEL_FIRST_SIGHT: JSON.stringify(SECTION) },
		responses: [narrate(OPENING), fauxAssistantMessage("after")],
		laneResponses: { firstSight: [fauxAssistantMessage("I cannot tell.")] },
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session);
	const row = await waitFor(() => table.telemetry().find((entry) => entry.lane === "first-sight" && entry.ok === false), { label: "failed lane row" });
	assert.equal(row.reason, "bad_output");
	assert.equal(calls(table, "table.first_sight").length, 0);
});
