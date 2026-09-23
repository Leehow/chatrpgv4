/** Real Pi extension seams; scripted transport is a deterministic test, not a playtest. */
import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {assistantTexts, openTable, waitForIdle} from './harness.mjs';
import {writeDefensePreference, readDefensePreference, automaticDefense} from '../../runtime/combat-defense.ts';
const call = (name, params) => fauxAssistantMessage([fauxToolCall(name, params)], {stopReason:'toolUse'});
const attack = {intent:'combat', goal:'Stop the caretaker', method:'Strike with the crowbar', target:'Caretaker', weapon:'unarmed'};
const results = (table, name) => table.session.messages.filter(message => message.role === 'toolResult' && message.toolName === name);
const requests = (table, method) => table.kernelRequests().filter(entry => entry.method === method);
const narrate = () => call('narrate', {text:'The blow glances away.'});

test('needs_choice preserves candidate details and normalizes the selected decision', async t => {
  const table = await openTable({responses:[
    call('resolve',{action:{intent:'investigate',goal:'歧义',method:'Watch closely'}}),
    call('resolve',{action:{intent:'investigate',goal:'歧义',method:'Watch closely',decision:' psychology:observe-concealed '}}),
    narrate(), fauxAssistantMessage('Done'),
  ]}); t.after(()=>table.dispose());
  await table.session.prompt('Watch the caretaker');
  const [failed, passed] = results(table,'resolve');
  assert.equal(failed.isError,true);
  assert.equal(failed.details.coc_error.retryable,false);
  assert.equal(failed.details.coc_error.next,'change_input');
  assert.equal(failed.details.coc_error.details.candidates.length,2);
  assert.match(failed.content[0].text,/candidates:/);
  assert.equal(passed.isError,false);
  const resolves=requests(table,'table.resolve');
  assert.equal(resolves[0].params.call_id,'t1-c1');
  assert.equal(resolves[1].params.call_id,'t1-c2');
  assert.equal(resolves[1].params.action.decision,'psychology:observe-concealed');
});

test('missing weapon remains a needs refusal; a corrected attack uses a new identity',async t=>{
  const table=await openTable({responses:[call('resolve',{action:{...attack,weapon:undefined}}),
    call('resolve',{action:{...attack,weapon:' unarmed ',target:' Caretaker '}}),narrate(),fauxAssistantMessage('Done')]});
  t.after(()=>table.dispose()); await table.session.prompt('Strike the caretaker');
  const [failed]=results(table,'resolve');
  assert.equal(failed.isError,true); assert.equal(failed.details.coc_error.next,'change_input');
  assert.match(failed.content[0].text,/missing weapon/);
  const resolves=requests(table,'table.resolve');
  assert.equal(resolves[1].params.action.weapon,'unarmed'); assert.equal(resolves[1].params.action.target,'Caretaker');
});

for (const preference of ['dodge','fight_back']) test(`standing ${preference}: persisted authorization resolves once without ask or player input`,async t=>{
  const table=await openTable({responses:[call('resolve',{action:attack}),narrate(),fauxAssistantMessage('Done')]});
  t.after(()=>table.dispose());
  const campaign=requests(table,'table.open')[0].params.campaign;
  assert.equal(await readDefensePreference(table.workspace,campaign),'dodge');
  await writeDefensePreference(table.workspace,campaign,preference);
  assert.equal(await readDefensePreference(table.workspace,campaign),preference);
  assert.equal(await readDefensePreference(table.workspace,'another-campaign'),'dodge');
  await table.session.prompt('Strike the caretaker');
  const resolves=requests(table,'table.resolve');
  assert.equal(resolves.length,2);
  assert.equal(resolves[1].params.action.defense,preference);
  assert.equal(resolves[1].params.call_id,'t1-c2');
  assert.equal(resolves[1].params._standing_defense.attack_command_id,'t1-c1');
  assert.equal(requests(table,'table.ask').length,0);
  assert.equal(requests(table,'table.player_input').length,1);
  assert.equal(table.entries('coc-choice').length,0);
  assert.equal(table.entries('coc-mechanics')[0].mechanics.length,2);
  assert.equal(results(table,'resolve')[0].details.automatic_defense.outcome.kind,'combat');
  assert.equal(results(table,'resolve')[0].details.pending_choice,null);
  assert.equal(table.telemetry().filter(row=>row.lane==='standing-defense'&&row.ok).length,1);
  assert.equal(assistantTexts(table.session).at(-1),'The blow glances away.');
});

test('a corrupted preference fails visibly and never permits delivery or repeats the attack',async t=>{
  const table=await openTable({responses:[call('resolve',{action:attack}),narrate(),narrate(),fauxAssistantMessage('Do not deliver')]});
  t.after(()=>table.dispose());
  const campaign=requests(table,'table.open')[0].params.campaign;
  await writeFile(join(table.workspace,'.coc/campaigns',campaign,'defense-preference.json'),'{"defense":"none"}');
  await table.session.prompt('Strike the caretaker'); await waitForIdle(table.session);
  assert.equal(requests(table,'table.resolve').length,1);
  assert.equal(requests(table,'table.narrate').length,0);
  assert.equal(requests(table,'table.ask').length,0);
  assert.equal(results(table,'resolve')[0].isError,true);
});

