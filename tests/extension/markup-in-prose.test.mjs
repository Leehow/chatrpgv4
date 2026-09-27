/**
 * Contract §143.10 (docs/specs/npc-acts-first-tickets/11-markup-leak-in-prose.md) through the product path: the real
 * kernel extension's explicit narrate handler and its implicit close, against the real kernel. Player-facing prose
 * carries no markup -- an XML/HTML-shaped tag, or a line that opens with a markdown list or heading marker -- once the
 * host's own say tokens and mechanics markers are gone. The first delivery of a turn that carries it is refused `needs`
 * with the steer; a later one this turn is delivered as written with a `warnings` row; both are counted on
 * `lane: "delivery"`. A check on form never costs the player the turn: with the turn's one steer spent, the host sends
 * the same draft again and the kernel delivers it with its finding.
 *
 * Evidence: npc-actor-gate-a2 (2026-09-26), turn 6 (an explicit narrate whose own `text` argument ended in `</text>`)
 * and turn 7 (an implicit close with two markdown list lines). §143.17 (ticket 18) takes a bare wrapper off the second
 * delivery; its cases are at the end of this file.
 *
 * Since the line-2 merge (2026-09-26), §144 unwraps a tool argument's own tool-call markup where the model's arguments
 * enter the host (the Keeper tools' `prepareArguments`): a narrate `text` that ends in `</text>` (turn 6's tag) or is
 * wrapped in `<text>…</text>` reaches the kernel without it, so on an explicit narrate this gate never sees those tags
 * (the §144 case below pins that). §144 reads only tags that name one of the tool's own declared parameters; every other
 * tag, every list or heading line, and the whole of an implicit close (the model's prose, not a tool argument) still
 * reach this gate. The explicit cases here therefore carry a tag that names no narrate parameter, and the last case of
 * the file asks `unwrapArgumentMarkup` itself which texts it leaves as written.
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

test("real kernel: an explicit narrate ending in a closing tag §144 does not unwrap is refused once with the steer, and the rewrite is delivered", async (t) => {
	const campaign = "markup-tag";
	assert.equal(pastTheBoundary(CLOSED), CLOSED, "§144 hands the tag on");
	const table = await playTurn(t, campaign, [
		fauxAssistantMessage([fauxToolCall("narrate", { text: CLOSED })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: REWRITTEN })], { stopReason: "toolUse" }),
	]);
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[true, null], [false, "markup_in_prose"], [true, null]],
		"the opening, the tagged delivery refused, the rewrite delivered");
	const [refusal] = refusedNarrates(table);
	assert.equal(refusal.code, "needs");
	assert.ok(refusal.message.startsWith(STEER), `the steer reaches the Keeper: ${refusal.message}`);
	assert.equal(refusal.details.reason, "markup_in_prose");
	assert.deepEqual(refusal.details.tags, [`</${FRAME}>`]);
	assert.deepEqual(refusal.details.lines, []);
	const record = turnRecord(table, campaign, 1);
	assert.equal(record.text, REWRITTEN);
	assert.ok(!record.rendered_text.includes(`</${FRAME}>`));
	assert.equal((record.warnings ?? []).find((row) => row.kind === "markup_in_prose"), undefined, "a clean rewrite carries no finding");
	assert.deepEqual(markupRows(table).map((row) => [row.ok, row.outcome, row.tags, row.lines, row.implicit]), [[false, "refused", 1, 0, false]]);
});

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

test("real kernel: an implicit close with markdown list lines is refused once, the repair steer carries the steer, and the prose is delivered", async (t) => {
	const campaign = "markup-list";
	const table = await playTurn(t, campaign, [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage(LISTED),
		fauxAssistantMessage(PROSE),
	]);
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null, row.implicit ?? false]),
		[[true, null, false], [false, "markup_in_prose", true], [true, null, true]]);
	const refused = table.telemetry().find((row) => row.lane === "delivery" && row.reason === "implicit_narrate_refused");
	assert.equal(refused?.kernel_reason, "markup_in_prose", "the draft was dropped for the kernel's refusal");
	const steers = customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "audit-repair");
	assert.equal(steers.length, 1, "one repair steer");
	assert.ok(String(steers[0].content).includes(STEER), "the repair steer names the markup");
	assert.deepEqual(markupRows(table).map((row) => [row.ok, row.outcome, row.lines, row.implicit]), [[false, "refused", 2, true]]);
	const record = turnRecord(table, campaign, 1);
	assert.equal(record.closed_how, "implicit");
	assert.equal(record.text, PROSE);
	assert.equal(shownText(table), record.rendered_text, "the player reads the prose");
});

test("real kernel: a second delivery that still carries markup is delivered as written, with a warnings row and a count", async (t) => {
	const campaign = "markup-twice";
	const table = await playTurn(t, campaign, [
		fauxAssistantMessage([fauxToolCall("narrate", { text: CLOSED })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: `${REWRITTEN}\n\n# 下一步\n- 捡起钥匙` })], { stopReason: "toolUse" }),
	]);
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[true, null], [false, "markup_in_prose"], [true, null]],
		"refused once, then delivered: never a second refusal for the same kind this turn");
	const record = turnRecord(table, campaign, 1);
	assert.ok(record.rendered_text.includes("# 下一步"), "delivered as written");
	const finding = (record.warnings ?? []).find((row) => row.kind === "markup_in_prose");
	assert.ok(finding, "the delivery carries the finding");
	assert.equal(finding.lane, "delivery");
	assert.equal(finding.quote, "# 下一步");
	assert.ok(finding.fix.includes(STEER));
	assert.deepEqual(markupRows(table).map((row) => [row.ok, row.outcome, row.tags, row.lines]),
		[[false, "refused", 1, 0], [true, "delivered", 0, 2]]);
});

test("real kernel: with the turn's one steer already spent, an implicit draft refused for markup is sent again and delivered with its finding", async (t) => {
	const campaign = "markup-steer-spent";
	const table = await playTurn(t, campaign, [
		// A read, then nothing to deliver: the turn-close steer ("this turn is not closed yet") is spent on this.
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([{ type: "thinking", thinking: "Nothing to add." }], { stopReason: "stop" }),
		// The steered leg writes the tagged prose; its repair could never reach the Keeper now. An implicit close is the
		// model's prose, not a tool argument, so §144 never reads it: `</text>` here still reaches this gate and §143.17.
		fauxAssistantMessage(TAGGED),
	]);
	assert.equal(customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "steer").length, 1, "the one steer went out");
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null, row.implicit ?? false]),
		[[true, null, false], [false, "markup_in_prose", true], [true, null, true]], "refused, then the same draft delivered");
	const resent = table.telemetry().find((row) => row.lane === "delivery" && row.reason === "markup_resent");
	assert.equal(resent?.kernel_reason, "markup_in_prose");
	assert.equal(table.telemetry().some((row) => row.lane === "delivery" && row.reason === "implicit_narrate_refused"), false, "nothing dropped");
	const record = turnRecord(table, campaign, 1);
	assert.equal(record.closed_by, "narrate");
	// §143.17: the trailing </text> is a bare wrapper, so the kernel took it off the resent draft.
	assert.equal(record.text, REWRITTEN, "the steered leg's own words, its bare wrapper taken off");
	const finding = (record.warnings ?? []).find((row) => row.kind === "markup_in_prose");
	assert.equal(finding?.quote, "</text>");
	assert.equal(finding?.stripped, true);
	assert.deepEqual(markupRows(table).map((row) => [row.ok, row.outcome]), [[false, "refused"], [true, "delivered"]]);
	assert.equal(shownText(table), record.rendered_text, "the player reads the delivered turn");
});

test("real kernel: a draft refused for markup is held, so a repair leg that brings nothing delivers it with its finding", async (t) => {
	const campaign = "markup-held";
	const table = await playTurn(t, campaign, [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage(LISTED),
		// The repair steer's leg writes nothing: before the draft was held, the turn ended undelivered here.
		fauxAssistantMessage([{ type: "thinking", thinking: "Nothing to add." }], { stopReason: "stop" }),
	]);
	assert.equal(customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "audit-repair").length, 1, "one repair steer");
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null, row.implicit ?? false]),
		[[true, null, false], [false, "markup_in_prose", true], [true, null, true]], "refused, then the held draft delivered");
	const record = turnRecord(table, campaign, 1);
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.text, LISTED);
	assert.equal((record.warnings ?? []).find((row) => row.kind === "markup_in_prose")?.quote, "- 钥匙还躺在桌腿边的地板上，铜齿朝上。");
	assert.deepEqual(markupRows(table).map((row) => [row.ok, row.outcome]), [[false, "refused"], [true, "delivered"]]);
	assert.equal(shownText(table), record.rendered_text, "the player reads the Keeper's draft");
});

/**
 * A known boundary of §143.10, not a bug: the line class is syntax, so dash dialogue typed with a hyphen at a line's
 * start has the shape of a markdown bullet. It costs one refusal a turn, and the same draft sent again goes out as
 * written with the finding. No language-based exemption narrows the class (owner's rule); a real dash (`—`) passes.
 */
