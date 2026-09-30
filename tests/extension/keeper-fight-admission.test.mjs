/**
 * Contract §143.18 (docs/specs/npc-acts-first-tickets/19-keeper-turns-a-demand-into-a-blow.md): the Keeper's own fight
 * action for the investigator goes through action admission, against the player's own words.
 *
 * Live table C4 (`npc-acts-c4`), turn 8, run `run-01a0de09-…`: in a running fight, on the investigator's turn, the player
 * said 「钱呢？你说的二十块，现在就给我。」. The compile read `act` `none` 0.91 (cleared) and the clerk threw nothing (§143.16).
 * The Keeper resolved `combat:maneuver` with the demand as its goal, the kernel refused it and its fix said to resolve the
 * attack instead, and the Keeper's `combat:attack` (actor `thomas-hayes`) rolled -- with no admission row that turn. Why
 * none: admission read `action.actor` against the investigators' *names* only, so the sheet's handle, which the kernel takes
 * as the investigator and the session view prints as `turn_of`, read as an NPC's initiative (§32.1) and the call skipped
 * review silently. Neither a combat exemption nor a defence-time review: an identity miss.
 *
 * The seam: the real `resolve` tool and admission seam, the emitted kernel, the product's hybrid engine with a stub Jev for
 * its own questions (the compile's `act` answered as the case says), the harness's scripted admission lane.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";
import { compileActRead, compileActRefusal, proposedFightAct } from "../../extensions/kernel/admission.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const DEMAND = "钱呢？你说的二十块，现在就给我。";

/** Kernel requests on the workspace through the emitted kernel's own RPC, to put the table in a state. */
function kernelSteps(workspace, campaign, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames;
}

/** §143.16's fixture: Knott dodged the punch and held, so the player speaks on the investigator's own turn of the fight. */
const hayesTurn = (campaign) => (workspace) => kernelSteps(workspace, campaign, [
	["table.open", {}], ["table.player_input", { text: "我揍他" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "npc", name: "Steven Knott", archetype: "ordinary_adult", why: "test fixture" }] }],
	["table.resolve", { call_id: "t1-c2", action: { intent: "combat", goal: "hit him", method: "fists", target: "Steven Knott", weapon: "unarmed" } }],
	["table.resolve", { call_id: "t1-c3", action: { intent: "combat", decision: "combat:defend", actor: "steven-knott", defense: "dodge", goal: "combat:defend", method: "combat:defend" } }],
	["table.apply", { call_id: "t1-c4", effects: [{ kind: "npc", name: "Steven Knott", action: "hold", why: "He backs to the window, hands up." }] }],
	["table.narrate", { call_id: "t1-c5", text: "他举着手退到窗边。" }],
]);

