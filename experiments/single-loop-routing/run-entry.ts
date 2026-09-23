/**
 * One replay run of a fixture turn through the single-loop policy with real Jev and the real kernel
 * on a disposable workspace copy. No LLM is called; the run stops where the LLM would compose.
 */
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {materialize, readFixture, removeTree} from './fixture.mjs';
import {startKernel} from './kernel.mjs';
import {readVaultSecret} from './vault.mjs';
import {createRealPorts} from './ports.ts';
import {initialView, runTurn, type PendingItem, type RunView, type TelemetryRow} from './loop.ts';
import type {Json} from './candidates.ts';

type Row = Record<string, any>;

export interface RunSummary {
  run: number; wall_ms: number; steps: number; counts: Record<string, number>; jev_calls: number; jev_ms: number;
  stopped: Row | null; executed: Row[]; route_choices: Row[]; misses: Row[]; match: Row[];
}

function matchAgainstBaseline(baseline: Row, executed: Row[], stopped: Row | null): Row[] {
  const ok = executed.filter(entry => entry.status === 'ok');
  const keys = ok.map(entry => String(entry.candidate));
  const params = ok.map(entry => JSON.stringify((entry.summary as Row)?.params ?? {}));
  const has = (key: string, fragment: string): boolean => keys.includes(key) || params.some(text => text.includes(fragment));
  const actions: Row[] = Array.isArray(baseline.actions) ? baseline.actions : [];
  return actions.map(action => {
    if (action.verb === 'apply' && action.kind === 'move') return {baseline: `move → ${action.target}`, matched: has(`apply:move:${action.target}`, `"to":"${action.target}"`)};
    if (action.verb === 'apply' && action.kind === 'person') return {baseline: `person ${action.target}`, matched: has(`apply:person:${action.target}`, `"who":"${action.target}"`)};
    if (action.verb === 'apply' && action.kind === 'clue') return {baseline: `clue ${action.target}`, matched: has(`apply:clue:${action.target}`, `"clue":"${action.target}"`)};
    if (action.verb === 'apply' && action.kind === 'handout') return {baseline: `handout ${action.target}`, matched: keys.some(key => key.startsWith('apply:handout:')) || params.some(text => text.includes('"kind":"handout"'))};
    if (action.verb === 'apply' && action.kind === 'time') return {baseline: `time ${action.minutes}`, matched: null, note: 'time is narration bookkeeping; not routed by the prototype'};
    if (action.verb === 'resolve' && action.decision && action.decision !== 'core-check:ordinary-check')
      return {baseline: `resolve ${action.decision} vs ${action.target}`, matched: keys.some(key => key.startsWith(`resolve:${action.decision}:`) && key.endsWith(`:${action.target}`))
        || params.some(text => text.includes(`"decision":"${action.decision}"`) && text.includes(`"target":"${action.target}"`))};
    if (action.verb === 'resolve') return {baseline: `resolve ordinary ${action.skill ?? ''} vs ${action.target ?? ''}`,
      matched: ok.some(entry => (String(entry.candidate).startsWith('resolve:core-check:ordinary-check') && (!action.skill || JSON.stringify(entry.extra ?? {}).includes(String(action.skill))))
        || JSON.stringify((entry.summary as Row)?.params ?? {}).includes(`"skill":"${action.skill}"`))};
    if (action.verb === 'narrate') return {baseline: 'narrate', matched: stopped?.purpose === 'compose'};
    return {baseline: JSON.stringify(action), matched: null};
  });
}

/**
 * The LLM step replayed from the live Keeper's recorded tool calls (`baseline.calls`, in order). This is a
 * replay of what the real model did on the real table, not a stand-in Keeper: the prototype measures how many
 * LLM steps the loop needs when the model proposes exactly what it proposed live, with the host's own steps
 * removed from its share. A proposal the host already carried out (same move, same person, same clue) is
 * dropped from the replay; `narrate` is the compose stop.
 */
