/**
 * An object that adopts what its own batch defines, with `definition` left out: the host names the definition.
 * Blood Road (2026-10-02, turn 2): define "35毫米相机" + object adopt "35毫米相机" name "罗莎的35毫米相机", refused, resent.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fillObjectDefinitions} from '../../extensions/kernel/object-definition-fill.ts';

test('only an exact match with a definition of the same batch is filled', () => {
  const effects = [
    {kind: 'define', name: '35毫米相机', description: '一台相机'},
    {kind: 'object', adopt: '35毫米相机', name: '罗莎的35毫米相机', to: '罗莎·门德斯'},
    {kind: 'object', adopt: '旧皮卡', name: '罗莎的旧皮卡', to: '罗莎·门德斯'},
    {kind: 'object', adopt: '35毫米相机', name: 'x', definition: '别的定义'},
  ];
  assert.equal(fillObjectDefinitions(effects), 1);
  assert.equal(effects[1].definition, '35毫米相机');
  assert.equal(effects[2].definition, undefined, 'nothing in the batch defines it: the kernel refuses as before');
  assert.equal(effects[3].definition, '别的定义', 'a definition the Keeper gave is never replaced');
  assert.equal(fillObjectDefinitions([{kind: 'object', name: '手电筒'}, {kind: 'define', name: '手电筒'}]), 1, 'by its own name too');
  assert.equal(fillObjectDefinitions(undefined), 0);
});

test('the kernel extension fills before admission, only on the Keeper\'s own apply', () => {
  const source = readFileSync(new URL('../../extensions/kernel/index.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('const definitionsFilled = spec.name === "apply" && !host ? fillObjectDefinitions(params.effects) : 0;'));
  assert.ok(source.indexOf('fillObjectDefinitions(params.effects)') < source.indexOf('leaveOutUnknownOwed(params.effects'));
});
