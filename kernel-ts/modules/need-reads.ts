/**
 * §151.4: a background read queued from a retained source need locates first. The kernel owns the job's marker, what
 * its claim packet carries, when a settled need may be read again, and the disposition it records; the host runs Jev and
 * reports what it found. Nothing here reads meaning: pages, units and digests only.
 */
import { jsonDigest } from '../json.js';
import { array, clone, integer, number, row, type Row } from '../read/values.js';
import { sourceUnitKey, sourceUnitPages, type SourceUnit } from './background-source.js';
import { sourceNeedKey } from './source-needs.js';

/** The retained need kinds a background reading can close; `runtime_context` waits for live play instead. */
export const READABLE_NEED_KINDS = ['deferred', 'source_read', 'uncertain'];
/** The dispositions that settle a need attempt without an author (§151.4 steps 1-3); `read` is a publication. */
export const SETTLED_DISPOSITIONS = ['answered', 'unlocated', 'carried'];
/** At most this many carried questions ride on one unit task. */
const CARRIED_PER_UNIT = 4;
/** Evidence bounds: a settled record keeps what the decision was made on, never an unbounded host payload. */
const EVIDENCE_PAGES = 64, EVIDENCE_LEADS = 32;

export function retainedNeed(raw: Row, key: unknown): Row | undefined {
    return typeof key === 'string' ? array(raw.source_needs).find(need => sourceNeedKey(need) === key) : undefined;
}

/** The claims about an entity (as subject or object), in digest order. */
function entityClaims(raw: Row, nodeId: string): Row[] {
    return array(raw.claims).filter(claim => row(claim).subject_id === nodeId || row(row(claim).object).node_id === nodeId)
        .map(claim => [jsonDigest(claim), claim] as const).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, claim]) => claim);
}
/** The bound-PDF pages (1-based) the given source references cite. */
function citedPages(refs: unknown[], moduleId: string): number[] {
    const pages = new Set<number>();
    for (const ref of refs)
        if (row(ref).source_id === `pdf:${moduleId}` && integer(row(ref).pdf_index)) pages.add(number(row(ref).pdf_index) + 1);
    return [...pages].sort((a, b) => a - b);
}

/** The entity's accepted material: the bound-PDF pages its node and every claim about it cite, and a digest of both. */
export function needMaterial(raw: Row, nodeId: string, moduleId: string): { pages: number[]; digest: string } {
    const node = array(raw.nodes).find(value => row(value).node_id === nodeId) ?? null;
    const claims = entityClaims(raw, nodeId);
    return { pages: citedPages([...array(row(node).source_refs), ...claims.flatMap(claim => array(claim.source_refs))], moduleId), digest: jsonDigest([node, claims]) };
}
/** §182.4: at most this many claim digests are kept with an unlocated decision; an entity with more is judged by its pages alone. */
const DECIDED_CLAIMS = 256;

/**
 * The latest reading of each source unit: its latest job in this queue (a cancelled job never counts), else the state of its
 * material row (`rows`, from the kernel's `unitRows`: `completed` read, `failed` settled). A campaign's fork starts with an
 * empty queue and the library's rows, so a unit read before the fork is known there only by its row (2026-09-30).
 */
export function unitJobs(queue: Row[], rows: Map<string, string>): Map<string, Row> {
    const jobs = new Map<string, Row>();
    for (const [key, state] of rows)
        jobs.set(key, { state });
    for (const job of queue)
        if (job.source_unit && job.state !== 'cancelled') jobs.set(sourceUnitKey(job.source_unit as SourceUnit), job);
    return jobs;
}

/** Streamed units not yet read: no job for the unit, or a job that is still waiting in the queue. */
export function unreadUnits(units: SourceUnit[], queue: Row[], rows: Map<string, string>): SourceUnit[] {
    const jobs = unitJobs(queue, rows);
    return units.filter(unit => { const job = jobs.get(sourceUnitKey(unit)); return !job || job.state === 'queued'; });
}

/**
 * Whether a need may be asked again. `unlocated` re-opens when the entity's accepted material changes (the same cached
 * locate against the same pages would decide the same way); `carried` re-opens once every carrying unit has settled, so
 * the next pass's answered check can close what the unit read.
 *
 * §182.4: the read-ahead passes its reading `window`, and there an `unlocated` need re-opens only when a publication added
 * a page or a claim for its entity inside the window. Without a window (a request) the §151.4 rule above stands.
 */
