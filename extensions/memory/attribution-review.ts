/** Independent bounded participant review; code validates quotes and aliases, never infers who heard. */
type Source = {player_text?: string; keeper_text?: string; known_entities?: unknown[]; present?: unknown[];
    investigators?: unknown[]; committed_facts?: unknown[]; prior?: unknown[]; validation_feedback?: string};
type Candidate = {kind: string; subject: string; statement: string};
export type AttributionReview = {verdict: 'supported' | 'repair'; issues: Array<{candidate: string; source_quote: string; reason: string}>};
export const ATTRIBUTION_REVIEW_INSTRUCTION =
    'Independently check memory extraction against this delivered exchange. Return only ' +
    '{"verdict":"supported|repair","issues":[{"candidate":"issued candidate alias or missing","source_quote":"exact excerpt from player_text or keeper_text","reason":"short English explanation"}]}. ' +
    'Review conditional undertakings even if extraction omitted every promise. Distinguish a pledge to another actor from an unspoken intention. ' +
    'For promises, check the named promisor, recipient and actual hearers. A listener shown acknowledging a pledge must remain in knowers; ' +
    'mere presence or an absent intended recipient does not grant hearing. For relationships, check whose expressed view or cooperation changed ' +
    'toward whom. Do not accept a statement about one actor trusting another as the reverse actor trusting them. ' +
    'An allegation about an absent NPC is not that NPC\'s own stance. Courtesy does not establish friendship. A pledge does not prove fulfillment. ' +
    'Player-selected actions are not completed just because requested. Committed facts and delivered prose are the occurrence evidence; ' +
    'prior reports only disambiguate continuity. Do not adjudicate module truth, rewrite prose, fill missing actors or generate corrected candidates. ' +
    'supported uses issues:[]; repair needs at least one concrete source-grounded issue. Use missing for an omitted pledge or directed change. ' +
    'Copy one contiguous source_quote exactly; do not add quotation marks, punctuation or ellipses, or join separate excerpts. ' +
    'At most 12 issues; each quote at most 300 code points and reason at most 300 code points. An uncertain attribution should be narrowed, not invented.';
export function attributionReviewInput(source: Source, candidates: Candidate[]): string {
    const input=JSON.stringify({player_text: source.player_text ?? '', keeper_text: source.keeper_text ?? '',
        known_entities: source.known_entities ?? [], present: source.present ?? [],
        investigators: (source.investigators ?? []).map(value => typeof value === 'string' ? value : (value as {name?: string})?.name).filter(Boolean),
        committed_facts: source.committed_facts ?? [], prior: (source.prior ?? []).map(value => {
            const row = value as Record<string, unknown>; return {kind: row.kind, subject: row.subject, statement: row.statement, status: row.status};
        }),
        candidates: candidates.map((candidate, i) => ({alias: `candidate ${i+1}`, ...candidate}))});
    return source.validation_feedback ? input+'\n\n[Previous attempt failed: fix the reported shape, reference or attribution problem; retain supported facts without inventing participants]\n'+source.validation_feedback : input;
}
export function shapeAttributionReview(value: unknown, source: Source, count: number): AttributionReview | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    if (Object.keys(row).sort().join(',') !== 'issues,verdict' || !['supported','repair'].includes(String(row.verdict))
        || !Array.isArray(row.issues) || row.issues.length > 12 || (row.verdict === 'supported' ? row.issues.length !== 0 : !row.issues.length)) return undefined;
    const aliases = new Set(['missing', ...Array.from({length: count}, (_, i) => `candidate ${i+1}`)]);
    for (const issue of row.issues) {
        if (!issue || typeof issue !== 'object' || Array.isArray(issue) || Object.keys(issue).sort().join(',') !== 'candidate,reason,source_quote'
            || !aliases.has(issue.candidate) || typeof issue.reason !== 'string' || !issue.reason.trim() || [...issue.reason].length > 300
            || typeof issue.source_quote !== 'string' || !issue.source_quote.trim() || [...issue.source_quote].length > 300
            || ![source.player_text,source.keeper_text].some(text => text?.includes(issue.source_quote))) return undefined;
    }
    return row as unknown as AttributionReview;
}
