/**
 * Contract §158.5 (FR-03 of docs/specs/forward-only-reconciliation-tickets.md): an owed row lands through an ordinary
 * `apply` as a consequence of what was told, admitted on basis `told`.
 *
 * - The kernel (in process): an effect naming an owed row lands it only when the row is open, the effect lands exactly
 *   it, and its quote is still in what that turn delivered; the receipt says which row and which turn; a landed row
 *   closes, and any other move that lands after it closes an owed move as superseded (landing it later would carry the
 *   party back to a position the story has left).
 * - Admission (pure, and on the real tool path): a write that lands only owed rows is admitted on `told`, with no
 *   player-choice review; a policy write must name the row its candidate carried; a mixed batch is reviewed as before.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {table} from './object-usages-fixture.mjs';
import {openTable} from './harness.mjs';
import {toldAdmission} from '../../extensions/kernel/admission.ts';

const record = async (game, turn) => JSON.parse(await readFile(join(game.directory, 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
const ledger = async game => JSON.parse(await readFile(join(game.directory, 'owed.json'), 'utf8'));
const TOLD = 'You drive out to the Corbitt house and stop at its gate.';

/** Turn 1 told the player an arrival, a person leaving and time passing, and the review recorded all three owed (§158.3). */
async function owedTable(t) {
    const game = await table(t);
    const job = await game.call('mods.job', {role: 'audit', input: {text: `${TOLD} Knott walks off into the dark. Hours pass while you wait.`}});
    const sources = job.focus.sources, sentence = words => sources.draft.find(source => source.text.includes(words)).alias;
    const house = sources.scenes.find(scene => /Corbitt House$/.test(scene.name)) ?? sources.scenes.find(scene => scene.alias !== 'scene:active');
    await writeFile(join(job.cwd, 'result.json'), JSON.stringify({schema: 2, missing: [], findings: [],
        owed: [{kind: 'move', source: sentence('stop at its gate'), to_source: house.alias, place: null, summary: null, via: 'Drove out to the house.', travel: 'local_travel'},
            {kind: 'npc', source: sentence('Knott walks off'), person_source: sources.persons.find(person => /Knott/.test(person.name)).alias, presence: 'away'},
            {kind: 'time', source: sentence('Hours pass'), band: 'single_room_search'}],
        continuity_review: {verdict: 'revise', summary: 'Told without receipts.', conflicts: [],
            intelligibility_review: {verdict: 'pass', source: null}, player_address_review: {verdict: 'pass', source: null},
            locus_review: {verdict: 'revise', mode: 'new_locus', basis: 'none', locus_source: house.alias, claim_source: sentence('stop at its gate')}}}));
    const {turn} = await game.call('table.narrate', {call_id: game.next(), text: `${TOLD} Knott walks off into the dark. Hours pass while you wait.`});
    await game.call('mods.accept', {job: job.job, after_delivery: true});
    await game.call('table.warn', {turn, lane: 'continuity-review', mode: 'post', job: job.job});
    const rows = (await record(game, turn)).owed;
    await game.call('table.player_input', {text: 'I look around.'});
    let ordinal = 1;
    return {game, turn, rows, byKind: kind => rows.find(row => row.kind === kind), apply: effects => game.call('table.apply', {call_id: `t${turn + 1}-c${ordinal++}`, effects})};
}
const reason = error => error.details?.reason;

test('an owed row lands through an ordinary apply that names it, and closes', async t => {
    const {game, turn, byKind, apply} = await owedTable(t);
    const move = byKind('move');
    const landed = await apply([{...move.effect, owed: move.name}]);
    const receipt = (await game.call('table.status')).receipts.find(value => value.id === landed.receipts.find(id => id.startsWith('move:')));
    assert.deepEqual({kind: receipt.kind, to: receipt.to, owed: receipt.owed, told_turn: receipt.told_turn}, {kind: 'move', to: move.effect.to, owed: move.name, told_turn: turn});
    assert.equal((await game.world()).active_scene, move.effect.to);
    const npc = byKind('npc');
    await apply([{...npc.effect, owed: npc.name}]);
    const time = byKind('time');
    const clock = (await game.world()).clock.minutes;
    await apply([{...time.effect, owed: time.name}]);
    assert.ok((await game.world()).clock.minutes > clock, 'the band is rolled when it lands');
    const owed = await ledger(game);
    assert.deepEqual(owed.open, []);
    assert.deepEqual(owed.closed.map(entry => [entry.name, entry.how]), [[move.name, 'landed'], [npc.name, 'landed'], [time.name, 'landed']]);
});

