/**
 * Contract §201.1-§201.2 on the kernel's own RPC entry (in process, the real runtime over the haunting).
 *
 * TR-F2 run 3, turn 10: at the Hall of Records the Keeper's prose gave the will's executor and the chapel's closing, and
 * no clue receipt landed. The host's told-clue read names them through `table.owe` (`source: "told-clue"`); the kernel
 * writes §158.3's owed row, and the clerk lands it first on the next run -- wherever the party stands by then. And a clue
 * the book finds by a check (the executor: Library Use) lands after that check passed, never instead of it (run 3's T6 and
 * T13 filed Library Use and Spot Hidden clues with no roll).
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {existsSync, readFileSync} from 'node:fs';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';

const root = resolve(import.meta.dirname, '../..');
const directory = playtestScratch('clue-ledger-kernel');
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({
    stdin: {
        contents: "export {createKernelContext} from './kernel-ts/context.ts';"
            + " export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';"
            + " export {createKernelRuntime} from './kernel-ts/registry.ts';"
            + " export {asVisit, checkPassed, clueRoute, earlierVisitTurns, foundByProblem} from './kernel-ts/read/clue-check.ts';",
        resolveDir: root, sourcefile: 'clue-ledger-api.ts'
    },
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'
});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers) await close(); });

const RUN3 = JSON.parse(readFileSync(join(root, 'tests/extension/fixtures/clue-ledger/run3.json'), 'utf8'));
const EXECUTOR = '执行人是迈克尔·托马斯牧师，他也是沉思教堂的牧师。', CLOSED = '教会名册还记着，那座教堂在一九一二年关闭了。';

async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({
        workspace: home, content: join(root, 'content'), seed: 'clue-ledger', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
    });
    const runtime = api.createKernelRuntime(context);
    closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans'});
    await call('table.open');
    let calls = 0;
    const id = turn => `t${turn}-c${++calls}`;
    const dir = join(home, '.coc/campaigns/c1');
    const record = turn => JSON.parse(readFileSync(join(dir, 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
    const ledger = () => existsSync(join(dir, 'owed.json')) ? JSON.parse(readFileSync(join(dir, 'owed.json'), 'utf8')) : null;
    const world = () => JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'));
    return {call, id, record, ledger, world};
}
const refusal = async promise => { try { await promise; } catch (error) { return error; } assert.fail('expected a refusal'); };

/** Turn 1 walks to the Hall of Records; turn 2 is run 3's T10: the clerk reads out the executor and the closing, no apply. */
async function toldAtTheHall() {
    const game = await table();
    await game.call('table.player_input', {text: '我去市政档案馆。'});
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'hall-of-records'}]});
    await game.call('table.narrate', {call_id: game.id(1), text: '档案员把卷宗推给你。'});
    await game.call('table.player_input', {text: RUN3.t10.player});
    await game.call('table.narrate', {call_id: game.id(2), text: RUN3.t10.delivered});
    return game;
}
const owe = (game, clue, quote, turn = 2) => game.call('table.owe', {turn, effect: {kind: 'clue', clue}, quote, source: 'told-clue'});

test('options: the clues in play the ledger lacks -- here first, then the trail -- each with the book\'s check when it names one', async () => {
    const game = await toldAtTheHall();
    const options = await game.call('table.owe.options', {turn: 2});
    assert.equal(options.scene.name, 'hall-of-records');
    const names = options.clues.map(row => row.name);
    assert.deepEqual(names.slice(0, 2), ['will-executor-chapel', 'chapel-closed-1912'], 'the delivered scene\'s clues come first');
    assert.deepEqual([...new Set(options.clues.map(row => row.source))], ['here', 'back'], 'then the trail');
    assert.ok(!names.includes('knott-research-leads'), 'a clue the table found is not one');
    assert.ok(names.includes('knott-keys'), 'the office on the trail still has its unfound clues');
    const executor = options.clues[0], closed = options.clues[1];
    assert.deepEqual({check: executor.check, delivery: executor.delivery_kind}, {check: {skill: 'Library Use', difficulty: 'regular'}, delivery: 'skill_check'});
    assert.equal(closed.check, undefined, 'an obvious clue names no check');
    assert.deepEqual(options.clue_receipts, []);
    const turnOne = await game.call('table.owe.options', {turn: 1, clue_limit: 1});
    assert.deepEqual(turnOne.clue_receipts.map(row => row.clue), ['knott-research-leads'], 'the turn that landed a clue lists it');
    assert.equal(turnOne.clues.length, 1, 'clue_limit bounds the rows');
    for (const bad of [0, 65, 1.5]) assert.equal((await refusal(game.call('table.owe.options', {turn: 2, clue_limit: bad}))).code, 'invalid_params');
});