function jev(batch, pick) {
	const answers = {};
	for (const question of batch.questions) {
		const [choice, confidence, probabilities] = pick(question);
		answers[question.key] = { status: "answered", type: "choice", choice, confidence, probabilities: probabilities ?? { [choice]: confidence } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
/**
 * The run's own questions: the compile answers `act` and `target` as the case says (the alias read from the question) and
 * `unclear` elsewhere; the route answers `need` on the investigator's attack with `attackNeed`, `later` on the rest, and the
 * exit with `ask_llm`, so the turn is the Keeper's.
 */
const fightTurnPort = ({ act, target, attackNeed = ["later", 0.9] }) => (batch) => {
	const alias = (question, row) => Object.entries(question.criteria).find(([, value]) => value === row || JSON.stringify(value).includes(row))?.[0] ?? row;
	const own = (question, [choice, ...rest]) => [choice === "none" || choice === "unclear" ? choice : alias(question, choice), ...rest];
	if (batch.family === COMPILE_FAMILY) return jev(batch, (question) => question.key === "act" ? own(question, act)
		: question.key === "target" ? own(question, target) : ["unclear", 0.9]);
	if (batch.family === ROUTE_FAMILY) return jev(batch, (question) => {
		if (question.key === "exit") return ["ask_llm", 0.76];
		if (!("now" in question.criteria)) return ["not", 0.9];
		const candidate = batch.state?.candidates?.[`candidate_${question.key.split("_")[1]}`];
		return candidate?.bound?.decision === "combat:attack" ? attackNeed : ["later", 0.9];
	});
	return jev(batch, (question) => [Object.keys(question.criteria).includes("unknown") ? "unknown" : Object.keys(question.criteria)[0], 0.9]);
};

async function fightTable(t, { decide, responses, admission }) {
	const calls = [];
	const probe = { name: "naf19-call-probe", factory(pi) {
		pi.on("tool_call", (event) => { calls.push({ phase: "call", id: event.toolCallId, tool: event.toolName, input: structuredClone(event.input) }); });
		pi.on("tool_result", (event) => { calls.push({ phase: "result", id: event.toolCallId, tool: event.toolName, isError: event.isError === true, details: event.details }); });
	} };
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch) => decide(batch) } });
	const table = await openTable({
		realKernel: true, prepareWorkspace: hayesTurn(CAMPAIGN), env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }, probe],
		...(admission ? { laneResponses: { admission } } : {}),
		responses,
	});
	t.after(() => table.dispose());
	return { table, calls };
}

const keeper = (...toolCalls) => fauxAssistantMessage(toolCalls, { stopReason: "toolUse" });
// C4 turn 8's two resolves, as the Keeper sent them (actor by the sheet's handle).
const MANEUVER = { intent: "combat", decision: "combat:maneuver", actor: "thomas-hayes", target: "Steven Knott", weapon: "unarmed",
	goal: "要求诺特当着面付清说好的二十块日薪", method: "挥拳威逼，逼他把钱交出来", stakes: "诺特若挣脱，他会退向门口呼救" };
const ATTACK = { intent: "combat", decision: "combat:attack", actor: "thomas-hayes", target: "Steven Knott", weapon: "unarmed",
	goal: "要求诺特当面付清说好的二十块日薪", method: "一拳逼他把钱交出来", stakes: "诺特若挣脱，他会退向门口呼救" };
const HANDS_UP = "他举起双手：「钱在抽屉里，你先退开，我数给你。」";

const admissionRows = (table) => table.telemetry(CAMPAIGN).filter((row) => row.lane === "admission" && row.turn === 2);
const keeperResolves = (calls) => calls.filter((call) => call.phase === "call" && call.tool === "resolve" && !call.id.startsWith("clerk:"));
const resultOf = (calls, call) => calls.find((entry) => entry.phase === "result" && entry.id === call.id);
/** The investigator's attack rolls the turn landed, from the mechanics projection (§16.2): structured fields, not the skill's name. */
const investigatorBlows = (table) => table.mechanics().filter((payload) => payload.turn === 2).flatMap((payload) => payload.mechanics)
	.filter((row) => row.kind === "roll" && row.actor_is_investigator === true && row.combat_action === "attack");
/** The kernel calls of the turn that settled a fight action. */
const combatSettled = (table) => table.telemetry(CAMPAIGN).filter((row) => row.turn === 2 && row.tool === "resolve" && row.ok === true && row.outcome_kind === "combat");
const refusalReason = (result) => result?.details?.coc_error?.details?.reason;

