import {round} from './numeric.ts';
/** Isolated persona benchmark runner; every record marks acceptance=false. */
import { join, relative, resolve, dirname, basename } from 'node:path';
import { existsSync, readFileSync, mkdirSync, appendFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import * as driver from './driver.ts';
import { PersonaPlayer, ProviderExhausted, load_personas, player_view } from './player.ts';
import { pathToFileURL } from 'node:url';
type Row = Record<string, any>;
export const REPO_ROOT = driver.REPO_ROOT, BENCH_ROOT = join(REPO_ROOT, '.coc/benchmarks'), KERNEL_ENTRY = join(REPO_ROOT, 'build/kernel/rpc.mjs'), CONTENT_DIR = join(REPO_ROOT, 'content');
export const CONSECUTIVE_STALL_LIMIT = 3, CONSECUTIVE_PLAYER_FAILURE_LIMIT = 3, LIVE_CAMPAIGN_STATUSES = new Set(['active', 'ready_for_table', 'setting_up']);
export const DEFAULTS: Row = { module: 'the-haunting', play_language: 'zh-Hans', lanes: ['controlled'], trials: 1, max_turns: 30, turn_timeout: 420, opening_timeout: 600, wall_cap_seconds: 7200, kp_model: driver.DEFAULT_MODEL, player_model: driver.DEFAULT_MODEL, admission_model: driver.DEFAULT_MODEL, kp_thinking: driver.DEFAULT_THINKING, player_thinking: driver.DEFAULT_THINKING, admission_thinking: driver.DEFAULT_THINKING, controlled_pregen: 'thomas-hayes', natural_source: 'pregen', concurrency: 4 };
export const _exhausted = { value: false, is_set() { return this.value; }, set() { this.value = true; }, clear() { this.value = false; } };
export const START_STAGGER_SECONDS = 5;
export const time = { monotonic: driver.time.monotonic, sleep: driver.sleep };
export const say = (message: string) => console.log(driver.now_iso() + ' ' + message), utc_stamp = driver.utc_stamp, sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export class RunFailed extends Error {
}
export function kernel_call(method: string, params: Row) { if (!existsSync(KERNEL_ENTRY))
    throw Error(KERNEL_ENTRY + ' is missing; run npm run build:runtime first'); const result = spawnSync(process.env.COC_TEST_NODE || process.execPath, [KERNEL_ENTRY, '--workspace', REPO_ROOT, '--content', CONTENT_DIR], { input: JSON.stringify({ id: 'bench-1', method, params }) + '\n', encoding: 'utf8', timeout: 120000 }); for (const line of result.stdout.split('\n'))
    try {
        const r = JSON.parse(line);
        if (r.id === 'bench-1' && Object.hasOwn(r, 'ok'))
            return r;
    }
    catch { } throw Error('kernel gave no answer to ' + method + ': stdout=' + result.stdout.slice(-400) + ' stderr=' + result.stderr.slice(-400)); }
export function runtime_identity() { const identity: Row = {}; if (existsSync(KERNEL_ENTRY)) {
    identity.kernel_sha256 = createHash('sha256').update(readFileSync(KERNEL_ENTRY)).digest('hex').slice(0, 16);
    identity.kernel_built_at = statSync(KERNEL_ENTRY).mtime.toISOString().replace(/\.\d{3}/, '');
} const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }), dirty = spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }); if (head.status === 0)
    identity.head = head.stdout.trim(); if (dirty.status === 0)
    identity.tree_dirty_files = dirty.stdout.split('\n').filter(x => x.trim()).length; return identity; }
export const campaign_dir = (campaign: string) => join(REPO_ROOT, '.coc/campaigns', campaign);
export const campaign_status = (campaign: string) => driver.read_json(join(campaign_dir(campaign), 'campaign.json'))?.status ?? null;
export function opening_text(campaign: string) { const p = join(campaign_dir(campaign), 'transcript.jsonl'); if (!existsSync(p))
    return null; for (const line of readFileSync(p, 'utf8').split('\n'))
    try {
        const r = JSON.parse(line);
        if (r.role === 'keeper' && r.text)
            return r.text;
    }
    catch { } return null; }
export function load_suite(path: any) { const suite = { ...DEFAULTS, ...JSON.parse(readFileSync(String(path), 'utf8')) }; suite.suite ??= basename(String(path)).replace(/\.json$/, ''); if (!Object.hasOwn(suite, 'personas'))
    throw Error(String(path) + ': a suite must name its personas'); for (const lane of suite.lanes)
    if (!['controlled', 'natural'].includes(lane))
        throw Error(String(path) + ': unknown lane ' + lane); if (!['pregen', 'setup'].includes(suite.natural_source))
    throw Error(String(path) + ": natural_source must be 'pregen' or 'setup'"); return suite; }
