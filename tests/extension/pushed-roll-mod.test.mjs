import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {validateToolArguments} from '@earendil-works/pi-ai';

const ROOT = resolve(import.meta.dirname, '../..');
await mkdir(join(ROOT, '.tmp'), {recursive: true});
const temporary = await mkdtemp(join(ROOT, '.tmp/pushed-roll-mod-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: [
    "export * from './kernel-ts/mods/pushed-roll-policy.ts';",
    "export * from './kernel-ts/mods/pushed-roll.ts';",
    "export {validateManifest, readModCatalog, MOD_CAPABILITIES} from './kernel-ts/read/mods.ts';",
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {PythonRandom} from './kernel-ts/random.ts';",
    "export {CheckArithmetic} from './kernel-ts/resolve/arithmetic.ts';",
    "export {RuleTables} from './kernel-ts/rules/tables.ts';",
    "export {specializedTriggerQuestion, selectCheck} from './runtime/jev/resolve-selection.ts';",
    "export {TaskLease} from './runtime/jev/task-context.ts';",
    "export {bindDecisionAnswers} from './runtime/jev/contracts.ts';",
    "export {COC_TOOLS} from './extensions/kernel/tools.ts';",
    "export {buildCandidates} from './runtime/jev/candidates.ts';",
].join('\n'), resolveDir: ROOT, loader: 'ts'}, outfile: join(temporary, 'api.mjs'),
bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const rules = JSON.parse(await readFile(join(ROOT, 'mods/pushed-roll/rules.json'), 'utf8'));
const provider = {id: 'pushed-roll', version: '1.0.0', digest: 'test-digest', rules};
const source = (extra = {}) => ({id: 'roll:first', kind: 'roll', actor: 'harvey', skill: 'Listen',
    roll_kind: 'skill_check', passed: false, level: 'failure', pushed: false, visibility: 'public',
    check: {kind: 'skill_check', outcome: 'failure', target: 40, difficulty: 'regular', skill: 'Listen', goal: 'hear the conversation'}, ...extra});
const tables = {async skillByName(label) {return {group: label === 'Fighting (Brawl)' ? 'Fighting' : null};}};
const refusal = (receipt, extra = {}, active = provider) => api.pushRefusal(active, receipt,
    {actor: 'harvey', receipts: receipt ? [receipt] : [], ...extra}, tables);

test('the real Keeper resolve schema accepts the host push binding before kernel dispatch', () => {
    const tool = api.COC_TOOLS.find(tool => tool.name === 'resolve');
    const call = value => validateToolArguments({name: 'resolve', description: '', parameters: tool.parameters},
        {type: 'toolCall', id: 'host-push', name: 'resolve', arguments: {action: {
            intent: 'investigate', goal: 'open the window', method: 'I push the roll.', push: true, push_context: value}}});
    for (const value of ['same_goal', 'goal_obsolete', 'source_ambiguous', 'judgment_unavailable']) assert.doesNotThrow(() => call(value));
    assert.throws(() => call('invented'));
});

test('subsystem-owned catalogs retain only forbidden push declarations for explanatory refusal', () => {
    const push = {key: 'push', family: 'push-luck', label: 'Ada pushes', action: {decision: 'push-luck:pushed-roll', actor: 'Ada', push: true},
        authorization: 'declaration', parameters: [], needs: [], definition: rules.declaration, facts: {push_refusal: 'chase_roll'}};
    const ordinary = {key: 'ordinary', family: 'core-check', label: 'Ada checks', action: {decision: 'core-check:ordinary-check', actor: 'Ada'},
        authorization: 'declaration', parameters: [], needs: []};
    const reads = {capsule: {}, applyOptions: {}, resolveOptions: {selection: {owner: 'jev', version: 1, session_owned: true, options: [push, ordinary]}}};
    const offered = api.buildCandidates(reads, 'I push the roll.');
    assert.ok(offered.some(candidate => candidate.bound.decision === 'push-luck:pushed-roll'));
    assert.ok(!offered.some(candidate => candidate.bound.decision === 'core-check:ordinary-check'));
    push.facts.push_refusal = null;
    assert.ok(!api.buildCandidates(reads, 'I push the roll.').some(candidate => candidate.bound.decision === 'push-luck:pushed-roll'),
        'a potentially executable continuation cannot bypass the subsystem owner');
});

