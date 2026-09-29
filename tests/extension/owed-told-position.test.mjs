/**
 * Contract §158.4 (FR-02 of docs/specs/forward-only-reconciliation-tickets.md): the next turn starts from the told position.
 *
 * Installed App, Dust to Dust, turn 27: the post review of turn 26 had found the unlanded arrival at the Poe Street
 * cemetery, but it landed 13 s after turn 27 opened; the clerk built its moves from the ledger's position (the Arkham
 * newsstand), Jev read 「蹲在敞开的墓穴旁」 as the one cemetery reachable from there at 0.93, and the party was
 * walked to the wrong cemetery. Here the same shape runs on the haunting: the party is at the Hall of Records, where the
 * higher courts are an open exit; the player was told they drove on and pulled up at the Corbitt house, and nothing moved
 * them. The stub Jev picks the courts -- the one place reachable from the ledger's position and not from the house --
 * whenever the compile offers it.
 */
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {buildCandidates, owedCandidates} from '../../runtime/jev/candidates.ts';
import {compileRows} from '../../runtime/jev/compile-rows.ts';
import {COMPILE_FAMILY} from '../../runtime/jev/route-compile.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {consumedByEffects} from '../../runtime/jev/step-policy.ts';
import {owedWaitMs, settleOwedReview} from '../../extensions/kernel/owed-review.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAMPAIGN = 'test-camp';

// ---- the builder, pure ------------------------------------------------------------------------------------------

const OWED = [
    {name: 't26-owed-1', turn: 26, kind: 'move', what: 'arrival at the cemetery', quote: 'The cemetery is right there.', clerk: true,
        effect: {kind: 'move', to: 'poe-cemetery', via: 'Drove to Martin\'s Beach.', travel_minutes: 30}},
    {name: 't26-owed-2', turn: 26, kind: 'npc', what: 'the sexton is present', quote: 'The sexton leans on his spade.', clerk: true,
        effect: {kind: 'npc', name: 'sexton', to: 'poe-cemetery'}},
    {name: 't26-owed-3', turn: 26, kind: 'time', what: 'time beyond the journey', quote: 'The morning wears on.', clerk: true, effect: {kind: 'time', band: 'quick_observation'}},
    {name: 't26-owed-4', turn: 26, kind: 'object', what: 'the newspaper (item)', quote: null, clerk: false},
];
const reads = owed => ({
    capsule: {where: {scene: 'newsstand'}, present: [], known: {investigator: {name: 'Nora'}}, owed},
    applyOptions: {candidates: [
        {effect: {kind: 'move', to: 'church-cemetery'}, description: {kind: 'move', to: 'church-cemetery', display_name: 'Arkham church cemetery'}},
        {effect: {kind: 'clue', clue: 'headline'}, description: {summary: 'The headline.'}}], context: {}},
    resolveOptions: {profiles: [{actor: 'Nora', skill: 'Spot Hidden', value: 60}], decisions: []},
});

test('the owed rows the host can land are the run\'s forced first steps, bound whole from the row', () => {
    const candidates = buildCandidates(reads(OWED), '我蹲在敞开的墓穴旁。');
    const owed = candidates.filter(candidate => candidate.family === 'owed');
    // Built last and in reverse: a forced step is put at the front as it is read, so the move runs first.
    assert.deepEqual(owed.map(candidate => candidate.key), ['apply:owed:t26-owed-3', 'apply:owed:t26-owed-2', 'apply:owed:t26-owed-1']);
    const move = owed.at(-1);
    assert.deepEqual(move.bound, {...OWED[0].effect, owed: 't26-owed-1'});
    assert.deepEqual(move.unbound, []);
    assert.equal(move.forced, true);
    assert.equal(move.clerk, 'told_bookkeeping');
    assert.deepEqual(move.basis.told, {owed: 't26-owed-1', turn: 26, quote: 'The cemetery is right there.'});
    assert.ok(!owed.some(candidate => candidate.key.endsWith('t26-owed-4')), 'an owed object is the Keeper\'s');
    assert.deepEqual(owedCandidates(reads(OWED).capsule, true), [], 'a running session keeps its own steps');
});

