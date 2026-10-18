import {round,fixed} from './numeric.ts';
import {withoutMechanicsMarkers} from '../../shared/delivery-markers.js';
import {createTestWorkspace,checkTestWorkspaceBudget} from '../../scripts/test-workspace.mjs';
/** Native Pi RPC transport and durable live evidence. It performs no Keeper decisions. */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, rmSync, readdirSync, openSync, closeSync, statSync, lstatSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createServer, createConnection, type Server } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
export type Row = Record<string, any>;
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), PLAYTESTS_ROOT = join(REPO_ROOT, '.coc/playtests'), CURRENT_RUN_FILE = join(PLAYTESTS_ROOT, '.current-run'), DEFAULT_LAUNCHER = join(REPO_ROOT, 'bin/pi-coc');
export const DEFAULT_MODEL = 'codex-relay/gpt-6-luna', DEFAULT_THINKING = 'high';
export const TEST_LANE_MODEL_ENVS = ['PI_COC_ADAPTATION_MODEL', 'PI_COC_ADMISSION_MODEL', 'PI_COC_BUILD_MODEL', 'PI_COC_EPITHETS_MODEL', 'PI_COC_ESTABLISH_REVIEW_MODEL', 'PI_COC_FIRST_SIGHT_MODEL', 'PI_COC_HANDLES_MODEL', 'PI_COC_MEMORY_MODEL', 'PI_COC_MOD_MODEL', 'PI_COC_NPCJOURNAL_MODEL', 'PI_COC_NPC_ACT_MODEL', 'PI_COC_NPC_MODEL', 'PI_COC_SPEECH_EDIT_MODEL', 'PI_COC_VERIFIER_MODEL', 'PI_COC_VOICE_MODEL'];
export let ACK_TIMEOUT = 10, STOP_SETTLE_GRACE = 1.5, STALE_SETTLE_GRACE = 20, OPENING_QUIET = 3, HEARTBEAT_INTERVAL = 2, STARTUP_READY_TIMEOUT = 30;
export const TOOL_RESULT_TRUNCATE_BYTES = 4096, SETTLE_EXIT_CODES: Row = { settled: 0, undelivered_with_tools: 5, empty: 4, timeout: 3 };
export const NOTICE_DETAIL_KEYS = new Set(['provider_outage', 'commit_unavailable', 'delivery_cut_short', 'refused_effect', 'preparation_wait', 'resend_held', 'turn_unfinished', 'standing_conditions', 'input_refused', 'empty_input', 'review_unavailable', 'check_selection_unresolved']);
export class DriverError extends Error {
}
export class DaemonUnavailable extends Error {
}
export class QueueEmpty extends Error {
}
export const time = { monotonic: () => performance.now() / 1000 };
export const sleep = (seconds: number) => new Promise<void>(r => setTimeout(r, seconds * 1000));
export const now_iso = () => new Date().toISOString(), utc_stamp = () => now_iso().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export const run_dir = (run: string) => join(PLAYTESTS_ROOT, run);
export const fileOps = { replace: renameSync };
export function write_json(path: any, obj: any) { const p = String(path); mkdirSync(dirname(p), { recursive: true }); const temporary = p + '.tmp' + process.pid + '-' + randomUUID(); try {
    writeFileSync(temporary, JSON.stringify(obj, null, 2) + '\n');
    fileOps.replace(temporary, p);
}
finally {
    rmSync(temporary, { force: true });
} }
export function read_json(path: any, fallback: any = null) { try {
    return JSON.parse(readFileSync(String(path), 'utf8'));
}
catch (error: any) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError)
        return fallback;
    throw error;
} }
export const append_jsonl = (path: any, obj: any) => appendFileSync(String(path), JSON.stringify(obj) + '\n');
export function truncate_bytes(s: string, limit: number) { const bytes = Buffer.from(s); if (bytes.length <= limit)
    return s; const decoder = new TextDecoder('utf8', { fatal: false }); let end = limit; while (end > 0 && (bytes[end] & 0xc0) === 0x80)
    end--; return decoder.decode(bytes.subarray(0, end)) + '...[truncated]'; }
export const extract_result_text = (result: any) => !result || typeof result !== 'object' ? result == null ? '' : String(result) : (result.content ?? []).filter((b: Row) => b?.type === 'text').map((b: Row) => b.text || '').join('\n');
export function extract_host_delivery(m: Row): Row | null { const d = m.details; if (m.customType !== 'coc-delivery' || m.display !== true || typeof m.content !== 'string' || !d || typeof d !== 'object' || d.coc_delivery !== true)
    return null; return { kind: d.reference_reply === true ? 'reference' : Object.keys(d).some(k => NOTICE_DETAIL_KEYS.has(k)) ? 'notice' : 'narrate', rendered_text: m.content, mechanics: [], pending_choice: null, details: structuredClone(d) }; }
export const PUBLIC_MECHANIC_FIELDS = new Set(`kind visibility family skill roll target threshold difficulty level passed pushed bonus penalty modifier_reason label expression faces total word resource before after item subject_label source_label actor_label target_label combat_action gained lost standing incapacitated from_label to_label minutes how name quantity weapon offer offered_to_label handover currency settlement purpose source_amount purchase_amount cash_debit spending_level spending_day daily_total daily_debited price_name source_display transition round rounds outcome option operation mode loop from_turn document text media_type image_media_type definition adopted quote_status`.split(' '));
const scalar = (v: any) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
export function player_mechanics(rows: any): Row[] { const out:Row[] = []; for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || r.visibility === 'keeper')
        continue;
    const fields = r.kind === 'roll' && r.visibility === 'concealed' ? new Set(['kind', 'visibility', 'skill', 'actor_label']) : new Set([...PUBLIC_MECHANIC_FIELDS, ...(['handout', 'map'].includes(r.kind) ? ['path', 'image_path'] : [])]), shown = Object.fromEntries(Object.entries(r).filter(([k, v]) => fields.has(k) && (scalar(v) || Array.isArray(v) && v.every(scalar))).map(([k, v]) => [k, structuredClone(v)]));
    if (['roll', 'dice'].includes(r.kind) && r.actor_is_investigator !== true && r.public_combat !== true)
        delete shown.actor_label;
    if (r.kind === 'condition' && r.subject_is_investigator !== true)
        delete shown.subject_label;
    out.push(shown);
} return out; }
export function player_choice(c: any): Row | null { if (!c || typeof c !== 'object' || Array.isArray(c))
    return null; const shown: Row = {}; for (const k of ['kind', 'prompt'])
    if (typeof c[k] === 'string')
        shown[k] = c[k]; if (Array.isArray(c.options))
    shown.options = c.options.filter((x: any) => typeof x === 'string'); return Object.keys(shown).length ? shown : null; }
