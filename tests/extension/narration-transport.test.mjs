import test from 'node:test';
import assert from 'node:assert/strict';
import {narrationTransport} from '../../extensions/kernel/narration-transport.ts';

test('a complete escaped string envelope becomes raw narration exactly once',()=>{
  const prose='The pen is on the desk.\n"Put it down," Knott says.';
  assert.deepEqual(narrationTransport(JSON.stringify(prose)),{text:prose});
  const literal='The note contains the literal escape \\u0041.';
  assert.deepEqual(narrationTransport(JSON.stringify(literal)),{text:literal});
});
test('a quoted field fragment with its stray object delimiter is refused rather than shown',()=>{
  const fragment=JSON.stringify('\\u0054he pen stays on the desk.\\nKnott watches it.')+'}';
  assert.deepEqual(narrationTransport(fragment),{text:fragment,malformed:true});
});
test('prose, quoted speech and code examples are not transported as JSON',()=>{
  for(const text of ['"Put it down."','The note says \\u0041.','```json\n"\\u0041"\n```','The {object} is a clue.'])
    assert.deepEqual(narrationTransport(text),{text});
});
