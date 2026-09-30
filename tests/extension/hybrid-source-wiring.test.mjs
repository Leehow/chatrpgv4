import {selectLoopEngine} from '../../runtime/loop-engine.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceReadReuseKey} from '../../runtime/jev/hybrid-engine.ts';
test('pre-read reuse binds the source generation and player need, not just the scene',()=>{
 assert.equal(sourceReadReuseKey('dock','v1','read letter'),sourceReadReuseKey('dock','v1','read letter'));
 assert.notEqual(sourceReadReuseKey('dock','v1','read letter'),sourceReadReuseKey('dock','v2','read letter'));
 assert.notEqual(sourceReadReuseKey('dock','v1','read letter'),sourceReadReuseKey('dock','v1','identify sender'));
});

test('normal play keeps hybrid without credentials; setup and explicit controls keep their own selection',()=>{
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture'},'play'),'hybrid-v1');
 assert.equal(selectLoopEngine({},'play'),'hybrid-v1');
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture',PI_COC_TASK_RUNTIME:'1'},'play'),'legacy');
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture',PI_COC_LOOP_ENGINE:'legacy'},'play'),'legacy');
 // §151.6: setup is driven too when Jev is available, on its own policy (tests/extension/setup-driven-engine.test.mjs).
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture'},'setup'),'hybrid-v1');
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture',PI_COC_LOOP_ENGINE:'legacy'},'setup'),'legacy');
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture',PIPIUI_SPAWN_CONTRACT:'v1',PIPIUI_MOUNTED_EXTENSIONS:''},'play'),'hybrid-v1');
});
