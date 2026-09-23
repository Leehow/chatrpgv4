/**
 * One replay run of a fixture turn against the PRODUCT driver (SL-02 acceptance): a real Pi session on the
 * vendored build with `PI_COC_LOOP_ENGINE=hybrid-v1`, the product's hybrid engine (step policy, read step with
 * the product prescreen, host-issued candidates, Jev decisions, clerk writes through the kernel extension's
 * canonical gateway), the real kernel extension and the emitted kernel on a disposable copy of the fixture, and
 * real Jev (key from the App's vault). This is not the prototype's `runTurn`.
 *
 * No language model is called. The Keeper's provider is a replay: each model step answers with the live
 * Keeper's next recorded message, minus the calls the run already carried out; a bind step answers with the live
 * call that binds the chosen operation; the compose answers with the live turn's accepted delivery (its recorded
 * `ask`, or the delivered narration read from the fixture's own turn record). A recorded call the live kernel
 * refused is not replayed. The action-admission lane (§32) is a replay too: it answers each review with the live
 * table's recorded verdict for the same verb, in order. Jev is live.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fauxAssistantMessage, fauxProvider, fauxToolCall} from '@earendil-works/pi-ai';
import {createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager} from '../../build/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import {materialize, readFixture, removeTree} from './fixture.mjs';
import {readVaultSecret} from './vault.mjs';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

type Row = Record<string, any>;
const REPO = join(import.meta.dirname, '../..');
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];

function setEnv(values: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return () => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}

const effectKey = (effect: Row): string | undefined => effect.kind === 'move' ? `apply:move:${effect.to}` : effect.kind === 'person' ? `apply:person:${effect.who}`
  : effect.kind === 'clue' ? `apply:clue:${effect.clue}` : effect.kind === 'handout' ? `apply:handout:${effect.name}` : undefined;
/**
 * A resolve's structural identity: the decision (or skill) and who it is against, the way the replay compares them.
 * A defence is identified by who defends (`actor`): the kernel resolves it against the pending attack and reads no
 * `target` on it (SL-07: the clerk's defence carries none, the live Keeper's carried the attacker).
 */
const who = (value: unknown): string => String(value ?? '').toLowerCase().replace(/\s+/g, '-');
const resolveKey = (action: Row): string => action.decision === 'combat:defend' ? `resolve:combat:defend:${who(action.actor)}`
  : `resolve:${action.decision ?? `skill:${action.skill ?? ''}`}:${who(action.target)}`;

/** The live calls in order, each with whether the live kernel took it (paired with the live tool rows by order). */
function liveCalls(baseline: Row): Array<{message: number; name: string; arguments: Row; ok: boolean}> {
  const tools = array(baseline.tools).filter(row => ['apply', 'resolve', 'narrate', 'ask'].includes(row.tool));
  const out: Array<{message: number; name: string; arguments: Row; ok: boolean}> = [];
  let cursor = 0;
  for (const [message, call] of array(baseline.calls).entries()) for (const toolCall of array(call.tool_calls)) {
    const row = ['apply', 'resolve', 'narrate', 'ask'].includes(toolCall.name) ? tools[cursor++] : undefined;
    out.push({message, name: toolCall.name, arguments: object(toolCall.arguments), ok: row ? row.ok !== false : true});
  }
  return out;
}

interface ReplayState {purpose?: string; done: Set<string>; messages: number[]; cursor: number; executed: Row[]}

/** The text of every message the provider was sent (custom messages reach it converted, so the text is what is read). */
const messageTexts = (context: Row): string[] => array(context.messages).map(message => typeof message.content === 'string' ? message.content
  : array(message.content).map((block: Row) => typeof block.text === 'string' ? block.text : '').join(''));
