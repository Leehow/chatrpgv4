/** Native protocol evidence only; controlled provider calls are not gameplay acceptance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Type} from 'typebox';
import {Value} from 'typebox/value';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {normalizeToolArgumentSyntax} from '../../runtime/tool-argument-syntax.ts';
import {COC_TOOLS,effectShapeRefusal} from '../../extensions/kernel/tools.ts';
import {openTable} from './harness.mjs';

const schema=COC_TOOLS.find(tool=>tool.name==='apply').parameters;
const price={name:'Coffee',quantity:2,unit_price:'0.35'};
test('one schema walk restores native cash and continuity arrays without interpreting their content',()=>{
 const input={effects:{item:[{kind:'cash',items:{item:{item:[price]}}},{kind:'note',name:'Journey',text:'Ask about the road.',entities:{item:['Reporter','Clerk']}}]}};
 const saved=JSON.stringify(input),result=normalizeToolArgumentSyntax(schema,input);
 assert.equal(result.repairs,3);assert.ok(Value.Check(schema,result.args));
 assert.deepEqual(result.args.effects[0].items,[price]);assert.deepEqual(result.args.effects[1].entities,['Reporter','Clerk']);
 assert.equal(effectShapeRefusal('apply',schema,result.args),undefined);
 assert.equal(JSON.stringify(input),saved);assert.equal(normalizeToolArgumentSyntax(schema,result.args).args,result.args);
});

test('invalid, extra-key, overdeep and stray-effect inputs remain refusals, never partial transactions',()=>{
 for(const items of [{item:[price],extra:'retain'},{item:'not a priced line'},{item:[{...price,quantity:0}]},{item:{item:{item:{item:{item:[price]}}}}}]){
  const input={effects:[{kind:'cash',items}]},result=normalizeToolArgumentSyntax(schema,input);
  assert.equal(result.args,input);assert.equal(result.repairs,0);assert.ok(!Value.Check(schema,result.args));
 }
 const stray={effects:[{kind:'cash'},price]};assert.equal(normalizeToolArgumentSyntax(schema,stray).args,stray);assert.ok(!Value.Check(schema,stray));
 const notArray=Type.Object({payload:Type.Object({item:Type.Array(Type.String())})});
 const body={payload:{item:['literal item field']}};assert.equal(normalizeToolArgumentSyntax(notArray,body).args,body);
 const ambiguous=Type.Union([Type.Object({values:Type.Array(Type.String())}),Type.Object({values:Type.Array(Type.String()),optional:Type.Optional(Type.String())})]);
 const input={values:{item:'value'}};assert.deepEqual(normalizeToolArgumentSyntax(ambiguous,input).args,{values:['value']},'overlapping anyOf branches converge to the same syntax');
 const conflicting=Type.Union([Type.Object({values:Type.Array(Type.String())}),Type.Object({values:Type.Unknown()})]);
 assert.equal(normalizeToolArgumentSyntax(conflicting,input).args,input,'different valid interpretations stay unchanged');
});

test('array bounds and duplicate item order survive exact envelope decoding',()=>{
 const schema=Type.Object({values:Type.Array(Type.String(),{minItems:1,maxItems:2})});
 assert.deepEqual(normalizeToolArgumentSyntax(schema,{values:{item:['same','same']}}).args.values,['same','same']);
 for(const value of [[],['a','b','c'],[false],null]){
  const input={values:{item:value}};assert.equal(normalizeToolArgumentSyntax(schema,input).args,input);
 }
});

test('the existing opt-in bounded integer grammar composes with nested array envelopes',()=>{
 const schema=Type.Object({commands:Type.Array(Type.Object({minutes:Type.Integer({minimum:1,maximum:60})}))});
 const input={commands:{item:{minutes:'45'}}};
 assert.equal(normalizeToolArgumentSyntax(schema,input).args,input,'ordinary tools gain no scalar coercion');
 const result=normalizeToolArgumentSyntax(schema,input,{boundedIntegers:true});
 assert.deepEqual(result.args,{commands:[{minutes:45}]});assert.equal(result.repairs,1);assert.equal(result.integerRepairs,1);
 for(const minutes of ['045',' 45','61','0','4.5e1']){
  const input={commands:{item:{minutes}}};assert.equal(normalizeToolArgumentSyntax(schema,input,{boundedIntegers:true}).args,input);
 }
});

test('the registered native apply boundary sends a wrapped continuity array once without a correction request',async t=>{
 const table=await openTable({responses:[
  fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'note',name:'Journey',text:'Ask about the road.',entities:{item:['Reporter','Clerk']}}]})],{stopReason:'toolUse'}),
  fauxAssistantMessage('The clerk waits.'),
 ]});t.after(()=>table.dispose());
 await table.session.prompt('I ask about the road.');
 const calls=table.kernelRequests().filter(row=>row.method==='table.apply'&&row.params.effects?.some(effect=>effect.name==='Journey'));
 assert.equal(calls.length,1);assert.deepEqual(calls[0].params.effects[0].entities,['Reporter','Clerk']);
 assert.equal(table.telemetry().filter(row=>row.lane==='arguments'&&row.event==='decision_array_normalized'&&row.tool==='apply').length,1);
});