const DASHED = `Knott levantó la vista del escritorio.\n\n{{say:${KNOTT}}}- Siéntese, señor Hayes.{{/say}}\n{{say:${KNOTT}}}- No tengo toda la tarde.{{/say}}`;

test("real kernel, known boundary: dash dialogue typed with a hyphen at a line's start is refused once, and the same draft is delivered with the finding", async (t) => {
	const campaign = "markup-dash-dialogue";
	const table = await playTurn(t, campaign, [
		fauxAssistantMessage([fauxToolCall("narrate", { text: DASHED })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: DASHED })], { stopReason: "toolUse" }),
	]);
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[true, null], [false, "markup_in_prose"], [true, null]],
		"refused once, then the same draft delivered");
	const [refusal] = refusedNarrates(table);
	assert.equal(refusal.details.reason, "markup_in_prose");
	assert.deepEqual(refusal.details.lines, ["- Siéntese, señor Hayes.", "- No tengo toda la tarde."]);
	const record = turnRecord(table, campaign, 1);
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.text, DASHED, "the same draft, as written");
	assert.equal(record.speech.length, 2);
	const finding = (record.warnings ?? []).find((row) => row.kind === "markup_in_prose");
	assert.equal(finding?.lane, "delivery");
	assert.equal(finding?.quote, "- Siéntese, señor Hayes.");
	assert.deepEqual(markupRows(table).map((row) => [row.ok, row.outcome, row.lines]), [[false, "refused", 2], [true, "delivered", 2]]);
});

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