function replayLlmPorts(baseline: Row, call: (method: string, params: Record<string, unknown>) => Promise<any>, campaign: string, mint: () => string, log: (row: Row) => void) {
  const messages: Row[] = (Array.isArray(baseline.calls) ? baseline.calls : []).filter((entry: Row) => Array.isArray(entry.tool_calls));
  let cursor = 0;
  const done = new Set<string>();
  const resolveKey = (action: Row): string => action?.decision === 'core-check:ordinary-check' ? `resolve:core-check:ordinary-check:${action.skill ?? ''}`
    : `resolve:${action?.decision ?? ''}:${action?.actor ?? ''}:${action?.target ?? ''}`;
  const resolveDone = (view: RunView, action: Row): boolean => {
    const key = resolveKey(action);
    if (done.has(key)) return true;
    // A host-routed check consumed its candidate key; an ordinary check is matched by skill in the observation.
    if (action?.decision === 'core-check:ordinary-check') return view.observations.some(entry => entry.kind === 'direct' && entry.purpose === 'execute'
      && String(entry.choice).startsWith('resolve:core-check:ordinary-check') && JSON.stringify(entry.summary ?? {}).includes(String(action.skill ?? '\u0000')));
    return view.consumed.includes(key);
  };
  const effectKey = (effect: Row): string | undefined => effect.kind === 'move' ? `apply:move:${effect.to}` : effect.kind === 'person' ? `apply:person:${effect.who}`
    : effect.kind === 'clue' ? `apply:clue:${effect.clue}` : effect.kind === 'handout' ? `apply:handout:${effect.name}` : undefined;
  const alreadyDone = (view: RunView, key: string | undefined): boolean => !!key && (view.consumed.includes(key) || done.has(key));
  const toItems = (view: RunView, toolCalls: Row[]): {items: PendingItem[]; narrate: boolean} => {
    const items: PendingItem[] = [];let narrate = false;
    for (const toolCall of toolCalls) {
      if (toolCall.name === 'narrate') { narrate = true; continue; }
      if (toolCall.name === 'apply') {
        const effects = (toolCall.arguments?.effects ?? []).filter((effect: Row) => !alreadyDone(view, effectKey(effect)));
        for (const effect of effects) { const key = effectKey(effect); if (key) done.add(key); }
        if (effects.length) items.push({kind: 'direct', purpose: 'execute', call: {method: 'table.apply', params: {effects} as any, label: `apply(${effects.map((effect: Row) => effect.kind).join(',')})`}});
      } else if (toolCall.name === 'resolve') {
        const action = toolCall.arguments?.action ?? {};
        if (resolveDone(view, action)) continue;
        done.add(resolveKey(action));
        items.push({kind: 'direct', purpose: 'execute', call: {method: 'table.resolve', params: {action} as any, label: `resolve(${action.decision ?? ''} ${action.skill ?? ''} vs ${action.target ?? ''})`}});
      } else if (toolCall.name === 'lookup' || toolCall.name === 'look') {
        // Reads the live model made for itself; the loop's read step covers them, nothing to execute.
      }
    }
    return {items, narrate};
  };
  const stop = (reason: string, replayed: string): {items: PendingItem[]; stop: {reason: string; purpose: string}; detail: Json} =>
    ({items: [], stop: {reason, purpose: 'compose'}, detail: {replayed} as Json});
  /** The recorded effect that binds an open candidate (a person's table name), if the live model produced one. */
  const recordedEffectFor = (key: string): Row | undefined => {
    for (let index = cursor; index < messages.length; index++) {
      const toolCalls = messages[index].tool_calls as Row[];
      for (const toolCall of toolCalls) {
        if (toolCall.name !== 'apply') continue;
        const effects = (toolCall.arguments?.effects ?? []) as Row[];
        const effect = effects.find(entry => effectKey(entry) === key);
        if (effect) return effect;
      }
    }
    return undefined;
  };
  const llm = async (view: RunView, request: {purpose: string; item?: PendingItem}) => {
    if (request.purpose === 'compose') return stop('compose', 'compose');
    if (request.purpose === 'bind' && request.item?.candidate) {
      const key = request.item.candidate.key, effect = done.has(key) ? undefined : recordedEffectFor(key);
      if (!effect) return {items: [] as PendingItem[], detail: {replayed: 'bind', found: false} as Json};
      done.add(key);
      const label = `apply(${effect.kind} ${effect.who ?? effect.to ?? effect.clue ?? ''})`;
      const item: PendingItem = {kind: 'direct', purpose: 'execute', candidate: request.item.candidate, call: {method: 'table.apply', params: {effects: [effect]} as Record<string, Json>, label}};
      return {items: [item], detail: {replayed: 'bind'} as Json};
    }
    // adjudicate: the next recorded model message, minus what the host already did.
    while (cursor < messages.length) {
      const message = messages[cursor++];
      const {items, narrate} = toItems(view, message.tool_calls as Row[]);
      if (narrate && !items.length) return stop('compose', 'narrate');
      if (items.length) return {items, detail: {replayed: 'adjudicate', from_message: cursor - 1, proposals: items.map(item => item.call?.label ?? null)} as Json};
    }
    return stop('replay_exhausted', 'exhausted');
  };
  return {
    llm,
    async executeRaw(raw: {method: string; params: Record<string, Json>; label: string}) {
      const callId = mint();
      try {
        const result = await call(raw.method, {campaign, call_id: callId, ...raw.params}) as Row;
        const receipts = (Array.isArray(result?.receipts) ? result.receipts : []).map((receipt: any) => typeof receipt === 'string' ? receipt : receipt?.id ?? JSON.stringify(receipt));
        return {ok: true, summary: {method: raw.method, call_id: callId, receipts, ...(result?.outcome !== undefined ? {outcome: result.outcome} : {})} as Json};
      } catch (error) { return {ok: false, summary: {method: raw.method, call_id: callId, error: String((error as Error).message).slice(0, 300)} as Json}; }
    },
  };
}

