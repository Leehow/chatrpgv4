/** S0 private planner/read-loop/writer protocol. Not the production TaskRuntime. */
import { randomUUID } from 'node:crypto';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentSession, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { PlanSubmissionSchema, validatePlanSubmission, type Json } from './contracts.ts';
import { createS0ReadDispatcher } from './s0-read-dispatch.ts';
import type { S0Decide } from './s0-decision.ts';

type Phase = 'passthrough' | 'planning' | 'deciding' | 'composing' | 'delivered' | 'cancelled';
interface Attempt { id: string; input: string; phase: Phase; abort: AbortController; deadlineAt: number; timer?: NodeJS.Timeout }
const PROTOCOL = '\nS0 private read-only role protocol: for the current player input, first submit a bounded semantic plan with submit_plan_packet, requesting only capability recall. The host selects a transcript listing and then an original page using Jev and real guarded reads. Do not call recall yourself. After that tool returns, write the ordinary narrate/ask using only the real result. A record proves what was said, not module truth or disclosure permission. Do not expose the private plan. Never resolve/apply or promise an unexecuted change. A missing or partial record must remain explicit. This probe handles a short recent-history question; it is not general gameplay routing.';

export function createS0HostAdapter(getSession: () => AgentSession, decide: S0Decide, options: { deadlineMs?: number } = {}) {
  const deadlineMs = options.deadlineMs ?? 90_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 90_000) throw new Error('Invalid S0 deadline');
  let api: ExtensionAPI;
  let attempt: Attempt | undefined;
  let pending: string | undefined;
  let closed = false;
  let dispatch: ReturnType<typeof createS0ReadDispatcher> | undefined;
  let boundModel: { provider: string; id: string } | undefined;
  const nested = new Set<string>();
  const trace = (data: Record<string, unknown>) => api.appendEntry('coc-jev-s0', {
    evidence: 's0-probe', attemptId: attempt?.id, at: Date.now(), ...data,
  });
  const cancel = () => { if (attempt) { clearTimeout(attempt.timer); attempt.phase = 'cancelled'; attempt.abort.abort(); } };
  const modelCurrent = () => {
    const model = getSession().model;
    return model?.provider === boundModel?.provider && model?.id === boundModel?.id;
  };
  const assertKeeper = (message: { provider?: unknown; model?: unknown } | undefined) => {
    if (!message || message.provider !== boundModel?.provider || message.model !== boundModel?.id) {
      cancel(); throw new Error('S0 Keeper response identity mismatch');
    }
  };
  const delivered = () => {
    if (!attempt || attempt.phase === 'delivered') return;
    clearTimeout(attempt.timer); attempt.phase = 'delivered'; trace({ kind: 'phase', phase: 'delivered' });
  };
  const extension = (pi: ExtensionAPI) => {
    api = pi;
    pi.on('session_start', () => {
      closed = false; cancel(); attempt = undefined; pending = undefined; nested.clear();
      const session = getSession();
      if (!session.model) throw new Error('S0 requires an explicit Keeper model');
      boundModel = { provider: session.model.provider, id: session.model.id };
      pi.events.emit('coc:task-delivery-guard', (message?: { provider?: unknown; model?: unknown }) => {
        assertKeeper(message ?? getSession().messages.findLast(value => value.role === 'assistant') as AssistantMessage | undefined);
        if (!attempt) return;
        if (closed || !modelCurrent() || attempt.phase !== 'composing' || attempt.abort.signal.aborted || Date.now() >= attempt.deadlineAt)
          throw new Error('S0 task is not current and ready for delivery');
      });
      // Capture after the kernel extension binds its actual wrappers; keep recall active in this role.
      pi.setActiveTools([...pi.getActiveTools(), 'submit_plan_packet']);
      dispatch = createS0ReadDispatcher(session, {
        current: () => !closed && attempt?.phase === 'deciding' && modelCurrent(),
        enter: id => { nested.add(id); return () => { nested.delete(id); }; },
        trace: event => trace({ kind: 'host-read', ...event }),
      });
      trace({ kind: 'session-bound', model: boundModel, sessionId: session.sessionId });
    });
    pi.on('session_shutdown', () => { cancel(); closed = true; dispatch = undefined; nested.clear(); pi.events.emit('coc:task-delivery-guard', undefined); });
    pi.events.on('coc:turn-committed', value => {
      if (!closed && attempt && typeof (value as { commit?: unknown })?.commit === 'string') delivered();
    });
    pi.on('input', (event, ctx) => {
      if (event.source === 'extension') return;
      cancel(); pending = event.text;
      // Pi steering alone queues data; owned Jev work must stop immediately.
      if (getSession().isStreaming) ctx.abort();
    });
    pi.on('before_agent_start', (event, ctx) => {
      if (pending === undefined) return;
      attempt = { id: randomUUID(), input: pending, phase: 'planning', abort: new AbortController(), deadlineAt: Date.now() + deadlineMs };
      const current = attempt;
      current.timer = setTimeout(() => {
        if (attempt !== current || current.phase === 'delivered') return;
        cancel(); ctx.abort(); trace({ kind: 'phase', phase: 'cancelled', reason: 'deadline' });
      }, deadlineMs);
      current.timer.unref();
      pending = undefined;
      pi.setActiveTools(['submit_plan_packet', 'recall', 'narrate', 'ask']);
      trace({ kind: 'phase', phase: 'planning' });
      return { systemPrompt: event.systemPrompt + PROTOCOL };
    });
    pi.on('tool_call', (event, ctx) => {
      try { assertKeeper(getSession().messages.findLast(value => value.role === 'assistant') as AssistantMessage | undefined); }
      catch (error) { ctx.abort(); return { block: true, terminate: true, reason: String(error) }; }
      if (!attempt) return;
      if (!modelCurrent()) { cancel(); return { block: true, terminate: true, reason: 'S0 Keeper model changed; rebind the task' }; }
      if (event.toolName === 'recall' && !nested.has(event.toolCallId))
        return { block: true, reason: 'Use submit_plan_packet; the S0 host owns the bounded reads' };
      if (['narrate', 'ask'].includes(event.toolName) && attempt.phase !== 'composing')
        return { block: true, terminate: attempt.phase === 'cancelled', reason: 'The S0 read task has not supplied a current result' };
    });
    pi.on('tool_result', event => {
      if (attempt && ['narrate', 'ask'].includes(event.toolName) && !event.isError) {
        delivered();
      }
    });
    pi.on('message_end', (event, ctx) => {
      if (event.message.role !== 'assistant') return;
      const message = event.message;
      try { assertKeeper(message); }
      catch { ctx.abort(); return { message: { ...message, content: [] } }; }
      if (!attempt) return;
      trace({ kind: 'keeper-usage', provider: message.provider, model: message.model, usage: message.usage });
    });
    pi.on('agent_end', () => {
      if (closed || !attempt) return;
      const session = getSession();
      trace({ kind: 'accounting', keeperContext: session.getContextUsage(), piAggregate: session.getSessionStats(),
        attribution: 'Use keeper-usage and jev-usage for per-provider attribution; Pi aggregate is not a Jev/Grok split.' });
    });
    pi.registerTool({ name: 'submit_plan_packet', label: 'Private plan',
      description: 'Submit the private bounded recall goal, subgoals, constraints, evidence, completion, capabilities, replan and return conditions. Host identity and executable arguments are not accepted.',
      parameters: PlanSubmissionSchema, executionMode: 'sequential',
      async execute(_toolCallId, params, outerSignal) {
        const current = attempt;
        if (!current || current.phase !== 'planning' || !dispatch || closed) throw new Error('S0 plan phase is not active');
        const plan = validatePlanSubmission(params, ['recall']);
        const parent = getSession().messages.findLast(message => message.role === 'assistant') as AssistantMessage | undefined;
        if (!parent) throw new Error('S0 planner message is unavailable');
        const signal = AbortSignal.any([current.abort.signal, ...(outerSignal ? [outerSignal] : []), AbortSignal.timeout(Math.max(1, current.deadlineAt - Date.now()))]);
        const live = () => { signal.throwIfAborted(); if (attempt !== current || closed || !modelCurrent()) throw new Error('S0 task is stale'); };
        const choose = async (state: Json, criteria: Record<string, string>, instructions: string) => {
          live();
          const choice = await decide({ state, criteria, instructions, signal });
          live(); trace({ kind: 'jev-usage', ...choice });
          if (!Object.hasOwn(criteria, choice.choice)) throw new Error('S0 selected an unknown candidate');
          return choice.choice;
        };
        current.phase = 'deciding'; trace({ kind: 'phase', phase: current.phase });
        try {
          const candidates = {
            player: { label: 'Recent original player statements', args: { what: 'transcript', role: 'player' } },
            keeper: { label: 'Recent delivered Keeper statements', args: { what: 'transcript', role: 'keeper' } },
            both: { label: 'Recent player and Keeper statements together', args: { what: 'transcript' } },
          };
          const first = await choose({ playerInput: current.input, plan, candidates: Object.fromEntries(Object.entries(candidates).map(([key, value]) => [key, value.label])) },
            Object.fromEntries(Object.entries(candidates).map(([key, value]) => [key, value.label])),
            'Select the candidates entry whose recent original statements should be inspected to answer playerInput and plan. Candidate labels describe source scope, not facts or authority.');
          const listing = await dispatch(candidates[first as keyof typeof candidates].args, parent, signal);
          live();
          if (listing.isError) throw new Error('S0 transcript listing was refused');
          const details = listing.result.details as { cards?: Array<{ head: string; role: string; read: Record<string, unknown> }> };
          const cards = details?.cards;
          if (!Array.isArray(cards) || !cards.length || cards.length > 20) throw new Error('S0 has no bounded original-text candidates');
          const targets = Object.fromEntries(cards.map((card, index) => [`record_${index}`, `${card.role}: ${card.head}`]));
          const second = await choose({ playerInput: current.input, plan, candidates: targets }, targets,
            'Select the candidates record most directly needed to answer playerInput and plan. Read its original before drawing a conclusion; the short head may omit conditions or negation.');
          const position = Object.keys(targets).indexOf(second);
          const readArgs = cards[position].read;
          if (!readArgs || readArgs.what !== 'transcript' || !readArgs.read) throw new Error('S0 original reference is invalid');
          const original = await dispatch(readArgs, parent, signal);
          live();
          if (original.isError) throw new Error('S0 original read was refused');
          const support = await choose({ playerInput: current.input, plan, original: original.result.details as Json },
            { supported: 'The original page supplies the evidence required by the bounded plan.', incomplete: 'The page omits or contradicts required evidence, or more context is needed.' },
            'Judge whether original actually supplies the evidence required by playerInput and plan. A successful read is not successful goal completion. Select incomplete for missing conditions, unsupported claims, or required context outside this page.');
          current.phase = 'composing';
          trace({ kind: 'phase', phase: current.phase });
          const result = { status: support === 'supported' ? 'complete' : 'partial', source: original.result.details,
            limitation: 'One bounded recent original-text page; record integrity is not semantic truth. Preserve truncation, missing context, scope and original attribution.' };
          trace({ kind: 'task-result', ...result, operations: [listing.operationId, original.operationId] });
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        } catch (error) {
          if (signal.aborted || current !== attempt || closed) {
            current.phase = 'cancelled'; trace({ kind: 'phase', phase: 'cancelled' });
            return { content: [{ type: 'text', text: 'The read task was cancelled; no result may be delivered.' }], details: { status: 'cancelled' }, terminate: true };
          }
          current.phase = 'composing';
          trace({ kind: 'phase', phase: current.phase });
          const result = { status: 'unresolved', reason: error instanceof Error ? error.message : 'S0 read task failed' };
          trace({ kind: 'task-result', ...result });
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }
      },
    });
  };
  return { extension, cancel, status: () => ({ closed, phase: attempt?.phase ?? 'passthrough' }) };
}
