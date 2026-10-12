/** Module publication owns provenance; campaign publication owns adoption. */
import {jsonDigest, compareUnicode} from '../json.js';
import {array, clone, row, string, type Row} from '../read/values.js';
import {checkedCharacterProfile} from '../modules/character-profile-shape.js';
import type {ModuleGraph} from '../read/module-graph.js';

export function profileSourceRevision(raw: Row, node: Row): string {
 const properties = clone(row(node.properties));
 delete properties.character_profile;
 const projection = row(properties.runtime_projection);
 if (projection.record) { projection.record = {...row(projection.record)}; delete projection.record.character_profile; }
 return jsonDigest({name: node.name, summary: node.summary, properties, source_refs: node.source_refs ?? [],
  relations: array(raw.relations).filter(r => !r.campaign_origin && (r.from_node_id === node.node_id || r.to_node_id === node.node_id))
   .map(r => ({kind: r.relation_kind, from: r.from_node_id, to: r.to_node_id, properties: r.properties ?? {}, claim: r.claim_id ?? null,
       evidence: array(raw.claims).find(c => c.claim_id === r.claim_id) ?? null}))
   .sort((a,b) => compareUnicode(JSON.stringify(a), JSON.stringify(b)))});
}
export function moduleCharacterProfile(graph: ModuleGraph, node: Row): Row | null {
 if (!graph.isPerson(node)) return null;
 const envelope = row(row(node.properties).character_profile), raw = graph.raw;
 const profile = checkedCharacterProfile(envelope);
 if (!profile || envelope.origin !== 'module_derived' || envelope.policy_version !== 1
  || envelope.content_revision !== jsonDigest(profile) || envelope.source_revision !== profileSourceRevision(raw, node)) return null;
 return {...profile, origin: 'module_derived', source_revision: envelope.source_revision, content_revision: envelope.content_revision};
}
/** Only the existing graph publisher invokes this on a supported candidate after canonical assembly. */
export function publishCharacterProfiles(raw: Row, accepted: Row[], provenance: Row): void {
 for (const draft of accepted) {
  const node = array(raw.nodes).find(n => n.node_id === draft.node_id);
  if (!node || node.node_kind !== 'npc') continue;
  const profile = checkedCharacterProfile(row(draft.properties).character_profile);
  if (!profile) continue;
  if (['name', 'summary'].some(k => draft[k] !== undefined && draft[k] !== node[k])) continue;
  if (Object.entries(row(draft.properties)).some(([k,v]) => !['character_profile', 'runtime_projection'].includes(k)
      && jsonDigest(v) !== jsonDigest(row(node.properties)[k] ?? null))) continue;
  profile.basis = profile.basis.map((b: Row) => ({...b, source_refs: b.source_refs.map((r: Row) => r.page !== undefined
   ? {source_id: `pdf:${string(raw.module_id)}`, pdf_index: r.page - 1, ...(r.box ? {box: r.box} : {})} : r)}));
  node.properties ??= {};
  node.properties.character_profile = {...profile, origin: 'module_derived', policy_version: 1,
   source_revision: profileSourceRevision(raw, node), content_revision: jsonDigest(profile), author: clone(provenance)};
 }
}
