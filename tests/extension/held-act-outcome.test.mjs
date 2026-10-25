// Controller-only cases retired with single-keeper-streaming-turns; retained cases exercise current shared utilities.
/**
 * The owner's 2026-10-11 decision (contract §166.2 and §213.1 amendments): §166.2's refusal-result guard covers an act held
 * because the admission review was unavailable. A delivery must not tell the result (arrival, departure, payment, a thing
 * changing hands) of what the player declared and no receipt carries; a strong claim is corrected once through the
 * turn-close steer, and every other answer delivers (§200.3's table).
 *
 * Through the product path: the single-loop engine, the kernel extension (extensions/kernel/index.ts) with its held-act guard
 * (runtime/jev/held-act-outcome.ts), the admission lane with no provider behind it (`admission_unavailable`), the fake
 * kernel, and the real shared decision adapter behind a controlled typed endpoint (`fetch` answers the pinned Jev URL). The
 * captured shape is live turn 26 of the 9e7 table (`game-dcad7727`, turns/0026.json, 9e7-turn26-delivered.txt): the player
 * tipped the newsvendor a dime and took a cab home, the declared `apply time` band `speak_briefly` was refused
 * `admission_unavailable`, and the delivered prose paid the dime and drove the cab away with zero receipts. Here the refused
 * line is the Keeper's own `apply cash` for the dime (a Keeper `apply time` is held earlier by §218's declared-time check,
 * before admission); the guard reads any unavailable refusal of the turn the same way. Whether a draft
 * claims a held result is the model's judgement, not this file's: the answers are scripted. No live model is called.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { HeldActOutcome, HELD_ROWS_MAX, receiptLine, heldOperationKey } from "../../runtime/jev/held-act-outcome.ts";
import { outcomeStatus } from "../../runtime/jev/refused-document-outcome.ts";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
/** Turn 26, verbatim: the player's words and the Keeper's delivered prose. */
const PLAYER = "我往他掌心里放一枚一角的硬币，说多的算听故事的钱，谢过他。今晚不进那栋房子，我把报纸夹在胳膊下，坐车回自己的住处。";
const DELIVERED = "你把那枚一角放进他摊着的掌心，说多出来的算听故事的钱，谢过他。报纸夹在胳膊底下。对街那扇门你没有去碰。\n\n"
	+ "他的手指先合上，指节在硬币边上蹭了一下，才把它收进大衣口袋。帽檐下那双眼睛在你脸上停了停。\n\n"
	+ "{{say:靠墙坐着的线人}}“行。故事你听了，钱我也收了。那扇门夜里不开也罢。”{{/say}}\n\n"
	+ "他重新低头去捆剩下的报纸，麻绳在指间绕了一圈。风还从楼缝里过来，带着煤烟和湿石的气味。对街那栋红砖房子的窗帘没有动，里面一点光也没有。\n\n"
	+ "街角又过来一辆还亮着灯的出租汽车。你抬手，车在路灯照不到的一侧停住。你坐进去，把门带上。车子顺着街开走的时候，墙根那个人还坐在原处，膝上是没卖完的报纸，木匣盖没有合上。";
/** A delivery that tells the investigator beginning the declared acts and no result (what §213.1 asks). */
const BEGUN = "你从口袋里摸出一枚一角的硬币，朝他摊开的掌心伸过去，说多出来的算听故事的钱。报纸夹在胳膊底下，对街那扇门你没有去碰。街角有一辆亮着灯的出租汽车，你朝它抬起手。";
/** A line the unavailable review refuses: the dime of turn 26 (live, the refused line was the declared time). */
const HELD_DIME = { kind: "cash", delta: -0.1, source: "quote", with: "Mr. Dooley", why: "a dime for the story" };

const toolCall = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const narrate = (text) => toolCall("output", { text });
const reply = (answers) => new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 600, output_tokens: 20 } }), { status: 200 });

