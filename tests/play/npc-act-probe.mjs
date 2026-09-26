#!/usr/bin/env node
/**
 * Ticket 07 (docs/specs/npc-acts-first-tickets/07-probe-and-judge.md; spec docs/specs/npc-acts-first.md
 * section 五): an offline seeded probe with real models, measuring whether Steven Knott's generated act
 * (contract §139.2, §139.3, §139.8) reads like what a person would do.
 *
 * What it does, once per round (three rounds; kernel seed fixed, so only the model's sampling varies):
 *   For each retained table (npc-actor-gate-a, npc-actor-gate-a2, turns 1-8, read-only from the lead's
 *   integration worktree): open a fresh campaign of the-haunting / thomas-hayes / zh-Hans, then for each
 *   turn replay the recorded `player_text` through `player_input`, replay the turn's recorded `resolve`/
 *   `apply` calls that were not errors (skipping `look`/`lookup`/`recall`/`ask`/`narrate`; a call the
 *   current kernel refuses is skipped and logged, never retried), and close with `narrate` of the
 *   recorded `final_text`. At the point in the turn where Steven Knott's own act belongs (before any
 *   recorded call that is his), the real generation lane (`runtime/jev/npc-act.ts`) writes one act from
 *   `npc.stakes` + `npc.situation`, and the real Jev bind (`runtime/jev/npc-act-step.ts`'s
 *   `npcActBatch`/`interpretNpcAct`, `createDecisionAdapter`) resolves it to a way and parameters. The
 *   bound act is never executed into the replayed campaign -- only the generation and the bind are real;
 *   the campaign keeps advancing on the recorded calls, which is why dice differ from the original table
 *   (a different seed) while the situation each turn stays coherent.
 *
 * A `pi -p` judge (stdin closed, model opencode-go/deepseek-v4.1-flash, --no-extensions --no-tools)
 * answers two questions per act, given the packet in plain words and the act: (1) would a person in this
 * situation plausibly do this now (yes/no + why), and (2) is this the same act as any earlier act of
 * this person in this table's turn order this round, or a new one (index + why).
 *
 * Live model calls are the point of this ticket (offline, this Mac only): credentials are read from the
 * real installed App's agent home (~/Library/Application Support/Pipi/pipicoc/pi-coc/agent) into a
 * throwaway copy for the session, and the Jev key is read from the same App's encrypted vault exactly as
 * `docs/../gate-start.sh` reads it. Nothing here prints, logs or commits a key or token.
 *
 * Ticket 20 (§139.19, spec D10): on a turn whose stakes die allowed a surprise, the lane's answer may name what the act
 * brings out (`produces`); the bind then asks the price-list record of it (its part first, the 1920s list being longer
 * than one question) and the record reads as `produced` (the book's, or the table's own). Report only: how often
 * `produces` appears on surprise turns, and what it names. Nothing is executed, as before.
 *
 * Usage:
 *   node tests/play/npc-act-probe.mjs [--rounds 3] [--seed 20260926] [--out <dir>] [--table npc-actor-gate-a]
 *
 * Output: .coc/playtests/npc-act-probe-<timestamp>/round-<n>/records.jsonl (kind: probe|refusal|turn),
 * round-<n>/judge.jsonl, and summary.md at the top.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const APP_AGENT_HOME = join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc/agent');
const NPC_ACTOR_WORKTREE = '/Users/haoli/leehow/code/chatrpgv4-wt-npc-actor';
export const RETAINED_TABLES = [
  { table: 'npc-actor-gate-a', dir: join(NPC_ACTOR_WORKTREE, '.coc/playtests/npc-actor-gate-a-20260926T065355Z') },
  { table: 'npc-actor-gate-a2', dir: join(NPC_ACTOR_WORKTREE, '.coc/playtests/npc-actor-gate-a2-20260926T070927Z') },
];
const MODULE = 'the-haunting';
const PREGEN = 'thomas-hayes';
const PLAY_LANGUAGE = 'zh-Hans';
const CAMPAIGN = 'c1';
const KNOTT_NAME = 'Steven Knott';
const OPENING_TEXT = '开场。\n\n诺特把钥匙拍在桌上。'; // tests/kernel/conftest.py's narrate_opening default: the same starter scene both retained tables begin from.
const LAST_TURN = 8;
const SKIP_TOOL_NAMES = new Set(['look', 'lookup', 'recall', 'ask', 'narrate']);
const KNOTT_ACT_FIELDS = ['intends', 'outcome', 'stance', 'to', 'action'];
const NPC_ACT_MODEL = 'opencode-go/deepseek-v4.1-flash';
const JUDGE_MODEL_PROVIDER = 'opencode-go';
const JUDGE_MODEL_ID = 'deepseek-v4.1-flash';

function args() {
  const argv = process.argv.slice(2);
  const out = { rounds: 3, seed: '20260926', out: undefined, table: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rounds') out.rounds = Number(argv[++i]);
    else if (argv[i] === '--seed') out.seed = String(argv[++i]);
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--table') out.table = argv[++i];
  }
  return out;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

// --------------------------------------------------------------------------------------------------
// Credentials: a throwaway agent home copied from the App's real one. Never printed, never committed.
// --------------------------------------------------------------------------------------------------

function prepareAgentHome() {
  const home = mkdtempSync(join(tmpdir(), 'npc-act-probe-agent-'));
  for (const name of ['auth.json', 'models.json', 'models-store.json']) {
    const source = join(APP_AGENT_HOME, name);
    if (existsSync(source)) writeFileSync(join(home, name), readFileSync(source));
  }
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ quietStartup: true }) + '\n');
  return home;
}

async function readJevKey() {
  const { readVaultSecret } = await import(join(REPO, 'experiments/single-loop-routing/vault.mjs'));
  const key = await readVaultSecret('EXT_JEV_APIKEY');
  if (!key) throw new Error('no EXT_JEV_APIKEY in the App vault (~/Library/Application Support/Pipi/pipicoc/pi-coc/agent/secret-vault.json)');
  return key;
}

// --------------------------------------------------------------------------------------------------
// Kernel: a direct JSON-RPC line client to the same emitted kernel tests/kernel/conftest.py's
// RpcClient drives (build/kernel/rpc.mjs), so the replay travels the real kernel, not a hand-built one.
// --------------------------------------------------------------------------------------------------

class KernelClient {
  constructor(workspace, env = {}) {
    this.proc = spawn(process.execPath, [join(REPO, 'build/kernel/rpc.mjs'), '--workspace', workspace, '--content', join(REPO, 'content')],
      { cwd: REPO, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.buf = '';
    this.pending = [];
    this.stderr = '';
    this.proc.stderr.on('data', chunk => { this.stderr += chunk.toString('utf8'); });
    this.proc.stdout.on('data', chunk => {
      this.buf += chunk.toString('utf8');
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx); this.buf = this.buf.slice(idx + 1);
        if (!line.trim()) continue;
        const resolve = this.pending.shift();
        try { resolve?.(JSON.parse(line)); } catch (error) { resolve?.({ ok: false, error: { code: 'bad_json_line', message: String(error), line } }); }
      }
    });
    this.n = 0;
  }
  call(method, params = {}) {
    return new Promise(resolve => {
      this.pending.push(resolve);
      this.proc.stdin.write(JSON.stringify({ id: `r${++this.n}`, method, params }) + '\n');
    });
  }
  /** `table.<method> {campaign: CAMPAIGN, ...params}` -- the shape every replayed and probe call uses. */
  async ok(method, params) {
    const response = await this.call(`table.${method}`, { campaign: CAMPAIGN, ...params });
    if (!response.ok) { const error = new Error(`table.${method} refused: ${response.error?.code} ${response.error?.message ?? ''}`); error.code = response.error?.code; error.detail = response.error; throw error; }
    return response.result;
  }
  /** Top-level method (not under `table.`), e.g. `campaign.create`, `npc.stakes`. */
  async okTop(method, params) {
    const response = await this.call(method, params);
    if (!response.ok) { const error = new Error(`${method} refused: ${response.error?.code} ${response.error?.message ?? ''}`); error.code = response.error?.code; error.detail = response.error; throw error; }
    return response.result;
  }
  close() {
    try { this.proc.stdin.end(); } catch { /* already closed */ }
    try { this.proc.kill(); } catch { /* already gone */ }
  }
}

