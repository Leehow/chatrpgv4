/**
 * Contract §161.1: the host sends a mood that shares its npc effect with another change as the two effects the kernel's
 * refusal asks for. Dust to Dust (2026-10-02): `{walk_on, to, stance, mood}` in one effect, refused, then resent split by
 * hand -- a model round trip on two turns running.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, test} from 'node:test';
import {build} from 'esbuild';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {kernel,openTurn,createCampaign,RpcClient,campaignDir,readJson} from '../integration/support.ts';

// kernel-ts imports its siblings as `.js`; the runtime build bundles them, and so does this test.
const root = resolve(import.meta.dirname, '../..'), temporary = await mkdtemp(join(tmpdir(), 'npc-mood-split-'));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({stdin: {contents: "export {splitNpcMood} from './extensions/kernel/npc-mood-split.ts'; export {MOOD_CONFLICTS} from './kernel-ts/npc/mood.ts';",
  resolveDir: root, sourcefile: 'npc-mood-split-api.ts'}, outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm',
  platform: 'node', target: 'node22', logLevel: 'silent'});
const {splitNpcMood, MOOD_CONFLICTS} = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

test('a mood beside a move, a stance or a walk-on goes second, as its own effect; the rest is untouched', () => {
  const effects = [
    {kind: 'time', band: 'speak_briefly'},
    {kind: 'npc', name: '守夜人', walk_on: true, to: 'here', stance: 'wary', mood: '先把规矩问清楚。', why: '在场'},
    {kind: 'npc', name: '值班警官', mood: '语气更硬。'},
    {kind: 'npc', name: '值班警官', to: 'here'},
  ];
  assert.equal(splitNpcMood(effects), 1);
  assert.deepEqual(effects, [
    {kind: 'time', band: 'speak_briefly'},
    {kind: 'npc', name: '守夜人', walk_on: true, to: 'here', stance: 'wary', why: '在场'},
    {kind: 'npc', name: '守夜人', mood: '先把规矩问清楚。'},
    {kind: 'npc', name: '值班警官', mood: '语气更硬。'},
    {kind: 'npc', name: '值班警官', to: 'here'},
  ]);
  for (const key of MOOD_CONFLICTS) {
    const one = [{kind: 'npc', name: 'x', mood: 'm', [key]: 1}];
    assert.equal(splitNpcMood(one), 1, key);
    assert.deepEqual(one.map(effect => Object.keys(effect).includes('mood')), [false, true]);
  }
  assert.equal(splitNpcMood(undefined), 0);
  assert.equal(splitNpcMood([{kind: 'item', mood: 'm', to: 'x'}]), 0, 'only npc effects');
});

test('the kernel extension splits the Keeper\'s own apply before admission, never a host call', () => {
  const source = readFileSync(new URL('../../extensions/kernel/index.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('const moodSplit = spec.name === "apply" && !host ? splitNpcMood(params.effects) : 0;'));
  assert.ok(source.indexOf('splitNpcMood(params.effects)') < source.indexOf('leaveOutUnknownOwed(params.effects'), 'before the owed pass and admission');
});

test('the extension module loads unbundled, as the harness loads the kernel extension', async () => {
  // Every harness test that loads extensions/kernel/index.ts failed to load when this module imported kernel-ts/npc/mood.ts,
  // whose `.js` siblings do not resolve without the bundler.
  const direct = await import('../../extensions/kernel/npc-mood-split.ts');
  assert.equal(typeof direct.splitNpcMood, 'function');
});

test('explicit ordinary position, activity and undertaking expand in one ordered batch without inventing fields',()=>{
  const activity={summary:'He is awake at his desk.',basis:'observed',wakefulness:'awake',review_after_minutes:10};
  const combined={kind:'npc',name:'Steven Knott',to:'here',walk_on:true,activity,
    intends:'Check tomorrow appointments.',outcome:'planned',why:'He returns to the desk.'};
  const effects=[{kind:'time',minutes:3},combined,{kind:'flag',name:'fixture',value:true}];
  assert.equal(splitNpcMood(effects),1);
  assert.deepEqual(effects,[{kind:'time',minutes:3},
    {kind:'npc',name:'Steven Knott',to:'here',walk_on:true,why:combined.why},
    {kind:'npc',name:'Steven Knott',activity,why:combined.why},
    {kind:'npc',name:'Steven Knott',intends:combined.intends,outcome:'planned',why:combined.why},
    {kind:'flag',name:'fixture',value:true}]);
  assert.equal(splitNpcMood(effects),0,'the normalized batch is stable for exact replay');
  const missing=[{kind:'npc',name:'Steven Knott',to:'away',intends:'Check tomorrow appointments.'}];
  assert.equal(splitNpcMood(missing),1);
  assert.ok(!Object.hasOwn(missing[1],'outcome'),'the original kernel still rejects a missing outcome');
  for(const variant of ['activity','intends']){
    const value=variant==='activity'?{activity,why:'He returns.'}:{intends:'Check appointments.',outcome:'attempted'};
    const effect=[{kind:'npc',name:'Steven Knott',to:'here',...value}];
    assert.equal(splitNpcMood(effect),1);
    assert.equal(effect.length,2);
  }
});

test('causal references and nonordinary NPC variants keep their original fields and guards',()=>{
  for(const extra of [{intent_ref:'existing',intent_outcome:'done'},{intent_ref:undefined},{owed:'issued'},
    {skill:{name:'Listen',value:30}},{conditions:{gained:['unconscious']}},{dead:true},{defense:'dodge'},
    {action:'hold'},{reunion:{}},{stance:'wary'},{spend_turn:true},{_generated:true},{unrecognized:'value'}]){
    const effects=[{kind:'npc',name:'Steven Knott',to:'here',intends:'Check appointments.',outcome:'planned',...extra}];
    const before=structuredClone(effects);
    assert.equal(splitNpcMood(effects),0,JSON.stringify(extra));
    assert.deepEqual(effects,before);
  }
});

test('existing host identity provenance remains on the first position owner',()=>{
  const passage={scene:'commission-briefing',page:1,label:'fixture source',sentence:'Fabius Fixture Porter returns to his desk.'};
  const effects=[{kind:'npc',name:'Fabius Fixture Porter',to:'here',_passage:passage,_resolved_from:'the porter',
    activity:{summary:'He is awake at the desk.',basis:'observed',wakefulness:'awake'},
    intends:'Check later appointments.',outcome:'planned',why:'He returns to his desk.'}];
  assert.equal(splitNpcMood(effects),1);
  assert.equal(effects.length,3);
  assert.deepEqual(effects[0],{kind:'npc',name:'Fabius Fixture Porter',to:'here',_passage:passage,_resolved_from:'the porter',why:'He returns to his desk.'});
  for(const effect of effects.slice(1)){assert.ok(!Object.hasOwn(effect,'_passage'));assert.ok(!Object.hasOwn(effect,'_resolved_from'));}
});

const ordinary={kind:'npc',name:'Steven Knott',to:'hall-of-records',
  activity:{summary:'He remains awake while checking appointments.',basis:'observed',wakefulness:'awake',review_after_minutes:10},
  intends:'Check tomorrow appointments.',outcome:'planned',why:'He returns to the appointment desk.'};

test('the existing native owners stamp the moved scene and planned undertaking once and later readers consume them',async t=>{
  const client=await kernel(t);await openTurn(client);
  const effects=[{kind:'time',minutes:3},structuredClone(ordinary)];
  assert.equal(splitNpcMood(effects),1);
  const params={call_id:'t1-c1',effects},landed=await client.table('apply',params);
  const replay=await client.table('apply',params);assert.equal(replay.replayed,true);
  const world=readJson(join(campaignDir(client.workspace),'world.json'));
  assert.equal(world.clock.minutes,3);
  const npc=Object.keys(world.npc_activity).find(name=>name.includes('knott'));
  assert.equal(world.npc_presence[npc],'hall-of-records');
  assert.equal(world.npc_activity[npc].scene,'hall-of-records');
  const receipts=(await client.table('status')).receipts;
  assert.equal(receipts.filter(row=>row.intent?.outcome==='planned').length,1);
  assert.equal(receipts.filter(row=>row.kind==='time').length,1);
  assert.equal(landed.receipts.length,4);
  await client.table('narrate',{call_id:'t1-c2',text:'Knott walks to the Hall of Records. You wait here.'});
  await client.table('player_input',{text:'I consider his announced plan.'});
  const view=await client.table('look',{focus:'npc',name:'Steven Knott'});
  assert.ok(JSON.stringify(view).includes('Check tomorrow appointments.'));
  assert.ok(JSON.stringify(view).includes('planned'));
  assert.ok(JSON.stringify(view).includes('He remains awake while checking appointments.'));
});

test('a source-supported first position registers one canonical person before activity and undertaking',async t=>{
  const client=await kernel(t);await openTurn(client);
  const name='Fabius Fixture Porter',passage={scene:'commission-briefing',page:1,label:'fixture source',sentence:`${name} returns to his desk.`};
  const effects=[{...structuredClone(ordinary),name,to:'here',_passage:passage,_resolved_from:'the porter'}];
  splitNpcMood(effects);
  const landed=await client.table('apply',{call_id:'t1-c1',effects});
  const world=readJson(join(campaignDir(client.workspace),'world.json'));
  assert.equal(world.table_people.filter(person=>person.name===name).length,1);
  assert.deepEqual(world.table_people.find(person=>person.name===name).from_passage,passage);
  const receipts=(await client.table('status')).receipts.filter(receipt=>landed.receipts.includes(receipt.id));
  assert.equal(new Set(receipts.map(receipt=>receipt.npc)).size,1,'all parts resolve the same canonical person');
  assert.equal(receipts[0].established,'passage');assert.equal(receipts[0].resolved_from,'the porter');
  assert.equal(receipts[1].activity.scene,world.active_scene);
  assert.equal(receipts[2].intent.outcome,'planned');
});

test('native activity priority and malformed undertaking roll back the entire normalized batch',async t=>{
  const client=await kernel(t);await openTurn(client);
  const initial=[structuredClone(ordinary)];splitNpcMood(initial);
  await client.table('apply',{call_id:'t1-c1',effects:initial});
  const path=join(campaignDir(client.workspace),'world.json'),before=readJson(path);
  const baseline=(await client.table('status')).receipts;
  const inferred=[{...structuredClone(ordinary),activity:{summary:'He is probably asleep.',basis:'inferred',wakefulness:'asleep'}}];
  splitNpcMood(inferred);
  const priority=await client.call('table.apply',{campaign:'c1',call_id:'t1-c2',effects:inferred});
  assert.equal(priority.ok,false);
  assert.equal(priority.error.code,'invalid_params');
  assert.equal(priority.error.details.reason,'activity_basis');
  assert.deepEqual(readJson(path),before);
  const malformed=[{kind:'time',minutes:5},{kind:'npc',name:'Steven Knott',to:'away',intends:'Check later.'}];
  splitNpcMood(malformed);
  const invalid=await client.call('table.apply',{campaign:'c1',call_id:'t1-c3',effects:malformed});
  assert.equal(invalid.ok,false);assert.equal(invalid.error.code,'invalid_params');
  assert.deepEqual(readJson(path),before);
  assert.deepEqual((await client.table('status')).receipts,baseline);
});

test('normalization does not let an opening move a person away before player input',async t=>{
  const client=await kernel(t);await createCampaign(client);await client.table('open');
  const path=join(campaignDir(client.workspace),'world.json'),before=readJson(path);
  for(const [ordinal,extra] of [[1,{activity:ordinary.activity,why:ordinary.why}],[2,{intends:ordinary.intends,outcome:'planned'}]]){
    const effects=[{kind:'npc',name:'Steven Knott',to:'away',...extra}];splitNpcMood(effects);
    const refused=await client.call('table.apply',{campaign:'c1',call_id:`t0-c${ordinal}`,effects});
    assert.equal(refused.ok,false);assert.ok(['invalid_params','turn_state'].includes(refused.error.code));
    assert.deepEqual(readJson(path),before);
  }
});

test('an unknown destination cannot isolate the normalized activity and undertaking from their position',async t=>{
  const client=await kernel(t);await openTurn(client);
  const path=join(campaignDir(client.workspace),'world.json'),before=readJson(path);
  const effects=[{...structuredClone(ordinary),to:'Missing fixture destination',intends:'Check a later appointment.'}];
  splitNpcMood(effects);
  const response=await client.call('table.apply',{campaign:'c1',call_id:'t1-c1',effects});
  assert.equal(response.ok,false,'the invalid placement still refuses its whole ordinary combination');
  assert.equal(response.error.code,'unknown_entity');assert.equal(response.error.details.field,'npc.to');
  assert.equal(response.error.retryable,false);assert.equal(response.error.next,'change_input');
  assert.ok(response.error.fix.includes('details.candidates'));assert.ok(Array.isArray(response.error.details.candidates));
  assert.deepEqual(readJson(path),before);
  const name='Cassius Fixture Porter',unsupported=[{...structuredClone(ordinary),name,to:'Missing fixture destination',
    _passage:{scene:'commission-briefing',page:1,label:'fixture source',sentence:`${name} returns to his desk.`},_resolved_from:'another porter'}];
  splitNpcMood(unsupported);
  const invalid=await client.call('table.apply',{campaign:'c1',call_id:'t1-c2',effects:unsupported});
  assert.equal(invalid.ok,false);assert.deepEqual(readJson(path),before);
  const view=await client.call('table.look',{campaign:'c1',focus:'npc',name});
  assert.equal(view.ok,false,'a failed placement does not publish its staged person');
});

test('a genuinely unknown person still isolates only their original person effect',async t=>{
  const client=await kernel(t);await openTurn(client);
  const result=await client.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',to:'here'},
    {kind:'npc',name:'Absent fixture stranger',to:'here'}]});
  assert.equal(result.receipts.length,1);
  const status=await client.table('status');assert.equal(status.receipts.length,1);
  assert.equal(status.receipts[0].name,'Steven Knott');
});

for(const mode of ['tool','inline'])test(`the real Pi ${mode} path sends the ordinary combination through the existing adapter`,async t=>{
  const effects=[{kind:'time',minutes:3},{...structuredClone(ordinary),to:'here'}];
  const response={version:1,record:{effects},text:'Knott checks the appointments while you wait.'};
  const engine=createHybridEngine({env:{...process.env,PI_COC_JEV_PRESELECT:'0'},decision:null});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
    env:{PI_COC_LOOP_ENGINE:'hybrid-v1'},extraExtensions:[{name:'driver',factory:engine.extension}],
    async prepareWorkspace(workspace){const client=new RpcClient(workspace);try{
      await client.ok('table.open',{campaign:'test-camp'});
      await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits by his desk.'});
    }finally{await client.close();}},responses:mode==='inline'?[fauxAssistantMessage(JSON.stringify(response))]
      :[fauxAssistantMessage([fauxToolCall('apply',{effects})],{stopReason:'toolUse'}),fauxAssistantMessage('{{public}}'+response.text)]});
  t.after(()=>table.dispose());
  await table.session.prompt('I wait three minutes while Knott checks his appointments.');
  const turn=readJson(join(table.workspace,'.coc/campaigns/test-camp/turns/0001.json'));
  assert.ok(turn.commit);
  assert.equal(turn.world.clock.minutes,3);
  assert.equal(turn.receipts.filter(row=>row.intent?.outcome==='planned').length,1);
  assert.equal(table.telemetry().filter(row=>row.tool==='apply'&&row.ok===false).length,0);
  assert.deepEqual(table.extensionErrors,[]);
});