/** The held-result Noul is `outcome(draft)` ("unavailable" fails it); every other typed request is unavailable. */
function installJev(t, outcome) {
	const original = globalThis.fetch;
	const asked = { held: [], other: 0 };
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		if (body.questions?.held_result) {
			asked.held.push(body.state);
			const p = outcome(body.state.draft);
			return p === "unavailable" ? new Response("{}", { status: 500 }) : reply({ held_result: { type: "noul", noul: p } });
		}
		asked.other++;
		return new Response("{}", { status: 500 });
	};
	t.after(() => { globalThis.fetch = original; });
	return asked;
}
const engineChoice = (value, confidence = 0.9) => ({ status: "answered", type: "choice", choice: value, confidence, probabilities: { [value]: confidence } });
function engineAnswer(batch) {
	const answers = {};
	for (const question of batch.questions) {
		const criteria = Object.keys(question.criteria ?? {});
		answers[question.key] = engineChoice(question.key === "exit" ? "finish" : criteria[0] === "now" ? "later" : criteria.includes("unclear") ? "unclear"
			: criteria.includes("no") && criteria.includes("yes") ? "no" : "unknown");
	}
	return { batchId: batch.id, status: "complete", answers, issues: [], coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] } };
}

/** Turn 26's table: the review has no provider (`admission_unavailable`), and the Keeper's scripted calls are counted. */
async function turn26(t, { calls, outcome, admission = "nobody/home" }) {
	const asked = installJev(t, outcome);
	const engine = createHybridEngine({ env: {}, decision: { decide: async (batch) => engineAnswer(batch) } });
	let keeperCalls = 0;
	const table = await openTable({ env: { PI_COC_LOOP_ENGINE: "hybrid-v1", FAKE_KERNEL_WORKSPACE: "1", FAKE_KERNEL_PRESENT: "[]",
		EXT_JEV_APIKEY: "test-jev-key", ...(admission ? { PI_COC_ADMISSION_MODEL: admission } : {}) }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: calls.map((message) => () => { keeperCalls++; return message; }) });
	t.after(() => table.dispose());
	await table.session.prompt(PLAYER);
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	return { table, asked, keeperCalls: () => keeperCalls };
}
const refusals = (table, tool) => table.session.messages
	.filter((message) => message.role === "toolResult" && message.toolName === tool && message.details?.coc_error).map((message) => message.details.coc_error);
const heldRows = (table) => table.telemetry().filter((row) => row.lane === "held_act_outcome").map((row) => [row.status, row.reason, row.probability]);
const steers = (table) => table.telemetry().filter((row) => row.lane === "turn" && row.event === "turn_close" && row.status === "steer");
const narrated = (table) => table.kernelRequests().filter((request) => request.method === "table.narrate").map((request) => request.params.text);

test("the basis: one per turn, deduplicated, bounded; receipts are projected, not read", () => {
	const boundary = new HeldActOutcome();
	const input = { campaign: "c", turn: 26, playerText: PLAYER };
	boundary.hold(input, { tool: "apply", lines: ["apply time band=speak_briefly"], cause: "model_error" });
	boundary.hold(input, { tool: "apply", lines: ["apply time band=speak_briefly"], cause: "model_error" });
	assert.equal(boundary.basis.held.length, 1);
	boundary.hold({ ...input, turn: 27 }, { tool: "apply", lines: ["apply move to=home"], cause: "model_error" });
	assert.equal(boundary.basis.held.length, 1, "another turn's refusal never joins this basis");
	for (let index = 0; index < HELD_ROWS_MAX + 4; index++) boundary.hold(input, { tool: "apply", lines: [`line ${index}`], cause: "timeout" });
	assert.equal(boundary.basis.held.length, HELD_ROWS_MAX);
	assert.equal(receiptLine({ id: "r1", kind: "cash", delta: -0.1, nested: { a: 1 }, ok: true }), "id=r1 kind=cash delta=-0.1 ok=true");
	// §200.3's table, shared with the refused document.
	assert.deepEqual(outcomeStatus(0.95, 1, false, true), ["steer", "false_completion"]);
	assert.deepEqual(outcomeStatus(0.95, 1, false, false), ["claimed", "false_completion_without_correction"]);
	assert.deepEqual(outcomeStatus(0.95, 2, true, true), ["claimed", "false_completion_after_correction"]);
	assert.deepEqual(outcomeStatus(0.05, 1, false, true), ["clean", "no_false_completion"]);
	assert.deepEqual(outcomeStatus(0.5, 1, false, true), ["unclear", "outcome_uncertain"]);
	assert.deepEqual(outcomeStatus(undefined, 1, false, true), ["unclear", "outcome_unavailable"]);
});

