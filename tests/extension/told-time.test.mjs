/**
 * Contract §216: time the prose told and no receipt carries is owed.
 *
 * Live 9e7g, turn 32 (campaign game-dcad7727-...): the player walked round the Corbitt house checking the windows, the side
 * door and the footing; the clerk's first step was refused, the declared-time step never ran, the Keeper made no call and
 * the implicit close told the whole circuit with zero receipts. The clock stayed at 11:57. §166 had retired the only
 * producer of owed time (§158.2's continuity review), and nothing read the told time. Here the same shape runs on the
 * haunting: after the delivery the host reads the told time (a controlled typed endpoint behind the real decision adapter),
 * names a time-cost row through `table.owe`, and the next run's clerk lands it first; the kernel rolls the band.
 */
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, waitFor} from './harness.mjs';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
import {COMPILE_FAMILY} from '../../runtime/jev/route-compile.ts';
import {toldTimeDecision, toldTimeQuestions, toldTimeState} from '../../runtime/jev/told-time.ts';
import {readToldTime} from '../../extensions/kernel/told-time.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAMPAIGN = 'test-camp';
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
// Turn 32's delivery, in the haunting's words: a circuit of the house told, nothing landed.
const CIRCUIT = '你沿着房子左侧的窄道绕到屋后，一扇一扇看过一楼的窗框，又蹲下顺着墙基看了一圈。';
const DELIVERY = `${CIRCUIT}钉子是从里面钉进去的，窗扇推不动。风从办公楼的夹缝里下来，带着煤烟。`;
const OWED_STATE_FIX = 'Already told: the player was told this happened, so it did, and the ledger owes it.';

// ---- the questions, pure ---------------------------------------------------------------------------------------------

const BANDS = [
    {handle: 'momentary', min: 0, max: 1, default: 0, covers: 'An act of a moment.'},
    {handle: 'brief_activity', min: 2, max: 10, default: 5, covers: 'A few minutes of one simple activity.'},
    {handle: 'single_room_search', min: 10, max: 45, default: 20, covers: 'Searching one room or one small area.'},
    {handle: 'local_travel', min: 10, max: 120, default: 30, covers: 'A journey across a town.'},
];
const INPUT = {campaign: CAMPAIGN, turn: 2, bands: BANDS, sentences: [CIRCUIT, '风从办公楼的夹缝里下来。']};

test('one request: the told_cost Choice (none first, no road row, each row\'s covers), the sentence Choice and the extent Choice; the state is the told text alone', () => {
    const questions = toldTimeQuestions(INPUT);
    assert.deepEqual(questions.map(question => [question.key, question.type]), [['told_cost', 'choice'], ['sentence', 'choice'], ['told_extent', 'choice']]);
    assert.deepEqual(Object.keys(questions[2].criteria), ['begun', 'carried', 'unknown'], '§218.4: how far the text carries the activity');
    assert.deepEqual(Object.keys(questions[0].criteria), ['none', 'momentary', 'brief_activity', 'single_room_search'], 'a journey is its move\'s');
    assert.match(questions[0].criteria.single_room_search, /10 to 45 minutes: Searching one room or one small area\./);
    assert.deepEqual(Object.keys(questions[1].criteria), ['s1', 's2']);
    const state = toldTimeState(INPUT);
    assert.deepEqual(state, {told: {s1: CIRCUIT, s2: '风从办公楼的夹缝里下来。'}}, 'no clock, no receipts, no player words');
});