// --------------------------------------------------------------------------------------------------
// The retained tables: turn-N.json, 1..8, read-only.
// --------------------------------------------------------------------------------------------------

export function loadTable(dir) {
  const turns = [];
  for (let n = 1; n <= LAST_TURN; n++) {
    const path = join(dir, `turn-${n}.json`);
    if (!existsSync(path)) break;
    turns.push(JSON.parse(readFileSync(path, 'utf8')));
  }
  return turns;
}

function isKnottName(value) {
  return typeof value === 'string' && /knott/i.test(value);
}

/** A recorded tool call that is Steven Knott's own act, not scene-setting (an archetype/disposition pin
 * names him too, but carries none of these fields): the probe is inserted before the first of these in a
 * turn's recorded calls, per the ticket's "before the recorded NPC-side calls". */
function looksLikeKnottAct(call) {
  if (call.name === 'resolve') return isKnottName(call.args?.action?.actor);
  if (call.name === 'apply') {
    const effects = Array.isArray(call.args?.effects) ? call.args.effects : [];
    return effects.some(effect => effect && effect.kind === 'npc' && isKnottName(effect.name) && KNOTT_ACT_FIELDS.some(key => Object.hasOwn(effect, key)));
  }
  return false;
}

// --------------------------------------------------------------------------------------------------
// The judge: `pi -p`, stdin closed, one question per call. Never prints or logs the auth home's contents.
// --------------------------------------------------------------------------------------------------

function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

