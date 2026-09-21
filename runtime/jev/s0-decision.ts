/** Bounded S0 transport only. Production packing/retry/cache policy remains T07. */
import { bindDecisionAnswers, type DecisionBatch, type DecisionUsage, type Json } from './contracts.ts';

export const S0_JEV_MODEL = 'jev-1.13.0';
export interface S0ChoiceRequest { state: Json; criteria: Record<string, string>; instructions: string; signal: AbortSignal }
export interface S0ChoiceResult { choice: string; usage: DecisionUsage; elapsedMs: number; model: string }
export type S0Decide = (request: S0ChoiceRequest) => Promise<S0ChoiceResult>;

export function createS0Decider(apiKey: string, fetcher: typeof fetch = fetch): S0Decide {
  if (!apiKey) throw new Error('S0 Jev credential is unavailable');
  return async request => {
    request.signal.throwIfAborted();
    const started = performance.now();
    const question = { type: 'choice' as const, instructions: request.instructions, criteria: request.criteria };
    const body = JSON.stringify({ model: S0_JEV_MODEL, state: request.state, questions: { selection: question } });
    if (Buffer.byteLength(body, 'utf8') > 48_000) throw new Error('S0 decision exceeds its bounded request size');
    const response = await fetcher('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body, signal: request.signal, redirect: 'error',
    });
    if (!response.ok) throw new Error(`S0 Jev HTTP ${response.status}`);
    const raw = await response.json() as Record<string, any>;
    request.signal.throwIfAborted();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some(key => !['model', 'answers', 'usage'].includes(key))
      || raw.model !== S0_JEV_MODEL || !raw.answers?.selection || Object.keys(raw.answers).length !== 1)
      throw new Error('S0 Jev model or answer coverage mismatch');
    const usage = { inputTokens: raw.usage?.input_tokens, outputTokens: raw.usage?.output_tokens };
    const batch: DecisionBatch = { id: 's0-local', model: S0_JEV_MODEL, family: 's0-recall', familyVersion: '1',
      scope: { owner: 's0', audience: 'keeper' }, readSet: [], state: request.state,
      questions: [{ ...question, key: 'selection', target: 'candidates' }] };
    const normalized = bindDecisionAnswers(batch, { selection: { status: 'answered', ...raw.answers.selection } }, usage);
    const answer = normalized.answers.selection;
    if (normalized.status !== 'complete' || answer?.status !== 'answered' || answer.type !== 'choice')
      throw new Error('S0 Jev selection is incomplete');
    return { choice: answer.choice, usage, elapsedMs: performance.now() - started, model: S0_JEV_MODEL };
  };
}