async function deliveredTwice(t, campaign, text) {
	const table = await playTurn(t, campaign, [
		fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
	]);
	assert.deepEqual(narrateRows(table).map((row) => [row.ok, row.reason ?? null]), [[true, null], [false, "markup_in_prose"], [true, null]],
		"refused once, then the same draft delivered");
	const record = turnRecord(table, campaign, 1);
	return { table, record, finding: (record.warnings ?? []).find((row) => row.kind === "markup_in_prose") };
}

test("real kernel, §143.17: a trailing closing tag §144 does not unwrap, sent twice, is taken off the second delivery, and the finding says stripped", async (t) => {
	const { table, record, finding } = await deliveredTwice(t, "markup-strip-trailing", CLOSED);
	assert.ok(!record.rendered_text.includes(`</${FRAME}>`), `the player never reads the tag: ${record.rendered_text}`);
	assert.equal(record.text, REWRITTEN, "the Keeper's text, its wrapper taken off");
	assert.ok(!(record.marked_text ?? "").includes(`</${FRAME}>`), "the marked text the frontend mounts carries no tag either");
	assert.equal(record.speech.length, 1, "the say token still reads as speech");
	assert.equal(finding?.lane, "delivery");
	assert.equal(finding?.quote, `</${FRAME}>`);
	assert.equal(finding?.stripped, true);
	assert.ok(finding.fix.includes(STEER));
	assert.deepEqual(markupRows(table).map((row) => [row.ok, row.outcome, row.tags, row.lines, row.stripped ?? null]),
		[[false, "refused", 1, 0, null], [true, "delivered", 1, 0, true]]);
	// An explicit narrate with no later leg: the host places the delivery as its own displayed message.
	assert.equal(customMessages(table.session, "coc-delivery").at(-1)?.content, record.rendered_text, "the player reads the unwrapped turn");
});

test("real kernel, §143.17: a pair of tags §144 does not unwrap, around the whole prose and sent twice, is taken off", async (t) => {
	const { table, record, finding } = await deliveredTwice(t, "markup-strip-pair", FRAMED);
	assert.ok(!record.rendered_text.includes(`<${FRAME}>`) && !record.rendered_text.includes(`</${FRAME}>`), `no tag reaches the player: ${record.rendered_text}`);
	assert.equal(record.text, REWRITTEN);
	assert.equal(finding?.quote, `<${FRAME}>`);
	assert.equal(finding?.stripped, true);
	assert.deepEqual(markupRows(table).map((row) => [row.outcome, row.tags, row.stripped ?? null]), [["refused", 2, null], ["delivered", 2, true]]);
});

test("real kernel, §143.17: a <b> inside a sentence sent twice is content, delivered as written with no stripped", async (t) => {
	const { table, record, finding } = await deliveredTwice(t, "markup-inner-tag", INNER);
	assert.ok(record.rendered_text.includes("<b>喉咙</b>"), "delivered as written");
	assert.equal(record.text, INNER);
	assert.equal(finding?.quote, "<b>");
	assert.equal("stripped" in (finding ?? {}), false, "nothing was stripped");
	assert.deepEqual(markupRows(table).map((row) => [row.outcome, "stripped" in row]), [["refused", false], ["delivered", false]]);
});

test("real kernel, §143.17: a markdown list line sent twice is content, delivered as written with no stripped", async (t) => {
	const { table, record, finding } = await deliveredTwice(t, "markup-list-twice", LISTED);
	assert.ok(record.rendered_text.includes("- 钥匙还躺在桌腿边的地板上，铜齿朝上。"), "delivered as written");
	assert.equal(record.text, LISTED);
	assert.equal(finding?.quote, "- 钥匙还躺在桌腿边的地板上，铜齿朝上。");
	assert.equal("stripped" in (finding ?? {}), false, "nothing was stripped");
	assert.deepEqual(markupRows(table).map((row) => [row.outcome, row.lines, "stripped" in row]), [["refused", 2, false], ["delivered", 2, false]]);
});

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
