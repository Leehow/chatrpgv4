/** Lossless request sharing; real provider compatibility remains a separate live gate. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {sharedOutputSchema,availableOutputSchema} from '../../runtime/provider-output-schema.ts';
import {turnPacketParameterSchema,turnPacketProviderPayload} from '../../runtime/turn-packet-prototype.ts';
const json=value=>JSON.parse(JSON.stringify(value));
function expand(schema){
 // Resolve references from the same JSON view that is walked: the wire is compared as serialized bytes.
 const definitions=json(schema).$defs??{};
 const visit=(value,stack=[])=>{
  if(Array.isArray(value))return value.map(child=>visit(child,stack));
  if(!value||typeof value!=='object')return value;
  if(value.$ref){assert.deepEqual(Object.keys(value),['$ref']);const name=value.$ref.slice('#/$defs/'.length);assert(value.$ref.startsWith('#/$defs/'));assert(!stack.includes(name),'generated references are nonrecursive');assert(Object.hasOwn(definitions,name));return visit(definitions[name],[...stack,name]);}
  return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$defs').map(([key,child])=>[key,visit(child,stack)]));
 };
 return visit(json(schema));
}
const bindings={entities:['npc_1','investigator_1','place_1'],people:['npc_1','investigator_1'],places:['place_1'],facts:['fact_1'],sources:['source_1']};
test('expanded wire equals every byte of the inline JSON structure across active bindings',()=>{
 for(const arrived of [false,true])for(const bound of [undefined,bindings,{...bindings,facts:[],sources:[],places:[]}]){
  const canonical=turnPacketParameterSchema(arrived,['momentary'],[],false,bound,true,[{handle:'momentary',covers:'One small gesture.'}]);
  const before=json(canonical),inline=availableOutputSchema(canonical),wire=sharedOutputSchema(inline);
  assert.deepEqual(expand(wire),json(inline));assert.deepEqual(json(canonical),before);
  assert(JSON.stringify(wire).length<JSON.stringify(inline).length*.65,'the real repeated location grammar shrinks substantially');
  const commands=[{kind:'place',action:'move',to:'here',spot:'quiet corner'},{kind:'place',action:'observe',to:'here',sense:'sight',access:'clear',scope:'The corner',facts:['An oak chair.']}];
  const cases=[{},null,{version:4},{version:4,commands},{version:4,commands:[...commands,{kind:'scene',service:'open',crowd:'unknown'}]}];
  for(const field of ['spot','at','relation','to','kind','action','extra'])for(const value of [null,'',3,true,[],{},'here'])cases.push({version:4,commands:[{...commands[0],[field]:value},{kind:'scene',service:'open',crowd:'unknown'}]});
  for(const value of cases)assert.equal(Check(wire,value),Check(canonical,value),JSON.stringify(value));
 }
});
test('preexisting reference scopes and provider data stay untouched',()=>{
 for(const key of ['$ref','$dynamicRef','$recursiveRef','$id','id','$anchor','$dynamicAnchor','$recursiveAnchor','$defs','definitions']){
  const schema={type:'object',properties:{a:{type:'string',[key]:'scope'},b:{type:'string'}},additionalProperties:false};
  assert.equal(sharedOutputSchema(schema),schema,key);
 }
 const legacy={type:'object',properties:{value:{type:'string',description:'x'.repeat(300)}},dependencies:{gate:{$ref:'#/properties/target'}}};
 const nested={type:'object',properties:{a:legacy,b:legacy,target:{type:'string'}}};
 assert.equal(sharedOutputSchema(nested),nested,'legacy dependency reference scope is also preserved');
 const schema=turnPacketParameterSchema(false,undefined,[],false,bindings,true),before=json(schema);
 const output={name:'output',parameters:{type:'object'}},search={type:'web_search'};
 const grok={model:'grok-4.5',input:[],tools:[search,output]},other={...grok,model:'unverified'};
 const wire=turnPacketProviderPayload(grok,schema);assert.deepEqual(expand(wire.tools[1].parameters),json(availableOutputSchema(schema)));
 assert.equal(wire.tools[0],search);assert.equal(wire.input,grok.input);assert.deepEqual(json(schema),before);assert.deepEqual(output.parameters,{type:'object'});
 assert.equal(turnPacketProviderPayload(other,schema).tools[1].parameters,schema);
 const messages={model:'grok-4.5',messages:[],tools:[{name:'output',input_schema:{type:'object'}}]};
 assert.equal(turnPacketProviderPayload(messages,schema).tools[0].input_schema,schema);
});
