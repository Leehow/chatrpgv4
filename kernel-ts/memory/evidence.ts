/** Disposable read-only memory search snapshots. Canonical turns and candidate files remain the sources. */
import {randomUUID} from 'node:crypto';
import type {KernelContext} from '../context.js';
import {RpcError} from '../errors.js';
import {isJsonObject, jsonDigest, parsePythonJson, sha256Text} from '../json.js';
import type {CampaignWriter} from '../write/store.js';
import {loadCampaignModule} from '../read/campaign.js';
import {EntityIndex, memoryEvidenceView, memoryOccurrenceKey} from '../read/memory.js';
import {taskWorldRevision} from '../read/context.js';
import {array, clone, integer, number, row, string, type Row} from '../read/values.js';
import {committedRecords, logs, readJob, jobId, CANDIDATE_KINDS} from './jobs.js';
import {candidatesFor, parseSpan} from './recall.js';
import {boundedResult, recallBytes, RECALL_BYTES, RECALL_ROWS, RECALL_CHARS, position} from './pages.js';
import {assertSourceRef, codePointRangeToUtf16, issueSourceRef, resolveSourceRef, splitSourceText} from '../../runtime/jev/source-ref.ts';
import type {ScopeBinding, SourceRef} from '../../runtime/jev/value-contracts.ts';
import {deriveCommittedSpeechSpans} from '../../runtime/jev/committed-speech-spans.ts';

interface Entry {alias: string; line: string; view: Row; memory?: Row; record?: Row; role?: 'player' | 'keeper'; range?: {start: number; end: number}}
interface Snapshot {id: string; campaign: string; scope: ScopeBinding; query: string; filters: Row; rawAll: boolean;
    created: number; sourceRevision: string; indexRevision: string; worldRevision: string; entries: Entry[]; rawGaps: number[]; rawUnavailable: string[];
    reads: Map<string, Row>; returned?: Row[]}
const invalid = (message: string, reason = 'invalid_params'): never => {throw new RpcError('invalid_params', message,
    reason === 'invalid_params' ? {} : {details: {reason}});};
const closed = (value: unknown, keys: string[]): Row => {
    if (!isJsonObject(value) || Object.keys(value).some(key => !keys.includes(key))) return invalid('Memory evidence request contains an unsupported field');
    return value;
};
const stateScope = (meta: Row) => {const worldline = string(meta.active_worldline || 'main'); return {worldline, loop: number(row(row(meta.worldlines)[worldline]).loop)};};
function queryScope(campaign: CampaignWriter, meta: Row, supplied?: unknown): ScopeBinding {
    const current = stateScope(meta), expected = {owner: `memory-read:${campaign.id}`, campaign: campaign.id, ...current, audience: 'keeper' as const};
    if (supplied === undefined) return expected;
    const scope = closed(supplied, ['owner', 'campaign', 'worldline', 'loop', 'audience']);
    if (typeof scope.owner !== 'string' || !scope.owner || scope.campaign !== campaign.id || scope.worldline !== current.worldline
        || scope.loop !== current.loop || scope.audience !== 'keeper') return invalid('Memory evidence scope does not match the current campaign');
    return scope as ScopeBinding;
}
async function corpus(campaign: CampaignWriter): Promise<{records: Map<number, Row>; revision: string}> {
    const records = await committedRecords(campaign);
    return {records, revision: jsonDigest([...records].map(([turn, value]) => ({turn, commit: value.commit,
        player: value.player_text ?? null, keeper: value.rendered_text ?? null, marked: value.marked_text ?? null, speech: value.speech ?? null})))};
}
function filtersOf(value: unknown): Row {
    const filters = value === undefined ? {} : closed(value, ['line', 'turns', 'about', 'kinds', 'include_superseded']);
    if (filters.about !== undefined && (!Array.isArray(filters.about) || filters.about.some(value => typeof value !== 'string' || !value.trim())))
        return invalid('Memory about must contain semantic names');
    if (filters.kinds !== undefined && (!Array.isArray(filters.kinds) || filters.kinds.some(value => !CANDIDATE_KINDS.includes(value))))
        return invalid('Memory kinds must contain supported candidate kinds');
    if (filters.turns !== undefined) parseSpan(filters.turns, 0, 0);
    if (filters.line !== undefined && (typeof filters.line !== 'string' || !filters.line)) return invalid('Memory line must name an authorized line');
    if (filters.include_superseded !== undefined && typeof filters.include_superseded !== 'boolean') return invalid('include_superseded must be boolean');
    return clone(filters);
}