test('owe: a told clue is §158.3\'s row -- record, owed.json, warning -- and the executor\'s skipped Library Use is said', async () => {
    const game = await toldAtTheHall();
    const executor = await owe(game, 'will-executor-chapel', EXECUTOR);
    assert.deepEqual(executor, {turn: 2, owed: 't2-owed-1', check: {skill: 'Library Use', difficulty: 'regular'}, check_skipped: true});
    assert.deepEqual(await owe(game, 'will-executor-chapel', EXECUTOR), executor, 'the same read sent again answers the row it wrote');
    assert.deepEqual(await owe(game, 'chapel-closed-1912', CLOSED), {turn: 2, owed: 't2-owed-2'}, 'an obvious clue carries no check');
    const {open} = game.ledger();
    assert.deepEqual(open.map(row => [row.name, row.kind, row.effect.clue, row.source]),
        [['t2-owed-1', 'clue', 'will-executor-chapel', 'told-clue'], ['t2-owed-2', 'clue', 'chapel-closed-1912', 'told-clue']]);
    assert.equal(open[0].quote, EXECUTOR, 'the quote is the delivered text\'s own span');
    assert.match(open[0].what, /^clue told: .*\(will-executor-chapel\)$/);
    const record = game.record(2);
    assert.deepEqual(record.owed.map(row => row.name), ['t2-owed-1', 't2-owed-2']);
    assert.deepEqual(record.warnings.filter(row => row.kind === 'owed_state').map(row => [row.lane, row.owed]), [['told-clue', 't2-owed-1'], ['told-clue', 't2-owed-2']]);
    const capsule = await game.call('table.player_input', {text: '谢过职员。'}).then(() => game.call('table.capsule'));
    assert.deepEqual(capsule.owed.map(row => [row.name, row.kind, row.clerk]), [['t2-owed-1', 'clue', true], ['t2-owed-2', 'clue', true]]);
});

test('owe drops what it cannot owe, as an answer, and writes nothing', async () => {
    const game = await toldAtTheHall();
    const answers = [await owe(game, 'the-moon', EXECUTOR), await owe(game, 'will-executor-chapel', 'You never read the will.'),
        await owe(game, 'knott-research-leads', 'Knott named the places', 1)];
    assert.deepEqual(answers.map(answer => [answer.owed, answer.dropped]), [[null, 'unknown_clue'], [null, 'quote_not_delivered'], [null, 'clue_landed']]);
    assert.equal(game.ledger(), null, 'no owed.json');
    for (const bad of [{kind: 'clue'}, {kind: 'clue', clue: 'will-executor-chapel', establish: {summary: 'x'}}, {kind: 'move', to: 'basement-rites'}])
        assert.equal((await refusal(game.call('table.owe', {turn: 2, effect: bad, quote: EXECUTOR, source: 'told-clue'}))).code, 'invalid_params');
});

