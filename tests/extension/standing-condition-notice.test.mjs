/**
 * The host says a standing incapacitating state out of fiction, beside the delivery (contract §42.6).
 *
 * The retained incident, `game-83177d61`: turn 107 settled `unconscious` and the mechanics card said
 * so. Turns 108 to 114 settled nothing, so they carried no condition row at all, and the player went
 * on declaring actions for an unconscious man. What finally reached him, hours later, was the Keeper
 * choosing to write 「人却动不了」 into the fiction -- which works, and depends entirely on a Keeper
 * being diligent with the capsule's `cannot_act`. A less diligent one puts the table straight back
 * into three turns of writing around a character who cannot act.
 *
 * So the line rides the channel the service notices already use (`coc-delivery`, out of fiction,
 * `display: true`): it lands where the player is already looking when they decide what to say next.
 * That is the difference between this layer and the character sheet, which carries the same states
 * and which the player of the retained table never opened.
 *
 * The whole path is real: the product kernel subprocess settles the damage, projects the delivery
 * and decides which states take the action away; the shipped extension reads it and composes the
 * line from the shipped captions in the campaign's play language.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitForIdle } from "./harness.mjs";

const REPO = join(import.meta.dirname, "..", "..");
const EXTENSION = JSON.parse(readFileSync(join(REPO, "content/ui/zh-Hans/extension.json"), "utf8"));
const MECHANICS = JSON.parse(readFileSync(join(REPO, "content/ui/zh-Hans/mechanics.json"), "utf8"));

/** Thomas Hayes carries 12 hit points, so three blows under half of that (6) reach zero without a major wound. */
const claw = (damage) => fauxAssistantMessage(
	[fauxToolCall("apply", { effects: [{ kind: "damage", dice: `${damage}D1`, why: "the claws" }] })],
	{ stopReason: "toolUse" });
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });

const standingNotices = (table) =>
	customMessages(table.session, "coc-delivery").filter((message) => Array.isArray(message.details?.standing_conditions));

test("a standing state that takes the action away is said beside every delivery that did not change it", async (t) => {
	const table = await openTable({
		realKernel: true,
		campaign: "standing-seam",
		responses: [
			// Opening.
			narrate("门在你身后合上。"),
			fauxAssistantMessage("开场之后多写的一句。"),
			// The turn the claws land: the damage settles, so the card's own condition row says it.
			claw(5), claw(5), claw(2),
			narrate("爪子落下，你眼前一黑。"),
			fauxAssistantMessage("这一回合之后多写的一句。"),
			// A turn that settles nothing at all -- turns 108 to 114 of the retained table.
			narrate("尘埃在光里慢慢落下。"),
			fauxAssistantMessage("再多写的一句。"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	await table.session.prompt("我反击，刃不撒手。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	assert.deepEqual(standingNotices(table), [],
		"on the turn the state lands the card's condition row already says it: nothing is said twice");

	await table.session.prompt("我还想爬起来。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	const told = standingNotices(table);
	assert.equal(told.length, 1, `the next turn settles nothing, and the state is still said: ${JSON.stringify(told)}`);
	const [notice] = told;
	assert.equal(notice.display, true, "out of fiction, but visible: a line the player never sees is the defect itself");
	assert.deepEqual(notice.details.standing_conditions[0].conditions, ["unconscious"],
		"the rules engine decided which states take the action away; the host neither reads nor judges a name");

	// The player's own language, from the shipped captions -- the state word from the surface that
	// owns the condition vocabulary, the sentence from the one the extensions notify with.
	const content = String(notice.content);
	assert.ok(content.includes(MECHANICS["condition.unconscious"]), `the line names the state: ${content}`);
	assert.equal(content,
		EXTENSION.standing_condition_notice
			.replace("{name}", notice.details.standing_conditions[0].name)
			.replace("{state}", MECHANICS["condition.unconscious"]),
		"and it is the caption, filled -- not a sentence written in the host");

	// The operator record says the line went out, so a table that stopped saying it is answerable.
	assert.ok(table.telemetry().some((row) => row.lane === "delivery" && row.reason === "standing_condition_notice"),
		JSON.stringify(table.telemetry().filter((row) => row.lane === "delivery")));
});

test("a table with nothing standing is never told that something is", async (t) => {
	const table = await openTable({
		realKernel: true,
		campaign: "standing-quiet-seam",
		responses: [
			narrate("门在你身后合上。"),
			fauxAssistantMessage("开场之后多写的一句。"),
			narrate("走廊尽头有扇关着的门。"),
			fauxAssistantMessage("这一回合之后多写的一句。"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("我往走廊走。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	assert.deepEqual(standingNotices(table), [], "an unhurt investigator gets no state line");
	const said = customMessages(table.session, "coc-delivery").map((message) => String(message.content));
	assert.ok(!said.some((line) => line.includes(MECHANICS["condition.unconscious"])), JSON.stringify(said));
});