export function print_delivery_panels(d: any) { if (!d || typeof d !== 'object')
    return; const mechanics = player_mechanics(d.mechanics), choice = player_choice(d.pending_choice); if (mechanics.length)
    console.log(JSON.stringify({ mechanics })); if (choice)
    console.log(JSON.stringify({ pending_choice: choice })); }
export function player_table_view(v: Row): Row {
    const pick = (r: any, fields: string[]) => Object.fromEntries(fields.filter(k => r && Object.hasOwn(r, k)).map(k => [k, structuredClone(r[k])])), words = (value: any): any => Array.isArray(value) ? value.map(words) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'id' && !k.endsWith('_id') && !k.startsWith('_') && !['source_object', 'definition', 'version', 'provenance', 'source'].includes(k)).map(([k, x]) => [k, words(x)])) : value;
    const shown: Row = { clock: pick(v.clock, ['minutes', 'elapsed', 'at', 'day', 'hh', 'mm', 'day_part']), scene: pick(v.scene, ['display_name']), investigators: words(v.investigators || []), clues: (v.clues?.discovered ?? []).map((r: Row) => pick(r, ['label', 'how'])), handouts: (v.handouts ?? []).map((r: Row) => pick(r, ['name', 'label', 'text', 'media_type', 'path', 'image_path'])), npcs: [] };
    for (const r of v.npcs?.journal ?? [])
        shown.npcs.push({ ...pick(r, ['name', 'named', 'description', 'seen_count', 'last_seen_turn', 'dead_since_turn']), exchanges: (r.exchanges ?? []).map((e: Row) => pick(e, ['turn', 'summary'])) });
    const c = player_choice(v.pending_choice);
    if (c)
        shown.pending_choice = c;
    return shown;
}
export const extract_setup_opening = (m: Row) => m.customType === 'coc-setup-opening' && m.display === true && typeof m.content === 'string' && m.content ? m.content : null;
export const resolve_launcher = (arg: string | null) => resolve(arg || process.env.PI_COC_LAUNCHER || DEFAULT_LAUNCHER);
export function resolve_run_id(explicit: string | null) { if (explicit)
    return explicit; const info = read_json(CURRENT_RUN_FILE); if (info?.run_id)
    return info.run_id; throw new DriverError('no --run given and no current run recorded; pass --run <run_id>'); }
export const control_socket_path = (id: string) => {const name='pi-coc-play-'+createHash('sha1').update(run_dir(id)).digest('hex').slice(0,16)+'.sock',candidate=join(tmpdir(),name);if(Buffer.byteLength(candidate,'utf8')<104)return candidate;const uid=process.getuid?.(),base=join('/tmp','pi-coc-play-'+String(uid??'user'));mkdirSync(base,{recursive:true,mode:0o700});const owner=lstatSync(base);if(!owner.isDirectory()||owner.isSymbolicLink()||uid!==undefined&&owner.uid!==uid)throw new Error('The short control socket directory has an invalid owner');chmodSync(base,0o700);return join(base,name);};
export class DriverLog {
    path: any;
    constructor(path: any) { this.path = path; }
    write(msg: string) { appendFileSync(String(this.path), now_iso() + ' ' + msg + '\n'); }
}
export function print_log_tail(path: any, n: number) { if (!existsSync(String(path))) {
    console.error('(no log at ' + path + ')');
    return;
} console.log(readFileSync(String(path), 'utf8').trimEnd().split('\n').slice(-n).join('\n')); }
export class EventQueue {
    items: Row[] = [];
    waiters: Array<(v: Row) => void> = [];
    put(value: Row) { const w = this.waiters.shift(); if (w)
        w(value);
    else
        this.items.push(value); }
    async get(timeout: any): Promise<Row> { const seconds = typeof timeout === 'object' ? timeout.timeout : timeout; if (this.items.length)
        return this.items.shift()!; return new Promise((resolve, reject) => { let timer: any; const done = (row: Row) => { clearTimeout(timer); resolve(row); }; this.waiters.push(done); timer = setTimeout(() => { this.waiters = this.waiters.filter(w => w !== done); reject(new QueueEmpty()); }, Math.max(0, seconds) * 1000); }); }
}
export class PiProcess {
    proc: ChildProcessWithoutNullStreams;
    reader_error: string | null = null;
    waiters = new Map<string, (r: Row) => void>();
    turn_queue: EventQueue | null = null;
    private stderrFd: number;
    private buffer = Buffer.alloc(0);
    events_path: any;
    log: DriverLog;
    constructor(launcher: any, args: string[], stderr_log_path: any, events_path: any, log: DriverLog, options: Row = {}) { this.events_path = events_path; this.log = log; this.stderrFd = openSync(String(stderr_log_path), 'a'); this.proc = spawn(String(launcher), args, { cwd: String(options.cwd || REPO_ROOT), env: options.env || process.env, stdio: ['pipe', 'pipe', this.stderrFd] }) as unknown as ChildProcessWithoutNullStreams; this.proc.stdout.on('data', (chunk: Buffer) => { this.buffer = Buffer.concat([this.buffer, chunk]); let index: number; while ((index = this.buffer.indexOf(10)) >= 0) {
        const line = this.buffer.subarray(0, index + 1);
        this.buffer = this.buffer.subarray(index + 1);
        try {
            this._handle_line(line);
        }
        catch (e) {
            this.log.write('pi-stdout: error handling line: ' + String(e));
        }
    } }); this.proc.stdout.on('end', () => this.log.write('pi-stdout: EOF, pi process ended')); this.proc.once('close', () => this.turn_queue?.put({type:'pi_process_closed'})); this.proc.stdout.on('error', e => { this.reader_error = String(e); this.log.write('pi-stdout: reader loop crashed: ' + String(e)); }); }
    send(obj: Row) { this.proc.stdin.write(JSON.stringify(obj) + '\n'); }
    async call(obj: Row, timeout: any): Promise<Row | null> { const seconds = typeof timeout === 'object' ? timeout.timeout : timeout, id = obj.id || randomUUID(); obj.id = id; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.waiters.delete(id); resolve(null); }, seconds * 1000); this.waiters.set(id, r => { clearTimeout(timer); this.waiters.delete(id); resolve(r); }); try {
        this.send(obj);
    }
    catch (error) {
        clearTimeout(timer);
        this.waiters.delete(id);
        reject(error);
    } }); }
    begin_turn() { return this.turn_queue = new EventQueue(); }
    end_turn() { this.turn_queue = null; }
    alive() { return this.proc.exitCode === null && this.proc.signalCode === null; }
    _handle_line(raw: Buffer) { const text = raw.toString('utf8').replace(/\r?\n$/, ''); if (!text)
        return; let obj: Row; try {
        obj = JSON.parse(text);
    }
    catch (e) {
        this.log.write('pi-stdout: non-JSON line ignored: ' + String(e));
        return;
    } obj._recv_at = now_iso(); obj._recv_mono = time.monotonic(); append_jsonl(this.events_path, obj); if (obj.id != null)
        this.waiters.get(obj.id)?.(obj); this.turn_queue?.put(obj); }
    async terminate(timeout = 5) { if (!this.alive())
        return; this.proc.kill('SIGTERM'); await new Promise<void>(resolve => { const timer = setTimeout(done, timeout * 1000); function done() { clearTimeout(timer); resolve(); } this.proc.once('exit', done); }); if (this.alive()) {
        this.proc.kill('SIGKILL');
        await Promise.race([new Promise(r => this.proc.once('exit', r)), sleep(timeout)]);
    } this.proc.stdin.destroy(); closeSync(this.stderrFd); }
}
export function runtime_engine(path: any) { if (!existsSync(String(path)))
    return null; let engine = null; for (const line of readFileSync(String(path), 'utf8').split('\n'))
    try {
        const e = JSON.parse(line);
        if (e.type === 'entry_appended' && e.entry?.customType === 'coc-runtime')
            engine = e.entry.data?.loop_engine;
    }
    catch { } return engine; }
