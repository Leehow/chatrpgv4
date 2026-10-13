/** Isolated persona benchmark actor; benchmark records never establish live acceptance. */
import { mkdtempSync,realpathSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { tmpdir,homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { DriverLog, PiProcess, REPO_ROOT, now_iso, time as driverTime, sleep, QueueEmpty } from './driver.ts';
import { METRICS, MOTIVATIONS } from './persona-metrics.ts';
type Row = Record<string, any>;
export const ISOLATION_FLAGS = ['--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-session'], CREDENTIAL_FILES = ['auth.json', 'models.json'];
export const DEFAULT_PLAYER_MODEL = 'codex-relay/gpt-6-luna', PLAYER_TURN_TIMEOUT = 180, PLAYER_SETTLE_GRACE = 1.5, PLAYER_BACKOFF_SECONDS = [10, 30, 60, 120], EXHAUSTED_STATUSES = ['(402)', '(403)'];
export class ProviderExhausted extends Error {
}
export const SYSTEM_PROMPT = "You are simulating a real tabletop RPG player at a Call of Cthulhu table.\n\nYou are not a test engineer, not an author, and not the Keeper. Your goal is not to help the\nKeeper finish the scenario. Your goal is to play, naturally, as the player described by the\nPLAYER PROFILE below.\n\nYou know only:\n- what the Keeper has narrated to you\n- your own investigator sheet as it has been shown to you\n- information that has been made public in play\n- what you yourself have lived through in this session\n\nYou do not have and must never use:\n- the module text\n- the Keeper's private information\n- the story graph\n- undiscovered clues\n- NPC hidden motives\n- any test criteria\n\nRules that matter:\n1. Do not cooperate just to keep the story moving.\n2. If your player would hesitate, err, misunderstand or wander off, do that.\n3. You may form wrong hypotheses.\n4. Guessing the truth as a language model does not let your character know it.\n5. Your actions must follow from what your character currently knows.\n6. Choose according to the PLAYER PROFILE's preferences.\n7. You do not need to reach the best ending.\n8. You do not need to keep your investigator alive.\n9. Do not deliberately test the system unless the PLAYER PROFILE itself asks for that behaviour.\n\nEvery turn you receive the delivery the table's interface shows a player: the Keeper's prose,\nand this turn's mechanical receipts as JSON rows (rolls, changes, clues, time, items). The\nrows are the dice cards the interface draws; read them as a player reads their own sheet.\nNumbers never appear in the prose, so the rows are the only place they are.\n\nAnswer with one JSON object and nothing else -- no code fence, no commentary:\n\n{\"player_message\": \"<one natural player turn, addressed to the table>\",\n \"private_eval\": {\"current_goal\": \"<short>\",\n                  \"current_hypothesis\": \"<what you currently believe is going on>\",\n                  \"hypothesis_confidence\": <0.0-1.0>,\n                  \"perceived_agency\": <0-10>,\n                  \"confusion\": <0-10>,\n                  \"engagement\": <0-10>,\n                  \"frustration\": <0-10>}}\n\n`player_message` is the only thing the Keeper receives; write it in {play_language} and keep it\nto what a player would actually say or do in one turn. `private_eval` is never shown to the\nKeeper; write it in English, honestly, including when you are bored, lost or annoyed.\n";
export const PROFILE_TEMPLATE = "PLAYER PROFILE\n\nid: {id}\nname: {name}\nsummary: {summary}\n\nmotivations (0.0-1.0):\n{motivations}\n\nbehaviour:\n{behavior}\n\nhow this player plays:\n{special}\n\nyour investigator: {investigator}\n\n{variation}\n";
export function render_profile(persona: Row, variation: string, investigator: string) { const entries = (v: Row) => Object.keys(v).sort().map(k => '  ' + k + ': ' + v[k]).join('\n'), values = { id: persona.id, name: persona.name, summary: persona.summary, motivations: entries(persona.motivations), behavior: entries(persona.behavior ?? {}), special: (persona.special ?? []).map((x: string) => '  - ' + x).join('\n'), investigator, variation }; return PROFILE_TEMPLATE.replace(/\{(\w+)\}/g, (_m, k) => String((values as Row)[k])); }
export const CONCEALED_FIGURES = ['roll', 'target', 'threshold', 'difficulty', 'level', 'passed', 'pushed'];
export function player_view(delivery: Row | null, final_text: string, settle_class: string) { if (settle_class !== 'settled')
    return '[The table produced nothing this turn: the Keeper did not deliver. Say what you do next.]'; const prose = delivery?.rendered_text || final_text || '', rows = (delivery?.mechanics ?? []).filter((r: Row) => r && typeof r === 'object' && !Array.isArray(r) && r.visibility !== 'keeper').map((r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !(r.kind === 'roll' && r.visibility === 'concealed' && CONCEALED_FIGURES.includes(k))).sort(([a], [b]) => a.localeCompare(b)))); return rows.length ? prose + '\n\n[mechanics this turn]\n' + rows.map((r: Row) => JSON.stringify(r)).join('\n') : prose; }
export function parse_reply(text: string): [
    Row | null,
    string | null
] { if (!text?.trim())
    return [null, 'empty reply']; let raw = text.trim(); if (raw.startsWith('```')) {
    raw = raw.slice(raw.indexOf('\n') + 1);
    if (raw.trimEnd().endsWith('```'))
        raw = raw.trimEnd().slice(0, -3);
} const start = raw.indexOf('{'), end = raw.lastIndexOf('}'); if (start < 0 || end <= start)
    return [null, 'no JSON object in reply']; let obj: Row; try {
    obj = JSON.parse(raw.slice(start, end + 1));
}
catch (error) {
    return [null, 'reply is not JSON: ' + error];
} if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    return [null, 'reply is not a JSON object']; if (typeof obj.player_message !== 'string' || !obj.player_message.trim())
    return [null, 'player_message missing or empty']; return [{ player_message: obj.player_message.trim(), private_eval: obj.private_eval && typeof obj.private_eval === 'object' && !Array.isArray(obj.private_eval) ? obj.private_eval : {} }, null]; }
export const time = { monotonic: driverTime.monotonic, sleep };
function sandboxRoot(){
  const repo=realpathSync(REPO_ROOT);
  for(const candidate of [tmpdir(),join(homedir(),'.cache','coc-persona-sandboxes')]){
    mkdirSync(candidate,{recursive:true});const canonical=realpathSync(candidate),relation=relative(repo,canonical);
    if(relation==='..'||relation.startsWith('..'+sep)||isAbsolute(relation))return canonical;
  }
  throw new Error('No temporary sandbox root outside the repository is available');
}
const sandboxes = new Set<string>();
process.once('exit', () => { for (const path of sandboxes)
    rmSync(path, { recursive: true, force: true }); });
export class PersonaPlayer {
    persona: Row;
    model: string;
    dir: string;
    log: DriverLog;
    system_prompt: string;
    _credentials_from: string;
    _launcher: string;
    _sandbox: string;
    pi: PiProcess | null = null;
    isolation: Row = {};
    _last_error_message: string | null = null;
    constructor(persona: Row, run_dir: any, options: Row = {}) { this.persona = persona; this.model = options.model || DEFAULT_PLAYER_MODEL; this.dir = String(run_dir); mkdirSync(this.dir, { recursive: true }); this.log = new DriverLog(join(this.dir, 'player.log')); this.system_prompt = SYSTEM_PROMPT.replaceAll('{play_language}', options.play_language ?? 'zh-Hans') + '\n' + render_profile(persona, options.variation ?? '', options.investigator ?? ''); writeFileSync(join(this.dir, 'player-system-prompt.txt'), this.system_prompt); this._credentials_from = String(options.credentials_from || join(REPO_ROOT, '.pi/coc-agent')); this._launcher = String(options.launcher || join(REPO_ROOT, 'node_modules/.bin/pi')); this._sandbox = mkdtempSync(join(sandboxRoot(), 'persona-' + persona.id + '-')); sandboxes.add(this._sandbox); }
    async start() { const home = join(this._sandbox, 'home'), work = join(this._sandbox, 'work'); mkdirSync(home, { recursive: true }); mkdirSync(work, { recursive: true }); seed_home(home, this._credentials_from); const i = this.model.indexOf('/'), provider = this.model.slice(0, i), model_id = this.model.slice(i + 1), args = [...ISOLATION_FLAGS, '--mode', 'rpc', '--provider', provider, '--model', model_id, '--thinking', 'high', '--system-prompt', this.system_prompt], env: Row = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['PI_COC_', 'PIPIUI_', 'PI_CODING_AGENT_DIR'].some(p => k.startsWith(p)))); env.PI_CODING_AGENT_DIR = home; env.HOME = home; this.isolation = { argv_flags: [...ISOLATION_FLAGS], cwd: work, pi_home: home, repo_visible: false, model: this.model, system_prompt_sha256: _sha256(this.system_prompt) }; this.log.write(`starting persona ${this.persona.id} on ${this.model} in ${work}`); this.pi = new PiProcess(this._launcher, args, join(this.dir, 'player-stderr.log'), join(this.dir, 'player-events.jsonl'), this.log, { cwd: work, env }); const ready = await this.pi.call({ type: 'get_state' }, 30); if (!ready?.success)
        throw Error('persona player did not answer get_state (got ' + JSON.stringify(ready) + '); see ' + join(this.dir, 'player-stderr.log')); }
    async stop() { if (this.pi) {
        await this.pi.terminate();
        this.pi = null;
    } this._remove_sandbox(); }
    _remove_sandbox() { rmSync(this._sandbox, { recursive: true, force: true }); sandboxes.delete(this._sandbox); }
    async act(view: string, options: Row = {}) { const timeout = options.timeout ?? PLAYER_TURN_TIMEOUT, retries = options.retries ?? 1; let attempt = 0, transient = 0, last_error = 'not attempted', raw = ''; while (attempt <= retries && transient <= PLAYER_BACKOFF_SECONDS.length) {
        const nudge = attempt ? '\n\n[Your last reply could not be read. Answer with one JSON object exactly as your instructions describe, and nothing else.]' : '';
        const [text, errored] = await this._prompt(view + nudge, timeout);
        raw = text;
        const [parsed, error] = parse_reply(raw);
        if (parsed)
            return { ok: true, at: now_iso(), attempts: attempt + transient + 1, transient_retries: transient, raw, ...parsed };
        if (errored && EXHAUSTED_STATUSES.some(c => (this._last_error_message || '').includes(c)))
            throw new ProviderExhausted(this._last_error_message || 'provider refused: 402/403');
        if (errored && !raw) {
            const wait = PLAYER_BACKOFF_SECONDS[Math.min(transient, PLAYER_BACKOFF_SECONDS.length - 1)];
            transient++;
            last_error = 'provider error';
            this.log.write(`persona session error (transient ${transient}); waiting ${wait}s`);
            await time.sleep(wait);
            continue;
        }
        last_error = error || 'unparseable';
        this.log.write(`persona reply rejected (attempt ${attempt + 1}): ${last_error}`);
        attempt++;
    } return { ok: false, at: now_iso(), attempts: attempt + transient, transient_retries: transient, raw, error: last_error, player_message: null, private_eval: {} }; }
    async _prompt(message: string, timeout: number): Promise<[
        string,
        boolean
    ]> { if (!this.pi)
        throw Error('PersonaPlayer.start() was not called'); const tq = this.pi.begin_turn(), deadline = time.monotonic() + timeout; try {
        const ack = await this.pi.call({ type: 'prompt', message }, Math.max(.001, deadline - time.monotonic()));
        if (!ack?.success) {
            await this.pi.call({ type: 'abort' }, 5);
            return ['', true];
        }
        const parts: string[] = [];
        let final: string[] = [], errored = false, settle_deadline: number | null = null;
        while (true) {
            const wake = Math.min(...[settle_deadline, deadline].filter((x): x is number => x != null)), wait = wake - time.monotonic();
            if (wait <= 0)
                break;
            let event: Row;
            try {
                event = await tq.get(wait);
            }
            catch (error) {
                if (error instanceof QueueEmpty)
                    continue;
                throw error;
            }
            const type = event.type;
            if (type === 'message_update') {
                const ev = event.assistantMessageEvent || {};
                if (ev.type === 'text_delta')
                    parts.push(ev.delta || '');
            }
            else if (type === 'message_end') {
                const msg = event.message || {};
                if (msg.stopReason === 'error' || msg.error) {
                    errored = true;
                    this._last_error_message = String(msg.errorMessage || msg.error || '');
                }
                if (msg.role === 'assistant')
                    final = (msg.content ?? []).filter((b: Row) => b?.type === 'text').map((b: Row) => b.text || '');
            }
            else if (type === 'agent_settled')
                break;
            else if (type === 'agent_end') {
                if (event.error)
                    errored = true;
                if (!event.willRetry)
                    settle_deadline = time.monotonic() + PLAYER_SETTLE_GRACE;
            }
            if (!this.pi.alive()) {
                errored = true;
                break;
            }
        }
        return [(final.join('') || parts.join('')).trim(), errored];
    }
    finally {
        this.pi.end_turn();
    } }
}
export function seed_home(home: any, credentials_from: any) { const path = String(home); mkdirSync(path, { recursive: true }); for (const name of CREDENTIAL_FILES) {
    const source = join(String(credentials_from), name);
    if (existsSync(source)) {
        const target = join(path, name);
        rmSync(target, { force: true });
        symlinkSync(resolve(source), target);
    }
} writeFileSync(join(path, 'settings.json'), JSON.stringify({ quietStartup: true }) + '\n'); return home; }
export const _sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Invalid persona values are distinct from JSON syntax and filesystem failures. */
export class PersonaValidationError extends Error {}
export function load_persona(path: any) { const persona = JSON.parse(readFileSync(String(path), 'utf8')); for (const field of ['id', 'name', 'kind', 'summary', 'motivations', 'behavior', 'special', 'natural_investigator', 'probes', 'assertions'])
    if (!Object.hasOwn(persona, field))
        throw new PersonaValidationError(String(path) + ': persona is missing ' + field); const unknown = Object.keys(persona.motivations).filter(x => !MOTIVATIONS.includes(x)); if (unknown.length)
    throw new PersonaValidationError(String(path) + ': motivations outside the closed activity set: ' + JSON.stringify(unknown.sort())); for (const id of persona.assertions)
    if (!Object.hasOwn(METRICS, id))
        throw new PersonaValidationError(String(path) + ': names unregistered metric ' + id + ' -- register it in tests/play/persona-metrics.ts first (spec section6)'); return persona; }
export function load_personas(directory: any = join(REPO_ROOT, 'tests/play/personas')) { const out: Row = {}; for (const name of readdirSync(String(directory)).filter(n => n.endsWith('.json')).sort()) {
    const p = load_persona(join(String(directory), name));
    out[p.id] = p;
} return out; }
