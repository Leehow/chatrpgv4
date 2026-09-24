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
 * refused is not replayed; a call the live host refused for a preparation wait (`blocked: preparation_wait` in the
 * baseline, SL-23) is, because that gate is what a replay of it tests. A turn that delivered nothing (stranded) answers
 * its composes with the prose the live Keeper streamed, message by message. The action-admission lane (§32) is a replay too: it answers each review with the live
 * table's recorded verdict for the same verb, in order. Jev is live.
 */
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fauxAssistantMessage, fauxProvider, fauxToolCall} from '@earendil-works/pi-ai';
import {createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager} from '../../build/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import {materialize, readFixture, removeTree} from './fixture.mjs';
import {AGENT_DIR, readVaultSecret} from './vault.mjs';
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
  // SL-19: a live Keeper's attack names no decision (`intent: combat` with a target, which the kernel settles as
  // `combat:attack`); the clerk's first blow names it. Both are the same attack, so the replay does not throw it twice.
  // SL-26: the clerk's ordinary check names its decision, the live Keeper's names only the skill: the same roll.
  : action.decision === 'core-check:ordinary-check' ? `resolve:skill:${action.skill ?? ''}:${who(action.target)}`
  : `resolve:${action.decision ?? (action.intent === 'combat' && action.target && !action.skill ? 'combat:attack' : `skill:${action.skill ?? ''}`)}:${who(action.target)}`;

/** The live calls in order, each with whether the live kernel took it (paired with the live tool rows by order). */
function liveCalls(baseline: Row): Array<{message: number; name: string; arguments: Row; ok: boolean}> {
  const tools = array(baseline.tools).filter(row => ['apply', 'resolve', 'narrate', 'ask'].includes(row.tool));
  const out: Array<{message: number; name: string; arguments: Row; ok: boolean}> = [];
  let cursor = 0;
  for (const [message, call] of array(baseline.calls).entries()) for (const toolCall of array(call.tool_calls)) {
    const row = ['apply', 'resolve', 'narrate', 'ask'].includes(toolCall.name) ? tools[cursor++] : undefined;
    // SL-24: a call the live host refused only because its review ran out of time (`host_refusal: review_timeout`) is
    // replayed: the refusal was the host's, and the replay puts the same call to today's admission. SL-23: likewise a call
    // the preparation-wait gate blocked.
    out.push({message, name: toolCall.name, arguments: object(toolCall.arguments),
      ok: row ? row.ok !== false || row.host_refusal === 'review_timeout' || row.blocked === 'preparation_wait' : true});
  }
  return out;
}

interface ReplayState {purpose?: string; done: Set<string>; messages: number[]; cursor: number; executed: Row[]; prose?: number; resent?: Set<string>}

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