export function plan_runs(suite: Row, personas: Row, stamp: string) { const runs:Row[] = []; for (const id of suite.personas) {
    if (!Object.hasOwn(personas, id))
        throw Error('unknown persona ' + id);
    for (const lane of suite.lanes)
        for (let trial = 1; trial <= Number(suite.trials); trial++) {
            const slug = `pb-${suite.suite}-${id.toLowerCase()}-${lane.slice(0, 4)}-t${trial}-${stamp.slice(-6)}`;
            runs.push({ persona: id, lane, trial, campaign: slug, run_id: slug });
        }
} return runs; }
let lastStart = 0, startGate = Promise.resolve();
export async function _await_start_slot(stagger: number) { const previous = startGate; let release!: () => void; startGate = new Promise(r => release = r); await previous; try {
    const wait = lastStart + stagger - time.monotonic();
    if (wait > 0)
        await time.sleep(wait);
    lastStart = time.monotonic();
}
finally {
    release();
} }
export async function start_table(campaign: string, run_id: string, suite: Row, launcher: string | null) { const stagger = Number(suite.start_stagger_seconds ?? START_STAGGER_SECONDS); for (const attempt of [1, 2]) {
    const run = attempt === 1 ? run_id : run_id + '-r' + attempt, argv = ['start', '--campaign', campaign, '--run', run, '--model', suite.kp_model, '--thinking', suite.kp_thinking || driver.DEFAULT_THINKING, '--no-default-run'];
    if (launcher)
        argv.push('--launcher', launcher);
    if (suite.admission_model)
        argv.push('--env', 'PI_COC_ADMISSION_MODEL=' + suite.admission_model);
    for (const pair of suite.env ?? [])
        argv.push('--env', pair);
    await _await_start_slot(stagger);
    if (await runtime.driverMain(argv) === 0)
        return run;
    say(run + ': start failed; ' + (attempt === 1 ? 'retrying once' : 'giving up'));
    await time.sleep(stagger * 2);
} throw new RunFailed('driver start failed twice for ' + run_id); }
export async function stop_table(run: string) { try {
    await runtime.driverMain(['stop', '--run', run]);
}
catch (error) {
    say(run + ': stop raised ' + String(error));
} }
export async function send_turn(run: string, text: string, timeout: number) { const response = await runtime.driverRpc(run, { cmd: 'turn', text, timeout }, timeout + 30); if (!response.ok)
    throw new RunFailed('turn rejected: ' + response.error); return response.summary; }
export async function await_opening(campaign: string, run: string, timeout: number) { const deadline = time.monotonic() + timeout; while (time.monotonic() < deadline) {
    const text = runtime.opening_text(campaign);
    if (text)
        return text;
    const info = driver.read_json(join(driver.run_dir(run), 'daemon.json'), {}) || {};
    if (info.status === 'failed')
        throw new RunFailed('daemon failed before the opening: ' + info.error);
    await time.sleep(3);
} throw new RunFailed('no opening delivery within ' + timeout + 's'); }
export const SETUP_FIRST_VIEW = '[You have just opened the game to make a new Call of Cthulhu investigator, before any session has begun. Nothing has been said to you yet. Say what you want, as yourself.]';
export const append_jsonl = (path: any, obj: Row) => { mkdirSync(dirname(String(path)), { recursive: true }); appendFileSync(String(path), JSON.stringify(obj) + '\n'); };
export async function run_setup_lane(run: Row, suite: Row, player: any, trace: any) { const campaign = run.campaign, id = await runtime.start_table(campaign, run.run_id + '-setup', suite, 'bin/pi-coc-setup'), steps: Row[] = []; let finished = false; try {
    let view = SETUP_FIRST_VIEW;
    for (let step = 1; step <= Number(suite.setup_max_turns ?? 20); step++) {
        if (await runtime.campaign_status(campaign) === 'ready_for_table') {
            finished = true;
            break;
        }
        const act = await player.act(view);
        if (!act.ok)
            throw new RunFailed('persona could not answer the setup lane: ' + act.error);
        let summary;
        try {
            summary = await runtime.send_turn(id, act.player_message, suite.turn_timeout);
        }
        catch (error) {
            if (!(error instanceof RunFailed || error instanceof driver.DaemonUnavailable))
                throw error;
            if (await runtime.campaign_status(campaign) === 'ready_for_table') {
                append_jsonl(trace, { phase: 'setup', step, at: driver.now_iso(), note: 'setup process ended with the card finished', detail: String(error) });
                finished = true;
                break;
            }
            throw error;
        }
        steps.push({ step, player: act.player_message, settle_class: summary.settle_class });
        append_jsonl(trace, { phase: 'setup', ...steps.at(-1), at: driver.now_iso() });
        if (await runtime.campaign_status(campaign) === 'ready_for_table') {
            finished = true;
            break;
        }
        view = player_view(summary.delivery ?? null, summary.final_text || '', summary.settle_class);
    }
}
finally {
    await runtime.stop_table(id);
} const status = await runtime.campaign_status(campaign); if (status !== 'ready_for_table')
    throw new RunFailed(`setup lane ended with campaign status '${status}', not ready_for_table`); return { setup_steps: steps.length, setup_ended_by_process_exit: finished && !steps.length }; }
