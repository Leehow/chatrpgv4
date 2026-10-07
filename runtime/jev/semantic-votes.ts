/** Three correlated views of one semantic proposition; no transport or execution authority. */
import {probabilityMassValid, type DecisionQuestion, type DecisionResult} from './contracts.ts';

const SUFFIXES = ['', '__semantic_facts', '__semantic_execution'] as const;
const FOCUS = [
  'Read this same proposition from the current declaration; distinguish an actual choice from a merely mentioned possibility.',
  'Read this same proposition from the supplied facts; do not invent absent choices or facts.',
  'Read this same proposition in the current execution context; distinguish this current attempt from future or hypothetical activity.',
] as const;
export function semanticQuestions(question: DecisionQuestion): DecisionQuestion[] {
  if (question.type === 'score') return [question];
  return SUFFIXES.map((suffix, index) => ({...structuredClone(question), key: question.key + suffix,
    instructions: `${question.instructions} ${FOCUS[index]}`}));
}
function answers(result: DecisionResult | undefined, key: string) {
  return result && result.status !== 'unavailable' ? SUFFIXES.map(suffix => result.answers?.[key + suffix]) : [];
}
export function semanticNoul(result: DecisionResult | undefined, key: string): {score?: number; answered: number; total: number; spread?: number} {
  const values = answers(result, key).flatMap(answer => answer?.status === 'answered' && answer.type === 'noul'
    && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1 ? [answer.noul] : []);
  return {answered: values.length, total: SUFFIXES.length, ...(values.length ? {
    score: values.reduce((sum, value) => sum + value, 0) / values.length,
    spread: Math.max(...values) - Math.min(...values)} : {})};
}
export function semanticChoice(result: DecisionResult | undefined, key: string, options: string[]): {
  choice?: string; distribution: Record<string, number> | null; answered: number; total: number; spread?: number; confidence?: number;
} {
  const vocabulary = [...new Set(options)], distributions: Record<string, number>[] = [];
  for (const answer of answers(result, key)) {
    if (answer?.status !== 'answered' || answer.type !== 'choice' || !vocabulary.includes(answer.choice) || !answer.probabilities) continue;
    const probabilities = answer.probabilities, keys = Object.keys(probabilities);
    if (keys.length !== vocabulary.length || keys.some(option => !vocabulary.includes(option))) continue;
    const values = vocabulary.map(option => probabilities[option]);
    if (!probabilityMassValid(values)) continue;
    distributions.push(Object.fromEntries(vocabulary.map(option => [option, probabilities[option]])));
  }
  const evidence = {answered: distributions.length, total: SUFFIXES.length};
  if (!distributions.length) return {...evidence, distribution: null};
  const distribution = Object.fromEntries(vocabulary.map(option => [option,
    distributions.reduce((sum, view) => sum + view[option], 0) / distributions.length]));
  const top = Math.max(...Object.values(distribution)), leaders = vocabulary.filter(option => Math.abs(distribution[option] - top) <= 1e-12);
  const choice = leaders.length === 1 ? leaders[0] : vocabulary.includes('unknown') ? 'unknown' : undefined;
  const spread = Math.max(...vocabulary.map(option => {
    const values = distributions.map(view => view[option]); return Math.max(...values) - Math.min(...values);
  }));
  // Derived diagnostic only; never average supplied Choice confidence or use this as permission.
  const confidence = vocabulary.length > 1 ? Math.max(0, Math.min(1, (vocabulary.length * top - 1) / (vocabulary.length - 1))) : 1;
  return {...evidence, choice, distribution, spread, confidence};
}
