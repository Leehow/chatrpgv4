/**
 * Section 166 supersedes section 143.10's prose-form rejection and rewrite.
 * Historical evidence: npc-actor-gate-a2, turns 6 and 7 (2026-09-26).
 * Current deliveries retain deterministic transport/rendering and publish the first completed draft.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitForIdle } from "./harness.mjs";
import { COC_TOOLS } from "../../extensions/kernel/tools.ts";
import { unwrapArgumentMarkup } from "../../extensions/kernel/tool-argument-markup.ts";

const STEER = "player-facing prose carries no markup; write it as prose";
const KNOTT = "Steven Knott";
const OPENING = `诺特把钥匙推过来。{{say:${KNOTT}}}“坐吧，海耶斯先生。”{{/say}}`;
/** A2 turn 6's tail: the Keeper's own text argument ended in a closing tag. §144 takes it off an explicit narrate. */
const TAGGED = `他咽了一口，喉咙响得比刚才更清楚。\n\n{{say:${KNOTT}}}“钥匙……钥匙你自己捡。”{{/say}}\n\n门外的走廊里没人来。</text>\n`;
const REWRITTEN = `他咽了一口，喉咙响得比刚才更清楚。\n\n{{say:${KNOTT}}}“钥匙……钥匙你自己捡。”{{/say}}\n\n门外的走廊里没人来。`;
/** The same tail with a closing tag that names no narrate parameter: §144 leaves it, so this gate reads it. */
const FRAME = "narration";
const CLOSED = `${REWRITTEN}</${FRAME}>\n`;
/** A2 turn 7's shape: an implicit close with two markdown list lines. */
const LISTED = `诺特靠回椅背，没有再看你。{{say:${KNOTT}}}“东西都在那儿。”{{/say}}\n\n- 钥匙还躺在桌腿边的地板上，铜齿朝上。\n- 桌上那幅镶框的地契歪着，请人的启事从租约底下露出半张。`;
const PROSE = `诺特靠回椅背，没有再看你。{{say:${KNOTT}}}“东西都在那儿。”{{/say}}\n\n钥匙还躺在桌腿边的地板上，铜齿朝上；桌上那幅镶框的地契歪着，请人的启事从租约底下露出半张。`;
/**
 * Ordinary prose the check must pass: say tokens and a mechanics-shaped marker, em-dashes and a dash opening a line,
 * quotation marks, ellipses, a lone hyphen inside a sentence, a comparison sign, a hyphenated word, a number and a
 * hash sign inside a sentence, an asterisk inside a sentence.
 */
const ORDINARY = `诺特站起来——又坐下。{{say:${KNOTT}}}“行……行了。”{{/say}}\n\n` +
	`——门外有脚步声，停了一下，又走远了。\n\n` +
	`他看了看表 - 十一点差五分 - 然后把手按在桌上。 The ledger reads 3 < 5, a well-kept note, room #4 * two.\n\n` +
	`…窗外起风了。{{say:${KNOTT}}}“你还站着干什么？”{{/say}}`;

const narrateRows = (table) => table.telemetry().filter((row) => row.tool === "narrate" && row.call_id);
const markupRows = (table) => table.telemetry().filter((row) => row.lane === "delivery" && row.reason === "markup_in_prose");
const turnRecord = (table, campaign, turn) =>
	JSON.parse(readFileSync(join(table.workspace, `.coc/campaigns/${campaign}/turns/${String(turn).padStart(4, "0")}.json`), "utf8"));
const refusedNarrates = (table) => table.session.messages
	.filter((message) => message.role === "toolResult" && message.toolName === "narrate" && message.details?.coc_error)
	.map((message) => message.details.coc_error);
const shownText = (table) => (table.session.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? [])
	.filter((block) => block.type === "text").map((block) => block.text).join("");
