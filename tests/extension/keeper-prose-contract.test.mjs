import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('compressed context supplies facts but never the player-facing sentence pattern', async () => {
  const prompt = await readFile(new URL('../../prompts/keeper.md', import.meta.url), 'utf8');
  assert.ok(prompt.includes('compressed facts, never prose samples'));
  assert.ok(prompt.includes('Write natural, complete sentences in `play_language`'));
  assert.ok(prompt.includes('make clear who does what'));
  assert.ok(prompt.includes('Before `narrate`, reread the final draft as the player'));

  const craft = JSON.parse(await readFile(new URL('../../content/craft/beat-directives.json', import.meta.url), 'utf8'));
  assert.equal(craft.axis_lines['style-axis:avoid-translationese'], 'write natural, complete sentences');
  assert.match(craft.directive_lines['final-prose-guard-before-output'], /context is facts, not phrasing/);
  assert.match(craft.directive_lines['repetition-policy'], /complete sentences; never fragments/);
});

test('the existing pre-delivery audit revises unintelligible prose without grading literary taste', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../mods/narration-audit/mod.json', import.meta.url), 'utf8'));
  const auditor = await readFile(new URL('../../mods/narration-audit/auditor.md', import.meta.url), 'utf8');
  assert.equal(manifest.version, '1.2.24');
  assert.match(auditor, /must be intelligible to a reader of the campaign's play language/);
  assert.match(auditor, /restore omitted grammatical relations/);
  assert.match(auditor, /preserve the same facts and choices while rewriting the whole candidate as natural, complete sentences/);
  assert.match(auditor, /Do not grade literary style, length, voice/);
  assert.match(auditor, /one person's name attached directly to another person's body part/);
  assert.match(auditor, /Archaic, terse, foreign or characterful speech is not an exemption/);
  assert.match(auditor, /A single occurrence is enough to revise/);
});