async function runJudge(judgeHome, prompt) {
  const pi = join(REPO, 'node_modules', '.bin', 'pi');
  const began = Date.now();
  return new Promise(resolve => {
    const child = spawn(pi, ['-p', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-tools',
      '--approve', '--thinking', 'off', '--provider', JUDGE_MODEL_PROVIDER, '--model', JUDGE_MODEL_ID, prompt], {
      cwd: judgeHome,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PI_COC_|PIPIUI_|PI_CODING_AGENT_DIR)/.test(key))), PI_CODING_AGENT_DIR: judgeHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('close', code => {
      const ms = Date.now() - began;
      const json = extractJsonObject(stdout);
      if (!json) return resolve({ ok: false, ms, reason: 'no_json', code, stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 500) });
      try { resolve({ ok: true, ms, answer: JSON.parse(json) }); }
      catch (error) { resolve({ ok: false, ms, reason: 'parse_error', detail: String(error), stdout: stdout.slice(0, 500) }); }
    });
    child.on('error', error => resolve({ ok: false, ms: Date.now() - began, reason: 'spawn_error', detail: String(error) }));
  });
}

/** The packet, in plain words: code-composed sentences already given (`happened`), plus the other
 * sections read out as sentences. Not a summary of the act -- the act is appended separately. */
function renderSituation(packet, stakes) {
  const who = packet.who ?? {};
  const state = packet.state ?? {};
  const at = packet.at_hand ?? {};
  const lines = [];
  lines.push(`This is ${packet.npc?.name ?? 'the person'}.`);
  if (who.personality) lines.push(`Personality: ${asText(who.personality)}.`);
  if (who.goals) lines.push(`Goals: ${asText(who.goals)}.`);
  if (who.fears) lines.push(`Fears: ${asText(who.fears)}.`);
  if (who.commitments) lines.push(`Commitments: ${asText(who.commitments)}.`);
  if (who.relationships) lines.push(`Relationships: ${asText(who.relationships)}.`);
  if (packet.happened?.length) lines.push(`What just happened to them, this turn and last: ${packet.happened.join(' ')}`);
  lines.push(`Their state right now: hp ${state.hp ?? 'unknown'}/${state.hp_max ?? 'unknown'}, conditions [${(state.conditions ?? []).join(', ')}], `
    + `stance ${state.stance ?? 'unknown'}, in a running fight: ${state.in_session ? 'yes' : 'no'}, their own turn of it: ${state.my_turn ? 'yes' : 'no'}.`);
  if (packet.done?.length) lines.push(`What they have already set out to do (most recent first): `
    + packet.done.slice(0, 6).map(row => `"${row.intent}" (${row.status})`).join('; ') + '.');
  if (packet.recent_speech?.length) lines.push(`Their last own words: ${packet.recent_speech.join(' ')}`);
  lines.push(`At hand: holding [${(at.holdings ?? []).join(', ')}], nearby objects [${(at.objects ?? []).join(', ')}], `
    + `exits [${(at.exits ?? []).join(', ')}], present with them [${(at.present ?? []).join(', ')}].`);
  if (packet.constraints?.length) lines.push(`What the book or the table has already fixed about them: ${packet.constraints.join(' ')}`);
  if (stakes?.stakes?.line) lines.push(`How far this moment lets them go (never told to them): ${stakes.stakes.line}`);
  return lines.join('\n');
}

function asText(value) {
  if (Array.isArray(value)) return value.map(asText).join('; ');
  if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}: ${asText(v)}`).join(', ');
  return String(value ?? '');
}

function plausibilityPrompt(packet, stakes, act) {
  return `Here is one person's situation in a tabletop game, in plain words:\n\n${renderSituation(packet, stakes)}\n\n`
    + `They just did this: "${act}"\n\n`
    + `Question: would a person in this situation plausibly do this right now? Answer with exactly one JSON object and nothing else: `
    + `{"yes": true or false, "why": "<one short sentence>"}.`;
}

function sameActPrompt(priorActs, act) {
  // Keyed by the turn number itself (not a 1-based position): a position number invites the model to answer
  // with the turn number printed inside the matching line instead of the line's own ordinal, which is exactly
  // what happened in this ticket's first run (round 1, table A, turn 8 answered "7", the turn named inside the
  // matching entry's text, not "3", that entry's position). Asking for the turn number directly removes the
  // ambiguity instead of trying to guess which one a free-form answer meant.
  const list = priorActs.map(row => `turn ${row.turn}: "${row.act}"`).join('\n');
  return `Here is what one person already did on earlier turns of the same session, in order:\n\n${list}\n\n`
    + `On a later turn they did this: "${act}"\n\n`
    + `Question: is this the same act as one of the earlier ones (repeating the same thing, whatever the words), or is it new/different? `
    + `Answer with exactly one JSON object and nothing else: {"same_turn": <the turn number of the earliest matching entry above, or null if it is new>, "why": "<one short sentence>"}.`;
}

// --------------------------------------------------------------------------------------------------
// The probe: stakes -> situation -> generate -> bind. Read-only and Jev-only; no write reaches the kernel.
// --------------------------------------------------------------------------------------------------

