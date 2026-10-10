/** Structural scheduling shared by request attachment, claim and host admission. */
type Job = {purpose?: unknown; foreground?: unknown; reference_fragment?: unknown; source_unit?: unknown; reference_stream?: unknown};
export const readingFocusDomain = (job: Job): 'answer' | 'publication' => job.purpose === 'answer' ? 'answer' : 'publication';
export const sameReadingFocusDomain = (left: Job, right: Job): boolean => readingFocusDomain(left) === readingFocusDomain(right);
export const attachesReadingFocus = (job: Job): boolean => ['answer', 'opening', 'detail'].includes(String(job.purpose));
function workPriority(job: Job): number {
    if (job.purpose === 'opening') return 1;
    if (job.reference_fragment) return 2;
    if (job.reference_stream && job.purpose === 'index') return 5;
    if (job.source_unit) return 4;
    return job.purpose === 'index' ? 3 : 2;
}
export const readingPriority = (job: Job): number => job.foreground === true ? 0 : workPriority(job);
export const compareReadingPriority = (left: Job, right: Job): number =>
    readingPriority(left) - readingPriority(right) || workPriority(left) - workPriority(right);