/** The run's latest note to the Keeper (`coc-clerk`), read back from what the provider received. */
function latestNote(context: Row): Row {
  for (const body of messageTexts(context).reverse()) {
    const start = body.indexOf('{"kind":"single_loop_step"');
    if (start < 0) continue;
    try { return JSON.parse(body.slice(start, body.lastIndexOf('}') + 1)); } catch { /* not this one */ }
  }
  return {};
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

/**
 * The Keeper's provider as a replay of the live Keeper. With `latency` (SL-10, `--latency live`) each answer waits the
 * live provider time of the recorded message it replays, so the run's time budget meets the live table's clock.
 */
function keeperReplay(baseline: Row, delivered: string | undefined, state: ReplayState, log: (row: Row) => void, latency = false) {
  const calls = liveCalls(baseline);
  const providerMs = (message: number | undefined): number => latency && message !== undefined ? Number(array(baseline.calls)[message]?.provider_ms ?? 0) : 0;
  const byMessage = new Map<number, typeof calls>();
  for (const call of calls) byMessage.set(call.message, [...(byMessage.get(call.message) ?? []), call]);
  const toolMessages = [...byMessage.keys()].sort((a, b) => a - b);
  /** What the run already carried out: every Keeper verb that succeeded this run, whoever called it (probe rows). */
  const doneFrom = (_context: Row): Set<string> => {
    const done = new Set(state.done);
    for (const call of state.executed) {
      if (!call.ok) continue;
      if (call.tool === 'apply') for (const effect of array(object(call.input).effects)) { const key = effectKey(object(effect)); if (key) done.add(key); }
      if (call.tool === 'resolve') done.add(resolveKey(object(object(call.input).action)));
    }
    return done;
  };
  const answer = async (items: Array<{name: string; arguments: Row}>, reason: string, message?: number): Promise<Row> => {
    const wait = providerMs(message);
    log({replay: reason, calls: items.map(item => item.name), ...(latency ? {provider_ms: wait} : {})});
    await sleep(wait);
    return fauxAssistantMessage(items.map(item => fauxToolCall(item.name, item.arguments)), {stopReason: 'toolUse'});
  };
  const remaining = (done: Set<string>, call: {name: string; arguments: Row; ok: boolean}): {name: string; arguments: Row} | undefined => {
    if (!call.ok) return undefined;
    if (call.name === 'apply') {
      const effects = array(call.arguments.effects).filter((effect: Row) => { const key = effectKey(effect); return !key || !done.has(key); });
      return effects.length ? {name: 'apply', arguments: {...call.arguments, effects}} : undefined;
    }
    if (call.name === 'resolve') return done.has(resolveKey(object(call.arguments.action))) ? undefined : call;
    return call;
  };
  const record = (item: {name: string; arguments: Row}) => {
    if (item.name === 'apply') for (const effect of array(item.arguments.effects)) { const key = effectKey(effect); if (key) state.done.add(key); }
    if (item.name === 'resolve') state.done.add(resolveKey(object(item.arguments.action)));
  };
  const delivery = async (): Promise<Row> => {
    const recorded = [...calls].reverse().find(call => (call.name === 'narrate' || call.name === 'ask') && call.ok);
    const last = array(baseline.calls).length - 1;
    // §11.5.1 (2026-09-23): a combat defence is no longer an ask -- the host settles the investigator's defence by
    // the campaign preference and refuses a defence ask as stale_choice. A recorded defence ask (every option a
    // §11.9 defence word) is replayed as the narrate of the same text, which is what the Keeper is told to send.
    const defenceAsk = recorded?.name === 'ask' && array(recorded.arguments.options).length > 0
      && array(recorded.arguments.options).every((option: unknown) => ['dodge', 'fight_back', 'none'].includes(String(option)));
    if (recorded && defenceAsk) return answer([{name: 'narrate', arguments: {text: String(recorded.arguments.text ?? delivered ?? '')}}], 'compose:recorded_defence_ask_as_narrate', recorded.message);
    if (recorded) return answer([recorded], 'compose:recorded_delivery', recorded.message);
    log({replay: 'compose:delivered_text'});
    await sleep(providerMs(last));
    return fauxAssistantMessage(delivered ?? '', {stopReason: 'stop'});
  };
  return async (context: Row): Promise<Row> => {
    // SL-10: a compose the run's time budget chose is the Keeper's close; the replay answers it with the delivery, not
    // with the live Keeper's remaining bookkeeping (which the budget left for the next turn).
    if (latestNote(context).reason === 'run_budget') return delivery();
    const done = doneFrom(context), purpose = state.purpose;
    if (purpose === 'bind') {
      // The operation the clerk chose, from the run's own note to the Keeper.
      const operation = object(latestNote(context).complete), bound = object(operation.bound);
      const key = operation.verb === 'apply' ? effectKey(bound) : resolveKey(bound);
      for (const call of calls) {
        if (!call.ok) continue;
        if (operation.verb === 'apply' && call.name === 'apply') {
          const effect = array(call.arguments.effects).find((value: Row) => effectKey(value) === key);
          if (effect && !done.has(key!)) { const item = {name: 'apply', arguments: {effects: [effect]}}; record(item); return answer([item], 'bind', call.message); }
        }
        // A resolve binds by its decision and who acts or is acted on (a defence names its actor, an attack its target).
        const action = object(call.arguments.action), norm = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, '-');
        if (operation.verb === 'resolve' && call.name === 'resolve' && action.decision === bound.decision
          && (norm(action.actor) === norm(bound.actor) && !!bound.actor || norm(action.target) === norm(bound.target) && !!bound.target)
          && !done.has(resolveKey(action))) { record(call); return answer([call], 'bind', call.message); }
      }
      log({replay: 'bind:not_recorded', key});
    }
    // An adjudication: the next recorded message, minus what the run already did. A compose, or nothing left: the delivery.
    while (state.cursor < toolMessages.length) {
      const index = toolMessages[state.cursor++];
      const items = byMessage.get(index)!.map(call => remaining(done, call)).filter((item): item is {name: string; arguments: Row} => !!item);
      const effects = items.filter(item => item.name !== 'narrate' && item.name !== 'ask');
      if (!effects.length) continue;
      for (const item of effects) record(item);
      state.messages.push(index);
      return answer(effects, `${purpose ?? 'infer'}:message_${index}`, index);
    }
    return delivery();
  };
}

