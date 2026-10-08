/**
 * Contract §201: a clue the prose gives is a clue the ledger holds.
 *
 * TR-F2 run 3 (App 4ce2e4cab, The Haunting, Keeper luna) told the player the book's clues on turns the ledger never
 * learned them, three shapes, replayed here through the real tool path -- the extension, the emitted kernel over the
 * haunting, the product's hybrid engine -- with the player's and the Keeper's own words from that table
 * (`fixtures/clue-ledger/run3.json`):
 *
 * - T7: the Keeper put its closing prose inside an `apply` effect; Pi's schema check dumped eight lines with no fix, and
 *   the Keeper narrated the morgue's 1918 story at the library. Now the effect is refused with how to write it (§201.3),
 *   and the told clues are owed and landed first on the next run (§201.1), at the library.
 * - T10: after T9's apply was refused by admission, the Keeper closed with prose and no tool call (the implicit close),
 *   giving the will's executor and the chapel's closing. Both are owed and landed; the executor's Library Use, which no
 *   one rolled, is said on its row (`check_skipped`, §201.2).
 * - T18: the compile's `ask_clue` filed the hollow boards and the body behind them; the prose gives neither in full and
 *   says there is no hidden door. The read counts the body as landed and untold (§201.4) and changes nothing.
 *
 * Jev is a controlled typed endpoint behind the real decision adapter (the told reads) and a scripted decision port (the
 * run's own compile and route).
 */
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, waitFor} from './harness.mjs';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
import {COMPILE_FAMILY} from '../../runtime/jev/route-compile.ts';
import {COC_TOOLS, effectShapeRefusal} from '../../extensions/kernel/tools.ts';
import {buildCandidates} from '../../runtime/jev/candidates.ts';
import {compileRows} from '../../runtime/jev/compile-rows.ts';
import {clueFollowUpCandidates} from '../../runtime/jev/consequence-candidates.ts';
import {TOLD_CLUE_SENTENCES_MAX, toldClueDecisions, toldClueQuestions, toldClueSentences, toldClueState} from '../../runtime/jev/told-clue.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAMPAIGN = 'test-camp';
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const RUN3 = JSON.parse(readFileSync(join(REPO, 'tests/extension/fixtures/clue-ledger/run3.json'), 'utf8'));
const GRAPH = JSON.parse(readFileSync(join(REPO, 'content/starters/the-haunting/module-graph.json'), 'utf8'));
/** The book's words for each clue, by handle: what the told read sends Jev. */
const SUMMARY = Object.fromEntries(GRAPH.nodes.filter(node => node.node_kind === 'clue').map(node => [node.node_id.replace(/^clue-/, ''), node.summary]));
const APPLY = COC_TOOLS.find(tool => tool.name === 'apply').parameters;

// ---- pure: the read's questions and bars, and the schema refusal ---------------------------------------------------

const INPUT = {campaign: CAMPAIGN, turn: 10, sentences: ['s one.', 's two.'],
    candidates: [{name: 'will-executor-chapel', summary: SUMMARY['will-executor-chapel'], scene: 'hall-of-records', source: 'here', delivery_kind: 'skill_check',
        check: {skill: 'Library Use', difficulty: 'regular'}}, {name: 'chapel-closed-1912', summary: SUMMARY['chapel-closed-1912'], scene: 'hall-of-records', source: 'here', delivery_kind: 'obvious'}],
    landed: [{clue: 'hollow-boards', summary: SUMMARY['hollow-boards']}]};

