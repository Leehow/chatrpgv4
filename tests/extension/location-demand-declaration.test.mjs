import test from 'node:test';import assert from 'node:assert/strict';
import {Check} from 'typebox/value';
import {locationToolDeclarations} from '../../extensions/table/location-context.ts';
import {NativePlaceParameters} from '../../shared/place-structures.ts';
const tool={name:'place',description:'Choose a location action. Exact fields are supplied by {action:"inspect",need:"contract"}. Retain successful receipts.',parameters:NativePlaceParameters};
// §250.3: every place field is declared in the place tool, so neither view rewrites the tool description or carries a second grammar.
test('a demand-expanded declaration keeps the tool description and actual operations',()=>{
 const before=structuredClone(tool),full=locationToolDeclarations([tool],true)[0],entry=locationToolDeclarations([tool],false)[0];
 assert.equal(full.description,tool.description);
 assert.equal(full.parameters.properties.action.description,entry.parameters.properties.action.description,'one action description in both views');
 assert.deepEqual(full.parameters.anyOf.map(b=>b.properties.action.const),NativePlaceParameters.anyOf.map(b=>b.properties.action.const));
 assert(full.parameters.properties.additions);assert(full.parameters.properties.facts);assert(full.parameters.properties.spot);
 assert.deepEqual(tool,before,'the registered validator and original description remain intact');
});
test('the compact entry retains contract discovery and original metadata shape',()=>{
 const entry=locationToolDeclarations([tool],false)[0];assert.equal(entry.description,tool.description);
 assert(Check(entry.parameters.properties.need,'contract'),'inspect need contract remains a declared read');
 assert(entry.parameters.properties.additions);assert(entry.parameters.properties.facts);assert(entry.parameters.properties.spot);
 const {description:unused,...withoutDescription}=tool;
 assert.equal(Object.hasOwn(locationToolDeclarations([withoutDescription],false)[0],'description'),false);
});