/**
 * The admission lane as a replay of the live table's verdicts, per verb, in order. An `apply` review is paired with the
 * recorded review of the live batch whose effect kinds match the proposal's lines (SL-10: when the typed fast path
 * settles the clerk's move, the Keeper's later batch must not take the move's recorded verdict and time). With
 * `latency` (SL-10) each answer waits the live review's recorded time.
 */
function admissionReplay(baseline: Row, log: (row: Row) => void, latency = false) {
  const queue: Record<string, Row[]> = {apply: [], resolve: []};
  for (const row of array(baseline.admissions)) if (queue[row.verb]) queue[row.verb].push(row);
  // The live reviewed applies in order: those carrying a §32.1 triggering kind (admission.ts's TRIGGER_KINDS).
  const trigger = new Set(['move', 'clue', 'time', 'cash', 'item', 'handout', 'map', 'object', 'usage']);
  const reviewedKinds = liveCalls(baseline).filter(call => call.name === 'apply' && call.ok && array(call.arguments.effects).some((effect: Row) => trigger.has(effect.kind)))
    .map(call => [...new Set(array(call.arguments.effects).map((effect: Row) => String(effect.kind)))].sort().join('+'));
  queue.apply.forEach((row, index) => { row.kinds = reviewedKinds[index] ?? null; });
  return async (context: Row): Promise<Row> => {
    const request = JSON.stringify(context.messages ?? []);
    const verb = request.includes('resolve (roll the dice') ? 'resolve' : 'apply';
    // The proposal lines are the host's own machine lines ("- apply <kind>: ..."), so their kinds are read off them.
    const proposed = request.slice(request.lastIndexOf('[The Keeper now proposes]'));
    const kinds = [...new Set([...proposed.matchAll(/- apply ([a-z_]+):/g)].map(match => match[1]))].sort().join('+');
    const at = verb === 'apply' ? Math.max(0, queue.apply.findIndex(row => row.kinds === kinds)) : 0;
    const next = queue[verb].splice(at, 1)[0];
    log({admission_replay: verb, kinds: verb === 'apply' ? kinds : undefined, verdict: next?.verdict ?? null, live_ms: next?.ms ?? null});
    if (latency) await sleep(Number(next?.ms ?? 0));
    if (!next) return fauxAssistantMessage('no recorded verdict for this review');
    return fauxAssistantMessage(JSON.stringify({verdict: next.verdict, grounds: `replayed live verdict (${next.ms} ms live)`}));
  };
}

