/**
 * Contract §223: pushing, Luck and improvement ticks follow the Keeper Rulebook (user ruling 2026-10-10).
 *
 * - p.84-86: a push is the player's justified further attempt; foreshadowing its consequence is the Keeper's option, and a
 *   failed push without one gives the Keeper free rein. The receipt records where the consequence came from.
 * - p.94: no tick is earned if the roll used a bonus die -- any bonus die.
 * - p.99: Luck alters the result of a skill roll, a passed one included (the book buys a Dodge up to Extreme in an opposed
 *   contest); opposed checks are continuable and re-judged with the bought level; the combat path no longer throws.
 * - p.55: a combined roll is one die against several skills; it may be pushed and each skill the die beat may tick.
 * - p.93: the investigator with the lowest Luck rolls the group Luck roll.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
await mkdir(join(ROOT, '.tmp'), {recursive: true});
const temporary = await mkdtemp(join(ROOT, '.tmp/rulebook-rolls-'));
after(async () => { await rm(temporary, {recursive: true, force: true}); });
await build({
    stdin: {
        contents: [
            "export {createKernelContext} from './kernel-ts/context.ts';",
            "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
            "export {createKernelRuntime} from './kernel-ts/registry.ts';",
            "export {RuleTables} from './kernel-ts/rules/tables.ts';",
            "export {PythonRandom} from './kernel-ts/random.ts';",
            "export {CheckArithmetic} from './kernel-ts/resolve/arithmetic.ts';",
            "export {executeCheck, executePush, executeLuckSpend} from './kernel-ts/resolve/basic.ts';",
            "export {skillTickEligible, continuableCheck, recordSkillTicks} from './kernel-ts/resolve/context.ts';",
            "export {CombatSession} from './kernel-ts/combat/engine.ts';",
        ].join('\n'),
        resolveDir: ROOT, loader: 'ts', sourcefile: 'rulebook-rolls.ts',
    },
    outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const kernel = await api.createKernelContext({workspace: join(temporary, 'workspace'), content: join(ROOT, 'content')});
after(() => kernel.git.close());
const tables = new api.RuleTables(kernel);
const arithmetic = await api.CheckArithmetic.create(tables);
const rules = async name => JSON.parse(await readFile(join(ROOT, 'content/rulesets/coc7/rules-json', name + '.json'), 'utf8'));

const SHEET = {id: 'inv-harvey', name: 'Harvey', current_luck: 40,
    characteristics: {STR: 60, CON: 65, SIZ: 60, DEX: 60, APP: 55, INT: 65, POW: 55, EDU: 70, LUCK: 40},
    skills: {Dodge: 60, 'Spot Hidden': 50, Listen: 45, 'Mechanical Repair': 40, 'Electrical Repair': 30, 'Fighting (Brawl)': 50, 'Firearms (Handgun)': 40}};

/** A settle context reduced to what the executors read; `records` are the delivered turns (`rendered_text`). */
function table({records = [], seed = 'rulebook-rolls', saves = new Map()} = {}) {
    const rolls = [], deltas = [], continued = [], receipts = [];
    const sheet = structuredClone(SHEET);
    return {rolls, deltas, continued, receipts, saves, sheet, context: {
        tables, arithmetic, rng: new api.PythonRandom(seed), actorId: sheet.id, actor: sheet, campaignId: 'rolls', receipts,
        snapshot: {records}, sheetById: id => (id === sheet.id ? sheet : null), npcNode: () => null,
        addRoll(input) { rolls.push(input); return `roll:${rolls.length}`; },
        addDelta(resource, subject, before, afterValue, options) { deltas.push({resource, subject, before, after: afterValue, ...options}); return `delta:${deltas.length}`; },
        markReceiptContinued(id, kind) { continued.push([id, kind]); },
        async writeSheet() {}, async readSave(path) { return saves.get(path) ?? null; }, async writeSave(path, value) { saves.set(path, structuredClone(value)); },
    }};
}
const canonical = (roll, target, level = 'regular', extra = {}) => ({...arithmetic.resolve(roll, target, level), roll, skill: 'Dodge', kind: 'skill_check', pushed: false, ...extra});
const refusal = fn => { try { fn(); } catch (error) { return error.message; } return assert.fail('expected a refusal'); };