async function runProbe({ kernel, lane, decisionAdapter, TaskLease, npcActBatch, interpretNpcAct, npcProduceBatch, producePart, npcActBudgetValue, gate, campaign, round, turn, table }) {
  const record = { kind: 'probe', table, round, turn, campaign };
  let stakes = null;
  try { stakes = await kernel.okTop('npc.stakes', { campaign, name: KNOTT_NAME }); }
  catch (error) { record.stakes_error = String(error.message ?? error); }
  record.stakes = stakes;
  let packet;
  try { packet = await kernel.okTop('npc.situation', { campaign, name: KNOTT_NAME }); }
  catch (error) { return { ...record, status: 'failed', reason: `situation_failed: ${error.message ?? error}` }; }
  record.packet_digest = createHash('sha256').update(JSON.stringify(packet)).digest('hex').slice(0, 16);
  record.packet = packet;
  const genBegan = Date.now();
  const generated = await lane.generate({ packet, play_language: PLAY_LANGUAGE }, new AbortController().signal);
  record.generation_ms = Date.now() - genBegan;
  record.generation_model = generated.model ?? null;
  if (!('act' in generated)) return { ...record, status: 'unavailable', reason: generated.unavailable, detail: generated.detail ?? null };
  const act = generated.act;
  record.act = act;
  // §139.19: the lane takes `produces` only on a surprise (and drops it, saying so, otherwise).
  record.surprise = stakes?.stakes?.surprise === true;
  const produces = typeof generated.produces === 'string' ? generated.produces : null;
  record.produces = produces;
  record.produces_dropped = generated.producesDropped === true;
  let options;
  try { options = await kernel.okTop('npc.act.options', { campaign, name: KNOTT_NAME, act, ...(produces ? { produce: true } : {}) }); }
  catch (error) { return { ...record, status: 'failed', reason: `options_failed: ${error.message ?? error}` }; }
  const rows = options.act?.continues ? [] : (Array.isArray(packet.done) ? packet.done.filter(row => row?.ref).slice(0, npcActBudgetValue.sameActRows) : []);
  const scope = { owner: 'npc-act-probe', campaign, audience: 'system' };
  const readSet = [{ kind: 'world', resource: campaign, revision: `probe-r${round}-t${turn}` }];
  const bindBegan = Date.now();
  const person = options.npc?.name ?? KNOTT_NAME, runId = `npc-act-probe-r${round}-${table}`;
  const { batch, plan } = npcActBatch({ runId, person, act, packet, options, rows, produces }, scope, readSet);
  const decide = async (asked, goal) => {
    const lease = new TaskLease({
      owner: 'npc-act-probe', goal, scope, capabilities: ['decision'], readSet,
      signal: new AbortController().signal,
      budget: { deadlineAt: Date.now() + 15000, remainingInputTokens: 400000, remainingOutputTokens: 40000, remainingCostUsd: 2, remainingActions: 60 },
    });
    try { return await decisionAdapter.decide(asked, lease); } finally { lease.close(); }
  };
  const decision = await decide(batch, `probe bind turn ${turn}`);
  // §139.19: a price list too long for one question was asked by its part; the record within it is a second batch.
  let follow;
  const part = produces ? producePart(plan, decision, gate) : null;
  if (part) {
    const second = npcProduceBatch({ runId, person, act, produces, part: part.part, records: part.records }, scope, readSet);
    follow = { records: second.records, result: await decide(second.batch, `probe produce turn ${turn}`) };
    record.produce_part = part.part;
  }
  record.bind_ms = Date.now() - bindBegan;
  const bound = interpretNpcAct(plan, decision, gate, follow);
  record.produced = bound.produced ? { name: bound.produced.name, source: bound.produced.source, ...(bound.produced.record ? { record: bound.produced.record.value } : {}) } : null;
  record.way = bound.way;
  record.params = Object.fromEntries(Object.entries(bound.params).map(([key, option]) => [key, option.value]));
  record.bind_reason = bound.reason;
  record.jev_status = decision?.status ?? 'unavailable';
  record.continues = options.act?.continues ?? null;
  return { ...record, status: 'bound' };
}

// --------------------------------------------------------------------------------------------------
// Replay: one turn.
// --------------------------------------------------------------------------------------------------

