/**
 * Contract §203.6 (docs/specs/scene-establishment.md), the host side over the product path: the real kernel extension, the
 * fake kernel answering `table.establish.view`, a scripted Keeper and a scripted establishing review.
 *
 * TR-F2 run 3 (2026-10-08): the newsroom arrived as two dry sentences and nothing between the Keeper and the player could
 * tell. A turn that owes an establishing reply has its draft judged once before delivery: a thin one is steered once, a
 * rich one goes straight out, and whatever follows the steer is delivered. The implicit close is checked too.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor, waitForIdle } from "./harness.mjs";

const OWES = [
	{ key: "space", line: "the space itself" }, { key: "people", line: "the people here" }, { key: "things", line: "one or two things" },
	{ key: "senses", line: "two senses beyond sight" }, { key: "period", line: "the period" }, { key: "hook", line: "a hook" },
];
const VIEW = { establish: { place: { id: "newspaper-morgue", name: "环球报编辑部" }, why: ["arrival"], owes: OWES, package: { mod: "narration-craft", version: "2.5.0" } },
	review: { mod: "narration-audit", version: "1.3.0", instruction: "# Establishing review\n\nJudge the draft row by row." }, present: ["门卫", "整理剪报的女职员"], era: "1920s" };
const THIN = "你赶到报社时，编辑部仍有打字机声，桌上摊着索引卡和剪报。";
const RICH = "你推开报社三楼的玻璃门，编辑部比想象中狭长，二十来张橡木写字台挤在两排铸铁柱之间，头顶的吊灯泛着黄光。"
	+ "打字机声和电报机的嘀嗒声混在一起，空气里是油墨、雪茄和湿呢子大衣的味道。七八个只穿衬衫马甲的记者伏案疾书，袖箍勒在肘上；"
	+ "门边一个瘦高的门卫站起来，上下打量你。靠墙的铁丝篮里插着一束刚撕下的电讯稿，最上面那张印着科比特的名字。";
const allShown = (prose) => JSON.stringify({ items: [
	{ key: "space", verdict: "shown", quote: "编辑部比想象中狭长" }, { key: "people", verdict: "shown", quote: "七八个只穿衬衫马甲的记者伏案疾书" },
	{ key: "things", verdict: "shown", quote: "靠墙的铁丝篮里插着一束刚撕下的电讯稿" }, { key: "senses", verdict: "shown", quote: "空气里是油墨、雪茄和湿呢子大衣的味道" },
	{ key: "period", verdict: "shown", quote: "打字机声和电报机的嘀嗒声" }, { key: "hook", verdict: "shown", quote: "最上面那张印着科比特的名字" }].map((row) => {
	assert.ok(prose.includes(row.quote), `fixture quote ${row.quote}`); return row; }) });
const thinVerdict = JSON.stringify({ items: [
	{ key: "space", verdict: "missing" }, { key: "people", verdict: "missing" }, { key: "things", verdict: "shown", quote: "桌上摊着索引卡和剪报" },
	{ key: "senses", verdict: "missing" }, { key: "period", verdict: "shown", quote: "仍有打字机声" }, { key: "hook", verdict: "missing" }] });
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });
const calls = (table, method) => table.kernelRequests().filter((row) => row.method === method);
const rows = (table, event) => table.telemetry().filter((row) => row.lane === "establish" && (!event || row.event === event));
const toolErrors = (session) => session.messages.filter((m) => m.role === "toolResult" && m.isError)
	.map((m) => (m.content ?? []).map((b) => b.text ?? "").join(""));

test("a thin establishing draft is steered once; the rewrite is delivered without a second verdict and judged afterwards", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ESTABLISH: JSON.stringify(VIEW) },
		responses: [narrate(THIN), narrate(RICH), fauxAssistantMessage("after")],
		laneResponses: { establish: [fauxAssistantMessage(thinVerdict), fauxAssistantMessage(allShown(RICH))] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("对，现在就动身去环球报社。");
	await waitForIdle(table.session);

	const delivered = calls(table, "table.narrate");
	assert.equal(delivered.length, 1, "the thin draft never reached the kernel");
	assert.equal(delivered[0].params.text, RICH);
	assert.deepEqual(delivered[0].params.establish_review, { status: "steered", steered: true, missing: ["space", "people", "senses", "hook"] },
		"the record keeps what the steer was about, host-only");
	const [refusal] = toolErrors(table.session);
	assert.match(refusal, /establish_thin|does not yet establish/);
	assert.match(refusal, /space: the space itself/, "the fix names the package's own lines for what was missing");
	assert.match(refusal, /keep the player's act, every settled result and every line already spoken/);

	const asked = table.lanes.establish.requests();
	assert.equal(JSON.parse(asked[0]).prose, THIN, "the review read the draft");
	assert.deepEqual(JSON.parse(asked[0]).owes, OWES);
	assert.deepEqual(JSON.parse(asked[0]).present, ["门卫", "整理剪报的女职员"]);
	assert.equal(calls(table, "table.establish.view").length, 1, "the turn's one check: the rewrite is not judged before it lands");
	const after = await waitFor(() => rows(table, "after_steer")[0], { label: "the background verdict on the rewrite" });
	assert.deepEqual([after.verdict, after.missing], ["pass", []]);
	assert.deepEqual(rows(table).map((row) => row.event), ["due", "judged", "steered", "after_steer"]);
	assert.deepEqual(rows(table, "judged")[0].missing, ["space", "people", "senses", "hook"]);
});

test("a rich establishing draft goes straight out with its verdict; a turn that owes nothing is not judged", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ESTABLISH: JSON.stringify(VIEW) },
		responses: [narrate(RICH), narrate("门卫接过名片，扫了一眼。")],
		laneResponses: { establish: [fauxAssistantMessage(allShown(RICH))] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("对，现在就动身去环球报社。");
	await waitForIdle(table.session);
	const [first] = calls(table, "table.narrate");
	assert.equal(first.params.text, RICH);
	assert.deepEqual(first.params.establish_review, { status: "pass" });
	assert.deepEqual(rows(table).map((row) => row.event), ["due", "judged"]);
	assert.equal(toolErrors(table.session).length, 0, "nothing was refused");

	// The place is established now: the next turn keeps its economy and nothing judges it.
	await table.session.prompt("我递上名片。");
	await waitForIdle(table.session);
	assert.equal(calls(table, "table.narrate").length, 2);
	assert.equal(calls(table, "table.narrate")[1].params.establish_review, undefined);
	assert.equal(table.lanes.establish.requests().length, 1, "only the establishing turn asked the review");
});

test("the implicit close is checked too: a thin prose-only draft is held, the turn close steers once, and the next leg lands", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ESTABLISH: JSON.stringify(VIEW) },
		responses: [fauxAssistantMessage(THIN), fauxAssistantMessage(RICH)],
		laneResponses: { establish: [fauxAssistantMessage(thinVerdict), fauxAssistantMessage(allShown(RICH))] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("对，现在就动身去环球报社。");
	await waitForIdle(table.session);
	const delivered = calls(table, "table.narrate");
	assert.equal(delivered.length, 1);
	assert.equal(delivered[0].params.implicit, true);
	assert.equal(delivered[0].params.text, RICH, "the steered leg is what the player got");
	assert.equal(delivered[0].params.establish_review.status, "steered");
	const steer = table.session.messages.filter((m) => m.role === "custom" && m.customType === "coc-host").map((m) => String(m.content)).join("\n");
	assert.match(steer, /does not yet establish: space: the space itself/, "the turn close carried the fix");
	assert.ok(table.telemetry().some((row) => row.lane === "delivery" && row.reason === "establish_thin"), "the held draft's drop is on the record");
});

test("an unavailable review delivers the draft as written and says why; an unanchored quote counts as missing", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ESTABLISH: JSON.stringify(VIEW) },
		responses: [narrate(THIN)],
		laneResponses: { establish: [fauxAssistantMessage("I think it is fine.")] },
	});
	t.after(() => table.dispose());
	await table.session.prompt("对，现在就动身去环球报社。");
	await waitForIdle(table.session);
	assert.equal(calls(table, "table.narrate")[0].params.text, THIN, "the review's own failure never holds a delivery");
	assert.deepEqual(calls(table, "table.narrate")[0].params.establish_review, { status: "unavailable" });
	assert.equal(rows(table, "unavailable")[0].reason, "bad_output");

	const forged = await openTable({
		env: { FAKE_KERNEL_ESTABLISH: JSON.stringify(VIEW) },
		responses: [narrate(THIN), narrate(RICH)],
		// Every row claimed shown, quoting words the draft does not have: a verdict taken on its quotes, not its word.
		laneResponses: { establish: [fauxAssistantMessage(allShown(RICH))] },
	});
	t.after(() => forged.dispose());
	await forged.session.prompt("对，现在就动身去环球报社。");
	await waitForIdle(forged.session);
	const judged = rows(forged, "judged")[0];
	assert.equal(judged.verdict, "thin");
	assert.deepEqual(judged.unanchored, ["space", "people", "things", "senses", "period", "hook"]);
	assert.equal(calls(forged, "table.narrate")[0].params.text, RICH);
});

test("first sight: a person the book gives no words is checked on one verdict and lands as shown", async (t) => {
	const section = { people: [{ id: "fs-arty", name: "门卫", undescribed: true }] };
	const table = await openTable({
		env: { FAKE_KERNEL_OPENING: "1", FAKE_KERNEL_FIRST_SIGHT: JSON.stringify(section) },
		responses: [narrate("门边一个穿灰马甲的瘦高男人站起来，眯眼打量你。"), fauxAssistantMessage("after")],
		laneResponses: { firstSight: [fauxAssistantMessage(JSON.stringify({ items: [{ id: "fs-arty", shown: true }] }))] },
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session);
	const [recorded] = await waitFor(() => calls(table, "table.first_sight").length && calls(table, "table.first_sight"), { label: "table.first_sight" });
	assert.deepEqual(JSON.parse(table.lanes.firstSight.requests()[0]).items, [{ id: "fs-arty", kind: "person", undescribed: true }],
		"the lane is told the book has no words for him");
	assert.deepEqual(recorded.params.items, [{ id: "fs-arty", kind: "person", missing: [] }]);
	const row = await waitFor(() => table.telemetry().find((entry) => entry.lane === "first-sight" && entry.ok === true), { label: "lane row" });
	assert.deepEqual(row.undescribed, { shown: 1, unshown: 0 });
});
