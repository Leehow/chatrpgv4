/**
 * JSONL rows are appended without being awaited (telemetry, lane rows), so a reader can land mid-append. The harness
 * reads only whole rows and settles in-flight appends after each prompt; a whole row that is corrupt still throws.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendJsonl} from '../../extensions/lanes/host.ts';
import {appendsSettled, completeJsonLines} from './harness.mjs';

test('a row still being appended is left for the next read; a whole corrupt row still throws', () => {
    assert.deepEqual(completeJsonLines('{"a":1}\n{"b":2}\n{"lane":"admis'), [{a: 1}, {b: 2}]);
    assert.deepEqual(completeJsonLines('{"a":1}\n'), [{a: 1}]);
    assert.deepEqual(completeJsonLines('{"lane":"admis'), [], 'a file with no whole row yet reads as empty');
    assert.deepEqual(completeJsonLines(''), []);
    assert.throws(() => completeJsonLines('{"a":1}\n{"broken\n'), SyntaxError);
});

test('appendsSettled waits for every append in flight, including one that starts while it waits', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'jsonl-appends-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const path = join(dir, 'nested', 'telemetry.jsonl');
    const rows = Array.from({length: 40}, (_, index) => ({lane: 'admission', index, padding: 'x'.repeat(2048)}));
    // Fire and forget, the way telemetry is recorded.
    for (const row of rows.slice(0, 20)) void appendJsonl(path, row);
    const late = new Promise(resolve => setImmediate(() => { for (const row of rows.slice(20)) void appendJsonl(path, row); resolve(); }));
    await late;
    await appendsSettled();
    const read = completeJsonLines(await readFile(path, 'utf8'));
    assert.deepEqual(read.map(row => row.index).sort((a, b) => a - b), rows.map(row => row.index));
    assert.equal(globalThis[Symbol.for('pi-coc.jsonl-appends-in-flight')].size, 0, 'nothing is left in flight');
});

test('a write that fails is swallowed and still leaves the in-flight set', async () => {
    await appendJsonl('/dev/null/cannot/exist.jsonl', {lane: 'x'});
    await appendsSettled();
    assert.equal(globalThis[Symbol.for('pi-coc.jsonl-appends-in-flight')].size, 0);
});