async function replayTurn(ctx, turnRecord) {
  const { kernel, campaign, round, table } = ctx;
  const turn = turnRecord.turn;
  const rows = [];
  await kernel.ok('player_input', { text: turnRecord.player_text });
  let probed = false;
  let callCounter = 0; // the kernel requires call_id to look like t<turn>-c<n>; n only needs to be unique per turn.
  const nextCallId = () => `t${turn}-c${++callCounter}`;
  for (const [index, call] of (turnRecord.tools ?? []).entries()) {
    if (SKIP_TOOL_NAMES.has(call.name)) continue;
    if (call.is_error) continue; // the recording's own failed attempt: no state to reproduce.
    if (!probed && looksLikeKnottAct(call)) {
      rows.push(await runProbe({ ...ctx, turn }));
      probed = true;
    }
    try {
      if (call.name === 'resolve') await kernel.ok('resolve', { call_id: nextCallId(), action: call.args.action });
      else if (call.name === 'apply') await kernel.ok('apply', { call_id: nextCallId(), effects: call.args.effects });
      else continue;
    } catch (error) {
      rows.push({ kind: 'refusal', table, round, turn, index, tool: call.name, code: error.code ?? null, message: String(error.message ?? error) });
    }
  }
  if (!probed) {
    try {
      const options = await kernel.okTop('npc.act.options', { campaign, name: KNOTT_NAME });
      if (options.my_turn || (Array.isArray(options.acted_on) && options.acted_on.length)) {
        rows.push(await runProbe({ ...ctx, turn }));
        probed = true;
      } else {
        rows.push({ kind: 'turn', table, round, turn, probed: false, reason: 'not_acted_on', acted_on: options.acted_on ?? [] });
      }
    } catch (error) {
      rows.push({ kind: 'turn', table, round, turn, probed: false, reason: `options_check_failed: ${error.message ?? error}` });
    }
  }
  await kernel.ok('narrate', { call_id: nextCallId(), text: turnRecord.final_text });
  return rows;
}

// --------------------------------------------------------------------------------------------------
// Main.
// --------------------------------------------------------------------------------------------------