const schema = (name) => COC_TOOLS.find((tool) => tool.name === name).parameters;
/** What §144 hands on from a narrate `text`: the same string when it leaves it as written. */
const pastTheBoundary = (text) => {
	const result = unwrapArgumentMarkup("narrate", schema("narrate"), { text });
	assert.equal(result.ok, true, `§144 refused ${JSON.stringify(text)}`);
	return result.args.text;
};

async function playTurn(t, campaign, turnResponses) {
	const table = await openTable({ realKernel: true, campaign, responses: [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: OPENING })], { stopReason: "toolUse" }),
		...turnResponses,
	] });
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("我等他开口。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	return table;
}



/**
 * The combined behaviour since the line-2 merge: A2 turn 6's own shape, an explicit narrate whose `text` ends in
 * `</text>`, is unwrapped by §144 before anything reads it, so it is delivered on the first try, clean, and this gate is
 * never met -- no refusal, no steer spent, no `markup_in_prose` row, no finding. The repair is §144's row instead.
 */
test("real kernel, §144 before §143.10: an explicit narrate ending in </text> is unwrapped at the host boundary and delivered on the first try, never refused markup_in_prose", async (t) => {
	const campaign = "markup-unwrapped";
	assert.equal(pastTheBoundary(TAGGED), REWRITTEN, "§144 takes the tag off");
	const table = await playTurn(t, campaign, [
		fauxAssistantMessage([fauxToolCall("narrate", { text: TAGGED })], { stopReason: "toolUse" }),
	]);
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[true, null], [true, null]], "the opening, then the turn: no refusal");
	assert.deepEqual(refusedNarrates(table), []);
	assert.deepEqual(markupRows(table), [], "the gate never met it");
	assert.deepEqual(table.telemetry().filter((row) => row.lane === "tool_arguments").map((row) => [row.event, row.tool, row.repairs]),
		[["markup_unwrapped", "narrate", [{ field: "text", recovered: [], kept: [] }]]], "the repair is §144's");
	const record = turnRecord(table, campaign, 1);
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.text, REWRITTEN);
	assert.ok(!record.rendered_text.includes("</text>") && !(record.marked_text ?? "").includes("</text>"), "the player never reads the tag");
	assert.equal((record.warnings ?? []).find((row) => row.kind === "markup_in_prose"), undefined, "no finding: nothing reached the gate");
	assert.equal(customMessages(table.session, "coc-delivery").at(-1)?.content, record.rendered_text, "the player reads the unwrapped turn");
});

test("real kernel: ordinary prose with say tokens, dashes, quotes, ellipses and a lone hyphen is delivered first time", async (t) => {
	const campaign = "markup-ordinary";
	const table = await playTurn(t, campaign, [
		fauxAssistantMessage([fauxToolCall("narrate", { text: ORDINARY })], { stopReason: "toolUse" }),
	]);
	assert.deepEqual(narrateRows(table).map((row) => row.ok), [true, true], "no refusal");
	assert.deepEqual(refusedNarrates(table), []);
	assert.deepEqual(markupRows(table), [], "nothing counted");
	const record = turnRecord(table, campaign, 1);
	assert.equal(record.closed_by, "narrate");
	assert.equal((record.warnings ?? []).find((row) => row.kind === "markup_in_prose"), undefined);
	assert.equal(record.speech.length, 2, "the say tokens were the host's own markers, read as speech");
});









/**
 * A known boundary of §143.10, not a bug: the line class is syntax, so dash dialogue typed with a hyphen at a line's
 * start has the shape of a markdown bullet. It costs one refusal a turn, and the same draft sent again goes out as
 * written with the finding. No language-based exemption narrows the class (owner's rule); a real dash (`—`) passes.
 */
const DASHED = `Knott levantó la vista del escritorio.\n\n{{say:${KNOTT}}}- Siéntese, señor Hayes.{{/say}}\n{{say:${KNOTT}}}- No tengo toda la tarde.{{/say}}`;