export function validate_engine(expected: string, actual: string | null) { if (actual !== expected)
    throw new DriverError(`engine mismatch: expected ${expected}, actual ${actual || 'unreported'}; invalid-for-acceptance`); }
const rounded = (v: number, d = 3) => round(v,d);
export const runtime: {
    processFactory: any;
    rpcCall: any;
} = { processFactory: PiProcess, rpcCall: null };
export class Daemon {
    run_id: string;
    campaign: string;
    thinking: string | null;
    first_step_thinking: boolean;
    expected_engine: string | null;
    setup_transport = false;
    dir: string;
    log: DriverLog;
    events_path: string;
    daemon_json_path: string;
    heartbeat_path: string;
    socket_path: string;
    turn_count = 0;
    turn_in_progress = false;
    active_turn: Promise<Row> | null = null;
    started_at = now_iso();
    pi: any;
    player_view_command: string[] | null = null;
    server: Server | null = null;
    heartbeat: any;
    constructor(run_id: string, campaign: string, launcher: string | null = null, model: string | null = null, thinking: string | null = null, first_step_thinking = false, expected_engine: string | null = null) { Object.assign(this, { run_id, campaign, thinking, first_step_thinking, expected_engine }); this.run_id = run_id; this.campaign = campaign; this.thinking = thinking; this.first_step_thinking = first_step_thinking; this.expected_engine = expected_engine; this.dir = run_dir(run_id); mkdirSync(this.dir, { recursive: true }); this.log = new DriverLog(join(this.dir, 'driver.log')); this.events_path = join(this.dir, 'events.jsonl'); this.daemon_json_path = join(this.dir, 'daemon.json'); this.heartbeat_path = join(this.dir, 'heartbeat.json'); this.socket_path = control_socket_path(run_id); }
    static async create(...args: ConstructorParameters<typeof Daemon>) { const d = new Daemon(...args); try {
        await d._start_pi(args[2] ?? null, args[1], args[3] ?? null);
        return d;
    }
    catch (error) {
        d.log.write('startup failed: ' + String(error));
        write_json(d.daemon_json_path, { run_id: d.run_id, campaign: d.campaign, status: 'failed', error: String(error), daemon_pid: process.pid, started_at: d.started_at });
        if (d.pi)
            await d.pi.terminate();
        throw error;
    } }
    async _start_pi(launcher_arg: string | null, campaign: string, model: string | null) { checkTestWorkspaceBudget(coc_home(), this.dir); const launcher = resolve_launcher(launcher_arg); this.setup_transport = launcher === resolve(REPO_ROOT, 'bin/pi-coc-setup'); if (!existsSync(launcher))
        throw new DriverError('launcher not found: ' + launcher + ' (pass --launcher, set PI_COC_LAUNCHER, or wait for bin/pi-coc to exist)'); const entry = join(REPO_ROOT, 'build/kernel/rpc.mjs'); if (launcher === resolve(DEFAULT_LAUNCHER) && !existsSync(join(REPO_ROOT, 'deployment.json')) && existsSync(entry) && !process.env.PI_COC_KERNEL_CMD)
        this.player_view_command = [process.env.PI_COC_NODE_EXECUTABLE || process.execPath, entry, '--workspace', coc_home(), '--content', resolve(process.env.PI_COC_CONTENT_ROOT || join(REPO_ROOT, 'content'))]; const testThinking=model==='grok-build/grok-4.5'?'high':model==='codex-relay/gpt-6-luna'?'high':model===DEFAULT_MODEL?DEFAULT_THINKING:null; const args = ['--campaign', campaign, '--mode', 'rpc', '--no-session', '--thinking', testThinking||this.thinking || DEFAULT_THINKING]; if (model) {
        if (!model.includes('/'))
            throw new DriverError("--model must be 'provider/modelId', got " + model);
        const i = model.indexOf('/');
        args.push('--provider', model.slice(0, i), '--model', model.slice(i + 1));
    } const miniMaxTest=model==='minimax-cn/MiniMax-M3.1-Flash-Preview'&&this.thinking==='medium'; this.log.write('spawning ' + launcher + ' ' + args.join(' ') + (this.first_step_thinking ? ' (COC_FIRST_STEP_THINKING=1)' : '')); let env: any = this.first_step_thinking || this.expected_engine || testThinking || miniMaxTest ? { ...process.env } : undefined; if (testThinking) {
        env.PI_COC_TEST_MODEL = model;
        env.PI_COC_KEEPER_CALL_CAP_FLOOR_MS ??= '60000';
        for (const name of TEST_LANE_MODEL_ENVS) {
            env[name] = model;
            env[name + '_THINKING'] = testThinking;
            env[name.replace(/_MODEL$/, '') + '_THINKING'] = testThinking;
        }
    }
    else if (miniMaxTest) env.PI_COC_TEST_MODEL=model;
    else if (env)
        delete env.PI_COC_TEST_MODEL; if (this.first_step_thinking)
        env.COC_FIRST_STEP_THINKING = '1'; if (this.expected_engine)
        env.PI_COC_STARTUP_RECORD = join(this.dir, 'runtime-startup.json'); this.pi = new runtime.processFactory(launcher, args, join(this.dir, 'pi-stderr.log'), this.events_path, this.log, { env }); const base = { run_id: this.run_id, campaign, launcher, daemon_pid: process.pid, pi_pid: this.pi.proc.pid, model_requested: model, started_at: this.started_at, socket_path: this.socket_path }; write_json(this.daemon_json_path, { ...base, status: 'starting' }); const ready = await this.pi.call({ type: 'get_state' }, STARTUP_READY_TIMEOUT); if (!ready?.success)
        throw new DriverError(`pi did not answer startup get_state within ${STARTUP_READY_TIMEOUT}s (got ${JSON.stringify(ready)}); see ${join(this.dir, 'pi-stderr.log')}`); let engine = null; if (this.expected_engine) {
        const deadline = time.monotonic() + ACK_TIMEOUT;
        while (time.monotonic() < deadline) {
            engine = read_json(join(this.dir, 'runtime-startup.json'), {})?.loop_engine || runtime_engine(this.events_path);
            if (engine)
                break;
            await sleep(.05);
        }
        validate_engine(this.expected_engine, engine);
    } let confirmation:Row|null = null; if (model) {
        confirmation = ready.data?.model?.provider + '/' + ready.data?.model?.id === model && ready.data?.thinkingLevel === (testThinking || this.thinking || DEFAULT_THINKING)
            ? {success: true, data: ready.data.model, source: 'startup_get_state'}
            : await this._set_model(model);
        if (!confirmation?.success)
            throw new DriverError('set_model(' + model + ') failed: ' + JSON.stringify(confirmation));
    } write_json(this.daemon_json_path, { ...base, engine_expected: this.expected_engine, engine_actual: engine, model_confirmed: confirmation?.data ?? null, status: 'ready' }); this._write_heartbeat('ready'); this.log.write('daemon ready'); }
    async _set_model(model: string) { if (!model.includes('/'))
        throw new DriverError("--model must be 'provider/modelId', got " + model); const i = model.indexOf('/'); return this.pi.call({ type: 'set_model', provider: model.slice(0, i), modelId: model.slice(i + 1) }, ACK_TIMEOUT); }
    _write_heartbeat(status: string) { write_json(this.heartbeat_path, { at: now_iso(), status, daemon_pid: process.pid, pi_pid: this.pi?.proc?.pid ?? null, pi_alive: this.pi ? this.pi.alive() : false, turn_count: this.turn_count, turn_in_progress: this.turn_in_progress }); }
    async _await_quiet(tq: any, deadline: number) { let next_poll = time.monotonic() + OPENING_QUIET; while (true) {
        let now = time.monotonic();
        if (now >= deadline || !this.pi.alive())
            return false;
        let event:Row|null = null;
        if (now < next_poll)
            try {
                event = await tq.get(Math.min(next_poll, deadline) - now);
            }
            catch (error) {
                if (!(error instanceof QueueEmpty))
                    throw error;
            }
        now = time.monotonic();
        if (now >= deadline || !this.pi.alive())
            return false;
        if (now < next_poll && event?.type !== 'agent_settled')
            continue;
        const state = await this.pi.call({ type: 'get_state' }, Math.min(ACK_TIMEOUT, deadline - now));
        next_poll = time.monotonic() + OPENING_QUIET;
        if (time.monotonic() >= deadline || !this.pi.alive())
            return false;
        const d = state?.data;
        if (d && typeof d === 'object' && !Array.isArray(d) && state.success === true && d.isStreaming === false && !d.isCompacting && !d.pendingMessageCount)
            return true;
    } }
    async handle_turn(text: string, timeout: number) { if (this.turn_in_progress)
        return { ok: false, error: 'a turn is already in progress on this run' }; try { checkTestWorkspaceBudget(coc_home(), this.dir); } catch (error) { return { ok: false, error: String(error) }; } this.turn_in_progress = true; try {
        this.active_turn = this._run_turn(text, timeout);
        return await this.active_turn;
    }
    finally {
        this.turn_in_progress = false;
        this.active_turn = null;
    } }
    async _run_turn(text: string, timeout: number): Promise<Row> {
        this.turn_count++;
        const n = this.turn_count, started = time.monotonic(), stamp = now_iso(), tq = this.pi.begin_turn(), timings: Row = { readiness_wait_seconds: null, prompt_ack_seconds: null, keeper_wait_seconds: null };
        try {
            const ready = await this._await_quiet(tq, started + timeout);
            timings.readiness_wait_seconds = rounded(time.monotonic() - started);
            if (!ready)
                return this._finalize_turn(n, text, stamp, started, [], '', 'timeout', 'previous Keeper run did not become idle', { timings });
            const ack_started = time.monotonic(), ack = await this.pi.call({ type: 'prompt', message: text }, Math.max(.001, started + timeout - time.monotonic())), ack_finished = time.monotonic();
            timings.prompt_ack_seconds = rounded(ack_finished - ack_started);
            if (!ack) {
                await this.pi.call({ type: 'abort' }, ACK_TIMEOUT);
                return this._finalize_turn(n, text, stamp, started, [], '', 'timeout', 'prompt preflight exceeded turn timeout', { timings });
            }
            if (!ack.success)
                return this._finalize_turn(n, text, stamp, started, [], '', 'empty', 'prompt rejected: ' + ack.error, { timings });
            const tools = new Map<any, Row>(), order: any[] = [], text_parts: string[] = [];
            const publicStreams=new Map<string,{attempt:string;sequence:number;text:string;turn:unknown;canonical?:string;completed?:boolean}>();
            let deliveredStreamId:string|null=null;
            let final_parts: string[] = [], delivered = '', delivery: Row | null = null, projected_mechanics: any[] = null as any, projected_choice: Row | null = null, public_clock: Row | null = null, rejected = false, confirmed = false, reason: string | null = null, settle_deadline: number | null = null, stale_deadline: number | null = null, saw_work = false, stale_settles = 0;
            const notices: Row[] = [], setup_openings: string[] = [], reference_replies: string[] = [], deadline = started + timeout;
            const capture = (host: Row):boolean => { if (host.kind === 'reference') {
                if (!reference_replies.includes(host.rendered_text))
                    reference_replies.push(host.rendered_text);
                return false;
            } let accepted=false; rejected = false; if (host.kind === 'notice') {
                notices.push({ content: host.rendered_text, details: structuredClone(host.details) });
                if (!delivery && !confirmed) {
                    delivery = host;
                    delivered = host.rendered_text;
                    deliveredStreamId=null;
                    accepted=true;
                }
            }
            else if (!delivery || delivery.kind === 'notice') {
                delivery = host;
                delivered = host.rendered_text;
                deliveredStreamId=null;
                accepted=true;
            }
            else if (!delivered) {
                delivered = host.rendered_text;
                delivery.rendered_text = delivered;
                deliveredStreamId=null;
                accepted=true;
            } return accepted; };
            while (true) {
                const now = time.monotonic(), wake = Math.min(...[settle_deadline, stale_deadline, deadline].filter((x): x is number => x != null)), wait = wake - now;
                if (wait <= 0) {
                    if (stale_deadline != null && now >= stale_deadline && !saw_work) {
                        reason = 'settled_before_any_work';
                        break;
                    }
                    if (now >= deadline) {
                        reason = 'timeout';
                        break;
                    }
                    if (settle_deadline != null && now >= settle_deadline)
                        break;
                    stale_deadline = null;
                    continue;
                }
                let event: Row;
                try {
                    event = await tq.get(wait);
                }
                catch (error) {
                    if (error instanceof QueueEmpty)
                        continue;
                    throw error;
                }
                if (typeof event._recv_mono === 'number' && event._recv_mono < ack_started)
                    continue;
                const type = event.type;
                if (['agent_start', 'turn_start', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'message_start', 'message_update', 'message_end'].includes(type)) {
                    saw_work = true;
                    stale_deadline = null;
                    settle_deadline = null;
                    reason = null;
                }
                if (type === 'agent_start') {
                    text_parts.length = 0;
                    final_parts = [];
                    confirmed = false;
                }
                if (type === 'message_update') {
                    const ev = event.assistantMessageEvent || {};
                    if (this.setup_transport === true && ev.type === 'text_delta' && event.message?.display !== false)
                        text_parts.push(ev.delta || '');
                }
                else if (type === 'message_end') {
                    const msg = event.message || {}, host = msg.role === 'custom' ? extract_host_delivery(msg) : null, opening = msg.role === 'custom' ? extract_setup_opening(msg) : null;
                    if (host)
                        capture(host);
                    else if (opening) {
                        if (!setup_openings.includes(opening))
                            setup_openings.push(opening);
                    }
                    else if (msg.role === 'assistant' && msg.display === false) {
                        final_parts = [];
                        text_parts.length = 0;
                    }
                    else if (this.setup_transport === true && msg.role === 'assistant')
                        final_parts = (msg.content ?? []).filter((b: Row) => b?.type === 'text').map((b: Row) => b.text || '');
                }
                else if (type === 'tool_execution_start') {
                    const id = event.toolCallId;
                    tools.set(id, { name: event.toolName, args: event.args, _started_mono: event._recv_mono ?? now });
                    if (!order.includes(id))
                        order.push(id);
                }
                else if (type === 'tool_execution_end') {
                    const id = event.toolCallId, rec = tools.get(id) ?? { name: event.toolName, args: null, _started_mono: event._recv_mono ?? now };
                    tools.set(id, rec);
                    Object.assign(rec, { result_text: truncate_bytes(extract_result_text(event.result), TOOL_RESULT_TRUNCATE_BYTES), ms: rounded(((event._recv_mono ?? now) - rec._started_mono) * 1000, 1), is_error: event.isError ?? false });
                    if (['narrate', 'output', 'ask'].includes(rec.name) && event.isError)
                        rejected = true;
                    const details = event.result?.details, embedded = rec.name === 'apply' && details?.narrate_in_apply === true;
                    if ((['narrate', 'output', 'ask'].includes(rec.name) || embedded) && !event.isError) {
                        let body: Row = {};
                        try {
                            body = JSON.parse(extract_result_text(event.result) || '{}');
                        }
                        catch { }
                        if (body && typeof body === 'object' && !Array.isArray(body)) {
                            if (typeof body.rendered_text === 'string') {
                                if(withoutMechanicsMarkers(body.rendered_text)){
                                    delivered = body.rendered_text;
                                    deliveredStreamId=null;
                                }
                                rejected = false;
                            }
                            if (body.player_clock && typeof body.player_clock === 'object')
                                public_clock = player_table_view({ clock: body.player_clock }).clock;
                            delivery = { kind: embedded ? 'narrate' : rec.name, rendered_text: delivered, mechanics: body.mechanics || [], pending_choice: body.pending_choice ?? null };
                        }
                    }
                }
                else if (type === 'entry_appended') {
                    const e = event.entry || {}, data = e.data || {}, host = extract_host_delivery(e), opening = extract_setup_opening(e);
                    if(e.customType==='coc-final-delivery'&&data.version===1){
                        if(data.event==='start')publicStreams.set(data.delivery_id,{attempt:data.attempt_id,sequence:data.sequence,text:'',turn:data.turn});
                        else{
                            const stream=publicStreams.get(data.delivery_id);
                            if(stream&&stream.attempt===data.attempt_id&&data.sequence===stream.sequence+1){
                                stream.sequence=data.sequence;
                                if(data.event==='delta')stream.text+=data.delta??'';
                                if(data.event==='end'&&data.status==='completed'){
                                    stream.completed=true;
                                    const host={kind:'narrate',rendered_text:stream.canonical??stream.text,mechanics:[],pending_choice:null};
                                    if(capture(host))deliveredStreamId=data.delivery_id;
                                }
                            }
                        }
                    }
                    else if (e.customType === 'coc-mechanics' && data && typeof data === 'object') {
                        const stream=typeof data.final_stream_id==='string'?publicStreams.get(data.final_stream_id):undefined;
                        if(e.type==='custom'&&e.display!==false&&stream&&Number.isSafeInteger(data.turn)
                          &&stream.turn===data.turn&&Array.isArray(data.mechanics)){
                            const text=typeof data.marked_text==='string'&&data.marked_text?data.marked_text
                              :typeof data.rendered_text==='string'?data.rendered_text:'';
                            const body=withoutMechanicsMarkers(text);
                            if(body){
                                stream.canonical=body;
                                if(stream.completed&&deliveredStreamId===data.final_stream_id&&delivery){
                                    delivered=body;delivery.rendered_text=body;
                                }
                            }
                        }
                        if (data.player_clock && typeof data.player_clock === 'object')
                            public_clock = player_table_view({ clock: data.player_clock }).clock;
                        if (Array.isArray(data.mechanics))
                            projected_mechanics = structuredClone(data.mechanics);
                    }
                    else if (e.customType === 'coc-choice' && data && typeof data === 'object')
                        projected_choice = structuredClone(data);
                    else if (host)
                        capture(host);
                    else if (opening) {
                        if (!setup_openings.includes(opening))
                            setup_openings.push(opening);
                    }
                    else if (e.customType === 'coc-telemetry' && data.tool === 'narrate' && data.implicit) {
                        rejected = data.ok === false;
                        confirmed = data.ok === true;
                        if (confirmed && delivery?.kind === 'notice') {
                            delivery = null;
                            delivered = '';
                            deliveredStreamId=null;
                        }
                    }
                }
                else if (type === 'agent_settled') {
                    if (!saw_work) {
                        stale_settles++;
                        stale_deadline = time.monotonic() + STALE_SETTLE_GRACE;
                        continue;
                    }
                    reason = 'agent_settled';
                    break;
                }
                else if (type === 'agent_end') {
                    if (event.willRetry || !saw_work)
                        settle_deadline = null;
                    else {
                        reason = 'agent_end';
                        settle_deadline = time.monotonic() + STOP_SETTLE_GRACE;
                    }
                }
                if (!this.pi.alive()) {
                    reason ??= 'pi_died';
                    break;
                }
            }
            let final = delivered.trim();
            if (this.setup_transport === true && !final && !rejected)
                final = final_parts.join('').trim();
            if (this.setup_transport === true && !final && !rejected)
                final = text_parts.join('').trim();
            const records = order.filter(id => tools.has(id)).map(id => tools.get(id)!);
            if (reference_replies.length)
                final = [...reference_replies, ...(final ? [final] : [])].join('\n\n');
            if (projected_mechanics != null || projected_choice != null) {
                delivery ??= { kind: projected_choice ? 'ask' : 'narrate', rendered_text: final, mechanics: [], pending_choice: null };
                if (projected_mechanics != null)
                    delivery.mechanics = projected_mechanics;
                if (projected_choice != null)
                    delivery.pending_choice = projected_choice;
            }
            const unfinished = delivery?.kind === 'notice' && (delivery.details?.turn_unfinished === true
                || delivery.details?.provider_outage === true && delivery.details?.terminal === true);
            const settled = reason === 'timeout' ? 'timeout' : reason === 'settled_before_any_work' ? 'empty'
                : unfinished ? records.length ? 'undelivered_with_tools' : 'empty'
                : final ? 'settled' : records.length ? 'undelivered_with_tools' : 'empty';
            timings.keeper_wait_seconds = rounded(time.monotonic() - ack_finished);
            return this._finalize_turn(n, text, stamp, started, records, final, settled, reason, { stale_settles, delivery, timings, ...(public_clock ? { public_clock } : {}), ...(notices.length ? { notices } : {}), ...(reference_replies.length ? { reference_replies } : {}), ...(setup_openings.length ? { setup_opening: setup_openings.join('\n\n') } : {}) });
        }
        finally {
            this.pi.end_turn();
        }
    }
    async _finalize_turn(n: number, player_text: string, started_at: string, started_mono: number, records: Row[], final_text: string, settle_class: string, stop_reason: string | null, options: Row = {}): Promise<Row> { let player_view:Row|null = null; if (settle_class === 'settled' && options.public_clock)
        player_view = { status: 'ready', surface: 'clock', partial: true, source: 'committed_delivery', view: { clock: options.public_clock } };
    else if (settle_class === 'settled' && this.player_view_command)
        player_view = await this._read_player_view(); const wall_seconds = rounded(time.monotonic() - started_mono), tools = records.map(t => ({ name: t.name ?? null, args: t.args ?? null, result_text: t.result_text || '', ms: t.ms ?? null, is_error: t.is_error || false })), summary: Row = { run_id: this.run_id, turn: n, player_text, final_text, tools, wall_seconds, settle_class, ...(options.timings ? { timings: { ...options.timings } } : {}), stop_reason, started_at, ended_at: now_iso() }; for (const key of ['stale_settles', 'delivery', 'notices', 'reference_replies', 'setup_opening'])
        if (options[key])
            summary[key] = options[key]; if (player_view != null)
        summary.player_view = player_view; write_json(join(this.dir, 'turn-' + n + '.json'), summary); this._write_heartbeat('running'); this.log.write(`turn ${n} settle_class=${settle_class} stop_reason=${stop_reason} wall=${wall_seconds}s tools=${JSON.stringify(tools.map(t => t.name))}`); return { ok: true, summary }; }
    async _read_player_view() { const began = time.monotonic(), deadline = began + 12, request: Row = { id: 'player-view', method: 'table.view', params: { campaign: this.campaign } }; for (const surface of ['full', 'clock']) {
        const remaining = deadline - time.monotonic();
        if (remaining <= 0)
            return { status: 'unavailable', reason: 'public_view_timeout' };
        if (surface === 'clock')
            request.params.panel = 'clock';
        try {
            const result = spawnSync(this.player_view_command![0], this.player_view_command!.slice(1), { input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: Math.min(10, remaining) * 1000, cwd: REPO_ROOT });
            if (result.error) {
                if ((result.error as any).code === 'ETIMEDOUT') {
                    if (surface === 'full')
                        continue;
                    return { status: 'unavailable', reason: 'public_view_timeout' };
                }
                throw result.error;
            }
            if (result.status !== 0)
                return { status: 'unavailable', reason: 'kernel_process_failed' };
            const response = result.stdout.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).find(r => r.id === 'player-view' && Object.hasOwn(r, 'ok'));
            if (response?.ok !== true)
                return { status: 'unavailable', reason: 'public_view_refused' };
            let shown = player_table_view(response.result);
            if (surface === 'clock')
                shown = { clock: shown.clock, scene: shown.scene };
            return { status: 'ready', campaign: this.campaign, table_turn: response.result.turn, captured_at: now_iso(), ms: rounded((time.monotonic() - began) * 1000, 1), surface, partial: surface !== 'full', view: shown };
        }
        catch {
            return { status: 'unavailable', reason: 'invalid_public_view' };
        }
    } return { status: 'unavailable', reason: 'public_view_timeout' }; }
    _compute_totals() { let tool_calls = 0, wall = 0; for (let i = 1; i <= this.turn_count; i++) {
        const t = read_json(join(this.dir, 'turn-' + i + '.json'), {});
        tool_calls += (t.tools ?? []).length;
        wall += t.wall_seconds || 0;
    } return { tool_calls, wall_seconds: rounded(wall) }; }
    async handle_stop() { if (this.turn_in_progress) {
        this.log.write('stop: a turn is in flight, sending abort');
        await this.pi.call({ type: 'abort' }, ACK_TIMEOUT);
    } await this.pi.terminate(); await this.active_turn; const final = { run_id: this.run_id, campaign: this.campaign, turn_count: this.turn_count, started_at: this.started_at, ended_at: now_iso(), totals: this._compute_totals() }; write_json(join(this.dir, 'final.json'), final); this._write_heartbeat('stopped'); const info = read_json(this.daemon_json_path, {}) || {}; info.status = 'stopped'; write_json(this.daemon_json_path, info); this.log.write('daemon stopped'); return { ok: true, final }; }
    async serve_forever() { rmSync(this.socket_path, { force: true }); this.server = createServer(socket => { let buffer = ''; socket.on('data', async (chunk) => { buffer += chunk.toString(); const index = buffer.indexOf('\n'); if (index < 0)
        return; socket.pause(); let response: Row; try {
        const req = JSON.parse(buffer.slice(0, index));
        if (['ping', 'status'].includes(req.cmd))
            response = { ok: true, daemon_pid: process.pid, pi_pid: this.pi.proc.pid, pi_alive: this.pi.alive(), turn_count: this.turn_count, turn_in_progress: this.turn_in_progress };
        else if (req.cmd === 'turn')
            response = await this.handle_turn(req.text || '', Number(req.timeout ?? 300));
        else if (req.cmd === 'stop') {
            response = await this.handle_stop();
            clearInterval(this.heartbeat);
            this.server?.close();
            rmSync(this.socket_path, { force: true });
        }
        else
            response = { ok: false, error: 'unknown cmd ' + req.cmd };
    }
    catch (error) {
        response = { ok: false, error: String(error) };
    } socket.end(JSON.stringify(response) + '\n'); }); socket.on('error', e => this.log.write('conn handler error: ' + String(e))); }); await new Promise<void>((r, j) => { this.server!.once('error', j); this.server!.listen(this.socket_path,()=>{chmodSync(this.socket_path,0o600);r();}); }); this.heartbeat = setInterval(() => this._write_heartbeat(this.pi.alive() ? 'running' : 'pi_dead'), HEARTBEAT_INTERVAL * 1000); this.log.write('control socket listening at ' + this.socket_path); }
}
export async function rpc_call(run_id: string, req: Row, timeout: number): Promise<Row> { const path = control_socket_path(run_id); if (!existsSync(path))
    throw new DaemonUnavailable('control socket not found at ' + path + '; daemon likely not running'); return new Promise((resolve, reject) => { const socket = createConnection(path); let buffer = ''; socket.setTimeout(timeout * 1000); socket.on('connect', () => socket.write(JSON.stringify(req) + '\n')); socket.on('data', chunk => { buffer += chunk.toString(); if (buffer.includes('\n')) {
    try {
        const row = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        socket.destroy();
        resolve(row);
    }
    catch (error) {
        socket.destroy();
        reject(error);
    }
} }); socket.on('timeout', () => { socket.destroy(); reject(new DaemonUnavailable(`daemon did not respond within ${timeout}s (may be hung)`)); }); socket.on('error', e => reject(new DaemonUnavailable('cannot connect to daemon at ' + path + ': ' + String(e)))); socket.on('end', () => { if (!buffer)
    reject(new DaemonUnavailable('daemon closed the connection without responding')); }); }); }