for (const scenario of [
  {name: 'a demand with a cleared no-fight act', act: ['none', 0.91, {none: 0.93, unclear: 0.07}], target: ['none', 0.55], words: DEMAND, actions: [MANEUVER, ATTACK]},
  {name: 'a demand with an ambiguous act', act: ['none', 0.5, {none: 0.5, act_1: 0.3, unclear: 0.2}], target: ['unclear', 0.5], words: DEMAND, actions: [ATTACK]},
  {name: 'a declared punch the host has not selected to execute', act: ['combat:attack', 1], target: ['unclear', 0.41], words: 'I punch him again.', actions: [ATTACK]},
]) test('§159: the model cannot select a fight check for ' + scenario.name, async t => {
  const {table, calls} = await fightTable(t, {
    decide: fightTurnPort(scenario),
    responses: [...scenario.actions.map(action => keeper(fauxToolCall('resolve', {action}))),
      keeper(fauxToolCall('narrate', {text: HANDS_UP}))],
  });
  await table.session.prompt(scenario.words);
  const results = table.session.messages.filter(message => message.role === 'toolResult' && message.toolName === 'resolve');
  assert.equal(results.length, scenario.actions.length);
  assert.ok(results.every(result => result.isError));
  assert.deepEqual(keeperResolves(calls), [], 'model checks stop before the canonical tool pipeline');
  assert.equal(admissionRows(table).filter(row => row.origin === 'model').length, 0);
  assert.equal(table.lanes.admission.requests().length, 0, 'no LLM review replaces Jev selection');
  assert.deepEqual(combatSettled(table), []);
  assert.deepEqual(investigatorBlows(table), [], 'an unresolved declaration has no attack receipt');
});

test("§143.18 pure: the fight act a resolve proposes, the compile's act record, and the refusal on it", () => {
	assert.equal(proposedFightAct("resolve", { action: { decision: "combat:attack" } }, false), "combat:attack");
	assert.equal(proposedFightAct("resolve", { action: { decision: "decision:coc7:combat:maneuver" } }, false), "combat:maneuver");
	assert.equal(proposedFightAct("resolve", { action: { intent: "combat", target: "x" } }, false), "combat:attack", "the kernel's default for intent combat");
	assert.equal(proposedFightAct("resolve", { action: { intent: "combat" } }, true), undefined, "a defence is owed: that call is the defence");
	assert.equal(proposedFightAct("resolve", { action: { intent: "combat", defense: "dodge" } }, false), undefined);
	assert.equal(proposedFightAct("resolve", { action: { decision: "combat:flee" } }, false), undefined);
	assert.equal(proposedFightAct("apply", { effects: [] }, false), undefined);

	const row = (act) => ({ lane: "route", purpose: "compile", run: "r1", step: "r1:s2",
		features: { act: { rows: { act_1: "combat:attack", act_2: "combat:maneuver" }, ...act } } });
	const none = compileActRead(row({ choice: "none", row: null, confidence: 0.91, cleared: true }));
	assert.deepEqual(none, { run: "r1", step: "r1:s2", rows: ["combat:attack", "combat:maneuver"], choice: "none", row: null, confidence: 0.91, cleared: true });
	assert.equal(compileActRead({ lane: "route", purpose: "route", run: "r1" }), undefined);
	assert.equal(compileActRead({ lane: "route", purpose: "compile", run: "r1", features: {} }), undefined, "no act question");

	assert.equal(compileActRefusal("combat:attack", [none]).verdict, "not_authorized");
	assert.equal(compileActRefusal("combat:attack", [none]).path, "compile");
	assert.equal(compileActRefusal("combat:flee", [none]), undefined, "the question did not offer this act");
	assert.equal(compileActRefusal("combat:attack", []), undefined, "no compile: the lane reviews");
	assert.equal(compileActRefusal(undefined, [none]), undefined);
	const below = compileActRead(row({ choice: "none", row: null, confidence: 0.5, cleared: false }));
	assert.equal(compileActRefusal("combat:attack", [below]), undefined, "not cleared: the lane reviews");
	const punch = compileActRead(row({ choice: "act_1", row: "combat:attack", confidence: 1, cleared: true }));
	assert.equal(compileActRefusal("combat:attack", [punch]), undefined);
	assert.equal(compileActRefusal("combat:maneuver", [none, punch]), undefined, "a compile of the run read a fight act: no typed refusal");
	const unclear = compileActRead(row({ choice: "unclear", row: null, confidence: 0.7, cleared: true }));
	assert.equal(compileActRefusal("combat:attack", [unclear]), undefined, "unclear is not none");
});
