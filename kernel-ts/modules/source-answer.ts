/** A checked consultation is source evidence, never prepared graph material. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { array, integer, number, row, string, type Row } from '../read/values.js';
import { answerReviewShapeError } from './answer-review-shape.js';

export const SOURCE_ANSWER_PROTOCOL = 'source-answer-v1';
export { ANSWER_REVIEW_PATHS } from './answer-review-shape.js';
const statuses = ['answered', 'unresolved', 'conflict', 'requires_preparation'];
const fail = (message: string): never => { throw new RpcError('invalid_params', message, { fix: 'repair the scoped answer against original pages; do not publish graph material through a consultation' }); };

export function checkSourceAnswer(value: unknown, packet: Row, seen?: Set<any>): Row {
    if (!isJsonObject(value)) fail('a source answer must be an object');
    const draft = value as Row;
    if (Object.keys(draft).sort().join(',') !== 'answer,limitations,source_refs,status') fail('a source answer needs exactly status, answer, source_refs and limitations fields');
    if (!statuses.includes(draft.status)) fail('source answer status must be answered, unresolved, conflict or requires_preparation');
    if (typeof draft.answer !== 'string' || !draft.answer.trim() || Array.from(draft.answer).length > 6000) fail('a source answer needs bounded nonempty answer text');
    if (typeof draft.limitations !== 'string' || Array.from(draft.limitations).length > 2000) fail('source answer limitations must be a bounded string');
    if (draft.status !== 'answered' && !draft.limitations.trim()) fail('an unavailable answer must explain its limitations');
    if (!Array.isArray(draft.source_refs) || !draft.source_refs.length || draft.source_refs.length > 64) fail('a source answer needs bounded original-page references');
    const max = number(row(packet.source).page_count);
    for (const ref of draft.source_refs) {
        if (!isJsonObject(ref) || Object.keys(ref).join(',') !== 'page' || !integer(ref.page) || number(ref.page) < 1 || number(ref.page) > max) fail('answer references must name valid physical source pages');
        if (seen && ![...seen].some(page => number(page) === number(ref.page))) fail('answer cites an original page the author did not view');
    }
    return draft;
}

/**
 * §22.4.1, as amended by §22.4.3 (SL-36). A malformed review is `answer_review_malformed`: the reviewer's slip, re-asked
 * as a reviewer. A well-formed review that does not support every assigned field, or that names missing support, is
 * `answer_review_refused`, with the first refused path and the reviewer's reason: the only review that refuses the read.
 */
export function checkSourceAnswerReview(draft: Row, review: Row, packet: Row, seen: Set<any>): void {
    const max = number(row(packet.source).page_count), viewed = new Set([...seen].map(number));
    const malformed = answerReviewShapeError(review, max, viewed, array(draft.source_refs).map(ref => number(ref.page)));
    if (malformed) throw new RpcError('invalid_params', `the independent answer review is malformed: ${malformed}`, {
        fix: 'the reviewer writes its review again in the protocol shape; the answer itself was not judged',
        details: { reason: 'answer_review_malformed' } });
    const refused = array(review.checked).find(item => item.verdict !== 'supported');
    if (refused) {
        const path = string(array(refused.paths ?? [refused.path])[0]);
        throw new RpcError('invalid_params', `the independent answer review found ${path} ${refused.verdict}: ${string(refused.reason).slice(0, 600)}`, {
            fix: 'repair the scoped answer against original pages; do not publish graph material through a consultation',
            details: { reason: 'answer_review_refused', path, rule: string(refused.verdict) } });
    }
    if (array(review.missing).length) throw new RpcError('invalid_params', 'the independent answer review found missing source support', {
        fix: 'repair the scoped answer against original pages; do not publish graph material through a consultation',
        details: { reason: 'answer_review_refused', rule: 'missing' } });
}

export function sourceAnswerResult(draft: Row, moduleId: string): Row {
    return { ...draft, source_refs: draft.source_refs.map((ref: Row) => ({ source_id: `pdf:${moduleId}`, pdf_index: number(ref.page) - 1 })),
        authority: 'source-consultation', prepared: false, supported: draft.status === 'answered' };
}
