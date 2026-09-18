/** A checked consultation is source evidence, never prepared graph material. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { array, integer, number, row, type Row } from '../read/values.js';

export const SOURCE_ANSWER_PROTOCOL = 'source-answer-v1';
export const ANSWER_REVIEW_PATHS = ['/status', '/answer', '/source_refs', '/limitations'];
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

export function checkSourceAnswerReview(draft: Row, review: Row, packet: Row, seen: Set<any>): void {
    const max = number(row(packet.source).page_count), viewed = new Set([...seen].map(number)), checked = new Set<string>();
    if (!Array.isArray(review.checked) || !Array.isArray(review.missing) || review.missing.length) fail('the independent answer review found missing source support');
    for (const item of review.checked) {
        if (!isJsonObject(item) || item.verdict !== 'supported' || typeof item.reason !== 'string' || !item.reason.trim()) fail('the independent answer review must support each assigned field with a reason');
        const paths = item.paths ?? [item.path];
        if (!Array.isArray(paths) || !paths.length || paths.some(path => !ANSWER_REVIEW_PATHS.includes(path))) fail('answer review contains an unassigned field');
        if (!Array.isArray(item.source_refs) || !item.source_refs.length || item.source_refs.some((ref: Row) => !isJsonObject(ref) || !integer(ref.page) || number(ref.page) < 1 || number(ref.page) > max || !viewed.has(number(ref.page)))) fail('answer review cites an original page the reviewer did not view');
        for (const path of paths) checked.add(path);
    }
    if (ANSWER_REVIEW_PATHS.some(path => !checked.has(path))) fail('answer review omitted assigned fields');
    if (array(draft.source_refs).some(ref => !viewed.has(number(ref.page)))) fail('the reviewer must view every page cited by the answer');
}

export function sourceAnswerResult(draft: Row, moduleId: string): Row {
    return { ...draft, source_refs: draft.source_refs.map((ref: Row) => ({ source_id: `pdf:${moduleId}`, pdf_index: number(ref.page) - 1 })),
        authority: 'source-consultation', prepared: false, supported: draft.status === 'answered' };
}
