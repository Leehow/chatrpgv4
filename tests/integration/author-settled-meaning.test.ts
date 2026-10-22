/** Real TS RPC delivery preparation with synthetic receipts; not live-play evidence (contract §253.2). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir} from './support.ts';

test('the sole author receives what each settlement was for (live el-v2-20261021e T23/T25, el-v2-20261021f T18)',async t=>{
 const k=await kernel(t);await openTurn(k);
 const file=join(campaignDir(k.workspace),'turn.json'),turn=JSON.parse(readFileSync(file,'utf8'));
 const check={goal:'Find Corbitt in the bound clippings',stakes:{on_success:'Find Corbitt in the bound clippings',on_failure:'Half a day yields nothing usable'}};
 turn.receipts=[...turn.receipts,
  {id:'roll:library-use-t1-c1',kind:'roll',call_id:'t1-c1',skill:'Library Use',level:'failure',passed:false,visibility:'public',pushed:false,check},
  {id:'time:t1-c2',kind:'time',call_id:'t1-c2',minutes:240,why:'Searching the bound clippings for Corbitt',basis:'stated'},
  {id:'roll:san-t1-c3',kind:'roll',call_id:'t1-c3',skill:'SAN',level:'failure',passed:false,visibility:'public',source:'The empty bed frame lunges at him'},
  {id:'delta:san-t1-c3',kind:'delta',call_id:'t1-c3',resource:'san',subject_label:'Thomas',before:55,after:54,subject_is_investigator:true},
  {id:'roll:damage-t1-c4',kind:'roll',form:'dice',call_id:'t1-c4',skill:'damage',visibility:'public',why:'The bed frame clips his shoulder'},
  {id:'delta:hp-t1-c4',kind:'delta',call_id:'t1-c4',resource:'hp',subject_label:'Thomas',before:12,after:10,subject_is_investigator:true,source_receipt:'roll:damage-t1-c4'},
  {id:'delta:hp-t1-c5',kind:'delta',call_id:'t1-c5',resource:'hp',subject_label:'PRIVATE_NPC',before:9,after:7,subject_is_investigator:false},
  {id:'clue:bed-t1',kind:'clue',call_id:'t1-c6',clue:'poltergeist-bed',summary:'KEEPER_SECRET',how:'He watched the bed rise by itself'}];
 writeFileSync(file,JSON.stringify(turn));
 const settled=(await k.table('delivery.check',{})).settled_results;
 assert.deepEqual(settled.checks[0],{kind:'roll',skill:'Library Use',passed:false,level:'failure',goal:check.goal,on_failure:check.stakes.on_failure});
 assert.equal(settled.checks[1].cause,'The empty bed frame lunges at him');
 assert.deepEqual(settled.elapsed,[{minutes:240,why:'Searching the bound clippings for Corbitt'}]);
 assert.deepEqual(settled.changes,[{resource:'san',who:'Thomas',before:55,after:54,cause:'The empty bed frame lunges at him'},
  {resource:'hp',who:'Thomas',before:12,after:10,cause:'The bed frame clips his shoulder'}]);
 assert.deepEqual(settled.clues,[{how:'He watched the bed rise by itself'}]);
 const bytes=JSON.stringify(settled);for(const hidden of ['KEEPER_SECRET','PRIVATE_NPC','roll:library-use-t1-c1'])assert.ok(!bytes.includes(hidden),hidden);
});