export function _assert_isolation(player: any) { const missing = ['--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files'].filter(f => !player.isolation.argv_flags.includes(f)); if (missing.length)
    throw new RunFailed('persona player is not isolated: missing ' + JSON.stringify(missing)); const work = String(player.isolation.cwd); if (readdirSync(work).length)
    throw new RunFailed("persona player's working directory is not empty: " + work); if (!relative(REPO_ROOT, work).startsWith('..'))
    throw new RunFailed('persona player is running inside the repository'); }
export const runtime: Row = { kernel_call, campaign_status, opening_text, start_table, stop_table, send_turn, await_opening, run_setup_lane, PersonaPlayer, driverMain: driver.main, driverRpc: driver.rpc_call };
export async function execute_run(run: Row, suite: Row, persona: Row, suite_dir: any): Promise<Row> { const campaign = run.campaign; let id = run.run_id; if (_exhausted.is_set())
    return { method: 'persona-benchmark', acceptance: false, status: 'invalid', suite: suite.suite, persona: persona.id, lane: run.lane, trial: run.trial, run_id: id, campaign, turns: [], turns_played: 0, error: 'provider_exhausted: not started, the account was out of credit' }; const dir = join(String(suite_dir), id); mkdirSync(dir, { recursive: true }); const trace = join(dir, 'trace.jsonl'), started = driver.now_iso(), mono = time.monotonic(), record: Row = { method: 'persona-benchmark', acceptance: false, suite: suite.suite, persona: persona.id, persona_name: persona.name, lane: run.lane, trial: run.trial, campaign, run_id: id, module: suite.module, play_language: suite.play_language, models: { keeper: suite.kp_model, player: suite.player_model, admission: suite.admission_model ?? null }, runtime: runtime_identity(), started_at: started, status: 'running', turns: [] }; driver.write_json(join(dir, 'run.json'), record); const setup = run.lane === 'natural' && suite.natural_source === 'setup', pregen = run.lane === 'natural' ? (persona.natural_investigator.pregen || suite.controlled_pregen) : suite.controlled_pregen, investigator = setup ? persona.natural_investigator.creation_brief : `a pre-made investigator (${pregen}); read your sheet as the table shows it`, variation = run.trial > 1 ? `This is play-through ${run.trial} of this character concept. Open differently than an obvious first move would, but stay in profile.` : ''; const player = new runtime.PersonaPlayer(persona, dir, { model: suite.player_model, play_language: suite.play_language, variation, investigator }); try {
    await player.start();
    record.isolation = player.isolation;
    _assert_isolation(player);
    if (setup)
        Object.assign(record, await runtime.run_setup_lane(run, suite, player, trace));
    else {
        const result = await runtime.kernel_call('campaign.create', { id: campaign, module: suite.module, pregen, play_language: suite.play_language, title: `persona benchmark: ${persona.id} ${run.lane} t${run.trial}` });
        if (!result.ok)
            throw new RunFailed('campaign.create failed: ' + JSON.stringify(result.error));
        record.pregen = pregen;
    }
    id = await runtime.start_table(campaign, id, suite, suite.launcher ?? null);
    record.table_run_id = id;
    let view = await runtime.await_opening(campaign, id, suite.opening_timeout);
    append_jsonl(trace, { phase: 'opening', at: driver.now_iso(), view_sha256: sha256(view), text: view });
    let stalls = 0, consecutive_stalls = 0, consecutive_player_failures = 0, stop_reason = 'max_turns';
    for (let turn = 1; turn <= Number(suite.max_turns); turn++) {
        if (time.monotonic() - mono > Number(suite.wall_cap_seconds)) {
            stop_reason = 'wall_cap';
            break;
        }
        const act = await player.act(view);
        if (!act.ok) {
            consecutive_player_failures++;
            append_jsonl(trace, { phase: 'play', turn, player_malformed: act.error ?? null, at: driver.now_iso() });
            if (consecutive_player_failures >= CONSECUTIVE_PLAYER_FAILURE_LIMIT) {
                stop_reason = 'player_unusable';
                break;
            }
            continue;
        }
        consecutive_player_failures = 0;
        const summary = await runtime.send_turn(id, act.player_message, suite.turn_timeout), sent = sha256(summary.player_text || '');
        if (sent !== sha256(act.player_message))
            throw new RunFailed('what reached the Keeper was not what the persona wrote');
        const delivery = summary.delivery ?? null;
        view = player_view(delivery, summary.final_text || '', summary.settle_class);
        const row = { phase: 'play', turn, at: driver.now_iso(), player_message: act.player_message, player_message_sha256: sent, private_eval: act.private_eval || {}, settle_class: summary.settle_class, wall_seconds: summary.wall_seconds, tools: (summary.tools ?? []).map((t: Row) => t.name ?? null), delivery_kind: delivery?.kind ?? null, mechanics: delivery?.mechanics || [], keeper_text: summary.final_text || '' };
        append_jsonl(trace, row);
        record.turns.push(Object.fromEntries(['turn', 'settle_class', 'wall_seconds', 'tools'].map(k => [k, (row as Row)[k]])));
        if (summary.settle_class !== 'settled') {
            stalls++;
            consecutive_stalls++;
            if (consecutive_stalls >= CONSECUTIVE_STALL_LIMIT) {
                stop_reason = 'stalled';
                break;
            }
        }
        else
            consecutive_stalls = 0;
        const status = await runtime.campaign_status(campaign);
        if (!LIVE_CAMPAIGN_STATUSES.has(status)) {
            stop_reason = 'campaign_' + status;
            break;
        }
    }
    Object.assign(record, { status: 'completed', stop_reason, stalled_turns: stalls });
}
catch (error) {
    if (error instanceof ProviderExhausted) {
        _exhausted.set();
        Object.assign(record, { status: 'invalid', error: 'provider_exhausted: ' + error.message });
        say(id + ': PROVIDER EXHAUSTED -- ' + error.message);
        say('stopping: every remaining run would fail the same way. This is a billing event, not a product result; nothing here should be read as one.');
    }
    else {
        Object.assign(record, { status: 'invalid', error: (error as Error).constructor.name + ': ' + (error as Error).message });
        say(id + ': INVALID -- ' + record.error);
    }
}
finally {
    await runtime.stop_table(record.table_run_id ?? id);
    await player.stop();
    record.ended_at = driver.now_iso();
    record.wall_seconds = round(time.monotonic() - mono,1);
    record.turns_played = record.turns.length;
    record.evidence = { campaign: relative(REPO_ROOT, campaign_dir(campaign)), playtest: relative(REPO_ROOT, driver.run_dir(id)), trace: relative(REPO_ROOT, dir) };
    driver.write_json(join(dir, 'run.json'), record);
} say(`${id}: ${record.status} (${record.turns_played} turns, ${record.wall_seconds}s, ${record.stop_reason ?? record.error})`); return record; }
export function cmd_plan(args: Row) { const suite = load_suite(args.suite), personas = load_personas(), runs = plan_runs(suite, personas, utc_stamp()), per = Number(args.minutes_per_turn) * Number(suite.max_turns), total = runs.length * per; console.log(JSON.stringify({ suite: suite.suite, runs: runs.length, personas: suite.personas.length, lanes: suite.lanes, trials: suite.trials, max_turns: suite.max_turns, models: { keeper: suite.kp_model, player: suite.player_model, admission: suite.admission_model ?? null }, concurrency: suite.concurrency, estimate: { minutes_per_turn_assumed: args.minutes_per_turn, keeper_turns_total: runs.length * Number(suite.max_turns), serial_hours: round(total / 60,1), wallclock_hours_at_concurrency: round(total / 60 / Number(suite.concurrency),1) }, note: 'estimate only; a run stops early on an ending, a stall or the wall cap', runs_planned: runs.map(r => r.run_id) }, null, 2)); return 0; }
export function sweep_stale_sandboxes() { let removed = 0; for (const name of readdirSync(tmpdir()))
    if (name.startsWith('persona-') && statSync(join(tmpdir(), name)).isDirectory()) {
        rmSync(join(tmpdir(), name), { recursive: true, force: true });
        removed++;
    } return removed; }
