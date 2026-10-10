import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyEnabled,historyContext,historyNeed,HISTORY_NEED,HISTORY_INTERRUPTION,HISTORY_OFFER} from '../../runtime/historical-reference.ts';
import {readFileSync} from 'node:fs';
test('native reference retains authored setting and needs both useful detail and no immediate interruption',()=>{
 const capsule={historical_setting:{era:'1937',background:'Authored fiction'},where:{scene:'archive'},mods:{active:[{id:'historical-reference'}]}};
 assert(historyEnabled(capsule));assert.equal(historyContext(capsule).scenario.background,'Authored fiction');
 const answer=(needed,urgent)=>({answers:{[HISTORY_NEED]:{status:'answered',type:'noul',noul:needed},[HISTORY_INTERRUPTION]:{status:'answered',type:'noul',noul:urgent}}});
 assert(historyNeed(answer(.9,.1)));assert(!historyNeed(answer(.9,.9)));assert(!historyNeed({answers:{}}));
 assert.match(HISTORY_OFFER,/ordinary game tools/);
});
test('shipped reference has no external credential, library or historical lookup instruction',()=>{
 const manifest=JSON.parse(readFileSync('mods/historical-reference/mod.json','utf8'));
 assert.equal(manifest.host_settings,undefined);
 assert.equal(manifest.version,'1.3.0');
 const source=readFileSync('extensions/kernel/tools.ts','utf8');assert(!source.includes('"historical_reference"'));
});