test('p.99: Luck may raise the level of a passed roll; the exclusions stand', () => {
    // Dodge 60: 31 is a regular success; one Luck point makes it 30, a hard success.
    const raised = arithmetic.spendLuck(canonical(31, 60), 1, 40);
    assert.equal(raised.roll, 30);
    assert.equal(raised.achieved_level, 'hard');
    assert.equal(raised.passed, true);
    assert.equal(raised.luck_spent, 1);
    assert.equal(raised.luck_remaining, 39);
    assert.equal(raised.improvement_tick_eligible, false, 'no improvement check after Luck (p.99)');
    // The book's example: a failed Dodge bought up to an Extreme success.
    const extreme = arithmetic.spendLuck(canonical(35, 27), 30, 40);
    assert.equal(extreme.roll, 5);
    assert.equal(extreme.achieved_level, 'extreme');
    // A failure stays alterable, as before.
    assert.equal(arithmetic.spendLuck(canonical(74, 50), 24, 50).passed, true);
    assert.equal(refusal(() => arithmetic.spendLuck(canonical(1, 60), 1, 40)), 'criticals_fumbles_malfunctions_cannot_be_bought_off');
    assert.equal(refusal(() => arithmetic.spendLuck(canonical(31, 60, 'regular', {pushed: true}), 1, 40)), 'luck_may_not_alter_a_pushed_roll');
    assert.equal(refusal(() => arithmetic.spendLuck(canonical(31, 60), 1, 40, 'sanity')), 'luck_may_not_be_spent_on_sanity_rolls');
    assert.equal(refusal(() => arithmetic.spendLuck(canonical(31, 60), 1, 40, 'damage')), 'luck_may_not_be_spent_on_damage_rolls');
    assert.equal(refusal(() => arithmetic.spendLuck(canonical(31, 60), 1, 40, 'luck')), 'luck_may_not_be_spent_on_luck_rolls');
    assert.equal(refusal(() => arithmetic.spendLuck(canonical(31, 60), 41, 40)), 'insufficient_luck');
});

test('§223.3: one contest rule for the rolled and the bought level', () => {
    assert.equal(arithmetic.contestWinner('regular', 60, 'hard', 50), 'opponent');
    assert.equal(arithmetic.contestWinner('hard', 60, 'regular', 50), 'investigator');
    assert.equal(arithmetic.contestWinner('hard', 60, 'hard', 50), 'investigator', 'equal levels: the higher skill');
    assert.equal(arithmetic.contestWinner('hard', 40, 'hard', 50), 'opponent');
    assert.equal(arithmetic.contestWinner('failure', 60, 'failure', 50), 'none');
});

test('§223.3: Luck on a non-combat opposed check re-judges the contest with the bought level', async () => {
    const {context, rolls, deltas, continued} = table();
    // Harvey rolled 40 against Dodge 60 (regular) and lost to the opponent's hard success. Ten Luck points make it 30: hard, and
    // on equal levels the higher skill (60 over 50) wins.
    const original = {...canonical(40, 60), kind: 'opposed_check', opposed_won: false, opponent_level: 'hard', opponent_target: 50, visibility: 'public'};
    assert.equal(api.continuableCheck({kind: 'roll', actor: SHEET.id, roll_kind: 'opposed_check', visibility: 'public', check: original}, SHEET.id), true,
        'the investigator\'s side of an opposed check is continuable');
    assert.equal(api.continuableCheck({kind: 'roll', actor: 'npc', roll_kind: 'opposed_check', visibility: 'public', check: original}, SHEET.id), false);
    const result = await api.executeLuckSpend(context, {canonical_roll_receipt: original, points: 10, original_check_decision_id: 'roll:dodge-t3-c1', source_roll_id: 'roll:dodge-t3-c1'}, {});
    assert.equal(result.data.roll, 30);
    assert.equal(result.data.achieved_level, 'hard');
    assert.equal(result.data.opposed_won, true);
    assert.equal(result.data.contest_winner, 'investigator');
    assert.equal(result.data.luck_after, 30);
    assert.equal(rolls.at(-1).kind, 'luck_bought');
    assert.equal(rolls.at(-1).contest_winner, 'investigator');
    assert.deepEqual(continued, [['roll:dodge-t3-c1', 'luck']]);
    assert.equal(deltas[0].resource, 'luck');
    assert.ok(result.hints.some(hint => hint.includes('winner investigator')));
    // A spend that does not reach the opponent's level loses the contest still, honestly.
    const short = await api.executeLuckSpend(table().context, {canonical_roll_receipt: original, points: 5, original_check_decision_id: 'roll:dodge-t3-c1', source_roll_id: 'roll:dodge-t3-c1'}, {});
    assert.equal(short.data.contest_winner, 'opponent');
    assert.equal(short.data.opposed_won, false);
});