test('while the told position is owed, no move is built from the ledger\'s position', () => {
    const told = reads(OWED);
    assert.ok(!buildCandidates(told, '我蹲在敞开的墓穴旁。').some(candidate => candidate.family === 'move'));
    assert.deepEqual(compileRows(told).destination, [], 'the compile offers no destination from the newsstand');
    assert.ok(buildCandidates(told, '').some(candidate => candidate.key === 'apply:clue:headline'), 'only moves are withheld');
    // With no owed move open (only time), the ledger's moves are the moves.
    const settled = reads(OWED.filter(row => row.kind !== 'move'));
    assert.ok(buildCandidates(settled, 'x').some(candidate => candidate.key === 'apply:move:church-cemetery'));
    assert.deepEqual(compileRows(settled).destination.map(row => row.id), ['church-cemetery']);
});

test('a Keeper apply that lands an owed row takes that row\'s clerk step, and owed time is not this turn\'s', () => {
    assert.deepEqual(consumedByEffects([{kind: 'move', to: 'poe-cemetery', owed: 't26-owed-1'}]), ['apply:owed:t26-owed-1', 'apply:move:poe-cemetery']);
    assert.deepEqual(consumedByEffects([{kind: 'time', band: 'quick_observation', owed: 't26-owed-3'}]), ['apply:owed:t26-owed-3'], 'the declared action\'s time is still owed its own');
    const withTime = receipts => ({...reads([]), bands: {time: [{handle: 'quick_observation', min: 0, max: 5}]},
        applyOptions: {...reads([]).applyOptions, context: {current_receipts: receipts}}});
    const declared = receipts => buildCandidates(withTime(receipts), '我仔细查看脚印。').some(candidate => candidate.key === 'apply:time:declared');
    assert.equal(declared([{kind: 'time', owed: 't26-owed-3'}]), true, 'told time landed this run does not charge the declaration');
    assert.equal(declared([{kind: 'time'}]), false, 'this turn\'s own time does');
});

// ---- the wait for a review in flight -----------------------------------------------------------------------------

test('the wait resolves when the review settles, and never past what is left of its bound', async () => {
    assert.equal(owedWaitMs({}), 15000);
    assert.equal(owedWaitMs({PI_COC_OWED_WAIT_MS: '0'}), 0);
    assert.equal(owedWaitMs({PI_COC_OWED_WAIT_MS: 'soon'}), 15000);
    assert.deepEqual(await settleOwedReview(undefined, 15000, 0), {in_flight: false, waited_ms: 0, landed: false});
    let settle;
    const flight = {turn: 26, done: new Promise(resolve => { settle = resolve; })};
    const waiting = settleOwedReview(flight, 15000, 2000);
    setTimeout(() => settle(), 30);
    const landed = await waiting;
    assert.equal(landed.landed, true);
    assert.equal(landed.turn, 26);
    const late = await settleOwedReview({turn: 26, done: new Promise(() => {})}, 15000, 14950);
    assert.equal(late.landed, false, 'the review did not land within what was left');
    assert.ok(late.waited_ms < 1000);
    assert.deepEqual(await settleOwedReview({turn: 26, done: new Promise(() => {})}, 15000, 20000), {in_flight: true, waited_ms: 0, landed: false, turn: 26});
});

function controlledReview() {
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { started = resolve; });
    return {began, release: outcome => release(outcome),
        deferred: {mode: 'post', job: 'a'.repeat(64), jobMs: 7, async run(options) { started(options); return gate; }}};
}

