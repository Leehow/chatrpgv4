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
            + " export {checkPassed} from './kernel-ts/read/clue-check.ts';",
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

test('§201.2: a clue the book finds by a check is refused until that roll passed this turn, and the option row says so', async () => {
    const game = await table();
    await game.call('table.player_input', {text: '我去中央图书馆查一八三五年的记录。'});
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'central-library'}]});
    const row = async () => (await game.call('table.apply.options')).candidates.find(entry => entry.effect.clue === 'house-built-1835');
    assert.deepEqual((await row()).description.check, {skill: 'Library Use', difficulty: 'regular', passed: false});
    const clock = game.world().clock.minutes;
    // Run 3 T6's shape: the clue filed with no roll.
    const first = await refusal(game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'time', minutes: 30, why: 'reading'}, {kind: 'clue', clue: 'house-built-1835'}]}));
    assert.deepEqual({code: first.code, detail: first.code_detail ?? first.codeDetail, reason: first.details.reason, clue: first.details.clue, check: first.details.check, index: first.details.index},
        {code: 'needs', detail: 'check_first', reason: 'check_first', clue: 'house-built-1835', check: {skill: 'Library Use', difficulty: 'regular'}, index: 1});
    assert.match(first.fix, /^Leave clue house-built-1835 out of this apply and send the rest\. It lands after a Library Use roll for it has passed this turn/);
    assert.equal(game.world().clock.minutes, clock, 'nothing of the batch was written');
    assert.ok(!game.world().discovered_clues.includes('house-built-1835'));
    // One roll a turn: a failed one finds nothing; a passed one in an earlier turn finds nothing in this one; a passed one
    // this turn lands it. The turns go on until all three have been seen (at most forty).
    let turn = 1, seen = {failed: false, carried: false};
    for (; turn < 40; turn++) {
        if (turn > 1) await game.call('table.player_input', {text: '我继续查。'});
        const passed = await libraryUse(game, turn);
        if (!passed) {
            assert.equal((await refusal(game.call('table.apply', {call_id: game.id(turn), effects: [{kind: 'clue', clue: 'house-built-1835'}]}))).details.reason, 'check_first',
                'a failed roll finds nothing');
            assert.equal((await row()).description.check.passed, false);
            seen.failed = true;
        } else if (!seen.failed || !seen.carried) {
            await game.call('table.narrate', {call_id: game.id(turn), text: '你合上卷宗。'});
            await game.call('table.player_input', {text: '我再翻一遍。'});
            turn += 1;
            assert.equal((await row()).description.check.passed, false, 'a roll of an earlier turn is not this turn\'s');
            assert.equal((await refusal(game.call('table.apply', {call_id: game.id(turn), effects: [{kind: 'clue', clue: 'house-built-1835'}]}))).details.reason, 'check_first');
            seen.carried = true;
        } else {
            assert.equal((await row()).description.check.passed, true);
            await game.call('table.apply', {call_id: game.id(turn), effects: [{kind: 'clue', clue: 'house-built-1835'}]});
            break;
        }
        await game.call('table.narrate', {call_id: game.id(turn), text: '你合上卷宗。'});
    }
    assert.ok(seen.failed && seen.carried, 'each case was reached');
    assert.ok(game.world().discovered_clues.includes('house-built-1835'));
});

test('§201.2: an obvious clue needs no roll, and checkPassed reads only an investigator\'s passed roll of that skill', async () => {
    const game = await table();
    await game.call('table.player_input', {text: '我去市政档案馆。'});
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'hall-of-records'}]});
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'chapel-closed-1912'}]});
    assert.ok(game.world().discovered_clues.includes('chapel-closed-1912'));
    const check = {skill: 'Spot Hidden'};
    assert.equal(api.checkPassed(check, [{kind: 'roll', skill: 'spot  hidden', passed: true, actor_is_investigator: true}]), true, 'case and spacing folded');
    assert.equal(api.checkPassed(check, [{kind: 'roll', check: {skill: 'Spot Hidden'}, passed: true}]), true, 'the check record\'s skill counts');
    assert.equal(api.checkPassed(check, [{kind: 'roll', skill: 'Spot Hidden', passed: false}]), false);
    assert.equal(api.checkPassed(check, [{kind: 'roll', skill: 'Spot Hidden', passed: true, actor_is_investigator: false}]), false, 'an NPC\'s roll finds nothing');
    assert.equal(api.checkPassed(check, [{kind: 'roll', skill: 'Listen', passed: true}]), false);
});
