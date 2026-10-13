import {selectLoopEngine} from '../../runtime/loop-engine.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('normal play keeps hybrid without credentials; setup and explicit controls keep their own selection',()=>{
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture'},'play'),'hybrid-v1');
 assert.equal(selectLoopEngine({},'play'),'hybrid-v1');
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture',PI_COC_TASK_RUNTIME:'1'},'play'),'hybrid-v1');
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture',PI_COC_LOOP_ENGINE:'legacy'},'play'),'hybrid-v1');
 // §151.6: setup is driven too when Jev is available, on its own policy (tests/extension/setup-driven-engine.test.mjs).
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture'},'setup'),'hybrid-v1');
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture',PI_COC_LOOP_ENGINE:'legacy'},'setup'),'legacy');
 assert.equal(selectLoopEngine({EXT_JEV_APIKEY:'fixture',PIPIUI_SPAWN_CONTRACT:'v1',PIPIUI_MOUNTED_EXTENSIONS:''},'play'),'hybrid-v1');
});