export function _best_effort_final(dir: any) { const d = String(dir), info = read_json(join(d, 'daemon.json'), {}) || {}, turns = readdirSync(d).filter(f => /^turn-.*\.json$/.test(f)).sort(); let tool_calls = 0, wall = 0; for (const path of turns) {
    const t = read_json(join(d, path), {}) || {};
    tool_calls += (t.tools ?? []).length;
    wall += t.wall_seconds || 0;
} return { run_id: info.run_id ?? null, campaign: info.campaign ?? null, turn_count: turns.length, started_at: info.started_at ?? null, ended_at: now_iso(), totals: { tool_calls, wall_seconds: rounded(wall) }, note: 'control socket was unreachable; totals reconstructed from turn-*.json files on disk' }; }
export async function _wait_for_ready(dir: any, timeout: number) { const deadline = time.monotonic() + timeout; while (time.monotonic() < deadline) {
    const info = read_json(join(String(dir), 'daemon.json'));
    if (info?.status === 'ready')
        return true;
    if (info?.status === 'failed')
        return false;
    await sleep(.2);
} return false; }
export function coc_home() { const raw = (process.env.PI_COC_HOME || '').trim(); return raw ? resolve(REPO_ROOT, raw.replace(/^~(?=\/|$)/, process.env.HOME || '')) : REPO_ROOT; }
export function create_pregen_campaign(campaign: string, pregen: string, module: string, play_language: string) { const entry = join(REPO_ROOT, 'build/kernel/rpc.mjs'); if (!existsSync(entry))
    throw Error('build the kernel first: npm run build:runtime'); const request = { id: 'start-pregen', method: 'campaign.create', params: { id: campaign, module, pregen, play_language } }, result = spawnSync(process.execPath, [entry, '--workspace', coc_home(), '--content', join(REPO_ROOT, 'content')], { input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: 120000, cwd: REPO_ROOT }); let response:Row|null = null; for (const line of result.stdout.split('\n'))
    try {
        const r = JSON.parse(line);
        if (r.id === request.id)
            response = r;
    }
    catch { } if (!response?.ok)
    throw Error('campaign.create failed: ' + JSON.stringify(response?.error || result.stderr.trim().slice(-400) || result.stdout.trim().slice(-400))); }