test('the clerk lands a told clue where the party stands now, with no roll, and the row closes; a found clue is no debt', async () => {
    const game = await toldAtTheHall();
    await owe(game, 'will-executor-chapel', EXECUTOR);
    await owe(game, 'chapel-closed-1912', CLOSED);
    await game.call('table.player_input', {text: '我去中央图书馆。'});
    await game.call('table.apply', {call_id: game.id(3), effects: [{kind: 'move', to: 'central-library'}]});
    await game.call('table.narrate', {call_id: game.id(3), text: '你来到图书馆。'});
    await game.call('table.player_input', {text: '我把记下的名字又看了一遍。'});
    // A turn later at the library neither clue is discoverable (§135.30.7 covers only the turn the party left), and the
    // executor's book check was never rolled: without its row the Keeper's own landing is refused, with it the row lands.
    const refused = await refusal(game.call('table.apply', {call_id: game.id(4), effects: [{kind: 'clue', clue: 'chapel-closed-1912'}]}));
    assert.equal(refused.code, 'not_here');
    await game.call('table.apply', {call_id: game.id(4), effects: [{kind: 'clue', clue: 'will-executor-chapel', owed: 't2-owed-1'}]});
    await game.call('table.apply', {call_id: game.id(4), effects: [{kind: 'clue', clue: 'chapel-closed-1912', owed: 't2-owed-2'}]});
    await game.call('table.narrate', {call_id: game.id(4), text: '你在图书馆坐下。'});
    assert.ok(['will-executor-chapel', 'chapel-closed-1912'].every(clue => game.world().discovered_clues.includes(clue)));
    const record = game.record(4).receipts.filter(row => row.kind === 'clue');
    assert.deepEqual(record.map(row => [row.clue, row.owed, row.told_turn, row.scene]),
        [['will-executor-chapel', 't2-owed-1', 2, 'central-library'], ['chapel-closed-1912', 't2-owed-2', 2, 'central-library']]);
    const {open, closed} = game.ledger();
    assert.deepEqual(open, []);
    assert.deepEqual(closed.map(row => [row.name, row.how]), [['t2-owed-1', 'landed'], ['t2-owed-2', 'landed']]);
    assert.deepEqual(await owe(game, 'chapel-closed-1912', CLOSED), {turn: 2, owed: 't2-owed-2'}, 'the same read sent again still answers its row');
    assert.deepEqual(await owe(game, 'chapel-closed-1912', '产权登记没有给你沃尔特·科比特后来遭遇的答案；'), {turn: 2, owed: null, dropped: 'satisfied'},
        'another telling of a clue found since is no debt');
});

/** One Library Use at the library; the dice are seeded, not scripted, so a test reads which way it went. */
async function libraryUse(game, turn) {
    const result = await game.call('table.resolve', {call_id: game.id(turn), action: {intent: 'investigate', skill: 'Library Use', goal: '查一八三五年的建造记录'}});
    assert.equal(result.outcome?.kind, 'check');
    return result.outcome.passed === true;
}

