/** Actual TS RPC jobs keep canonical event participants available outside the scene roster. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,symlinkSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {kernel,openTurn,CAMPAIGN,CONTENT_DIR,campaignDir,readJsonl} from './support.ts';

test('committed event participants are issued and accepted by the same memory job',async t=>{
  const client=await kernel(t);await openTurn(client,'I call Gabriela and Vittorio from the office.');
  const investigator=(await client.table('view')).investigators[0].name;
  const spoken='We heard your request and will telephone you tomorrow.';
  await client.table('apply',{call_id:'t1-c1',effects:[],event:{name:'Telephone conversation',summary:'Gabriela and Vittorio join the telephone conversation.',
    materials:[{name:'telephone-answer',kind:'speech',visibility:'player',speaker:'Gabriela Macario',audience:[investigator,'Vittorio Macario'],text:spoken}],
    knowledge:[{actor:'Vittorio Macario',source:'Gabriela Macario',statement:'Vittorio heard Gabriela agree to telephone tomorrow.',mode:'heard',state:'accurate',material:'telephone-answer'}],
    relationships:[{actor:'Gabriela Macario',toward:'Vittorio Macario',statement:'Gabriela accepted Vittorio as the other participant in this telephone conversation.',material:'telephone-answer'}]}});
  const delivered=await client.table('narrate',{call_id:'t1-c2',text:`Gabriela and Vittorio joined your telephone conversation. {{say:Gabriela Macario}}${spoken}{{/say}}`});
  const packet=await client.ok('memory.job',{campaign:CAMPAIGN,turn:delivered.turn});
  for(const name of ['Gabriela Macario','Vittorio Macario'])assert.ok(packet.known_entities.some((entity:any)=>entity.name===name&&entity.kind==='npc'),`${name} was already a canonical participant`);
  assert.equal(packet.present.includes('Gabriela Macario'),false,'identity availability must not invent physical presence');
  assert.equal(packet.present.includes('Vittorio Macario'),false,'a remote audience is not moved into this scene');
  const accepted=await client.ok('memory.submit',{campaign:CAMPAIGN,job_id:packet.job_id,candidates:[{
    kind:'knowledge',subject:'Gabriela Macario',knowers:[investigator,'Gabriela Macario','Vittorio Macario'],
    statement:'Gabriela and Vittorio joined the telephone conversation.',privacy:'player_safe',state:'accurate',confidence:0.9}]});
  assert.equal(accepted.candidates,1);
  const view=await client.ok('npc.perspective',{campaign:CAMPAIGN,name:'Gabriela Macario'});
  assert.ok(view.knowledge_reports.some((item:any)=>item.statement==='Gabriela and Vittorio joined the telephone conversation.'));
});

test('registered table aliases resolve while unrelated and ambiguous subjects remain atomically refused',async t=>{
  const content=mkdtempSync(join(tmpdir(),'memory-identity-content-'));t.after(()=>rmSync(content,{recursive:true,force:true}));
  for(const name of readdirSync(CONTENT_DIR))if(name!=='starters')symlinkSync(join(CONTENT_DIR,name),join(content,name));
  mkdirSync(join(content,'starters'));for(const name of readdirSync(join(CONTENT_DIR,'starters')))
    if(name!=='the-haunting')symlinkSync(join(CONTENT_DIR,'starters',name),join(content,'starters',name));
  const starter=join(content,'starters','the-haunting');mkdirSync(starter);
  for(const name of readdirSync(join(CONTENT_DIR,'starters','the-haunting')))if(name!=='module-graph.json')
    symlinkSync(join(CONTENT_DIR,'starters','the-haunting',name),join(starter,name));
  const graph=JSON.parse(readFileSync(join(CONTENT_DIR,'starters','the-haunting','module-graph.json'),'utf8'));
  for(const node of graph.nodes)if(['npc-gabriela-macario','npc-vittorio-macario'].includes(node.node_id))node.aliases.push('Shared contact');
  writeFileSync(join(starter,'module-graph.json'),JSON.stringify(graph));
  const client=await kernel(t,{content});await openTurn(client,'I contact the two witnesses by telephone.');
  await client.table('apply',{call_id:'t1-c1',effects:[{kind:'person',who:'Gabriela Macario',name:'The visitor with the blue scarf'}],
    event:{name:'Witness exchange',summary:'The two witnesses spoke by telephone.',
      knowledge:[{actor:'Gabriela Macario',source:'Vittorio Macario',statement:'Gabriela heard Vittorio identify himself.',mode:'heard',state:'accurate'}]}});
  const delivered=await client.table('narrate',{call_id:'t1-c2',text:'The two witnesses spoke by telephone.'});
  const packet=await client.ok('memory.job',{campaign:CAMPAIGN,turn:delivered.turn});
  const candidate={kind:'knowledge',subject:'The visitor with the blue scarf',knowers:['Gabriela Macario'],
    statement:'Gabriela heard Vittorio identify himself.',privacy:'keeper_only',state:'accurate',confidence:0.9};
  const path=join(campaignDir(client.workspace),'memory/candidates.jsonl'),before=readJsonl(path);
  for(const [name,expected]of [['Invented witness','not a known name'],['Walter Corbitt','not a known name'],['Shared contact','names 2 entities']]){
    const error=await client.err('memory.submit',{campaign:CAMPAIGN,job_id:packet.job_id,candidates:[candidate,{...candidate,subject:name}]});
    assert.equal(error.code,'invalid_params');assert.ok(error.message.includes(expected));assert.deepEqual(readJsonl(path),before);
  }
  const accepted=await client.ok('memory.submit',{campaign:CAMPAIGN,job_id:packet.job_id,candidates:[candidate]});
  assert.equal(accepted.candidates,1);const stored=readJsonl(path).at(-1);assert.ok(stored);assert.equal(stored.subject,'Gabriela Macario');
});

test('an issued participant identity does not publish an undelivered speech or its pending knowledge',async t=>{
  const client=await kernel(t);await openTurn(client,'I wait for the telephone call.');
  const investigator=(await client.table('view')).investigators[0].name;
  await client.table('apply',{call_id:'t1-c1',effects:[],event:{name:'Unspoken telephone reply',summary:'A telephone reply is prepared.',
    materials:[{name:'pending-answer',kind:'speech',visibility:'player',speaker:'Vittorio Macario',audience:['Gabriela Macario'],text:'PRIVATE_PENDING_ANSWER'}],
    knowledge:[{actor:'Gabriela Macario',source:'Vittorio Macario',statement:'PRIVATE_PENDING_KNOWLEDGE',mode:'heard',state:'accurate',material:'pending-answer'}]}});
  const delivered=await client.table('narrate',{call_id:'t1-c2',text:'You wait and hear no reply.'});
  const packet=await client.ok('memory.job',{campaign:CAMPAIGN,turn:delivered.turn});
  assert.ok(packet.known_entities.some((entity:any)=>entity.name==='Gabriela Macario'));
  assert.equal(packet.canonical_outcome.events[0].knowledge[0].status,'pending');
  assert.equal(packet.keeper_text.includes('PRIVATE_PENDING_ANSWER'),false);
  const perspective=await client.ok('npc.perspective',{campaign:CAMPAIGN,name:'Gabriela Macario'});
  assert.equal(perspective.cognition.some((item:any)=>item.statement==='PRIVATE_PENDING_KNOWLEDGE'),false);
});
