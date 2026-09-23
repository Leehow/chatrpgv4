import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('compressed context supplies facts but never the player-facing sentence pattern', async () => {
  const prompt = await readFile(new URL('../../prompts/keeper.md', import.meta.url), 'utf8');
  assert.ok(prompt.includes('facts, never prose samples'));
  assert.ok(prompt.includes('Retained delivered prose is continuity evidence too, not a style or voice authority'));
  assert.ok(prompt.includes('Write natural, complete sentences in `play_language`'));
  assert.ok(prompt.includes('make clear who does what'));
  assert.ok(prompt.includes('Before `narrate`, reread the final draft as the player'));
  assert.ok(prompt.includes('Address every player-controlled investigator in the second person'));

  const craft = JSON.parse(await readFile(new URL('../../content/craft/beat-directives.json', import.meta.url), 'utf8'));
  assert.equal(craft.axis_lines['style-axis:avoid-translationese'], 'write natural, complete sentences');
  assert.match(craft.directive_lines['final-prose-guard-before-output'], /context is facts, not phrasing/);
  assert.match(craft.directive_lines['repetition-policy'], /complete sentences; never fragments/);
});

test('the existing pre-delivery audit revises unintelligible prose without grading literary taste', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../mods/narration-audit/mod.json', import.meta.url), 'utf8'));
  const auditor = await readFile(new URL('../../mods/narration-audit/auditor.md', import.meta.url), 'utf8');
  assert.equal(manifest.version, '1.2.31');
  assert.equal(manifest.state_version, 1);
  assert.ok(manifest.requires.includes('audit.continuity.v2'));
  assert.ok(!manifest.requires.includes('audit.continuity.v1'));
  assert.match(auditor, /must be intelligible to a reader of the campaign's play language/);
  assert.match(auditor, /restore omitted grammatical relations/);
  assert.match(auditor, /preserve the facts and choices while requiring natural, complete sentences throughout the candidate/);
  assert.match(auditor, /Do not grade literary style, length, voice/);
  assert.match(auditor, /one person's name attached directly to another person's body part/);
  assert.match(auditor, /Archaic, terse, foreign or characterful speech is not an exemption/);
  assert.match(auditor, /A single occurrence is enough to revise/);
  assert.match(auditor, /Player-facing narration addresses every player-controlled investigator in the second person/);
  assert.match(auditor, /NPC dialogue, reported speech and narration about NPCs/);
  assert.match(auditor, /player_address_review/);
  assert.match(auditor, /Include every alias from `context.sources.speech` exactly once and in order/);
  assert.match(auditor, /speech_review/);
  assert.match(auditor, /Explain briefly why its subject, action and object or idiomatic omission is naturally clear/);
  assert.match(auditor, /"schema":2/);
  assert.match(auditor, /claim_source: draft_alias/);
  assert.match(auditor, /Never put copied candidate text, evidence text, names, paths, offsets or other private coordinates/);
});

test('the final audit task brief makes intelligibility a submission-time decision', async () => {
  const host = await readFile(new URL('../../extensions/mods/index.ts', import.meta.url), 'utf8');
  assert.match(host, /Before submitting, reread the candidate for intelligibility and player address in the play language/);
  assert.match(host, /Do not submit pass while any sentence requires the reader to restore omitted grammatical relations/);
  assert.match(host, /Do not submit pass when the narrator calls a player-controlled investigator by character name or a third-person pronoun/);
  assert.match(host, /job\.continuity_schema === 2/);
  assert.match(host, /include every speech alias exactly once in its original order/i);
  assert.match(host, /claim_source:draft_alias/);
  assert.match(host, /copy every spoken line exactly and in order, then explain/, 'the locked v1 branch remains available for v1 packages');
  assert.match(host, /bed\/body-state phrase standing in for the person and action/);
});
