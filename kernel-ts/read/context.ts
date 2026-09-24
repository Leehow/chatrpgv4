/** Host-only context identity and bounded extraction coverage; never persisted as game state. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonDigest, pythonJsonDumps, utf8Bytes } from '../json.js';
import type { CampaignSnapshot, LoadedModule } from './campaign.js';
import { array, number, row, string, truth, chars, type Row } from './values.js';
import {taskViews} from './task-views.js';

export const MEMORY_COVERAGE_BYTES = 4096;
const RECENT_TURNS = 20;
const extractJobId = (campaign: string, turn: number): string => `extract:${campaign}:t${turn}`;
const historyArgs = (from: number, to: number): Row => ({ what: 'history', turns: [from, to] });
const reasonOf = (error: unknown): string => chars(error instanceof Error ? error.message : String(error), 240);

export function fitCoverage(result: Row, limit = MEMORY_COVERAGE_BYTES): Row {
    if (!Number.isInteger(limit) || limit < 256)
        throw new Error('memory coverage limit is too small to report essential counts');
    const essential = (): Row => ({
        scope: result.scope,
        ...(Object.hasOwn(result, 'status') ? { status: result.status } : {}),
        committed: result.committed,
        completed: result.completed,
        gaps: result.gaps,
        recent_from: result.recent_from,
        recent: array(result.recent),
        older: result.older,
        truncated: true
    });
    let omitted = 0;
    while (utf8Bytes(pythonJsonDumps(result)).length > limit && array(result.recent).length) {
        const removed = array(result.recent).shift() as Row;
        omitted += number(removed.to) - number(removed.from) + 1;
        result.omitted_recent_gaps = omitted;
        result.truncated = true;
    }
    for (const key of ['original_read', 'note', 'reason'] as const) {
        if (utf8Bytes(pythonJsonDumps(result)).length <= limit)
            break;
        delete result[key];
        result.truncated = true;
    }
    if (utf8Bytes(pythonJsonDumps(result)).length > limit) {
        const minimal = essential();
        if (omitted)
            minimal.omitted_recent_gaps = omitted;
        while (utf8Bytes(pythonJsonDumps(minimal)).length > limit && array(minimal.recent).length) {
            const removed = array(minimal.recent).shift() as Row;
            minimal.omitted_recent_gaps = number(minimal.omitted_recent_gaps) + number(removed.to) - number(removed.from) + 1;
        }
        if (utf8Bytes(pythonJsonDumps(minimal)).length > limit)
            throw new Error('memory coverage cannot fit essential counts');
        return minimal;
    }
    return result;
}

function unavailableCoverage(error: unknown): Row {
    return fitCoverage({
        scope: 'canonical_committed_records',
        status: 'unavailable',
        committed: null,
        completed: null,
        gaps: null,
        recent_from: null,
        recent: [],
        older: { gaps: null },
        reason: reasonOf(error),
        note: 'Extraction coverage is unavailable because retained job or backlog metadata could not be read. Do not infer completeness or absence of gaps; use canonical originals if this matters.'
    });
}

async function memoryCoverageKnown(campaign: CampaignSnapshot): Promise<Row> {
    // Restored canonical records may legitimately originate on a parent line. Job commits,
    // rather than origin-line equality, distinguish inherited work from reused turn numbers.
    const records = campaign.records.filter(record => record.closed_by === 'narrate' && truth(record.commit))
        .sort((left, right) => number(left.turn) - number(right.turn));
    const backlog = new Set((await campaign.log('memory/backlog.jsonl'))
        .filter(entry => entry.status === 'pending')
        .map(entry => string(entry.job_id)));
    const gaps: Row[] = [];
    let completed = 0;
    for (const record of records) {
        const turn = number(record.turn), id = extractJobId(campaign.id, turn),
            job = row(await campaign.optional(join('memory/jobs', `${id}.json`))),
            bound = job.commit === record.commit || job.protocol === 'memory-reference-v1' && job.record_commit === record.commit
                && typeof job.commit === 'string' && typeof record.commit === 'string' && job.commit.startsWith(record.commit);
        if (bound && job.status === 'done') {
            completed++;
            continue;
        }
        gaps.push({
            turn,
            status: bound && (job.status === 'failed' || backlog.has(id)) ? 'failed' : bound && ['open', 'pending'].includes(job.status) ? 'pending' : 'missing'
        });
    }
    const recentFrom = records.length ? number(records[Math.max(0, records.length - RECENT_TURNS)].turn) : null,
        ranges: Row[] = [];
    for (const gap of gaps.filter(gap => recentFrom !== null && number(gap.turn) >= recentFrom)) {
        const last = ranges.at(-1);
        if (last && last.status === gap.status && number(last.to) + 1 === number(gap.turn))
            last.to = gap.turn;
        else
            ranges.push({ from: gap.turn, to: gap.turn, status: gap.status });
    }
    const older = gaps.filter(gap => recentFrom !== null && number(gap.turn) < recentFrom),
        originalTurn = number(gaps.at(-1)?.turn ?? records.at(-1)?.turn ?? 0),
        result: Row = {
            scope: 'canonical_committed_records',
            committed: records.length,
            completed,
            gaps: gaps.length,
            recent_from: recentFrom,
            recent: ranges.map(range => ({ ...range, recall: historyArgs(number(range.from), number(range.to)) })),
            older: older.length ? {
                gaps: older.length,
                from: older[0].turn,
                to: older.at(-1)!.turn,
                recall: historyArgs(number(older[0].turn), number(older.at(-1)!.turn))
            } : { gaps: 0 },
            ...(records.length ? { original_read: { what: 'transcript', read: { turn: originalTurn, role: 'keeper', offset: 0, limit: 4096 } } } : {}),
            note: 'Extraction coverage of committed turn records only; not a semantic completeness claim. Completed jobs with zero candidates are complete. Read originals only when a gap matters to the current response.'
        };
    return fitCoverage(result);
}

export async function memoryCoverage(campaign: CampaignSnapshot): Promise<Row> {
    try {
        return await memoryCoverageKnown(campaign);
    }
    catch (error) {
        return unavailableCoverage(error);
    }
}

export async function sourceRevision(campaign: CampaignSnapshot, module: LoadedModule, capsule: Row): Promise<Row> {
    try {
        const activeLocks = row(row(campaign.world.mods).active),
            active = array(row(capsule.mods).active).map(mod => ({ id: mod.id, ...row(activeLocks[mod.id]) })),
            craftRoot = join(campaign.context.content, 'craft'),
            craft = await Promise.all((await campaign.context.snapshots.sortedChildNames(craftRoot, path => campaign.context.snapshots.isFile(path)))
                .map(async name => [name, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(join(craftRoot, name)))]));
        const common: Row = {
            module: module.graph.digest,
            generation: module.generation,
            active,
            craft,
            register: campaign.meta.register ?? null,
            play_language: campaign.meta.play_language ?? null
        };
        const {reading: _readerBookkeeping, updated_at: _bookkeepingClock, ...taskMeta} = module.meta;
        return { source_revision: jsonDigest({...common, meta: module.meta}), task_source_revision: jsonDigest({...common, meta: taskMeta}) };
    }
    catch (error) {
        return { source_revision: null, unavailable: true, reason: reasonOf(error) };
    }
}

export function worldRevision(world: Row, party: Row[], receipts: unknown, pendingChoice: unknown): string {
    const snapshot: Row = { world, party, receipts: array(receipts), pending_choice: pendingChoice ?? null };
    return jsonDigest(snapshot);
}
export function taskWorldRevision(world: Row, party: Row[], receipts: unknown, pendingChoice: unknown): string {
    return worldRevision(taskViews(world).world, party, receipts, pendingChoice);
}
export async function contextBinding(campaign: CampaignSnapshot, module: LoadedModule, capsule: Row): Promise<Row> {
    const worldline = string(campaign.meta.active_worldline || 'main'),
        source = await sourceRevision(campaign, module, capsule), views = taskViews(campaign.world);
    return {
        version: 1,
        campaign: campaign.id,
        worldline,
        loop: number(row(row(campaign.meta.worldlines)[worldline]).loop),
        turn: number(campaign.turn.turn),
        world_revision: worldRevision(campaign.world, campaign.party, campaign.turn.receipts, campaign.turn.pending_choice),
        task_world_revision: worldRevision(views.world, campaign.party, campaign.turn.receipts, campaign.turn.pending_choice),
        task_presentation_revisions: views.presentation,
        npc_revision: campaign.jsonFiles ? jsonDigest([campaign.jsonFiles.get('npc-journal.json') ?? null, campaign.jsonFiles.get('npc-ledger.json') ?? null]) : null,
        memory_revision: campaign.logs ? jsonDigest([campaign.logs.get('memory/candidates.jsonl') ?? [], campaign.logs.get('memory/story.jsonl') ?? []]) : null,
        ...source,
        memory_coverage: await memoryCoverage(campaign)
    };
}
