import assert from 'node:assert/strict';
import {test} from 'node:test';
import {after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const temp=await mkdtemp(join(tmpdir(),'background-source-test-'));
after(()=>rm(temp,{recursive:true,force:true}));
await build({entryPoints:[resolve(import.meta.dirname,'../../kernel-ts/modules/background-source.ts')],outfile:join(temp,'api.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {backgroundSourceUnits,sourceUnitKey,sourceUnitPages}=await import(pathToFileURL(join(temp,'api.mjs')).href);
test('background units cover indexed ranges without treating gaps or unreadable pages as complete',()=>{
 const units=backgroundSourceUnits([{name:'Long chapter',pages:[[2,15]],state:'indexed'},
  {name:'Scanned uncertainty',pages:[[18,19]],state:'unreadable'},{name:'Long chapter',pages:[[2,15]],state:'indexed'}],20);
 assert.deepEqual(units.map(unit=>[unit.first,unit.last]),[[3,8],[9,14],[15,16]]);
 assert.deepEqual(units.flatMap(sourceUnitPages),Array.from({length:14},(_,i)=>i+3));
 assert.equal(new Set(units.map(sourceUnitKey)).size,3);
});

test('overlapping parent and child index ranges do not duplicate speculative reading or conceal unreadable ranges',()=>{
 const units=backgroundSourceUnits([{name:'Chapter',pages:[[0,9]],state:'indexed'},
  {name:'Room',pages:[[2,4]],state:'indexed'},{name:'Unreadable insert',pages:[[5,5]],state:'unreadable'}],10);
 assert.deepEqual(units,[{section:'Chapter',first:1,last:2},{section:'Room',first:3,last:5},{section:'Chapter',first:7,last:10}]);
 assert.equal(new Set(units.flatMap(sourceUnitPages)).size,9);
});
