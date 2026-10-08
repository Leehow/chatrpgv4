/**
 * Contract §190.2: the ledger follows the told position.
 *
 * RD-08 (`rd-accept-blood-01-play`): the Keeper narrated the gas station, the town and the motel while the ledger kept the
 * party in the prologue for ten turns; §166's single pass had retired the only producer of owed moves. Here the same shape
 * runs on the haunting: the party stands in the Hall of Records, and the player is told they drove across town and went
 * down into the Corbitt house's basement, with no move. After the delivery the host reads where the text leaves them (a
 * controlled typed endpoint behind the real decision adapter), names the place through `table.owe`, and the next run's
 * clerk lands the owed arrival first. The delivery itself never waits for any of it.
 */
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, waitFor, waitForIdle} from './harness.mjs';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
import {COMPILE_FAMILY} from '../../runtime/jev/route-compile.ts';
import {TOLD_SENTENCES_MAX, toldDecision, toldQuestions, toldSentences, toldState} from '../../runtime/jev/told-position.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAMPAIGN = 'test-camp';
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const TOLD = 'You drive across town, let yourselves into the Corbitt house and go straight down to the basement.';
const DELIVERY = `${TOLD} The lamp gutters on the stair.`;
const BASEMENT = 'Corbitt House basement';

// ---- the questions, pure ---------------------------------------------------------------------------------------------

test('sentences are cut at Unicode sentence terminators and line breaks, each exactly as delivered, the last 24 kept', () => {
    const text = '你们开车进了镇子。加油站前，三个男人坐在遮阳棚下……\n\n「到了！」司机说。He said "Go now." Then he left. It was 3.5 miles; e.g. this one stays whole.\n* * *';
    const {sentences, total} = toldSentences(text);
    assert.deepEqual(sentences, ['你们开车进了镇子。', '加油站前，三个男人坐在遮阳棚下……', '「到了！」', '司机说。', 'He said "Go now."', 'Then he left.',
        'It was 3.5 miles; e.g. this one stays whole.']);
    assert.equal(total, 7);
    for (const sentence of sentences) assert.ok(text.includes(sentence), 'a sentence is the delivered text\'s own span');
    const long = Array.from({length: 30}, (_, index) => `Line ${index + 1}.`).join(' ');
    const kept = toldSentences(long);
    assert.equal(kept.total, 30);
    assert.equal(kept.sentences.length, TOLD_SENTENCES_MAX);
    assert.equal(kept.sentences.at(-1), 'Line 30.', 'where the party ends up is told last');
});

const INPUT = {campaign: CAMPAIGN, turn: 2, scene: {name: 'hall-of-records', display_name: 'Hall of Records', summary: 'The county records.'},
    candidates: [{name: 'basement-rites', display_name: BASEMENT, summary: 'Under the house.', source: 'window'},
        {name: 'central-library', display_name: 'Central Library', aliases: ['the library'], summary: 'Books.', source: 'exit'}],
    sentences: [TOLD, 'The lamp gutters on the stair.']};

test('one fanned-out request: the moved Noul, the place Choice with a none exit, the sentence Choice; places by alias, never by handle', () => {
    const questions = toldQuestions(INPUT);
    assert.deepEqual(questions.map(question => [question.key, question.type]), [['moved', 'noul'], ['place', 'choice'], ['sentence', 'choice']]);
    assert.deepEqual(Object.keys(questions[1].criteria), ['c0', 'c1', 'none']);
    assert.deepEqual(Object.keys(questions[2].criteria), ['s1', 's2']);
    const state = toldState(INPUT);
    assert.deepEqual(Object.keys(state.places), ['c0', 'c1']);
    assert.deepEqual(state.told, {s1: TOLD, s2: 'The lamp gutters on the stair.'});
    assert.equal(state.party_was_at.name, 'Hall of Records');
    assert.ok(!JSON.stringify([state, questions]).includes('basement-rites'), 'no handle reaches Jev');
});

