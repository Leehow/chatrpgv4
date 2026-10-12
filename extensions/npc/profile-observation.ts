/** Observe compact profiles in the serialized adapter payload, without logging their private content. */
import {createHash} from 'node:crypto';
import {validCharacterProfileContent} from '../../kernel-ts/modules/character-profile-shape.ts';
const canonical = (value: any): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
 : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
function visitPayload(payload: unknown, inspect: (value: any) => void): void {
 let remaining = 12000;
 const visit = (value: any, depth: number): void => {
  if (--remaining < 0 || depth > 24 || value == null) return;
  if (typeof value === 'string') {
   if (value.length < 250000 && (value.trimStart().startsWith('{') || value.trimStart().startsWith('['))) {
    try {visit(JSON.parse(value), depth + 1);} catch { /* Not a JSON content block. */ }
   }
  } else if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
  else if (typeof value === 'object') {
   inspect(value);
   for (const item of Object.values(value)) visit(item, depth + 1);
  }
 };
 visit(payload, 0);
}
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export function profilePayloadDigests(payload: unknown): string[] {
 const found = new Set<string>();
 visitPayload(payload, value => {if (value.origin === 'module_derived' && validCharacterProfileContent(value.profile)) found.add(digest(value.profile));});
 return [...found].sort();
}
/** Receiver-scoped evidence in actual adapter JSON; metadata only, never a narrative/knowledge authority. */
export function npcMemoryPayloadDigests(payload: unknown): Array<{npc: string; commitment_digests: string[]; promise_history_digests: string[]; relationship_digests: string[]}> {
 const found = new Map<string, {promises: Set<string>; history: Set<string>; relationships: Set<string>}>();
 visitPayload(payload, value => {
  if (typeof value.name !== 'string' || !value.name.trim()) return;
  const promises = Array.isArray(value.commitments) ? value.commitments.filter((r: any) => r?.kind === 'promise' && typeof r.statement === 'string') : [];
  const history = Array.isArray(value.history?.promises) ? value.history.promises.filter((r: any) => typeof r?.statement === 'string') : [];
  const ties = Array.isArray(value.relationships) ? value.relationships.filter((r: any) => typeof r?.toward === 'string' && Array.isArray(r.evidence)) : [];
  if (!promises.length && !history.length && !ties.length) return;
  const entry = found.get(value.name) ?? {promises: new Set<string>(), history: new Set<string>(), relationships: new Set<string>()};
  for (const r of promises) entry.promises.add(digest({subject: r.subject, entities: r.entities ?? [], statement: r.statement}));
  // Compact owned promises omit subject/entities; observe that representation without inventing either.
  for (const r of history) entry.history.add(digest({representation: 'history.promises', statement: r.statement}));
  for (const tie of ties) for (const r of tie.evidence) if (r?.kind === 'relationship' && typeof r.statement === 'string')
   entry.relationships.add(digest({subject: value.name, toward: tie.toward, statement: r.statement}));
  found.set(value.name, entry);
 });
 return [...found].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([npc, entry]) => ({npc,
  commitment_digests: [...entry.promises].sort(), promise_history_digests: [...entry.history].sort(),
  relationship_digests: [...entry.relationships].sort()}));
}
