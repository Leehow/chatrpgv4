/**
 * One closed turn, one door (contract §86).
 *
 * Retained live evidence, H-DETOUR `t10`, campaign `game-320c5537` turn 0
 * (`playtest-evidence/pipicoc-20260914`). The opening `narrate` closed the turn at 04:59:55. The
 * Keeper then tried to repair it, and the same condition -- this turn is closed -- answered on two
 * different roads depending on nothing but which run the call happened to be in:
 *
 *   apply   ×1  "the turn is closed, waiting for the player"   blocked_after_close: 1, effect_untold
 *   resolve ×1  "the turn is closed, waiting for the player"   blocked_after_close: 2, effect_untold
 *   -- agent_end, the §78 notice, and pi continues the run for it (agent_start fires again) --
 *   resolve ×2  "the turn state is awaiting_player, so nothing may change state ..."   (no flags)
 *   narrate ×3  the same
 *   apply   ×3  the same
 *   apply   ×5, narrate ×1  refusal_budget
 *   runaway, aborted
 *
 * 17 refusals, 32 steps, four minutes, ~60k tokens, and a bare `This operation was aborted` on the
 * player's screen. The five effect verbs on the second road set nothing, so §78 could not have
 * spoken for any of them: on a turn whose only closed-turn refusal arrives in a later run -- `a-main`
 * turns 32, 54 and 104, `t6` `game-efa75177` turn 0 in the same evidence -- the player is told
 * nothing at all.
 *
 * What this pins is the unification, not the refusal: one condition, one sentence, one counter, and
 * §78 owed by every refused effect whichever run it arrives in.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitForIdle } from "./harness.mjs";

const NOTE = [{ kind: "clue", clue: "complaint-135-exact-location" }];
const call = (name, input) => fauxAssistantMessage([fauxToolCall(name, input)], { stopReason: "toolUse" });
const repair = () => [
	call("apply", { effects: NOTE }),
	call("narrate", { text: "职员把那一行夹进正联。" }),
	call("resolve", { action: { intent: "investigate", goal: "复核那一行", method: "再看一眼" } }),
];

/**
 * The live mechanism for the second run, through pi's own API: a message queued after the run ended
 * is a continuation, and `runAgentLoopContinue` emits `agent_start` again. On the live table that
 * message was §78's own notice; anything the host says after `agent_end` does the same thing.
 */
const continueRun = (session) =>
	session.sendCustomMessage(
		{ customType: "coc-host", content: "The continuity review returned three reveal warnings on the opening.", display: false,
			details: { coc_host: true, kind: "review", scope: "turn" } },
		{ triggerTurn: true },
	);

const told = (session) => customMessages(session, "coc-delivery").filter((message) => message.details.refused_effect);