export function needEligible(dispositions: Row, raw: Row, need: Row, queue: Row[], moduleId: string, rows: Map<string, string>,
    window?: { first: number; last: number }): boolean {
    const record = row(dispositions[sourceNeedKey(need)]);
    if (record.disposition === 'unlocated') {
        if (typeof need.node_id !== 'string') return true;
        const material = needMaterial(raw, need.node_id, moduleId);
        if (material.digest === record.material_digest) return false;
        return !window || addedInside(record, raw, need.node_id, moduleId, material.pages, window);
    }
    if (record.disposition === 'carried') {
        const jobs = unitJobs(queue, rows);
        return array(record.units).every(key => ['completed', 'failed'].includes(jobs.get(String(key))?.state));
    }
    return true;
}

/**
 * §182.4: whether the entity's material gained, since the unlocated decision, a page inside the window (a page the decision
 * did not accept) or a claim citing a page inside it (a claim whose digest the decision did not hold). A decision recorded
 * before the claim digests were kept, or about an entity with more than `DECIDED_CLAIMS`, is judged by whether the changed
 * material cites a page inside the window at all.
 */
function addedInside(record: Row, raw: Row, nodeId: string, moduleId: string, pages: number[], window: { first: number; last: number }): boolean {
    const inside = (page: number) => page >= window.first && page <= window.last;
    const accepted = new Set(array(row(record.evidence).accepted_pages).filter(integer).map(number));
    if (pages.some(page => inside(page) && !accepted.has(page))) return true;
    if (!Array.isArray(record.claim_digests)) return pages.some(inside);
    const decided = new Set(record.claim_digests);
    return entityClaims(raw, nodeId).some(claim => !decided.has(jsonDigest(claim)) && citedPages(array(claim.source_refs), moduleId).some(inside));
}

/**
 * §182.4: a need whose reading completed on this source -- its `read` disposition, or a marked job that completed without
 * settling -- or whose marked job failed is not asked again by the read-ahead, whatever it published. A settled attempt
 * (answered, unlocated, carried) re-opens only through `needEligible`.
 */
export function needDone(dispositions: Row, need: Row, queue: Row[]): boolean {
    const key = sourceNeedKey(need);
    if (row(dispositions[key]).disposition === 'read') return true;
    const job = [...queue].reverse().find(value => row(value.source_need).key === key && value.state !== 'cancelled');
    return !!job && (job.state === 'failed' || job.state === 'completed' && !settledNeed(job));
}

/** A background marked job's packet field: the need as the reader writes it, with what the disposition is decided on. */
export function needPacket(marker: Row, raw: Row, moduleId: string, unread: SourceUnit[]): Row | undefined {
    const need = retainedNeed(raw, marker.key);
    if (!need || typeof need.node_id !== 'string') return undefined;
    const material = needMaterial(raw, need.node_id, moduleId);
    return {
        key: marker.key, kind: need.kind, node_id: need.node_id, focus: need.focus, question: need.question, reason: need.reason, trigger: need.trigger,
        source_refs: array(need.source_refs).filter(ref => integer(row(ref).pdf_index)).map(ref => ({ page: number(ref.pdf_index) + 1 })),
        accepted_pages: material.pages, material_digest: material.digest, unread_units: clone(unread),
    };
}

/** The live carried questions that ride on this unit's task. */
export function carriedNeeds(dispositions: Row, raw: Row, unit: SourceUnit): Row[] {
    const key = sourceUnitKey(unit), out: Row[] = [];
    for (const record of Object.values(dispositions)) {
        if (row(record).disposition !== 'carried' || !array(row(record).units).includes(key)) continue;
        const need = retainedNeed(raw, row(record).key);
        if (need) out.push({ key: row(record).key, focus: need.focus, question: need.question });
    }
    return out.slice(0, CARRIED_PER_UNIT);
}

/** Whether a completed job is a settled need attempt (no author ran), which only a marked read-ahead request may reuse. */
export function settledNeed(job: Row | undefined): boolean {
    const result = row(job?.result);
    return job?.state === 'completed' && result.state === 'settled' && SETTLED_DISPOSITIONS.includes(row(result.source_need).disposition);
}

