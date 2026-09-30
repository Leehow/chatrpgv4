/**
 * Contract §158.2–§158.3 (FR-01 of docs/specs/forward-only-reconciliation-tickets.md): the post continuity review
 * names what the delivered text established and no receipt carries, and the kernel records it as owed state --
 * on the delivered record, in the campaign's `owed.json`, and as a warning row whose fix points forward.
 *
 * The fixture is turn 26 of the installed App's Dust to Dust table (fixtures/forward-only/t26-review): the delivery
 * told the player 「波街公墓就在眼前」 and nothing moved them. Its reviewer already said so in structure
 * (`locus_review` new_locus / none at `scene:20`, 「勘查波街公墓」); the Keeper was only told to avoid it next time.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {auditArtifactIssues, buildAuditReferences} from '../../kernel-ts/mods/audit-references.ts';
import {api, table} from './object-usages-fixture.mjs';

const FIXTURE = new URL('./fixtures/forward-only/t26-review/', import.meta.url);
const load = async name => JSON.parse(await readFile(new URL(name, FIXTURE), 'utf8'));
const BANDS = {travel_bands: ['adjacent', 'local_travel', 'long_travel'], time_bands: ['speak_briefly', 'quick_observation', 'single_room_search']};
/** The retained job, as it was (`owed: false`) or as a 1.2.32 job would pin it (`owed: true`). */
async function turn26({owed = true} = {}) {
    const request = await load('request.json'), context = await load('context.json'), effective = await load('effective.trimmed.json');
    const files = {'context.json': owed ? {...context, owed_review: {requires_review: true, open: [], ...BANDS}} : context, 'effective.json': effective};
    const pinned = owed ? {...request, continuity_review: {...request.continuity_review, owed: true}} : request;
    return {request: pinned, files, catalog: buildAuditReferences(pinned, files), submitted: await load('result.json')};
}
const check = ({request, files, catalog}, value) => auditArtifactIssues(value, request, files, catalog);
const paths = result => result.errors.map(error => error.path);
const CLAIM = '波街公墓就在眼前——弗吉尼娅·费尔德被盗的那一夜，留下的就是这一片空穴与乱土。';
const ARRIVAL = {kind: 'move', source: 'draft:6', to_source: 'scene:20', place: null, summary: null,
    via: "Drove the coast road out of Arkham to Martin's Beach and parked outside the cemetery fence.", travel: 'local_travel'};

test('turn 26: the unsupported new locus is an owed arrival, and the report that names it is accepted', async () => {
    const job = await turn26();
    assert.equal(job.catalog.resolve('scene:20', ['scene']).name, '勘查波街公墓', 'the fixture keeps the job\'s own scene aliases');
    // The report exactly as the reviewer wrote it has no owed field at all.
    assert.ok(paths(check(job, job.submitted)).includes('/owed'));
    // An empty owed list is not enough: the locus review itself says the arrival has no move.
    const empty = check(job, {...job.submitted, owed: []});
    assert.deepEqual(empty.errors.filter(error => error.path === '/owed').map(error => error.message),
        ['A new locus without a move receipt is an owed arrival: add an owed move to it']);
    const named = check(job, {...job.submitted, owed: [ARRIVAL]});
    assert.deepEqual(named.errors, []);
    assert.deepEqual(named.checked.owed, [{kind: 'move', quote: CLAIM, to: '勘查波街公墓', place: null, summary: null, via: ARRIVAL.via, travel: 'local_travel'}]);
    assert.equal(named.checked.continuity_review.verdict, 'revise');
});

test('a review whose package does not ask for owed state is what it was', async () => {
    const job = await turn26({owed: false});
    assert.equal(job.catalog.owed, false);
    assert.equal(Object.hasOwn(job.catalog.sources, 'persons'), false, 'no new alias family, so the request and its key are unchanged');
    const retained = check(job, job.submitted);
    assert.deepEqual(retained.errors, [], 'the retained report is accepted as it was');
    assert.equal(Object.hasOwn(retained.checked, 'owed'), false);
    assert.deepEqual(Object.keys(retained.checked), ['missing', 'findings', 'continuity_review'], 'the accepted artifact keeps its field order');
    const extra = check(job, {...job.submitted, owed: [ARRIVAL]});
    assert.ok(extra.errors.some(error => error.path === '/owed' && /Unexpected field/.test(error.message)));
});

