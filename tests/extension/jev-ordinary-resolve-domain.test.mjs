import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {createOrdinaryResolveDomain, ORDINARY_RESOLVE_VERSION} from '../../runtime/jev/ordinary-resolve-domain.ts';
import {TaskRuntime} from '../../runtime/jev/task-runtime.ts';

class Store {
  records = new Map();
  async load(id) { return structuredClone(this.records.get(id)); }
  async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

const scope = {owner:'ordinary-resolve:campaign',campaign:'campaign',worldline:'main',loop:0,audience:'keeper'};
const readSet = [{kind:'world',resource:'campaign',revision:'world-r1'}];
const rawInput = 'I carefully search the desk.';
const rawRef = {version:1,scope,resource:'turn:5:player',revision:'turn-r1',sourceType:'turn',selector:{kind:'utf16',start:0,end:rawInput.length}};
const plan = {goal:'Find the hidden ledger.',subgoals:[],constraints:[],evidenceRequired:[],completion:['Settle the selected ordinary check once.'],capabilities:['resolve'],replanWhen:[],returnWhen:[]};
const ordinaryDecision = {name:'core-check:ordinary-check',family:'core-check',description:'One ordinary check.',capability:'check'};
const profile = (overrides={}) => ({alias:'profile:0',actor:'Alice',skill:'Spot Hidden',availability:'bound',value:55,...overrides});
const options = (overrides={}) => ({version:1,profiles:[profile()],decisions:[ordinaryDecision],revision:'profiles-r1',world_revision:'world-r1',context:{scene:'Office',pending_choice:null,session:null,conditions:[],current_receipts:[],declared_action:rawInput},...overrides});
const packet = (proposal, status, result, receipts=[]) => ({operationId:proposal.id,status,result,refs:[],receipts,readSet:proposal.readSet,coverage:{used:[],omitted:[],unknown:[]}});

function decisions(select, observe) {
  return {async decide(batch) {
    observe(batch);
    const raw = Object.fromEntries(batch.questions.map(question => {
      const selected = select(question, batch);
      return [question.key, selected === undefined ? {status:'unknown'} : {status:'answered',type:'choice',choice:selected}];
    }));
    return bindDecisionAnswers(batch, raw, {inputTokens:1,outputTokens:1,costUsd:0});
  }};
}

async function run({snapshot=options(), select=defaultSelection, resolveStatus='succeeded', resolveResult={outcome:{kind:'success'}}, receipts=['receipt:roll:1'], maxSteps=32}={}) {
  const store = new Store(), calls = [], batches = [];
  const decision = decisions(select,batch=>batches.push(structuredClone(batch)));
  const operations = {
    async validate() { return readSet; },
    async dispatch(proposal) {
      calls.push(structuredClone(proposal));
      if (proposal.operation === 'resolve.options') return packet(proposal,'succeeded',structuredClone(snapshot));
      if (proposal.operation === 'resolve') return packet(proposal,resolveStatus,structuredClone(resolveResult),receipts);
      throw new Error(`unexpected operation ${proposal.operation}`);
    },
  };
  const runtime = new TaskRuntime({decision,store,operations,domains:[createOrdinaryResolveDomain({rawInput:()=>rawInput})],maxSteps});
  const id = await runtime.begin({domain:'ordinary-resolve',intent:{id:'intent',rawInput:rawRef,goal:plan.goal,limits:[],scope,turn:5,inputRevision:rawRef.revision},lease:{owner:'ordinary-resolve',goal:plan.goal,scope,capabilities:['resolve'],budget:{deadlineAt:Date.now()+30_000,remainingInputTokens:100_000,remainingOutputTokens:100_000,remainingCostUsd:10,remainingActions:32},readSet}});
  const result = await runtime.submit(id,plan);
  return {result,record:runtime.snapshot(id),calls,batches};
}

function defaultSelection(question) {
  return ({route:'ordinary',consent:'authorized',actor:'actor_0',intent:'investigate',difficulty:'hard',bonus:'one',penalty:'none',profile:'profile_0'})[question.key];
}

test('binds one issued ordinary profile and dispatches exactly one canonical settlement', async () => {
	assert.equal(ORDINARY_RESOLVE_VERSION,'2');
  const app = await run();
  assert.equal(app.result.status,'complete',JSON.stringify(app.result));
  assert.equal(app.calls.filter(call=>call.operation==='resolve.options').length,1);
  const settlements = app.calls.filter(call=>call.operation==='resolve');
  assert.equal(settlements.length,1);
  assert.deepEqual(settlements[0].args,{action:{actor:'Alice',intent:'investigate',goal:plan.goal,method:rawInput,skill:'Spot Hidden',decision:'core-check:ordinary-check',modifiers:{difficulty:'hard',bonus_dice:1,penalty_dice:0,reason:rawInput}}});
  assert.deepEqual(app.result.receipts,['receipt:roll:1']);
});

test('binds the selected ordinary intent instead of hard-coding investigate', async () => {
  const app=await run({snapshot:options({profiles:[profile({skill:'Fast Talk',value:45})]}),select:question=>question.key==='intent'?'social':defaultSelection(question)});
  assert.equal(app.result.status,'complete');const settlement=app.calls.find(call=>call.operation==='resolve');
  assert.equal(settlement.args.action.intent,'social');assert.equal(settlement.args.action.skill,'Fast Talk');
});

test('no-roll, incumbent specialization, missing consent, and unknown routing never settle', async (t) => {
  const cases = [
    ['no roll',{route:'no_roll'},'complete'],
    ['First Aid remains incumbent',{route:'incumbent'},'unresolved'],
    ['genuine player choice',{route:'needs_player'},'needs_player'],
    ['unselected method',{route:'ordinary',consent:'unselected'},'needs_player'],
    ['unknown consent',{route:'ordinary',consent:undefined},'partial'],
		['unknown family',{route:undefined},'partial'],
  ];
  for (const [name,answers,status] of cases) await t.test(name,async()=>{
    const app=await run({select:q=>Object.hasOwn(answers,q.key)?answers[q.key]:defaultSelection(q)});
		assert.equal(app.result.status,status);assert.equal(app.calls.filter(call=>call.operation==='resolve').length,0);
		if(name==='First Aid remains incumbent')assert.deepEqual(app.result.handoff,{verbs:['resolve']});
		if(name==='unknown family'){assert.equal(app.record.phase,'composing');assert.equal(app.record.replans,0,"a missing model answer is not a semantic replan verdict");}
  });
});

test('pending choices and incumbent sessions stop before model routing or settlement', async (t) => {
  for (const [name,context,status] of [
    ['pending choice',{pending_choice:{kind:'luck'},session:null},'needs_player'],
    ['active session',{pending_choice:null,session:{kind:'combat',status:'active'}},'unresolved'],
  ]) await t.test(name,async()=>{
    const app=await run({snapshot:options({context:{scene:'Office',conditions:[],current_receipts:[],declared_action:rawInput,...context}})});
    assert.equal(app.result.status,status);assert.equal(app.batches.length,0);assert.equal(app.calls.filter(call=>call.operation==='resolve').length,0);
  });
});

test('a missing selected value stays unavailable and is never converted to zero', async () => {
  const app=await run({snapshot:options({profiles:[profile({skill:'First Aid',availability:'unknown',value:null})]})});
  assert.equal(app.result.status,'partial');assert.equal(app.calls.filter(call=>call.operation==='resolve').length,0);
  const issued=app.batches.find(batch=>batch.questions.some(question=>question.key==='profile')).questions.find(question=>question.key==='profile');
  assert.deepEqual(issued.criteria.profile_0,{skill:'First Aid',availability:'unknown'});
});

test('malformed and overpacked option snapshots return partial without model or settlement', async (t) => {
  for (const [name,snapshot] of [
    ['missing profiles',options({profiles:null})],
    ['missing context',options({context:null})],
    ['incomplete compiled decision',options({decisions:[{name:'core-check:ordinary-check',family:'core-check'}]})],
    ['overpacked context',options({context:{scene:'x'.repeat(40_000),pending_choice:null,session:null}})],
  ]) await t.test(name,async()=>{
    const app=await run({snapshot});assert.equal(app.result.status,'partial');assert.equal(app.calls.filter(call=>call.operation==='resolve').length,0);
  });
});

test('malformed issued profile rows cannot become executable arguments', async () => {
  const malformed={alias:'profile:0',actor:'Alice',availability:'bound',value:55};
  const app=await run({snapshot:options({profiles:[malformed]})});
  assert.equal(app.result.status,'partial');
  assert.equal(app.calls.filter(call=>call.operation==='resolve').length,0);
});

test('failed and replayed observations are terminal evidence and never reroll', async (t) => {
  await t.test('failed settlement',async()=>{
    const app=await run({resolveStatus:'failed',resolveResult:{code:'admission_refused'},receipts:[]});
    assert.equal(app.result.status,'partial');assert.equal(app.calls.filter(call=>call.operation==='resolve').length,1);
  });
  await t.test('replayed settled result',async()=>{
    const app=await run({resolveResult:{outcome:{kind:'success'},replayed:true}});
    assert.equal(app.result.status,'complete');assert.equal(app.calls.filter(call=>call.operation==='resolve').length,1);
  });
});