export interface ProductRunSummary {
  run: number; fixture: string; admission: string; arm: string; latency: boolean; wall_ms: number; status: string | null; reason: string | null; budget: Row | null;
  steps: Record<string, number>; llm_steps: number; llm_purposes: string[]; jev_calls: number; route_rows: number;
  calls: Row[]; match: Row[]; admissions: Row[]; clerk: Row[]; misses: Row[];
}

function matchBaseline(baseline: Row, calls: Row[]): Row[] {
  const ok = calls.filter(call => call.ok);
  const effects = ok.filter(call => call.tool === 'apply').flatMap(call => array(call.input.effects).map((effect: Row) => ({...effect, origin: call.origin})));
  const actions = ok.filter(call => call.tool === 'resolve').map(call => ({...object(call.input.action), origin: call.origin}));
  const deliveries = ok.filter(call => call.tool === 'narrate' || call.tool === 'ask');
  return array(baseline.actions).map((action: Row) => {
    const origin = (found: Row | undefined) => found ? {matched: true, origin: found.origin} : {matched: false};
    if (action.verb === 'apply') {
      if (action.kind === 'time') return {baseline: `time ${action.minutes}`, ...origin(effects.find(effect => effect.kind === 'time'))};
      const found = effects.find(effect => effect.kind === action.kind && [effect.to, effect.who, effect.clue, effect.name].includes(action.target));
      return {baseline: `${action.kind} ${action.target}`, ...origin(found)};
    }
    if (action.verb === 'resolve') {
      const target = String(action.target ?? '').toLowerCase().replace(/\s+/g, '-');
      // A defence answers the one pending attack: its `target` is not read by the kernel, so it matches by decision.
      const found = actions.find(value => (action.decision ? value.decision === action.decision : value.skill === action.skill)
        && (action.decision === 'combat:defend' || String(value.target ?? '').toLowerCase().replace(/\s+/g, '-') === target));
      return {baseline: `resolve ${action.decision ?? action.skill} vs ${action.target}`, ...origin(found),
        ...(found && action.decision === 'combat:defend' ? {defense: found.defense ?? null} : {})};
    }
    if (action.verb === 'narrate' || action.verb === 'ask') return {baseline: action.verb, ...origin(deliveries.at(-1) ?? (action.implicit ? {origin: 'implicit'} : undefined))};
    return {baseline: action.verb, matched: null};
  });
}

/**
 * SL-10 arms: `after` is the branch as it stands; `before` turns off what SL-10 added (the time budget set out of
 * reach, the bookkeeping fast path off), which is the behaviour of the branch's parent.
 */
