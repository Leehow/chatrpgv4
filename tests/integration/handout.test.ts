/** Native counterparts of tests/kernel/test_handout.py. These are RPC fixtures, not live play. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {kernel,campaignDir,readJson,readJsonl,openTurn,type RpcClient} from './support.ts';

export const TEXT_HANDOUT='globe-unpublished-1918';
const REFERENCE_ONLY='the-haunting-handout-1-knott-commission';
const KEEPER_ONLY_ASSET='haunting-title-skull';
const world=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'world.json'));

test('test_handout_with_authored_text_is_materialized_and_rendered',async t=>{
  const k=await kernel(t);await openTurn(k);
  const result=await k.table('apply',{call_id:'t1-c1',effects:[{kind:'handout',name:TEXT_HANDOUT,label:'1918 年环球报未刊稿'}]});
  assert.deepEqual(result.receipts,[`handout:${TEXT_HANDOUT}-t1`]);
  const attachment=result.attachment,path=attachment.path;
  assert.equal(attachment.available,true);assert.equal(attachment.media_type,'text/markdown');
  assert.ok(statSync(path).isFile());assert.equal(dirname(path),join(campaignDir(k.workspace),'handouts'));
  assert.ok(readFileSync(path,'utf8').startsWith('# '));assert.deepEqual(result.attachments,[attachment]);
  assert.deepEqual(world(k).handouts_shown,[TEXT_HANDOUT]);
  const receipt=(await k.table('status')).receipts[0];
  assert.equal(receipt.kind,'handout');assert.equal(receipt.label,'1918 年环球报未刊稿');assert.equal(receipt.visibility,'player-safe');
  const events=readJsonl(join(campaignDir(k.workspace),'events.jsonl')).filter(e=>e.type==='handout-shown');
  assert.equal(events.length,1);assert.equal(events[0].receipt,`handout:${TEXT_HANDOUT}-t1`);
  assert.equal(events[0].data.handout,TEXT_HANDOUT);assert.equal(events[0].data.attachment_available,true);
  const text='他把一张剪报推过来。\n\n你读了起来。';
  const narrated=await k.table('narrate',{call_id:'t1-c2',text});assert.equal(narrated.rendered_text,text);
  const row={kind:'handout',marker:`handout:${TEXT_HANDOUT}`,receipt:`handout:${TEXT_HANDOUT}-t1`,handout:TEXT_HANDOUT,
    name:receipt.name,document:'ready',label:'1918 年环球报未刊稿',path,media_type:'text/markdown',call:'t1-c1'};
  assert.deepEqual(narrated.mechanics,[{...row,text:narrated.mechanics[0].text}]);
  const projected=narrated.mechanics[0].text,source=readFileSync(path,'utf8');
  assert.equal(projected,source.slice(source.indexOf('\n')+1).trim());assert.ok(!projected.startsWith('#'));
});

test('test_handout_without_shipped_bytes_is_declared_unavailable_not_invented',async t=>{
  const k=await kernel(t);await openTurn(k);
  const result=await k.table('apply',{call_id:'t1-c1',effects:[{kind:'handout',name:"Handout 1: Mr. Knott's Commission"}]});
  assert.deepEqual(result.receipts,[`handout:${REFERENCE_ONLY}-t1`]);
  assert.equal(result.attachment.available,false);assert.equal(result.attachment.path,null);
  assert.ok(!existsSync(join(campaignDir(k.workspace),'handouts')));
  assert.ok(result.note.includes(REFERENCE_ONLY));assert.ok(result.note.includes('nothing to look at'));
  const narrated=await k.table('narrate',{call_id:'t1-c2',text:'诺特把委托书递过来。'});
  assert.deepEqual(narrated.mechanics,[{kind:'handout',marker:`handout:${REFERENCE_ONLY}`,receipt:`handout:${REFERENCE_ONLY}-t1`,
    handout:REFERENCE_ONLY,name:"Handout 1: Mr. Knott's Commission",document:'none',label:"Handout 1: Mr. Knott's Commission",call:'t1-c1'}]);
});

test('test_a_delivered_handout_says_nothing_about_a_missing_one',async t=>{
  const k=await kernel(t);await openTurn(k);
  const result=await k.table('apply',{call_id:'t1-c1',effects:[{kind:'handout',name:TEXT_HANDOUT}]});
  assert.equal(result.attachment.available,true);assert.ok(!('note' in result));
});

test('test_keeper_only_assets_and_unknown_names_do_not_write',async t=>{
  const k=await kernel(t);await openTurn(k);
  const error=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:5},{kind:'handout',name:KEEPER_ONLY_ASSET}]});
  assert.equal(error.code,'invalid_params');assert.equal(error.details.index,1);assert.equal(error.details.visibility,'keeper-only');
  assert.deepEqual(world(k).clock,{minutes:0});assert.ok(!('handouts_shown' in world(k)));
  const unknown=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'handout',name:'the-missing-card'}]});
  assert.equal(unknown.code,'unknown_entity');assert.ok('candidates' in unknown.details);
  assert.deepEqual((await k.table('status')).receipts,[]);
});

test('test_handout_replays_on_the_same_call_id',async t=>{
  const k=await kernel(t);await openTurn(k);
  const params={call_id:'t1-c1',effects:[{kind:'handout',name:TEXT_HANDOUT}]};
  const first=await k.table('apply',params),again=await k.table('apply',params);
  assert.equal(again.replayed,true);assert.deepEqual(again.receipts,first.receipts);
  assert.equal((await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'handout',name:REFERENCE_ONLY}]})).code,'idempotency_conflict');
  assert.equal(readJsonl(join(campaignDir(k.workspace),'events.jsonl')).filter(e=>e.type==='handout-shown').length,1);
});

test('test_handout_shows_up_in_the_scene_assets_the_capsule_lists',async t=>{
  const k=await kernel(t),result=await openTurn(k);
  assert.ok(result.capsule.where.assets.some((row:any)=>isDeepStrictEqual(row,{name:"Handout 1: Mr. Knott's Commission",kind:'handout'})));
  assert.equal(result.capsule.where.material,'ready');
});
