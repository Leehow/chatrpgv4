import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {offeredTools} from '../../extensions/kernel/lean-apply.ts';
import {openingInstruction} from '../../extensions/kernel/opening-instruction.ts';
import {sameKeeperSystemPrompt} from '../../runtime/keeper-output-guidance.ts';

test('the actual owned same-Keeper prompt assigns speech and one final frame to this Keeper',()=>{
 const source=readFileSync(new URL('../../prompts/keeper.md',import.meta.url),'utf8');
 const prompt=sameKeeperSystemPrompt(source);
 assert.ok(source.includes('The isolated author chooses the actual words;'));
 assert.ok(!prompt.includes('The isolated author chooses the actual words;'));
 assert.ok(prompt.includes('speech material.text contains the exact public words you will use'));
 assert.ok(prompt.includes('After a public or reference prose reply, end the response.'));
 assert.ok(prompt.includes('Never append {{compose}}, an expression brief, a private envelope or a second frame.'));
 assert.ok(prompt.includes('start with the single version-1 JSON frame instead'));
 assert.ok(prompt.includes('Every event.materials entry requires explicit visibility'));
 assert.ok(prompt.includes('one exact known handle, name or alias'));
 assert.ok(prompt.includes('carry the selected route in via'));
 assert.equal(sameKeeperSystemPrompt('An unrelated custom system prompt'),'An unrelated custom system prompt');
});
for(const lean of ['0','1'])test(`isolated delivery has one format across tool descriptions and opening, lean=${lean}`,()=>{
 const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_ISOLATED_OUTPUT:'1',PI_COC_LEAN_APPLY:lean};
 const tools=offeredTools(COC_TOOLS,env);
 for(const name of ['apply','ask']){
  const description=tools.find(t=>t.name===name).description;
  assert.match(description,/\{\{compose\}\}/);
  assert.doesNotMatch(description,/\{\{public\}\}|no other author is called/);
 }
 const opening=openingInstruction({playLanguage:'en'},env);
 assert.match(opening,/\{\{compose\}\}.*private JSON/);
 assert.doesNotMatch(opening,/\{\{public\}\}/);
 const ordinary=offeredTools(COC_TOOLS,{...env,PI_COC_ISOLATED_OUTPUT:'0'});
 for(const name of ['apply','ask'])assert.match(ordinary.find(t=>t.name===name).description,/\{\{public\}\}/);
 assert.match(openingInstruction({playLanguage:'en'},{...env,PI_COC_ISOLATED_OUTPUT:'0'}),/\{\{public\}\}/);
});