/** SL-25 (§135.30.4): every `guarded` entry the run's notes carried to the Keeper in this request, in order. */
function guardedNotes(context: Row): Row[] {
  return messageTexts(context).flatMap(body => {
    const start = body.indexOf('{"kind":"single_loop_step"');
    if (start < 0) return [];
    try { return array(JSON.parse(body.slice(start, body.lastIndexOf('}') + 1)).guarded); } catch { return []; }
  });
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
    // SL-23: a turn with no delivered text (it stranded) answers each compose with the next prose-only message the live
    // Keeper streamed, in order.
    if (!delivered) {
      const prose = array(baseline.calls).map((call: Row, index: number) => ({index, text: String(call.text ?? '')}))
        .filter((call: Row) => call.text && !array(array(baseline.calls)[call.index].tool_calls).length);
      const next = prose[state.prose ?? 0];
      if (next) {
        state.prose = (state.prose ?? 0) + 1;
        log({replay: 'compose:recorded_prose', message: next.index});
        await sleep(providerMs(next.index));
        return fauxAssistantMessage(next.text, {stopReason: 'stop'});
      }
    }
    log({replay: 'compose:delivered_text'});
    await sleep(providerMs(last));
    return fauxAssistantMessage(delivered ?? '', {stopReason: 'stop'});
  };
  return async (context: Row): Promise<Row> => {
    // The request's shape, message by message (role, custom type, bytes, digest), so a trace shows where two
    // consecutive requests stop sharing a prefix (SL-11 scope 4).
    log({request_shape: array(context.messages).map((message: Row) => {
      const body = JSON.stringify(message.content ?? '');
      return [message.role, message.customType ?? null, body.length, createHash('sha256').update(body).digest('hex').slice(0, 8)];
    }), system_bytes: String(context.systemPrompt ?? '').length, ...(guardedNotes(context).length ? {guarded: guardedNotes(context)} : {})});
    // SL-10: a compose the run's time budget chose is the Keeper's close; the replay answers it with the delivery, not
    // with the live Keeper's remaining bookkeeping (which the budget left for the next turn).
    // SL-20: so is the compose after the clerk settled the declaration (§135.11 addendum): the note tells the Keeper to
    // narrate the settled step and close the turn, and the replay answers it with the delivery, as it answers the budget's.
    if (['run_budget', 'settled'].includes(String(latestNote(context).reason))) return delivery();
    // SL-24 (§32.12.2): a call the host returned `review_pending` is resent once, unchanged, as its refusal's fix says. The
    // recorded Keeper never saw that refusal; this models a Keeper that obeys it, as SL-10's budget compose modelled one
    // that obeys the budget note. The resend is answered at once (no Keeper latency), the pessimistic case for the overlap.
    const messages = array(context.messages);
    const lastResult = [...messages].reverse().find((message: Row) => message.role === 'toolResult');
    // SL-30 (§32.12.3): a batch that landed only its typed-admitted lines and returned the rest pending says so in its
    // result's `admission` block; the replayed Keeper resends the whole call once (the host applies only what did not land).
    const pendingPart = object(object(object(object(lastResult?.details).admission).not_landed).details).reason === 'review_pending';
    if (lastResult && (pendingPart || object(object(object(lastResult.details).coc_error).details).reason === 'review_pending') && !state.resent?.has(lastResult.toolCallId)) {
      (state.resent ??= new Set()).add(lastResult.toolCallId);
      const original = messages.flatMap((message: Row) => message.role === 'assistant' ? array(message.content) : [])
        .find((block: Row) => block.type === 'toolCall' && block.id === lastResult.toolCallId);
      if (original) return answer([{name: String(original.name), arguments: object(original.arguments)}], 'resend:review_pending');
    }
    const done = doneFrom(context), purpose = state.purpose;
    if (purpose === 'bind') {
      // The operation the clerk chose, from the run's own note to the Keeper.
      const operation = object(latestNote(context).complete), bound = object(operation.bound);
      const key = operation.verb === 'apply' ? effectKey(bound) : resolveKey(bound);
      for (const call of calls) {
        if (!call.ok) continue;
        // The note asks for the verb "with the bound values as given and the needed parameters filled in" (§135.4): the
        // recorded call supplies what the live Keeper filled in, and the bound values ride on it as given (SO-04: an
        // obligation check's `action.obligation`, which the live Keeper never had to send).
        if (operation.verb === 'apply' && call.name === 'apply') {
          const effect = array(call.arguments.effects).find((value: Row) => effectKey(value) === key);
          if (effect && !done.has(key!)) { const item = {name: 'apply', arguments: {effects: [{...effect, ...bound}]}}; record(item); return answer([item], 'bind', call.message); }
        }
        // A resolve binds by its decision and who acts or is acted on (a defence names its actor, an attack its target).
        const action = object(call.arguments.action), norm = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, '-');
        if (operation.verb === 'resolve' && call.name === 'resolve' && action.decision === bound.decision
          && (norm(action.actor) === norm(bound.actor) && !!bound.actor || norm(action.target) === norm(bound.target) && !!bound.target)
          && !done.has(resolveKey(action))) {
          const item = {name: 'resolve', arguments: {...call.arguments, action: {...action, ...bound}}};
          record(item); return answer([item], 'bind', call.message);
        }
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
 * The admission lane as a replay of the live table's verdicts. Each live review is paired with the live call it judged
 * (the i-th review of a verb with the i-th reviewed call of that verb the live kernel took). A review is answered with
 * the verdict of the live call it names -- the call's decision or skill and its target for a resolve, an effect's
 * target for an apply, read as strings in the review request -- preferring a live review not yet replayed (SO-04: the
 * clerk's claimed Persuade is a review the live table never had, and in order it took the verdict meant for the next
 * call); else, for an apply, the unreplayed live review whose effect kinds match the proposal's lines (SL-10: when the
 * typed fast path settles the clerk's move, the Keeper's later batch must not take the move's recorded verdict and
 * time); else the next unreplayed review of the verb; else the last one replayed for that verb. With `latency` (SL-10)
 * each answer waits the live review's recorded time.
 */
function admissionReplay(baseline: Row, log: (row: Row) => void, latency = false, liveKeeper = false) {
  // The live reviewed applies: those carrying a §32.1 triggering kind (admission.ts's TRIGGER_KINDS).
  const trigger = new Set(['move', 'clue', 'time', 'cash', 'item', 'handout', 'map', 'object', 'usage']);
  const calls = liveCalls(baseline).filter(call => call.ok);
  const waitBlocked = array(baseline.tools).some((row: Row) => row.blocked === 'preparation_wait');
  const reviewable = (call: Row): boolean => call.name === 'resolve' || array(call.arguments.effects).some((effect: Row) => trigger.has(effect.kind));
  const records: Record<string, Array<Row & {names: string[]; kinds: string | null; used: boolean}>> = {apply: [], resolve: []};
  const byVerb: Record<string, Row[]> = {apply: calls.filter(call => call.name === 'apply' && reviewable(call)), resolve: calls.filter(call => call.name === 'resolve')};
  const cursor: Record<string, number> = {apply: 0, resolve: 0};
  for (const row of array(baseline.admissions)) {
    const verb = row.verb, list = byVerb[verb];
    if (!list) continue;
    const call = list[cursor[verb]++];
    const action = object(call?.arguments.action), effects = array(call?.arguments.effects);
    const names = verb === 'resolve' ? [String(action.decision ?? action.skill ?? ''), String(action.target ?? '')].filter(Boolean)
      : effects.map((effect: Row) => String(effect.to ?? effect.clue ?? effect.name ?? '')).filter(Boolean);
    records[verb].push({...row, names, kinds: verb === 'apply' && call ? [...new Set(effects.map((effect: Row) => String(effect.kind)))].sort().join('+') : null, used: false});
  }
  const last: Record<string, Row | undefined> = {};
  return async (context: Row): Promise<Row> => {
    const request = JSON.stringify(context.messages ?? []);
    const verb = request.includes('resolve (roll the dice') ? 'resolve' : 'apply';
    const list = records[verb];
    // The proposal lines are the host's own machine lines ("- apply <kind>: ..."), so their kinds are read off them.
    const proposed = request.slice(request.lastIndexOf('[The Keeper now proposes]'));
    const kinds = [...new Set([...proposed.matchAll(/- apply ([a-z_]+):/g)].map(match => match[1]))].sort().join('+');
    const names = (record: Row & {names: string[]}) => record.names.length > 0 && (verb === 'resolve' ? record.names.every(name => request.includes(name)) : record.names.some(name => request.includes(name)));
    let next = list.find(record => !record.used && names(record)), pairing = 'identity';
    if (!next && verb === 'apply') { next = list.find(record => !record.used && record.kinds === kinds); pairing = 'kinds'; }
    if (!next) { next = list.find(record => names(record)); pairing = 'identity_reused'; }
    if (!next) { next = list.find(record => !record.used); pairing = 'order'; }
    if (!next) { next = last[verb] as typeof next; pairing = 'reuse_last'; }
    if (next) { next.used = true; last[verb] = next; }
    log({admission_replay: verb, kinds: verb === 'apply' ? kinds : undefined, pairing: next ? pairing : null, verdict: next?.verdict ?? null, live_ms: next?.ms ?? null});
    if (latency) await sleep(Number(next?.ms ?? 0));
    // A live Keeper's writes are not the recorded ones, in number or order. Admission is not what a live run measures
    // (SL-10 measures it); every recorded verdict of both fixtures is authorized/entailed, so an unrecorded review is
    // answered authorized and logged as such.
    if (!next && liveKeeper) return fauxAssistantMessage(JSON.stringify({verdict: 'authorized', grounds: 'live keeper run: admission not under test'}));
    // SL-23: a call the live wait refused before any review has no live verdict; its admission is not what the replay tests.
    if (!next && waitBlocked) return fauxAssistantMessage(JSON.stringify({verdict: 'authorized', grounds: 'refused by the wait live, never reviewed: admission not under test'}));
    if (!next) return fauxAssistantMessage('no recorded verdict for this review');
    return fauxAssistantMessage(JSON.stringify({verdict: next.verdict, grounds: `replayed live verdict (${next.ms} ms live)`}));
  };
}

/** One Keeper model call as the provider accounted it (SL-11): tokens, cache and time. */
export interface ModelCall {step: number; turn: number; purpose: string | null; ms: number | null; ttfb_ms: number | null; input: number; cache_read: number; cache_write: number;
  output: number; reasoning: number | null; tools: string[]; stop: string | null; effort: string | null}

export interface ProductRunOptions {
  /** `replay` (default): the live Keeper's recorded calls. `live`: the real Keeper model on the product driver (SL-11). */
  keeper?: 'replay' | 'live';
  /** The Keeper's thinking level for a live run (the table's default is `low`). */
  thinking?: string;
  /** A live run's Keeper model, `provider/id` (default `grok-build/grok-4.7-build-fast`, the table's). */
  model?: string;
  /** SL-10: `before` sets the time budget out of reach and the bookkeeping admission fast path off. */
  arm?: 'before' | 'after';
  /** SL-10: the replayed Keeper and admission lane wait their recorded live times (replay Keeper only). */
  latency?: boolean;
  /** Player inputs for the turns after the fixture's own, in the same session (cross-turn cache measurement). */
  then?: string[];
  /** SO-04: `COC_KERNEL_SEED` for the kernel subprocess, recorded in the summary. */
  seed?: string;
  /**
   * SL-30: `PI_COC_ADMISSION_FAST_MIN_CONFIDENCE` for the run (default: unset, the product's 0.87). It moves the whole-batch
   * fast path (§32.11) and the line threshold (§32.12.3) together; an exploratory arm, never the product setting.
   */
  fastMin?: string;
  /** SL-13: `off` runs the engine without the typed-feature compile (§135.30), the SL-12 policy: the control arm. */
  compile?: 'on' | 'off';
  /**
   * SL-13 follow-up: `off` launches with the Jev preselect setting off (`PI_COC_JEV_PRESELECT=0`), as live gate #4's
   * source-mode driver did: the run's read then attaches no prescreen material (its row says `not_run`). Default `on`,
   * the owner's App (the SL-00 inventory: `ext.jev.preselectEnabled` true).
   */
  prescreen?: 'on' | 'off';
  /**
   * SL-24: `replay` (default) answers each admission review with the live table's recorded verdict; `live` puts it to the
   * real lane model (`laneModel`, default the long gate's `opencode-go/deepseek-v4.1-flash`, credential copied from the
   * App's agent home), so a review the live table cut at its cap is answered for real, at its real latency.
   */
  lane?: 'replay' | 'live';
  laneModel?: string;
}

/**
 * A live run's Keeper credential: the App's grok-build OAuth access token, copied into the disposable workspace with the
 * refresh token removed, so nothing this run does can rotate (and so invalidate) the App's own login. A token with
 * less than 20 minutes left is refused instead: sign the App in again first.
 */
/** SL-24: the lane provider's credential, copied from the App's agent home into the disposable workspace (merged, never printed). */
function liveLaneHome(workspace: string, agentDir: string, provider: string): void {
  const credential = object(object(JSON.parse(readFileSync(join(AGENT_DIR, 'auth.json'), 'utf8')))[provider]);
  if (!Object.keys(credential).length) throw new Error(`the App has no ${provider} credential for the live lane`);
  for (const path of [join(workspace, 'auth.json'), join(agentDir, 'auth.json')]) {
    const current = existsSync(path) ? object(JSON.parse(readFileSync(path, 'utf8'))) : {};
    writeFileSync(path, JSON.stringify({...current, [provider]: credential}), {mode: 0o600});
  }
}

function liveKeeperHome(workspace: string, agentDir: string): void {
  const credential = object(object(JSON.parse(readFileSync(join(AGENT_DIR, 'auth.json'), 'utf8')))['grok-build']);
  if (typeof credential.access !== 'string' || !credential.access || Number(credential.expires) - Date.now() < 20 * 60_000)
    throw new Error('the App\'s grok-build token is missing or expires within 20 minutes: sign the App in again first');
  const auth = JSON.stringify({'grok-build': {...credential, refresh: ''}});
  for (const path of [join(workspace, 'auth.json'), join(agentDir, 'auth.json')]) writeFileSync(path, auth, {mode: 0o600});
  // The account's model catalog (metadata only, no credential), so the model and its reasoning levels are the App's.
  if (existsSync(join(AGENT_DIR, 'grok-build-models.json'))) copyFileSync(join(AGENT_DIR, 'grok-build-models.json'), join(agentDir, 'grok-build-models.json'));
}

export interface ProductRunSummary {
  run: number; fixture: string; admission: string; lane: string; keeper: string; thinking: string; arm: string; latency: boolean; seed: string | null; wall_ms: number; status: string | null; reason: string | null;
  budget: Row | null;
  model_calls: ModelCall[];
  steps: Record<string, number>; llm_steps: number; llm_purposes: string[]; jev_calls: number; route_rows: number;
  /** SL-13: the compile arm, the compile row (§135.30) if one was asked, and every clerk selection by who made it. */
  compile: string; compile_row: Row | null; selections: Array<{by: string; keys: string[]}>;
  /** SL-13 follow-up: every compile row of the run (§135.30.1: one per read that issues uncompiled reachable candidates), the prescreen arm and each read's prescreen status. */
  compile_rows: Row[]; prescreen: string; reads: Row[];
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
 * SL-10 arms (`options.arm`): `after` is the branch as it stands; `before` turns off what SL-10 added (the time budget
 * set out of reach, the bookkeeping fast path off), which is the behaviour of the branch's parent. `options.latency`:
 * the replayed Keeper and admission lane wait their recorded live times.
 */
export async function productReplayOnce(name: string, run: number, outDir: string, admission: 'lane' | 'jev', options: ProductRunOptions = {}): Promise<ProductRunSummary> {
  const live = options.keeper === 'live', thinking = options.thinking ?? (live ? 'low' : 'off');
  const [liveProvider, liveModel] = (options.model ?? 'grok-build/grok-4.7-build-fast').split('/');
  const arm = options.arm ?? 'after', latency = options.latency === true && !live;
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
  if (live) liveKeeperHome(workspace, agentDir);
  const laneLive = options.lane === 'live', laneModel = options.laneModel ?? 'opencode-go/deepseek-v4.1-flash';
  if (laneLive) liveLaneHome(workspace, agentDir, laneModel.slice(0, laneModel.indexOf('/')));
  const restore = setEnv({
    ...Object.fromEntries(Object.keys(process.env).filter(name => /(_API_KEY|_TOKEN|_SECRET)$/.test(name)).map(name => [name, undefined])),
    EXT_JEV_APIKEY: key, PI_COC_KERNEL_CMD: undefined, PI_COC_HOME: workspace, PI_CODING_AGENT_DIR: agentDir, PI_COC_CAMPAIGN: campaign,
    PI_COC_MODE: 'play', PI_OFFLINE: '1', PI_COC_LOOP_ENGINE: 'hybrid-v1', PI_COC_MEMORY_BACKFILL: '0',
    PI_COC_VERIFIER_MODEL: 'verifier/v1', PI_COC_MEMORY_MODEL: 'memory/m1', PI_COC_ADMISSION_MODEL: laneLive ? laneModel : 'admission/a1',
    PI_COC_LANE_THINKING: laneLive ? 'low' : undefined,
    PI_COC_ADMISSION_REVIEWER: admission, PI_COC_JEV_PRESELECT: options.prescreen === 'off' ? '0' : '1', PI_GROK_BUILD_IMAGE_TOOLS: '0',
    PI_COC_TURN_BUDGET_MS: arm === 'before' ? '3600000' : undefined, PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: arm === 'before' ? 'off' : options.fastMin,
    // SO-04: the kernel's dice are seeded (the kernel subprocess inherits this), so a passing and a failing roll are
    // both reproducible; the seed is recorded in the summary.
    COC_KERNEL_SEED: options.seed,
  });
  const trace: Row[] = [], log = (row: Row) => trace.push({at: new Date().toISOString(), ...row});
  const calls: Row[] = [];
  const state: ReplayState = {done: new Set(), messages: [], cursor: 0, executed: calls};
  const keeper = fauxProvider();
  const replayed = keeperReplay(baseline, delivered, state, log, latency);
  // SL-27: with SINGLE_LOOP_DUMP_REQUESTS set, every replayed Keeper request (each message's role and text) and the tool
  // calls answered to it go to run<N>.requests.jsonl, so a look's answer can be compared with what the Keeper was shown.
  const dumpRequests = !!process.env.SINGLE_LOOP_DUMP_REQUESTS, requests: Row[] = [];
  const replay = async (context: Row): Promise<Row> => {
    const answer = await replayed(context);
    if (dumpRequests) requests.push({request: requests.length, messages: array(context.messages).map((message: Row, index: number) => ({index, role: message.role,
      text: messageTexts({messages: [message]})[0]})), answer: array(answer.content).filter((block: Row) => block.type === 'toolCall').map((block: Row) => ({name: block.name, arguments: block.arguments}))});
    return answer;
  };
  keeper.setResponses(Array.from({length: 24}, () => replay) as any);
  const lane = (provider: string, id: string) => fauxProvider({api: 'openai-completions', provider, models: [{id}]});
  const verifier = lane('verifier', 'v1'), memory = lane('memory', 'm1'), admissionLane = lane('admission', 'a1');
  const judge = admissionReplay(baseline, log, latency, live);
  admissionLane.setResponses(Array.from({length: 24}, () => judge) as any);
  const began = Date.now();
  let session: any, runner: any;
  const pending = new Map<string, Row>(), events: Row[] = [];
  // Per model call: the provider's own usage (Pi's accounting of what the provider reported), the time from the request
  // to the end of its message, and to the response headers.
  const modelCalls: ModelCall[] = [];
  let requestAt: number | undefined, headersAt: number | undefined, effort: string | null = null, turnIndex = 0;
  /** What the provider was actually sent, item by item (kind, bytes, digest): where two requests stop sharing a prefix. */
  const shapeOf = (payload: Row): Row => {
    const item = (value: unknown): [string, number, string] => { const body = JSON.stringify(value ?? null);
      return [String(object(value).role ?? object(value).type ?? typeof value), body.length, createHash('sha256').update(body).digest('hex').slice(0, 8)]; };
    return {instructions: item(payload.instructions), tools: item(payload.tools), input: array(payload.input).map(item), keys: Object.keys(payload)};
  };
  try {
    const modelRuntime = await ModelRuntime.create({authPath: join(workspace, 'auth.json'), modelsPath: null, modelsStorePath: join(workspace, 'models-store.json'), refreshOnCreate: false});
    for (const provider of [keeper, verifier, memory, admissionLane]) modelRuntime.registerNativeProvider(provider.provider);
    let keeperModel: any = keeper.getModel();
    if (live) {
      // The product's own provider registration (the extension's `createAuthProvider`), reading the copied credential.
      const {createAuthProvider} = await import(join(REPO, 'extensions/grok-build-oauth/agent/provider.js'));
      modelRuntime.registerProvider(liveProvider, await createAuthProvider());
      keeperModel = modelRuntime.getModel(liveProvider, liveModel);
      if (!keeperModel) throw new Error(`no model ${liveProvider}/${liveModel} in the account catalog`);
    }
    const engine = createHybridEngine({env: process.env, ...(options.compile === 'off' ? {compile: false} : {})});
    const settingsManager = SettingsManager.inMemory({compaction: {enabled: false}, retry: {enabled: false}});
    const resourceLoader = new DefaultResourceLoader({cwd: workspace, agentDir, settingsManager,
      // The Keeper's own prompt, as bin/pi-coc passes it (`--system-prompt prompts/keeper.md`).
      systemPrompt: readFileSync(join(REPO, 'prompts/keeper.md'), 'utf8'),
      additionalExtensionPaths: ['kernel', 'onboarding', 'module', 'memory', 'table'].map(extension => join(REPO, 'extensions', extension)),
      extensionFactories: [
        {name: 'replay-probe', factory: (pi: any) => {
          pi.on('before_provider_request', (event: Row) => { requestAt = Date.now(); headersAt = undefined;
            effort = object(object(event.payload).reasoning).effort ?? object(event.payload).reasoning_effort ?? null;
            if (live) log({provider_request: turnIndex, shape: shapeOf(object(event.payload))}); });
          pi.on('after_provider_response', () => { headersAt = Date.now(); });
          pi.on('tool_call', (event: Row) => { pending.set(event.toolCallId, {tool: event.toolName, id: event.toolCallId, origin: String(event.toolCallId).startsWith('clerk:') ? 'policy' : 'model', input: structuredClone(event.input)}); });
          pi.on('tool_result', (event: Row) => { const call = pending.get(event.toolCallId); if (!call) return; pending.delete(event.toolCallId);
            const details = object(event.details);
            if (dumpRequests && ['look', 'lookup', 'recall'].includes(call.tool)) call.result_text = array(event.content).map((block: Row) => typeof block.text === 'string' ? block.text : '').join('');
            calls.push({...call, ok: !event.isError && !details.coc_error, error: object(details.coc_error).code ?? null,
              ...(details.obligation ? {obligation: details.obligation} : {}), ...(details.obligation_open ? {obligation_open: details.obligation_open} : {}),
              ...(object(details.outcome).passed !== undefined ? {passed: object(details.outcome).passed, level: object(details.outcome).level ?? null} : {})}); });
        }},
        {name: 'coc-hybrid-engine', factory: engine.extension},
      ]});
    await resourceLoader.reload();
    const created = await createAgentSession({cwd: workspace, agentDir, model: keeperModel, modelRuntime, thinkingLevel: thinking as any, noTools: 'builtin',
      resourceLoader, sessionManager: SessionManager.inMemory(), settingsManager, runDriver: engine.runDriver});
    session = created.session; runner = session._extensionRunner;
    const errors: Row[] = [...created.extensionsResult.errors];
    await session.bindExtensions({mode: 'print', onError: (error: Row) => errors.push({path: error.extensionPath, error: String(error.error)})});
    if (errors.length) log({extension_errors: errors});
    session.subscribe((event: Row) => {
      if (event.type === 'step_start' && event.kind === 'infer') state.purpose = event.purpose;
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        const usage = object(event.message.usage), now = Date.now();
        modelCalls.push({step: modelCalls.length + 1, turn: turnIndex, purpose: state.purpose ?? null, ms: requestAt ? now - requestAt : null, ttfb_ms: requestAt && headersAt ? headersAt - requestAt : null,
          input: Number(usage.input ?? 0), cache_read: Number(usage.cacheRead ?? 0), cache_write: Number(usage.cacheWrite ?? 0), output: Number(usage.output ?? 0),
          reasoning: usage.reasoning === undefined ? null : Number(usage.reasoning),
          tools: array(event.message.content).filter((block: Row) => block.type === 'toolCall').map((block: Row) => String(block.name)),
          stop: event.message.stopReason ?? null, effort});
        requestAt = undefined;
      }
      if (['run_start', 'run_end', 'step_start', 'step_end', 'operation_settled', 'delivery_accepted'].includes(event.type)) events.push(event);
    });
    await session.prompt(fixture.player_input);
    for (const next of options.then ?? []) { turnIndex++; state.cursor = Number.MAX_SAFE_INTEGER; await session.prompt(next); }
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
    path: row.path ?? null, fast_path: row.fast_path ?? null, jev_confidence: row.jev_confidence ?? null, line_verdicts: row.line_verdicts ?? null, lane_ms: row.lane_ms ?? null,
    // SL-18 (§32.12): the compile's evidence, or why it was refused; the lane's first byte and a cut at the cap.
    predicate: row.predicate ?? null, features: row.features ?? null, binding_paths: row.binding_paths ?? null, compile_refused: row.compile_refused ?? null,
    first_byte_ms: row.first_byte_ms ?? null, timed_out: row.timed_out ?? null,
    // SL-24 (§32.12.2): the late decision, a pending return and its resend.
    cause: row.cause ?? null, late_rule: row.late_rule ?? null, resend: row.resend ?? null, resend_wait_ms: row.resend_wait_ms ?? null,
    typed: row.typed ?? null, grounds: row.grounds ?? null, proposed: row.proposed ?? null,
    // SL-30 (§32.12.3): a line-level row, which lines it covers.
    line_level: row.line_level ?? null, lines: row.lines ?? null, of_lines: row.of_lines ?? null, line_confidences: row.line_confidences ?? null}));
  const budgetRow = own.filter(row => row.lane === 'run' && row.event === 'budget' && row.decision === 'summary').at(-1) ?? null;
  const clerk = own.filter(row => row.origin === 'policy' && row.tool).map(row => ({tool: row.tool, call_id: row.call_id, ok: row.ok, ms: row.ms, clerk: row.clerk, basis: row.basis}));
  const misses = routeRows.filter(row => ['low_confidence', 'jev_unavailable', 'jev_no_answer', 'repeated_question'].includes(String(row.reason)));
  const compileRow = routeRows.find(row => row.purpose === 'compile') ?? null;
  const compileRows = routeRows.filter(row => row.purpose === 'compile');
  const reads = own.filter(row => row.lane === 'run' && row.event === 'read').map(row => ({scene: row.scene ?? null, prescreen: object(row.prescreen).status ?? null,
    materials: object(row.prescreen).materials ?? 0, jev_calls: object(row.prescreen).jev_calls ?? 0, ms: object(row.prescreen).ms ?? null}));
  const selections = routeRows.filter(row => (row.purpose === 'compile' || row.purpose === 'route') && array(row.selected).length)
    .map(row => ({by: String(row.purpose), keys: array(row.selected).map(String)}));
  const summary: ProductRunSummary = {run, fixture: name, admission, lane: laneLive ? `live ${laneModel}` : 'replay', keeper: live ? `live ${liveProvider}/${liveModel}` : 'replay', thinking, arm, latency, seed: options.seed ?? null, wall_ms: wall, budget: budgetRow,
    compile: options.compile ?? 'on', compile_row: compileRow, selections, compile_rows: compileRows, prescreen: options.prescreen ?? 'on', reads,
    status: end?.status ?? null, reason: end?.reason ?? null, model_calls: modelCalls,
    steps: stepCounts, llm_steps: llmPurposes.length, llm_purposes: llmPurposes, jev_calls: jevCalls, route_rows: routeRows.length,
    calls: calls.map(call => ({tool: call.tool, origin: call.origin, ok: call.ok, error: call.error, input: call.input,
      ...(call.obligation ? {obligation: call.obligation} : {}), ...(call.obligation_open ? {obligation_open: call.obligation_open} : {}),
      ...(call.passed !== undefined ? {passed: call.passed, level: call.level} : {})})), match: matchBaseline(baseline, calls),
    admissions, clerk, misses};
  mkdirSync(outDir, {recursive: true});
  writeFileSync(join(outDir, `run${run}.trace.jsonl`), [...trace.map(row => ({lane: 'replay', ...row})), ...events.map(row => ({lane: 'event', ...row})), ...own].map(row => JSON.stringify(row)).join('\n') + '\n');
  writeFileSync(join(outDir, `run${run}.summary.json`), JSON.stringify(summary, null, 1) + '\n');
  if (dumpRequests) writeFileSync(join(outDir, `run${run}.requests.jsonl`), [...requests.map(row => ({kind: 'request', ...row})),
    ...calls.filter(call => call.result_text !== undefined).map(call => ({kind: 'read_result', tool: call.tool, id: call.id, input: call.input, ok: call.ok, text: call.result_text}))]
    .map(row => JSON.stringify(row)).join('\n') + '\n');
  return summary;
}

