/**
 * Contract §218.2: time is charged once a turn, by the clerk or by the Keeper. Live d6c turn 45 (campaign game-dcad7727-...):
 * the clerk's declared `until 07:00` landed first (1,016 minutes), then the Keeper's batch charged its own 570-minute sleep
 * with `beyond_travel` and the ledger read 10-18 17:00 against a prose 07:00. §138.10's "time is charged once a turn" bound
 * only the clerk. Here, through the hybrid engine's model step on the real kernel: after the clerk's declared time lands,
 * the Keeper's apply carrying another time effect is refused `declared_time_landed` before anything in it runs; without a
 * clerk time the Keeper's own time lands as before.
 */
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable} from './harness.mjs';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
import {COMPILE_FAMILY} from '../../runtime/jev/route-compile.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAMPAIGN = 'test-camp';
const campaignDir = workspace => join(workspace, '.coc/campaigns', CAMPAIGN);
function kernelSteps(workspace, requests) {
    const input = requests.map((request, index) => JSON.stringify({id: String(index), method: request[0], params: {campaign: CAMPAIGN, ...request[1]}})).join('\n');
    const run = spawnSync(process.execPath, [join(REPO, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(REPO, 'content')],
        {cwd: REPO, input: `${input}\n`, encoding: 'utf8'});
    const frames = run.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress);
    for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
    return frames;
}
const atTheHall = workspace => kernelSteps(workspace, [
    ['table.open', {}], ['table.player_input', {text: 'I go to the Hall of Records.'}],
    ['table.apply', {call_id: 't1-c1', effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'hall-of-records'}]}],
    ['table.narrate', {call_id: 't1-c2', text: 'The clerk pushes the ledgers across the counter.'}]]);

/** A full distribution: `choice` carries `top`, the rest is spread over the other options. */
const full = (keys, choice, top = 0.93) => Object.fromEntries(keys.map(key => [key, key === choice ? top : (1 - top) / (keys.length - 1)]));
/** A run's Jev: the compile binds nothing, the declared time costs (`costs`) or not, the band reads single_room_search, no stated measure. */
function timeJev(costs) {
    return {decide: async batch => {
        const pick = question => {
            const keys = Array.isArray(question.criteria) ? [] : Object.keys(question.criteria);
            if (batch.family === COMPILE_FAMILY) return keys.includes('none') ? 'none' : keys[0];
            if (question.key === 'exit' || question.key.startsWith('exit__')) return 'finish';
            if (keys[0] === 'costs') return costs ? 'costs' : 'none';
            if (keys[0] === 'now') return 'later';
            if (question.key.startsWith('band')) return 'single_room_search';
            if (question.key.startsWith('stated_end:hour') || question.key.startsWith('stated_span:unit')) return 'none';
            return keys.includes('unknown') ? 'unknown' : keys.at(-1);
        };
        const answers = Object.fromEntries(batch.questions.map(question => {
            const keys = Object.keys(question.criteria), choice = pick(question);
            return [question.key, {status: 'answered', type: 'choice', choice, confidence: 0.9, probabilities: full(keys, choice)}];
        }));
        return {batchId: batch.id, status: 'complete', answers, coverage: {required: Object.keys(answers), answered: Object.keys(answers), unknown: []}, issues: []};
    }};
}
async function turnTwo(t, costs, responses) {
    const rows = [];
    const engine = createHybridEngine({env: process.env, record: row => rows.push(row), decision: timeJev(costs)});
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: {PI_COC_LOOP_ENGINE: 'hybrid-v1'}, runDriver: engine.runDriver,
        extraExtensions: [{name: 'coc-hybrid-engine', factory: engine.extension}], responses});
    t.after(() => table.dispose());
    await table.session.prompt('I go through the deed register for the house, entry by entry, and copy the names into my notebook.');
    const record = JSON.parse(readFileSync(join(campaignDir(table.workspace), 'turns', '0002.json'), 'utf8'));
    return {rows, record};
}
const keeperTime = fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'time', minutes: 90, why: 'The whole register, page by page.'}]})], {stopReason: 'toolUse'});
const narrate = fauxAssistantMessage([fauxToolCall('narrate', {text: 'You work down the register; the clerk watches the clock.'})], {stopReason: 'toolUse'});

test('§218.2 after the clerk charged the declared time, the Keeper\'s second time is refused and nothing in that apply runs', async t => {
    const {rows, record} = await turnTwo(t, true, [keeperTime, narrate]);
    const times = record.receipts.filter(receipt => receipt.kind === 'time');
    assert.equal(times.length, 1, 'time is charged once a turn');
    assert.equal(times[0].band, 'single_room_search', 'the clerk\'s declared time stands');
    const bind = rows.find(row => row.lane === 'run' && row.event === 'bind' && row.candidate === 'apply:time:declared');
    assert.equal(bind?.status, 'succeeded');
    const refused = rows.filter(row => row.lane === 'run' && row.event === 'catalog_refused');
    assert.deepEqual(refused.map(row => [row.operation, row.reason]), [['apply', 'declared_time_landed']]);
});

test('§218.2 without a clerk time the Keeper\'s own time lands as before', async t => {
    const {rows, record} = await turnTwo(t, false, [keeperTime, narrate]);
    const times = record.receipts.filter(receipt => receipt.kind === 'time');
    assert.deepEqual(times.map(receipt => receipt.minutes), [90]);
    assert.equal(rows.some(row => row.lane === 'run' && row.event === 'catalog_refused'), false);
});
