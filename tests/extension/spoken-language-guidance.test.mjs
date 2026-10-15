/** Existing package examples must reach the single Keeper without a selector or writer call. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {api,root,temporary} from './object-usages-fixture.mjs';

test('native capsule carries bounded verbatim package examples in the existing instruction row',async t=>{
  const home=await mkdtemp(join(temporary,'spoken-'));
  const context=await api.createKernelContext({workspace:home,content:join(root,'content'),seed:'spoken-guidance',
    locks:api.createAdvisoryLocks(async()=>{}),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  const runtime=api.createKernelRuntime(context);t.after(()=>runtime.close());
  await runtime.handlers['campaign.create']({id:'spoken',module:'the-haunting',pregen:'thomas-hayes',play_language:'zh-Hans'});
  await runtime.handlers['table.open']({campaign:'spoken'});
  const capsule=await runtime.handlers['table.capsule']({campaign:'spoken'});
  const instruction=capsule.mods.instructions.find(row=>row.mod==='zh-optimize');
  const catalog=JSON.parse(await readFile(join(root,'mods/zh-optimize/expression-cards.json'),'utf8'));
  const examples=catalog.cards.slice(0,3).map(card=>card.examples[0]);
  assert.ok(instruction.instruction.includes(JSON.stringify(examples)),'authored language examples actually reach the Keeper');
  assert.ok(!instruction.instruction.includes(catalog.cards[3].examples[0].reply),'the full reference library is not copied');
  assert.ok(Buffer.byteLength(JSON.stringify(examples))<1800,'examples remain a small static addition');
  assert.equal(instruction.form,'full');
});