export async function productReplayOnce(name: string, run: number, outDir: string, admission: 'lane' | 'jev', arm: 'before' | 'after' = 'after', latency = false): Promise<ProductRunSummary> {
  const {turn: fixture, baseline} = readFixture(name);
  const workspace = materialize(name), campaign = fixture.campaign as string;
  const gitDir = join(workspace, '.coc/repos', `${campaign}.git`), workTree = join(workspace, '.coc/campaigns', campaign);
  const reset = spawnSync('git', ['--git-dir', gitDir, '--work-tree', workTree, 'reset', '--hard', fixture.commit_before], {encoding: 'utf8'});
  if (reset.status !== 0) throw new Error(`git reset failed: ${reset.stderr}`);
  // The live turn's delivered narration (the compose of a prose-only close), from the fixture's own record.
  const record = spawnSync('git', ['--git-dir', gitDir, 'show', `${fixture.commit_after}:turns/${String(fixture.turn).padStart(4, '0')}.json`], {encoding: 'utf8', maxBuffer: 64 << 20});
  const delivered = record.status === 0 ? String(object(JSON.parse(record.stdout)).text ?? '') : undefined;
  const key = process.env.EXT_JEV_APIKEY?.trim() || readVaultSecret('EXT_JEV_APIKEY');
  if (!key) throw new Error('no Jev key: set EXT_JEV_APIKEY or sign the App in');
  const agentDir = join(workspace, 'agent');
  mkdirSync(agentDir, {recursive: true});
  const restore = setEnv({
    ...Object.fromEntries(Object.keys(process.env).filter(name => /(_API_KEY|_TOKEN|_SECRET)$/.test(name)).map(name => [name, undefined])),
    EXT_JEV_APIKEY: key, PI_COC_KERNEL_CMD: undefined, PI_COC_HOME: workspace, PI_CODING_AGENT_DIR: agentDir, PI_COC_CAMPAIGN: campaign,
    PI_COC_MODE: 'play', PI_OFFLINE: '1', PI_COC_LOOP_ENGINE: 'hybrid-v1', PI_COC_MEMORY_BACKFILL: '0',
    PI_COC_VERIFIER_MODEL: 'verifier/v1', PI_COC_MEMORY_MODEL: 'memory/m1', PI_COC_ADMISSION_MODEL: 'admission/a1',
    PI_COC_ADMISSION_REVIEWER: admission, PI_COC_JEV_PRESELECT: '1',
    PI_COC_TURN_BUDGET_MS: arm === 'before' ? '3600000' : undefined, PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: arm === 'before' ? 'off' : undefined,
  });
  const trace: Row[] = [], log = (row: Row) => trace.push({at: new Date().toISOString(), ...row});
  const calls: Row[] = [];
  const state: ReplayState = {done: new Set(), messages: [], cursor: 0, executed: calls};
  const keeper = fauxProvider();
  const replay = keeperReplay(baseline, delivered, state, log, latency);
  keeper.setResponses(Array.from({length: 24}, () => replay) as any);
  const lane = (provider: string, id: string) => fauxProvider({api: 'openai-completions', provider, models: [{id}]});
  const verifier = lane('verifier', 'v1'), memory = lane('memory', 'm1'), admissionLane = lane('admission', 'a1');
  const judge = admissionReplay(baseline, log, latency);
  admissionLane.setResponses(Array.from({length: 24}, () => judge) as any);
  const began = Date.now();
  let session: any, runner: any;
  const pending = new Map<string, Row>(), events: Row[] = [];
  try {
    const modelRuntime = await ModelRuntime.create({authPath: join(workspace, 'auth.json'), modelsPath: null, modelsStorePath: join(workspace, 'models-store.json'), refreshOnCreate: false});
    for (const provider of [keeper, verifier, memory, admissionLane]) modelRuntime.registerNativeProvider(provider.provider);
    const engine = createHybridEngine({env: process.env});
    const settingsManager = SettingsManager.inMemory({compaction: {enabled: false}, retry: {enabled: false}});
    const resourceLoader = new DefaultResourceLoader({cwd: workspace, agentDir, settingsManager,
      additionalExtensionPaths: ['kernel', 'onboarding', 'module', 'memory', 'table'].map(extension => join(REPO, 'extensions', extension)),
      extensionFactories: [
        {name: 'replay-probe', factory: (pi: any) => {
          pi.on('tool_call', (event: Row) => { pending.set(event.toolCallId, {tool: event.toolName, id: event.toolCallId, origin: String(event.toolCallId).startsWith('clerk:') ? 'policy' : 'model', input: structuredClone(event.input)}); });
          pi.on('tool_result', (event: Row) => { const call = pending.get(event.toolCallId); if (!call) return; pending.delete(event.toolCallId);
            calls.push({...call, ok: !event.isError && !object(event.details).coc_error, error: object(object(event.details).coc_error).code ?? null}); });
        }},
        {name: 'coc-hybrid-engine', factory: engine.extension},
      ]});
    await resourceLoader.reload();
    const created = await createAgentSession({cwd: workspace, agentDir, model: keeper.getModel(), modelRuntime, thinkingLevel: 'off', noTools: 'builtin',
      resourceLoader, sessionManager: SessionManager.inMemory(), settingsManager, runDriver: engine.runDriver});
    session = created.session; runner = session._extensionRunner;
    const errors: Row[] = [...created.extensionsResult.errors];
    await session.bindExtensions({mode: 'print', onError: (error: Row) => errors.push({path: error.extensionPath, error: String(error.error)})});
    if (errors.length) log({extension_errors: errors});
    session.subscribe((event: Row) => {
      if (event.type === 'step_start' && event.kind === 'infer') state.purpose = event.purpose;
      if (['run_start', 'run_end', 'step_start', 'step_end', 'operation_settled', 'delivery_accepted'].includes(event.type)) events.push(event);
    });
    await session.prompt(fixture.player_input);
  } finally {
    try { if (runner?.hasHandlers?.('session_shutdown')) await runner.emit({type: 'session_shutdown', reason: 'quit'}); } catch { /* the run is over */ }
    try { session?.dispose(); } catch { /* the run is over */ }
    restore();
  }
  const wall = Date.now() - began;
  const telemetryPath = join(workspace, '.coc/campaigns', campaign, 'telemetry.jsonl');
  const telemetry = existsSync(telemetryPath) ? readFileSync(telemetryPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const runStart = events.find(event => event.type === 'run_start'), runId = runStart?.runId;
  const own = telemetry.filter(row => !runId || row.run === runId || row.runId === runId || (row.lane === 'admission' && Date.parse(row.at ?? row.ts ?? '') >= began) || row.turn === fixture.turn);
  removeTree(workspace);
  const stepCounts: Record<string, number> = {};
  for (const event of events.filter(event => event.type === 'step_start')) stepCounts[event.kind] = (stepCounts[event.kind] ?? 0) + 1;
  const llmPurposes = events.filter(event => event.type === 'step_start' && event.kind === 'infer').map(event => event.purpose);
  const routeRows = own.filter(row => row.lane === 'route');
  const prescreenCalls = own.filter(row => row.lane === 'prescreen' && row.event === 'prepared').reduce((sum, row) => sum + Number(row.jev_calls ?? 0), 0);
  const jevCalls = routeRows.reduce((sum, row) => sum + (row.purpose === 'bind-ordinary' ? Number(row.jev_calls ?? 0) : 1), 0) + prescreenCalls;
  const end = events.find(event => event.type === 'run_end');
  const admissions = own.filter(row => row.lane === 'admission').map(row => ({verb: row.verb, origin: row.origin ?? 'model', clerk: row.clerk ?? null,
    verdict: row.verdict ?? null, ok: row.ok, skipped: row.skipped ?? null, reviewer: row.reviewer ?? null, ms: row.ms ?? null, jev_ms: row.jev_ms ?? null,
    confidence: row.confidence ?? null, jev_fallback: row.jev_fallback ?? null, basis: row.basis ?? null,
    path: row.path ?? null, fast_path: row.fast_path ?? null, jev_confidence: row.jev_confidence ?? null, line_verdicts: row.line_verdicts ?? null, lane_ms: row.lane_ms ?? null}));
  const budgetRow = own.filter(row => row.lane === 'run' && row.event === 'budget' && row.decision === 'summary').at(-1) ?? null;
  const clerk = own.filter(row => row.origin === 'policy' && row.tool).map(row => ({tool: row.tool, call_id: row.call_id, ok: row.ok, ms: row.ms, clerk: row.clerk, basis: row.basis}));
  const misses = routeRows.filter(row => ['low_confidence', 'jev_unavailable', 'jev_no_answer', 'repeated_question'].includes(String(row.reason)));
  const summary: ProductRunSummary = {run, fixture: name, admission, arm, latency, wall_ms: wall, status: end?.status ?? null, reason: end?.reason ?? null, budget: budgetRow,
    steps: stepCounts, llm_steps: llmPurposes.length, llm_purposes: llmPurposes, jev_calls: jevCalls, route_rows: routeRows.length,
    calls: calls.map(call => ({tool: call.tool, origin: call.origin, ok: call.ok, error: call.error, input: call.input})), match: matchBaseline(baseline, calls),
    admissions, clerk, misses};
  mkdirSync(outDir, {recursive: true});
  writeFileSync(join(outDir, `run${run}.trace.jsonl`), [...trace.map(row => ({lane: 'replay', ...row})), ...events.map(row => ({lane: 'event', ...row})), ...own].map(row => JSON.stringify(row)).join('\n') + '\n');
  writeFileSync(join(outDir, `run${run}.summary.json`), JSON.stringify(summary, null, 1) + '\n');
  return summary;
}

export async function main(argv: string[]): Promise<void> {
  const arg = (name: string, fallback: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : fallback; };
  const name = arg('--fixture', 'turn3'), runs = Number(arg('--runs', '1')), admission = arg('--admission', 'lane') as 'lane' | 'jev';
  const arm = arg('--arm', 'after') as 'before' | 'after', latency = arg('--latency', 'none') === 'live';
  const outDir = arg('--out', join(REPO, 'experiments/single-loop-routing/results', `${new Date().toISOString().replace(/[:.]/g, '-')}-product-${name}-${admission}`));
  const summaries: ProductRunSummary[] = [];
  for (let run = 1; run <= runs; run++) {
    const summary = await productReplayOnce(name, run, outDir, admission, arm, latency);
    summaries.push(summary);
    console.log(JSON.stringify({run, fixture: name, admission, arm, latency, wall_ms: summary.wall_ms,
      budget: summary.budget ? {elapsed_at_compose: summary.budget.elapsed_at_compose, over: summary.budget.over_budget, deferred: array(summary.budget.deferred_by_budget).map((value: Row) => value.key)} : null, status: summary.status, reason: summary.reason, steps: summary.steps,
      llm_steps: summary.llm_steps, llm_purposes: summary.llm_purposes, jev_calls: summary.jev_calls, route_rows: summary.route_rows,
      executed: summary.calls.map(call => `${call.origin === 'policy' ? 'H' : 'M'}:${call.tool}${call.ok ? '' : `!${call.error}`}`),
      match: summary.match.map(row => `${row.baseline}: ${row.matched === null ? 'n/a' : row.matched ? `yes(${row.origin})` : 'NO'}`),
      admissions: summary.admissions.map(row => `${row.origin}/${row.verb}:${row.skipped ?? row.verdict}${row.path ? `@${row.path}` : row.reviewer ? `@${row.reviewer}` : ''}${row.ms !== null ? ` ${row.ms}ms` : ''}${row.jev_confidence ?? row.confidence ? ` c=${row.jev_confidence ?? row.confidence}` : ''}`)}));
  }
  writeFileSync(join(outDir, 'summaries.json'), JSON.stringify(summaries, null, 1) + '\n');
  console.log(`results: ${outDir}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