export async function cmd_start(args: Row) { const campaign = args.campaign; if (args.seed_home && args.pregen) { console.error('error: --seed-home and --pregen are separate starting positions'); return 1; } if (args.pregen) {
    if (existsSync(join(coc_home(), '.coc/campaigns', campaign)))
        console.error(`campaign ${campaign} already exists; --pregen ignored`);
    else {
        try {
            create_pregen_campaign(campaign, args.pregen, args.module, args.play_language);
        }
        catch (e) {
            console.error('error: ' + e);
            return 1;
        }
        console.log(`created campaign ${campaign} from pregen ${args.pregen} (${args.module}, ${args.play_language})`);
    }
} const run = args.run || campaign + '-' + utc_stamp(), dir = run_dir(run); if (existsSync(dir) && readdirSync(dir).length) {
    console.error('error: run dir already exists and is non-empty: ' + dir);
    return 1;
} mkdirSync(dir, { recursive: true }); const command = [fileURLToPath(import.meta.url), '_daemon', '--run', run, '--campaign', campaign]; for (const key of ['expect_engine', 'launcher', 'model', 'thinking'])
    if (args[key])
        command.push('--' + key.replaceAll('_', '-'), args[key]); if (args.first_step_thinking)
    command.push('--first-step-thinking'); const env = { ...process.env }; for (const pair of args.env ?? []) {
    if (!pair.includes('=')) {
        console.error('error: --env expects KEY=VALUE, got ' + pair);
        return 1;
    }
    const i = pair.indexOf('=');
    env[pair.slice(0, i)] = pair.slice(i + 1);
} if (args.seed_home) {
    if ((args.env ?? []).some((pair: string) => pair.startsWith('PI_COC_HOME='))) { console.error('error: --seed-home owns PI_COC_HOME'); return 1; }
    try { const workspace = join(dir, 'workspace'); createTestWorkspace({ seed: resolve(REPO_ROOT, args.seed_home), destination: workspace, campaign }); env.PI_COC_HOME = workspace; }
    catch (error) { console.error('error: test workspace admission failed: ' + String(error)); return 1; }
} const fd = openSync(join(dir, 'daemon-stdout.log'), 'a'); try {
    spawn(process.execPath, command, { cwd: REPO_ROOT, env, stdio: ['ignore', fd, fd], detached: true }).unref();
}
finally {
    closeSync(fd);
} if (!await _wait_for_ready(dir, STARTUP_READY_TIMEOUT)) {
    const info = read_json(join(dir, 'daemon.json'), {}) || {};
    console.error(info.status === 'failed' ? 'error: daemon failed to start: ' + info.error : `error: daemon did not become ready within ${STARTUP_READY_TIMEOUT}s (run ${run})`);
    print_log_tail(join(dir, 'driver.log'), 40);
    print_log_tail(join(dir, 'daemon-stdout.log'), 20);
    return 1;
} if (!args.no_default_run)
    write_json(CURRENT_RUN_FILE, { run_id: run }); const info = read_json(join(dir, 'daemon.json'), {}); console.log(`started run ${run} (daemon pid ${info.daemon_pid}, pi pid ${info.pi_pid})`); console.log('evidence: ' + dir); return 0; }
