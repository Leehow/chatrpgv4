/** Neutral non-price request policy for the historical transport/library fixtures. */
export function contextPolicy(batch) {
  if (!batch.questions.some(question => question.key === 'query_kind')) return;
  return {status: 'complete', answers: Object.fromEntries(batch.questions.map(question => [question.key,
    question.key === 'query_kind' ? {status: 'answered', type: 'choice', choice: 'context', confidence: 1}
      : {status: 'answered', type: 'noul', noul: question.key.startsWith('saved_') ? 0.9 : 0.01}]))};
}
