/**
 * A tool call that carries only a tool's required fields validates (2026-10-02).
 *
 * The quotation drafts (`b0114b08d`) gave `apply` a `quotes` field built by spreading the optional `narrate.quotes`
 * schema. The spread kept the shape and lost the optional mark, so `quotes` became required, and every apply without it
 * -- the clerk's move, the Keeper's ordinary write -- failed validation before reaching the kernel. 35 loop tests fell
 * over it while every quotation test passed.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {Errors} from 'typebox/value';
import {ClueEstablishment,PlaceEstablishment,NpcReunion} from '../../shared/apply-structures.ts';
import {build} from 'esbuild';
const kernel = await build({stdin: {contents: "export {validateEstablishment} from './kernel-ts/read/table-entities.ts'; export {acceptReunion} from './kernel-ts/npc/reunion.ts';",resolveDir:process.cwd()}, bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent'});
const {validateEstablishment,acceptReunion} = await import(`data:text/javascript;base64,${Buffer.from(kernel.outputFiles[0].text).toString('base64')}`);

const tool = name => COC_TOOLS.find(spec => spec.name === name);
const call = (name, args) => validateToolArguments({name, description: '', parameters: tool(name).parameters}, {type: 'toolCall', id: 't1', name, arguments: args});

test('apply and narrate validate with their required fields alone; quotes stays optional on both', () => {
  assert.doesNotThrow(() => call('apply', {effects: [{kind: 'move', to: 'newspaper-morgue'}]}));
  assert.doesNotThrow(() => call('narrate', {text: '你到了报馆。'}));
  for (const name of ['apply', 'narrate'])
    assert.equal((tool(name).parameters.required ?? []).includes('quotes'), false, `${name}.quotes is optional`);
});

test('establishment declarations share the kernel closed fields and place containment', () => {
  const effects = tool('apply').parameters.properties.effects.items.anyOf;
  for (const kind of ['move', 'clue']) {
    const schema = effects.find(effect => effect.properties.kind.enum?.includes(kind)).properties.establish;
    const owner = kind === 'move' ? 'scene' : 'clue';
    const fields = kind === 'move' ? ['summary', 'within'] : ['summary'];
    assert.equal(JSON.stringify(schema),JSON.stringify(kind==='move'?PlaceEstablishment:ClueEstablishment));
    assert.deepEqual(Object.keys(schema.properties), fields);
    assert.equal(schema.additionalProperties, false);
    const summary = {summary: 'Evidence established at this table.'};
    assert.equal(Errors(schema, summary).length, 0);
    assert.equal(validateEstablishment(summary, owner), summary.summary);
    const invalid = {...summary, how: 'An extra nested field.'};
    assert.ok(Errors(schema, invalid).some(error => error.keyword === 'additionalProperties'));
    assert.throws(() => validateEstablishment(invalid, owner), /no fields other than/);
    assert.ok(Errors(schema, {summary: ''}).length);
    if (kind === 'move') for (const within of ['registered-place', null]) {
      assert.equal(Errors(schema, {...summary, within}).length, 0);
      assert.equal(validateEstablishment({...summary, within}, owner), summary.summary);
    }
    assert.ok(Errors(schema,{summary:' \n\t'}).length);
    assert.throws(()=>validateEstablishment({summary:' \n\t'},owner),/nonempty summary/);
  }
});

test('reunion wire and canonical acceptance share closed codepoint and nonblank bounds',()=>{
 const effect=tool('apply').parameters.properties.effects.items.anyOf.find(effect=>effect.properties.kind.enum?.includes('npc'));
 assert.equal(JSON.stringify(effect.properties.reunion),JSON.stringify(NpcReunion));
 const graph={handle:()=> 'clerk',nameKeys:()=>['clerk','Clerk'],displayName:()=> 'Clerk'},node={node_id:'clerk-node'};
 const world=()=>({active_scene:'office',npc_presence:{clerk:'office'},clock:{minutes:20}});
 const records=[{turn:1,commit:'one',world:{active_scene:'office',npc_presence:{clerk:'office'},clock:{minutes:0}},speech:[{who:{npc:'clerk'},text:'Welcome.'}]},
  {turn:2,commit:'two',world:{active_scene:'road',npc_presence:{clerk:'office'},clock:{minutes:10}}}];
 for(const value of [{},{background:[],reports:[],open_threads:[]},{reports:['😀'.repeat(600)]},
  {background:[' Kept the shop open. '],reports:['Hello.'],extend:true}]){
  assert.equal(Errors(NpcReunion,value).length,0);
  assert.doesNotThrow(()=>acceptReunion(graph,world(),node,records,{},value,3));
 }
 for(const value of [{invented:true},{extend:'true'},{reports:['']},{reports:[' \n\t']},{reports:['😀'.repeat(601)]},{reports:['a','b','c','d','e']},{reports:'A report.'}]){
  assert.ok(Errors(NpcReunion,value).length,JSON.stringify(value));
  assert.throws(()=>acceptReunion(graph,world(),node,records,{},value,3),/reunion/i);
 }
});

test('the bounded activity, conditions and document divide audit closes only existing envelopes',()=>{
 const effects=tool('apply').parameters.properties.effects.items.anyOf;
 const effect=kind=>effects.find(schema=>schema.properties.kind.const===kind||schema.properties.kind.enum?.includes(kind));
 const npc=effect('npc');
 for(const schema of [effect('scene').properties.activity,npc.properties.activity]){
  assert.equal(schema.additionalProperties,false);
  const value={summary:'The local service is operating.',basis:'observed',...('wakefulness' in schema.properties?{wakefulness:'awake'}:{service:'open',crowd:'quiet'})};
  assert.equal(Errors(schema,value).length,0);assert.ok(Errors(schema,{...value,extra:true}).length);
  assert.ok(Errors(schema,{...value,summary:' \n '}).length);
 }
 const conditions=npc.properties.conditions;
 assert.equal(conditions.additionalProperties,false);assert.equal(Errors(conditions,{gained:['prone']}).length,0);
 assert.ok(Errors(conditions,{gained:['prone'],extra:true}).length);
 const document=effect('object').properties.document;
 const divide=document.anyOf.find(schema=>schema.properties.action?.const==='divide');
 assert.equal(divide.additionalProperties,false);const value={action:'divide',part_text:'Part.',remainder_text:'Remainder.'};
 assert.equal(Errors(divide,value).length,0);assert.ok(Errors(divide,{...value,extra:true}).length);
 assert.equal(Errors(document,value).length,0);
 assert.ok(Errors(document,{...value,text:'Another branch must not admit this.',presentation:'paper'}).length);
 assert.equal(Errors(document,{text:'A newly acquired note.',presentation:'paper'}).length,0);
});