export async function cmd_turn(args: Row) { const run = resolve_run_id(args.run), dir = run_dir(run); let resp; try {
    resp = await (runtime.rpcCall ?? rpc_call)(run, { cmd: 'turn', text: args.text, timeout: args.timeout }, args.timeout + 15);
}
catch (e) {
    console.error('error: ' + e);
    print_log_tail(join(dir, 'driver.log'), 40);
    return 2;
} if (!resp.ok) {
    console.error('error: turn rejected: ' + resp.error);
    print_log_tail(join(dir, 'driver.log'), 40);
    return 2;
} const s = resp.summary; if (s.setup_opening)
    console.log(s.setup_opening + '\n'); console.log(s.final_text || '(no assistant text this turn)'); for (const [i, n] of (s.notices ?? []).entries())
    if (!(i === 0 && s.delivery?.kind === 'notice'))
        console.log(n.content); print_delivery_panels(s.delivery); if (s.player_view)
    console.log(JSON.stringify({ player_view: s.player_view })); console.log(`[turn ${s.turn} | ${fixed(s.wall_seconds,1)}s | tools: ${s.tools.length ? s.tools.map((t: Row) => t.name).join(', ') : '(none)'}]`); return SETTLE_EXIT_CODES[s.settle_class] ?? 1; }