test("一个关掉的回合只有一道闸门：换一轮再来，还是同一句、同一个计数器，效果被拒照样告诉玩家", async (t) => {
	const table = await openTable({
		responses: [
			call("narrate", { text: "门在你身后合上。" }),
			// The delivering run ends here, exactly as it did live: the turn is closed and nothing of
			// the repair below belongs to it.
			fauxAssistantMessage("回合已交付。"),
			...repair(), ...repair(), ...repair(),
			fauxAssistantMessage("这条不该出现"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我推开门。");
	await waitForIdle(table.session);
	const delivered = table.telemetry().filter((row) => row.tool === "narrate" && row.event === "turn-closed");
	assert.equal(delivered.length, 1, "先要有一条真的交付，否则后面谈的不是同一件事");
	assert.deepEqual(table.telemetry().filter((row) => row.blocked_after_close), [], "交付那一轮自己没有被拒的调用");

	// A later run on the same closed turn. Nothing about the turn changed.
	await continueRun(table.session).catch(() => undefined);
	await waitForIdle(table.session);

	const rows = table.telemetry();
	const blocked = rows.filter((row) => row.code === "blocked" && row.reason === "the turn is closed, waiting for the player");
	assert.ok(blocked.length >= 3, `后一轮的调用也要走关门那道闸：${JSON.stringify(rows.filter((row) => row.ok === false))}`);

	// One condition, one road: the opening's sentence must not appear on a turn that was delivered,
	// and neither must the refusal-budget block that a second counter used to hand out.
	assert.deepEqual(rows.filter((row) => row.code === "turn_state"), [],
		`回合已关不该再出现开场那句 turn_state：${JSON.stringify(rows.filter((row) => row.code === "turn_state"))}`);
	assert.deepEqual(rows.filter((row) => row.reason === "refusal_budget"), [],
		`关门这条路上不该再落到预算那条路：${JSON.stringify(rows.filter((row) => row.reason === "refusal_budget"))}`);

	// One counter, and it belongs to the turn: the continuation run does not start it over, so the
	// cut arrives. On the live table it restarted and 15 more refusals went by before anything cut.
	const counted = blocked.map((row) => row.blocked_after_close);
	assert.deepEqual(counted, counted.map((_, index) => index + 1), `计数要连着往上走：${JSON.stringify(counted)}`);
	const runaway = rows.filter((row) => row.lane === "runaway");
	assert.equal(runaway.length, 1, `§70 的兜底还在，而且只切一次：${JSON.stringify(runaway)}`);
	assert.equal(runaway[0].aborted, true);
	const refusals = rows.filter((row) => row.ok === false && row.tool && !row.lane);
	assert.ok(refusals.length <= 9, `一个关掉的回合上的拒绝要停在个位数，实际 ${refusals.length}：${JSON.stringify(refusals)}`);

	// §78, the half this turn never had: the effects refused in the later run are the player's to know.
	assert.ok(blocked.some((row) => row.tool === "apply" && row.effect_untold === true),
		`后一轮里被拒的 apply 也要标成欠玩家一句：${JSON.stringify(blocked)}`);
	const notices = told(table.session);
	assert.equal(notices.length, 1, `玩家要被告知一次，且只有一次：${JSON.stringify(customMessages(table.session, "coc-delivery"))}`);
	assert.ok(rows.some((row) => row.lane === "delivery" && row.reason === "refused_effect_notice"));
});

test("从来没开过的回合一样没有门，但它没有交付过，所以不欠玩家那句话", async (t) => {
	// The other turn with no door, and the reason the notice is keyed on the delivery rather than on
	// the gate: `table.player_input` was refused, so nothing was published and there is no prose for
	// a notice to cast doubt on. The refusals are identical; what the player is owed is not.
	const table = await openTable({
		env: { FAKE_KERNEL_ERRORS: JSON.stringify({ "table.player_input": { code: "turn_state", message: "the turn is not open" } }) },
		responses: [...repair(), ...repair(), ...repair(), fauxAssistantMessage("这条不该出现")],
	});
	t.after(() => table.dispose());

	await table.session.prompt("我推开门。").catch(() => undefined);
	await waitForIdle(table.session);

	const rows = table.telemetry();
	const blocked = rows.filter((row) => row.code === "blocked" && row.reason === "the turn is closed, waiting for the player");
	assert.ok(blocked.length >= 3, `没开过的回合也走同一道闸：${JSON.stringify(rows.filter((row) => row.ok === false))}`);
	assert.deepEqual(blocked.filter((row) => row.effect_untold), [], "没有交付过，就没有「你刚读到的那段」可疑");
	assert.deepEqual(told(table.session), [], "不该凭空给玩家一句关于不存在的交付的提醒");
	assert.deepEqual(customMessages(table.session, "coc-delivery").filter((message) => message.details.delivery_cut_short), [],
		"同理，没有被截断的交付");
});

/*
 * Not added: a test that the notice itself no longer buys a run. `emitRefusedEffectNotice` and
 * `emitCutShortNotice` now pass `triggerTurn: false` like every other notice in this host (§50), and
 * that is the live trigger -- on `t10` turn 0 the notice was written at 05:00:53 and the Keeper's
 * next blocked call came at 05:00:58, on a turn closed since 04:59:55. It cannot be observed here:
 * pi only turns a queued message into a continuation while the session is still streaming, and the
 * faux session has already stopped by the time `agent_end`'s `setTimeout(0)` runs, so the assertion
 * would pass with the flag removed. An assertion that cannot fail is not a guard (§72). What is
 * guarded is the thing that matters if a continuation run does start anyway: the first test above.
 */