test('the kernel refuses a name that is not open, an effect that does not land the row, and a row no longer told', async t => {
    const {game, turn, rows, byKind, apply} = await owedTable(t);
    const move = byKind('move'), time = byKind('time');
    await assert.rejects(apply([{...move.effect, owed: 't99-owed-1'}]), error => reason(error) === 'owed_unknown');
    await assert.rejects(apply([{kind: 'move', to: 'newspaper-morgue', via: 'Elsewhere.', owed: move.name}]), error => reason(error) === 'owed_mismatch',
        'the Keeper\'s own word cannot turn a told arrival into another place');
    await assert.rejects(apply([{kind: 'clue', clue: 'knott-keys', owed: move.name}]), error => reason(error) === 'owed_kind');
    await assert.rejects(apply([{...time.effect, owed: time.name}, {...time.effect, owed: time.name}]), error => reason(error) === 'owed_repeated');
    // What turn 1 delivered no longer holds the sentence the row quotes: the row cannot be landed as told state.
    const path = join(game.directory, 'turns', `${String(turn).padStart(4, '0')}.json`), delivered = await record(game, turn);
    await writeFile(path, JSON.stringify({...delivered, rendered_text: delivered.rendered_text.replace(TOLD, '')}));
    await assert.rejects(apply([{...move.effect, owed: move.name}]), error => reason(error) === 'owed_not_told');
    assert.deepEqual((await ledger(game)).open.map(row => row.name), rows.map(row => row.name), 'nothing refused closed a row');
});

test('another move after the told turn supersedes the owed arrival instead of carrying the party back later', async t => {
    const {game, byKind, apply} = await owedTable(t);
    const move = byKind('move');
    await apply([{kind: 'move', to: 'newspaper-morgue', via: 'The story moved on.'}]);
    const owed = await ledger(game);
    assert.ok(!owed.open.some(row => row.name === move.name));
    assert.equal(owed.closed.find(entry => entry.name === move.name).how, 'superseded');
    assert.ok(owed.open.some(row => row.kind === 'time'), 'time is never superseded by a move');
});

// ---- admission ---------------------------------------------------------------------------------------------------

test('toldAdmission: only a write that lands owed rows; a policy write names its candidate\'s row', () => {
    const open = [{name: 't26-owed-1', turn: 26, quote: 'The cemetery is right there.'}];
    const effect = {kind: 'move', to: 'poe-cemetery', owed: 't26-owed-1'};
    assert.equal(toldAdmission('apply', {effects: [{kind: 'move', to: 'poe-cemetery'}]}, undefined, open), undefined);
    assert.equal(toldAdmission('apply', {effects: [effect, {kind: 'time', minutes: 5}]}, undefined, open), undefined, 'a mixed batch is reviewed as before');
    assert.equal(toldAdmission('resolve', {action: {}}, undefined, open), undefined);
    assert.deepEqual(toldAdmission('apply', {effects: [effect]}, {origin: 'model'}, open), {ok: true, rows: [{owed: 't26-owed-1', turn: 26, quote: 'The cemetery is right there.'}]});
    const basis = {told: {owed: 't26-owed-1', turn: 26, quote: 'The cemetery is right there.'}};
    assert.deepEqual(toldAdmission('apply', {effects: [effect]}, {origin: 'policy', basis}, []), {ok: true, rows: [basis.told]});
    assert.deepEqual(toldAdmission('apply', {effects: [effect]}, {origin: 'policy', basis: {told: {owed: 't26-owed-2'}}}, open), {ok: false, reason: 'told_basis_mismatch'});
    assert.deepEqual(toldAdmission('apply', {effects: [effect]}, {origin: 'policy', basis: {}}, open), {ok: false, reason: 'told_basis_mismatch'});
});

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAMPAIGN = 'test-camp';
function kernelSteps(workspace, requests) {
    const input = requests.map((request, index) => JSON.stringify({id: String(index), method: request[0], params: {campaign: CAMPAIGN, ...request[1]}})).join('\n');
    const run = spawnSync(process.execPath, [join(REPO, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(REPO, 'content')],
        {cwd: REPO, input: `${input}\n`, encoding: 'utf8'});
    const frames = run.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress);
    for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
    return frames.map(frame => frame.result);
}
const HOUSE = 'You drive across town and pull up at the Corbitt house.';
const ROW = {name: 't1-owed-1', turn: 1, kind: 'move', effect: {kind: 'move', to: 'corbitt-house-ground', via: 'Drove across town to the house.', travel_minutes: 30},
    quote: HOUSE, what: 'arrival at The Corbitt House (corbitt-house-ground), via: Drove across town to the house.', job: '0'.repeat(64), at: '2026-09-29T00:00:00Z'};
const toldNoMove = workspace => {
    kernelSteps(workspace, [['table.open', {}], ['table.player_input', {text: '我开车去科比特宅。'}], ['table.narrate', {call_id: 't1-c1', text: HOUSE}]]);
    writeFileSync(join(workspace, '.coc/campaigns', CAMPAIGN, 'owed.json'), JSON.stringify({open: [ROW], closed: []}));
};