test('the read asks one given Noul per clue in play and per clue the turn landed, by alias, never by handle', () => {
    const questions = toldClueQuestions(INPUT);
    assert.deepEqual(questions.map(question => [question.key, question.type]), [['given_c0', 'noul'], ['given_c1', 'noul'], ['given_l0', 'noul']]);
    const state = toldClueState(INPUT);
    assert.deepEqual(Object.keys(state.clues), ['c0', 'c1', 'l0']);
    assert.equal(state.clues.c0.states, SUMMARY['will-executor-chapel']);
    assert.deepEqual(state.told, {s1: 's one.', s2: 's two.'});
    assert.ok(!JSON.stringify([state, questions]).match(/will-executor-chapel|chapel-closed-1912|hollow-boards/), 'no handle reaches Jev');
    const long = Array.from({length: 60}, (_, index) => `第${index + 1}句。`).join('');
    assert.equal(toldClueSentences(long).sentences.length, TOLD_CLUE_SENTENCES_MAX);
    assert.equal(TOLD_CLUE_SENTENCES_MAX, 48, 'a clue may be told anywhere in the text: more than the position\'s 24');
});

test('the bars decide in order; a landed clue at or under untold_max is counted, never owed', () => {
    const bars = {givenMin: 0.6, sentenceMin: 0.5, untoldMax: 0.15};
    const answered = (given, sentences, landedGiven = {}) => ({status: 'answered', given, landedGiven, sentences, sentenceRequest: 'answered', elapsedMs: 1,
        usage: {inputTokens: 0, outputTokens: 0, costUsd: 0}});
    const sentence = confidence => ({key: 's1', text: 's one.', confidence, distribution: {}});
    const decided = toldClueDecisions(answered({'will-executor-chapel': 0.95, 'chapel-closed-1912': 0.97},
        {'will-executor-chapel': sentence(0.86), 'chapel-closed-1912': sentence(1)}, {'hollow-boards': 0.05}), bars, INPUT);
    assert.deepEqual(decided.owe.map(entry => entry.clue), ['will-executor-chapel', 'chapel-closed-1912']);
    assert.deepEqual(decided.landedUntold, ['hollow-boards']);
    const whys = toldClueDecisions(answered({'will-executor-chapel': 0.59, 'chapel-closed-1912': null}, {}), bars, INPUT).stay.map(entry => entry.why);
    assert.deepEqual(whys, ['not_given', 'given_unanswered']);
    assert.deepEqual(toldClueDecisions(answered({'will-executor-chapel': 0.9, 'chapel-closed-1912': 0.9}, {'will-executor-chapel': sentence(0.4)}), bars, INPUT).stay.map(entry => entry.why),
        ['low_sentence', 'sentence_unanswered']);
    assert.deepEqual(toldClueDecisions(answered({}, {}, {'hollow-boards': 0.5}), bars, INPUT).landedUntold, [], 'half given is not untold');
    assert.deepEqual(toldClueDecisions({status: 'failed', reason: 'timeout', elapsedMs: 1, usage: {}}, bars, INPUT).stay.map(entry => entry.why), ['timeout', 'timeout']);
});