test('the bars decide, in order, and the first one missed is the reason', () => {
    const bars = {movedMin: 0.85, placeMin: 0.7, sentenceMin: 0.5};
    const answered = (moved, chosen, confidence, sentence) => ({status: 'answered', moved, chosen, confidence, distribution: {}, elapsedMs: 1,
        usage: {inputTokens: 0, outputTokens: 0, costUsd: 0}, sentence: sentence === null ? null : {key: 's1', text: TOLD, confidence: sentence, distribution: {}}});
    assert.deepEqual(toldDecision(answered(0.95, 'basement-rites', 0.9, 0.8), bars, 'hall-of-records'), {decision: 'owe', handle: 'basement-rites', quote: TOLD});
    assert.deepEqual([answered(0.6, 'basement-rites', 0.9, 0.8), answered(0.95, null, 0.9, 0.8), answered(0.95, 'hall-of-records', 0.9, 0.8),
        answered(0.95, 'basement-rites', 0.5, 0.8), answered(0.95, 'basement-rites', 0.9, 0.3), answered(null, 'basement-rites', 0.9, 0.8)]
        .map(result => toldDecision(result, bars, 'hall-of-records').why), ['not_moved', 'none', 'same_scene', 'low_place', 'low_sentence', 'moved_unanswered']);
    assert.equal(toldDecision({status: 'failed', reason: 'timeout', elapsedMs: 1, usage: {}}, bars, 'x').why, 'timeout');
});

// ---- on the emitted kernel, through the real delivery paths ---------------------------------------------------------

/**
 * The typed endpoint: the told-position batch answers `moved`, puts `place` on the place named `target` (by the state's
 * place names) and `sentence` on the delivered sentence `sentence`; any other family's question gets a neutral answer.
 * `hold` (a promise) delays the told-position answer.
 */