test('the bars decide, in order, and the first one missed is the reason', () => {
    const bars = {costMin: 0.7, sentenceMin: 0.5, minDefaultMinutes: 5, extentMin: 0.5};
    const answered = (chosen, confidence, sentence, extent = {choice: 'carried', top: 0.8}) => ({status: 'answered', chosen, confidence, distribution: {}, elapsedMs: 1,
        usage: {inputTokens: 0, outputTokens: 0, costUsd: 0}, sentence: sentence === null ? null : {key: 's1', text: CIRCUIT, confidence: sentence, distribution: {}},
        extent: extent && {...extent, distribution: {}}});
    assert.deepEqual(toldTimeDecision(answered('single_room_search', 0.9, 0.8), bars, BANDS), {decision: 'owe', band: 'single_room_search', quote: CIRCUIT});
    assert.deepEqual(toldTimeDecision(answered('brief_activity', 0.9, 0.8), bars, BANDS), {decision: 'owe', band: 'brief_activity', quote: CIRCUIT},
        'a row whose default reaches the floor is owed');
    assert.deepEqual([answered(null, 0.9, 0.8), answered('single_room_search', 0.5, 0.8), answered('momentary', 0.95, 0.8),
        answered('single_room_search', 0.9, null), answered('single_room_search', 0.9, 0.3), answered('unknown_row', 0.9, 0.8)]
        .map(result => toldTimeDecision(result, bars, BANDS).why), ['none', 'low_cost', 'under_floor', 'sentence_unanswered', 'low_sentence', 'under_floor']);
    assert.equal(toldTimeDecision({status: 'failed', reason: 'timeout', elapsedMs: 1, usage: {}}, bars, BANDS).why, 'timeout');
    // §218.4: the fifth bar -- owed only when the text carried the activity.
    assert.deepEqual([answered('single_room_search', 0.9, 0.8, {choice: 'begun', top: 0.7}), answered('single_room_search', 0.9, 0.8, {choice: 'carried', top: 0.4}),
        answered('single_room_search', 0.9, 0.8, {choice: 'unknown', top: 0.6}), answered('single_room_search', 0.9, 0.8, null)]
        .map(result => toldTimeDecision(result, bars, BANDS).why), ['begun', 'low_extent', 'low_extent', 'low_extent']);
});

// §218.4, live d6c turn 51: the delivery told only the start of the records search (the deed register opened at the house's
// entry, the death certificates still unopened). The read answered record_lookup .97 and its sentence .90 and owed it; the
// player's next declaration continued the same search, so t52 rolled record_lookup twice (31 + 29 minutes).
const T51_SENTENCE = '你把采访本和钢笔搁在手边，先按住地契册，从科比特街那栋红砖的条目翻起。';
const T51 = (extent) => ({status: 'answered', chosen: 'record_lookup', confidence: 0.97, elapsedMs: 1016, usage: {inputTokens: 2435, outputTokens: 309, costUsd: 0},
    distribution: {none: 0, quick_observation: 0.01, library_research: 0.01, brief_activity: 0.01, record_lookup: 0.97},
    sentence: {key: 's11', text: T51_SENTENCE, confidence: 0.9, distribution: {s11: 0.91, s12: 0.06}}, extent});
const T51_BANDS = [...BANDS, {handle: 'record_lookup', min: 10, max: 45, default: 20, covers: 'Looking up one record or one set of files.'}];
test('§218.4 t51\'s captured read: a search the delivery only began is not owed; carried, it is', () => {
    const bars = {costMin: 0.7, sentenceMin: 0.5, minDefaultMinutes: 5, extentMin: 0.5};
    assert.deepEqual(toldTimeDecision(T51({choice: 'begun', top: 0.78, distribution: {begun: 0.78, carried: 0.2, unknown: 0.02}}), bars, T51_BANDS),
        {decision: 'stay', why: 'begun'}, 'the base owed record_lookup here');
    assert.deepEqual(toldTimeDecision(T51({choice: 'carried', top: 0.8, distribution: {begun: 0.18, carried: 0.8, unknown: 0.02}}), bars, T51_BANDS),
        {decision: 'owe', band: 'record_lookup', quote: T51_SENTENCE});
});