export function createMemoryEvidenceOwner(context: KernelContext, campaignFor: (params: Row) => Promise<CampaignWriter>) {
    const snapshots = new Map<string, Snapshot>();
    async function indexed(campaign: CampaignWriter, meta: Row, filters: Row): Promise<Array<{line: string; value: Row}>> {
        const active = stateScope(meta).worldline, requested = filters.line ?? 'current';
        const lines = requested === 'any' ? [...new Set([active, ...Object.keys(row(meta.worldlines))])]
            : [requested === 'current' ? active : requested];
        const result: Array<{line: string; value: Row}> = [];
        const occurrences = new Set<string>();
        for (const line of lines) {
            if (line !== active && !Object.hasOwn(row(meta.worldlines), line)) return invalid('Memory line is not in this campaign');
            const values = await candidatesFor(campaign, meta, line === active ? 'current' : line);
            for (const value of values) {
                // Forks inherit occurrences, but can later reuse a turn-local ID for a different source commit.
                const source = row(value.source), identity = typeof value.id === 'string' && typeof source.commit === 'string'
                    ? memoryOccurrenceKey(value) : null;
                if (identity && occurrences.has(identity)) continue;
                if (identity) occurrences.add(identity);
                result.push({line, value});
            }
        }
        return result;
    }
    async function create(campaign: CampaignWriter, params: Row): Promise<Row> {
        if (typeof params.query !== 'string' || !params.query.trim() || params.query.length > 2048) return invalid('Memory query must be a nonempty bounded question');
        const meta = await campaign.readCampaign(), scope = queryScope(campaign, meta, params.scope), filters = filtersOf(params.filters);
        const original = await corpus(campaign), values = await indexed(campaign, meta, filters), entries: Entry[] = [];
        const world = await campaign.readWorld(), party = await campaign.party(), turnState = await campaign.readTurn(), module = await loadCampaignModule(context, meta.module_id, world, campaign.id);
        const index = new EntityIndex(module.graph, party, row(world.scene_labels));
        const names = new Set(array(filters.about).map(name => index.lenientKey(name)));
        const range = filters.turns === undefined ? undefined : parseSpan(filters.turns, 0, 0);
        for (const {line, value} of values) {
            const turn = number(value.valid_from_turn);
            if (filters.include_superseded !== true && value.superseded_by != null) continue;
            if (range && (turn < range[0] || turn > range[1])) continue;
            if (array(filters.kinds).length && !filters.kinds.includes(value.kind) && value.kind !== 'keeper_correction') continue;
            if (names.size && ![value.subject, ...array(value.knowers), ...array(value.entities)].some(name => names.has(index.lenientKey(string(name))))) continue;
            if (typeof value.statement !== 'string' || !value.statement.length) continue;
            // Every character remains searchable; a large legacy statement is several issued parts, never a truncated head.
            for (const part of splitSourceText(value.statement, 800)) {
                const alias = `entry:${entries.length}`;
                entries.push({alias, line, memory: clone(value), range: part, view: {alias, origin: 'memory', kind: value.kind ?? null,
                    subject: value.subject ?? null, text: value.statement.slice(part.start, part.end), turn, line,
                    loop: value.loop ?? null, status: value.status ?? null, state: value.state ?? null,
                    ...memoryEvidenceView(value), derived: value.memory_version !== 2, links: []}});
            }
        }
        for (const entry of entries) entry.view.links = array(entry.memory?.relations).flatMap(link => {
            const target = entries.find(value => value.line === entry.line && value.memory?.id === link.target);
            return target ? [{relation: link.relation, target: target.alias}] : [];
        });
        const rawGaps: number[] = [], active = stateScope(meta).worldline;
        const rawUnavailable = filters.line && !['current', active].includes(filters.line)
            ? (filters.line === 'any' ? Object.keys(row(meta.worldlines)).filter(line => line !== active) : [filters.line]) : [];
        if (filters.line === undefined || ['current', 'any', active].includes(filters.line)) for (const [turn, record] of original.records) {
            if (range && (turn < range[0] || turn > range[1])) continue;
            const job = await readJob(campaign, jobId(campaign.id, turn));
            const complete = job?.status === 'done' && (job.commit === record.commit || job.record_commit === record.commit);
            if (!complete) rawGaps.push(turn);
            if (params.raw_all !== true && complete) continue;
            for (const role of ['player', 'keeper'] as const) {
                const text = string(record[role === 'player' ? 'player_text' : 'rendered_text'] ?? '');
                for (const part of splitSourceText(text, 800)) {
                    const alias = `entry:${entries.length}`;
                    entries.push({alias, line: active, record: clone(record), role, range: part, view: {alias, origin: 'raw', kind: null,
                        subject: null, text: text.slice(part.start, part.end), turn, line: active, loop: null, status: 'unindexed',
                        authority: 'conversation_report', attribution: {kind: role === 'player' ? 'player' : 'unknown'}, derived: false, links: []}});
                }
            }
        }
        const snapshot: Snapshot = {id: randomUUID(), campaign: campaign.id, scope, query: params.query, filters,
            rawAll: params.raw_all === true, created: Date.now(), sourceRevision: original.revision,
            indexRevision: jsonDigest(values), worldRevision: taskWorldRevision(world, party, turnState.receipts, turnState.pending_choice), entries, rawGaps, rawUnavailable, reads: new Map()};
        snapshots.set(snapshot.id, snapshot);
        while (snapshots.size > 16) snapshots.delete(snapshots.keys().next().value!);
        return {snapshot: snapshot.id, scope, query: snapshot.query, filters, raw_all: snapshot.rawAll,
            total: entries.length, indexed: entries.filter(value => value.memory).length, raw: entries.filter(value => value.record).length,
            source_revision: snapshot.sourceRevision, index_revision: snapshot.indexRevision, world_revision: snapshot.worldRevision,
            coverage: {raw_gap_turns: rawGaps, raw_unavailable_lines: rawUnavailable},
            context: {scene: world.active_scene, worldline: scope.worldline, loop: scope.loop, clock: world.clock ?? null,
                current_receipts: array(turnState.receipts).map(receipt => Object.fromEntries(['kind', 'actor_label', 'resource', 'delta', 'before', 'after', 'name', 'label', 'text', 'clue', 'minutes']
                    .filter(key => Object.hasOwn(receipt, key)).map(key => [key, receipt[key]])))}};
    }
    async function selected(campaign: CampaignWriter, params: Row): Promise<Snapshot> {
        const snapshot = typeof params.snapshot === 'string' ? snapshots.get(params.snapshot) : undefined;
        if (!snapshot || snapshot.campaign !== campaign.id || Date.now() - snapshot.created > 180_000) return invalid('Memory query snapshot expired; start a new snapshot', 'memory_snapshot_stale');
        const meta = await campaign.readCampaign(), scope = queryScope(campaign, meta, params.scope ?? snapshot.scope);
        if (jsonDigest({...scope}) !== jsonDigest({...snapshot.scope})) return invalid('Memory query scope changed', 'memory_snapshot_stale');
        return snapshot;
    }
    async function original(campaign: CampaignWriter, snapshot: Snapshot, entry: Entry, params: Row): Promise<Row> {
        const turn = number(entry.memory?.source?.turn ?? entry.record?.turn, -1);
        const hint = entry.memory?.source?.commit ?? entry.record?.commit;
        if (turn < 0 || typeof hint !== 'string' || !/^[a-f0-9]{7,64}$/.test(hint)) return {alias: entry.alias, verified: false, reason: 'canonical_original_unavailable', refs: []};
        const resolved = await context.git.run(campaign.id, ['rev-parse', '--verify', `${hint}^{commit}`]);
        const commit = resolved.stdout.trim();
        if (resolved.code || !/^[a-f0-9]{40,64}$/.test(commit)) return {alias: entry.alias, verified: false, reason: 'canonical_original_unavailable', refs: []};
        const [recordBlob, metaBlob] = await Promise.all([context.git.run(campaign.id, ['show', `${commit}:turns/${String(turn).padStart(4, '0')}.json`]),
            context.git.run(campaign.id, ['show', `${commit}:campaign.json`])]);
        if (recordBlob.code || metaBlob.code) return {alias: entry.alias, verified: false, reason: 'canonical_original_unavailable', refs: []};
        const record = row(parsePythonJson(recordBlob.stdout)), originMeta = row(parsePythonJson(metaBlob.stdout));
        if (originMeta.id !== campaign.id || number(record.turn) !== turn || record.closed_by !== 'narrate') return invalid('The memory original does not belong to this campaign');
        const sourceOrigin = {line: stateScope(originMeta).worldline, loop: stateScope(originMeta).loop, turn, commit,
            scene: row(row(record.world).scene).name ?? null, clock: row(record.world).clock ?? null};
        let primary: {role: 'player' | 'keeper'; start: number; end: number} | undefined;
        if (entry.record && entry.role && entry.range) {
            const text = string(record[entry.role === 'player' ? 'player_text' : 'rendered_text'] ?? '');
            if (text.slice(entry.range.start, entry.range.end) !== entry.view.text) return invalid('The raw memory navigation no longer matches its canonical original', 'memory_snapshot_stale');
            primary = {role: entry.role, ...entry.range};
        } else if (entry.memory?.statement_ref) {
            const ref = entry.memory.statement_ref as SourceRef;
            assertSourceRef(ref);
            const match = /^turn:(\d+):(player|keeper)$/.exec(ref.resource);
            if (match && Number(match[1]) === turn && ref.sourceType === 'turn' && ref.selector.kind === 'utf16') {
                const role = match[2] as 'player' | 'keeper', text = string(record[role === 'player' ? 'player_text' : 'rendered_text'] ?? '');
                if (ref.scope.owner !== `campaign:${campaign.id}` || ref.scope.campaign !== campaign.id || ref.scope.worldline !== sourceOrigin.line || ref.scope.loop !== sourceOrigin.loop || ref.scope.audience !== 'keeper')
                    return invalid('The stored memory source attribution has a foreign scope');
                const source = {scope: ref.scope, resource: ref.resource, revision: sha256Text(text), sourceType: 'turn' as const, text};
                if (resolveSourceRef(ref, {scope: ref.scope, mode: 'historical', read: () => source, currentRevision: () => source.revision}) !== entry.memory.statement)
                    return invalid('The stored memory statement is not its exact source occurrence');
                primary = {role, ...ref.selector};
            }
        }
        const speech = deriveCommittedSpeechSpans({markedText: record.marked_text ?? record.rendered_text,
            renderedText: record.rendered_text, speech: record.speech});
        const pieces: Row[] = [], refs: SourceRef[] = [];
        if (primary) {
            const text = string(record[primary.role === 'player' ? 'player_text' : 'rendered_text'] ?? '');
            refs.push(issueSourceRef({scope: snapshot.scope, resource: `canonical-turn:${commit}:${primary.role}`, revision: sha256Text(text), sourceType: 'turn', text},
                {kind: 'utf16', start: primary.start, end: primary.end}));
        }
        const primaryCount = refs.length;
        if (params.role !== undefined && !['player', 'keeper'].includes(params.role)) return invalid('Memory original role must be player or keeper');
        for (const role of params.role ? [params.role] : primary ? [primary.role] : ['player', 'keeper'] as const) {
            const text = string(record[role === 'player' ? 'player_text' : 'rendered_text'] ?? ''), points = Array.from(text);
            const center = primary && primary.role === role ? Array.from(text.slice(0, primary.start)).length : 0;
            const offset = params.offset === undefined ? Math.max(0, center - 800) : position(params.offset, 0, 'offset');
            if (offset > points.length) return invalid('Original memory offset is outside its source');
            const endPoint = Math.min(points.length, offset + RECALL_CHARS), range = codePointRangeToUtf16(text, offset, endPoint);
            const ref = issueSourceRef({scope: snapshot.scope, resource: `canonical-turn:${commit}:${role}`, revision: sha256Text(text), sourceType: 'turn', text}, {kind: 'utf16', ...range});
            const speakers = role === 'keeper' && speech.status === 'verified' ? speech.spans.filter(value => value.start < range.end && value.end > range.start)
                .map(value => ({start: Math.max(value.start, range.start) - range.start, end: Math.min(value.end, range.end) - range.start,
                    name: 'name' in value.who ? value.who.name : value.who.label, kind: 'npc' in value.who ? 'npc' : 'investigator' in value.who ? 'investigator' : 'label'})) : [];
            pieces.push({role, text: text.slice(range.start, range.end), range: {offset, end: endPoint}, total_chars: points.length, ref,
                truncated: offset > 0 || endPoint < points.length, speakers,
                ...(offset > 0 ? {previous: {alias: entry.alias, offset: Math.max(0, offset - RECALL_CHARS), role}} : {}),
                ...(endPoint < points.length ? {next: {alias: entry.alias, offset: endPoint, role}} : {})});
            refs.push(ref);
        }
        const result: Row = {alias: entry.alias, entry: clone(entry.view), authority: 'conversation_report', verified: true,
            verification_scope: 'canonical_original_integrity_only', original: sourceOrigin, derived: !primary,
            context: pieces, refs};
        // Complete serialized bounds include provenance and continuation metadata.
        while (recallBytes(result) > RECALL_BYTES && pieces.some(piece => piece.text.length > 256)) {
            const largest = [...pieces].sort((a, b) => b.text.length - a.text.length)[0];
            const index = pieces.indexOf(largest), newCount = Math.floor(Array.from(largest.text).length / 2);
            largest.text = Array.from(largest.text).slice(0, newCount).join(''); largest.range.end = largest.range.offset + newCount;
            largest.truncated = true; largest.next = {alias: entry.alias, offset: largest.range.end, role: largest.role};
            largest.speakers = largest.speakers.filter((value: Row) => value.start < largest.text.length).map((value: Row) => ({...value, end: Math.min(value.end, largest.text.length)}));
            const full = string(record[largest.role === 'player' ? 'player_text' : 'rendered_text'] ?? ''), range = codePointRangeToUtf16(full, largest.range.offset, largest.range.end);
            refs[index + primaryCount] = issueSourceRef({scope: snapshot.scope, resource: `canonical-turn:${commit}:${largest.role}`, revision: sha256Text(full), sourceType: 'turn', text: full}, {kind: 'utf16', ...range});
            largest.ref = refs[index + primaryCount];
        }
        boundedResult(result);
        const previous = snapshot.reads.get(entry.alias);
        if (previous && previous.original.commit !== commit) return invalid('The original changed during a memory read', 'memory_snapshot_stale');
        const contexts = new Map([...array(previous?.context), ...pieces].map(piece => [jsonDigest([piece.role, piece.range, piece.text]), clone(piece)]));
        const boundRefs = new Map([...array(previous?.refs), ...refs].map(ref => [jsonDigest(ref), clone(ref)]));
        snapshot.reads.set(entry.alias, {...clone(result), context: [...contexts.values()], refs: [...boundRefs.values()],
            primary_refs: primaryCount ? refs.slice(0, primaryCount) : []});
        return result;
    }
    return async (params: Row): Promise<Row> => {
        closed(params, ['campaign', 'action', 'query', 'filters', 'raw_all', 'scope', 'snapshot', 'offset', 'alias', 'role', 'selected', 'assessments', 'considered', 'unknown']);
        if (params.raw_all !== undefined && typeof params.raw_all !== 'boolean') return invalid('raw_all must be boolean');
        const campaign = await campaignFor(params);
        if (params.action === 'snapshot') return create(campaign, params);
        const snapshot = await selected(campaign, params);
        if (params.action === 'page') {
            const offset = position(params.offset, 0, 'offset'), selected: Row[] = [];
            if (offset > snapshot.entries.length) return invalid('Memory candidate page offset is outside this snapshot');
            const result: Row = {snapshot: snapshot.id, offset, total: snapshot.entries.length, rows: selected, next_offset: null};
            for (const entry of snapshot.entries.slice(offset, offset + RECALL_ROWS)) {
                selected.push(clone(entry.view)); result.next_offset = offset + selected.length < snapshot.entries.length ? offset + selected.length : null;
                if (recallBytes(result) > RECALL_BYTES) {selected.pop(); result.next_offset = offset + selected.length; break;}
            }
            if (!selected.length && offset < snapshot.entries.length) return invalid('A memory candidate exceeds the bounded transport');
            return boundedResult(result);
        }
        if (params.action === 'original') {
            const entry = snapshot.entries.find(value => value.alias === params.alias);
            if (!entry) return invalid('Memory original must select an issued candidate');
            return original(campaign, snapshot, entry, params);
        }
        if (params.action === 'finish') {
            const meta = await campaign.readCampaign(), current = await corpus(campaign), values = await indexed(campaign, meta, snapshot.filters);
            const world = await campaign.readWorld(), party = await campaign.party(), turn = await campaign.readTurn();
            if (current.revision !== snapshot.sourceRevision || jsonDigest(values) !== snapshot.indexRevision
                || taskWorldRevision(world, party, turn.receipts, turn.pending_choice) !== snapshot.worldRevision) return {status: 'refresh', snapshot: snapshot.id};
            if (!Array.isArray(params.selected) || params.selected.length > 20 || new Set(params.selected).size !== params.selected.length)
                return invalid('A memory result selects at most twenty issued occurrences');
            if (!Array.isArray(params.considered) || !Array.isArray(params.unknown)
                || [params.considered, params.unknown].some(values => new Set(values).size !== values.length || values.some(alias => !snapshot.entries.some(entry => entry.alias === alias)))
                || params.unknown.some(alias => !params.considered.includes(alias)) || params.selected.some(alias => !params.considered.includes(alias)))
                return invalid('Memory coverage must name issued candidate occurrences');
            if (!Array.isArray(params.assessments) || params.assessments.length !== params.selected.length
                || new Set(params.assessments.map(value => row(value).alias)).size !== params.assessments.length) return invalid('Every selected memory requires one typed assessment');
            for (const item of params.assessments) {
                const assessment = closed(item, ['alias', 'relevance', 'support', 'applicability', 'contradiction']);
                if (!params.selected.includes(assessment.alias) || !['direct', 'context', 'uncertain'].includes(assessment.relevance)
                    || !['supported', 'unsupported', 'unknown'].includes(assessment.support)
                    || !['current', 'historical', 'superseded', 'unknown'].includes(assessment.applicability)
                    || !['none', 'conflict', 'unknown'].includes(assessment.contradiction)) return invalid('Invalid typed memory assessment');
            }
            const hits: Row[] = [], used: string[] = [], omitted: string[] = [];
            const result: Row = {what: 'memory', query: snapshot.query, status: 'ready', hits, authority: 'conversation_report',
                coverage: {used, omitted, unknown: params.unknown.slice(0, 20), unknown_count: params.unknown.length,
                    omitted_candidates: snapshot.entries.length - params.considered.length, total_candidates: snapshot.entries.length,
                    raw_gap_turns: snapshot.rawGaps, raw_unavailable_lines: snapshot.rawUnavailable}, refs: []};
            for (const alias of params.selected) {
                const evidence = snapshot.reads.get(alias);
                if (!evidence || evidence.verified !== true) return invalid('A selected memory result needs a verified original read');
                const {refs: _allRefs, primary_refs: primaryRefs, ...body} = clone(evidence);
                const hit: Row = {...body, assessment: clone(params.assessments.find(value => value.alias === alias))};
                const contextOmissions: Row[] = [];
                const keptRefs = () => [...new Map([...array(primaryRefs), ...array(hit.context).map(piece => piece.ref)].filter(Boolean).map(ref => [jsonDigest(ref), ref])).values()];
                const previousRefCount = result.refs.length;
                hits.push(hit); used.push(alias); result.refs.push(...keptRefs());
                while (recallBytes(result) > RECALL_BYTES && array(hit.context).length) {
                    const removed = hit.context.splice(hit.context.length > 2 ? 1 : hit.context.length - 1, 1)[0];
                    contextOmissions.push({role: removed.role, range: removed.range});
                    hit.omitted_context = contextOmissions.slice(0, 8); hit.omitted_context_count = contextOmissions.length;
                    result.refs.splice(previousRefCount); result.refs.push(...keptRefs());
                }
                if (contextOmissions.length) result.status = 'partial';
                if (recallBytes(result) > RECALL_BYTES) {hits.pop(); used.pop(); result.refs.splice(previousRefCount); omitted.push(alias);}
            }
            if (omitted.length || snapshot.rawUnavailable.length || params.unknown.length || params.considered.length < snapshot.entries.length) result.status = 'partial';
            return boundedResult(result);
        }
        return invalid('Unknown memory evidence action');
    };
}