test('§201.2 / §222.1: a checked clue is refused until a route stands; the book\'s roll lands it this turn or an earlier turn of the visit', async () => {
    const game = await table();
    await game.call('table.player_input', {text: '我去中央图书馆查一八三五年的记录。'});
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'central-library'}]});
    const row = async () => (await game.call('table.apply.options')).candidates.find(entry => entry.effect.clue === 'house-built-1835');
    assert.deepEqual((await row()).description.check, {skill: 'Library Use', difficulty: 'regular', passed: false, other_rolls: []});
    const clock = game.world().clock.minutes;
    // Run 3 T6's shape: the clue filed with no roll.
    const first = await refusal(game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'time', minutes: 30, why: 'reading'}, {kind: 'clue', clue: 'house-built-1835'}]}));
    assert.deepEqual({code: first.code, detail: first.code_detail ?? first.codeDetail, reason: first.details.reason, clue: first.details.clue, check: first.details.check, index: first.details.index},
        {code: 'needs', detail: 'check_first', reason: 'check_first', clue: 'house-built-1835', check: {skill: 'Library Use', difficulty: 'regular'}, index: 1});
    assert.deepEqual(first.details.routes, {other_rolls: [], idea_roll: true}, 'the refusal names the ways in');
    assert.match(first.fix, /^Leave clue house-built-1835 out of this apply and send the rest\. It lands once a Library Use roll for it has passed on this visit/);
    assert.match(first.fix, /Idea roll/);
    assert.equal(game.world().clock.minutes, clock, 'nothing of the batch was written');
    assert.ok(!game.world().discovered_clues.includes('house-built-1835'));
    // One roll a turn: a failed one finds nothing (and is not an "other roll": same skill); the first passed one opens the clue
    // for the rest of the visit -- the next turn's row says so and the apply lands with the earlier turn on its receipt.
    let turn = 1, failed = false;
    for (; turn < 40; turn++) {
        if (turn > 1) await game.call('table.player_input', {text: '我继续查。'});
        const passed = await libraryUse(game, turn);
        if (!passed) {
            const again = await refusal(game.call('table.apply', {call_id: game.id(turn), effects: [{kind: 'clue', clue: 'house-built-1835'}]}));
            assert.equal(again.details.reason, 'check_first', 'a failed roll finds nothing');
            assert.deepEqual(again.details.routes.other_rolls, [], 'a failed roll of the book\'s skill is no other roll');
            assert.equal((await row()).description.check.passed, false);
            failed = true;
            await game.call('table.narrate', {call_id: game.id(turn), text: '你合上卷宗。'});
            continue;
        }
        await game.call('table.narrate', {call_id: game.id(turn), text: '你合上卷宗。'});
        await game.call('table.player_input', {text: '我再翻一遍。'});
        turn += 1;
        const check = (await row()).description.check;
        assert.equal(check.passed, true, 'a roll of an earlier turn of the same visit opens the clue');
        assert.deepEqual({route: check.found_by.route, turn: check.found_by.turn, passed: check.found_by.passed}, {route: 'check', turn: turn - 1, passed: true});
        assert.match(check.found_by.roll, /^roll:library-use-t/);
        await game.call('table.apply', {call_id: game.id(turn), effects: [{kind: 'clue', clue: 'house-built-1835'}]});
        break;
    }
    assert.ok(game.world().discovered_clues.includes('house-built-1835'));
    assert.equal(await row(), undefined, 'a found clue is no longer a row');
    await game.call('table.narrate', {call_id: game.id(turn), text: '一八三五年的记录就在那里。'});
    const receipt = game.record(turn).receipts.find(entry => entry.kind === 'clue' && entry.clue === 'house-built-1835');
    assert.deepEqual(receipt.check, {skill: 'Library Use', difficulty: 'regular'});
    assert.deepEqual({route: receipt.found_by.route, turn: receipt.found_by.turn, passed: receipt.found_by.passed}, {route: 'check', turn: turn - 1, passed: true});
    assert.equal(receipt.check_skipped, undefined);
    if (!failed) console.log('note: the seeded dice never failed Library Use in this run');
});