test('only exact canonical settlement discharges a scoped operation failure',async()=>{
 const {heldOperationKey}=await import('../../runtime/jev/held-act-outcome.ts');
 const scope={campaign:'campaign',worldline:'main',turn:4,playerText:'I leave.'};
 const args={campaign:'campaign',call_id:'first',effects:[{kind:'move',to:'Library',via:'street'}]};
 const key=heldOperationKey('apply',args),boundary=new HeldActOutcome();
 assert.equal(key,heldOperationKey('apply',{effects:[{via:'street',to:'Library',kind:'move'}],call_id:'retry'}));
 boundary.hold(scope,{tool:'apply',lines:['complete operation'],cause:'transport',operationKey:key},true);
 assert.equal(boundary.settled({...scope,turn:5},key),0);assert.ok(boundary.basis);
 assert.equal(boundary.settled(scope,heldOperationKey('apply',{effects:[{kind:'time',minutes:1}]})),0);assert.ok(boundary.basis);
 assert.equal(boundary.settled(scope,heldOperationKey('apply',{effects:[{kind:'move',to:'Library',via:'another street'}]})),0);
 assert.equal(boundary.settled(scope,key),1);assert.equal(boundary.basis,undefined);
 const unknown=new HeldActOutcome();unknown.hold(scope,{tool:'apply',lines:['no exact proposal'],cause:'unknown'},true);
 assert.equal(unknown.settled(scope,key),0);assert.ok(unknown.basis);
});

test('native failure projection preserves refusals and excludes ambiguous execution or clipped coverage',()=>{
 const scope={campaign:'campaign',turn:4,playerText:'I leave.'};
 for(const cause of ['invalid_params','unknown_entity','not_here','action_not_authorized','action_admission_uncertain','admission_unavailable','place_barrier']){
  const boundary=new HeldActOutcome();boundary.hold(scope,{tool:'apply',lines:['PRIVATE_REJECTED_PROPOSAL'],cause,operationKey:'failed'},true);
  assert.deepEqual(boundary.uncommittedFailures(),[{tool:'apply',status:'uncommitted',reason:cause}]);assert.equal(boundary.basis.held.length,1);
  assert.ok(!JSON.stringify(boundary.uncommittedFailures()).includes('PRIVATE_'));
 }
 for(const cause of ['transport','timeout','partial_settlement','operation_failed','not_reachable']){
  const boundary=new HeldActOutcome();boundary.hold(scope,{tool:'apply',lines:['proposal'],cause},true);assert.equal(boundary.uncommittedFailures(),undefined);
 }
 const incomplete=new HeldActOutcome();incomplete.hold(scope,{tool:'apply',lines:['x'.repeat(12001)],cause:'action_not_authorized'},true);assert.equal(incomplete.uncommittedFailures(),undefined);
 const legacy=new HeldActOutcome();legacy.hold(scope,{tool:'apply',lines:['proposal'],cause:'action_not_authorized'});assert.equal(legacy.uncommittedFailures(),undefined);
 // §270.7: a refused resolve committed nothing, whatever its refusal said; an unreadable outcome stays unknown.
 const refusedRoll=new HeldActOutcome();refusedRoll.hold(scope,{tool:'resolve',lines:['proposal'],cause:'unknown_entity'},true);
 assert.deepEqual(refusedRoll.uncommittedFailures(),[{tool:'resolve',status:'uncommitted',reason:'unknown_entity'}]);
 const refusedPaper=new HeldActOutcome();refusedPaper.hold(scope,{tool:'apply',lines:['proposal'],cause:'needs'},true);
 assert.deepEqual(refusedPaper.uncommittedFailures(),[{tool:'apply',status:'uncommitted',reason:'needs'}],'§270.13: a refused apply committed nothing');
 const lostRoll=new HeldActOutcome();lostRoll.hold(scope,{tool:'resolve',lines:['proposal'],cause:'transport'},true);assert.equal(lostRoll.uncommittedFailures(),undefined);
});