const pageList = (value: unknown, pageCount: number): number[] =>
    [...new Set(array(value).filter(page => integer(page) && number(page) >= 1 && number(page) <= pageCount).map(page => number(page)))]
        .sort((a, b) => a - b).slice(0, EVIDENCE_PAGES);
const score = (value: unknown): number | undefined => {
    const out = Number(value);
    return value !== null && value !== undefined && typeof value !== 'boolean' && Number.isFinite(out) && out >= 0 && out <= 1 ? out : undefined;
};

/**
 * The record a settled attempt leaves: the host's disposition checked against what the kernel knows (a carried unit
 * must be one this module streams), with bounded evidence. Throws a plain Error on a malformed report.
 */
export function needDispositionRecord(value: unknown, marker: Row, raw: Row, moduleId: string, units: SourceUnit[], jobId: string, pageCount: number): Row {
    const report = row(value), disposition = report.disposition;
    if (!SETTLED_DISPOSITIONS.includes(disposition)) throw new Error(`need.disposition must be one of ${SETTLED_DISPOSITIONS.join(', ')}`);
    const evidence = row(report.evidence), need = retainedNeed(raw, marker.key);
    const record: Row = {
        key: marker.key, node_id: marker.node_id ?? null, kind: marker.kind ?? null, question: need?.question ?? null, disposition, job_id: jobId,
        evidence: {
            need_leads: array(evidence.need_leads).map(lead => ({ page: row(lead).page, score: score(row(lead).score) }))
                .filter(lead => integer(lead.page) && number(lead.page) >= 1 && number(lead.page) <= pageCount && lead.score !== undefined).slice(0, EVIDENCE_LEADS),
            accepted_pages: pageList(evidence.accepted_pages, pageCount), candidates: pageList(evidence.candidates, pageCount),
            ...(integer(evidence.searched_pages) ? { searched_pages: evidence.searched_pages } : {}),
            ...(typeof evidence.partial === 'boolean' ? { partial: evidence.partial } : {}),
            ...(typeof evidence.cached === 'boolean' ? { cached: evidence.cached } : {}),
        },
    };
    if (disposition === 'answered') {
        const noul = score(row(report.distribution).noul), gate = score(report.gate);
        if (noul === undefined || gate === undefined || noul < gate) throw new Error('an answered need reports its Noul at or above its gate');
        record.distribution = { noul };
        record.gate = gate;
    }
    const outside = array(record.evidence.need_leads).map(lead => number(lead.page)).filter(page => !record.evidence.accepted_pages.includes(page));
    if (disposition === 'unlocated') {
        if (outside.length) throw new Error('an unlocated need has no page lead outside its accepted pages');
        // The digest the decision was made on (the claim packet's); a publication since then re-opens the need at once.
        record.material_digest = typeof report.material_digest === 'string' && /^[a-f0-9]{64}$/.test(report.material_digest) ? report.material_digest
            : typeof marker.node_id === 'string' ? needMaterial(raw, marker.node_id, moduleId).digest : null;
        // §182.4: the claims the decision was made on, so the read-ahead can tell a claim added inside its window. Kept only
        // when the material now is the material decided on; otherwise the window rule falls back to the pages.
        if (typeof marker.node_id === 'string' && needMaterial(raw, marker.node_id, moduleId).digest === record.material_digest) {
            const claims = entityClaims(raw, marker.node_id);
            if (claims.length <= DECIDED_CLAIMS) record.claim_digests = claims.map(claim => jsonDigest(claim));
        }
    }
    if (disposition === 'carried') {
        const streamed = new Map(units.map(unit => [sourceUnitKey(unit), unit]));
        const named = array(report.units).map(unit => row(unit)).filter(unit => typeof unit.section === 'string' && integer(unit.first) && integer(unit.last))
            .map(unit => sourceUnitKey({ section: unit.section, first: number(unit.first), last: number(unit.last) }));
        if (!named.length || named.some(key => !streamed.has(key))) throw new Error('a carried need names only source units this module streams');
        const pages = new Set(named.flatMap(key => sourceUnitPages(streamed.get(key)!)));
        if (!outside.length || outside.some(page => !pages.has(page))) throw new Error('a carried need is located only inside the units that carry it');
        record.units = [...new Set(named)];
    }
    return record;
}
