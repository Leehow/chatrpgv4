import {test} from 'node:test';
import assert from 'node:assert/strict';
import {speechPass,sayRanges} from '../../kernel-ts/write/speech-pass.ts';

test('nested name-token speech repairs to one public speaker without brace residue',()=>{
 const input='{{say:{{name:Reception nurse}}}}Please sign here.{{/say}}';
 const resolve=name=>({npc:'nurse',name});
 const result=speechPass(input,resolve);
 assert.equal(result.text,'{{say:Reception nurse}}Please sign here.{{/say}}');
 assert.deepEqual(result.speech,[{who:{npc:'nurse',name:'Reception nurse'},text:'Please sign here.'}]);
 const span=sayRanges(input,resolve)[0];
 assert.equal(input.slice(span.start,span.end),'Please sign here.');
});
