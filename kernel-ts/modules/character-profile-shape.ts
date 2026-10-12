/** Optional interpretation is reviewed separately from the person's source statements (§229). */
type Row = Record<string, any>;
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const keys = (v: Row, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
export const characterProfilePath = (path: unknown): boolean => typeof path === 'string' &&
 /^\/nodes\/\d+\/properties\/character_profile(?:\/|$)/.test(path);
export function validCharacterProfileContent(p: unknown): p is Row {
 if (!object(p)) return false;
 if (!keys(p, ['priorities', 'tendencies', 'expression'])) return false;
 if (p.priorities !== undefined && (!Array.isArray(p.priorities) || p.priorities.length > 2 || !p.priorities.every(text))) return false;
 if (p.tendencies !== undefined && (!Array.isArray(p.tendencies) || p.tendencies.length > 3 || !p.tendencies.every((t: unknown) =>
  object(t) && keys(t, ['context', 'inclination', 'exception']) && text(t.context) && text(t.inclination) && (t.exception === undefined || text(t.exception))))) return false;
 if (p.expression !== undefined && !text(p.expression)) return false;
 return Object.keys(p).some(k => k === 'expression' ? text(p[k]) : p[k]?.length) && Array.from(JSON.stringify(p)).length <= 1200;
}
export function checkedCharacterProfile(value: unknown, count = Infinity, seen?: ReadonlySet<number>, published = true): Row | null {
 if (!object(value) || value.schema_version !== 1 || !validCharacterProfileContent(value.profile) || !Array.isArray(value.basis)) return null;
 const p = value.profile;
 const populated = Object.keys(p).filter(k => k === 'expression' ? text(p[k]) : p[k]?.length);
 if (!populated.length || value.basis.length > 3) return null;
 const fields = new Set<string>();
 for (const b of value.basis) {
  if (!object(b) || !keys(b, ['field', 'derivation', 'source_refs']) || !populated.includes(b.field) || fields.has(b.field)
   || !['source_paraphrase', 'interpretation'].includes(b.derivation) || !Array.isArray(b.source_refs) || !b.source_refs.length
   || b.source_refs.length > 16 || !b.source_refs.every((r: unknown) => object(r) &&
    (Number.isInteger(r.page) && r.page > 0 && r.page <= count && (!seen || seen.has(r.page)) ||
     published && Number.isInteger(r.pdf_index) && r.pdf_index >= 0 && r.pdf_index < count && text(r.source_id) && (!seen || seen.has(r.pdf_index + 1))))) return null;
  fields.add(b.field);
 }
 return populated.every(k => fields.has(k)) ? {schema_version: 1, profile: structuredClone(p), basis: structuredClone(value.basis)} : null;
}