export async function cmd_run(args: Row) { const suite = load_suite(args.suite), swept = sweep_stale_sandboxes(); if (swept)
    say(`swept ${swept} sandbox directories left by an earlier run`); if (args.concurrency)
    suite.concurrency = args.concurrency; if (args.max_turns)
    suite.max_turns = args.max_turns; const personas = load_personas(), stamp = utc_stamp(), runs = plan_runs(suite, personas, stamp), suite_id = suite.suite + '-' + stamp, dir = join(BENCH_ROOT, suite_id); mkdirSync(dir, { recursive: true }); driver.write_json(join(dir, 'suite.json'), { method: 'persona-benchmark', acceptance: false, suite: suite.suite, suite_id, started_at: driver.now_iso(), settings: suite, runs: runs.map(r => r.run_id), status: 'running' }); say(`suite ${suite_id}: ${runs.length} runs, concurrency ${suite.concurrency}`); say('this is a persona benchmark, not acceptance -- the real table of Agents.md is unchanged'); const results: Row[] = [], pending = [...runs]; await Promise.all(Array.from({ length: Number(suite.concurrency) }, async () => { while (pending.length) {
    const run = pending.shift()!;
    try {
        results.push(await execute_run(run, suite, personas[run.persona], dir));
    }
    catch (error) {
        say(run.run_id + ': runner crashed: ' + error);
        results.push({ run_id: run.run_id, persona: run.persona, lane: run.lane, trial: run.trial, status: 'invalid', error: String(error) });
    }
} })); const completed = results.filter(r => r.status === 'completed'); if (_exhausted.is_set())
    say('the provider ran out of credit during this suite: runs after that point are provider_exhausted, not evidence about the product'); const info = driver.read_json(join(dir, 'suite.json'), {}); Object.assign(info, { status: 'finished', ended_at: driver.now_iso(), completed: completed.length, invalid: results.length - completed.length }); driver.write_json(join(dir, 'suite.json'), info); say(`suite ${suite_id} finished: ${completed.length} completed, ${results.length - completed.length} invalid`); return completed.length ? 0 : 1; }