test('owed entries are closed shapes that select the told sentence and the scene or person', async () => {
    const job = await turn26(), base = {...job.submitted, owed: [ARRIVAL]};
    const person = job.catalog.sources.persons[0];
    assert.equal(person.alias, 'person:0');
    const withEntries = owed => check(job, {...base, owed});
    const npc = withEntries([ARRIVAL, {kind: 'npc', source: 'draft:6', person_source: 'person:0', presence: 'here'}]);
    assert.deepEqual(npc.errors, []);
    assert.deepEqual(npc.checked.owed[1], {kind: 'npc', quote: CLAIM, person: person.name, presence: 'here'});
    const time = withEntries([ARRIVAL, {kind: 'time', source: 'draft:6', band: 'quick_observation'}]);
    assert.deepEqual(time.errors, []);
    assert.deepEqual(time.checked.owed[1], {kind: 'time', quote: CLAIM, band: 'quick_observation'});
    const place = withEntries([{...ARRIVAL, to_source: null, place: '波街公墓', summary: 'A small cemetery on Poe Street in Martin\'s Beach.'}]);
    assert.deepEqual(place.errors, []);
    assert.equal(place.checked.owed[0].place, '波街公墓');

    assert.deepEqual(paths(withEntries([ARRIVAL, {...ARRIVAL, source: 'draft:5'}])), ['/owed'], 'one told position per delivery');
    assert.deepEqual(paths(withEntries([{...ARRIVAL, travel: 'teleport'}])), ['/owed/0/travel']);
    assert.deepEqual(paths(withEntries([ARRIVAL, {kind: 'time', source: 'draft:6', band: 'sleep_for_a_century'}])), ['/owed/1/band']);
    assert.deepEqual(paths(withEntries([ARRIVAL, {kind: 'npc', source: 'draft:6', person_source: 'scene:20', presence: 'here'}])), ['/owed/1/person_source']);
    assert.deepEqual(paths(withEntries([{...ARRIVAL, source: 'input:0'}])), ['/owed/0/source'], 'what was told is the draft, never the player\'s line');
    assert.deepEqual(paths(withEntries([{...ARRIVAL, place: '波街公墓', summary: 'A cemetery.'}])), ['/owed/0/to_source'], 'a scene or a new place, never both');
    assert.deepEqual(paths(withEntries([{...ARRIVAL, via: ''}])), ['/owed/0/via']);
    assert.deepEqual(paths(withEntries([ARRIVAL, {kind: 'clue', source: 'draft:6'}])), ['/owed/1/kind']);
    // Every sub-review passes and the only thing left is owed state: that is still not a pass.
    const settled = {...base.continuity_review, verdict: 'pass', locus_review: {verdict: 'pass', mode: 'same_locus', basis: 'active_scene', locus_source: null, claim_source: null}};
    const passing = check(job, {...base, findings: [], owed: [{kind: 'time', source: 'draft:6', band: 'quick_observation'}], continuity_review: settled});
    assert.deepEqual(passing.errors.map(error => [error.path, error.message]), [['/continuity_review/verdict', 'Pass cannot contain conflicts, missing objects, owed state or findings']]);
    assert.deepEqual(check(job, {...base, findings: [], owed: [], continuity_review: settled}).errors, [], 'nothing owed, nothing to revise');
});

// ---- the kernel side, over the real TS kernel in process ------------------------------------------------------