export async function replayOnce(name: string, run: number, outDir: string, env: NodeJS.ProcessEnv, llmMode: 'none' | 'replay' = 'none'): Promise<RunSummary> {
  const {turn: fixture, baseline} = readFixture(name);
  const workspace = materialize(name), campaign = fixture.campaign as string;
  const trace: Row[] = [], log = (row: Row) => { trace.push({at: new Date().toISOString(), ...row}); };
  const gitDir = join(workspace, '.coc/repos', `${campaign}.git`), workTree = join(workspace, '.coc/campaigns', campaign);
  const reset = spawnSync('git', ['--git-dir', gitDir, '--work-tree', workTree, 'reset', '--hard', fixture.commit_before], {encoding: 'utf8'});
  if (reset.status !== 0) throw new Error(`git reset failed: ${reset.stderr}`);
  const kernel = startKernel({workspace, env: {}});
  const began = Date.now();
  try {
    const opened = await kernel.call('table.player_input', {campaign, text: fixture.player_input});
    log({event: 'turn_opened', state: (opened as Row)?.state ?? null, turn: (opened as Row)?.turn ?? null});
    const {ports, context, candidates, turn, mint} = await createRealPorts({call: kernel.call, campaign, env, rawInput: fixture.player_input, log});
    if (llmMode === 'replay') Object.assign(ports, replayLlmPorts(baseline, kernel.call, campaign, mint, log));
    log({event: 'initial', turn, scene: context.scene, present: context.present, candidates: candidates.map(candidate => candidate.key)});
    const view = initialView({runId: `${name}-run${run}`, rawInput: fixture.player_input, context, candidates});
    const {view: final, telemetry} = await runTurn(ports, view);
    const wall = Date.now() - began;
    const executed = final.observations.filter(entry => entry.kind === 'direct' && entry.purpose === 'execute')
      .map(entry => ({step: entry.step, candidate: entry.choice, status: entry.status, extra: (entry.summary as Row)?.extra ?? null, summary: entry.summary,
        origin: telemetry.find(t => t.step === entry.step)?.reason?.includes('model_origin') ? 'model' : 'host'}));
    for (const entry of executed) { const row = telemetry.find(t => t.step === entry.step); if (row?.detail && typeof row.detail === 'object') entry.extra = (row.detail as Row).extra ?? entry.extra; }
    const routeChoices = telemetry.filter(row => row.kind === 'decide' && row.purpose === 'route').map(row => ({step: row.step, choice: row.choice, confidence: row.confidence, reason: row.reason, offered: row.offered, ms: row.ms}));
    const misses = telemetry.filter(row => ['none_of_above', 'invalid_choice', 'low_confidence', 'jev_unavailable', 'jev_no_answer', 'repeated_question', 'jev_budget'].includes(String(row.reason)))
      .map(row => ({step: row.step, kind: row.kind, purpose: row.purpose, reason: row.reason, choice: row.choice, confidence: row.confidence}));
    const counts: Record<string, number> = {};
    for (const row of telemetry) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    const summary: RunSummary = {run, wall_ms: wall, steps: final.budget.steps, counts, jev_calls: final.budget.jevCalls, jev_ms: final.budget.jevMs,
      stopped: final.stopped ?? null, executed, route_choices: routeChoices, misses, match: matchAgainstBaseline(baseline, executed, final.stopped ?? null)};
    mkdirSync(outDir, {recursive: true});
    writeFileSync(join(outDir, `run${run}.trace.jsonl`), [...trace, ...telemetry.map(row => ({lane: 'telemetry', ...row}))].map(row => JSON.stringify(row)).join('\n') + '\n');
    writeFileSync(join(outDir, `run${run}.summary.json`), JSON.stringify({summary, observations: final.observations, final_context: final.context, materials: final.materials.map(m => ({key: m.key, kind: m.kind, label: m.label}))}, null, 1) + '\n');
    return summary;
  } finally {
    await kernel.close();
    removeTree(workspace);
  }
}

