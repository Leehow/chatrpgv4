import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('compressed context supplies facts but never the player-facing sentence pattern', async () => {
  const prompt = await readFile(new URL('../../prompts/keeper.md', import.meta.url), 'utf8');
  assert.ok(prompt.includes('facts, never prose samples'));
  assert.ok(prompt.includes('Retained delivered prose is continuity evidence too, not a style or voice authority'));
  // docs/specs/prose-mod.md §6: the craft sentences left the base for the prose package.
  const craft = await readFile(new URL('../../mods/narration-craft/agent.md', import.meta.url), 'utf8');
  assert.equal(prompt.includes('Write natural, complete sentences in `play_language`'), false);
  assert.equal(prompt.includes('it owes four things'), false);
  assert.equal(prompt.includes('at most one sentence of room and one gesture'), false);
  assert.equal(prompt.includes('give a little, refuse harder, or change the subject'), false);
  assert.ok(craft.includes('who does what to whom is never left for the reader to reconstruct'));
  assert.ok(craft.includes('do not repeat, paraphrase or summarise them'));
  assert.ok(craft.includes('the position moves only when the fiction moves it'));
  assert.ok(prompt.includes('Address every player-controlled investigator in the second person'));
  assert.ok(prompt.includes('Words the player directly spoke are already their part of the conversation'));
  assert.ok(prompt.includes('intended actions still need ordinary adjudication and settlement'));
  assert.ok(prompt.includes('Do not add an unchosen action, promise or payment'));
  assert.ok(prompt.includes('Detail used to answer an investigative question is evidence, not atmospheric filler'));
  assert.ok(prompt.includes('your memory of another telling of this scenario is not this campaign\'s source'));
  assert.equal(prompt.includes('a speakable line is rendered as the investigator\'s line with its meaning kept'), false);
});

test('the capsule\'s craft lines come from a context.style.v1 package, never from the base graph', async () => {
  // Contract §137: the base keeps language and register; axes, directives, beats and floor are a package's.
  const json = async path => JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'));
  await assert.rejects(access(new URL('../../content/craft/beat-directives.json', import.meta.url)), 'the base beat table is retired');
  const graph = await json('content/craft/text-graph.json'), manifest = await json('content/craft/text-graph-manifest.json');
  const counts = {};
  for (const node of graph.nodes) counts[node.node_kind] = (counts[node.node_kind] || 0) + 1;
  for (const retired of ['craft-directive', 'style-axis', 'review-rule']) assert.equal(retired in counts, false, `${retired} nodes are retired`);
  assert.ok(counts['play-register'] >= 1, 'registers stay: campaign.create validates against them');
  assert.ok(graph.nodes.some(node => node.node_id === 'segment-type:state-delta'), 'the ontology still references segment-type:state-delta');
  assert.equal(graph.relations.some(relation => relation.relation_kind === 'advises'), false);
  assert.deepEqual(manifest.node_counts, counts, 'the manifest counts the nodes the graph carries');

  const provider = await json('mods/narration-craft/mod.json');
  assert.ok(provider.requires.includes('context.style.v1'));
  assert.ok(provider.package_files.includes(provider.contributes.style));
  const style = await json(`mods/narration-craft/${provider.contributes.style}`);
  assert.deepEqual(Object.keys(style).sort(), ['axes', 'beats', 'directives', 'floor', 'schema_version']);
  assert.equal(style.schema_version, 1);
  for (const [id, entry] of Object.entries(style.directives)) {
    assert.match(id, /^[a-z][a-z0-9-]{0,63}$/);
    assert.deepEqual(Object.keys(entry).sort(), ['brief', 'full'], id);
  }
  for (const ids of Object.values(style.beats)) assert.ok(ids.length <= 4 && ids.every(id => id in style.directives));
  assert.equal('rewrite-passive-translation-ese' in style.directives, false, 'the retired rewrite-lane directives stay retired');
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
