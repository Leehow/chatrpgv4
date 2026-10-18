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
import {build} from 'esbuild';
const kernel = await build({entryPoints: ['kernel-ts/read/table-entities.ts'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent'});
const {validateEstablishment} = await import(`data:text/javascript;base64,${Buffer.from(kernel.outputFiles[0].text).toString('base64')}`);

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
    const fields = kind === 'move' ? ['summary', 'within'] : ['summary'];
    assert.deepEqual(Object.keys(schema.properties), fields);
    assert.equal(schema.additionalProperties, false);
    const summary = {summary: 'Evidence established at this table.'};
    assert.equal(Errors(schema, summary).length, 0);
    assert.equal(validateEstablishment(summary, fields), summary.summary);
    const invalid = {...summary, how: 'An extra nested field.'};
    assert.ok(Errors(schema, invalid).some(error => error.keyword === 'additionalProperties'));
    assert.throws(() => validateEstablishment(invalid, fields), /no fields other than/);
    assert.ok(Errors(schema, {summary: ''}).length);
    if (kind === 'move') for (const within of ['registered-place', null]) {
      assert.equal(Errors(schema, {...summary, within}).length, 0);
      assert.equal(validateEstablishment({...summary, within}, fields), summary.summary);
    }
  }
});