test('§222.1: the routes, read from receipts alone -- the book\'s roll by anyone on the visit, the Idea roll either way, the host\'s attestations verified', async () => {
    const check = {skill: 'Spot Hidden'};
    const route = (visit, foundBy) => api.clueRoute(check, {clue: 'dagger', visit, foundBy});
    // §201.2's reading stands for the one-turn callers, now for any roller.
    assert.equal(api.checkPassed(check, [{kind: 'roll', skill: 'spot  hidden', passed: true, actor_is_investigator: true}]), true, 'case and spacing folded');
    assert.equal(api.checkPassed(check, [{kind: 'roll', check: {skill: 'Spot Hidden'}, passed: true}]), true, 'the check record\'s skill counts');
    assert.equal(api.checkPassed(check, [{kind: 'roll', skill: 'Spot Hidden', passed: false}]), false);
    assert.equal(api.checkPassed(check, [{kind: 'roll', skill: 'Listen', passed: true}]), false);
    // 1. The book's roll: an investigator's this turn, an NPC helper's (ch. 5: the Keeper chose the roller), an earlier turn's.
    assert.deepEqual(route(api.asVisit([{id: 'r1', kind: 'roll', skill: 'Spot Hidden', passed: true, actor_is_investigator: true}])), {route: 'check', roll: 'r1', passed: true});
    assert.deepEqual(route(api.asVisit([{id: 'r2', kind: 'roll', skill: 'Spot Hidden', passed: true, actor_is_investigator: false}])), {route: 'check', roll: 'r2', helper: true, passed: true});
    assert.deepEqual(route(api.asVisit([], [{turn: 4, receipts: [{id: 'r3', kind: 'roll', skill: 'Spot Hidden', passed: true}]}])), {route: 'check', roll: 'r3', turn: 4, passed: true});
    assert.equal(route(api.asVisit([{id: 'r4', kind: 'roll', skill: 'Spot Hidden', passed: false}])), null, 'a failed roll is no route');
    assert.equal(route(api.asVisit([{id: 'r5', kind: 'roll', form: 'dice', skill: 'Spot Hidden', passed: true}])), null, 'a dice roll is not a check');
    // 2. The Idea roll naming the clue lands it whichever way it fell; one naming another clue does not.
    assert.deepEqual(route(api.asVisit([{id: 'r6', kind: 'roll', roll_kind: 'idea_roll', skill: 'INT', clue: 'dagger', passed: false}])), {route: 'idea_roll', roll: 'r6', passed: false});
    assert.equal(route(api.asVisit([{id: 'r7', kind: 'roll', roll_kind: 'idea_roll', skill: 'INT', clue: 'other', passed: true}])), null);
    // 3-5. The host's attestations: a fitting roll must be a passed roll of the visit; obvious and no_roll are taken as attested.
    const listen = api.asVisit([{id: 'r8', kind: 'roll', skill: 'Listen', passed: true}, {id: 'r9', kind: 'roll', skill: 'Psychology', passed: false}]);
    assert.deepEqual(route(listen, {route: 'fitting_check', roll: 'r8'}), {route: 'fitting_check', roll: 'r8', passed: true, judged: 'jev'});
    assert.equal(api.foundByProblem({route: 'fitting_check', roll: 'r9'}, listen), 'found_by.roll "r9" did not pass');
    assert.equal(api.foundByProblem({route: 'fitting_check', roll: 'r0'}, listen), 'found_by.roll "r0" is not a roll of this visit');
    assert.match(api.foundByProblem({route: 'check'}, listen), /^found_by.route must be one of/);
    assert.equal(api.foundByProblem({route: 'obvious'}, []), null);
    assert.deepEqual(route([], {route: 'obvious'}), {route: 'obvious', judged: 'jev'});
    assert.deepEqual(route([], {route: 'no_roll'}), {route: 'no_roll', judged: 'host'});
    assert.equal(route(listen, null), null, 'another skill\'s roll opens nothing by itself');
    // The visit: from the arrival (that turn's later receipts) to the turn before; a departure ends it; a missing record ends it.
    const records = {3: {receipts: [{kind: 'roll', id: 'a'}, {kind: 'move', from: 'x', to: 'lib'}, {kind: 'roll', id: 'b'}]}, 4: {receipts: [{kind: 'roll', id: 'c'}]}, 5: {receipts: [{kind: 'roll', id: 'd'}]}};
    const read = async turn => records[turn] ?? null;
    assert.deepEqual((await api.earlierVisitTurns(read, 'lib', 6)).map(entry => [entry.turn, entry.receipts.map(r => r.id)]), [[3, ['b']], [4, ['c']], [5, ['d']]]);
    records[4] = {receipts: [{kind: 'move', from: 'lib', to: 'y'}, {kind: 'roll', id: 'c'}]};
    assert.deepEqual((await api.earlierVisitTurns(read, 'lib', 6)).map(entry => entry.turn), [5], 'a turn that left ends the visit');
    assert.deepEqual(await api.earlierVisitTurns(read, 'lib', 1), [], 'no record, no visit');
});

