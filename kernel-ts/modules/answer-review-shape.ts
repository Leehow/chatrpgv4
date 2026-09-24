/**
 * Contract §22.4.3 (SL-36): whether an independent source-answer review satisfies its protocol, whatever it concluded.
 *
 * One function for both ends of the review, like `obligation-review.ts`: the kernel's publication gate
 * (`checkSourceAnswerReview`) and the host's reviewer (`submit_reading` in the child, `reviewCandidate` after it) load it,
 * so a shape the host lets through is never refused by the gate as if the reviewer had refused the answer. This file has
 * no imports so both sides can load it.
 *
 * Long gate #3, t10 (`longgate3-haunting-1058`, `read-1`): the gate answered every non-`supported` verdict and every
 * missing `reason` with one message, "the independent answer review must support each assigned field with a reason", so a
 * reviewer's slip and a reviewer's refusal could not be told apart. The shape is judged here; the verdict at the gate.
 */
export const ANSWER_REVIEW_PATHS: readonly string[] = Object.freeze(['/status', '/answer', '/source_refs', '/limitations']);
/** The verdicts a well-formed answer review may give (the reviewer instructions in `content/setup/source-answer.md`). */
export const ANSWER_REVIEW_VERDICTS: readonly string[] = Object.freeze(['supported', 'contradicted', 'unclear']);

type Row = Record<string, any>;
const isObject = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const page = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/**
 * The first shape error of `review`, or `null` for a well-formed review. `maxPage` bounds the cited pages; `viewed`, when
 * given, is the set of physical pages the reviewer viewed, and then every cited page (the review's and the answer's
 * `cited`) must be among them.
 */
export function answerReviewShapeError(review: unknown, maxPage: number, viewed?: ReadonlySet<number>, cited: readonly number[] = []): string | null {
    if (!isObject(review)) return 'an answer review must be an object';
    if (!Array.isArray(review.checked) || !Array.isArray(review.missing)) return 'an answer review needs checked and missing arrays';
    const covered = new Set<string>();
    for (const item of review.checked) {
        if (!isObject(item)) return 'each checked entry must be an object';
        if (!ANSWER_REVIEW_VERDICTS.includes(item.verdict)) return `each checked entry needs a verdict of ${ANSWER_REVIEW_VERDICTS.join(', ')}`;
        if (typeof item.reason !== 'string' || !item.reason.trim()) return 'each checked entry needs a nonempty reason';
        const paths = item.paths ?? [item.path];
        if (!Array.isArray(paths) || !paths.length || paths.some(path => !ANSWER_REVIEW_PATHS.includes(path)))
            return `each checked entry names paths among ${ANSWER_REVIEW_PATHS.join(', ')}`;
        if (!Array.isArray(item.source_refs) || !item.source_refs.length
            || item.source_refs.some((ref: unknown) => !isObject(ref) || !page(ref.page) || ref.page > maxPage))
            return 'each checked entry needs source_refs: [{page: physicalPage}] within the source';
        if (viewed && item.source_refs.some((ref: Row) => !viewed.has(ref.page))) return 'answer review cites an original page the reviewer did not view';
        for (const path of paths) covered.add(path);
    }
    if (ANSWER_REVIEW_PATHS.some(path => !covered.has(path))) return 'answer review omitted assigned fields';
    if (viewed && cited.some(value => !viewed.has(value))) return 'the reviewer must view every page cited by the answer';
    return null;
}