test('p.94: any bonus die withholds the improvement tick', () => {
    const success = {...arithmetic.resolve(49, 50, 'regular'), roll: 49, kind: 'skill_check'};
    assert.equal(api.skillTickEligible(arithmetic, 'Spot Hidden', {...success, bonus: 0, penalty: 0}), true);
    // The natural die (49) succeeded on its own; the roll still used a bonus die, so no tick.
    assert.equal(api.skillTickEligible(arithmetic, 'Spot Hidden', {...success, bonus: 1, penalty: 0, tens_values: [4, 5], units: 9, unmodified_roll: 49}), false);
    assert.equal(api.skillTickEligible(arithmetic, 'Spot Hidden', {...success, bonus: 2, penalty: 0, tens_values: [4, 5, 7], units: 9, unmodified_roll: 49}), false);
    // A bonus die cancelled one-for-one by a penalty die is no bonus die on the roll (§95): `bonus` is the net count.
    assert.equal(api.skillTickEligible(arithmetic, 'Spot Hidden', {...success, bonus: 0, penalty: 0, tens_values: [], units: null}), true);
    const data = api.skillTickEligible(arithmetic, 'Spot Hidden', {...success, bonus: 0, penalty: 1, tens_values: [4, 2], units: 9, unmodified_roll: 49});
    assert.equal(data, true, 'a penalty die is not a bonus die');
});

test('p.84-86: a push needs the player\'s justification; the consequence source is recorded honestly', async () => {
    const original = {skill: 'Spot Hidden', target: 50, difficulty: 'regular', outcome: 'failure', pushed: false, bonus: 0, penalty: 0, goal: 'find the hidden catch'};
    const push = (context, args) => api.executePush(context, {canonical_roll_receipt: original, original_check_decision_id: 'roll:spot-hidden-t2-c1', method_changed: 'I tear the panelling off with the crowbar', ...args}, {decision_ref: null});
    // No consequence was foreshadowed: the push rolls and the Keeper's free rein is on the receipt.
    const free = await push(table().context, {});
    assert.equal(free.data.pushed, true);
    assert.deepEqual(free.data.failure_consequence, {summary: '', source: 'keeper_free_rein'});
    assert.deepEqual(free.data.pushed_roll_protocol, {failure_consequence_source: 'keeper_free_rein', keeper_foreshadowed_failure: false, player_declared_push: true});
    if (!free.data.success) assert.ok(free.hints.some(hint => hint.includes('free rein')), free.hints.join(' | '));
    // The Keeper gave a consequence on the call that was never said to the player: stated, not foreshadowed.
    const stated = await push(table().context, {failure_consequence: 'the panelling comes down on you'});
    assert.equal(stated.data.failure_consequence.source, 'keeper_stated');
    assert.equal(stated.data.pushed_roll_protocol.keeper_foreshadowed_failure, false);
    // The same sentence had been delivered at this table: foreshadowed.
    const records = [{turn: 2, rendered_text: 'The catch will not give. If you fail, the panelling comes down on you.'}];
    const foreshadowed = await push(table({records}).context, {failure_consequence: 'the panelling comes down on you'});
    assert.equal(foreshadowed.data.failure_consequence.source, 'delivered_text');
    assert.equal(foreshadowed.data.pushed_roll_protocol.keeper_foreshadowed_failure, true);
    // The limits stand: a fumble, a pushed roll and a combat skill are never pushed.
    for (const [source, message] of [[{...original, outcome: 'fumble'}, /fumbles are final/], [{...original, pushed: true}, /already been pushed/], [{...original, skill: 'Fighting (Brawl)'}, /combat skill/]]) {
        const error = await api.executePush(table().context, {canonical_roll_receipt: source, original_check_decision_id: 'roll:x', method_changed: 'again'}, {decision_ref: null}).catch(error => error);
        assert.match(String(error.message), message);
    }
    const data = await rules('pushed-roll');
    assert.equal(data.requires_keeper_foreshadowed_failure, false);
    assert.equal(data.foreshadowing, 'optional');
    assert.deepEqual(data.required_stages, ['player_justifies_push', 'keeper_approves', 'roll_resolved']);
    assert.deepEqual(data.failure_consequence_sources, ['delivered_text', 'keeper_stated', 'keeper_free_rein']);
});

