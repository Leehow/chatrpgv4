import test from 'node:test';import assert from 'node:assert/strict';
import {locationToolDeclarations} from '../../extensions/table/location-context.ts';
import {NativePlaceParameters} from '../../shared/place-structures.ts';
const tool={name:'place',description:'Choose a location action. Exact fields are supplied by {action:"inspect",need:"contract"}. Retain successful receipts.',parameters:NativePlaceParameters};
test('a demand-expanded declaration names already supplied grammar and keeps actual operations',()=>{
 const before=structuredClone(tool),full=locationToolDeclarations([tool],true)[0];
 assert.match(full.description,/parameters are already declared/);assert.match(full.description,/Retain successful receipts/);
 assert(!full.description.includes('Exact fields are supplied by'));
 assert.match(full.parameters.properties.action.description,/All nested location fields are declared/);
 assert(!full.parameters.properties.action.description.includes('Inspect need contract gives nested fields'));
 assert.deepEqual(full.parameters.anyOf.map(b=>b.properties.action.const),NativePlaceParameters.anyOf.map(b=>b.properties.action.const));
 assert(full.parameters.properties.additions);assert(full.parameters.properties.facts);assert(full.parameters.properties.spot);
 assert.deepEqual(tool,before,'the registered validator and original description remain intact');
});
test('the compact entry retains contract discovery and original metadata shape',()=>{
 const entry=locationToolDeclarations([tool],false)[0];assert.equal(entry.description,tool.description);
 assert.match(entry.parameters.properties.action.description,/Inspect need contract gives nested fields/);
 const {description:unused,...withoutDescription}=tool;
 assert.equal(Object.hasOwn(locationToolDeclarations([withoutDescription],false)[0],'description'),false);
});