async function main() {
  const { rounds, seed, out, table: only } = args();
  const ts = timestamp();
  const outDir = out ?? join(REPO, '.coc', 'playtests', `npc-act-probe-${ts}`);
  mkdirSync(outDir, { recursive: true });
  console.log(`npc-act-probe: ${rounds} rounds, seed ${seed}, output ${outDir}`);

  process.env.PI_COC_NPC_ACT_MODEL = NPC_ACT_MODEL;
  process.env.PI_COC_JEV_PRESELECT = '1';
  process.env.EXT_JEV_APIKEY = await readJevKey();
  const agentHome = prepareAgentHome();
  const cleanupPaths = [agentHome];

  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } =
    await import(join(REPO, 'build/node_modules/@earendil-works/pi-coding-agent/dist/index.js'));
  const { createNpcActLane } = await import(join(REPO, 'runtime/jev/npc-act.ts'));
  const { npcActBatch, interpretNpcAct, npcProduceBatch, producePart } = await import(join(REPO, 'runtime/jev/npc-act-step.ts'));
  const { createDecisionAdapter } = await import(join(REPO, 'runtime/jev/decision-adapter.ts'));
  const { TaskLease } = await import(join(REPO, 'runtime/jev/task-context.ts'));
  const { npcActBudget } = await import(join(REPO, 'runtime/jev/host-budgets.ts'));
  const { DEFAULT_CONFIDENCE_GATE } = await import(join(REPO, 'runtime/jev/step-policy.ts'));

  const sessionCwd = mkdtempSync(join(tmpdir(), 'npc-act-probe-session-'));
  cleanupPaths.push(sessionCwd);
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentHome, 'auth.json'), modelsPath: null, modelsStorePath: join(agentHome, 'models-store.json'), refreshOnCreate: false,
  });
  const [modelProvider, modelId] = NPC_ACT_MODEL.split('/');
  const model = modelRuntime.getModel(modelProvider, modelId);
  if (!model) throw new Error(`the model ${NPC_ACT_MODEL} did not resolve from the copied agent home`);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const sessionManager = SessionManager.inMemory();
  let sessionCtx, api;
  const resourceLoader = new DefaultResourceLoader({
    cwd: sessionCwd, agentDir: join(sessionCwd, 'agent'), settingsManager, noExtensions: true, noSkills: true, noContextFiles: true,
    extensionFactories: [{ name: 'npc-act-probe-context', factory(pi) { api = pi; pi.on('session_start', (_event, ctx) => { sessionCtx = ctx; }); } }],
  });
  await resourceLoader.reload();
  const created = await createAgentSession({
    cwd: sessionCwd, agentDir: join(sessionCwd, 'agent'), model, modelRuntime, thinkingLevel: 'off', noTools: 'builtin',
    resourceLoader, sessionManager, settingsManager,
  });
  await created.session.bindExtensions({ mode: 'print' });
  let currentCampaignLabel = 'npc-act-probe';
  const lane = createNpcActLane(api, { ctx: () => sessionCtx, campaign: () => currentCampaignLabel });
  const decisionAdapter = createDecisionAdapter({ env: process.env, maxConcurrency: 4 });
  const npcActBudgetValue = await npcActBudget();

  const judgeHome = mkdtempSync(join(tmpdir(), 'npc-act-probe-judge-'));
  cleanupPaths.push(judgeHome);
  for (const name of ['auth.json', 'models.json']) symlinkSync(join(agentHome, name), join(judgeHome, name));
  writeFileSync(join(judgeHome, 'settings.json'), JSON.stringify({ quietStartup: true }) + '\n');

  const tables = RETAINED_TABLES.filter(entry => !only || entry.table === only).map(entry => ({ ...entry, turns: loadTable(entry.dir) }));
  if (!tables.length) throw new Error(`no retained table named ${only}`);
  for (const entry of tables) if (entry.turns.length === 0) throw new Error(`no turn-*.json under ${entry.dir}`);

  const kernelWorkspaces = [];
  const allRecords = []; // {round, table, ...row}
  const allJudge = []; // {round, table, turn, kind: 'plausibility'|'same_act', ...}

  try {
    for (let round = 1; round <= rounds; round++) {
      const roundDir = join(outDir, `round-${round}`);
      mkdirSync(roundDir, { recursive: true });
      const recordsPath = join(roundDir, 'records.jsonl');
      const judgePath = join(roundDir, 'judge.jsonl');
      const recordLines = [];
      const judgeLines = [];

      for (const entry of tables) {
        currentCampaignLabel = `probe-r${round}-${entry.table}`;
        const workspace = mkdtempSync(join(tmpdir(), `npc-act-probe-ws-${entry.table}-r${round}-`));
        kernelWorkspaces.push(workspace);
        const kernel = new KernelClient(workspace, { COC_KERNEL_SEED: seed });
        try {
          await kernel.okTop('campaign.create', { id: CAMPAIGN, module: MODULE, pregen: PREGEN, play_language: PLAY_LANGUAGE });
          await kernel.ok('narrate', { call_id: 't0-c1', text: OPENING_TEXT });
          const ctx = {
            kernel, lane, decisionAdapter, TaskLease, npcActBatch, interpretNpcAct, npcProduceBatch, producePart, npcActBudgetValue,
            gate: DEFAULT_CONFIDENCE_GATE, campaign: CAMPAIGN, round, table: entry.table,
          };
          const priorActs = [];
          for (const turnRecord of entry.turns) {
            let rows;
            try { rows = await replayTurn(ctx, turnRecord); }
            catch (error) {
              rows = [{ kind: 'turn', table: entry.table, round, turn: turnRecord.turn, error: `replay_failed: ${error.message ?? error}` }];
            }
            for (const row of rows) {
              recordLines.push(JSON.stringify(row));
              allRecords.push(row);
              if (row.kind === 'probe' && row.act) {
                const plaus = await runJudge(judgeHome, plausibilityPrompt(row.packet, row.stakes, row.act));
                const plausRow = { table: entry.table, round, turn: row.turn, kind: 'plausibility', act: row.act, ...plaus };
                judgeLines.push(JSON.stringify(plausRow)); allJudge.push(plausRow);
                let sameRow;
                if (priorActs.length) {
                  const same = await runJudge(judgeHome, sameActPrompt(priorActs, row.act));
                  sameRow = { table: entry.table, round, turn: row.turn, kind: 'same_act', act: row.act, prior: priorActs.map(p => p.turn), ...same };
                } else {
                  sameRow = { table: entry.table, round, turn: row.turn, kind: 'same_act', act: row.act, prior: [], ok: true, answer: { same_turn: null, why: 'no earlier act this round' } };
                }
                judgeLines.push(JSON.stringify(sameRow)); allJudge.push(sameRow);
                priorActs.push({ turn: row.turn, act: row.act });
              }
            }
          }
        } finally {
          kernel.close();
        }
        console.log(`round ${round} / ${entry.table}: done`);
      }
      writeFileSync(recordsPath, recordLines.join('\n') + (recordLines.length ? '\n' : ''));
      writeFileSync(judgePath, judgeLines.join('\n') + (judgeLines.length ? '\n' : ''));
    }
  } finally {
    for (const workspace of kernelWorkspaces) { try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort */ } }
    const runner = created.session._extensionRunner;
    try { if (runner?.hasHandlers?.('session_shutdown')) await runner.emit({ type: 'session_shutdown', reason: 'quit' }); } catch { /* best effort */ }
    try { created.session.dispose(); } catch { /* best effort */ }
    for (const path of cleanupPaths) { try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  writeSummary(outDir, { rounds, seed, tables, allRecords, allJudge });
  console.log(`\nDone. Results in ${outDir}`);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function firstLineOf(text, limit = 120) {
  if (!text) return '';
  const cut = text.search(/[。！？\n]/);
  const line = cut >= 0 ? text.slice(0, cut + 1) : text;
  return line.length > limit ? line.slice(0, limit) + '…' : line;
}

export function writeSummary(outDir, { rounds, seed, tables, allRecords, allJudge }) {
  const probes = allRecords.filter(row => row.kind === 'probe');
  const bound = probes.filter(row => row.status === 'bound');
  const unavailable = probes.filter(row => row.status === 'unavailable');
  const failed = probes.filter(row => row.status === 'failed');
  const refusals = allRecords.filter(row => row.kind === 'refusal');
  const notActedOn = allRecords.filter(row => row.kind === 'turn' && row.probed === false);

  const plausRows = allJudge.filter(row => row.kind === 'plausibility');
  const plausAnswered = plausRows.filter(row => row.ok);
  const yesCount = plausAnswered.filter(row => row.answer?.yes === true).length;
  const yesRate = plausAnswered.length ? yesCount / plausAnswered.length : null;

  const sameRows = allJudge.filter(row => row.kind === 'same_act');
  const sameCount = sameRows.filter(row => row.answer?.same_turn !== null && row.answer?.same_turn !== undefined).length;

  const genMsByRound = new Map(), bindMsByRound = new Map();
  for (const row of probes) {
    if (typeof row.generation_ms === 'number') (genMsByRound.get(row.round) ?? genMsByRound.set(row.round, []).get(row.round)).push(row.generation_ms);
    if (typeof row.bind_ms === 'number') (bindMsByRound.get(row.round) ?? bindMsByRound.set(row.round, []).get(row.round)).push(row.bind_ms);
  }
  const intentionOnlyShare = bound.length ? bound.filter(row => row.way === 'intention_only').length / bound.length : null;

  const sameByTable = new Map();
  for (const row of sameRows) {
    const key = `${row.table}/round-${row.round}`;
    const list = sameByTable.get(key) ?? sameByTable.set(key, []).get(key);
    if (row.answer?.same_turn !== null && row.answer?.same_turn !== undefined) list.push(row);
  }

  const lines = [];
  lines.push('# npc-act-probe summary');
  lines.push('');
  // §139.19 (ticket 20): report only -- how often a surprise turn's act brings something out, and what.
  const surprised = probes.filter(row => row.surprise === true);
  const producing = surprised.filter(row => row.produces);
  lines.push('## Surprise turns (ticket 20, report only)');
  lines.push('');
  lines.push(`- turns whose stakes die allowed a surprise: ${surprised.length} of ${probes.length} probed; \`produces\` on ${producing.length} of them`
    + (surprised.length ? ` (${(producing.length / surprised.length * 100).toFixed(0)}%)` : '') + `; dropped without a surprise: ${probes.filter(row => row.produces_dropped).length}.`);
  for (const row of producing)
    lines.push(`- ${row.table} r${row.round} t${row.turn}: produces "${row.produces}" -> ${row.produced ? `${row.produced.source}${row.produced.record ? ` ${row.produced.record}` : ''} "${row.produced.name}"` : 'not bound'}`
      + `${row.produce_part ? ` (part ${row.produce_part})` : ''}; way ${row.way ?? '-'}; act: ${row.act}`);
  lines.push('');
  lines.push(`Rounds: ${rounds}. Kernel seed (fixed across rounds): ${seed}. Model: ${NPC_ACT_MODEL}. Judge model: ${JUDGE_MODEL_PROVIDER}/${JUDGE_MODEL_ID}.`);
  lines.push('');
  lines.push('## Pass lines');
  lines.push('');
  lines.push(`- yes rate (plausibility, pooled over all ${rounds} rounds): ${yesRate === null ? 'n/a' : (yesRate * 100).toFixed(1) + '%'} `
    + `(${yesCount}/${plausAnswered.length} answered; ${plausRows.length - plausAnswered.length} judge calls did not answer) -- pass line yes >= 90%.`);
  lines.push(`- same-act count (per round, per table -- see breakdown below; pass line = 0 per table): ${sameCount} total across all rounds/tables.`);
  lines.push('');
  lines.push('**Scope note on "same-act per table":** the ticket asks for this as a `pi -p` judge question ("is this the same act as any earlier '
    + 'act of the same person in this table"). Each round is an independent replay (a fresh generation sample over the same mechanically-replayed '
    + 'situations), so this probe compares acts only within one round\'s own turn order for a table, not pooled across the three rounds. If the '
    + 'lead intended pooling across rounds, the per-row judge answers in each round\'s `judge.jsonl` (`kind: "same_act"`) are already there to re-pool.');
  lines.push('');
  lines.push('**Why same-act misses here may not indict the instruction file.** Ticket 07 deliberately never executes the bound act into the '
    + 'replayed campaign (spec: "recording the bind is enough"). That means the kernel\'s own ledger (`npc.situation`\'s `done`, `happened`) never '
    + 'carries a generated act from an earlier probed turn forward into a later turn\'s packet within this probe -- only whatever the *original* '
    + 'recording\'s own `apply`/`resolve` calls put there survives the replay. Contract §139.5\'s real no-repeat mechanism (the "already tried X, give '
    + 'it a result or do something else" re-ask, and `content/setup/npc-act.md`\'s "already tried with no result is not done the same way again") '
    + 'depends on that ledger carrying the prior act -- which only happens when the bind is actually executed, in real play. So this probe structurally '
    + 'cannot exercise that mechanism, and a same-act repeat measured here is at least partly an artifact of the probe\'s own non-execution design, not '
    + 'necessarily evidence the generator repeats itself when the real ledger feedback is present. It is still a real signal worth reading (see the '
    + '`why` text on each same-act row below): several repeats are a person continuing the *same* flee-and-call-for-help strategy across consecutive '
    + 'turns of an unbroken chase/beating, phrased differently each time -- which is what the no-repeat gate exists to catch and give a result to, '
    + 'and this probe cannot show whether the real gate would have done that. This is the honest limit of an offline, non-executing probe on this '
    + 'particular pass line; live table 08 (with the bind actually executed) is where the no-repeat mechanism gets a real test.');
  lines.push('');
  lines.push('### Same-act by table/round');
  lines.push('');
  for (const [key, list] of sameByTable) lines.push(`- ${key}: ${list.length} row(s) judged the same as an earlier act`
    + (list.length ? ': ' + list.map(row => `turn ${row.turn} = turn ${row.answer.same_turn}`).join(', ') : ''));
  if (!sameByTable.size) lines.push('- (no table/round had more than one generated act, or none matched)');
  lines.push('');
  lines.push('## Generation and bind counts');
  lines.push('');
  lines.push(`- probe attempts: ${probes.length}. bound: ${bound.length}. unavailable: ${unavailable.length}. failed: ${failed.length}.`);
  lines.push(`- intention_only share of bound acts: ${intentionOnlyShare === null ? 'n/a' : (intentionOnlyShare * 100).toFixed(1) + '%'}.`);
  lines.push(`- turns skipped as not-acted-on (no probe run): ${notActedOn.length}.`);
  lines.push(`- kernel refusals during replay (recorded call the current kernel would not take): ${refusals.length}.`);
  if (unavailable.length) lines.push(`- unavailable reasons: ${JSON.stringify(Object.fromEntries(count(unavailable.map(r => r.reason))))}`);
  if (failed.length) lines.push(`- failed reasons: ${JSON.stringify(Object.fromEntries(count(failed.map(r => r.reason))))}`);
  lines.push('');
  lines.push('## Timing per round (ms)');
  lines.push('');
  lines.push('| round | generation ms (median) | generation ms (max) | bind ms (median) | bind ms (max) |');
  lines.push('|---|---|---|---|---|');
  for (let round = 1; round <= rounds; round++) {
    const gen = genMsByRound.get(round) ?? [], bindMs = bindMsByRound.get(round) ?? [];
    lines.push(`| ${round} | ${median(gen)?.toFixed(0) ?? 'n/a'} | ${gen.length ? Math.max(...gen) : 'n/a'} | ${median(bindMs)?.toFixed(0) ?? 'n/a'} | ${bindMs.length ? Math.max(...bindMs) : 'n/a'} |`);
  }
  lines.push('');
  if (refusals.length) {
    lines.push('## Kernel refusals during replay');
    lines.push('');
    for (const row of refusals.slice(0, 40)) lines.push(`- ${row.table} round ${row.round} turn ${row.turn} call#${row.index} (${row.tool}): ${row.code ?? ''} ${row.message ?? ''}`);
    if (refusals.length > 40) lines.push(`- ... and ${refusals.length - 40} more (see round-*/records.jsonl, kind: "refusal")`);
    lines.push('');
  }
  lines.push('## Turn-by-turn: recorded Knott act (original table, first line of its prose) vs. generated act');
  lines.push('');
  lines.push('One line per table per round per turn where a probe ran. The "recorded" column is the first sentence of that turn\'s original '
    + '`final_text` (raw prose excerpt, not an editorial summary) so the lead can read them side by side.');
  lines.push('');
  lines.push('| table | round | turn | recorded (original table, first line) | generated act | way | yes |');
  lines.push('|---|---|---|---|---|---|---|');
  const finalTextByTableTurn = new Map();
  for (const entry of tables) for (const turnRecord of entry.turns) finalTextByTableTurn.set(`${entry.table}/${turnRecord.turn}`, turnRecord.final_text);
  for (const row of bound.concat(unavailable).sort((a, b) => a.table.localeCompare(b.table) || a.round - b.round || a.turn - b.turn)) {
    const recordedLine = firstLineOf(finalTextByTableTurn.get(`${row.table}/${row.turn}`));
    const plaus = plausRows.find(p => p.table === row.table && p.round === row.round && p.turn === row.turn);
    const yes = plaus?.ok ? (plaus.answer?.yes ? 'yes' : 'no') : 'n/a';
    lines.push(`| ${row.table} | ${row.round} | ${row.turn} | ${recordedLine.replace(/\|/g, '\\|')} | ${(row.act ?? '(none)').replace(/\|/g, '\\|')} | ${row.way ?? row.status} | ${yes} |`);
  }
  writeFileSync(join(outDir, 'summary.md'), lines.join('\n') + '\n');
}

function count(values) {
  const map = new Map();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}

// Only run the probe when this file is executed directly (`node tests/play/npc-act-probe.mjs ...`), never when
// another script imports its helpers (`loadTable`, `writeSummary`, `RETAINED_TABLES`) to rebuild a report offline.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
}
