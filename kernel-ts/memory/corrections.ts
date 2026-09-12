/** A model selects corrections; the kernel binds exact retained statements and never judges their meaning. */
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {array, normalize, number, string, type Row} from '../read/values.js';

export const referenceKey = (value: Row): string => JSON.stringify([normalize(value.subject), string(value.statement).trim()]);
export function validateCorrectionRefs(value: unknown): Row[] {
    if (!Array.isArray(value) || value.length > 12 || value.some(ref => !isJsonObject(ref)
        || Object.keys(ref).length !== 2 || !['subject', 'statement'].every(key => typeof ref[key] === 'string' && ref[key].trim() && ref[key].length <= 400)))
        throw new RpcError('invalid_params', 'corrects must contain at most 12 exact {subject, statement} references from correction_targets');
    return value.map(ref => ({subject: ref.subject.trim(), statement: ref.statement.trim()}));
}
export function bindCorrectionRefs(refs: Row[], offered: Row[], rows: Row[], turn: number): string[] {
    const allowed = new Set(offered.map(referenceKey)), ids = new Set<string>();
    for (const ref of refs) {
        const key = referenceKey(ref);
        if (!allowed.has(key)) throw new RpcError('invalid_params', 'A correction target was not supplied in this job',
            {fix: 'Copy a subject and statement from correction_targets; do not infer an identifier'});
        const matches = rows.filter(row => referenceKey(row) === key && number(row.valid_from_turn) < turn);
        if (!matches.length) throw new RpcError('invalid_params', 'A correction must name an earlier retained assertion');
        for (const match of matches) ids.add(string(match.id));
    }
    return [...ids];
}
/** Also retires identical assertions arriving through late extraction; history and original text stay intact. */
export function applyCorrectionLinks(rows: Row[]): string[] {
    const byId = new Map(rows.map(row => [row.id, row])), changed = new Set<string>();
    const corrections = rows.filter(row => row.kind === 'keeper_correction' && row.superseded_by == null && array(row.corrects).length)
        .sort((a, b) => number(a.valid_from_turn) - number(b.valid_from_turn));
    for (const correction of corrections) {
        if (correction.superseded_by != null) continue;
        const keys = new Set(array(correction.corrects).flatMap(id => byId.has(id) ? [referenceKey(byId.get(id)!)] : []));
        const targets = new Set<string>(array(correction.corrects));
        for (const old of rows) {
            if (number(old.valid_from_turn) >= number(correction.valid_from_turn) || !keys.has(referenceKey(old))) continue;
            targets.add(string(old.id));
            if (old.superseded_by != null) continue;
            old.status = 'superseded'; old.superseded_by = correction.id; old.valid_until_turn = correction.valid_from_turn;
            changed.add(string(old.id));
        }
        correction.corrects = [...targets];
    }
    return [...changed];
}
