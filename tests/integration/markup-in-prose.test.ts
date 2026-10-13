/** First-attempt delivery counterparts of tests/kernel/test_markup_in_prose.py. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,readJson,readJsonl,type RpcClient,type Row} from './support.ts';
const KNOTT='Steven Knott';
function record(k:RpcClient,turn:number){const root=join(campaignDir(k.workspace),'turns');return readdirSync(root).sort().filter(name=>name.endsWith('.json')).map(name=>readJson(join(root,name))).find(row=>row.turn===turn);}
const markupRows=(k:RpcClient)=>readJsonl(join(campaignDir(k.workspace),'telemetry.jsonl')).filter(row=>row.lane==='delivery'&&row.reason==='markup_in_prose');
const narrate=(k:RpcClient,call_id:string,text:string)=>k.table('narrate',{call_id,text});
async function deliveredFirst(k:RpcClient,text:string){await openTurn(k);const delivered=await narrate(k,'t1-c1',text),turn=record(k,1);return {delivered,turn,finding:turn.warnings.find((row:Row)=>row.kind==='markup_in_prose')};}

test('test_closing_tags_and_list_lines_deliver_on_the_first_attempt',async t=>{
  const k=await kernel(t);await openTurn(k);const delivered=await narrate(k,'t1-c1','The editor watches the door.</text>');
  assert.equal(delivered.rendered_text,'The editor watches the door.');assert.ok(!('markup_gate' in readJson(join(campaignDir(k.workspace),'turn.json'))));
  assert.ok(markupRows(k).every(row=>row.outcome==='delivered'));await k.table('player_input',{text:'I wait.'});
  const text='# The desk\n- The keys are on the floor.\n2. The deed is crooked.';assert.equal((await narrate(k,'t2-c1',text)).rendered_text,text);
  assert.ok(markupRows(k).every(row=>row.outcome==='delivered'));
});
test('test_ordinary_prose_and_the_hosts_own_markers_pass',async t=>{
  const k=await kernel(t);await openTurn(k);
  const text=`诺特站起来——又坐下。{{say:${KNOTT}}}「行……行了。」{{/say}}\n\n——门外有脚步声。\n\n他看了看表 - 十一点差五分 - 然后把手按在桌上。3 < 5，room #4 * two，a well-kept note.\n\n…窗外起风了。{{check:not-a-receipt}}`;
  const result=await narrate(k,'t1-c1',text);assert.ok(!result.rendered_text.includes('{{'));
  assert.ok(!(record(k,1).warnings??[]).some((row:Row)=>row.kind==='markup_in_prose'));assert.deepEqual(markupRows(k),[]);
});
test('test_a_matching_pair_around_the_whole_text_is_taken_off',async t=>{
  const k=await kernel(t),text=`<text>\n{{say:${KNOTT}}}「坐吧。」{{/say}}\n\n诺特把钥匙推过来。\n</text>\n`;
  const {delivered,turn,finding}=await deliveredFirst(k,text);assert.equal(delivered.rendered_text,'「坐吧。」\n\n诺特把钥匙推过来。');
  assert.equal(turn.text,`{{say:${KNOTT}}}「坐吧。」{{/say}}\n\n诺特把钥匙推过来。`);assert.ok(!(turn.marked_text??'').includes('<text>'));assert.equal(turn.speech.length,1);
  assert.equal(finding.quote,'<text>');assert.equal(finding.stripped,true);assert.deepEqual(markupRows(k).map(row=>row.stripped),[true]);
});
test('test_a_lone_opening_tag_first_and_a_host_marker_beyond_a_closing_tag_are_still_a_wrapper',async t=>{
  const k=await kernel(t),{delivered,finding}=await deliveredFirst(k,'<text>诺特把钥匙推过来。');
  assert.equal(delivered.rendered_text,'诺特把钥匙推过来。');assert.equal(finding.stripped,true);await k.table('player_input',{text:'我接过钥匙。'});
  assert.equal((await narrate(k,'t2-c1','你接过钥匙。</text>\n\n{{check:not-a-receipt}}')).rendered_text,'你接过钥匙。');
  const second=record(k,2);assert.ok(!second.text.includes('</text>'));assert.equal(second.warnings.find((row:Row)=>row.kind==='markup_in_prose').stripped,true);
});
test('test_a_tag_inside_the_prose_is_delivered_as_written',async t=>{
  const k=await kernel(t),text='诺特把<b>钥匙</b>推过来。',{delivered,turn,finding}=await deliveredFirst(k,text);
  assert.equal(delivered.rendered_text,text);assert.equal(turn.text,text);assert.equal(finding.quote,'<b>');assert.ok(!('stripped' in finding));
  assert.deepEqual(markupRows(k).map(row=>'stripped' in row),[false]);
});
test('test_a_list_line_and_a_wrapper_beside_one_are_delivered_as_written',async t=>{
  const k=await kernel(t),listed='诺特靠回椅背。\n\n- 钥匙躺在地板上。',{delivered,finding}=await deliveredFirst(k,listed);
  assert.equal(delivered.rendered_text,listed);assert.ok(!('stripped' in finding));await k.table('player_input',{text:'我看着地板。'});
  const mixed='<text>诺特靠回椅背。\n\n- 钥匙躺在地板上。</text>';assert.equal((await narrate(k,'t2-c1',mixed)).rendered_text,mixed);
  assert.ok(!('stripped' in record(k,2).warnings.find((row:Row)=>row.kind==='markup_in_prose')));
});
test('test_tags_that_are_not_a_frame_are_delivered_as_written',async t=>{
  const k=await kernel(t);await openTurn(k);
  for(const [turn,text] of [[1,'<text>诺特把钥匙推过来。</txt>'],[2,'诺特把钥匙推过来。<br/>'],[3,'<text>诺特把<b>钥匙</b>推过来。']] as const){
    if(turn>1)await k.table('player_input',{text:'我等着。'});assert.equal((await narrate(k,`t${turn}-c1`,text)).rendered_text,text);
    assert.ok(!('stripped' in record(k,turn).warnings.find((row:Row)=>row.kind==='markup_in_prose')));
  }
});
