/**
 * Contract §190.2: `table.owe.options` and `table.owe` on the emitted kernel, over the haunting.
 *
 * The host reads where a delivered text leaves the party and names the place; the kernel projects it as §158.3 projects a
 * review's owed move: the quote anchored in what the turn delivered, the place a graph scene, the row on the record and in
 * `owed.json` with its `owed_state` warning, a newer owed move superseding an older one. A place the kernel cannot owe is
 * an answer (`dropped`), never an error. Every case travels the kernel's own RPC entry.
 */
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAMPAIGN = 'test-camp';
const TOLD = 'You drive across town, let yourselves into the Corbitt house and go straight down to the basement.';
const OWED_STATE_FIX = 'Already told: the player was told this happened, so it did, and the ledger owes it.';

/** Each request in one kernel process; answers the frames (ok or not) in order. */
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
/** Turn 1 lands the party at the Hall of Records; turn 2 tells them into the Corbitt house basement and lands no move. */
function toldTurnTwo(t) {
    const workspace = mkdtempSync(join(tmpdir(), 'told-owe-'));
    t.after(() => rmSync(workspace, {recursive: true, force: true}));
    steps(workspace, [['campaign.create', {id: CAMPAIGN, module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en', title: 'told position'}],
        ['table.open', {}], ['table.player_input', {text: 'I go to the archive.'}],
        ['table.apply', {call_id: 't1-c1', effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'hall-of-records'}]}],
        ['table.narrate', {call_id: 't1-c2', text: 'The archivist slides the ledger across the counter.'}],
        ['table.player_input', {text: 'I drive to the house and head for the cellar.'}],
        ['table.narrate', {call_id: 't2-c1', text: `${TOLD} The lamp gutters on the stair.`}]]);
    return workspace;
}
const owe = (to, quote = TOLD, turn = 2) => ['table.owe', {turn, effect: {kind: 'move', to}, quote, source: 'told-position'}];
const dir = workspace => join(workspace, '.coc/campaigns', CAMPAIGN);
const ledger = workspace => existsSync(join(dir(workspace), 'owed.json')) ? JSON.parse(readFileSync(join(dir(workspace), 'owed.json'), 'utf8')) : null;
const turnRecord = (workspace, turn) => JSON.parse(readFileSync(join(dir(workspace), 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));

test('options: the delivered scene, its moves, and the places other than it -- exits, the trail, then the book', t => {
    const workspace = toldTurnTwo(t);
    const [options, limited] = steps(workspace, [['table.owe.options', {turn: 2}], ['table.owe.options', {turn: 2, limit: 3}]]);
    assert.equal(options.scene.name, 'hall-of-records');
    assert.deepEqual(options.moved, []);
    const names = options.candidates.map(candidate => candidate.name);
    assert.ok(!names.includes('hall-of-records'), 'the scene the party stands in is never a candidate');
    assert.equal(new Set(names).size, names.length);
    const sources = options.candidates.map(candidate => candidate.source);
    assert.deepEqual([...new Set(sources)], ['exit', 'back', 'window'], 'in order; the starter has no reading window, so every book scene');
    assert.equal(options.candidates.find(candidate => candidate.source === 'back').name, 'commission-briefing');
    assert.ok(names.includes('basement-rites'));
    assert.equal(options.window, null);
    assert.deepEqual(limited.candidates.map(candidate => candidate.name), names.slice(0, 3));
    const turnOne = steps(workspace, [['table.owe.options', {turn: 1}]])[0];
    assert.deepEqual(turnOne.moved, [{to: 'hall-of-records'}], 'a turn that moved says so');
});

test('owe: the row is §158.3\'s -- on the record, in owed.json, with its owed_state warning -- and a second call answers it again', t => {
    const workspace = toldTurnTwo(t);
    const [first, again] = steps(workspace, [owe('basement-rites'), owe('basement-rites')]);
    assert.deepEqual(first, {turn: 2, owed: 't2-owed-1'});
    assert.deepEqual(again, {turn: 2, owed: 't2-owed-1'}, 'the same read sent again answers the row it wrote');
    const {open, closed} = ledger(workspace);
    assert.equal(open.length, 1);
    assert.deepEqual(closed, []);
    const [row] = open;
    // The basement is no exit of the Hall of Records: no road's minutes, and the kernel's own route sentence lets it land.
    assert.deepEqual(row.effect, {kind: 'move', to: 'basement-rites', via: 'Told in the delivery of turn 2.', travel_minutes: 0});
    assert.deepEqual({name: row.name, turn: row.turn, kind: row.kind, quote: row.quote, source: row.source}, {name: 't2-owed-1', turn: 2, kind: 'move', quote: TOLD, source: 'told-position'});
    assert.match(row.what, /^arrival at .*basement-rites/);
    const record = turnRecord(workspace, 2);
    assert.deepEqual(record.owed.map(entry => entry.name), ['t2-owed-1']);
    const warning = record.warnings.find(entry => entry.kind === 'owed_state');
    assert.equal(warning.lane, 'told-position');
    assert.equal(warning.owed, 't2-owed-1');
    assert.equal(warning.quote, TOLD.slice(0, 120));
    assert.ok(warning.fix.startsWith(OWED_STATE_FIX));
});

test('owe: an exit keeps its road\'s minutes', t => {
    const workspace = toldTurnTwo(t);
    const [answer] = steps(workspace, [owe('corbitt-house-ground')]);
    assert.equal(answer.owed, 't2-owed-1');
    assert.equal(ledger(workspace).open[0].effect.travel_minutes, 30);
});

test('owe drops what it cannot owe, as an answer, and writes nothing', t => {
    const workspace = toldTurnTwo(t);
    const answers = steps(workspace, [owe('basement-rites', 'You never went to the basement.'), owe('the-moon'), owe('hall-of-records')]);
    assert.deepEqual(answers.map(answer => answer.dropped), ['quote_not_delivered', 'unknown_scene', 'same_scene']);
    assert.ok(answers.every(answer => answer.owed === null));
    assert.equal(ledger(workspace), null, 'no owed.json');
    assert.equal(turnRecord(workspace, 2).owed, undefined);
});

test('owe refuses a malformed call', t => {
    const workspace = toldTurnTwo(t);
    const refused = frames(workspace, [
        ['table.owe', {turn: 2, effect: {kind: 'move', to: 'basement-rites'}, quote: TOLD, source: 'continuity-review'}],
        ['table.owe', {turn: 2, effect: {kind: 'time', band: 'hours'}, quote: TOLD, source: 'told-position'}],
        ['table.owe', {turn: 2, effect: {kind: 'move', to: 'basement-rites', establish: {summary: 'x'}}, quote: TOLD, source: 'told-position'}],
        ['table.owe', {turn: 9, effect: {kind: 'move', to: 'basement-rites'}, quote: TOLD, source: 'told-position'}],
        ['table.owe.options', {turn: 2, limit: 65}]]);
    assert.deepEqual(refused.map(frame => frame.ok ? 'ok' : frame.error.code), Array(5).fill('invalid_params'));
});

test('a turn that landed a move owes nothing, and a later move supersedes the told turn', t => {
    const workspace = toldTurnTwo(t);
    const [landed] = steps(workspace, [owe('basement-rites', 'The archivist slides the ledger across the counter.', 1)]);
    assert.deepEqual(landed, {turn: 1, owed: null, dropped: 'move_landed'});
    const answers = steps(workspace, [['table.player_input', {text: 'I go to the library instead.'}],
        ['table.apply', {call_id: 't3-c1', effects: [{kind: 'move', to: 'central-library'}]}], owe('basement-rites')]);
    assert.deepEqual(answers[2], {turn: 2, owed: null, dropped: 'superseded'}, 'the story moved on before the read named it');
    assert.equal(ledger(workspace), null);
});

test('an owed landing is not the told turn\'s own move: the delivery after it is still read, and its told position supersedes', t => {
    const workspace = toldTurnTwo(t);
    const ONWARD = 'From the hall you climb on to the upper floor.';
    const answers = steps(workspace, [owe('corbitt-house-ground', TOLD),
        ['table.player_input', {text: 'I keep going.'}],
        // The clerk lands turn 2's told arrival first (§158.4), then the Keeper tells the party onwards with no receipt.
        ['table.apply', {call_id: 't3-c1', effects: [{kind: 'move', to: 'corbitt-house-ground', via: 'Told in the delivery of turn 2.', travel_minutes: 30, owed: 't2-owed-1'}]}],
        ['table.narrate', {call_id: 't3-c2', text: ONWARD}],
        ['table.owe.options', {turn: 3}], owe('upper-floor-bedroom', ONWARD, 3)]);
    assert.deepEqual(answers[4].moved, [{to: 'corbitt-house-ground', owed: 't2-owed-1'}]);
    assert.equal(answers[4].scene.name, 'corbitt-house-ground');
    assert.deepEqual(answers[5], {turn: 3, owed: 't3-owed-1'});
    const {open, closed} = ledger(workspace);
    assert.deepEqual(open.map(row => row.name), ['t3-owed-1']);
    assert.deepEqual(closed.map(row => [row.name, row.how]), [['t2-owed-1', 'landed']]);
});

test('a newer told position supersedes an older one still open', t => {
    const workspace = toldTurnTwo(t);
    const LATER = 'By nightfall you are back in Knott\'s office.';
    steps(workspace, [owe('basement-rites'), ['table.player_input', {text: 'I head back.'}], ['table.narrate', {call_id: 't3-c1', text: LATER}],
        owe('commission-briefing', LATER, 3)]);
    const {open, closed} = ledger(workspace);
    assert.deepEqual(open.map(row => [row.name, row.effect.to]), [['t3-owed-1', 'commission-briefing']]);
    assert.deepEqual(closed.map(row => [row.name, row.how, row.by]), [['t2-owed-1', 'superseded', 't3-owed-1']]);
});