test('p.55: a combined check may be pushed and each skill the die beat may tick', async () => {
    const targets = [{label: 'Mechanical Repair', value: 40}, {label: 'Electrical Repair', value: 30}];
    const {context, rolls} = table({seed: 'combined-fail'});
    const first = await api.executeCheck(context, {combined_targets: targets, combined_mode: 'all', difficulty: 'regular', goal: 'repair the turbine'}, {decision_ref: null});
    assert.equal(first.data.kind, 'combined_skill_check');
    assert.equal(first.data.push_eligible, true, 'a combined roll of non-combat skills is pushable (p.85 removes the push from combat rolls only)');
    assert.deepEqual(first.data.combined_targets, targets);
    assert.equal(first.data.combined_mode, 'all');
    const combat = await api.executeCheck(table().context, {combined_targets: [{label: 'Fighting (Brawl)', value: 50}, {label: 'Dodge', value: 60}], combined_mode: 'any'}, {decision_ref: null});
    assert.equal(combat.data.push_eligible, false, 'two combat skills: nothing to push');
    // The push repeats the same one die against the same named skills.
    const pushed = await api.executePush(context, {canonical_roll_receipt: {...first.data, outcome: 'failure', pushed: false}, original_check_decision_id: 'roll:1', method_changed: 'I strip the housing and start over'}, {decision_ref: null});
    assert.equal(pushed.data.kind, 'combined_skill_check');
    assert.equal(pushed.data.pushed, true);
    assert.deepEqual(pushed.data.combined_roll.targets.map(target => target.label), targets.map(target => target.label));
    assert.equal(pushed.data.combined_roll.comparison_mode, 'all');
    assert.equal(rolls.length, 2);
    // Ticks: a combined receipt whose die beat Mechanical Repair but not Electrical Repair ticks the one skill.
    const saves = new Map();
    const ticking = table({saves});
    const die = 35;
    const roll = {...arithmetic.resolve(die, 40, 'regular'), roll: die, bonus: 0, penalty: 0, kind: 'combined_skill_check',
        combined_roll: arithmetic.combined(targets, die, 'regular', 'any'), skill: 'Mechanical Repair / Electrical Repair'};
    ticking.context.receipts.push({id: 'roll:combined-t4-c1', kind: 'roll', actor: SHEET.id, skill: roll.skill, roll_kind: 'combined_skill_check', visibility: 'public', check: roll});
    await api.recordSkillTicks(ticking.context);
    const state = saves.get(`development-state/${SHEET.id}.json`);
    assert.deepEqual(Object.values(state.ticks).map(tick => [tick.skill, tick.source_event_id]), [['Mechanical Repair', 'roll:combined-t4-c1#Mechanical Repair']]);
    // With a bonus die on the roll no skill ticks (p.94), and a whole combined receipt is never a tick of its own.
    const bonus = table({saves: new Map()});
    bonus.context.receipts.push({id: 'roll:combined-t5-c1', kind: 'roll', actor: SHEET.id, skill: roll.skill, roll_kind: 'combined_skill_check', visibility: 'public', check: {...roll, bonus: 1}});
    await api.recordSkillTicks(bonus.context);
    assert.equal(bonus.saves.size, 0);
    assert.equal(api.skillTickEligible(arithmetic, roll.skill, roll), false);
    // Luck on a combined check (p.99): the one die is bought down and compared with every named skill again. Die 35 beats
    // Mechanical Repair 40 but not Electrical Repair 30 under `all`; five Luck points make it 30 and both succeed.
    const luck = table();
    const failedAll = {...arithmetic.resolve(35, 40, 'regular'), roll: 35, bonus: 0, penalty: 0, kind: 'combined_skill_check', skill: roll.skill, pushed: false,
        combined_targets: targets, combined_mode: 'all', combined_roll: arithmetic.combined(targets, 35, 'regular', 'all'), success: false, passed: false, outcome: 'failure', level: 'failure', achieved_level: 'failure'};
    const bought = await api.executeLuckSpend(luck.context, {canonical_roll_receipt: failedAll, points: 5, original_check_decision_id: 'roll:combined-t6-c1', source_roll_id: 'roll:combined-t6-c1'}, {});
    assert.equal(bought.data.roll, 30);
    assert.equal(bought.data.passed, true);
    assert.deepEqual(bought.data.combined_roll.targets.map(target => target.success), [true, true]);
    assert.equal(bought.data.improvement_tick_eligible, false);
    const development = await rules('development');
    assert.ok(!development.tick.excluded_outcomes.includes('combined_roll_participant'));
    assert.ok(development.tick.excluded_outcomes.includes('bonus_die_used'));
});

