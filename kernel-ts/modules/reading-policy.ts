/** Structural scheduling shared by request attachment, claim and host admission. */
type Job = {purpose?: unknown; material?: unknown; current_scene?: unknown; foreground?: unknown; reference_fragment?: unknown; source_unit?: unknown; reference_stream?: unknown};
export const readingFocusDomain = (job: Job): 'answer' | 'publication' => job.purpose === 'answer' ? 'answer' : 'publication';
export const sameReadingFocusDomain = (left: Job, right: Job): boolean => readingFocusDomain(left) === readingFocusDomain(right);
export const attachesReadingFocus = (job: Job): boolean => ['answer', 'opening', 'detail'].includes(String(job.purpose));
function workPriority(job: Job): number {
    // §257.15: the exhibits read of the scene the table is in is the first background work after an opening, since play there
    // runs on it now; any other scene's exhibits read is the least urgent and never goes ahead of a read another flow asked for.
    if (job.material === 'exhibits') return job.current_scene === true ? 1.5 : 6;
    if (job.purpose === 'opening') return 1;
    if (job.reference_fragment) return 2;
    if (job.reference_stream && job.purpose === 'index') return 5;
    if (job.source_unit) return 4;
    return job.purpose === 'index' ? 3 : 2;
}
export const readingPriority = (job: Job): number => job.foreground === true ? 0 : workPriority(job);
export const compareReadingPriority = (left: Job, right: Job): number =>
    readingPriority(left) - readingPriority(right) || workPriority(left) - workPriority(right);
/** §262.1: lean reading streams no source units; material is read when play asks for it. */
export const leanReading = (env: NodeJS.ProcessEnv = process.env): boolean => env.PI_COC_LEAN_READING === '1';
