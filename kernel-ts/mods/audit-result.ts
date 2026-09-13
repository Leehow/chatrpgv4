/** Shared artifact validation; semantic judgment belongs to the private reviewer. */
export const CONTINUITY_AUDIT = 'audit.continuity.v1';
export const AUDIT_LIMITS = Object.freeze({time_ms: 30000, max_requests: 12, per_review: 6, max_rewrites: 1, max_artifact_repairs: 1});
export type AuditIssue = {path: string; message: string; file?: string; excerpt?: string};
const object = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const words = (v: any, max = 2000) => typeof v === 'string' && !!v.trim() && v.length <= max;
const strings = (v: any): string[] => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

/** A specific structured sub-review is more precise than a contradictory aggregate pass. */
export function normalizeContinuityArtifact(value: any): any {
    if (!object(value) || !object(value.continuity_review)) return value;
    const review = value.continuity_review, specific = review.locus_review?.verdict ?? review.location_review?.verdict;
    if (review.verdict !== 'pass' || specific !== 'revise') return value;
    return {...value, continuity_review: {...review, verdict: 'revise'}};
}

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
    const locationAuthority = object(files['context.json']) && object(files['context.json'].location_authority) && files['context.json'].location_authority.requires_review === true
        ? files['context.json'].location_authority : null;
    const sceneCommitment = object(files['context.json']) && object(files['context.json'].scene_commitment) && files['context.json'].scene_commitment.requires_review === true
        ? files['context.json'].scene_commitment : null;
    const review = value.continuity_review;
    if (!keys(review, ['verdict', 'summary', 'conflicts', ...(locationAuthority ? ['location_review'] : []), ...(sceneCommitment ? ['locus_review'] : [])], '/continuity_review')) return errors;
    if (sceneCommitment && !object(review.locus_review))
        add('/continuity_review/locus_review', 'Required object: {verdict, mode, locus, claim, basis}; do not use location_review');
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
    if (locationAuthority) {
        const location = review.location_review, path = '/continuity_review/location_review';
        if (keys(location, ['verdict', 'current_scene', 'asserted_elsewhere', 'basis'], path)) {
            if (!['pass', 'revise'].includes(location.verdict)) add(`${path}/verdict`, 'Expected pass or revise');
            if (location.current_scene !== locationAuthority.current_scene) add(`${path}/current_scene`, 'Copy the exact current scene from context.json');
            if (!['current_scene', 'move_receipt', 'none'].includes(location.basis)) add(`${path}/basis`, 'Expected current_scene, move_receipt or none');
            const elsewhere = list(location.asserted_elsewhere, `${path}/asserted_elsewhere`, 8);
            for (const [i, quote] of elsewhere.entries()) if (!words(quote, 1000) || !candidate.includes(quote))
                add(`${path}/asserted_elsewhere/${i}`, 'Copy an exact candidate excerpt that asserts another location');
            const moves = Array.isArray(locationAuthority.move_receipts) ? locationAuthority.move_receipts : [];
            if (location.basis === 'move_receipt' && !moves.length) add(`${path}/basis`, 'No settled move receipt supports another location');
            if (elsewhere.length && !moves.length && (location.verdict !== 'revise' || location.basis !== 'none'))
                add(`${path}/verdict`, 'Arrival or residence elsewhere without a move receipt must revise with basis none');
            if (location.verdict === 'revise' && review.verdict !== 'revise') add('/continuity_review/verdict', 'A location revision requires overall revise');
            if (review.verdict === 'pass' && location.verdict !== 'pass') add(`${path}/verdict`, 'Overall pass requires a passing location review');
        }
    }
    if (sceneCommitment) {
        const locus = review.locus_review, path = '/continuity_review/locus_review';
        if (keys(locus, ['verdict', 'mode', 'locus', 'claim', 'basis'], path)) {
            if (!['pass', 'revise'].includes(locus.verdict)) add(`${path}/verdict`, 'Expected pass or revise');
            if (!['same_locus', 'transition', 'new_locus'].includes(locus.mode)) add(`${path}/mode`, 'Expected same_locus, transition or new_locus');
            if (!['active_scene', 'move_receipt', 'none'].includes(locus.basis)) add(`${path}/basis`, 'Expected active_scene, move_receipt or none');
            const moves = Array.isArray(sceneCommitment.moves) ? sceneCommitment.moves : [];
            if (locus.mode === 'new_locus') {
                if (!words(locus.locus, 300)) add(`${path}/locus`, 'Name the persistent gameplay locus');
                if (!words(locus.claim, 1000) || !candidate.includes(locus.claim)) add(`${path}/claim`, 'Copy an exact candidate excerpt establishing the new locus');
                if (locus.basis === 'move_receipt' && !moves.length) add(`${path}/basis`, 'No settled move receipt can support a new locus');
                if (locus.basis === 'none' && locus.verdict !== 'revise') add(`${path}/verdict`, 'An unsupported new locus must revise');
            } else {
                if (locus.locus != null) add(`${path}/locus`, 'same_locus and transition use null locus');
                if (locus.claim != null) add(`${path}/claim`, 'same_locus and transition use null claim');
                if (locus.basis !== 'active_scene') add(`${path}/basis`, 'same_locus and transition use active_scene');
            }
            if (locus.verdict === 'revise' && review.verdict !== 'revise') add('/continuity_review/verdict', 'A locus revision requires overall revise');
            if (review.verdict === 'pass' && locus.verdict !== 'pass') add(`${path}/verdict`, 'Overall pass requires a passing locus review');
        }
    }
    const count = conflicts.length + (Array.isArray(value.findings) ? value.findings.length : 0) + (Array.isArray(value.missing) ? value.missing.length : 0)
        + Number(review.location_review?.verdict === 'revise' || review.locus_review?.verdict === 'revise');
    if (review.verdict === 'pass' && count) add('/continuity_review/verdict', 'Pass cannot contain conflicts, missing objects or findings');
    if (review.verdict === 'revise' && !count) add('/continuity_review/verdict', 'Revise needs an actionable conflict, missing object or finding');
    return errors;
}
