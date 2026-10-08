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
  // Owner 2026-09-28 (narration-craft 2.1.0): the declared act is shown in the scene, never retyped; speech is one joined thought.
  // Owner, after two A/B rounds (2026-09-28): the Keeper gets the player's words and writes the act in its own words,
  // unconstrained beyond not pasting the sentence back and not going against it; npc-voice's natural-reply section returns.
  assert.ok(craft.includes('The player\'s words this turn are what the investigator does'));
  assert.ok(craft.includes('Their sentence is never pasted back in'));
  // Contract section 40.9: the whole encounter and immediate danger supersede unconditional answer-first.
  assert.ok(craft.includes('respond to the whole encounter, what was done as well as said'));
  assert.ok(craft.includes('Immediate danger takes priority over conducting business'));
  assert.ok(craft.includes('rather than automatically answering it as a request for information'));
  assert.ok(craft.includes('Answer a genuine question directly when the situation permits'));
  assert.ok(craft.includes('and the NPC chooses to, with natural connected speech'));
  assert.equal(craft.includes('Answer the actual question first, with natural connected speech'), false);
  const peopleAt = craft.indexOf('\n## The people here\n');
  assert.ok(peopleAt >= 0, 'the full instruction keeps its people section');
  const people = craft.slice(peopleAt, craft.indexOf('\n## ', peopleAt + 1));
  assert.ok(craft.includes('Same thought, two mouths'));
  assert.equal(craft.includes('do not begin with what the investigator did'), false);
  assert.ok(craft.includes("Keep each person's facts and position"));
  assert.ok(craft.includes('Repetition may test patience, persuade, clarify, or change nothing'));
  assert.ok(craft.includes('Sarcasm, contempt and insult may colour what they offer next, but do not force offence'));
  // prose-mod-c (2026-09-26): two of fifteen turns narrated the investigator in the third person; the instruction states the viewpoint
  // (the brief that also said it is retired, §183).
  assert.ok(craft.includes('The investigator is always "you"'));
  // §40.9: the instruction, style axis, directive, floor and package description agree that people react to the whole
  // encounter, and none keeps the unconditional answer-first priority under which a struck NPC still recited money and
  // keys (2.1.8 run, turn 2); the description was left behind until 2.1.13.
  // Each surface is found where it lives, so one that is renamed or dropped fails here instead of passing vacuously.
  const style = JSON.parse(await readFile(new URL('../../mods/narration-craft/style.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../../mods/narration-craft/mod.json', import.meta.url), 'utf8'));
  const speak = style.directives['speak-in-person'] ?? {};
  const surfaces = {full: people, axes: style.axes.join('\n'), 'directive full': speak.full, 'directive brief': speak.brief,
    floor: style.floor.find(line => line.startsWith('voice:')), description: manifest.description?.en};
  for (const [surface, text = ''] of Object.entries(surfaces)) {
    assert.match(text, /\breacts?\b/i, `§40.9: the ${surface} has people react to the whole encounter`);
    assert.doesNotMatch(text, /\banswers?\b[^.;\n]*\b(?:first|what was (?:actually )?said)\b/i, `§40.9: the ${surface} still ranks answering what was said first`);
  }
  assert.equal(craft.includes('as a writer writes'), false);
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
  assert.equal(manifest.version, '1.3.0');
  assert.ok(manifest.requires.includes('audit.owed.v1'), 'contract §158.2: the reviewer names owed state');
  assert.equal(manifest.state_version, 1);
  assert.equal(manifest.contributes.establish_review, 'establish-review.md');
  assert.ok(manifest.requires.includes('audit.establish.v1'));
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