test('§222.1: the host\'s attested routes land the clue through the kernel, and a bad attestation is refused by name', async () => {
    const game = await table();
    await game.call('table.player_input', {text: '我去中央图书馆查一八三五年的记录。'});
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'central-library'}]});
    const clue = 'house-built-1835';
    for (const [foundBy, problem] of [[{route: 'check'}, /found_by.route must be one of fitting_check, obvious, no_roll/], [{route: 'fitting_check'}, /names the passed roll receipt/],
        [{route: 'fitting_check', roll: 'roll:nothing'}, /is not a roll of this visit/]]) {
        const refused = await refusal(game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue, found_by: foundBy}]}));
        assert.equal(refused.code, 'invalid_params');
        assert.equal(refused.code_detail ?? refused.codeDetail, 'found_by_invalid');
        assert.match(refused.message, problem);
    }
    // A passed roll of another skill is listed for the host and, once attested, lands the clue with its receipt on the record.
    let spot = null;
    for (let attempt = 0; attempt < 30 && !spot; attempt++) {
        const result = await game.call('table.resolve', {call_id: game.id(1), action: {intent: 'investigate', skill: 'Spot Hidden', goal: '翻找书架之间有没有夹着的旧地契'}});
        if (result.outcome.passed === true) spot = result.receipt;
    }
    assert.ok(spot, 'the seeded dice passed Spot Hidden within thirty tries');
    const refused = await refusal(game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue}]}));
    const other = refused.details.routes.other_rolls.find(entry => entry.id === spot);
    assert.deepEqual({skill: other.skill, goal: other.goal, turn: other.turn}, {skill: 'Spot Hidden', goal: '翻找书架之间有没有夹着的旧地契', turn: undefined});
    assert.deepEqual((await game.call('table.apply.options')).candidates.find(entry => entry.effect.clue === clue).description.check.other_rolls.map(entry => entry.id), refused.details.routes.other_rolls.map(entry => entry.id));
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue, found_by: {route: 'fitting_check', roll: spot}}]});
    await game.call('table.narrate', {call_id: game.id(1), text: '你合上卷宗。'});
    let receipt = game.record(1).receipts.find(entry => entry.kind === 'clue' && entry.clue === clue);
    assert.deepEqual(receipt.found_by, {route: 'fitting_check', roll: spot, passed: true, judged: 'jev'});
    assert.deepEqual(receipt.check, {skill: 'Library Use', difficulty: 'regular'});
    // Obvious: landed as Jev judged. No roll: landed as the host decided, with §201's count on the receipt.
    await game.call('table.player_input', {text: '我去市政档案馆。'});
    await game.call('table.apply', {call_id: game.id(2), effects: [{kind: 'move', to: 'hall-of-records'}]});
    await game.call('table.apply', {call_id: game.id(2), effects: [{kind: 'clue', clue: 'will-executor-chapel', found_by: {route: 'obvious'}}]});
    await game.call('table.narrate', {call_id: game.id(2), text: '档案员把名册推给你。'});
    receipt = game.record(2).receipts.find(entry => entry.kind === 'clue' && entry.clue === 'will-executor-chapel');
    assert.deepEqual(receipt.found_by, {route: 'obvious', judged: 'jev'});
    assert.equal(receipt.check_skipped, undefined);
    await game.call('table.player_input', {text: '我去沉思教堂。'});
    await game.call('table.apply', {call_id: game.id(3), effects: [{kind: 'move', to: 'chapel-of-contemplation'}]});
    const chapel = (await game.call('table.apply.options')).candidates.find(entry => entry.description.check && entry.effect.kind === 'clue');
    assert.ok(chapel, 'the chapel has a checked clue');
    await game.call('table.apply', {call_id: game.id(3), effects: [{kind: 'clue', clue: chapel.effect.clue, found_by: {route: 'no_roll'}}]});
    await game.call('table.narrate', {call_id: game.id(3), text: '教堂的门开着。'});
    receipt = game.record(3).receipts.find(entry => entry.kind === 'clue' && entry.clue === chapel.effect.clue);
    assert.deepEqual({found_by: receipt.found_by, skipped: receipt.check_skipped, check: receipt.check}, {found_by: {route: 'no_roll', judged: 'host'}, skipped: true, check: chapel.description.check.skill ? {skill: chapel.description.check.skill, ...(chapel.description.check.difficulty ? {difficulty: chapel.description.check.difficulty} : {})} : undefined});
});