const DRAFT = 'You drive out past the edge of town and stop at the gate. Hours pass while you wait there. Knott walks off into the dark.';
const record = async (game, turn) => JSON.parse(await readFile(join(game.directory, 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
const ledger = async game => JSON.parse(await readFile(join(game.directory, 'owed.json'), 'utf8'));
const telemetry = async game => (await readFile(join(game.directory, 'telemetry.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

/** A post review of `text` on the open turn: the owed-capable report the product package asks for, then delivery. */
async function reviewed(game, text, owed, {missing = [], verifier = []} = {}) {
    const job = await game.call('mods.job', {role: 'audit', input: {text}});
    assert.equal(job.continuity_owed, true, 'the shipped narration-audit requires audit.owed.v1');
    const sources = job.focus.sources, sentence = words => sources.draft.find(source => source.text.includes(words)).alias;
    const entries = owed(sources, sentence, job.focus.owed_review);
    const move = entries.find(entry => entry.kind === 'move');
    await writeFile(join(job.cwd, 'result.json'), JSON.stringify({schema: 2, missing: missing.map(subject => ({subject, category: 'item', reason: 'Handed over in the delivered text.'})),
        owed: entries, findings: [], continuity_review: {verdict: 'revise', summary: 'The delivery told the player more than the ledger holds.', conflicts: [],
            intelligibility_review: {verdict: 'pass', source: null}, player_address_review: {verdict: 'pass', source: null},
            ...(sources.speech.length ? {speech_review: {verdict: 'pass', lines: sources.speech.map(line => ({source: line.alias, verdict: 'pass', reason: 'A complete spoken statement.'}))}} : {}),
            locus_review: move ? {verdict: 'revise', mode: 'new_locus', basis: 'none', locus_source: move.to_source, claim_source: move.source}
                : {verdict: 'pass', mode: 'same_locus', basis: 'active_scene', locus_source: null, claim_source: null}}}));
    const delivered = await game.call('table.narrate', {call_id: game.next(), text});
    // A post-delivery verifier row that lands first, so the capsule's ordering is tested, not the arrival order.
    if (verifier.length) await game.call('table.warn', {turn: delivered.turn, lane: 'verifier', findings: verifier});
    await game.call('mods.accept', {job: job.job, after_delivery: true}).catch(error => { throw new Error(JSON.stringify(error.details)); });
    return {job, turn: delivered.turn, warned: await game.call('table.warn', {turn: delivered.turn, lane: 'continuity-review', mode: 'post', job: job.job})};
}
const elsewhere = sources => sources.scenes.find(scene => scene.alias !== 'scene:active' && scene.alias.startsWith('scene:') && !scene.alias.startsWith('scene:move'));

test('an owed-capable review lands owed state on the record, in owed.json and as a forward-pointing row', async t => {
    const game = await table(t);
    let target;
    const {job, turn, warned} = await reviewed(game, DRAFT, (sources, sentence, review) => {
        target = elsewhere(sources);
        assert.deepEqual(review.open, [], 'nothing is owed yet');
        assert.ok(review.travel_bands.includes('local_travel') && review.time_bands.includes('quick_observation'));
        assert.ok(!review.time_bands.includes('local_travel'), 'a journey is its move\'s, never a time row');
        return [{kind: 'move', source: sentence('stop at the gate'), to_source: target.alias, place: null, summary: null, via: 'Drove out of town to the gate.', travel: 'local_travel'},
            {kind: 'time', source: sentence('Hours pass'), band: 'single_room_search'},
            {kind: 'npc', source: sentence('Knott walks off'), person_source: sources.persons.find(person => /Knott/.test(person.name)).alias, presence: 'away'}];
    }, {missing: ['object:0'], verifier: [{kind: 'uncommitted_state', quote: 'Hours pass while you wait there.', why: 'The clock did not move.'}]});
    const closed = await record(game, turn);
    assert.deepEqual(closed.owed.map(row => [row.name, row.kind]), [[`t${turn}-owed-1`, 'move'], [`t${turn}-owed-2`, 'time'], [`t${turn}-owed-3`, 'npc'], [`t${turn}-owed-4`, 'object']]);
    const [move, time, npc, object] = closed.owed;
    assert.equal(move.quote, 'You drive out past the edge of town and stop at the gate.');
    assert.deepEqual({...move.effect, to: typeof move.effect.to}, {kind: 'move', to: 'string', via: 'Drove out of town to the gate.', travel_minutes: 30},
        'a road\'s minutes are the travel band\'s default (§138.9), never a reviewer\'s number');
    assert.notEqual(move.effect.to, target.name, 'the kernel names the scene by its handle');
    assert.deepEqual(time.effect, {kind: 'time', band: 'single_room_search'}, 'time is rolled when it lands');
    assert.equal(npc.effect.to, 'away');
    assert.equal(object.effect, null, 'an owed object is the Keeper\'s to register');
    assert.equal(object.quote, null);
    assert.equal(move.job, job.job);

    // The rows are the continuity review's rows: forward-pointing, first, and never an unsettled_object any more.
    assert.equal(closed.warnings[0].lane, 'verifier', 'the verifier row landed first');
    const rows = closed.warnings.filter(row => row.lane === 'continuity-review');
    assert.deepEqual(rows.map(row => row.kind), ['owed_state', 'owed_state', 'owed_state', 'owed_state']);
    assert.equal(rows[0].owed, move.name);
    assert.equal(rows[0].quote, move.quote);
    assert.match(rows[0].fix, /^Already told: the player was told this happened, so it did/);
    assert.doesNotMatch(rows[0].fix, /avoid/);
    assert.equal(warned.accepted, 4);
    const kernelRow = (await telemetry(game)).findLast(row => row.lane === 'continuity-review' && row.event === 'recorded');
    assert.equal(kernelRow.owed, 4);

    const owed = await ledger(game);
    assert.deepEqual(owed.open.map(row => row.name), closed.owed.map(row => row.name));
    assert.deepEqual(owed.closed, []);

    // The next capsule leads with them (continuity kinds first), and the recorded move is an ordinary apply.
    const opened = await game.call('table.player_input', {text: 'I look around.'});
    // The section is trimmed from its end within its budget, so what leads is what survives.
    const kinds = opened.capsule.warnings.map(row => row.kind);
    assert.equal(kinds[0], 'owed_state');
    assert.ok(kinds.lastIndexOf('owed_state') < (kinds.includes('uncommitted_state') ? kinds.indexOf('uncommitted_state') : Infinity));
    const landed = await game.call('table.apply', {call_id: `t${turn + 1}-c1`, effects: [move.effect]});
    assert.equal((await game.world()).active_scene, move.effect.to);
    assert.deepEqual(landed.receipts.filter(id => id.startsWith('move:')), [`move:${move.effect.to}-t${turn + 1}-c1`]);

});

test('a retry mints no twins, the rows survive a restart, a newer arrival supersedes, and the ledger\'s own agreement closes a row', async t => {
    const game = await table(t);
    const first = await reviewed(game, DRAFT, (sources, sentence) => [
        {kind: 'move', source: sentence('stop at the gate'), to_source: elsewhere(sources).alias, place: null, summary: null, via: 'Drove out to the gate.', travel: 'adjacent'}]);
    const before = await ledger(game);
    assert.equal(before.open[0].effect.travel_minutes, 0, 'adjacent is no road at all');
    await game.call('table.warn', {turn: first.turn, lane: 'continuity-review', mode: 'post', job: first.job.job});
    assert.deepEqual(await ledger(game), before, 'the same job is recorded once');
    // The ledger was written but the record was not (a crash between the two writes): the retry reuses the job's rows.
    const path = join(game.directory, 'turns', `${String(first.turn).padStart(4, '0')}.json`), torn = await record(game, first.turn);
    delete torn.continuity_review; delete torn.owed;
    await writeFile(path, JSON.stringify(torn));
    await game.call('table.warn', {turn: first.turn, lane: 'continuity-review', mode: 'post', job: first.job.job});
    assert.deepEqual((await ledger(game)).open.map(row => row.name), before.open.map(row => row.name), 'no twin rows');
    assert.deepEqual((await record(game, first.turn)).owed.map(row => row.name), before.open.map(row => row.name));

    // A restart reads the same file: the ledger is campaign state, not the session's memory.
    const {createKernelRuntime} = api;
    const reopened = createKernelRuntime(game.context);
    t.after(() => reopened.close());
    await reopened.handlers['table.warn']({campaign: 'c1', turn: first.turn, lane: 'continuity-review', mode: 'post', job: first.job.job});
    assert.deepEqual(await ledger(game), before, 'a restarted kernel reads the same ledger and still records once');

    await game.call('table.player_input', {text: 'I keep going.'});
    const second = await reviewed(game, 'You walk on to the old house and stand on its porch.', (sources, sentence) => [
        {kind: 'move', source: sentence('stand on its porch'), to_source: 'scene:active', place: null, summary: null, via: 'Walked on.', travel: 'local_travel'}]);
    const after = await ledger(game);
    assert.deepEqual(after.open, [], 'an arrival where the ledger already stands owes nothing');
    assert.deepEqual(after.closed.map(row => [row.name, row.how]), [[before.open[0].name, 'superseded'], [`t${second.turn}-owed-1`, 'satisfied']]);
});

test('the quote is the sentence the player read: machine tokens are not part of it', async t => {
    const game = await table(t);
    const text = 'You reach the gate. {{say:Knott}}I will leave you here.{{/say}}';
    const {turn} = await reviewed(game, text, (sources, sentence) => [
        {kind: 'npc', source: sentence('leave you here'), person_source: sources.persons.find(person => /Knott/.test(person.name)).alias, presence: 'away'}]);
    const [row] = (await record(game, turn)).owed;
    assert.equal(row.quote, 'I will leave you here.', 'located in rendered_text, where the say token is gone');
    assert.ok((await record(game, turn)).rendered_text.includes(row.quote));
});

test('an owed entry whose sentence the player never read is not recorded', async t => {
    const game = await table(t);
    const job = await game.call('mods.job', {role: 'audit', input: {text: DRAFT}});
    const sources = job.focus.sources, sentence = words => sources.draft.find(source => source.text.includes(words)).alias;
    await writeFile(join(job.cwd, 'result.json'), JSON.stringify({schema: 2, missing: [], findings: [],
        owed: [{kind: 'time', source: sentence('Hours pass'), band: 'single_room_search'}],
        continuity_review: {verdict: 'revise', summary: 'Time passed without a receipt.', conflicts: [],
            intelligibility_review: {verdict: 'pass', source: null}, player_address_review: {verdict: 'pass', source: null},
            locus_review: {verdict: 'pass', mode: 'same_locus', basis: 'active_scene', locus_source: null, claim_source: null}}}));
    const {turn} = await game.call('table.narrate', {call_id: game.next(), text: DRAFT});
    await game.call('mods.accept', {job: job.job, after_delivery: true});
    // What the player read is `rendered_text`; here it lost the sentence the entry quotes.
    const path = join(game.directory, 'turns', `${String(turn).padStart(4, '0')}.json`), delivered = await record(game, turn);
    await writeFile(path, JSON.stringify({...delivered, rendered_text: delivered.rendered_text.replace('Hours pass while you wait there.', '')}));
    await game.call('table.warn', {turn, lane: 'continuity-review', mode: 'post', job: job.job});
    assert.deepEqual((await record(game, turn)).owed, []);
    const row = (await telemetry(game)).findLast(entry => entry.lane === 'continuity-review' && entry.event === 'recorded');
    assert.deepEqual(row.owed_dropped, [{index: 0, kind: 'time', reason: 'quote_not_delivered'}]);
});

test('an if fork at an earlier commit carries that turn\'s own owed rows with the line', async t => {
    const game = await table(t);
    const {turn} = await reviewed(game, DRAFT, (sources, sentence) => [
        {kind: 'move', source: sentence('stop at the gate'), to_source: elsewhere(sources).alias, place: null, summary: null, via: 'Drove out to the gate.', travel: 'local_travel'}]);
    const rows = (await record(game, turn)).owed;
    const commit = (await record(game, turn)).commit;
    assert.equal(typeof commit, 'string');
    await game.call('table.branch', {commit, name: 'side'});
    const carried = await ledger(game);
    assert.deepEqual(carried.open.map(row => row.name), rows.map(row => row.name), 'the fork turn told this line the same arrival');
});