export async function main(argv: string[]): Promise<void> {
  const arg = (name: string, fallback: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : fallback; };
  const name = arg('--fixture', 'turn3'), runs = Number(arg('--runs', '1')), admission = arg('--admission', 'lane') as 'lane' | 'jev';
  const arm = arg('--arm', 'after') as 'before' | 'after', latency = arg('--latency', 'none') === 'live';
  const keeper = arg('--keeper', 'replay') as 'replay' | 'live', thinking = argv.includes('--thinking') ? arg('--thinking', 'low') : undefined;
  const model = argv.includes('--model') ? arg('--model', '') : undefined;
  const seed = argv.includes('--seed') ? arg('--seed', '') : undefined;
  const fastMin = argv.includes('--fast-min') ? arg('--fast-min', '') : undefined;
  const compile = arg('--compile', 'on') as 'on' | 'off';
  const prescreen = arg('--prescreen', 'on') as 'on' | 'off';
  const lane = arg('--lane', 'replay') as 'replay' | 'live', laneModel = argv.includes('--lane-model') ? arg('--lane-model', '') : undefined;
  const then = argv.flatMap((value, index) => value === '--then' ? [argv[index + 1]] : []);
  const outDir = arg('--out', join(REPO, 'experiments/single-loop-routing/results', `${new Date().toISOString().replace(/[:.]/g, '-')}-product-${name.split('/').filter(Boolean).at(-1)}-${admission}${keeper === 'live' ? `-live-${thinking ?? 'low'}` : ''}`));
  const summaries: ProductRunSummary[] = [];
  for (let run = 1; run <= runs; run++) {
    const summary = await productReplayOnce(name, run, outDir, admission, {keeper, arm, latency, compile, prescreen, lane, ...(laneModel ? {laneModel} : {}), ...(thinking ? {thinking} : {}), ...(model ? {model} : {}), ...(then.length ? {then} : {}), ...(seed ? {seed} : {}), ...(fastMin ? {fastMin} : {})});
    summaries.push(summary);
    console.log(JSON.stringify({run, fixture: name, admission, keeper: summary.keeper, thinking: summary.thinking, arm, latency, seed: summary.seed, wall_ms: summary.wall_ms,
      budget: summary.budget ? {elapsed_at_compose: summary.budget.elapsed_at_compose, over: summary.budget.over_budget, deferred: array(summary.budget.deferred_by_budget).map((value: Row) => value.key)} : null,
      model_calls: summary.model_calls.map(call => `${call.purpose ?? '?'} ${call.ms ?? '?'}ms in ${call.input}+${call.cache_read}c out ${call.output}/r${call.reasoning ?? '?'} [${call.tools.join(',')}]`), status: summary.status, reason: summary.reason, steps: summary.steps,
      llm_steps: summary.llm_steps, llm_purposes: summary.llm_purposes, jev_calls: summary.jev_calls, route_rows: summary.route_rows, compile, prescreen,
      reads: summary.reads.map(row => `${row.scene}:${row.prescreen}/${row.materials}m/${row.jev_calls}j`),
      features: summary.compile_rows.map(compiled => Object.fromEntries(Object.entries(object(compiled.features)).map(([family, value]: [string, any]) =>
        [family, `${value.row ?? value.choice}${value.confidence !== null ? ` ${value.confidence}` : ''}${value.cleared ? '' : ' (not cleared)'}`]))),
      selections: summary.selections.map(entry => `${entry.by}:${entry.keys.join('+')}`),
      executed: summary.calls.map(call => `${call.origin === 'policy' ? 'H' : 'M'}:${call.tool}${call.ok ? '' : `!${call.error}`}${call.obligation ? `[${call.obligation.handle}:${call.obligation.settled ? 'settled' : 'open'}]` : ''}`),
      match: summary.match.map(row => `${row.baseline}: ${row.matched === null ? 'n/a' : row.matched ? `yes(${row.origin})` : 'NO'}`),
      admissions: summary.admissions.map(row => `${row.origin}/${row.verb}:${row.skipped ?? row.verdict}${row.path ? `@${row.path}` : row.reviewer ? `@${row.reviewer}` : ''}${row.ms !== null ? ` ${row.ms}ms` : ''}${row.jev_confidence ?? row.confidence ? ` c=${row.jev_confidence ?? row.confidence}` : ''}${row.compile_refused ? ` refused=${row.compile_refused}` : ''}`)}));
  }
  writeFileSync(join(outDir, 'summaries.json'), JSON.stringify(summaries, null, 1) + '\n');
  console.log(`results: ${outDir}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