test('on the real tool path: the Keeper\'s own owed write is admitted on told, and no review is asked whether the player chose it', async t => {
    const session = await openTable({realKernel: true, prepareWorkspace: toldNoMove, responses: [
        fauxAssistantMessage([fauxToolCall('apply', {effects: [{...ROW.effect, owed: ROW.name}]})], {stopReason: 'toolUse'}),
        fauxAssistantMessage([fauxToolCall('narrate', {text: '你推开门，蹲在小径旁看那些脚印。'})], {stopReason: 'toolUse'})]});
    t.after(() => session.dispose());
    await session.session.prompt('我推开大门，蹲在小径旁看地上的脚印。');
    const row = session.telemetry().find(entry => entry.lane === 'admission' && entry.verb === 'apply');
    assert.deepEqual({path: row.path, reviewer: row.reviewer, verdict: row.verdict, admitted: row.admitted}, {path: 'told', reviewer: 'told', verdict: 'authorized', admitted: true});
    assert.deepEqual(row.basis.told, {owed: ROW.name, turn: 1, quote: HOUSE}, 'the turn and quote the capsule carried');
    assert.match(row.grounds, /^told: turn 1: /);
    assert.equal(session.lanes.admission.requests().length, 0, 'no player-choice review');
    const turn = JSON.parse(readFileSync(join(session.workspace, '.coc/campaigns', CAMPAIGN, 'turns', '0002.json'), 'utf8'));
    assert.deepEqual(turn.receipts.filter(receipt => receipt.kind === 'move').map(receipt => [receipt.to, receipt.owed]), [['corbitt-house-ground', ROW.name]]);
});

test('on the real tool path: a forged owed name gets no review and lands nothing', async t => {
    const session = await openTable({realKernel: true, prepareWorkspace: toldNoMove, responses: [
        fauxAssistantMessage([fauxToolCall('apply', {effects: [{kind: 'move', to: 'newspaper-morgue', via: 'Anywhere.', owed: ROW.name}]})], {stopReason: 'toolUse'}),
        fauxAssistantMessage([fauxToolCall('narrate', {text: '你在门前停了一会儿。'})], {stopReason: 'toolUse'})]});
    t.after(() => session.dispose());
    await session.session.prompt('我推开大门。');
    const call = session.telemetry().find(entry => entry.tool === 'apply');
    assert.equal(call?.ok, false);
    assert.equal(call?.reason, 'owed_mismatch', 'the kernel is the final check on what was told');
    const world = JSON.parse(readFileSync(join(session.workspace, '.coc/campaigns', CAMPAIGN, 'world.json'), 'utf8'));
    assert.notEqual(world.active_scene, 'newspaper-morgue');
});

for (const refused of ['outage','review']) test(`FR-07: a mixed batch refused by ${refused} can resend only its owed move this turn`,async t=>{
    const session=await openTable({realKernel:true,prepareWorkspace:toldNoMove,
        ...(refused==='outage'?{env:{PI_COC_ADMISSION_MODEL:'nobody/home'}}:{laneResponses:{admission:[fauxAssistantMessage(JSON.stringify({verdict:'not_authorized',grounds:'The added clue is not chosen.',missing:'a search'})),fauxAssistantMessage(JSON.stringify({verdict:'not_authorized',grounds:'The added clue is not chosen.',missing:'a search'}))]}}),
        responses:[
            fauxAssistantMessage([fauxToolCall('apply',{effects:[{...ROW.effect,owed:ROW.name},{kind:'clue',clue:'nailed-windows',how:'Found the windows.'}]})],{stopReason:'toolUse'}),
            fauxAssistantMessage([fauxToolCall('apply',{effects:[{...ROW.effect,owed:ROW.name}]})],{stopReason:'toolUse'}),
            fauxAssistantMessage([fauxToolCall('narrate',{text:'You stand before the gate. The windows are dark.'})],{stopReason:'toolUse'})]});
    t.after(()=>session.dispose());await session.session.prompt('I look at the gate.');
    const errors=session.session.messages.filter(m=>m.role==='toolResult'&&m.toolName==='apply'&&m.details?.coc_error).map(m=>m.details.coc_error);
    assert.ok(errors.length);assert.deepEqual(errors[0].details.owed_retry,[ROW.name]);
    assert.match(errors[0].fix,/separate apply this turn/);
    const world=JSON.parse(readFileSync(join(session.workspace,'.coc/campaigns',CAMPAIGN,'world.json'),'utf8'));
    assert.equal(world.active_scene,ROW.effect.to);
    assert.equal(session.telemetry().filter(row=>row.lane==='admission'&&row.path==='told'&&row.admitted).length,1);
});
