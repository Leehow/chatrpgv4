import test from 'node:test';
import assert from 'node:assert/strict';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {COC_TOOLS,effectShapeRefusal} from '../../extensions/kernel/tools.ts';
const apply=COC_TOOLS.find(tool=>tool.name==='apply');
const malformed={effects:[{kind:'cash',mode:'quote',quote:'Inspection',category:'purchase',source:'quote',with:'Mechanic',items:{item:{name:'Inspection',quantity:'1',unit_price:'20.00'}}}]};
test('native rejected cash array shape identifies its actual field before the effect union dump',()=>{
  assert.throws(()=>validateToolArguments(apply,{type:'toolCall',id:'bad-array',name:'apply',arguments:malformed}),/Validation failed/);
  const before=JSON.stringify(malformed);
  const refusal=effectShapeRefusal('apply',apply.parameters,malformed);
  assert.equal(refusal?.details.field,'effects[0].items');
  assert.match(refusal.fix,/JSON array/);
  assert.match(refusal.fix,/Nothing in this call was written/);
  assert.equal(JSON.stringify(malformed),before);
});
test('schema array guidance covers other effect kinds and leaves valid arrays and SDK scalar conversion alone',()=>{
  const invalid={effects:[{kind:'note',name:'Visit',text:'The mechanic is nearby.',entities:{item:['Mechanic']}}]};
  assert.equal(effectShapeRefusal('apply',apply.parameters,invalid)?.details.field,'effects[0].entities');
  const valid=structuredClone(malformed);valid.effects[0].items=[valid.effects[0].items.item];
  assert.equal(effectShapeRefusal('apply',apply.parameters,valid),undefined);
  assert.equal(effectShapeRefusal('apply',apply.parameters,{effects:[{kind:'time',minutes:'10'}]}),undefined);
  assert.equal(effectShapeRefusal('resolve',apply.parameters,malformed),undefined);
});

test('registered native preparation refuses the whole malformed batch with array guidance before kernel mutation',async t=>{
  const {fauxAssistantMessage,fauxToolCall}=await import('@earendil-works/pi-ai');
  const {openTable,waitForIdle}=await import('./harness.mjs');
  const invalid=structuredClone(malformed);invalid.effects[0].items.item.quantity='0';
  const table=await openTable({responses:[
    fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:3},...invalid.effects]})],{stopReason:'toolUse'}),
    fauxAssistantMessage([{type:'text',text:'{{public}}The mechanic waits for your decision.'}],{stopReason:'stop'}),
  ]});
  t.after(()=>table.dispose());await table.session.prompt("Ask the mechanic for a quote.");await waitForIdle(table.session);
  const result=table.session.messages.find(m=>m.role==='toolResult'&&m.toolName==='apply');
  assert.equal(result?.isError,true);
  assert.match(result.content.map(c=>c.text||'').join('\n'),/effects\[1\]\.items.*JSON array/);
  assert.equal(table.kernelRequests().filter(r=>r.method==='table.apply').length,0);
});

test('misplaced semantic event and knowledge identify the existing event entry instead of suggesting a clue',()=>{
  for(const kind of ['event','knowledge']){
    const args={effects:[{kind,name:'Clinic report',actor:'Investigator',statement:'A patient needs identification.',mode:'heard',state:'uncertain'}]};
    const before=JSON.stringify(args),refusal=effectShapeRefusal('apply',apply.parameters,args);
    assert.equal(refusal?.code_detail,'effect_kind_unknown');
    assert.match(refusal.fix,/apply\.event/);
    assert.match(refusal.fix,/event\.knowledge/);
    assert.doesNotMatch(refusal.fix,/clue the book/);
    assert.equal(JSON.stringify(args),before);
  }
  const corrected={effects:[],event:{name:'Clinic report',knowledge:[{actor:'Investigator',statement:'A patient needs identification.',mode:'heard',state:'uncertain'}]}};
  assert.equal(effectShapeRefusal('apply',apply.parameters,corrected),undefined);
  assert.doesNotThrow(()=>validateToolArguments(apply,{type:'toolCall',id:'event-shape',name:'apply',arguments:corrected}));
});

test('native preparation rejects misplaced event before any otherwise valid effect mutates the kernel',async t=>{
  const {fauxAssistantMessage,fauxToolCall}=await import('@earendil-works/pi-ai');
  const {openTable,waitForIdle}=await import('./harness.mjs');
  const table=await openTable({responses:[
    fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:3},{kind:'event',name:'Clinic report'}]})],{stopReason:'toolUse'}),
    fauxAssistantMessage([{type:'text',text:'{{public}}The clerk waits for the corrected request.'}],{stopReason:'stop'}),
  ]});
  t.after(()=>table.dispose());await table.session.prompt('Ask about the records.');await waitForIdle(table.session);
  const result=table.session.messages.find(m=>m.role==='toolResult'&&m.toolName==='apply');
  assert.equal(result?.isError,true);
  assert.match(result.content.map(c=>c.text||'').join('\n'),/apply\.event/);
  assert.equal(table.kernelRequests().filter(r=>r.method==='table.apply').length,0);
});