function installJev(t, {moved = 0.95, target = BASEMENT, sentence = TOLD, confidence = 0.9, hold} = {}) {
    const original = globalThis.fetch, batches = [];
    globalThis.fetch = async (url, init) => {
        if (String(url) !== JEV_URL) return original(url, init);
        const body = JSON.parse(init.body), told = ['moved', 'place', 'sentence'].every(key => Object.hasOwn(body.questions, key));
        const state = typeof body.state === 'string' ? JSON.parse(body.state) : body.state;
        if (told) { batches.push({body, state}); await hold; }
        const pick = (key, question) => {
            if (told && key === 'place') return Object.keys(state.places).find(alias => state.places[alias].name === target) ?? 'none';
            if (told && key === 'sentence') return Object.keys(state.told).find(alias => state.told[alias] === sentence) ?? Object.keys(question.criteria)[0];
            return Object.keys(question.criteria)[0];
        };
        const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
            if (question.type === 'noul') return [key, {type: 'noul', noul: told && key === 'moved' ? moved : 0.05}];
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

function kernelSteps(workspace, requests) {
    const input = requests.map((request, index) => JSON.stringify({id: String(index), method: request[0], params: {campaign: CAMPAIGN, ...request[1]}})).join('\n');
    const run = spawnSync(process.execPath, [join(REPO, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(REPO, 'content')],
        {cwd: REPO, input: `${input}\n`, encoding: 'utf8'});
    for (const frame of run.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress))
        if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
/** Turn 1 lands the party at the Hall of Records; turn 2 is the player's, through the session. */
const atTheHall = workspace => kernelSteps(workspace, [['table.open', {}], ['table.player_input', {text: '我去档案馆查旧案。'}],
    ['table.apply', {call_id: 't1-c1', effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'hall-of-records'}]}],
    ['table.narrate', {call_id: 't1-c2', text: '档案员把卷宗推给你。'}]]);

const dir = workspace => join(workspace, '.coc/campaigns', CAMPAIGN);
const ledger = workspace => existsSync(join(dir(workspace), 'owed.json')) ? JSON.parse(readFileSync(join(dir(workspace), 'owed.json'), 'utf8')) : null;
const turnRecord = (workspace, turn) => JSON.parse(readFileSync(join(dir(workspace), 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
const toldRows = table => table.telemetry().filter(row => row.lane === 'told-position');
const toldRow = table => waitFor(() => toldRows(table)[0], {label: 'the told-position row', timeoutMs: 15_000});
const narrate = text => fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'});
const ENV = {EXT_JEV_APIKEY: 'test-jev-key', PI_COC_TOLD_POSITION: 'on'};

/** A run's Jev that binds nothing the player's words could choose: no destination, no check. The owed rows are forced. */
function stillJev() {
    return {decide: async batch => {
        const pick = question => batch.family === COMPILE_FAMILY ? 'none'
            : question.key === 'exit' ? 'finish' : Object.keys(question.criteria)[0] === 'now' ? 'later' : 'unknown';
        const answers = Object.fromEntries(batch.questions.map(question => { const choice = pick(question);
            return [question.key, {status: 'answered', type: 'choice', choice, confidence: 0.93, probabilities: {[choice]: 0.93}}]; }));
        return {batchId: batch.id, status: 'complete', answers, coverage: {required: Object.keys(answers), answered: Object.keys(answers), unknown: []}, issues: []};
    }};
}

test('RD-08\'s shape: a delivery that tells the party into a place with no move owes it, and the next run lands it first', async t => {
    const batches = installJev(t), rows = [];
    const engine = createHybridEngine({env: process.env, record: row => rows.push(row), decision: stillJev()});
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: {...ENV, PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
        extraExtensions: [{name: 'coc-hybrid-engine', factory: engine.extension}],
        responses: [narrate(DELIVERY), narrate('你蹲在台阶下，看那些湿脚印。')]});
    t.after(() => table.dispose());
    await table.session.prompt('我开车去科比特宅，直接下到地下室。');
    const row = await toldRow(table);
    assert.deepEqual({outcome: row.outcome, decision: row.decision, handle: row.handle, owed: row.owed, mode: row.mode},
        {outcome: 'owed', decision: 'owe', handle: 'basement-rites', owed: 't2-owed-1', mode: 'on'});
    assert.ok(row.distribution['basement-rites'] >= 0.9 && row.moved === 0.95 && row.sentence.key === 's1');
    assert.deepEqual(row.sentences, {total: 2, offered: 2});
    assert.ok(row.candidates.includes('basement-rites') && !row.candidates.includes('hall-of-records'));
    assert.equal(batches.length, 1, 'one request for the delivery');
    assert.deepEqual(turnRecord(table.workspace, 2).receipts.filter(receipt => receipt.kind === 'move'), [], 'the delivery landed no move');
    const [owed] = ledger(table.workspace).open;
    assert.deepEqual({name: owed.name, to: owed.effect.to, quote: owed.quote, source: owed.source}, {name: 't2-owed-1', to: 'basement-rites', quote: TOLD, source: 'told-position'});

    await table.session.prompt('我蹲下来看台阶上的脚印。');
    const record = turnRecord(table.workspace, 3);
    assert.deepEqual({kind: record.receipts[0].kind, to: record.receipts[0].to, owed: record.receipts[0].owed, told_turn: record.receipts[0].told_turn},
        {kind: 'move', to: 'basement-rites', owed: 't2-owed-1', told_turn: 2}, 'the told arrival is the first receipt of the next turn');
    const bind = rows.find(entry => entry.lane === 'run' && entry.event === 'bind' && entry.candidate === 'apply:owed:t2-owed-1');
    assert.equal(bind?.clerk, 'told_bookkeeping');
    assert.deepEqual(ledger(table.workspace).open, []);
    assert.deepEqual(ledger(table.workspace).closed.map(entry => [entry.name, entry.how]), [['t2-owed-1', 'landed']]);
    // The owed landing is turn 2's position, not turn 3's own move: turn 3's delivery is still read (and stays, in the basement).
    const third = await waitFor(() => toldRows(table).find(entry => entry.turn === 3), {label: 'turn 3\'s told-position row', timeoutMs: 15_000});
    assert.deepEqual({skipped: third.skipped, decision: third.decision, why: third.why}, {skipped: undefined, decision: 'stay', why: 'none'});
    assert.equal(batches.length, 2);
});

test('a delivery whose turn landed a move is not read and owes nothing', async t => {
    const batches = installJev(t);
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: ENV,
        responses: [fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'move', to: 'central-library'}]})], {stopReason: 'toolUse'}),
            narrate(DELIVERY)]});
    t.after(() => table.dispose());
    await table.session.prompt('我去中央图书馆。');
    const row = await toldRow(table);
    assert.deepEqual({skipped: row.skipped, landed: row.landed}, {skipped: 'move_landed', landed: ['central-library']});
    assert.equal(batches.length, 0, 'Jev was never asked');
    assert.equal(ledger(table.workspace), null);
});

