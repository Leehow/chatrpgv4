/** Long Keeper thinking goes to its own notebook; the turn record keeps only lengths. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import * as driver from '../play/driver.ts';

test('only steps over the token line reach the notebook, inside the turn window', () => {
    const dir = mkdtempSync(join(tmpdir(), 'long-thinking-'));
    try {
        const events = join(dir, 'events.jsonl'), step = (at: string, thinking: string, output: number) => JSON.stringify({type: 'message_end', _recv_at: at, message: {role: 'assistant', usage: {output}, content: [{type: 'thinking', thinking}, {type: 'toolCall', name: 'move', arguments: {to: 'x'}}]}});
        writeFileSync(events, [step('2026-01-01T00:00:00Z', 'a'.repeat(9000), 3000), step('2026-01-01T00:01:00Z', 'b'.repeat(300), 100), step('2026-01-01T00:02:00Z', 'c'.repeat(9000), 3000), step('2026-01-01T00:09:00Z', 'd'.repeat(9000), 3000), 'not json'].join('\n'));
        const r = driver.turn_thinking(events, '2026-01-01T00:00:30Z', '2026-01-01T00:05:00Z');
        assert.deepEqual(r.stats.map(s => [s.step, s.chars, s.tools]), [[0, 300, ['move']], [1, 9000, ['move']]]);
        assert.deepEqual(r.long.map(b => [b.step, b.thinking[0]]), [[1, 'c']]);
        assert.ok(r.long[0].tokens > driver.LONG_THINKING_TOKENS && r.long[0].tokens <= 3000);
        assert.deepEqual(driver.turn_thinking(undefined, '', 'z'), {stats: [], long: []});
    } finally { rmSync(dir, {recursive: true, force: true}); }
});