test('a failed automatic resolve is surfaced once and cannot be retried by later delivery calls',async t=>{
  const table=await openTable({env:{FAKE_DEFENSE_FAIL:'1'},responses:[call('resolve',{action:attack}),narrate(),narrate(),fauxAssistantMessage('Do not deliver')]});
  t.after(()=>table.dispose());
  await table.session.prompt('Strike the caretaker'); await waitForIdle(table.session);
  assert.equal(requests(table,'table.resolve').length,2,'one attack and one defense attempt');
  assert.equal(requests(table,'table.narrate').length,0);
  assert.equal(results(table,'resolve')[0].isError,true);
  assert.match(results(table,'resolve')[0].content[0].text,/defense could not settle/);
  assert.equal(table.telemetry().filter(row=>row.lane==='standing-defense'&&!row.ok).length,1);
});

test('historical defense ask is refused while unrelated mechanics choices still reach ask',async t=>{
  const table=await openTable({responses:[call('ask',{kind:'mechanics',text:'Choose',options:['dodge','fight_back']}),
    call('ask',{kind:'mechanics',text:'The search failed.',options:['push','accept']}),fauxAssistantMessage('Done')]});
  t.after(()=>table.dispose()); await table.session.prompt('Search the desk');
  const asks=requests(table,'table.ask'); assert.equal(asks.length,1);
  assert.deepEqual(asks[0].params.options,['push','accept']);
  assert.equal(table.entries('coc-choice').length,1);
  assert.deepEqual(table.entries('coc-choice')[0].options,['push','accept']);
  assert.equal(requests(table,'table.resolve').length,0);
});

test('push and stakes still use the ordinary resolve path',async t=>{
  const action={intent:'investigate',goal:'Search again',method:'Empty the drawer',push:true,stakes:'The caretaker hears it'};
  const table=await openTable({responses:[call('resolve',{action}),narrate(),fauxAssistantMessage('Done')]});
  t.after(()=>table.dispose()); await table.session.prompt('Search again');
  assert.deepEqual(requests(table,'table.resolve')[0].params.action,action);
  assert.equal(results(table,'resolve')[0].details.outcome.kind,'push');
  assert.equal(table.telemetry().find(row=>row.tool==='resolve').outcome_kind,'push');
});

test('real TS attack, standing defense and narrated receipts form one extension turn',async t=>{
  const table=await openTable({realKernel:true,env:{COC_KERNEL_SEED:'9'},responses:[call('narrate',{text:'The investigation begins.'}),fauxAssistantMessage('Done')]});
  t.after(()=>table.dispose());
  await waitForIdle(table.session);
  table.faux.setResponses([
    ...['corbitt-house-ground','basement-rites','corbitt-confrontation'].map(to=>call('apply',{effects:[{kind:'move',to}]})),
    call('resolve',{action:{intent:'combat',goal:'Shoot',method:'Fire',target:'Walter Corbitt',weapon:'.38 Revolver'}}),
    call('resolve',{action:{intent:'combat',goal:'Stand',method:'',actor:'Walter Corbitt',defense:'none'}}),
    call('resolve',{action:{intent:'combat',goal:'Attack',method:'',actor:'Walter Corbitt',target:'thomas-hayes'}}),
    narrate(),fauxAssistantMessage('Done'),
  ]);
  await table.session.prompt('I confront Corbitt and fire.'); await waitForIdle(table.session);
  const resolved=results(table,'resolve');
  assert.equal(resolved.length,3,JSON.stringify(resolved.map(row=>row.details)));
  for(const result of resolved) assert.equal(result.isError,false,JSON.stringify(result));
  assert.equal(resolved[0].details.automatic_defense,undefined,'NPC defenses remain Keeper decisions');
  assert.equal(resolved[2].details.automatic_defense.outcome.status,'resolved');
  assert.equal(resolved[2].details.automatic_defense.outcome.defense,'dodge');
  assert.equal(table.entries('coc-choice').length,0);
  assert.ok(table.entries('coc-mechanics').flatMap(row=>row.mechanics).some(row=>row.skill==='Dodge'));
  assert.equal(table.telemetry().filter(row=>row.lane==='standing-defense'&&row.ok).length,1);
});

test('only current player pending attacks qualify; firearms use legal dodge',()=>{
  const session={kind:'combat',status:'active',pending_defense:{for:'player',actor:'Investigator',attack_command_id:'t1-c1',revision:3,options:['dodge','fight_back']}};
  assert.equal(automaticDefense(session,'fight_back').action.defense,'fight_back');
  assert.equal(automaticDefense({...session,pending_defense:{...session.pending_defense,options:['dodge','none']}},'fight_back').action.defense,'dodge');
  assert.equal(automaticDefense({...session,pending_defense:{...session.pending_defense,for:'npc'}},'dodge'),undefined);
  assert.equal(automaticDefense({...session,status:'ended'},'dodge'),undefined);
  assert.equal(automaticDefense({pending_choice:{kind:'mechanics',options:['dodge']}},'dodge'),undefined);
  assert.equal(automaticDefense(null,'dodge'),undefined);
});