export async function main(argv: string[]): Promise<void> {
  const arg = (name: string, fallback: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : fallback; };
  const name = arg('--fixture', 'turn3'), runs = Number(arg('--runs', '1')), llmMode = arg('--llm', 'none') as 'none' | 'replay',
    outDir = arg('--out', join(process.cwd(), 'experiments/single-loop-routing/results', new Date().toISOString().replace(/[:.]/g, '-') + (llmMode === 'replay' ? '-replay' : '')));
  const key = process.env.EXT_JEV_APIKEY?.trim() || readVaultSecret('EXT_JEV_APIKEY');
  if (!key) throw new Error('no Jev key: set EXT_JEV_APIKEY or sign the App in');
  const env = {...process.env, EXT_JEV_APIKEY: key};
  const summaries: RunSummary[] = [];
  for (let run = 1; run <= runs; run++) {
    const summary = await replayOnce(name, run, outDir, env, llmMode);
    summaries.push(summary);
    console.log(JSON.stringify({run, wall_ms: summary.wall_ms, counts: summary.counts, jev_calls: summary.jev_calls, jev_ms: summary.jev_ms, stopped: summary.stopped,
      llm_steps: summary.counts.infer ?? 0, executed: summary.executed.map(entry => `${entry.origin === 'model' ? 'M:' : 'H:'}${entry.candidate}`), match: summary.match.map(row => `${row.baseline}: ${row.matched === null ? 'n/a' : row.matched ? 'yes' : 'NO'}`), misses: summary.misses}));
  }
  writeFileSync(join(outDir, 'summaries.json'), JSON.stringify(summaries, null, 1) + '\n');
  console.log(`results: ${outDir}`);
}