test('a move the review refused and the Keeper then told is owed: a refusal is not a receipt', async t => {
    installJev(t);
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: ENV,
        laneResponses: {admission: [fauxAssistantMessage(JSON.stringify({verdict: 'not_authorized', grounds: 'the player only asked about the records'}))]},
        responses: [fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'move', to: 'corbitt-house-ground'}]})], {stopReason: 'toolUse'}),
            narrate(DELIVERY)]});
    t.after(() => table.dispose());
    await table.session.prompt('我开车去科比特宅，直接下到地下室。');
    const row = await toldRow(table);
    assert.ok(table.telemetry().some(entry => entry.tool === 'apply' && entry.reason === 'action_not_authorized'), 'the review refused the move');
    assert.deepEqual(turnRecord(table.workspace, 2).receipts.filter(receipt => receipt.kind === 'move'), []);
    assert.deepEqual({outcome: row.outcome, owed: row.owed}, {outcome: 'owed', owed: 't2-owed-1'});
    assert.equal(ledger(table.workspace).open[0].effect.to, 'basement-rites');
});

test('shadow (the env override since on ships), on the implicit close: the row says what on would do, and nothing is owed', async t => {
    const batches = installJev(t);
    let port;
    // §201.1: the told-clue read shares the turn's flight and ships on; it is turned off so this asserts the position read alone.
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: {EXT_JEV_APIKEY: 'test-jev-key', PI_COC_TOLD_POSITION: 'shadow', PI_COC_TOLD_CLUE: 'off'},
        responses: [fauxAssistantMessage(DELIVERY)],
        extraExtensions: [{name: 'owed-port-probe', factory: pi => pi.events.on('coc:owed-review', value => { port = value; })}]});
    t.after(() => table.dispose());
    await table.session.prompt('我开车去科比特宅，直接下到地下室。');
    assert.equal(port.watch().in_flight, false, 'a read that cannot owe is no flight for the next run to watch');
    const row = await toldRow(table);
    assert.equal(turnRecord(table.workspace, 2).closed_how, 'implicit', 'the host closed the turn with the Keeper\'s prose');
    assert.deepEqual({mode: row.mode, outcome: row.outcome, decision: row.decision, handle: row.handle, owed: row.owed},
        {mode: 'shadow', outcome: 'shadow', decision: 'owe', handle: 'basement-rites', owed: null});
    assert.equal(batches.length, 1);
    assert.equal(ledger(table.workspace), null, 'shadow writes the row only');
    assert.equal(turnRecord(table.workspace, 2).owed, undefined);
    assert.equal(JSON.parse(readFileSync(join(REPO, 'content/rulesets/coc7/host-budgets.json'), 'utf8')).told_position.mode, 'on', 'owner ruling 2026-10-07 after TP-05: on ships');
});

test('the read never holds the delivery; the next run\'s watch sees it in flight and landed once the row is written', async t => {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const batches = installJev(t, {hold});
    let port;
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: ENV, responses: [narrate(DELIVERY)],
        extraExtensions: [{name: 'owed-port-probe', factory: pi => pi.events.on('coc:owed-review', value => { port = value; })}]});
    t.after(() => table.dispose());
    await table.session.prompt('我开车去科比特宅，直接下到地下室。');
    await waitForIdle(table.session);
    await waitFor(() => batches.length === 1, {label: 'the held told-position request'});
    assert.equal(toldRows(table).length, 0, 'the delivery finished while the read was still waiting on Jev');
    const watch = port.watch();
    assert.deepEqual({in_flight: watch.in_flight, turn: watch.turn, landed: watch.landed()}, {in_flight: true, turn: 2, landed: false});
    release();
    await toldRow(table);
    await waitFor(() => watch.landed(), {label: 'the watch to see the owed row land'});
    assert.equal(ledger(table.workspace).open[0].name, 't2-owed-1');
    assert.equal(port.watch().in_flight, false, 'the flight is cleared once the read ended');
});

test('a read that owes nothing never settles the watch, so the next run does not read the table again for it', async t => {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const batches = installJev(t, {hold, moved: 0.2});
    let port;
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: ENV, responses: [narrate(DELIVERY)],
        extraExtensions: [{name: 'owed-port-probe', factory: pi => pi.events.on('coc:owed-review', value => { port = value; })}]});
    t.after(() => table.dispose());
    await table.session.prompt('我开车去科比特宅，直接下到地下室。');
    await waitFor(() => batches.length === 1, {label: 'the held told-position request'});
    const watch = port.watch();
    assert.equal(watch.in_flight, true);
    release();
    const row = await toldRow(table);
    assert.deepEqual({decision: row.decision, why: row.why, owed: row.owed}, {decision: 'stay', why: 'not_moved', owed: null});
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(watch.landed(), false, 'nothing landed for a read to pick up');
    assert.equal(port.watch().in_flight, false);
    assert.equal(ledger(table.workspace), null);
});