// §218.4, live d6c turn 44: an out-of-fiction answer (the player asked what day it was) was read as tome_study .30.
test('§218.4 an out-of-fiction delivery is not read: nothing is asked of the kernel or Jev', async () => {
    const rows = [], calls = [];
    const owed = await readToldTime({env: {EXT_JEV_APIKEY: 'test-jev-key', PI_COC_TOLD_TIME: 'on'}, campaign: CAMPAIGN, turn: 44, scope: 'reference',
        text: '场外说清楚。故事里现在仍是十月十三日晚上，大约九点。', call: async (method) => { calls.push(method); return {}; }, record: row => rows.push(row),
        budget: {mode: 'on', costMin: 0.7, sentenceMin: 0.5, extentMin: 0.5, minDefaultMinutes: 5, timeoutMs: 1000}});
    assert.equal(owed, null);
    assert.deepEqual(calls, []);
    assert.deepEqual(rows.map(row => [row.lane, row.skipped]), [['told-time', 'out_of_fiction']]);
});

// ---- the emitted kernel's RPC ----------------------------------------------------------------------------------------

function frames(workspace, requests) {
    const input = requests.map((request, index) => JSON.stringify({id: String(index), method: request[0],
        params: request[0] === 'campaign.create' ? request[1] : {campaign: CAMPAIGN, ...request[1]}})).join('\n');
    const run = spawnSync(process.execPath, [join(REPO, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(REPO, 'content')],
        {cwd: REPO, input: `${input}\n`, encoding: 'utf8'});
    return run.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress);
}
function steps(workspace, requests) {
    const all = frames(workspace, requests);
    for (const frame of all) if (!frame.ok) throw new Error(`kernel step ${frame.id} (${requests[Number(frame.id)][0]}) failed: ${JSON.stringify(frame.error)}`);
    return all.map(frame => frame.result);
}
const TURN_ONE = [['table.open', {}], ['table.player_input', {text: '我去档案馆查旧案。'}],
    ['table.apply', {call_id: 't1-c1', effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'hall-of-records'},
        {kind: 'time', minutes: 30, why: 'The records search.', beyond_travel: true}]}],
    ['table.narrate', {call_id: 't1-c2', text: '档案员把卷宗推给你。'}]];
