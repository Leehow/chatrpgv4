/** Lean reading without detail reads does not offer the book's detail preparation; a handed-back read is a technical receipt. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offeredTools} from '../../extensions/kernel/lean-apply.ts';
import {COC_TOOLS} from '../../extensions/kernel/tools.ts';
import {SOURCE_UNAVAILABLE_NOTE} from '../../shared/book-absence.ts';

const lookup=env=>offeredTools(COC_TOOLS,env).find(tool=>tool.name==='lookup');

test('lean reading without detail reads offers no material preparation; detail reads or full reading keep it',()=>{
 assert.equal(lookup({PI_COC_LEAN_READING:'1',EXT_JEV_APIKEY:'x'}).parameters.properties.material,undefined);
 assert.match(lookup({PI_COC_LEAN_READING:'1',EXT_JEV_APIKEY:'x'}).description,/not available/);
 assert.ok(lookup({PI_COC_LEAN_READING:'1',PI_COC_DETAIL_READS:'1',EXT_JEV_APIKEY:'x'}).parameters.properties.material);
 assert.ok(lookup({EXT_JEV_APIKEY:'x'}).parameters.properties.material);
});

test('the technical receipt forbids turning the failure into the fiction',()=>{
 assert.match(SOURCE_UNAVAILABLE_NOTE,/not something in the fiction/);assert.match(SOURCE_UNAVAILABLE_NOTE,/illegible/);
});
