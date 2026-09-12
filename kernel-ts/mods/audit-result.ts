/** Shared artifact validation; semantic judgment belongs to the private reviewer. */
export const CONTINUITY_AUDIT = 'audit.continuity.v1';
export const AUDIT_LIMITS = Object.freeze({time_ms: 30000, max_requests: 12, per_review: 6, max_rewrites: 1, max_artifact_repairs: 1});
export type AuditIssue = {path: string; message: string; file?: string; excerpt?: string};
const object = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const words = (v: any, max = 2000) => typeof v === 'string' && !!v.trim() && v.length <= max;
const strings = (v: any): string[] => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

export function continuityArtifactErrors(value: any, candidate: string, files: Record<string, unknown>): AuditIssue[] {
    const errors: AuditIssue[] = [];
    const add = (path: string, message: string, extra = {}) => { errors.push({path, message, ...extra}); };
    const keys = (v: any, names: string[], path: string) => {
        if (!object(v)) { add(path, 'Expected an object'); return false; }
        for (const name of names) if (!Object.hasOwn(v, name)) add(`${path}/${name}`, 'Required field is missing');
        for (const name of Object.keys(v)) if (!names.includes(name)) add(`${path}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`, 'Unexpected field');
        return true;
    };
    const list = (v: any, path: string, max: number): any[] => {
        if (!Array.isArray(v)) { add(path, 'Expected an array'); return []; }
        if (v.length > max) add(path, `At most ${max} entries are allowed`);
        return v.slice(0, max);
    };
    if (!keys(value, ['missing', 'findings', 'continuity_review'], '')) return errors;
    for (const [i, v] of list(value.missing, '/missing', 16).entries()) {
        const path = `/missing/${i}`;
        if (!keys(v, ['name', 'category', 'reason'], path)) continue;
        for (const name of ['name', 'reason']) if (!words(v[name])) add(`${path}/${name}`, 'Expected nonempty bounded text');
        if (!['weapon', 'spell', 'item'].includes(v.category)) add(`${path}/category`, 'Expected weapon, spell or item');
    }
    for (const [i, v] of list(value.findings, '/findings', 10).entries()) {
        const path = `/findings/${i}`;
        if (!keys(v, ['reason', 'fix'], path)) continue;
        for (const name of ['reason', 'fix']) if (!words(v[name])) add(`${path}/${name}`, 'Expected nonempty bounded text');
    }
    const review = value.continuity_review;
    if (!keys(review, ['verdict', 'summary', 'conflicts'], '/continuity_review')) return errors;
    if (!['pass', 'revise', 'unavailable'].includes(review.verdict)) add('/continuity_review/verdict', 'Expected pass, revise or unavailable');
    if (!words(review.summary)) add('/continuity_review/summary', 'Expected nonempty bounded text');
    const evidenceStrings = new Map<string, string[]>(), conflicts = list(review.conflicts, '/continuity_review/conflicts', 10);
    for (const [i, v] of conflicts.entries()) {
        const path = `/continuity_review/conflicts/${i}`;
        if (!keys(v, ['claim', 'reason', 'evidence'], path)) continue;
        if (!words(v.claim) || !candidate.includes(v.claim)) add(`${path}/claim`, 'Copy an exact excerpt from the candidate', {excerpt: String(v.claim).slice(0, 2000)});
        if (!words(v.reason)) add(`${path}/reason`, 'Expected nonempty bounded text');
        const evidence = list(v.evidence, `${path}/evidence`, 3);
        if (!evidence.length) add(`${path}/evidence`, 'A conflict needs evidence of the conflicting established fact or choice');
        for (const [j, e] of evidence.entries()) {
            const at = `${path}/evidence/${j}`;
            if (!keys(e, ['file', 'quote'], at)) continue;
            if (typeof e.file !== 'string' || !Object.hasOwn(files, e.file)) {
                add(`${at}/file`, `Choose a supplied evidence file: ${Object.keys(files).join(', ')}`, {file: String(e.file)}); continue;
            }
            if (!words(e.quote, 1000)) { add(`${at}/quote`, 'Expected a nonempty excerpt of at most 1000 characters', {file: e.file}); continue; }
            if (!evidenceStrings.has(e.file)) evidenceStrings.set(e.file, strings(files[e.file]));
            if (!evidenceStrings.get(e.file)!.some(text => text.includes(e.quote)))
                add(`${at}/quote`, 'Copy an exact string-value excerpt, without JSON keys or punctuation', {file: e.file, excerpt: e.quote});
        }
    }
    const count = conflicts.length + (Array.isArray(value.findings) ? value.findings.length : 0) + (Array.isArray(value.missing) ? value.missing.length : 0);
    if (review.verdict === 'pass' && count) add('/continuity_review/verdict', 'Pass cannot contain conflicts, missing objects or findings');
    if (review.verdict === 'revise' && !count) add('/continuity_review/verdict', 'Revise needs an actionable conflict, missing object or finding');
    return errors;
}