test('the host publishes the review in flight: the port waits for it and is empty once it recorded', async t => {
    let port;
    const table = await openTable({responses: [
        fauxAssistantMessage([fauxToolCall('narrate', {text: 'You pull up at the gate.'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage('Should never be consumed.')],
        extraExtensions: [{name: 'owed-port-probe', factory: pi => pi.events.on('coc:owed-review', value => { port = value; })}]});
    t.after(() => table.dispose());
    const review = controlledReview();
    table.emit('coc:mods-bridge', {async after() {}, async prepare(method) { if (method === 'narrate') return {mode: 'post', deferred: review.deferred}; }});
    await table.session.prompt('I drive out to the house.');
    await review.began;
    assert.equal(typeof port?.settle, 'function', 'the kernel extension publishes the port with the table');
    const waiting = port.settle(0);
    review.release({mode: 'post', job: 'a'.repeat(64), verdict: 'revise'});
    const waited = await waiting;
    assert.equal(waited.in_flight, true);
    assert.equal(waited.landed, true);
    assert.ok(table.kernelRequests().some(request => request.method === 'table.warn' && request.params.lane === 'continuity-review'),
        'it settles once the verdict was recorded');
    assert.deepEqual(await port.settle(0), {in_flight: false, waited_ms: 0, landed: false}, 'nothing in flight afterwards');
});

// ---- on the emitted kernel over the haunting ---------------------------------------------------------------------

function kernelSteps(workspace, requests) {
    const input = requests.map((request, index) => JSON.stringify({id: String(index), method: request[0], params: {campaign: CAMPAIGN, ...request[1]}})).join('\n');
    const run = spawnSync(process.execPath, [join(REPO, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(REPO, 'content')],
        {cwd: REPO, input: `${input}\n`, encoding: 'utf8'});
    const frames = run.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress);
    for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
    return frames.map(frame => frame.result);
}
const TOLD = 'You drive across town and pull up at the Corbitt house.';
const ROW = {name: 't2-owed-1', turn: 2, kind: 'move', effect: {kind: 'move', to: 'corbitt-house-ground', via: 'Drove across town to the house.', travel_minutes: 30},
    quote: TOLD, what: 'arrival at The Corbitt House (corbitt-house-ground), via: Drove across town to the house.', job: '0'.repeat(64), at: '2026-09-29T00:00:00Z'};
const campaignDir = workspace => join(workspace, '.coc/campaigns', CAMPAIGN);
/** What `table.warn` writes for an owed-capable review of turn 2 (§158.3); that path is tests/extension/owed-state.test.mjs. */
const seedOwed = workspace => writeFileSync(join(campaignDir(workspace), 'owed.json'), JSON.stringify({open: [ROW], closed: []}));
/**
 * Turn 1 lands the party at the Hall of Records with the courts' flag set, so the courts are an open exit there and
 * nowhere near the house. Turn 2 told the player they reached the house and landed no move. `seed`: the review of
 * turn 2 has already recorded the owed arrival.
 */
const toldNoMove = seed => workspace => {
    const results = kernelSteps(workspace, [
        ['table.open', {}], ['table.player_input', {text: '我去档案馆查旧案。'}],
        ['table.apply', {call_id: 't1-c1', effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'},
            {kind: 'move', to: 'hall-of-records'}, {kind: 'flag', name: 'records-serious-crime-destination-known', value: true}]}],
        ['table.narrate', {call_id: 't1-c2', text: '档案员把卷宗推给你，指了指法院那边。'}],
        ['table.player_input', {text: '我开车去科比特宅。'}],
        ['table.narrate', {call_id: 't2-c1', text: `${TOLD} The gate hangs open in the wind.`}],
    ]);
    if (seed) seedOwed(workspace);
    return results;
};
/** A stub Jev that binds the look-alike whenever the compile offers it, and otherwise decides nothing. */
function stubJev(decisions) {
    return {decide: async batch => {
        decisions.push(batch);
        const pick = question => batch.family === COMPILE_FAMILY
            ? (question.key === 'destination' ? Object.entries(question.criteria).find(([, words]) => words?.handle === 'higher-courts-central-police')?.[0] ?? 'none' : 'none')
            : question.key === 'exit' ? 'finish' : Object.keys(question.criteria)[0] === 'now' ? 'later' : 'unknown';
        const answers = Object.fromEntries(batch.questions.map(question => { const choice = pick(question);
            return [question.key, {status: 'answered', type: 'choice', choice, confidence: 0.93, probabilities: {[choice]: 0.93}}]; }));
        return {batchId: batch.id, status: 'complete', answers, coverage: {required: Object.keys(answers), answered: Object.keys(answers), unknown: []}, issues: []};
    }};
}
async function turnThree(t, prepare, {extra = [], afterOpen} = {}) {
    const rows = [], decisions = [];
    const engine = createHybridEngine({env: process.env, record: row => rows.push(row), decision: stubJev(decisions)});
    const table = await openTable({realKernel: true, prepareWorkspace: prepare, env: {PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
        extraExtensions: [{name: 'coc-hybrid-engine', factory: engine.extension}, ...extra],
        responses: [fauxAssistantMessage([fauxToolCall('narrate', {text: '你推开门，蹲在小径旁看那些脚印。'})], {stopReason: 'toolUse'})]});
    t.after(() => table.dispose());
    await afterOpen?.(table);
    await table.session.prompt('我推开大门，蹲在小径旁看地上的脚印。');
    const record = JSON.parse(readFileSync(join(campaignDir(table.workspace), 'turns', '0003.json'), 'utf8'));
    const ledgerPath = join(campaignDir(table.workspace), 'owed.json');
    const owed = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : null;
    return {table, rows, record, owed};
}
const moves = record => record.receipts.filter(receipt => receipt.kind === 'move');

test('turn 27\'s shape: the owed arrival lands first and nothing is bound from the ledger\'s position', async t => {
    const {rows, record, owed} = await turnThree(t, toldNoMove(true));
    assert.equal(record.receipts[0].kind, 'move', 'the first landed receipt is the owed move');
    assert.deepEqual({to: record.receipts[0].to, owed: record.receipts[0].owed, told_turn: record.receipts[0].told_turn},
        {to: 'corbitt-house-ground', owed: 't2-owed-1', told_turn: 2});
    assert.deepEqual(moves(record).map(receipt => receipt.to), ['corbitt-house-ground'], 'never the look-alike the ledger could reach');
    assert.deepEqual(owed.open, []);
    assert.deepEqual(owed.closed.map(entry => [entry.name, entry.how, entry.receipt]), [['t2-owed-1', 'landed', record.receipts[0].id]]);
    const bind = rows.find(row => row.lane === 'run' && row.event === 'bind' && row.candidate === 'apply:owed:t2-owed-1');
    assert.equal(bind?.clerk, 'told_bookkeeping');
    // After the arrival, the run read again from the told position.
    const reads = rows.filter(row => row.lane === 'run' && row.event === 'read');
    assert.equal(reads[0].scene, 'hall-of-records');
    assert.ok(!reads[0].candidates.some(key => key.startsWith('apply:move:')), 'no move from the ledger\'s position while the arrival is owed');
    assert.ok(reads.some(row => row.scene === 'corbitt-house-ground'));
});

test('without the owed row the same stub walks the party to the look-alike: the ledger\'s position is what the builder read', async t => {
    const {record, owed} = await turnThree(t, toldNoMove(false));
    assert.equal(owed, null, 'no review recorded anything owed');
    assert.deepEqual(moves(record).map(receipt => receipt.to), ['higher-courts-central-police'], 'the control: this is what turn 27 did');
});

test('a review that lands during the first read is read before any candidate is built', async t => {
    let waits = 0;
    const {record, rows} = await turnThree(t, toldNoMove(false), {afterOpen: table => table.emit('coc:owed-review', {campaign: CAMPAIGN,
        // The review of turn 2 records the owed arrival while the run's first read is still going.
        settle: async () => { waits++; seedOwed(table.workspace); return {in_flight: true, waited_ms: 40, landed: true, turn: 2}; }})});
    assert.equal(waits, 1, 'the run waits once, on its first read');
    assert.deepEqual({to: record.receipts[0].to, owed: record.receipts[0].owed}, {to: 'corbitt-house-ground', owed: 't2-owed-1'});
    assert.deepEqual(moves(record).map(receipt => receipt.to), ['corbitt-house-ground']);
    const waited = rows.find(row => row.lane === 'run' && row.event === 'owed_wait');
    assert.deepEqual({waited_ms: waited.waited_ms, landed: waited.landed, turn: waited.turn}, {waited_ms: 40, landed: true, turn: 2});
});