test('argument completion tracks the complete ordered player action, not its bookkeeping envelope',()=>{
 const scope={campaign:'campaign',worldline:'main',turn:4,playerText:'I inspect the mark.'};
 const full=heldOperationKey('apply',{effects:[{kind:'time',minutes:4}],event:{name:'Read',material:''}});
 const complete=effects=>heldOperationKey('player-action-completion',{tool:'apply',effects});
 const effects=[{kind:'time',minutes:4},{kind:'object',name:'Coin',to:'Investigator',quantity:1,how:'with the hand'}];
 const key=complete(effects),hold=(cause='invalid_params')=>{const boundary=new HeldActOutcome();boundary.hold(scope,{tool:'apply',lines:[JSON.stringify(effects)],cause,operationKey:full,argumentCompletionKey:key},true);return boundary;};
 const boundary=hold();assert.equal(boundary.settled(scope,'another full proposal'),0);assert.equal(boundary.settled(scope,'corrected full proposal',key),1);
 for(const changed of [[effects[0]],effects.toReversed(),[...effects,effects[0]],[{...effects[0],minutes:5},effects[1]],[effects[0],{...effects[1],quantity:2}],[effects[0],{...effects[1],to:'Another investigator'}],[effects[0],{...effects[1],how:'with a knife'}]])assert.equal(hold().settled(scope,'corrected',complete(changed)),0);
 for(const cause of ['action_not_authorized','partial_settlement','transport','tool_validation_failed'])assert.equal(hold(cause).settled(scope,'corrected',key),0);
 for(const changed of [{...scope,turn:5},{...scope,playerText:'Another input.'},{...scope,worldline:'other'}])assert.equal(hold().settled(changed,'corrected',key),0);
 const repeated=hold();for(let i=0;i<20;i++)repeated.hold(scope,{tool:'apply',lines:[JSON.stringify(effects)],cause:'invalid_params',operationKey:'different-bookkeeping-'+i,argumentCompletionKey:key},true);
 assert.equal(repeated.basis.held.length,1);assert.notEqual(repeated.basis.complete,false);
});

test('event validation rolls back staged player time before a corrected canonical call',async t=>{
 const {kernel,openTurn}=await import('../integration/support.ts');const client=await kernel(t);await openTurn(client);
 const input={effects:[{kind:'time',minutes:4}],event:{name:'Inspect the mark',summary:'The proposed event.',material:'',materials:[{name:'view',kind:'description',visibility:'player',text:'The recorded view.'}]}};
 const before=await client.table('capsule');const failure=await client.tableErr('apply',{call_id:'t1-c1',...input});
 assert.equal(failure.details.reason,'event_argument_validation');assert.deepEqual((await client.table('capsule')).where.clock,before.where.clock);
 const actual=await client.table('apply',{call_id:'t1-c1',...input,event:{...input.event,summary:'The corrected event.',material:'view'}});
 assert.equal(actual.receipts.length,2);assert.equal(actual.outcome.events.length,0,'undelivered event stays pending');
});