test('both post-delivery checkers share one player_agency definition: filling in the declared act is the Keeper\'s', async () => {
  // Owner 2026-09-28: the prose may flesh out what the player declared without going against it. On four live tables the
  // checker filed a lifted chin, a nod on leaving and a hand on the banister as player_agency, and the Keeper reads its
  // findings the next turn (capsule `warnings`). Both lanes keep flagging decisions, words, consequences and room changes.
  const lane = await readFile(new URL('../../extensions/kernel/verifier.ts', import.meta.url), 'utf8');
  const jev = await readFile(new URL('../../runtime/jev/post-delivery-verifier-domain.ts', import.meta.url), 'utf8');
  for (const [name, text] of [['model lane', lane], ['Jev lane', jev]]) {
    assert.ok(text.includes('filling in what that act plainly involves'), `${name} allows the fleshed-out act`);
    assert.ok(text.includes('a change to the room or to another person'), `${name} still flags a change to the room`);
    assert.ok(text.includes('words whose content'), `${name} still flags words the player did not say`);
    assert.ok(text.includes('a new action with a consequence of its own'), `${name} still flags a consequential action`);
  }
});

test('§158.6: the Keeper is told the delivered turn is canon, the ledger follows it, and only the player\'s dispute reverses it', async () => {
  const prompt = await readFile(new URL('../../prompts/keeper.md', import.meta.url), 'utf8');
  const laws = prompt.slice(prompt.indexOf('Four laws:'), prompt.indexOf('Your tools:'));
  // Law 2 names the owed rows and how they land; law 3 says who wins about the past and the one exception.
  assert.match(laws, /owed state \(the capsule's `owed` rows\)/);
  assert.match(laws, /effect carries `owed`/);
  assert.match(laws, /the delivered turn is canon and the ledger is brought forward to it/);
  assert.match(laws, /never tell the player the table made a mistake or that a service failed, never apologise and never narrate a correction/);
  assert.match(laws, /when they explicitly dispute what happened and ask for it to be otherwise, follow them/);
  assert.doesNotMatch(laws, /without an `apply` did not happen/, 'told prose without a receipt is owed, not unhappened');
  // Turn 23 of the installed table followed the old line and told the player the table could not settle.
  assert.doesNotMatch(prompt, /say so plainly to the player as a service notice/);
  assert.doesNotMatch(prompt, /say that the table cannot settle actions/);
  assert.match(prompt, /keep the review, the service and its failure out of the fiction and the prose/);
});

test('§179.1: consulting what the investigator carries is the base\'s; the answer an asker wants is Natural NPC\'s', async () => {
  // App table game-8e41c325 (2026-10-04): turn 6 opened the notes and wrote the room; turn 3 gave a place's name and no
  // way to know it. Owner: consulting items belongs to the base system, reading an asker's intent to the NPC package.
  const prompt = await readFile(new URL('../../prompts/keeper.md', import.meta.url), 'utf8');
  assert.match(prompt, /When the investigator reads, checks or calls to mind what they carry or already know/);
  assert.match(prompt, /the turn shows what is there, not only the gesture of looking/);
  // Arm C of the replay: three of four named the notes' headings with a particular inside them, not the contents.
  assert.match(prompt, /the particulars themselves, as written or remembered, not a list of the kinds of things the page holds/);
  assert.match(prompt, /`own` holds what their card says and the player's own earlier words/);
  assert.match(prompt, /never against what the player has said/);
  const npc = await readFile(new URL('../../mods/natural-npc/agent.md', import.meta.url), 'utf8');
  const at = npc.indexOf('\n## What the asker is after\n');
  assert.ok(at >= 0, 'Natural NPC carries the section');
  const section = npc.slice(at, npc.indexOf('\n## ', at + 1));
  assert.match(section, /know what the investigator is after/);
  assert.match(section, /where it is and how to know it on\s+arrival/);
  assert.match(section, /complete enough to use/);
  assert.match(section, /hides\s+exactly that point/);
  // The prose package is not where either lives (owner, 2026-10-04): narration-craft stays as 0.9.6a shipped it.
  const craft = await readFile(new URL('../../mods/narration-craft/agent.md', import.meta.url), 'utf8');
  assert.equal(craft.includes('what the asker is after'), false);
  assert.equal(craft.includes('`own`'), false);
});
