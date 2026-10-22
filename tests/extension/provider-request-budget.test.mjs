import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'provider-request-budget-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {requestBudget,REQUEST_BYTES} from './extensions/table/context-policy.ts';",resolveDir:root},
    outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const {requestBudget,REQUEST_BYTES}=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));

test('MiniMax gets the larger request ceiling; other providers keep the default; configuration and the window still rule',t=>{
    const old=process.env.PI_COC_REQUEST_BYTES;delete process.env.PI_COC_REQUEST_BYTES;
    t.after(()=>{if(old===undefined)delete process.env.PI_COC_REQUEST_BYTES;else process.env.PI_COC_REQUEST_BYTES=old;});
    assert.equal(requestBudget(1000000,'minimax-cn'),768*1024);
    assert.equal(requestBudget(2000000,'grok-build'),REQUEST_BYTES);
    assert.equal(requestBudget(undefined,undefined),REQUEST_BYTES);
    assert.equal(requestBudget(200000,'minimax-cn'),400000,'a smaller known window clamps');
    process.env.PI_COC_REQUEST_BYTES='393216';
    assert.equal(requestBudget(1000000,'minimax-cn'),393216,'configuration overrides the provider default');
});
