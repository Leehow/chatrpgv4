/**
 * Contract §212 (issue #112 live 9e7, turns 22 and 23; a19 turn 11): the Haiku 5.5 admission lane answered HTTP 200 /
 * `stop` twice per round on `move` and the reader said "the reply held no JSON object". The raw replies were never kept,
 * so these cases are built from what was captured: the `anthropic-messages` content shape Pi returns for that model
 * (an adaptive-thinking block beside the text block, `stopReason: "stop"`) and the move line's own format, which embeds
 * the `registered_destination={...}` object a reply can echo before its verdict.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runLane } from "../../extensions/lanes/subsession.ts";
import { reviewAdmission, shapeVerdict } from "../../extensions/kernel/admission.ts";

const MOVE_LINE = 'apply move: to="neighborhood-gossip"; travel_minutes=30; label="house across the street"; registered_destination={"handle":"neighborhood-gossip","label":"neighborhood-gossip","summary":"The Corbitt House street outside.","canonical_name":"Corbitt House street"}';
const VERDICT = '{"player_words":"narrate","verdict":"authorized","grounds":"Player: walks to the address and stands across the street, not going in."}';

function ctxAnswering(...replies) {
	const sent = [];
	return {
		sent,
		ctx: {
			model: { provider: "opencode-go", id: "claude-haiku-5-5", api: "anthropic-messages" },
			modelRegistry: {
				complete: async (_model, context) => {
					sent.push(context.messages[0].content[0].text);
					const next = replies.shift();
					return { stopReason: "stop", content: next };
				},
			},
		},
	};
}
const thinking = { type: "thinking", thinking: "", thinkingSignature: "sig" };
const text = (value) => ({ type: "text", text: value });
const lane = (ctx) => runLane({ ctx, envName: "PI_COC_LANE_REPLY_TEST_MODEL", lane: "admission", systemPrompt: "answer json", input: MOVE_LINE, shape: shapeVerdict });

test("a verdict after an echoed, unclosed proposal object is the verdict, not 'no JSON object'", async () => {
	const echo = `Judging the line ${MOVE_LINE.slice(0, 160)}… the player chose it.\n${VERDICT}`;
	const { ctx } = ctxAnswering([thinking, text(echo)]);
	const result = await lane(ctx);
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.value.verdict, "authorized");
});

test("a verdict after a complete echoed object that is not the verdict shape is still the verdict", async () => {
	const echo = `registered_destination=${MOVE_LINE.split("registered_destination=")[1]}\n${VERDICT}`;
	const { ctx } = ctxAnswering([text(echo)]);
	const result = await lane(ctx);
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.value.verdict, "authorized");
});

test("two different verdicts in one reply are no answer, never the first one guessed", async () => {
	const other = VERDICT.replace('"authorized"', '"not_authorized"');
	const { ctx } = ctxAnswering([text(`${VERDICT}\n${other}`)]);
	const result = await lane(ctx);
	assert.equal(result.ok, false);
	assert.equal(result.reason, "bad_output");
	assert.match(result.detail, /conflicting/);
});

test("a reply with only reasoning and no answer text is bad output that says so; JSON in reasoning is never read", async () => {
	const { ctx } = ctxAnswering([{ ...thinking, thinking: VERDICT }]);
	const result = await lane(ctx);
	assert.equal(result.ok, false);
	assert.equal(result.reason, "bad_output");
	assert.match(result.detail, /no answer text/);
	assert.deepEqual(result.reply.blocks, ["thinking"]);
	assert.equal(result.reply.text_bytes, 0);
	assert.ok(result.reply.thinking_bytes > 0);
});

test("a malformed reply keeps bounded evidence of what came back", async () => {
	const prose = "The player chose to walk there. ".repeat(40);
	const { ctx } = ctxAnswering([thinking, text(prose)]);
	const result = await lane(ctx);
	assert.equal(result.reason, "bad_output");
	assert.equal(result.detail, "the reply held no JSON object");
	assert.deepEqual(result.reply.blocks, ["thinking", "text"]);
	assert.equal(result.reply.stop_reason, "stop");
	assert.equal(result.reply.objects, 0);
	assert.equal(result.reply.text_bytes, Buffer.byteLength(prose.trim()));
	assert.ok(Buffer.byteLength(result.reply.head) <= 240 && Buffer.byteLength(result.reply.tail) <= 240);
	assert.ok(prose.startsWith(result.reply.head));
});

test("the admission round's row keeps each malformed attempt's evidence", async () => {
	const { ctx, sent } = ctxAnswering([thinking, text("I think the player chose this.")], [thinking]);
	const rows = [];
	const outcome = await reviewAdmission({
		ctx, record: (row) => rows.push(row), timeoutMs: 10000,
		proposal: { lines: [MOVE_LINE] },
		context: { investigators: [{ name: "Ada" }], scene: "library steps", present: [], delivered: [], turn: 22,
			playerText: "I walk to the address and watch from across the street.", landed: [], refused: [] },
	});
	assert.equal(sent.length, 2);
	assert.equal(outcome.ok, false);
	assert.equal(outcome.reason, "bad_output");
	assert.equal(outcome.meta.attempts, 2);
	assert.deepEqual(outcome.meta.malformed_replies.map((reply) => reply.blocks), [["thinking", "text"], ["thinking"]]);
});
