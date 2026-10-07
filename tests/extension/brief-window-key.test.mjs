// Contract §187.4: the host rebuilds the module brief when the reading window of the scene in play changes, because the
// brief's rosters are ordered by it. The window rides on the capsule's `_context` binding (`brief_window`).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {briefingKey} from '../../extensions/table/context-runtime.ts';

const binding = (window) => ({version: 1, campaign: 'c1', worldline: 'main', loop: 0, turn: 3, source_revision: 'a'.repeat(64),
    ...(window === undefined ? {} : {brief_window: window})});
const capsule = {mods: {instructions: [{mod: 'prose', version: '1.0.0', settings: {}, form: 'full'}]}};

test('a window change is a new brief key; the same window keeps it; no window keeps the key a book always had', () => {
    const dock = briefingKey(binding({first: 2, last: 149, chapters: ['Dock', 'Town']}), capsule);
    assert.equal(briefingKey(binding({first: 2, last: 149, chapters: ['Dock', 'Town']}), capsule), dock);
    assert.notEqual(briefingKey(binding({first: 150, last: 200, chapters: ['Far']}), capsule), dock);
    assert.equal(briefingKey(binding(null), capsule), briefingKey(binding(undefined), capsule), 'a book without a window keeps its old key');
    assert.notEqual(briefingKey(binding(null), capsule), dock);
});