test('§222.3: the Idea roll is offered for the highest INT over the scene\'s undiscovered clues, and lands the clue it names whichever way the die fell', async () => {
    const game = await table();
    await game.call('table.player_input', {text: '我去中央图书馆查一八三五年的记录。'});
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'central-library'}]});
    await game.call('table.narrate', {call_id: game.id(1), text: '你在图书馆坐下。'});
    await game.call('table.player_input', {text: '我卡住了，完全不知道该查什么。能不能给点提示？'});
    const options = await game.call('table.resolve.options');
    const idea = options.selection.options.find(option => option.action.decision === 'core-check:idea-roll');
    assert.ok(idea, 'the catalog offers the Idea roll');
    const actor = idea.action.actor;
    assert.equal(actor, options.profiles[0].actor, 'the one investigator is the highest INT');
    assert.match(idea.label, /the Idea roll -- the players are stuck and ask for a way forward$/);
    assert.match(idea.definition, /proposed by the players, not the Keeper/);
    assert.deepEqual(idea.parameters.map(parameter => parameter.name), ['clue', 'difficulty']);
    const clueParameter = idea.parameters[0];
    assert.ok(clueParameter.options.some(option => option.value === 'house-built-1835' && /1835/.test(option.label)), 'the clue parameter lists the scene\'s undiscovered clues by summary');
    assert.ok(clueParameter.options.some(option => option.value === 'knott-keys'), 'the catalog offers the same visited-trail clues the resolver accepts');
    assert.equal(idea.parameters[1].default.value, 'regular');
    assert.ok(options.selection.coverage.find(entry => entry.decision === 'core-check:idea-roll').executable);
    // Refusals: no clue, a clue of another scene, a found clue.
    const bare = await refusal(game.call('table.resolve', {call_id: game.id(2), action: {decision: 'core-check:idea-roll', actor, intent: 'investigate', goal: 'a way forward', method: 'the Idea roll'}}));
    assert.equal(bare.code, 'needs');
    assert.ok(bare.details.needs.options.includes('house-built-1835'));
    const elsewhere = await refusal(game.call('table.resolve', {call_id: game.id(2), action: {decision: 'core-check:idea-roll', actor, intent: 'investigate', clue: 'hollow-boards', goal: 'a way forward', method: 'the Idea roll'}}));
    assert.match(elsewhere.message, /not a clue of this scene or of the trail/);
    const found = await refusal(game.call('table.resolve', {call_id: game.id(2), action: {decision: 'core-check:idea-roll', actor, intent: 'investigate', clue: 'knott-research-leads', goal: 'a way forward', method: 'the Idea roll'}}));
    assert.match(found.message, /already found/);
    // The roll: INT 70 at hard is a threshold of 35; the clue lands either way and the note says how.
    const result = await game.call('table.resolve', {call_id: game.id(2), action: {decision: 'core-check:idea-roll', actor, intent: 'investigate', clue: 'house-built-1835', difficulty: 'hard', goal: 'a way forward', method: 'the Idea roll'}});
    assert.equal(result.outcome.kind, 'check');
    assert.equal(result.outcome.idea_roll, true);
    assert.equal(result.outcome.clue, 'house-built-1835');
    assert.deepEqual({skill: result.outcome.skill, target: result.outcome.target, difficulty: result.outcome.difficulty, threshold: result.outcome.threshold}, {skill: 'INT', target: 70, difficulty: 'hard', threshold: 35});
    assert.match(result.outcome.note, result.outcome.passed ? /^Idea roll passed: .*costs them nothing/ : /^Idea roll failed: .*in the thick of it/);
    assert.ok(result.hints.includes(result.outcome.note));
    assert.ok(game.world().discovered_clues.includes('house-built-1835'), 'the clue landed whichever way the die fell');
    // The same clue on the kernel's own `apply`: a second landing is a no-op with its receipt, as before.
    await game.call('table.apply', {call_id: game.id(2), effects: [{kind: 'clue', clue: 'house-built-1835'}]});
    assert.ok(!(await game.call('table.resolve.options')).selection.options.some(option => option.action.decision === 'core-check:idea-roll' && option.parameters[0].options.some(option => option.value === 'house-built-1835')));
    await game.call('table.narrate', {call_id: game.id(2), text: '你忽然想起了什么。'});
    const receipts = game.record(2).receipts;
    const roll = receipts.find(entry => entry.kind === 'roll'), clue = receipts.find(entry => entry.kind === 'clue');
    assert.deepEqual({kind: roll.roll_kind, clue: roll.clue, check_kind: roll.check.kind, check_clue: roll.check.clue, skill: roll.skill}, {kind: 'idea_roll', clue: 'house-built-1835', check_kind: 'idea_roll', check_clue: 'house-built-1835', skill: 'INT'});
    assert.deepEqual(clue.found_by, {route: 'idea_roll', roll: roll.id, passed: roll.passed});
    assert.deepEqual(clue.check, {skill: 'Library Use', difficulty: 'regular'});
    assert.equal(clue.id, result.outcome.clue_receipt);
    assert.equal(clue.how, 'by the Idea roll');
    assert.equal(result.receipts.length, 2, JSON.stringify(result.receipts));
    assert.equal(receipts.filter(entry => entry.kind === 'clue').length, 1, 'the second landing of a found clue is a no-op and leaves no receipt');
});