test('p.99 in combat: a precommitted Luck spend raises a passed-but-losing attack instead of throwing', async () => {
    const rng = new api.PythonRandom('combat-luck');
    const session = await api.CombatSession.create('luck', 'scene/test', 1, rng, tables);
    for (const [id, side] of [['hero', 'investigator'], ['ghoul', 'npc']])
        session.addParticipant(id, side, {dex: 60, combatSkill: 60, dodgeSkill: 60, build: 0, hpMax: 20, weapons: [{weapon_id: 'unarmed'}]});
    // Script the two percentile dice: the attack rolls 50 (a regular success at 60), the dodge rolls 25 (hard). Before
    // §223.3 the engine found that 38 Luck points (roll 12, extreme) win the contest and asked the arithmetic to spend them,
    // which refused a passed roll (`luck_may_only_alter_a_failed_roll`) and threw out of the whole turn.
    const scripted = [50, 25];
    const real = session.arithmetic;
    Object.defineProperty(session, 'arithmetic', {value: Object.create(real, {check: {value(target, difficulty, bonus, penalty, random) {
        if (!scripted.length) return real.check(target, difficulty, bonus, penalty, random);
        const roll = scripted.shift();
        return {...real.resolve(roll, Math.max(1, Math.min(99, target)), difficulty), roll, bonus: 0, penalty: 0, unmodified_roll: roll, tens_values: [], units: null, rule_refs: []};
    }}})});
    session.beginRound();
    const turn = session.declareAndResolveTurn('hero', 'punch the ghoul', {action: 'attack', targetActorId: 'ghoul', defenseKind: 'dodge', weaponId: 'unarmed',
        luckPrecommit: {actor_id: 'hero', current_luck: 40, max_points: 40}});
    assert.equal(turn.opposed_outcome, 'attacker_higher');
    assert.equal(turn.outcome, 'hit');
    assert.equal(turn.luck_spend.luck_spent, 38);
    assert.equal(turn.luck_spend.original_roll, 50);
    assert.equal(turn.luck_spend.adjusted_roll, 12);
    assert.equal(turn.luck_spend.outcome, 'extreme');
    assert.equal(turn.luck_spend.luck_after, 2);
    const [rolls] = session.drainPending();
    const attack = rolls.find(record => record.roll_id === turn.roll_id);
    assert.equal(attack.roll, 12);
    assert.equal(attack.improvement_tick_eligible, false);
});

test('p.93: the investigator with the lowest Luck rolls the group Luck roll', async () => {
    const luck = await rules('luck');
    assert.equal(luck.roll.group_roll_policy, 'lowest_luck_rolls');
    assert.ok(luck.spend.constraints.includes('luck_may_raise_the_success_level'));
    assert.ok(luck.spend.constraints.includes('luck_may_alter_an_opposed_roll'));
    assert.ok(luck.spend.constraints.includes('luck_may_not_alter_a_pushed_roll'));
    const index = JSON.parse(await readFile(join(ROOT, 'content/rulesets/coc7/rules-json/rule-index.json'), 'utf8'));
    assert.equal(index.rules.find(rule => rule.id === 'core.luck.roll').numeric.group_roll_policy, 'lowest_luck_rolls');
});

