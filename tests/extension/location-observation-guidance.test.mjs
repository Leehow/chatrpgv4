/** Shipped package text, not live-play evidence. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('the shipped observation guidance agrees with complete fact preservation',()=>{
 const text=readFileSync(new URL('../../mods/enhanced-locations/agent.md',import.meta.url),'utf8');
 assert(!text.includes('Facts are at most six'));assert(!text.includes('short perceived fact'));
 assert.match(text,/Preserve all actual perceived facts in full and in order/);
});
