/** Campaign boundary counterparts of tests/kernel/test_campaign.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {kernel,CONTENT_DIR,CAMPAIGN,MODULE,PREGEN,campaignDir,readJson,createCampaign,type RpcClient} from './support.ts';
const OPENING_SCENE='commission-briefing';
const gitLog=(k:RpcClient)=>execFileSync('git',[`--git-dir=${join(k.workspace,'.coc/repos',CAMPAIGN+'.git')}`,'log','--format=%s'],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim().split('\n');

test('test_hello_lists_content',async t=>{
  const k=await kernel(t),result=await k.ok('kernel.hello');assert.ok(result.kernel_version);
  assert.deepEqual(result.content.rulesets,['coc7']);assert.ok(result.content.modules.includes(MODULE));
});

test('test_create_and_list',async t=>{
  const k=await kernel(t);assert.deepEqual(await k.ok('campaign.list'),{campaigns:[]});const created=(await createCampaign(k)).campaign;
  assert.equal(created.id,CAMPAIGN);assert.equal(created.module_id,MODULE);assert.equal(created.status,'active');assert.equal(created.opening_scene,OPENING_SCENE);
  assert.equal(created.module_digest.length,64);assert.equal(created.play_language,'zh-Hans');
  assert.deepEqual((await k.ok('campaign.list')).campaigns,[{id:CAMPAIGN,title:created.title,module_id:MODULE,status:'active',turn:0}]);
  assert.equal((await k.err('campaign.create',{id:CAMPAIGN,module:MODULE,pregen:PREGEN,play_language:'zh-Hans'})).code,'invalid_params');
  assert.equal((await k.err('campaign.create',{id:CAMPAIGN+'x',module:'nope',pregen:PREGEN})).code,'invalid_params');
  assert.equal((await k.err('campaign.create',{id:CAMPAIGN+'y',module:MODULE,pregen:'nobody'})).code,'invalid_params');
});

test('test_a_telemetry_only_directory_does_not_block_creating_the_campaign',async t=>{
  const k=await kernel(t),directory=campaignDir(k.workspace);mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'telemetry.jsonl'),'{"lane":"reading"}\n');const created=(await createCampaign(k)).campaign;
  assert.equal(created.id,CAMPAIGN);assert.equal(created.status,'active');assert.ok(existsSync(join(directory,'campaign.json')));
  assert.equal(readFileSync(join(directory,'telemetry.jsonl'),'utf8'),'{"lane":"reading"}\n');
});

test('test_create_writes_layout_and_first_commit',async t=>{
  const k=await kernel(t);await createCampaign(k);const directory=campaignDir(k.workspace),world=readJson(join(directory,'world.json'));
  assert.equal(world.active_scene,OPENING_SCENE);assert.deepEqual(world.visited_scenes,[OPENING_SCENE]);assert.deepEqual(world.discovered_clues,[]);
  assert.deepEqual(world.clock,{minutes:0});assert.equal(world.npc_presence['steven-knott'],OPENING_SCENE);
  const sheet=readJson(join(directory,'party',PREGEN+'.json'));assert.equal(sheet.skills['Spot Hidden'],55);
  assert.deepEqual([sheet.current_hp,sheet.current_san,sheet.current_mp,sheet.current_luck],[sheet.derived.HP,sheet.derived.SAN,sheet.derived.MP,sheet.characteristics.LUCK]);
  const turn=readJson(join(directory,'turn.json'));assert.deepEqual([turn.turn,turn.state,turn.receipts,turn.calls],[0,'awaiting_player',[],{}]);
  assert.deepEqual(gitLog(k),[`campaign ${CAMPAIGN}: created`]);
});

test('test_open_reports_opening_needed_then_turn_zero_commits',async t=>{
  const k=await kernel(t);await createCampaign(k);const opened=await k.table('open');assert.equal(opened.opening_needed,true);
  assert.deepEqual(opened.turn,{number:0,state:'awaiting_player'});assert.equal(opened.pending_turn,null);
  assert.deepEqual(opened.scene,{name:OPENING_SCENE,display_name:"Knott's Office"});const investigator=opened.investigators[0];
  assert.equal(investigator.id,PREGEN);assert.deepEqual([investigator.hp,investigator.san,investigator.mp,investigator.luck],[12,55,11,50]);
  assert.equal((await k.tableErr('resolve',{call_id:'t0-c1',action:{intent:'idle'}})).code,'turn_state');
  const text='波士顿，1920 年代。\n\n诺特先生的办公室。';const result=await k.table('narrate',{call_id:'t0-c1',text});
  assert.equal(result.turn,0);assert.equal(result.receipt,'turn:0');assert.equal(result.rendered_text,text);assert.ok(result.commit);
  const log=gitLog(k);assert.equal(log[0],'turn 0: 波士顿，1920 年代。 诺特先生的办公室。');assert.equal(log.at(-1),`campaign ${CAMPAIGN}: created`);
  const reopened=await k.table('open');assert.equal(reopened.opening_needed,false);assert.deepEqual(reopened.turn,{number:1,state:'awaiting_player'});
  const record=readJson(join(campaignDir(k.workspace),'turns/0000.json'));assert.equal(record.commit,result.commit);assert.equal(record.closed_by,'narrate');
});

test('test_skipping_the_opening_closes_turn_zero_implicitly',async t=>{
  const k=await kernel(t);await createCampaign(k);const result=await k.table('player_input',{text:'我直接开口问委托的事。'});
  assert.equal(result.turn,1);assert.equal(result.state,'open');const record=readJson(join(campaignDir(k.workspace),'turns/0000.json'));
  assert.equal(record.closed_by,'implicit');assert.deepEqual(record.receipts,[]);assert.equal((await k.table('open')).opening_needed,false);
});

test('test_language_shape_and_closed_vocabulary_refusals_are_actionable',async t=>{
  const k=await kernel(t),refused=await k.err('campaign.create',{id:CAMPAIGN,module:MODULE,pregen:PREGEN,play_language:'not_a_tag'});
  assert.equal(refused.code,'invalid_params');assert.equal(refused.details.field,'play_language');
  assert.deepEqual(refused.details.suggested,readJson(join(CONTENT_DIR,'languages.json')).suggested);
  assert.ok(!('options' in refused.details));assert.ok(refused.fix.includes('BCP-47'));
  const register=await k.err('campaign.create',{id:CAMPAIGN,module:MODULE,pregen:PREGEN,register:'gonzo'});assert.ok(register.details.options.includes('purist'));
  await createCampaign(k);
  for(const [method,params,field] of [['table.look',{focus:'nowhere'},'focus'],['table.lookup',{kind:'nonsense',name:'x'},'kind'],['table.recall',{what:'nonsense'},'what']] as const){
    const error=await k.err(method,{campaign:CAMPAIGN,...params});assert.equal(error.details.field,field);assert.ok(error.details.options.length>1);assert.ok(error.fix);
  }
});
