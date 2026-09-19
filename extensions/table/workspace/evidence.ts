/** Capture and consume verified static bodies. The kernel owns provenance; this owns residency. */
import {createHash} from 'node:crypto';
import {EvidenceStore, evidenceId, type EvidenceInput} from './evidence-store.ts';
import {object, type Row} from '../context-policy.ts';

const sourceRevision = (binding: Row): string => createHash('sha256')
    .update(JSON.stringify([binding.source_revision, binding.rules_revision, binding.adapter])).digest('hex');

/** Restore dormant scene/entity references only after the current snapshot verified their scope. */
export async function dormantEvidence(root: string, snapshot: Row, limit: number, signal: AbortSignal): Promise<Row[]> {
    const binding = object(snapshot.binding);
    if (snapshot.status !== 'valid' || object(snapshot.authority).checked !== true || !binding.scene || signal.aborted) return [];
    const store = new EvidenceStore(root), expected = {scope: {campaign: binding.campaign, worldline: binding.worldline, loop: binding.loop},
        source_revision: sourceRevision(binding), authorities: ['module_source', 'rules_source', 'campaign_adaptation'] as const};
    const entities = new Set(Array.isArray(snapshot.relevant_entities) ? snapshot.relevant_entities : []);
    const currentRefs = object(snapshot.candidates).static;
    const threads = new Set((Array.isArray(currentRefs) ? currentRefs : []).filter(ref => Array.isArray(ref.scene_refs) && ref.scene_refs.includes(binding.scene))
        .flatMap(ref => Array.isArray(ref.thread_refs) ? ref.thread_refs : []));
    const restored: Row[] = [];
    try {
        for (const ref of await store.manifest(expected, limit)) {
            if (signal.aborted) return [];
            if (!ref.scene_refs.includes(binding.scene) && !ref.entity_refs.some(entity => entities.has(entity))
                && !ref.thread_refs.some(thread => threads.has(thread))) continue;
            const result = await store.read(ref.id, expected);
            if (signal.aborted) return [];
            if (result.status !== 'valid') continue;
            restored.push({locator: ref.locator, kind: ref.locator.slice(0, ref.locator.indexOf(':')), scope: expected.scope,
                authority: ref.authority, audience: 'keeper_only', source_revision: binding.source_revision,
                adapter: binding.adapter, ...(ref.authority === 'rules_source' ? {rules_revision: binding.rules_revision} : {}),
                coverage: ref.coverage, body: result.body, text: result.body,
                scene_refs: ref.scene_refs, entity_refs: ref.entity_refs, thread_refs: ref.thread_refs});
        }
    } catch {return [];}
    return restored;
}

export async function reuseEvidence(root: string, snapshot: Row, candidates: Row[], signal: AbortSignal): Promise<{candidates: Row[]; hits: number; stored: number; misses: number}> {
    const store = new EvidenceStore(root), binding = object(snapshot.binding);
    const revision = sourceRevision(binding);
    let hits = 0, stored = 0, misses = 0;
    const result: Row[] = [];
    for (const candidate of candidates.slice(0, 128)) {
        if (signal.aborted) break;
        if (typeof candidate.body !== 'string' || !['module_source', 'rules_source', 'campaign_adaptation'].includes(candidate.authority)) {
            result.push(candidate); continue;
        }
        const input: EvidenceInput = {scope: {campaign: binding.campaign, worldline: binding.worldline, loop: binding.loop},
            source_revision: revision, authority: candidate.authority, locator: candidate.locator, body: candidate.body,
            coverage: candidate.coverage, scene_refs: candidate.scene_refs, entity_refs: candidate.entity_refs, thread_refs: candidate.thread_refs};
        const expected = {scope: input.scope, source_revision: revision};
        try {
            let read = await store.read(evidenceId(input), expected);
            if (signal.aborted) break;
            if (read.status === 'valid') hits++;
            else {
                const ref = await store.put(input);
                if (signal.aborted) break;
                read = await store.read(ref.id, expected); stored++;
            }
            result.push(read.status === 'valid' ? {...candidate, body: read.body, text: read.body} : candidate);
            if (read.status !== 'valid') misses++;
        } catch {misses++; result.push(candidate);}
    }
    return {candidates: result, hits, stored, misses};
}
