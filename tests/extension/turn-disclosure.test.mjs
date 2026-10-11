import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'turn-disclosure-'));
await build({entryPoints:[join(root,'extensions/table/turn-disclosure.ts')],outfile:join(temp,'api.mjs'),bundle:true,
    format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));

const user={role:'user',content:'Wait until nine.'},brief={role:'custom',customType:'coc-context-brief'};
const clerk={role:'custom',customType:'coc-clerk'},tail={role:'custom',customType:'coc-capsule-update'};
const call=n=>({role:'assistant',content:'call '+n}),result=n=>({role:'toolResult',content:'result '+n});
const packet=keys=>({role:'custom',customType:'coc-capability-detail',content:keys.join(',')});
const placed=(ledger,messages,tailLength=1)=>ledger.place(messages,messages.length-tailLength);

test('§227.2 a disclosure keeps its place, so every earlier request is a prefix of the next',()=>{
    const ledger=api.createTurnDisclosure();ledger.forInput('input-1');
    const first=[brief,user,clerk,tail];
    const a=ledger.offer(['capability:time','section:s1'],ledger.count(first.slice(0,-1)),packet);
    const r1=placed(ledger,first);
    assert.deepEqual(r1,[brief,user,clerk,a,tail]);
    // The second request: the Keeper's call and its result followed; a new disclosure is due.
    const second=[brief,user,clerk,call(1),result(1),tail];
    const b=ledger.offer(['capability:time','capability:cash'],ledger.count(second.slice(0,-1)),packet);
    assert.equal(b.content,'capability:cash','a delivered key is never offered again');
    const r2=placed(ledger,second);
    assert.deepEqual(r2,[brief,user,clerk,a,call(1),result(1),b,tail]);
    assert.deepEqual(r2.slice(0,r1.length-1),r1.slice(0,-1),'the first request without its tail is a prefix');
    const third=[brief,user,clerk,call(1),result(1),call(2),result(2),tail];
    assert.equal(ledger.offer(['section:s1'],ledger.count(third.slice(0,-1)),packet),undefined);
    const r3=placed(ledger,third);
    assert.deepEqual(r3,[brief,user,clerk,a,call(1),result(1),b,call(2),result(2),tail]);
    assert.deepEqual(r3.slice(0,r2.length-1),r2.slice(0,-1));
});

test('§227.2 a withdrawn disclosure is due again; a new input starts empty',()=>{
    const ledger=api.createTurnDisclosure();ledger.forInput('input-1');
    const message=ledger.offer(['capability:cash'],0,packet);
    assert.equal(ledger.has('capability:cash'),true);
    ledger.withdraw(message);
    assert.equal(ledger.has('capability:cash'),false);
    assert.deepEqual(ledger.messages(),[]);
    assert.ok(ledger.offer(['capability:cash'],0,packet));
    ledger.forInput('input-1');assert.equal(ledger.has('capability:cash'),true,'the same input keeps its ledger');
    ledger.forInput('input-2');assert.equal(ledger.has('capability:cash'),false);
});

test('§227.3 owed keys stay owed until a result or a request carries them',()=>{
    const ledger=api.createTurnDisclosure();ledger.forInput('input-1');
    ledger.offer(['section:s1'],0,packet);
    ledger.owe(['section:s1','section:s2','capability:cash']);
    assert.deepEqual(ledger.owed(),['section:s2','capability:cash'],'what was delivered is not owed');
    ledger.attached(['capability:cash']);
    assert.deepEqual(ledger.owed(),['section:s2']);
    ledger.offer(['section:s2'],0,packet);
    assert.deepEqual(ledger.owed(),[]);
});

test('§227.3 what an input attached or owed before its first prepared request is kept',()=>{
    const ledger=api.createTurnDisclosure();ledger.clear();
    ledger.attached(['section:s1']);ledger.owe(['capability:cash']);
    ledger.forInput('input-1');
    assert.equal(ledger.has('section:s1'),true);assert.deepEqual(ledger.owed(),['capability:cash']);
});