export async function cmd_stop(args: Row) { const run = resolve_run_id(args.run), dir = run_dir(run); try {
    const resp = await rpc_call(run, { cmd: 'stop' }, 30);
    if (!resp.ok) {
        console.error('error stopping: ' + resp.error);
        return 1;
    }
    const f = resp.final;
    console.log(`stopped run ${run}: ${f.turn_count} turns, ${f.totals.tool_calls} tool calls, ${fixed(f.totals.wall_seconds,1)}s total`);
    return 0;
}
catch (e) {
    console.error('warning: ' + e);
    write_json(join(dir, 'final.json'), _best_effort_final(dir));
    console.log('daemon already unreachable; wrote best-effort final.json under ' + dir);
    return 1;
} }
export function cmd_log(args: Row) { const run = resolve_run_id(args.run), path = join(run_dir(run), 'driver.log'); if (!existsSync(path)) {
    console.error('no driver.log for run ' + run + ' at ' + path);
    return 2;
} print_log_tail(path, args.tail); return 0; }
export async function cmd_status(args: Row) { const run = resolve_run_id(args.run), dir = run_dir(run); if (!existsSync(dir)) {
    console.error('no such run: ' + run);
    return 2;
} try {
    const r = await rpc_call(run, { cmd: 'status' }, 5);
    console.log(`run ${run}: daemon alive (pid ${r.daemon_pid}), pi ${r.pi_alive ? 'alive' : 'dead'} (pid ${r.pi_pid}), turns so far: ${r.turn_count}, turn in progress: ${r.turn_in_progress}`);
    return 0;
}
catch (e) {
    console.log(`run ${run}: daemon unreachable (${e})`);
    const hb = read_json(join(dir, 'heartbeat.json')), info = read_json(join(dir, 'daemon.json'));
    if (hb)
        console.log(`  last heartbeat: ${hb.at} status=${hb.status} turn_count=${hb.turn_count} pi_alive_at_that_time=${hb.pi_alive}`);
    if (info)
        console.log(`  daemon.json status=${info.status} daemon_pid=${info.daemon_pid} pi_pid=${info.pi_pid}`);
    return 1;
} }
export function build_parser() { return { parse_args(argv: string[]) { const a: Row = { subcommand: argv[0], run: null, campaign: null, launcher: null, model: argv[0] === 'start' ? DEFAULT_MODEL : null, thinking: argv[0] === 'start' ? DEFAULT_THINKING : null, timeout: 300, tail: 60, first_step_thinking: false, no_default_run: false, pregen: null, module: 'the-haunting', play_language: 'zh', env: [] }; for (let i = 1; i < argv.length; i++) {
        const key = argv[i];
        if (['--first-step-thinking', '--no-default-run'].includes(key))
            a[key.slice(2).replaceAll('-', '_')] = true;
        else if (key === '--env')
            a.env.push(argv[++i]);
        else if (key.startsWith('--')) {
            const k = key.slice(2).replaceAll('-', '_');
            if (k === 'seed_home' && (!argv[i + 1] || argv[i + 1].startsWith('--'))) throw new DriverError('--seed-home requires a retained workspace path');
            a[k] = ['timeout', 'tail'].includes(k) ? Number(argv[++i]) : argv[++i];
        }
        else
            a.text = key;
    } if (!['start', 'turn', 'stop', 'log', 'status', '_daemon'].includes(a.subcommand))
        throw new DriverError('unknown subcommand'); if (['start', '_daemon'].includes(a.subcommand) && !a.campaign)
        throw new DriverError('--campaign is required'); if (a.thinking && !['off', 'minimal', 'low', 'medium', 'high'].includes(a.thinking))
        throw new DriverError('invalid thinking level'); return a; } }; }