export function cmd_status(args: Row) { const dirs = readdirSync(BENCH_ROOT).map(n => join(BENCH_ROOT, n)).filter(p => statSync(p).isDirectory()); const dir = args.suite_dir || dirs.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1); if (!dir)
    throw Error('no suite directories'); const rows: Row[] = []; for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (!existsSync(join(path, 'run.json')))
        continue;
    const r = driver.read_json(join(path, 'run.json'), {}) || {}, trace = join(path, 'trace.jsonl');
    let played = 0, setup = 0;
    if (existsSync(trace))
        for (const line of readFileSync(trace, 'utf8').split('\n')) {
            try {
                const row = JSON.parse(line);
                if (row.phase === 'play')
                    played++;
                if (row.phase === 'setup')
                    setup++;
            }
            catch { }
        }
    rows.push({ run: name, persona: r.persona ?? null, lane: r.lane ?? null, trial: r.trial ?? null, status: r.status ?? null, stop_reason: r.stop_reason ?? null, turns: played, setup_steps: setup, wall_seconds: r.wall_seconds ?? null });
} const done = rows.filter(r => r.status === 'completed'), invalid = rows.filter(r => r.status === 'invalid'), running = rows.filter(r => r.status === 'running'), planned = (driver.read_json(join(dir, 'suite.json'), {})?.runs || rows).length; console.log(JSON.stringify({ suite_dir: dir, planned, completed: done.length, invalid: invalid.length, running: running.length, turns_played_total: rows.reduce((n, r) => n + r.turns, 0), invalid_runs: invalid.map(r => ({ run: r.run, status: r.status })), in_flight: running.map(r => ({ run: r.run, turns: r.turns, setup_steps: r.setup_steps })), finished: done.map(r => ({ run: r.run, turns: r.turns, stop_reason: r.stop_reason, wall_seconds: r.wall_seconds })) }, null, 2)); return 0; }
export function build_parser() { return { parse_args(argv: string[]) { const args: Row = { subcommand: argv[0], minutes_per_turn: .93 }; for (let i = 1; i < argv.length; i++) {
        const k = argv[i].slice(2).replaceAll('-', '_'), value = argv[++i];
        args[k] = ['minutes_per_turn', 'concurrency', 'max_turns'].includes(k) ? Number(value) : value;
    } if (!['plan', 'run', 'status'].includes(args.subcommand))
        throw Error('unknown bench command'); if (args.subcommand !== 'status' && !args.suite)
        throw Error('--suite is required'); return args; } }; }
export async function main(argv = process.argv.slice(2)) { const args = build_parser().parse_args(argv); return await ({ plan: cmd_plan, run: cmd_run, status: cmd_status } as Row)[args.subcommand](args); }
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
    process.exitCode = await main();
