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

const tool = name => COC_TOOLS.find(spec => spec.name === name);
const call = (name, args) => validateToolArguments({name, description: '', parameters: tool(name).parameters}, {type: 'toolCall', id: 't1', name, arguments: args});

test('apply and narrate validate with their required fields alone; quotes stays optional on both', () => {
  assert.doesNotThrow(() => call('apply', {effects: [{kind: 'move', to: 'newspaper-morgue'}]}));
  assert.doesNotThrow(() => call('narrate', {text: '你到了报馆。'}));
  for (const name of ['apply', 'narrate'])
    assert.equal((tool(name).parameters.required ?? []).includes('quotes'), false, `${name}.quotes is optional`);
});