test('§223.1 end to end: the host offers the push with no foreshadowed consequence, and the kernel settles it with free rein', async t => {
    const home = await mkdtemp(join(temporary, 'home-'));
    const context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content'), seed: 'rulebook-rolls-push',
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context);
    t.after(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'rolls', ...params});
    const record = async turn => JSON.parse(await readFile(join(home, '.coc/campaigns/rolls/turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
    await call('campaign.create', {id: 'rolls', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    let calls = 0;
    const id = () => `t1-c${++calls}`;
    await call('table.player_input', {text: 'I try to steer the rowing boat across the river.'});
    // Pilot (Boat) is not on the sheet: its base chance is 1, so the seeded die fails (a 1 would be a critical and is checked).
    const first = await call('table.resolve', {call_id: id(), action: {intent: 'investigate', goal: 'cross the river', method: 'steer the rowing boat', skill: 'Pilot (Boat)'}});
    assert.equal(first.outcome.kind, 'check');
    assert.equal(first.outcome.level, 'failure', 'the fixture needs an ordinary failure to push');
    assert.ok(first.continuations.some(entry => /pushed-roll$/.test(entry.decision)), JSON.stringify(first.continuations));
    const options = await call('table.resolve.options');
    const push = options.selection.options.find(option => option.action.decision === 'push-luck:pushed-roll');
    assert.ok(push, 'the push is offered although nothing foreshadowed a consequence');
    assert.match(push.label, /justified further attempt/);
    const stakes = push.parameters.find(parameter => parameter.name === 'stakes');
    assert.deepEqual(stakes.default.value, '', 'the rules default is no foreshadowed consequence');
    assert.match(push.definition, /extra effort, time or risk/);
    const pushed = await call('table.resolve', {call_id: id(), action: {intent: 'investigate', goal: 'cross the river', method: 'I lash the tiller and throw my whole weight against the current', skill: 'Pilot (Boat)', push: true}});
    assert.equal(pushed.outcome.kind, 'push');
    assert.equal(pushed.outcome.pushed, true);
    assert.equal(pushed.outcome.failure_consequence, '');
    await call('table.narrate', {call_id: id(), text: 'The boat swings into the current; the far bank is a long way off.'});
    const receipts = (await record(1)).receipts.filter(receipt => receipt.kind === 'roll');
    const roll = receipts.find(receipt => receipt.pushed === true);
    assert.ok(roll, 'the pushed roll is on the turn record');
    assert.equal(roll.source_receipt, receipts[0].id);
    assert.deepEqual(roll.check.failure_consequence, {summary: '', source: 'keeper_free_rein'});
    assert.deepEqual(roll.check.pushed_roll_protocol, {failure_consequence_source: 'keeper_free_rein', keeper_foreshadowed_failure: false, player_declared_push: true});
    assert.ok(pushed.hints.some(hint => /free rein/.test(hint)), pushed.hints.join(' | '));
});

test('§223.3 end to end: a regular success grants the Luck continuation and the spend settles', async t => {
    const home = await mkdtemp(join(temporary, 'home-'));
    const context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content'), seed: 'rulebook-rolls-luck',
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context);
    t.after(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'rolls', ...params});
    await call('campaign.create', {id: 'rolls', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    // The dice are seeded, not scripted: turns go on until a Spot Hidden (55) comes up a regular success (at most forty).
    let found = null;
    for (let turn = 1; turn <= 40 && !found; turn++) {
        await call('table.player_input', {text: 'I look the room over once more.'});
        const result = await call('table.resolve', {call_id: `t${turn}-c1`, action: {intent: 'investigate', goal: 'notice what is out of place', method: 'look the room over', skill: 'Spot Hidden'}});
        if (result.outcome.level === 'regular') found = {turn, result};
        else await call('table.narrate', {call_id: `t${turn}-c2`, text: 'Nothing new catches the eye.'});
    }
    assert.ok(found, 'no regular success in forty seeded turns');
    const {turn, result} = found;
    assert.ok(result.continuations.some(entry => /luck-spend$/.test(entry.decision)), 'Luck is offered after a passed roll: ' + JSON.stringify(result.continuations));
    assert.ok(!result.continuations.some(entry => /pushed-roll$/.test(entry.decision)), 'a passed roll is not pushed');
    const roll = result.outcome.roll, threshold = Math.floor(55 / 2);
    const points = Math.max(1, roll - threshold);
    const spend = await call('table.resolve', {call_id: `t${turn}-c2`, action: {intent: 'investigate', goal: 'notice what is out of place', method: 'look the room over', luck: points}});
    assert.equal(spend.outcome.kind, 'luck');
    assert.equal(spend.outcome.points, points);
    assert.equal(spend.outcome.roll, roll - points);
    assert.equal(spend.outcome.level, 'hard', 'the bought level is hard');
    assert.equal(spend.outcome.luck_after, 50 - points);
});
