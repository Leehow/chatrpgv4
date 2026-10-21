/** Real TS RPC transactions, not live-play evidence (contract §250.10). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {kernel,opening,receipts,campaignDir,readJson} from './rules-rpc-support.ts';
const world=(k:any)=>readJson(join(campaignDir(k.workspace),'world.json'));
const apply=(k:any,call_id:string,...effects:any[])=>k.table('apply',{call_id,effects});

test('an establish beside the book\'s own clue name obtains that clue with the book\'s content and reports the repair (live el-v2-20261021e T20)',async t=>{
  const k=await kernel(t);await opening(k,'我仔细听诺特讲他查到的线索。');
  await apply(k,'t1-c1',{kind:'clue',clue:'knott-research-leads',how:'诺特一条条讲给他听。',establish:{summary:'诺特口述的几条查访方向。'}});
  const rows=(await receipts(k)).filter((r:any)=>r.kind==='clue'&&r.clue==='knott-research-leads');assert.equal(rows.length,1);
  assert.deepEqual(rows[0].adjusted,[{field:'establish',reason:'authored_clue_kept'}]);
  assert.equal(rows[0].established,undefined,'the book\'s clue is not re-established by the table');
  assert.notEqual(rows[0].summary,'诺特口述的几条查访方向。','the book\'s content stands');
  assert.ok(world(k).discovered_clues.includes('knott-research-leads'));
});

test('a new name with establish is still a table clue, without a repair',async t=>{
  const k=await kernel(t);await opening(k,'我翻看诺特桌上的剪报。');
  await apply(k,'t1-c1',{kind:'clue',clue:'cut-out-notices',how:'他逐页翻看。',establish:{summary:'几份剪报的公告栏都被裁去了一条。'}});
  const row=(await receipts(k)).find((r:any)=>r.kind==='clue'&&r.clue==='cut-out-notices');
  assert.equal(row.established,'table');assert.equal(row.adjusted,undefined);
});