export async function main(argv = process.argv.slice(2)) {
 if(argv.includes('--help')||argv.includes('-h')){const command=argv[0],common='--run RUN';
 const lines:Row={start:'--campaign ID [--run RUN] [--seed-home PATH] [--model provider/modelId] [--thinking off|minimal|low|medium|high] [--launcher PATH] [--first-step-thinking] [--expect-engine legacy|hybrid-v1] [--pregen PREGEN] [--module MODULE] [--play-language TAG] [--no-default-run] [--env KEY=VALUE]',turn:'TEXT [--run RUN] [--timeout SECONDS]',stop:'[--run RUN]',log:'[--run RUN] [--tail N]',status:'[--run RUN]',_daemon:'--campaign ID --run RUN [--model provider/modelId] [--thinking LEVEL] [--launcher PATH] [--first-step-thinking] [--expect-engine legacy|hybrid-v1]'};
 console.log(lines[command]?'usage: driver.ts '+command+' '+lines[command]:'usage: driver.ts {start,turn,stop,log,status} [arguments]');return 0;
 }
 try {
    const args = build_parser().parse_args(argv);
    if (args.subcommand === '_daemon') {
        const d = await Daemon.create(args.run, args.campaign, args.launcher, args.model, args.thinking, args.first_step_thinking, args.expect_engine);
        await d.serve_forever();
        return 0;
    }
    return await ({ start: cmd_start, turn: cmd_turn, stop: cmd_stop, log: cmd_log, status: cmd_status } as Row)[args.subcommand](args);
}
catch (e) {
    console.error('error: ' + e);
    return 1;
} }
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
    process.exitCode = await main();
