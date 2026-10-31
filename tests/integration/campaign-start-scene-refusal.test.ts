/** A start_scene that names no authored opening is refused with the openings that would be accepted (live 1031b setup). */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,MODULE,PREGEN} from './support.ts';

test('an unknown start_scene is refused with the authored openings as candidates, and one of them is accepted', async t => {
 const k = await kernel(t);
 const refused = await k.err('campaign.create', {id: 'c1', module: MODULE, pregen: PREGEN, play_language: 'zh-Hans', start_scene: 'a-scene-the-book-does-not-open-on'});
 assert.equal(refused.code, 'invalid_params');
 assert.match(refused.message, /authored opening/);
 const candidates = refused.details?.candidates;
 assert.ok(Array.isArray(candidates) && candidates.length > 0, 'the openings are listed');
 assert.ok(candidates.every((row: any) => typeof row.scene === 'string' && row.scene && typeof row.name === 'string'), 'each with its scene id and name');
 assert.match(refused.fix, /details\.candidates/);
 const created = await k.ok('campaign.create', {id: 'c1', module: MODULE, pregen: PREGEN, play_language: 'zh-Hans', start_scene: candidates[0].scene});
 assert.ok(created, 'a listed candidate is accepted');
});