test('the actual Mod contribution validates; each D100 result has one authoritative row', () => {
    api.validatePushRules(rules);
    assert.ok(api.MOD_CAPABILITIES.has(api.PUSH_CAPABILITY));
    for (let roll = 1; roll <= 100; roll++) {
        let draws = 0;
        const risk = api.drawPushRisk({rng: {randint(lo, hi) {draws++; assert.deepEqual([lo, hi], [1, 100]); return roll;}}}, provider);
        const matches = rules.rows.filter(row => roll >= row.min && roll <= row.max);
        assert.equal(matches.length, 1); assert.equal(risk.key, matches[0].key); assert.equal(risk.roll, roll);
        assert.equal(draws, 1); assert.equal(risk.fallback.length, 2);
    }
    for (const mutate of [r => r.rows[0].max++, r => r.rows.at(-1).max--, r => r.rows[1].key = r.rows[0].key,
        r => r.fallback[0] = 'missing', r => delete r.refusals.chase_roll, r => r.excluded_groups = []]) {
        const invalid = structuredClone(rules); mutate(invalid);
        assert.throws(() => api.validatePushRules(invalid), /Invalid pushed-roll contribution/);
    }
});

test('source selection sees the latest prohibited roll instead of fishing for an older failure', () => {
    const failed = source(), san = source({id: 'roll:san', roll_kind: 'sanity_check'});
    assert.equal(api.latestPushSource([failed, san], 'harvey'), san);
    assert.equal(api.latestPushSource([failed, source({actor: 'other'}), {kind: 'roll', actor: 'harvey', form: 'dice'}], 'harvey'), failed);
});

test('every scope exclusion blocks before any RNG is available', async () => {
    const cases = [
        [null, {}, 'no_source'], [source({actor: 'other'}), {}, 'wrong_actor'],
        [source({roll_kind: 'sanity_check'}), {}, 'sanity_roll'],
        [source({roll_kind: 'luck_roll'}), {}, 'luck_roll'],
        [source({skill: 'LUCK', roll_kind: 'characteristic_check'}), {}, 'luck_roll'],
        [source({roll_kind: 'combat_check'}), {}, 'combat_roll'],
        [source({skill: 'Fighting (Brawl)'}), {}, 'combat_roll'],
        [source({skill: 'Dodge'}), {}, 'combat_roll'],
        [source(), {session: {kind: 'chase'}}, 'chase_roll'],
        [source({roll_kind: 'chase_hazard'}), {}, 'chase_roll'],
        [source({form: 'dice'}), {}, 'amount_roll'],
        [source({roll_kind: 'opposed_check'}), {}, 'opposed_roll'],
        [source({level: 'fumble', check: {outcome: 'fumble'}}), {}, 'fumble'],
        [source({pushed: true}), {}, 'already_pushed'],
        [source(), {receipts: [{source_receipt: 'roll:first'}]}, 'luck_used'],
        [source(), {luck: 1}, 'push_luck_conflict'],
        [source({passed: true, check: {outcome: 'regular'}}), {}, 'not_failure'],
        [source({roll_kind: 'healing_check'}), {}, 'procedure_unavailable'],
        [source({roll_kind: 'casting_roll'}), {}, 'procedure_unavailable'],
        [source({roll_kind: 'learning_roll'}), {}, 'procedure_unavailable'],
        [source({roll_kind: 'development_check'}), {}, 'procedure_roll'],
        [source(), {continuation: 'goal_obsolete'}, 'goal_obsolete'],
        [source(), {continuation: 'source_ambiguous'}, 'source_ambiguous'],
        [source(), {continuation: 'invented'}, 'judgment_unavailable'],
        [source({roll_kind: 'combined_skill_check', check: {outcome: 'failure', combined_targets: [{label: 'Listen'}, {label: 'Fighting (Brawl)'}]}}), {}, 'combat_roll'],
    ];
    for (const [receipt, extra, expected] of cases) assert.equal(await refusal(receipt, extra), expected, expected);
    assert.equal(await refusal(source(), {}, null), 'mod_disabled');
    assert.equal(await refusal(source()), null);
    assert.equal(await refusal(source(), {session: {kind: 'combat'}}), null, 'a fight does not turn an ordinary noncombat skill into a combat roll');
    assert.equal(await refusal(source({skill: 'STR', roll_kind: 'characteristic_check'})), null);
    assert.equal(await refusal(source({roll_kind: 'combined_skill_check', check: {outcome: 'failure', combined_targets: [{label: 'Listen'}, {label: 'Spot Hidden'}]}})), null);
});