/**
 * Contract §143.17 (docs/specs/npc-acts-first-tickets/18-strip-a-bare-wrapper-tag-on-second-delivery.md): on the turn's
 * second delivery, markup that is only a bare wrapper -- a tag at the text's very start or end, or a matching pair
 * around all of it -- is a frame, not prose, and comes off before rendering; the warnings row stays with
 * `stripped: true`. A tag inside the prose and a list line are content and go out as written, `stripped` absent.
 * Evidence: npc-acts-c4 turn 3 (and C3 once), where the Keeper's resent narrate still ended in `</text>` and the player
 * read it.
 *
 * Since the line-2 merge, that evidence shape on an explicit narrate is §144's (the case above): `</text>` and a
 * `<text>…</text>` pair never reach the kernel there. §143.17 is not subsumed: it still takes a bare wrapper off an
 * implicit close (the spent-steer case above, `</text>` and all) and off an explicit narrate whose wrapper names no
 * narrate parameter, which is what the explicit cases below send.
 */
const PAIRED = `<text>\n${REWRITTEN}\n</text>`;
const FRAMED = `<${FRAME}>\n${REWRITTEN}\n</${FRAME}>`;
const INNER = `他咽了一口，<b>喉咙</b>响得比刚才更清楚。\n\n{{say:${KNOTT}}}“钥匙……钥匙你自己捡。”{{/say}}\n\n门外的走廊里没人来。`;











/**
 * Which markup is whose, asked of `unwrapArgumentMarkup` itself with narrate's real schema: §144 takes off the tags that
 * name a narrate parameter (`</text>`, `<text>…</text>`); the texts this file sends explicitly to the gate pass it as
 * written. The frame's name is not one of narrate's parameters -- the rule §144 reads -- so the explicit cases above
 * keep testing the gate if the tag set of either section changes.
 */
test("§144 and §143.10 divide the markup: the tags naming a narrate parameter are §144's, everything this file sends the gate passes the boundary as written", () => {
	assert.ok(!Object.hasOwn(schema("narrate").properties, FRAME), `${FRAME} is not a narrate parameter`);
	assert.equal(pastTheBoundary(TAGGED), REWRITTEN);
	const unpaired = pastTheBoundary(PAIRED);
	assert.ok(!/<\/?text>/.test(unpaired) && unpaired.trim() === REWRITTEN, `the pair comes off: ${JSON.stringify(unpaired.slice(0, 20))}`);
	for (const text of [CLOSED, FRAMED, `${REWRITTEN}\n\n# 下一步\n- 捡起钥匙`, INNER, LISTED, DASHED, ORDINARY])
		assert.equal(pastTheBoundary(text), text, `handed on as written: ${JSON.stringify(text.slice(-40))}`);
});

for (const [shape, text, implicit] of [
	["trailing wrapper", CLOSED, false],
	["paired wrapper", FRAMED, false],
	["inner tags", INNER, false],
	["list lines", LISTED, false],
	["implicit list lines", LISTED, true],
]) test(`section 166: ${shape} delivers on the first attempt`, async (t) => {
	const campaign = "markup-first-" + shape.replaceAll(" ", "-");
	const response = implicit ? fauxAssistantMessage(text) : fauxAssistantMessage([fauxToolCall("narrate", {text})], {stopReason: "toolUse"});
	const table = await playTurn(t, campaign, [response]);
	assert.equal(refusedNarrates(table).length, 0);
	assert.equal(narrateRows(table).filter(row => row.ok === false).length, 0);
	assert.equal(table.telemetry().filter(row => row.lane === "provider-call" && row.turn === 1).length, 1);
	const record = turnRecord(table, campaign, 1);
	assert.equal(record.closed_by, "narrate");
	assert.ok(record.rendered_text.length > 0);
	assert.equal(record.speech.length, 1, "speaker metadata survives rendering");
	assert.ok(markupRows(table).every(row => row.outcome === "delivered"));
	if (shape.includes("list")) assert.ok(record.rendered_text.includes("- "), "list content is accepted");
	if (shape === "inner tags") assert.ok(record.rendered_text.includes("<b>"), "inner content is accepted");
});
