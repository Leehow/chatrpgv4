/** Prefetch (PI_COC_KP_PREFETCH=1): the foci the host asks, and the first step's bounded wait for them. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prefetchTargets,PREFETCH_FOCI} from '../../runtime/prefetch.ts';
import {PendingAnswers} from '../../extensions/kernel/source-answers.ts';

const capsule={where:{scene:'harbour',exits:[{to:'church',display_name:'圣玛丽教堂'},{to:'cellar'}]},
 present:[{ref:'npc_1',display_name:'港务长'}],npc_references:{people:[{ref:'npc_2',display_name:'哈尔牧师'}]},
 documents_in_reach:{rows:[{name:'航海日志',holder:'Mara',reach:'investigator'}]}};

test('the current place first, then the one issued name the words carry, longest first, at most two',()=>{
 assert.deepEqual(prefetchTargets(capsule,'我去圣玛丽教堂找哈尔牧师'),[{focus:'harbour',kind:'scene'},{focus:'church',kind:'place'}]);
 assert.deepEqual(prefetchTargets(capsule,'我翻看航海日志'),[{focus:'harbour',kind:'scene'},{focus:'航海日志',kind:'document'}]);
 assert.deepEqual(prefetchTargets(capsule,'我四处看看'),[{focus:'harbour',kind:'scene'}],'no name: the place only');
 assert.ok(prefetchTargets(capsule,'港务长 哈尔牧师 航海日志').length<=PREFETCH_FOCI);
});

test('settle waits for this input\'s prefetched answers only when asked to',async()=>{
 const answers=new PendingAnswers(()=>{});
 let land;const settled=new Promise(resolve=>{land=resolve;});
 answers.register('c',{focus:'harbour',question:'q'},5,undefined,settled,'answer','harbour',undefined,'o',true);
 const plain=await answers.settle('c',{scene:'harbour',turn:5,ms:50});
 assert.deepEqual(plain.foci,[],'a same-turn ask is not waited for without prefetch');
 setTimeout(()=>land({source_answer:{status:'landed',excerpts:[]}}),20);
 const waited=await answers.settle('c',{scene:'harbour',turn:5,ms:500,prefetch:true});
 assert.deepEqual(waited.foci,['harbour']);assert.equal(waited.landed,1);
});

test('prefetch is on by provider: grok-build by default, every provider with 1, none with 0',async()=>{
 const {prefetchEnabled}=await import('../../runtime/prefetch.ts');
 const keep={flag:process.env.PI_COC_KP_PREFETCH,list:process.env.PI_COC_KP_PREFETCH_PROVIDERS};
 try{
  delete process.env.PI_COC_KP_PREFETCH;delete process.env.PI_COC_KP_PREFETCH_PROVIDERS;
  assert.equal(prefetchEnabled('grok-build'),true);assert.equal(prefetchEnabled('minimax-cn'),false);assert.equal(prefetchEnabled(undefined),false);
  process.env.PI_COC_KP_PREFETCH='1';assert.equal(prefetchEnabled('minimax-cn'),true);
  process.env.PI_COC_KP_PREFETCH='0';assert.equal(prefetchEnabled('grok-build'),false);
  delete process.env.PI_COC_KP_PREFETCH;process.env.PI_COC_KP_PREFETCH_PROVIDERS='minimax-cn';assert.equal(prefetchEnabled('grok-build'),false);
 }finally{for(const [key,name] of [['flag','PI_COC_KP_PREFETCH'],['list','PI_COC_KP_PREFETCH_PROVIDERS']]){if(keep[key]===undefined)delete process.env[name];else process.env[name]=keep[key];}}
});