test('refusal recovery tells the Keeper to explain and stop, rather than requesting another method', () => {
    assert.throws(() => api.refusePush('mod_disabled', null), error => /Mod is not active/.test(error.message));
    for (const reason of api.PUSH_REASONS) {
        assert.throws(() => api.refusePush(reason, provider), error => {
            const result = error.toJson();
            assert.equal(result.code_detail, 'rule_decision_not_applicable');
            assert.equal(result.next, 'narrate'); assert.equal(result.retryable, false);
            assert.equal(result.details.reason, reason); assert.equal(result.details.push_refused, true);
            assert.match(result.fix, /Do not roll/); assert.match(result.fix, /play_language/);
            return true;
        });
    }
});

test('the real selector delivers a forbidden declaration to the guard, and rejects non-declarations and uncertain context', async t => {
    const scope = {owner: 'push-selection', campaign: 'push', worldline: 'main', loop: 0, audience: 'keeper'};
    async function select({declared = true, context = 'same_goal', blocked = true, uncertain = false, recognition = .99, binding = .99} = {}) {
        const lease = new api.TaskLease({owner: 'push-selection', goal: 'push', scope, readSet: [], capabilities: ['decision'],
            budget: {deadlineAt: Date.now()+10_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
        t.after(() => lease.close());
        const option = {key: 'push', family: 'push-luck', label: 'Ada declares a push', definition: rules.declaration,
            action: {actor: 'Ada', decision: 'push-luck:pushed-roll', push: true}, facts: {actor_role: 'investigator', source_goal: 'open the door'},
            parameters: [{name: 'push_context', question: rules.context_question, selection: 'compatible',
                options: ['same_goal','goal_obsolete','source_ambiguous'].map(value => ({label: value, value}))}], needs: [], authorization: 'declaration'};
        return api.selectCheck({options: [option], request: {decision: 'push-luck:pushed-roll', bound: {}},
            declaration: declared ? 'I push the roll.' : 'What is a pushed roll?', context: {conditions: [{actor: 'Ada'}]},
            scope, readSet: [], lease, investigators: ['Ada'], decision: {async decide(batch) {
                const answers = Object.fromEntries(batch.questions.map(question => {
                    const key = question.key.replace(/__semantic_(facts|execution)$/, '');
                    const value = batch.family.endsWith('-bind') ? uncertain ? .5 : question.target === `push_context: ${context}` ? binding : .01
                        : key.endsWith('_blocked') ? blocked ? .99 : .01 : declared ? recognition : .01;
                    return [question.key, {status: 'answered', type: 'noul', noul: value}];
                }));
                return api.bindDecisionAnswers(batch, answers, {inputTokens: 1, outputTokens: 1, costUsd: 0});
            }}});
    }
    const blocked = await select();
    assert.equal(blocked.status, 'selected', 'the canonical guard, rather than a deferred prerequisite, owns refusal');
    assert.equal(blocked.action.push_context, 'same_goal');
    const question = await select({declared: false});
    assert.equal(question.status, 'no_roll');
    assert.equal((await select({recognition: .70})).status, 'selected', 'a declared rule is recognized without proving automatic necessity');
    assert.equal((await select({recognition: .64})).status, 'no_roll', 'recognition still fails closed below applicability');
    assert.equal((await select({binding: .70})).action.push_context, 'same_goal');
    assert.equal((await select({binding: .64})).action.push_context, 'judgment_unavailable');
    assert.equal((await select({context: 'goal_obsolete', binding: .70})).action.push_context, 'judgment_unavailable');
    const obsolete = await select({context: 'goal_obsolete'});
    assert.equal(obsolete.action.push_context, 'goal_obsolete');
    const uncertain = await select({uncertain: true});
    assert.equal(uncertain.action.push_context, 'judgment_unavailable');
});

async function campaign(t, id = 'push', seed = 'rulebook-rolls-push') {
    const home = await mkdtemp(join(temporary, `${id}-`));
    const context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content'), seed,
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: id, ...params});
    await call('campaign.create', {id, module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    return {call, context, home, id};
}

test('real RPC: a bare declaration after delivered failure draws once, keeps the original arithmetic and reuses on retry', async t => {
    const {call, home, id} = await campaign(t);
    await call('table.player_input', {text: 'I try to steer the rowing boat across the river.'});
    const first = await call('table.resolve', {call_id: 't1-c1', action: {intent: 'investigate', goal: 'cross the river', method: 'steer the rowing boat', skill: 'Pilot (Boat)'}});
    assert.equal(first.outcome.level, 'failure');
    await call('table.narrate', {call_id: 't1-c2', text: 'The current catches the boat. You have not reached the far bank.'});
    await call('table.player_input', {text: 'I push the roll.'});
    const options = await call('table.resolve.options');
    const push = options.selection.options.find(option => option.action.decision === 'push-luck:pushed-roll');
    assert.ok(push); assert.equal(push.facts.push_refusal, null);
    assert.match(api.specializedTriggerQuestion(push), /bare rule declaration/);
    assert.ok(!push.parameters.some(parameter => ['stakes', 'method'].includes(parameter.name)));
    const request = {call_id: 't2-c1', action: {intent: 'investigate', goal: 'cross the river', push: true, push_context: 'same_goal'}};
    const result = await call('table.resolve', request);
    assert.equal(result.outcome.kind, 'push');
    assert.equal(result.outcome.target, first.outcome.target);
    assert.equal(result.outcome.difficulty, first.outcome.difficulty);
    assert.ok(result.outcome.pushed_risk.roll >= 1 && result.outcome.pushed_risk.roll <= 100);
    assert.equal(result.outcome.pushed_risk.activated, !result.outcome.passed);
    const repeated = await call('table.resolve', request);
    assert.deepEqual(repeated.outcome, result.outcome);
    await assert.rejects(call('table.resolve', {...request, call_id: 't2-c2'}), error => error.details?.reason === 'already_pushed');
    const told = await call('table.narrate', {call_id: 't2-c3', text: 'The final attempt is over; the river carries the boat downstream.'});
    const record = JSON.parse(await readFile(join(home, '.coc/campaigns', id, 'turns/0002.json'), 'utf8'));
    const rolls = record.receipts.filter(receipt => receipt.kind === 'roll');
    assert.equal(rolls.filter(receipt => receipt.pushed).length, 1);
    const risk = rolls.find(receipt => receipt.pushed).check.pushed_risk;
    assert.equal(risk.roll, result.outcome.pushed_risk.roll);
    assert.equal(risk.key, result.outcome.pushed_risk.key);
    assert.equal(risk.activated, result.outcome.pushed_risk.activated);
    assert.ok(risk.digest); assert.equal(result.outcome.pushed_risk.digest, undefined);
    assert.ok(told.mechanics.some(card => card.kind === 'roll'), 'inspect actual player delivery, not an absent resolve field');
    assert.ok(told.mechanics.every(card => !('pushed_risk' in card)));
});

test('real RPC: no source is a visible refusal, with no settlement receipt or ordinary retry', async t => {
    const {call, context, home, id} = await campaign(t, 'invalid');
    await call('table.player_input', {text: 'I push the roll.'});
    const options = await call('table.resolve.options');
    const push = options.selection.options.find(option => option.action.decision === 'push-luck:pushed-roll');
    assert.equal(push.facts.push_refusal, 'no_source');
    const before = await readFile(join(home, '.coc/campaigns', id, 'world.json'), 'utf8');
    const control = await campaign(t, 'invalid-control');
    await control.call('table.player_input', {text: 'I push the roll.'});
    await control.call('table.resolve.options');
    await assert.rejects(call('table.resolve', {call_id: 't1-c1', action: {intent: 'investigate', goal: 'push', push: true}}),
        error => error.details?.reason === 'no_source' && error.next === 'narrate');
    assert.equal(context.rng.randint(1, 100), control.context.rng.randint(1, 100), 'refusal consumes no RNG draw');
    assert.equal(await readFile(join(home, '.coc/campaigns', id, 'world.json'), 'utf8'), before);
    await call('table.narrate', {call_id: 't1-c2', text: 'There is no failed action to push.'});
});

test('real RPC: a successful final attempt records an inactive risk and no automatic penalty', async t => {
    const initial = await campaign(t, 'seed-search');
    const arithmetic = await api.CheckArithmetic.create(new api.RuleTables(initial.context));
    let selected;
    for (let n = 0; n < 2000; n++) {
        const rng = new api.PythonRandom(`push-success-${n}`);
        const first = arithmetic.check(1, 'regular', 0, 0, rng); rng.randint(1, 100);
        const second = arithmetic.check(1, 'regular', 0, 0, rng);
        if (first.outcome === 'failure' && second.success) {selected = `push-success-${n}`; break;}
    }
    assert.ok(selected, 'find a deterministic regression seed; no live dice are forced');
    const {call} = await campaign(t, 'success', selected);
    await call('table.player_input', {text: 'I steer the boat across the river.'});
    const first = await call('table.resolve', {call_id: 't1-c1', action: {intent: 'investigate', goal: 'cross the river', method: 'steer the boat', skill: 'Pilot (Boat)'}});
    assert.equal(first.outcome.level, 'failure');
    await call('table.narrate', {call_id: 't1-c2', text: 'The boat fails to reach the far bank.'});
    await call('table.player_input', {text: 'I push the roll.'});
    const result = await call('table.resolve', {call_id: 't2-c1', action: {intent: 'investigate', goal: 'cross the river', push: true}});
    assert.equal(result.outcome.passed, true);
    assert.equal(result.outcome.pushed_risk.activated, false);
    assert.equal(result.receipts.some(receipt => receipt.kind === 'delta'), false);
    assert.match(result.hints.join(' '), /no failed-push penalty/);
});

test('real RPC: a newer SAN check prevents falling back to an older eligible failure', async t => {
    const {call} = await campaign(t, 'san-block');
    await call('table.player_input', {text: 'I steer the boat across the river.'});
    await call('table.resolve', {call_id: 't1-c1', action: {intent: 'investigate', goal: 'cross the river', method: 'steer the boat', skill: 'Pilot (Boat)'}});
    await call('table.resolve', {call_id: 't1-c2', action: {intent: 'investigate', goal: 'face the horrible sight', decision: 'sanity:check', san_loss: '0/0', involuntary: 'freeze'}});
    await call('table.narrate', {call_id: 't1-c3', text: 'The sight is horrible.'});
    await call('table.player_input', {text: 'I push the roll.'});
    const options = await call('table.resolve.options');
    const option = options.selection.options.find(option => option.action.decision === 'push-luck:pushed-roll');
    assert.equal(option.facts.push_refusal, 'sanity_roll');
    await assert.rejects(call('table.resolve', {call_id: 't2-c1', action: {intent: 'investigate', goal: 'push', push: true}}),
        error => error.details?.reason === 'sanity_roll');
});

test('real RPC: disabled Mod stays recognizable solely to explain its refusal', async t => {
    const {call, context} = await campaign(t, 'disabled');
    await call('mods.configure', {id: 'pushed-roll', enabled: false});
    await call('table.player_input', {text: 'I push the roll.'});
    const options = await call('table.resolve.options');
    const option = options.selection.options.find(option => option.action.decision === 'push-luck:pushed-roll');
    assert.equal(option.facts.push_refusal, 'mod_disabled');
    await assert.rejects(call('table.resolve', {call_id: 't1-c1', action: {intent: 'investigate', goal: 'push', push: true}}),
        error => error.details?.reason === 'mod_disabled');
    await call('table.narrate', {call_id: 't1-c2', text: 'Pushed rolls are disabled for this campaign.'});
});
