/** Public RPC counterparts of tests/kernel/test_mod_director_text.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,CAMPAIGN,campaignDir,createCampaign,readJson,readJsonl,openTurn,type Row,type RpcClient} from './support.ts';

const context=(k:RpcClient)=>k.ok('mods.context',{campaign:CAMPAIGN});
const hasKeys=(row:Row,keys:string[])=>keys.every(key=>key in row);
const lineNamed=(value:Row,name:string)=>value.thread.lines.find((row:Row)=>row.name===name);
const clockNamed=(value:Row,name='corbitt-awareness')=>value.pacing.threat_clocks.find((row:Row)=>row.clock===name);
const rank=['critical','core','major','supporting','minor','unknown'];
const stop=(k:RpcClient,call_id='t1-c1')=>k.table('narrate',{call_id,text:'Knott finishes speaking.'});
function originalJson(value:any):string{
  if(Array.isArray(value))return '['+value.map(originalJson).join(', ')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.entries(value).map(([key,item])=>JSON.stringify(key)+': '+originalJson(item)).join(', ')+'}';
  return JSON.stringify(value);
}

test('test_thread_is_organised_by_what_the_story_still_needs',async t=>{
  const k=await kernel(t);await createCampaign(k);const c=await context(k);
  assert.ok(['story-thread','keeper-pacing','narration-craft','narration-audit'].every(id=>c.active.some((row:Row)=>row.id===id)));
  const thread=c.thread,lines=thread.lines;
  assert.ok(lines.length&&lines.every((row:Row)=>hasKeys(row,['name','importance','missing','of','here','next','beyond'])));
  assert.ok(lines.filter((row:Row)=>row.here.length).every((row:Row)=>'needs' in row));
  const ranks=lines.map((row:Row)=>rank.indexOf(row.importance));assert.deepEqual(ranks,[...ranks].sort((a:number,b:number)=>a-b));
  assert.equal(lines[0].importance,'critical');const frame=lineNamed(c,'commission-and-research-frame');
  assert.ok(frame.here.length&&frame.here.every((entry:Row)=>hasKeys(entry,['clue','gate'])));
  assert.ok(frame.here.every((entry:Row)=>['npc_dialogue','obvious'].includes(entry.gate.split(':')[0])));
  assert.ok(frame.here.every((entry:Row)=>entry.gate.split('; guarded by obligation ')[0].endsWith(': check unspecified')));
  assert.ok(frame.handed.some((entry:Row)=>entry.by==='Steven Knott'));assert.ok(thread.handed.startsWith('The book means these clues to happen'));
  assert.equal(frame.missing,frame.of);assert.ok(!('fallback' in frame));const buried=lineNamed(c,'corbitt-buried-in-basement');
  assert.deepEqual(buried.here,[]);assert.ok(buried.next.length);assert.ok(buried.beyond>=1);assert.ok(!('fallback' in buried));
  assert.ok(buried.next.every((entry:Row)=>entry.clues>=1&&entry.locked.startsWith('clue_discovered')));assert.equal(buried.minimum_routes,3);
  // Match json.dumps' default separators so the original byte bound is not weakened by compact JSON.
  assert.ok(Buffer.byteLength(originalJson(thread))<=3072);
});

test('test_a_clue_without_a_declared_check_keeps_its_gate_unspecified',async t=>{
  const k=await kernel(t);await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[{kind:'move',to:'corbitt-house-ground'}]});
  const diaries=lineNamed(await context(k),'corbitt-is-undead-sorcerer').here.find((entry:Row)=>entry.clue==='corbitt-diaries');
  assert.equal(diaries.gate,'environmental: check unspecified');assert.equal(diaries.line,'boarded cupboard on the ground floor');
});

test('test_a_discovered_clue_leaves_the_thread_and_the_capsule_carries_it',async t=>{
  const k=await kernel(t);await openTurn(k);const before=lineNamed(await context(k),'commission-and-research-frame'),clue=before.here[0].clue;
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'clue',clue}]});const after=lineNamed(await context(k),'commission-and-research-frame');
  assert.equal(after.missing,before.missing-1);assert.ok(!after.here.some((row:Row)=>row.clue===clue));const capsule=await k.table('capsule');
  assert.equal(capsule.mods.thread.lines[0].name,(await context(k)).thread.lines[0].name);
  assert.deepEqual(capsule.mods.pacing.close_calls,{count:0,threshold:3,rule:capsule.mods.pacing.close_calls.rule});
  assert.ok(capsule.mods.instructions.some((row:Row)=>row.mod==='story-thread'));
  assert.deepEqual(capsule.mods.instructions.find((row:Row)=>row.mod==='narration-craft').settings,{coarse_language:true,density_guide:'off'});
});

test('test_close_calls_count_major_wound_blows_once_per_turn',async t=>{
  const k=await kernel(t);await openTurn(k);
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'damage',dice:'4D6+4',why:'the stair gives way'},{kind:'damage',dice:'1D3',why:'and the rail'}]});
  await stop(k,'t1-c2');await k.table('player_input',{text:'I climb up.'});const pacing=(await context(k)).pacing;
  assert.equal(pacing.close_calls.count,1);assert.ok(pacing.threat_clocks.every((row:Row)=>hasKeys(row,['threat','clock','state'])));
});

test('test_sections_exist_only_while_a_reader_is_on',async t=>{
  const k=await kernel(t);await createCampaign(k);
  for(const id of ['story-thread','keeper-pacing'])await k.ok('mods.configure',{campaign:CAMPAIGN,id,enabled:false});
  const c=await context(k);assert.ok(!('thread' in c));assert.ok(!('pacing' in c));
  assert.ok(!c.instructions.some((row:Row)=>['story-thread','keeper-pacing'].includes(row.mod)));
});

test('test_narration_audit_joins_the_shared_audit_job',async t=>{
  const k=await kernel(t);await openTurn(k);
  let job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'audit',input:{text:'Knott sits at his desk.'}});
  assert.ok(job.enabled);assert.ok(readFileSync(job.system_prompt,'utf8').includes('# Campaign continuity review'));
  assert.ok('receipts' in readJson(join(job.cwd,'request.json')));
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'narration-audit',enabled:false});await stop(k);await k.table('player_input',{text:'I continue asking.'});
  job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'audit',input:{text:'Knott shakes his head.'}});
  assert.ok(!job.enabled||!readFileSync(job.system_prompt,'utf8').includes('# Campaign continuity review'));
});

test('test_instructions_are_whole_on_every_turn_within_the_budget',async t=>{
  const k=await kernel(t);
  // Preserve the historical full-instruction profile; demand-loaded Locations has separate acceptance.
  await k.ok('mods.defaults',{id:'enhanced-locations',enabled:false});await openTurn(k);
  const instructions=async()=>Object.fromEntries((await k.table('capsule')).mods.instructions.map((row:Row)=>[row.mod,row]));
  const first=await instructions();assert.ok(Object.values(first).every((row:Row)=>row.form==='full'));
  assert.ok(first['story-thread'].instruction.startsWith('# Story Thread\n'));await stop(k);await k.table('player_input',{text:'I continue asking.'});
  const later=await instructions();assert.deepEqual(later,first);
  assert.ok(Object.values(later).reduce((sum:number,row:Row)=>sum+Buffer.byteLength(row.instruction),0)<=65536);
  assert.ok((await context(k)).instructions.every((row:Row)=>row.form==='full'));
});

test('test_a_scenario_scoped_clock_is_on_the_panel_before_its_danger_is_in_the_room',async t=>{
  const k=await kernel(t);await openTurn(k);const c=await context(k);
  assert.ok(!(await k.table('capsule')).pressures.some((row:Row)=>row.kind==='threat'));
  assert.deepEqual(new Set(c.pacing.threat_clocks.map((row:Row)=>row.clock)),new Set(['corbitt-awareness','landlord-impatience']));
});

test('test_a_threat_clock_moves_only_through_apply_and_shows_what_the_book_makes_visible',async t=>{
  const k=await kernel(t);await openTurn(k);const awareness=clockNamed(await context(k));
  assert.equal(awareness.state,'0/4');assert.ok(!('symptom' in awareness));assert.ok(awareness.next);
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'threat',name:'corbitt-haunting',clock:'corbitt-awareness',why:'they pried at the boards'}]});
  const receipt=(await k.table('status')).receipts.find((row:Row)=>row.kind==='threat');
  assert.deepEqual([receipt.before,receipt.after,receipt.segments,receipt.full],[0,1,4,false]);
  assert.ok(receipt.shows);assert.equal(receipt.visibility,'keeper');assert.ok(!('on_full' in receipt));
  assert.ok(!(await k.table('status')).mechanics.some((row:Row)=>row.kind==='threat'));
  const after=clockNamed(await context(k));assert.equal(after.state,'1/4');assert.equal(after.symptom,receipt.shows);assert.notEqual(after.next,after.symptom);
  await k.table('apply',{call_id:'t1-c9',effects:[{kind:'npc',name:'Walter Corbitt',to:'commission-briefing',why:'the pressure list needs him in the room'}]});
  assert.equal((await k.table('capsule')).pressures.find((row:Row)=>row.kind==='threat').state,'1/4');
  await k.table('apply',{call_id:'t1-c3',effects:[{kind:'threat',name:'corbitt-haunting',clock:'corbitt-awareness',segments:3}]});
  const full=(await k.table('status')).receipts.find((row:Row)=>row.kind==='threat'&&row.after===4);
  assert.ok(full.full);assert.ok(full.on_full.startsWith('Corbitt commits to murder'));assert.ok(!('next' in clockNamed(await context(k))));
  await k.table('apply',{call_id:'t1-c4',effects:[{kind:'threat',name:'corbitt-haunting',clock:'corbitt-awareness',segments:4}]});
  assert.equal((await k.table('status')).receipts.find((row:Row)=>row.kind==='threat'&&row.call_id==='t1-c4').after,4);
});

test('test_a_threat_effect_names_what_it_could_not_find',async t=>{
  const k=await kernel(t);await openTurn(k);
  const unknown=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'threat',name:'the weather'}]});
  assert.equal(unknown.code,'invalid_params');assert.ok(unknown.details.options.includes('corbitt-haunting'));
  const ambiguous=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'threat',name:'corbitt-haunting'}]});
  assert.deepEqual(ambiguous.details.options.sort(),['corbitt-awareness','landlord-impatience']);
  const clockless=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'threat',name:'cult-residue'}]});
  assert.equal(clockless.code,'invalid_params');assert.ok(clockless.message.includes('no clock'));
  assert.ok(!('threat_clocks' in readJson(join(campaignDir(k.workspace),'world.json'))));
});

test('test_the_offer_ledger_counts_what_was_within_reach_against_what_the_turn_took',async t=>{
  const k=await kernel(t);await openTurn(k);const capsule=await k.table('capsule');
  const here=new Set<string>(capsule.mods.thread.lines.flatMap((line:Row)=>line.here.map((entry:Row)=>entry.clue)));
  const routes=new Set<string>(capsule.mods.thread.lines.flatMap((line:Row)=>line.next.map((entry:Row)=>entry.scene)));
  assert.ok(here.size&&routes.size);const clue=[...here].sort()[0];
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'clue',clue}]});await stop(k,'t1-c2');
  const ledger=readJsonl(join(campaignDir(k.workspace),'telemetry.jsonl')).find(row=>row.lane==='offers'&&row.turn===1)!;
  assert.equal(ledger.closed_by,'narrate');assert.ok(ledger.offered.includes(`clue-here:${clue}`));assert.ok(ledger.taken.includes(`clue-here:${clue}`));
  assert.ok([...routes].every(scene=>ledger.offered.includes(`route:${scene}`)));assert.ok(!ledger.taken.some((name:string)=>name.startsWith('route:')));
  assert.ok(ledger.taken.every((name:string)=>ledger.offered.includes(name)));await k.table('player_input',{text:'I continue asking.'});
  assert.ok((await k.table('capsule')).mods.thread.lines.flatMap((line:Row)=>line.next.map((entry:Row)=>entry.scene)).length);
});

test('test_an_offer_row_carries_both_what_it_costs_and_what_it_yields',async t=>{
  const k=await kernel(t);await openTurn(k);const capsule=await k.table('capsule');
  for(const line of capsule.mods.thread.lines){for(const entry of line.here)assert.ok(entry.gate&&entry.clue);for(const entry of line.next)assert.ok(entry.clues>=1&&entry.scene);}
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Walter Corbitt',to:'commission-briefing',why:'fixture'}]});
  for(const entry of (await context(k)).pacing.threat_clocks)assert.ok(entry.state&&(entry.next||entry.state.split('/')[0]===entry.state.split('/')[1]));
});

test('test_an_affordance_is_an_offer_once_it_names_what_it_yields',async t=>{
  const k=await kernel(t);await openTurn(k);const where=(await k.table('capsule')).where;
  const granted=Object.fromEntries(where.affordances.map((row:Row)=>[row.id,new Set((row.clues??[]).map((entry:Row)=>entry.clue))]));
  assert.deepEqual(granted['confirm-commission-terms'],new Set(['knott-commission']));
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'clue',clue:'knott-commission'}]});await stop(k,'t1-c2');
  const ledger=readJsonl(join(campaignDir(k.workspace),'telemetry.jsonl')).find(row=>row.lane==='offers'&&row.turn===1)!;
  assert.deepEqual(new Set(ledger.offered.filter((name:string)=>name.startsWith('affordance:'))),new Set(Object.keys(granted).map(name=>`affordance:${name}`)));
  assert.ok(ledger.taken.includes('affordance:confirm-commission-terms'));
  assert.ok(!ledger.taken.some((name:string)=>name.startsWith('affordance:')&&name!=='affordance:confirm-commission-terms'));
});
