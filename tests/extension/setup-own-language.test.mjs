/**
 * The setup guide never calls the investigator's own tongue basic (2026-10-02).
 *
 * Two of three Blood Road setups told a new player that a Houston reporter's native English (Language (Own) 47, his
 * EDU) was "only basic" and that reading and conversation might be hard: the prompt's "a language listed at its base is
 * not fluency" was read onto Language (Own), whose base is EDU and which is native fluency (CoC 7e).
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('the setup prompt keeps "at its base is not fluency" to Language (Other) and says what Language (Own) at EDU is', () => {
  const prompt = readFileSync(new URL('../../prompts/setup.md', import.meta.url), 'utf8');
  assert.ok(prompt.includes('A Language (Other) listed at its base is not fluency.'));
  assert.ok(prompt.includes("Language (Own) is different: its base is the person's EDU"));
  assert.equal(/A language listed at its base is not fluency/.test(prompt), false, 'the unqualified sentence that was read onto the own tongue');
});

test('an own tongue the player never gave is the one their described life is lived in, never one read from their name', () => {
  // Blood Road, 2026-10-02: "Rosa Mendes, a photographer for an El Paso paper" got Spanish as her own tongue and a warning
  // that without English she would struggle in West Texas; the player had named no language at all.
  const prompt = readFileSync(new URL('../../prompts/setup.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.ok(prompt.includes('own_language (the tongue the player gave; when they gave none, the one their life as the player described it is lived in -- where they live and work -- never one read from their name)'));
});