test('§201.3: T7\'s apply -- closing prose put in an effect -- is refused with where prose goes and how a clue is written', () => {
    const refusal = effectShapeRefusal('apply', APPLY, RUN3.t7.refused_apply);
    assert.deepEqual({code: refusal.code, detail: refusal.code_detail, next: refusal.next, field: refusal.details.field, kind: refusal.details.kind},
        {code: 'invalid_params', detail: 'effect_kind_unknown', next: 'change_input', field: 'effects[0].kind', kind: 'narrate'});
    assert.match(refusal.fix, /^Closing prose is not an effect: put it in this apply's own narrate field beside effects/);
    assert.match(refusal.fix, /a clue the book has is \{kind: "clue", clue: <its name/);
    assert.ok(refusal.details.kinds.includes('clue') && refusal.details.kinds.includes('handout') && !refusal.details.kinds.includes('narrate'), 'the kinds are read off the schema');
    assert.match(effectShapeRefusal('apply', APPLY, {effects: [{kind: 'resolve'}]}).fix, /^resolve is a tool of its own, not an effect of apply/);
    assert.equal(effectShapeRefusal('apply', APPLY, {effects: [{clue: 'x'}]}).details.kind, null, 'a missing kind is refused too');
    const missing = effectShapeRefusal('apply', APPLY, {effects: [{kind: 'time', minutes: 5}, {kind: 'clue', how: 'found it'}]});
    assert.deepEqual({detail: missing.code_detail, field: missing.details.field, missing: missing.details.missing}, {detail: 'effect_field_missing', field: 'effects[1]', missing: ['clue']});
    assert.match(missing.fix, /For a clue: a clue the book has is \{kind: "clue"/);
    // What the schema takes is left alone, a null included (Pi's coercion may accept it), and so is every other tool.
    for (const args of [RUN3.t9.refused_apply, {effects: [{kind: 'clue', clue: 'x'}], narrate: 'prose'}, {effects: [{kind: 'clue', clue: null}]}, {effects: 'x'}, {}])
        assert.equal(effectShapeRefusal('apply', APPLY, args), undefined);
    assert.equal(effectShapeRefusal('narrate', APPLY, {effects: [{kind: 'narrate'}]}), undefined);
});

test('§201.2: the clerk is not offered a clue the book finds by a check this turn has not passed; its compile ask row stays', () => {
    const row = (clue, check) => ({effect: {kind: 'clue', clue}, description: {kind: 'clue', name: clue, summary: SUMMARY[clue],
        delivery_kind: check ? 'skill_check' : 'obvious', ...(check ? {check} : {})}});
    // Run 3's T6 and T13: the consequence route filed Library Use and Spot Hidden clues with no roll.
    const reads = passed => ({capsule: {where: {scene: 'central-library'}, present: [], known: {}},
        applyOptions: {candidates: [row('house-built-1835', {skill: 'Library Use', difficulty: 'regular', passed}), row('chapel-closed-1912')], context: {}},
        resolveOptions: {profiles: [{actor: 'Thomas Hayes'}], decisions: []}});
    const follow = passed => clueFollowUpCandidates(reads(passed)).map(candidate => candidate.bound.clue);
    assert.deepEqual(follow(false), ['chapel-closed-1912']);
    assert.deepEqual(follow(true), ['house-built-1835', 'chapel-closed-1912'], 'offered again once the roll passed');
    const plain = passed => buildCandidates(reads(passed), '我查一八三五年的记录。').filter(candidate => candidate.family === 'clue').map(candidate => candidate.bound.clue);
    assert.deepEqual(plain(false), ['chapel-closed-1912']);
    assert.deepEqual(plain(true), ['house-built-1835', 'chapel-closed-1912']);
    assert.deepEqual(compileRows(reads(false)).ask.map(entry => entry.id), ['clue:house-built-1835', 'clue:chapel-closed-1912'], 'the compile still asks it');
});

// ---- on the emitted kernel, through the real tool path -------------------------------------------------------------

/**
 * The typed endpoint. A told-clue request: a `given` Noul is `told[clue]` for a clue the state names in the book's words
 * when a delivered sentence holds `markers[clue]` (`landed[clue]` for a landed one), else 0.05; a `sentence` Choice is the
 * delivered sentence holding `markers[clue]`. Any other request gets a neutral answer (the told position stays: `moved`
 * 0.05).
 */
function installJev(t, {told = {}, landed = {}, markers = {}} = {}) {
    const original = globalThis.fetch, batches = [];
    globalThis.fetch = async (url, init) => {
        if (String(url) !== JEV_URL) return original(url, init);
        const body = JSON.parse(init.body), state = typeof body.state === 'string' ? JSON.parse(body.state) : body.state;
        const clueOf = alias => Object.keys(SUMMARY).find(name => SUMMARY[name] === state?.clues?.[alias]?.states);
        if (Object.keys(body.questions).some(key => key.startsWith('given_') || key.startsWith('sentence_'))) batches.push({body, state});
        const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
            if (question.type === 'noul') {
                const alias = key.startsWith('given_') ? key.slice(6) : null, clue = alias ? clueOf(alias) : null;
                const said = clue && Object.values(state.told ?? {}).some(sentence => markers[clue] && String(sentence).includes(markers[clue]));
                const noul = clue ? (alias.startsWith('l') ? landed[clue] : said ? told[clue] : undefined) ?? 0.05 : 0.05;
                return [key, {type: 'noul', noul}];
            }
            if (question.type === 'choice') {
                const keys = Object.keys(question.criteria), clue = key.startsWith('sentence_') ? clueOf(key.slice(9)) : null;
                const choice = clue && markers[clue] ? keys.find(k => String(state.told[k]).includes(markers[clue])) ?? keys[0] : keys[0];
                const rest = 0.1 / Math.max(1, keys.length - 1);
                return [key, {type: 'choice', choice, confidence: 0.9, probabilities: Object.fromEntries(keys.map(k => [k, k === choice ? 0.9 : rest]))}];
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

/**
 * The run's own decisions: nothing the player's words could choose, except the compile `ask` rows a test names by a word of
 * their clue's summary (`seeks`), answered yes at 0.85 -- T18's compile.
 */
function runJev({seeks = []} = {}) {
    return {decide: async batch => {
        const pick = question => {
            if (batch.family === COMPILE_FAMILY) return question.key.startsWith('ask_') ? (seeks.some(word => String(question.target).includes(word)) ? 'yes' : 'no') : 'none';
            return question.key === 'exit' ? 'finish' : Object.keys(question.criteria)[0] === 'now' ? 'later' : 'unknown';
        };
        const answers = Object.fromEntries(batch.questions.map(question => {
            const choice = pick(question), confidence = choice === 'yes' ? 0.85 : 0.93;
            return [question.key, {status: 'answered', type: 'choice', choice, confidence, probabilities: {[choice]: confidence, ...(choice === 'yes' ? {no: 0.1} : {})}}];
        }));
        return {batchId: batch.id, status: 'complete', answers, coverage: {required: Object.keys(answers), answered: Object.keys(answers), unknown: []}, issues: []};
    }};
}

function kernelSteps(workspace, requests) {
    const input = requests.map((request, index) => JSON.stringify({id: String(index), method: request[0], params: {campaign: CAMPAIGN, ...request[1]}})).join('\n');
    const run = spawnSync(process.execPath, [join(REPO, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(REPO, 'content')],
        {cwd: REPO, input: `${input}\n`, encoding: 'utf8'});
    for (const frame of run.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress))
        if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
const LEADS = {kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'};
/** Turn 1 at the Globe, turn 2 at the library: run 3's road to T7 (the morgue is on the trail). */
const atTheLibrary = workspace => kernelSteps(workspace, [['table.open', {}], ['table.player_input', {text: '我去环球报社。'}],
    ['table.apply', {call_id: 't1-c1', effects: [LEADS, {kind: 'move', to: 'newspaper-morgue'}]}], ['table.narrate', {call_id: 't1-c2', text: '你来到报社。'}],
    ['table.player_input', {text: '我去中央图书馆。'}], ['table.apply', {call_id: 't2-c1', effects: [{kind: 'move', to: 'central-library'}]}],
    ['table.narrate', {call_id: 't2-c2', text: '你来到图书馆。'}]]);
/** Turn 1 at the Hall of Records: run 3's road to T9. */
const atTheHall = workspace => kernelSteps(workspace, [['table.open', {}], ['table.player_input', {text: '我去市政档案馆。'}],
    ['table.apply', {call_id: 't1-c1', effects: [LEADS, {kind: 'move', to: 'hall-of-records'}]}], ['table.narrate', {call_id: 't1-c2', text: '档案员把卷宗推给你。'}]]);
/** Turns 1-2 into the basement: run 3's road to T18. */
const inTheBasement = workspace => kernelSteps(workspace, [['table.open', {}], ['table.player_input', {text: '我去科比特宅。'}],
    ['table.apply', {call_id: 't1-c1', effects: [LEADS, {kind: 'move', to: 'corbitt-house-ground'}]}], ['table.narrate', {call_id: 't1-c2', text: '你来到老宅。'}],
    ['table.player_input', {text: '我下到地下室。'}], ['table.apply', {call_id: 't2-c1', effects: [{kind: 'move', to: 'basement-rites'}]}],
    ['table.narrate', {call_id: 't2-c2', text: '你走下台阶。'}]]);

const dir = workspace => join(workspace, '.coc/campaigns', CAMPAIGN);
const ledger = workspace => existsSync(join(dir(workspace), 'owed.json')) ? JSON.parse(readFileSync(join(dir(workspace), 'owed.json'), 'utf8')) : null;
const turnRecord = (workspace, turn) => JSON.parse(readFileSync(join(dir(workspace), 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
const clueRow = (table, turn) => waitFor(() => table.telemetry().find(row => row.lane === 'told-clue' && row.turn === turn), {label: `turn ${turn}'s told-clue row`, timeoutMs: 15_000});
const narrate = text => fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'});
const ENV = {EXT_JEV_APIKEY: 'test-jev-key', PI_COC_LOOP_ENGINE: 'hybrid-v1'};
async function hybridTable(t, {prepareWorkspace, responses, seeks, laneResponses}) {
    const rows = [], engine = createHybridEngine({env: process.env, record: row => rows.push(row), decision: runJev({seeks})});
    const table = await openTable({realKernel: true, prepareWorkspace, env: ENV, runDriver: engine.runDriver, laneResponses,
        extraExtensions: [{name: 'coc-hybrid-engine', factory: engine.extension}], responses});
    t.after(() => table.dispose());
    return {table, rows};
}

test('T7: the prose-in-an-effect apply is refused with its fix, and the morgue\'s story told at the library is owed, then landed there first', async t => {
    const batches = installJev(t, {told: {'globe-unpublished-story': 0.95, 'macario-tragedy': 0.84},
        markers: {'globe-unpublished-story': '内部稿', 'macario-tragedy': '马卡里奥'}});
    const {table, rows} = await hybridTable(t, {prepareWorkspace: atTheLibrary, responses: [
        fauxAssistantMessage([fauxToolCall('apply', RUN3.t7.refused_apply)], {stopReason: 'toolUse'}), narrate(RUN3.t7.delivered),
        narrate('你把抄下的内容又核对了一遍。')]});
    await table.session.prompt(RUN3.t7.player);
    const refused = table.session.messages.find(message => message.role === 'toolResult' && message.toolName === 'apply');
    const text = refused.content.map(block => block.text ?? '').join('');
    assert.equal(refused.isError, true);
    assert.match(text, /^invalid_params: apply: effects\[0\]\.kind is "narrate", which is not an effect kind/);
    assert.match(text, /Closing prose is not an effect: put it in this apply's own narrate field beside effects/);
    assert.match(text, /a clue the book has is \{kind: "clue", clue: <its name/);
    assert.ok(!/must have required properties/.test(text), 'not the schema\'s union dump');
    assert.ok(table.telemetry().some(row => row.lane === 'arguments' && row.event === 'effect_shape_refused' && row.reason === 'effect_kind_unknown'));
    assert.equal(table.kernelRequests().filter(request => request.method === 'table.apply' && request.params?.call_id?.startsWith('t3')).length, 0, 'it never reached the kernel');

    const row = await clueRow(table, 3);
    assert.deepEqual({outcome: row.outcome, owe: row.owe, owed: row.owed.map(entry => entry.clue), mode: row.mode},
        {outcome: 'owed', owe: ['globe-unpublished-story', 'macario-tragedy'], owed: ['globe-unpublished-story', 'macario-tragedy'], mode: 'on'});
    assert.ok(row.candidates.includes('globe-unpublished-story') && row.candidates.indexOf('neighbor-lawsuit-1852') < row.candidates.indexOf('globe-unpublished-story'),
        'the library\'s own clues first, then the morgue on the trail');
    assert.deepEqual(row.check_skipped, []);
    assert.equal(batches.filter(batch => Object.keys(batch.body.questions).some(key => key.startsWith('sentence_'))).length, 1, 'one sentence request');
    const {open} = ledger(table.workspace);
    assert.deepEqual(open.map(entry => [entry.kind, entry.effect.clue, entry.source]), [['clue', 'globe-unpublished-story', 'told-clue'], ['clue', 'macario-tragedy', 'told-clue']]);
    assert.ok(open.every(entry => RUN3.t7.delivered.includes(entry.quote)), 'each quote is the delivered text\'s own sentence');
    assert.deepEqual(turnRecord(table.workspace, 3).receipts.filter(receipt => receipt.kind === 'clue'), [], 'the delivery landed no clue');

    await table.session.prompt('我把这些都抄在本子上。');
    const landed = turnRecord(table.workspace, 4).receipts.filter(receipt => receipt.kind === 'clue');
    assert.deepEqual(landed.map(receipt => [receipt.clue, receipt.owed, receipt.told_turn, receipt.scene]),
        [['globe-unpublished-story', 't3-owed-1', 3, 'central-library'], ['macario-tragedy', 't3-owed-2', 3, 'central-library']],
        'the clerk lands the told clues first, at the library, though the book has them at the morgue');
    assert.ok(rows.some(entry => entry.lane === 'run' && entry.event === 'bind' && entry.candidate === 'apply:owed:t3-owed-1' && entry.clerk === 'told_bookkeeping'));
    assert.deepEqual(ledger(table.workspace).open, []);
});

test('T10: after T9\'s refused apply, the implicit close tells the executor and the closing; both are owed and landed, the skipped Library Use said', async t => {
    installJev(t, {told: {'will-executor-chapel': 0.95, 'chapel-closed-1912': 0.97}, markers: {'will-executor-chapel': '执行人', 'chapel-closed-1912': '一九一二年'}});
    const {table} = await hybridTable(t, {prepareWorkspace: atTheHall,
        laneResponses: {admission: [fauxAssistantMessage(JSON.stringify({verdict: 'not_authorized', grounds: 'the earlier plan named the municipal archive, not this clerk',
            missing: 'Choosing to ask this clerk to retrieve the records.'}))]},
        // Run 3's T9 apply without its time line: there the host had already charged the declared time (receipt t9-c1),
        // and this replay's run Jev binds no time band, so the engine would block the Keeper's own before admission saw it.
        responses: [fauxAssistantMessage([fauxToolCall('apply', {...RUN3.t9.refused_apply, effects: RUN3.t9.refused_apply.effects.filter(effect => effect.kind !== 'time')})],
            {stopReason: 'toolUse'}), narrate(RUN3.t9.delivered),
            fauxAssistantMessage(RUN3.t10.delivered), narrate('你谢过职员，记下牧师的名字。')]});
    await table.session.prompt(RUN3.t9.player);
    assert.ok(table.telemetry().some(row => row.tool === 'apply' && row.reason === 'action_not_authorized'), 'admission refused T9\'s apply');
    const nine = await clueRow(table, 2);
    assert.deepEqual({outcome: nine.outcome, owed: nine.owed}, {outcome: 'stay', owed: []}, 'T9\'s prose gave nothing');

    await table.session.prompt(RUN3.t10.player);
    assert.equal(turnRecord(table.workspace, 3).closed_how, 'implicit', 'the host closed the turn with the Keeper\'s prose');
    const row = await clueRow(table, 3);
    assert.deepEqual(row.owed.map(entry => [entry.clue, entry.check_skipped === true]), [['will-executor-chapel', true], ['chapel-closed-1912', false]]);
    assert.deepEqual(row.check_skipped, ['will-executor-chapel']);
    const {open} = ledger(table.workspace);
    assert.deepEqual(open.map(entry => [entry.effect.clue, entry.check?.skill ?? null, entry.check_skipped ?? false]),
        [['will-executor-chapel', 'Library Use', true], ['chapel-closed-1912', null, false]]);

    await table.session.prompt('谢过职员，我去那座已经关闭的沉思礼拜堂看看。');
    const landed = turnRecord(table.workspace, 4).receipts.filter(receipt => receipt.kind === 'clue');
    assert.deepEqual(landed.map(receipt => [receipt.clue, receipt.owed]), [['will-executor-chapel', 't3-owed-1'], ['chapel-closed-1912', 't3-owed-2']],
        'landed first, the told executor not held for the roll the prose skipped');
    assert.deepEqual(ledger(table.workspace).closed.map(entry => [entry.name, entry.how]), [['t3-owed-1', 'landed'], ['t3-owed-2', 'landed']]);
});

test('T18: the compile files the boards and the body; the prose gives neither in full -- the body is counted landed and untold, nothing else moves', async t => {
    const batches = installJev(t, {landed: {'hollow-boards': 0.5, 'corbitt-body-found': 0.05}});
    const {table, rows} = await hybridTable(t, {prepareWorkspace: inTheBasement, seeks: ['boards'], responses: [narrate(RUN3.t18.delivered), narrate('你蹲下来。')]});
    await table.session.prompt(RUN3.t18.player);
    const filed = turnRecord(table.workspace, 3).receipts.filter(receipt => receipt.kind === 'clue').map(receipt => receipt.clue);
    assert.deepEqual(filed, ['hollow-boards', 'corbitt-body-found'], 'run 3\'s clerk steps: both filed by the compile');
    const compile = rows.find(entry => entry.lane === 'route' && entry.purpose === 'compile' && entry.fired?.length);
    assert.deepEqual(compile.fired.map(fired => [fired.predicate, fired.candidate]), [['ask_clue', 'apply:clue:hollow-boards'], ['ask_clue', 'apply:clue:corbitt-body-found']]);
    const row = await clueRow(table, 3);
    assert.deepEqual({landed: row.landed, landed_untold: row.landed_untold, outcome: row.outcome, owed: row.owed},
        {landed: ['hollow-boards', 'corbitt-body-found'], landed_untold: ['corbitt-body-found'], outcome: 'stay', owed: []});
    assert.equal(row.landed_given['hollow-boards'], 0.5, 'half given is not counted');
    assert.equal(batches.length, 1, 'nothing cleared, so no sentence request');
    assert.equal(ledger(table.workspace), null, 'counted, never acted on');
    assert.deepEqual(turnRecord(table.workspace, 3).receipts.filter(receipt => receipt.kind === 'clue').map(receipt => receipt.clue), filed, 'the receipts stand');
});

test('off: the read is not run, and nothing registers a flight for it', async t => {
    const batches = installJev(t, {told: {'will-executor-chapel': 0.95}});
    let port;
    const table = await openTable({realKernel: true, prepareWorkspace: atTheHall, env: {EXT_JEV_APIKEY: 'test-jev-key', PI_COC_TOLD_CLUE: 'off', PI_COC_TOLD_POSITION: 'off'},
        responses: [narrate(RUN3.t10.delivered)],
        extraExtensions: [{name: 'owed-port-probe', factory: pi => pi.events.on('coc:owed-review', value => { port = value; })}]});
    t.after(() => table.dispose());
    await table.session.prompt(RUN3.t10.player);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(port.watch().in_flight, false);
    assert.equal(table.telemetry().filter(row => row.lane === 'told-clue').length, 0);
    assert.equal(batches.length, 0);
    assert.equal(ledger(table.workspace), null);
    assert.equal(JSON.parse(readFileSync(join(REPO, 'content/rulesets/coc7/host-budgets.json'), 'utf8')).told_clue.mode, 'on', 'on ships');
});