test('an Idea roll remains available after all visited scene clues are already known without inventing another clue', async () => {
    const game = await table();
    await game.call('table.player_input', {text: 'I take the offered keys and review the research directions.'});
    await game.call('table.apply', {call_id: game.id(1), effects: ['knott-commission', 'knott-keys', 'knott-macario-summary', 'knott-research-leads'].map(clue => ({kind: 'clue', clue}))});
    await game.call('table.narrate', {call_id: game.id(1), text: 'The keys and directions are already known.'});
    await game.call('table.player_input', {text: 'I am stuck. I ask for an Idea roll based on what I already know.'});
    const before = game.world().discovered_clues;
    const options = await game.call('table.resolve.options');
    const idea = options.selection.options.find(option => option.action.decision === 'core-check:idea-roll');
    assert.ok(idea, 'missing source attachments do not make the rule unavailable');
    assert.ok(options.selection.coverage.find(entry => entry.decision === 'core-check:idea-roll').executable);
    assert.equal(idea.parameters.some(parameter => parameter.name === 'clue'), false);
    const result = await game.call('table.resolve', {call_id: game.id(2), action: {intent: 'investigate', decision: idea.action.decision, actor: idea.action.actor, goal: 'Find an investigative direction', method: 'The requested Idea roll'}});
    assert.equal(result.outcome.idea_roll, true);
    assert.equal(result.outcome.skill, 'INT');
    assert.equal(result.outcome.target, 70);
    assert.equal(result.outcome.clue, null);
    assert.equal(result.outcome.clue_receipt, null);
    assert.match(result.outcome.note, /known facts|read material/);
    assert.deepEqual(game.world().discovered_clues, before);
    assert.equal(result.outcome.pushed, false);
    const nextOptions = (await game.call('table.resolve.options')).selection.options;
    assert.equal(nextOptions.some(option => option.needs.length === 0 && option.action.decision === 'push-luck:luck-spend'), false);
    const push = nextOptions.find(option => option.action.decision === 'push-luck:pushed-roll');
    if (push) assert.equal(push.facts.push_refusal, 'procedure_roll');
    await game.call('table.narrate', {call_id: game.id(2), text: 'The existing evidence suggests a direction to investigate.'});
    const records = game.record(2).receipts;
    assert.equal(records.filter(receipt => receipt.kind === 'clue').length, 0);
    const rolls = records.filter(receipt => receipt.kind === 'roll');
    assert.equal(rolls.length, 1);
    assert.equal(rolls[0].roll_kind, 'idea_roll');
    assert.equal(rolls[0].clue, undefined);
});