/** Turn 1 lands the party at the Hall of Records with 30 minutes; turn 2 tells a circuit with no receipt. */
function toldTurnTwo(t) {
    const workspace = mkdtempSync(join(tmpdir(), 'told-time-'));
    t.after(() => rmSync(workspace, {recursive: true, force: true}));
    steps(workspace, [['campaign.create', {id: CAMPAIGN, module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans', title: 'told time'}],
        ...TURN_ONE, ['table.player_input', {text: '我绕到房子后面，看一楼的窗户和侧门。'}], ['table.narrate', {call_id: 't2-c1', text: DELIVERY}]]);
    return workspace;
}
const owe = (band, quote = CIRCUIT, turn = 2) => ['table.owe', {turn, effect: {kind: 'time', band}, quote, source: 'told-time'}];
const dir = workspace => join(workspace, '.coc/campaigns', CAMPAIGN);
const ledger = workspace => existsSync(join(dir(workspace), 'owed.json')) ? JSON.parse(readFileSync(join(dir(workspace), 'owed.json'), 'utf8')) : null;
const turnRecord = (workspace, turn) => JSON.parse(readFileSync(join(dir(workspace), 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
const world = workspace => JSON.parse(readFileSync(join(dir(workspace), 'world.json'), 'utf8'));

test('options: the told turn\'s time receipts, its session, and the time-cost rows an act can take', t => {
    const workspace = toldTurnTwo(t);
    const [two, one] = steps(workspace, [['table.owe.options', {turn: 2}], ['table.owe.options', {turn: 1}]]);
    assert.deepEqual(two.time, {receipts: [], session: false});
    assert.deepEqual(one.time.receipts, [{minutes: 30}]);
    const handles = two.time_bands.map(row => row.handle);
    assert.ok(handles.includes('single_room_search') && handles.includes('brief_activity'));
    assert.ok(!handles.includes('local_travel') && !handles.includes('long_travel'), 'a road\'s rows are the move\'s');
    const row = two.time_bands.find(entry => entry.handle === 'single_room_search');
    assert.deepEqual({min: row.min, max: row.max, default: row.default}, {min: 10, max: 45, default: 20});
    assert.match(row.covers, /one room or one small area/);
});

test('owe: the row is §158.3\'s -- on the record, in owed.json, with its owed_state warning -- and a turn owes told time once', t => {
    const workspace = toldTurnTwo(t);
    const [first, again, other] = steps(workspace, [owe('single_room_search'), owe('single_room_search'), owe('brief_activity')]);
    assert.deepEqual(first, {turn: 2, owed: 't2-owed-1'});
    assert.deepEqual(again, {turn: 2, owed: 't2-owed-1'}, 'the same read sent again answers the row it wrote');
    assert.deepEqual(other, {turn: 2, owed: 't2-owed-1'}, 'one told time per turn');
    const {open, closed} = ledger(workspace);
    assert.deepEqual(closed, []);
    assert.equal(open.length, 1);
    const [row] = open;
    assert.deepEqual({name: row.name, turn: row.turn, kind: row.kind, effect: row.effect, quote: row.quote, source: row.source, what: row.what},
        {name: 't2-owed-1', turn: 2, kind: 'time', effect: {kind: 'time', band: 'single_room_search'}, quote: CIRCUIT, source: 'told-time',
            what: 'time that passed beyond any journey: single_room_search'});
    const record = turnRecord(workspace, 2);
    assert.deepEqual(record.owed.map(entry => entry.name), ['t2-owed-1']);
    const warning = record.warnings.find(entry => entry.kind === 'owed_state');
    assert.deepEqual({lane: warning.lane, owed: warning.owed}, {lane: 'told-time', owed: 't2-owed-1'});
    assert.ok(warning.fix.startsWith(OWED_STATE_FIX));
});

test('owe drops what it cannot owe, as an answer, and writes nothing', t => {
    const workspace = toldTurnTwo(t);
    const answers = steps(workspace, [owe('local_travel'), owe('hours'), owe('single_room_search', '你从来没有绕到屋后。'),
        owe('single_room_search', '档案员把卷宗推给你。', 1)]);
    assert.deepEqual(answers.map(answer => answer.dropped), ['unknown_band', 'unknown_band', 'quote_not_delivered', 'time_landed']);
    assert.ok(answers.every(answer => answer.owed === null));
    assert.equal(ledger(workspace), null, 'no owed.json');
    assert.equal(turnRecord(workspace, 2).owed, undefined);
});

test('owe refuses a malformed call', t => {
    const workspace = toldTurnTwo(t);
    const refused = frames(workspace, [
        ['table.owe', {turn: 2, effect: {kind: 'time', minutes: 20}, quote: CIRCUIT, source: 'told-time'}],
        ['table.owe', {turn: 2, effect: {kind: 'move', to: 'basement-rites'}, quote: CIRCUIT, source: 'told-time'}],
        ['table.owe', {turn: 2, effect: {kind: 'time', band: 'single_room_search'}, quote: '', source: 'told-time'}]]);
    assert.deepEqual(refused.map(frame => frame.ok ? 'ok' : frame.error.code), Array(3).fill('invalid_params'));
});

test('the capsule shows the told time to the clerk, and apply time {band, owed} lands it: the kernel rolls the band', t => {
    const workspace = toldTurnTwo(t);
    const before = world(workspace).clock.minutes;
    const [, , capsule] = steps(workspace, [owe('single_room_search'), ['table.player_input', {text: '我看看侧门的锁。'}], ['table.capsule', {}]]);
    const shown = capsule.owed.find(entry => entry.name === 't2-owed-1');
    assert.deepEqual({kind: shown.kind, clerk: shown.clerk, effect: shown.effect}, {kind: 'time', clerk: true, effect: {kind: 'time', band: 'single_room_search'}});
    steps(workspace, [['table.apply', {call_id: 't3-c1', effects: [{kind: 'time', band: 'single_room_search', owed: 't2-owed-1'}]}]]);
    const turn = JSON.parse(readFileSync(join(dir(workspace), 'turn.json'), 'utf8'));
    const receipt = turn.receipts.find(entry => entry.kind === 'time');
    assert.deepEqual({owed: receipt.owed, told_turn: receipt.told_turn}, {owed: 't2-owed-1', told_turn: 2});
    assert.ok(receipt.minutes >= 10 && receipt.minutes <= 45, `rolled inside the row: ${receipt.minutes}`);
    assert.equal(world(workspace).clock.minutes - before, receipt.minutes, 'the clock moved by the rolled minutes');
    const {open, closed} = ledger(workspace);
    assert.deepEqual(open, []);
    assert.deepEqual(closed.map(entry => [entry.name, entry.how]), [['t2-owed-1', 'landed']]);
});

// ---- through the real delivery path --------------------------------------------------------------------------------

/**
 * The typed endpoint: the told-time batch puts `told_cost` on `band` and `sentence` on the delivered sentence `sentence`;
 * every other family's Choice gets its first criterion and every Noul 0.05 (no move, no clue given).
 */
function installJev(t, {band = 'single_room_search', sentence = CIRCUIT, confidence = 0.9, extent = 'carried'} = {}) {
    const original = globalThis.fetch, batches = [];
    globalThis.fetch = async (url, init) => {
        if (String(url) !== JEV_URL) return original(url, init);
        const body = JSON.parse(init.body), told = ['told_cost', 'sentence'].every(key => Object.hasOwn(body.questions, key));
        const state = typeof body.state === 'string' ? JSON.parse(body.state) : body.state;
        if (told) batches.push({body, state});
        const pick = (key, question) => {
            if (told && key === 'told_cost') return band;
            if (told && key === 'told_extent') return extent;
            if (told && key === 'sentence') return Object.keys(state.told).find(alias => state.told[alias] === sentence) ?? Object.keys(question.criteria)[0];
            return Object.keys(question.criteria)[0];
        };
        const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
            if (question.type === 'noul') return [key, {type: 'noul', noul: 0.05}];
            if (question.type === 'choice') {
                const keys = Object.keys(question.criteria), choice = pick(key, question), rest = (1 - confidence) / Math.max(1, keys.length - 1);
                return [key, {type: 'choice', choice, confidence, probabilities: Object.fromEntries(keys.map(k => [k, k === choice ? confidence : rest]))}];
            }
            const levels = question.criteria.map((_, index) => String(index));
            return [key, {type: 'score', score: 0, confidence: 0.9, legend: Object.fromEntries(levels.map((level, index) => [level, question.criteria[index]])),
                probabilities: Object.fromEntries(levels.map(level => [level, level === '0' ? 1 : 0]))}];
        }));
        return new Response(JSON.stringify({model: 'jev-1.13.0', answers, usage: {input_tokens: 400, output_tokens: 10}}), {status: 200});
    };
    t.after(() => { globalThis.fetch = original; });
    return batches;
}

/** A run's Jev that binds nothing the player's words could choose: no destination, no check, no declared time. */
function stillJev() {
    return {decide: async batch => {
        const pick = question => batch.family === COMPILE_FAMILY ? 'none'
            : question.key === 'exit' ? 'finish' : Object.keys(question.criteria)[0] === 'now' ? 'later' : 'unknown';
        const answers = Object.fromEntries(batch.questions.map(question => { const choice = pick(question);
            return [question.key, {status: 'answered', type: 'choice', choice, confidence: 0.93, probabilities: {[choice]: 0.93}}]; }));
        return {batchId: batch.id, status: 'complete', answers, coverage: {required: Object.keys(answers), answered: Object.keys(answers), unknown: []}, issues: []};
    }};
}

const atTheHall = workspace => steps(workspace, TURN_ONE);
const toldTimeRows = table => table.telemetry().filter(row => row.lane === 'told-time');
const narrate = text => fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'});
const ENV = {EXT_JEV_APIKEY: 'test-jev-key', PI_COC_TOLD_TIME: 'on'};

test('turn 32\'s shape: an implicit close that tells a circuit with no receipt owes the time, and the next run lands it first', async t => {
    const batches = installJev(t), rows = [];
    const engine = createHybridEngine({env: process.env, record: row => rows.push(row), decision: stillJev()});
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: {...ENV, PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
        extraExtensions: [{name: 'coc-hybrid-engine', factory: engine.extension}],
        responses: [fauxAssistantMessage(DELIVERY), narrate('锁孔里有灰。')]});
    t.after(() => table.dispose());
    const before = world(table.workspace).clock.minutes;
    await table.session.prompt('我顺着房子左边那条窄道绕到后面，仔细看一楼的窗户、侧门和门锁，再蹲下看看靠地面有没有地下室的窗。');
    const row = await waitFor(() => toldTimeRows(table).find(entry => entry.turn === 2), {label: 'turn 2\'s told-time row', timeoutMs: 15_000});
    assert.equal(turnRecord(table.workspace, 2).closed_how, 'implicit', 'the host closed the turn with the Keeper\'s prose');
    assert.deepEqual(turnRecord(table.workspace, 2).receipts.filter(receipt => receipt.kind === 'time'), [], 'the delivery charged no time');
    assert.deepEqual({mode: row.mode, decision: row.decision, band: row.band, outcome: row.outcome, owed: row.owed},
        {mode: 'on', decision: 'owe', band: 'single_room_search', outcome: 'owed', owed: 't2-owed-1'});
    assert.equal(row.sentence.key, 's1');
    assert.ok(!row.bands.includes('local_travel'));
    assert.equal(batches.length, 1, 'one request for the delivery');
    assert.equal(world(table.workspace).clock.minutes, before, 'the read wrote no clock: only the owed row');

    await table.session.prompt('我凑近看侧门的锁。');
    const record = turnRecord(table.workspace, 3);
    const first = record.receipts[0];
    assert.deepEqual({kind: first.kind, band: first.band, owed: first.owed, told_turn: first.told_turn},
        {kind: 'time', band: 'single_room_search', owed: 't2-owed-1', told_turn: 2}, 'the told time is the first receipt of the next turn');
    assert.ok(first.minutes >= 10 && first.minutes <= 45);
    assert.ok(world(table.workspace).clock.minutes - before >= first.minutes, 'the clock moved');
    const bind = rows.find(entry => entry.lane === 'run' && entry.event === 'bind' && entry.candidate === 'apply:owed:t2-owed-1');
    assert.equal(bind?.clerk, 'told_bookkeeping');
    assert.deepEqual(ledger(table.workspace).closed.map(entry => [entry.name, entry.how]), [['t2-owed-1', 'landed']]);
});

test('a delivery whose turn charged its own time is not read and owes nothing', async t => {
    const batches = installJev(t);
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: ENV,
        responses: [fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'time', minutes: 20, why: 'Walking round the house.'}]})], {stopReason: 'toolUse'}),
            narrate(DELIVERY)]});
    t.after(() => table.dispose());
    await table.session.prompt('我绕到房子后面，看一楼的窗户和侧门。');
    const row = await waitFor(() => toldTimeRows(table)[0], {label: 'the told-time row', timeoutMs: 15_000});
    assert.deepEqual({skipped: row.skipped, landed: row.landed}, {skipped: 'time_landed', landed: [20]});
    assert.equal(batches.length, 0, 'Jev was never asked');
    assert.equal(ledger(table.workspace), null);
});
