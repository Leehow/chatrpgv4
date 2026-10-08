/** Pure source-draft validation shared by publication and the offline host check. */
import { RpcError } from '../errors.js';
import { canonicalJson, isJsonObject, orderedObject, pythonJsonDumps, sha256Text } from '../json.js';
import { array, clone, entries, equal, integer, normalize, number, numeric, repr, row, sorted, string, truth, type Row } from '../read/values.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { startSceneCandidates } from '../write/source.js';
import { CLAIM_KEYS, NODE_KEYS, SHARD_KEYS, VISUAL_CONTRACT_ID, validSemanticId, type ModuleContract } from './contract.js';
import { obligationRefusals, type Refusal } from './obligation-shape.js';
import { obligationReviewPaths, statesObligation } from './obligation-review.js';
import { carriesMechanics, mechanicsRefusals } from './mechanics-shape.js';
import { beingPairs, endpointRefusals, weaknessRefusals, weaknessesBound, type BeingRefusal } from './being-shape.js';
import { shapeReviewPaths, statesMechanics } from './shape-review.js';
import {validateSourceNeeds,sourceNeedKey} from './source-needs.js';
import {moduleLogicReview,moduleReviewRoot,advisoryModuleFinding,blockingModuleFindings} from './module-review-policy.js';
import { anchors, pages, recordSpans, sameSpan, spanOf, type Anchor } from './transcription.js';
import { REVIEW_VERDICTS, classificationMatcher, PERSON_STATEMENTS, personStatementPath, statementReviewPath } from './review-verdicts.js';
import { DISTINCT_FROM, DUPLICATE_RULE, duplicateMessage, duplicateRefusal, publishedDuplicates } from './published-duplicates.js';
import { CLAIM_SUPPORT_PROTOCOL, JEV_REVIEWER, JEV_REVIEW_RULES, claimRecordPages, claimRecordRoot, claimSupportIneligibility, pathsOverlap, claimRecord } from './claim-support.js';
import { preserveTravel } from './route-travel.js';
import {validVisualScan,visualCandidates} from './visual-discovery.js';
import { checkMapScope, checkMapScopeDraft, publishedNodes } from './map-scope.js';
import type { SourceNeed } from './source-needs.js';
const object = (value: any): boolean => isJsonObject(value);
/** The refusal `reject` throws, built without throwing so the staged draft check can collect it (§186.3). */
function refusal(message: string, path = '/'): RpcError {
    return new RpcError('invalid_params', message, {
        fix: 'correct the draft using the original pages and submit again', details: { reason: 'reading_failed', path },
    });
}
export function reject(message: string, path = '/'): never {
    throw refusal(message, path);
}
/** Contract §186.3: one finding of the draft check. `value` is what the draft wrote; `allowed` the closed list it must come from. */
export interface DraftFinding { path: string; rule: string; message: string; value?: any; allowed?: any[] }
/** §186.3: `details.findings` holds at most this many entries and this many bytes; `details.truncated` counts the rest. */
export const DRAFT_FINDINGS_LIMIT = 40, DRAFT_FINDINGS_BYTES = 8 * 1024;
/** §186.3: a finding's `value` is clipped to this many characters. */
export const DRAFT_FINDING_VALUE_CHARS = 80;
const clipText = (text: string): string => {
    const chars = Array.from(text);
    return chars.length <= DRAFT_FINDING_VALUE_CHARS ? text : chars.slice(0, DRAFT_FINDING_VALUE_CHARS - 3).join('') + '...';
};
/** §186.3: the value as written, at most 80 characters: a string clipped, any other value itself while its JSON fits, else its JSON clipped. */
export function writtenValue(value: any): any {
    if (typeof value === 'string') return clipText(value);
    let text: string;
    try { text = pythonJsonDumps(value); }
    catch { return clipText(String(value)); }
    return Array.from(text).length <= DRAFT_FINDING_VALUE_CHARS ? clone(value) : clipText(text);
}
type Locate = Partial<DraftFinding> | ((error: RpcError) => Partial<DraftFinding>);
const UTF8 = new TextEncoder();
/**
 * Contract §186.3: one stage of the draft check. A law records the refusal it would have thrown, with the findings it
 * names, and the stage goes on to the next independent law; `settle` throws the first refusal with every finding.
 */
class Stage {
    private readonly refusals: RpcError[] = [];
    private readonly findings: DraftFinding[] = [];
    private readonly keys = new Set<string>();
    /** Record a refusal and the fields it names; with none named, the refusal names its own path. */
    note(error: RpcError, ...located: Array<Partial<DraftFinding>>): void {
        const details = row(error.details);
        this.refusals.push(error);
        for (const at of located.length ? located : [{}]) {
            const finding: DraftFinding = { path: string(at.path ?? details.path ?? '/'), rule: string(at.rule ?? details.rule ?? 'draft_check'), message: at.message ?? error.message };
            if (at.value !== undefined) finding.value = writtenValue(at.value);
            if (Array.isArray(at.allowed)) finding.allowed = clone(at.allowed);
            const key = canonicalJson(finding as any);
            if (!this.keys.has(key)) { this.keys.add(key); this.findings.push(finding); }
        }
    }
    /**
     * Run one law that throws its refusal. A refusal listing several (`details.refusals`, `details.pairs`) becomes one
     * finding per entry, worded by `each`; any other becomes one finding located by `at`. True when the law passed.
     */
    run(law: () => void, at: Locate = {}, each?: (item: Row) => string): boolean {
        try { law(); return true; }
        catch (error) {
            if (!(error instanceof RpcError)) throw error;
            const details = row(error.details);
            if (Array.isArray(details.pairs))
                this.note(error, ...details.pairs.map((pair: Row) => ({ path: string(pair.path), rule: string(details.rule),
                    message: `one being, two nodes: ${pair.npc} and ${pair.creature} share the name ${repr(pair.shared)}` })));
            else if (Array.isArray(details.refusals) && each)
                this.note(error, ...details.refusals.map((item: Row) => ({ path: string(item.path), rule: string(item.rule), message: each(item) })));
            else {
                const located = typeof at === 'function' ? at(error) : at;
                this.note(error, { ...(Object.hasOwn(details, 'value') ? { value: details.value } : {}),
                    ...(Array.isArray(details.allowed) ? { allowed: details.allowed } : {}), ...located });
            }
            return false;
        }
    }
    /** A later stage runs only when this one is clean: the first refusal, unchanged, now carrying every finding of the stage. */
    settle(): void {
        if (!this.refusals.length) return;
        const first = this.refusals[0], kept: DraftFinding[] = [];
        let bytes = 2;
        for (const finding of this.findings) {
            const size = UTF8.encode(pythonJsonDumps(finding as any)).length + (kept.length ? 2 : 0);
            if (kept.length >= DRAFT_FINDINGS_LIMIT || bytes + size > DRAFT_FINDINGS_BYTES) break;
            kept.push(finding);
            bytes += size;
        }
        const truncated = this.findings.length - kept.length;
        throw new RpcError(first.code, first.message, { ...(first.fix ? { fix: first.fix } : {}), ...(first.codeDetail ? { codeDetail: first.codeDetail } : {}),
            retryable: first.retryable, next: first.next,
            details: { ...row(first.details), findings: kept as any, ...(truncated ? { truncated } : {}) } });
    }
}
/** The JSON pointer token of one key. */
const token = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');
/** `references` for one record's `source_refs` at `at`, each reference its own law; the normalized list when all pass. */
function sourceRefs(stage: Stage, value: any, count: any, seen: ReadonlySet<any> | undefined, at: string): Row[] | null {
    if (!Array.isArray(value) || !value.length) {
        stage.note(refusal('source_refs must contain at least one original page'), { path: at, rule: 'source_refs', value });
        return null;
    }
    let passed = true;
    for (const [j, ref] of value.entries())
        passed = stage.run(() => references([ref], count, seen), { path: `${at}/${j}`, rule: 'source_refs', value: ref }) && passed;
    return passed ? references(value, count, seen) : null;
}
export function references(value: any, pageCount: any, seen?: ReadonlySet<any>): Row[] {
    if (!Array.isArray(value) || !value.length)
        reject('source_refs must contain at least one original page');
    const out: Row[] = [];
    for (const ref of value) {
        if (!object(ref) || Object.keys(ref).some(key => !['page', 'box'].includes(key)))
            reject('a source reference contains only page and optional box');
        const page = ref.page;
        if (!integer(page) || page < 1 || page > pageCount)
            reject('a source reference is outside the original PDF');
        if (seen && ![...seen].some(value => equal(value, page)))
            reject(`physical page ${page} was not actually viewed by this reader`);
        if (Object.hasOwn(ref, 'box')) {
            const box = ref.box;
            if (!Array.isArray(box) || box.length !== 4 || box.some(v => !numeric(v) || !Number.isFinite(number(v))) ||
                !(0 <= number(box[0]) && number(box[0]) < number(box[2]) && number(box[2]) <= 1 &&
                    0 <= number(box[1]) && number(box[1]) < number(box[3]) && number(box[3]) <= 1))
                reject('box must be a normalized rectangle in the rotated page');
        }
        if (!out.some(old => equal(old, ref)))
            out.push(clone(ref));
    }
    return out;
}
export function numericPaths(value: any, path = ''): string[] {
    if (numeric(value))
        return [path];
    if (object(value))
        return entries(value).flatMap(([key, item]) => numericPaths(item, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`));
    if (Array.isArray(value))
        return value.flatMap((item, i) => numericPaths(item, `${path}/${i}`));
    return [];
}
export function requiredViewPages(draft: Row, baseline: Row | null = null): Array<number | bigint> {
    const pages = new Set<number | bigint>();
    for (const collection of ['nodes','claims','source_needs']) {
        const identity = (item: Row) => collection==='source_needs'?canonicalJson([item.focus,item.question,item.kind])
            :item.node_id || item.claim_id || canonicalJson([item.subject_id ?? null, item.predicate ?? null, item.object ?? null]);
        const previous = new Map(array(baseline?.[collection]).filter(isJsonObject).map(item => [identity(item), item]));
        for (const item of array(draft[collection])) {
            if (!object(item) || equal(previous.get(identity(item)), item))
                continue;
            for (const ref of [...array(item.source_refs), ...array(row(item.properties).image_sources)]) {
                if (object(ref) && integer(ref.page))
                    pages.add(ref.page);
            }
        }
    }
    return [...pages].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}
export function pointer(value: any, path: any): any {
    if (typeof path !== 'string' || !path.startsWith('/'))
        reject('review path must be a JSON pointer into the draft');
    for (const token of path.slice(1).split('/')) {
        const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
        if (Array.isArray(value)) {
            if (!/^[\s]*[+-]?\d+[\s]*$/.test(key))
                reject('review path does not exist in the draft', path);
            const index = Number(key), offset = index < 0 ? value.length + index : index;
            if (!Number.isSafeInteger(offset) || offset < 0 || offset >= value.length)
                reject('review path does not exist in the draft', path);
            value = value[offset];
        }
        else {
            if (!object(value) || !Object.hasOwn(value, key))
                reject('review path does not exist in the draft', path);
            value = value[key];
        }
    }
    return value;
}
/**
 * Contract §22.3.1: how a differing value for a published field is judged. `spans` answers the published
 * and the proposed span of one field; `reviewed` says whether an independent review covers the field
 * (publication), and is absent in the draft check, where a candidate replacement is collected for review
 * instead. `accept` receives every re-transcription the merge accepted.
 */
export interface Retranscription {
    spans(path: string): { existing: Anchor[]; proposed: Anchor[] };
    /** The draft check cannot see the published item's references (the host task omits a claim's): defer to publication. */
    unseen?: boolean;
    preserveExisting?: boolean;
    reviewed?(path: string): boolean;
    accept(path: string, previous: any, value: any): void;
}
export function contradiction(path: string, old: any, proposed: any, existing: Anchor[] = [], next: Anchor[] = []): never {
    const known = existing.length > 0 && next.length > 0;
    throw new RpcError('needs_choice', known
        ? `the new reading contradicts a published value read from another passage: the published value was read from page(s) ${pages(existing).join(', ')} and the new value cites page(s) ${pages(next).join(', ')}`
        : 'the new reading contradicts a published value', {
        fix: known
            ? 'keep the published value at details.path exactly as published; to correct how that same passage was transcribed, re-read the page it was read from (details.existing_pages), cite it in this item\'s source_refs and let the reviewer check it there'
            : 'compare both sources and preserve the existing fact until the conflict is explicitly resolved',
        details: { path, existing: old, proposed, ...(known ? { existing_pages: pages(existing), proposed_pages: pages(next) } : {}) },
    });
}
export function mergeValue(old: any, proposed: any, path = '', transcription?: Retranscription): any {
    if (equal(old, proposed))
        return clone(old);
    const parts = path.split('/');
    if (parts.length === 5 && parts[1] === 'nodes' && parts[2].startsWith('npc-') && parts[3] === 'properties' && ['knowledge', 'beliefs', 'lies'].includes(parts[4])) {
        const before = typeof old === 'string' ? [old] : old, added = typeof proposed === 'string' ? [proposed] : proposed;
        if (Array.isArray(before) && Array.isArray(added) && [...before, ...added].every(v => typeof v === 'string'))
            return clone([...before, ...added.filter(v => !before.includes(v))]);
    }
    // Contract §152.4: a map grows by region. A published region keeps its row (a differing row under the same id is
    // judged like any other field); a region id the published map lacks is added after the published ones.
    if (Array.isArray(old) && Array.isArray(proposed) && path.endsWith('/properties/map_regions')
        && [...old, ...proposed].every(item => object(item) && typeof item.region_id === 'string')) {
        const out = old.map((item, i) => {
            const next = proposed.find(value => value.region_id === item.region_id);
            return next === undefined ? clone(item) : mergeValue(item, next, `${path}/${i}`, transcription);
        });
        for (const item of proposed)
            if (!old.some(value => value.region_id === item.region_id)) out.push(clone(item));
        return out;
    }
    if (object(old) && object(proposed)) {
        const out = new Map(entries(old));
        for (const [key, value] of entries(proposed))
            out.set(key, out.has(key) ? mergeValue(out.get(key), value, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, transcription) : clone(value));
        return orderedObject(out);
    }
    if (Array.isArray(old) && Array.isArray(proposed) && ['/aliases', '/source_refs', '/known_by_ids', '/asserted_by_ids'].some(key => path.endsWith(key))) {
        return clone([...old, ...proposed.filter(v => !old.some(item => equal(item, v)))]);
    }
    if (transcription?.preserveExisting) { transcription.accept(path,clone(old),clone(proposed)); return clone(old); }
    if (transcription) {
        // One field, one passage read twice: the later reading replaces the earlier once a review covers it.
        const { existing, proposed: next } = transcription.spans(path);
        const deferred = !transcription.reviewed && transcription.unseen === true;
        if (deferred || existing.length && next.length && sameSpan(existing, next) && (transcription.reviewed?.(path) ?? true)) {
            transcription.accept(path, clone(old), clone(proposed));
            return clone(proposed);
        }
        contradiction(path, old, proposed, existing, next);
    }
    contradiction(path, old, proposed);
}
/**
 * Options of the draft check. `openingBatch`: the host's first-batch law (§22.0) runs as the last law of the third stage.
 * `graph`, §187.5.1: the whole-graph view the claim wrote beside the packet (`GRAPH_VIEW_FILE`): `known_nodes`,
 * `known_claims`, `field_spans` and `vocabulary` as the graph stood at the claim. The author's packet is cut to its job;
 * the check judges against this view, so the same-span rule of §22.3.1 reads the graph's spans, not the packet.
 */
export interface DraftCheckOptions { openingBatch?: boolean; graph?: Row }
/**
 * The packet as the check reads it: the job's own fields with the graph view's nodes, claims, spans and vocabulary, and the
 * identity answers already recorded for the bound source (§192.1: `identity_verdicts`, `identity_source`), and which node
 * stands for each copy (§192.3: `survivors`, variant id to survivor id).
 */
export function withGraphView(packet: Row, view: Row | null | undefined): Row {
    if (!view || !object(view)) return packet;
    return { ...packet, known_nodes: array(view.known_nodes), known_claims: array(view.known_claims), field_spans: row(view.field_spans),
        ...(object(view.vocabulary) ? { vocabulary: view.vocabulary } : {}),
        ...(object(view.identity_verdicts) ? { identity_verdicts: view.identity_verdicts } : {}),
        ...(typeof view.identity_source === 'string' ? { identity_source: view.identity_source } : {}),
        ...(object(view.survivors) ? { survivors: view.survivors } : {}) };
}
/**
 * The draft check (§22.3), in the three stages of contract §186.3: the envelope, the records, the graph and its evidence.
 * Each stage collects its independent findings; a later stage runs only when every earlier stage is clean. The refusal is
 * the first finding's, as the check has always worded it, with `details.findings` listing the stage's findings.
 */
export function checkDraft(draft: any, packet: Row, contract: ModuleContract, seen?: ReadonlySet<number>, options: DraftCheckOptions = {}): Row {
    packet = withGraphView(packet, options.graph);
    // Stage 1, the envelope: top-level keys, the contract, array-typed keys, coverage, and the job kind's own envelope laws.
    const envelope = new Stage();
    if (!object(draft)) {
        envelope.note(refusal('the draft must be an object'), { rule: 'draft_shape', value: draft });
        envelope.settle();
    }
    const vocab = contract.graph, skeleton = ['skeleton', 'guidance'].includes(packet.purpose);
    const shardKeys = [...SHARD_KEYS, ...(packet.visual_scan ? ['visual_candidates'] : [])];
    const unknown = Object.keys(draft).filter(key => !shardKeys.includes(key));
    if (unknown.length)
        envelope.note(refusal(`unknown draft keys: ${repr(sorted(unknown))}`), { rule: 'unknown_key', value: sorted(unknown), allowed: sorted(shardKeys) });
    const contractId = Object.hasOwn(draft, 'contract_id') ? draft.contract_id : VISUAL_CONTRACT_ID;
    if (contractId !== VISUAL_CONTRACT_ID)
        envelope.note(refusal('use the visual shard contract coc.module-graph-shard.v4'), { path: '/contract_id', rule: 'contract_id', value: contractId, allowed: [VISUAL_CONTRACT_ID] });
    // §39.4 (2026-09-30): a map-scope job's draft writes only the kind of its one map.
    if (packet.map_scope) envelope.run(() => checkMapScopeDraft(draft, packet, seen));
    if (Object.hasOwn(draft, 'source_needs') && !['guidance', 'opening', 'detail'].includes(packet.purpose))
        envelope.note(refusal('source_needs belongs to a checked source reading', '/source_needs'), { rule: 'source_needs_purpose' });
    else if (!Array.isArray(draft.source_needs ?? []) || array(draft.source_needs).length > 32)
        envelope.note(refusal('Error: source_needs must be a bounded array', '/source_needs'), { rule: 'not_an_array', value: draft.source_needs });
    for (const key of ['nodes', 'claims', 'node_refs', 'critical', 'ready_nodes'])
        if (!Array.isArray(draft[key]))
            envelope.note(refusal(`${key} must be an array`, `/${key}`), { rule: 'not_an_array', value: draft[key] });
    // A skeleton job's envelope: it publishes source-authored nodes, so its node list is not empty.
    if (skeleton && Array.isArray(draft.nodes) && !draft.nodes.length)
        envelope.note(refusal('a skeleton needs source-authored nodes before it can be published', '/nodes'), { rule: 'skeleton_nodes' });
    const domains = array(vocab.coverage_domains), statuses = array(vocab.coverage_status);
    const coverage = refusal(`coverage must be an object mapping domain to status; domains=${repr(vocab.coverage_domains)}, statuses=${repr(sorted(statuses))}; use {} when no domain is prepared`, '/coverage');
    if (!object(draft.coverage))
        envelope.note(coverage, { rule: 'coverage_shape', value: draft.coverage });
    else {
        const named = entries(draft.coverage).flatMap(([key, status]) => [
            ...(domains.includes(key) ? [] : [{ path: `/coverage/${token(key)}`, rule: 'coverage_domain', value: key, allowed: domains }]),
            ...(statuses.includes(status) ? [] : [{ path: `/coverage/${token(key)}`, rule: 'coverage_status', value: status, allowed: statuses }])]);
        if (named.length) envelope.note(coverage, ...named);
    }
    let candidates: any;
    if (packet.visual_scan) {
        if (!validVisualScan(packet.visual_scan, number(row(packet.source).page_count)))
            envelope.note(refusal('Invalid visual navigation range'), { rule: 'visual_scan_range' });
        else envelope.run(() => {
            try { candidates = visualCandidates(draft.visual_candidates, packet.visual_scan); } catch (error) { reject(String(error)); }
        }, { path: '/visual_candidates', rule: 'visual_candidates' });
        if (array(draft.nodes).length || array(draft.claims).length || array(draft.node_refs).length || array(draft.ready_nodes).length || array(draft.critical).length
            || object(draft.coverage) && Object.keys(draft.coverage).length || array(draft.source_needs).length)
            envelope.note(refusal('Visual navigation may nominate pages only; prepare assets in independent original-page tasks'), { rule: 'visual_scan_bounds' });
    }
    if (packet.visual_asset && object(draft.coverage) && Object.keys(draft.coverage).length)
        envelope.note(refusal('A visual scan records navigation coverage separately', '/coverage'), { rule: 'visual_coverage', value: draft.coverage });
    envelope.settle();

    // Stage 2, the records: per node and per claim, identifiers, kinds, vocabulary fields, references to defined nodes,
    // source refs, predicates and endpoints, and the record-local laws.
    const filled: Row = clone(draft), nodes = filled.nodes as Row[], existing = new Set(array(packet.known_nodes).map(n => n.node_id)), defined = new Set<string>();
    const knownKinds = new Map<any, any>(array(packet.known_nodes).map(n => [n.node_id, n.node_kind]));
    if (packet.visual_scan) filled.visual_candidates = candidates;
    if (moduleLogicReview(packet)) filled.review_policy = packet.review_policy;
    const count = packet.source.page_count, records = new Stage();
    for (const [i, node] of nodes.entries()) {
        if (!object(node)) {
            records.note(refusal('invalid node fields', `/nodes/${i}`), { rule: 'node_fields', value: node });
            continue;
        }
        const extra = Object.keys(node).filter(key => !NODE_KEYS.includes(key));
        if (extra.length)
            records.note(refusal('invalid node fields', `/nodes/${i}`), { rule: 'node_fields', value: extra, allowed: NODE_KEYS });
        const id = node.node_id, kind = node.node_kind, kindKnown = array(vocab.node_kinds).includes(kind);
        const identity = refusal('node kind/id must be unique and use the supplied vocabulary', `/nodes/${i}`), named: Array<Partial<DraftFinding>> = [];
        if (!kindKnown) named.push({ path: `/nodes/${i}/node_kind`, rule: 'node_kind', value: kind, allowed: vocab.node_kinds });
        if (!validSemanticId(id) || kindKnown && !id.startsWith(kind + '-') || defined.has(id))
            named.push({ path: `/nodes/${i}/node_id`, rule: 'node_id', value: id });
        if (named.length) records.note(identity, ...named);
        if (typeof id === 'string') defined.add(id);
        if (typeof node.name !== 'string' || !node.name.trim())
            records.note(refusal('each node needs its source name', `/nodes/${i}/name`), { rule: 'node_name', value: node.name });
        const shapes = [
            ...(object(Object.hasOwn(node, 'properties') ? node.properties : {}) ? [] : [{ path: `/nodes/${i}/properties`, rule: 'node_shape', value: node.properties }]),
            ...(Array.isArray(Object.hasOwn(node, 'aliases') ? node.aliases : []) ? [] : [{ path: `/nodes/${i}/aliases`, rule: 'node_shape', value: node.aliases }])];
        if (shapes.length)
            records.note(refusal('properties must be an object and aliases an array', `/nodes/${i}`), ...shapes);
        if (array(node.aliases).some(alias => typeof alias !== 'string'))
            records.note(refusal('aliases must contain names'), { path: `/nodes/${i}/aliases`, rule: 'alias_names', value: node.aliases });
        // §192.1: a new node's answer to `duplicate_of_published` names published nodes of its own kind, each once.
        if (Object.hasOwn(node, DISTINCT_FROM)) {
            const answer = node[DISTINCT_FROM], at = `/nodes/${i}/${DISTINCT_FROM}`;
            if (existing.has(id))
                records.note(refusal('distinct_from belongs to a new node; a published node keeps its own identity', at), { rule: DISTINCT_FROM, value: answer });
            else if (!Array.isArray(answer) || !answer.length || new Set(answer).size !== answer.length
                || answer.some(other => typeof other !== 'string' || knownKinds.get(other) !== kind))
                records.note(refusal(`distinct_from lists the published ${typeof kind === 'string' ? kind : 'same-kind'} node ids this node is not, each once`, at), { rule: DISTINCT_FROM, value: answer });
        }
        const props = row(node.properties);
        if (Object.hasOwn(props, 'map_candidates')) {
            if (kind !== 'scene' || !Array.isArray(props.map_candidates) || !props.map_candidates.length)
                records.note(refusal('map_candidates belongs to a scene and must not be empty', `/nodes/${i}/properties/map_candidates`), { rule: 'map_candidates' });
            else for (const [n, value] of props.map_candidates.entries()) {
                const candidate = row(value);
                if (typeof candidate.name !== 'string' || !candidate.name.trim() || typeof candidate.focus !== 'string' || !candidate.focus.trim()
                    || !Array.isArray(candidate.pages) || !candidate.pages.length || candidate.pages.some(page => !integer(page) || page < 1 || page > count))
                    records.note(refusal('a scene map candidate needs name, exact place focus and physical page numbers', `/nodes/${i}/properties/map_candidates/${n}`), { rule: 'map_candidates', value });
            }
        }
        if (['asset', 'handout'].includes(kind) && Object.hasOwn(props, 'asset_ref')) {
            const prior = row(array(packet.known_nodes).find(n => n.node_id === id));
            if (!equal(props.asset_ref, row(prior.properties).asset_ref ?? null))
                records.note(refusal('asset_ref is owned by the host; declare image_sources instead of a local file path', `/nodes/${i}/properties/asset_ref`), { rule: 'asset_ref', value: props.asset_ref });
        }
        if (Object.hasOwn(props, 'image_sources'))
            sourceRefs(records, props.image_sources, count, seen, `/nodes/${i}/properties/image_sources`);
        if (['npc', 'creature'].includes(kind))
            records.run(() => actorNumbersLaw(props, i, contract), error => row(error.details).rule ? {} : { rule: 'stats_outside_profile' });
        if (!Object.hasOwn(node, 'visibility'))
            node.visibility = array(packet.known_nodes).find(known => known.node_id === id)?.visibility ?? 'keeper-only';
        if (!array(vocab.visibility).includes(node.visibility))
            records.note(refusal('node visibility must use the supplied vocabulary'), { path: `/nodes/${i}/visibility`, rule: 'node_visibility', value: node.visibility, allowed: vocab.visibility });
        // The shaped source laws name their rule first; the generic law then judges what they did not refuse.
        const sourced = (!statesObligation(node) || records.run(() => obligationSourceLaw(node, i, seen), {}, item => `obligation ${item.node}: ${item.path}: ${item.message}`))
            && (!statesMechanics(node) || records.run(() => mechanicsSourceLaw(node, i, seen), {}, item => `mechanics ${item.node}: ${item.path}: ${item.message}`));
        if (sourced) {
            const refs = sourceRefs(records, node.source_refs, count, seen, `/nodes/${i}/source_refs`);
            if (refs) node.source_refs = refs;
        }
    }
    const ids = new Set([...existing, ...defined, `module-${packet.module_id}`]);
    const mapBox = (value: any): boolean => Array.isArray(value) && value.length === 4
        && value.every(item => numeric(item) && Number.isFinite(number(item)) && number(item) >= 0 && number(item) <= 1)
        && number(value[2]) > number(value[0]) && number(value[3]) > number(value[1]);
    const published = publishedNodes(array(packet.known_nodes));
    for (const [i, node] of nodes.entries()) {
        if (!object(node)) continue;
        const regions = row(node.properties).map_regions;
        if (regions != null) {
            if (!['asset', 'handout'].includes(node.node_kind) || !Array.isArray(regions) || !regions.length)
                records.note(refusal('map_regions belongs to an asset or handout and must not be empty', `/nodes/${i}/properties/map_regions`), { rule: 'map_regions' });
            else {
                const regionIds = new Set<string>();
                for (const [n, value] of regions.entries()) {
                    const region = row(value), id = typeof region.region_id === 'string' ? region.region_id.trim() : '', at = `/nodes/${i}/properties/map_regions/${n}`;
                    if (!validSemanticId(id) || regionIds.has(id)) records.note(refusal('map regions need unique semantic region_id values', at), { rule: 'map_regions', value: region.region_id });
                    regionIds.add(id);
                    if (typeof region.name !== 'string' || !region.name.trim() || typeof region.source_asset !== 'string' || !region.source_asset.trim())
                        records.note(refusal('a map region needs name and source_asset', at), { rule: 'map_regions' });
                    if (!mapBox(region.source_box ?? [0,0,1,1]) || !mapBox(region.placement) || array(region.redactions).some(value => !mapBox(value)))
                        records.note(refusal('map source, placement and redaction boxes must be normalized rectangles', at), { rule: 'map_regions' });
                    const source = [...nodes, ...array(packet.known_nodes)].find(item => row(item).node_kind === 'asset' && [item.node_id, String(item.node_id).replace(/^asset-/, '')].includes(region.source_asset));
                    if (!source) records.note(refusal('map region source_asset must name an asset node', `${at}/source_asset`), { rule: 'map_regions', value: region.source_asset });
                    else if (!['player-safe','revealable'].includes(source.visibility) && !(region.safe_after_redactions === true && array(region.redactions).length))
                        records.note(refusal('private map sources require reviewed redactions and safe_after_redactions', at), { rule: 'map_regions' });
                }
            }
        }
    }
    // §39.4 (2026-09-30): which kind of map each drafted map is.
    for (const [i, node] of nodes.entries())
        if (object(node)) records.run(() => checkMapScope(node, i, published));
    for (const key of ['node_refs', 'ready_nodes']) {
        const named = (filled[key] as any[]).flatMap((id, k) => typeof id !== 'string' || !ids.has(id) ? [{ path: `/${key}/${k}`, rule: 'node_reference', value: id }] : []);
        if (named.length) records.note(refusal('a node reference must name a defined node'), ...named);
    }
    const claimed = new Set<string>(), knownClaims = new Map<number, Row>();
    for (const [i, claim] of (filled.claims as Row[]).entries()) {
        if (!object(claim)) {
            records.note(refusal('invalid claim fields', `/claims/${i}`), { rule: 'claim_fields', value: claim });
            continue;
        }
        const extra = Object.keys(claim).filter(key => !CLAIM_KEYS.includes(key));
        if (extra.length)
            records.note(refusal('invalid claim fields', `/claims/${i}`), { rule: 'claim_fields', value: extra, allowed: CLAIM_KEYS });
        const target = row(claim.object).node_id, ends: Array<Partial<DraftFinding>> = [];
        if (!ids.has(claim.subject_id)) ends.push({ path: `/claims/${i}/subject_id`, rule: 'claim_endpoint', value: claim.subject_id });
        if (!ids.has(target)) ends.push(object(claim.object) ? { path: `/claims/${i}/object/node_id`, rule: 'claim_endpoint', value: target } : { path: `/claims/${i}/object`, rule: 'claim_endpoint', value: claim.object });
        if (!array(vocab.relation_kinds).includes(claim.predicate)) ends.push({ path: `/claims/${i}/predicate`, rule: 'claim_predicate', value: claim.predicate, allowed: vocab.relation_kinds });
        if (ends.length) records.note(refusal('a claim must connect defined nodes with a supplied predicate', `/claims/${i}`), ...ends);
        if (claim.predicate === 'impersonates' && claim.subject_id === target)
            records.note(refusal('an alias is not a second person; put it in aliases rather than a self-impersonation claim', `/claims/${i}`), { rule: 'self_impersonation' });
        if (object(claim.object) && !equal(Object.keys(claim.object), ['node_id']))
            records.note(refusal('claim objects contain only node_id'), { path: `/claims/${i}/object`, rule: 'claim_object', value: Object.keys(claim.object) });
        const matches = array(packet.known_claims).filter(old => Object.hasOwn(claim, 'claim_id') ? equal(old.claim_id, claim.claim_id) : ['subject_id', 'predicate', 'object'].every(key => equal(old[key] ?? null, claim[key] ?? null)));
        const known = matches.length === 1 ? matches[0] : {};
        knownClaims.set(i, known);
        if (!Object.hasOwn(claim, 'claim_id'))
            claim.claim_id = known.claim_id || `claim-${claim.subject_id}-${claim.predicate}-${target}`;
        if (!validSemanticId(claim.claim_id) || claimed.has(claim.claim_id))
            records.note(refusal('claim ids must be unique semantic identifiers'), { path: `/claims/${i}/claim_id`, rule: 'claim_id', value: claim.claim_id });
        claimed.add(claim.claim_id);
        if (!array(vocab.truth_status).includes(claim.truth_status))
            records.note(refusal('claims must declare authored fact, belief, rumor, lie or inference using the vocabulary'),
                { path: `/claims/${i}/truth_status`, rule: 'truth_status', value: claim.truth_status, allowed: vocab.truth_status });
        if (!Object.hasOwn(claim, 'visibility'))
            claim.visibility = Object.hasOwn(known, 'visibility') ? known.visibility : 'keeper-only';
        if (!array(vocab.visibility).includes(claim.visibility))
            records.note(refusal('invalid claim visibility'), { path: `/claims/${i}/visibility`, rule: 'claim_visibility', value: claim.visibility, allowed: vocab.visibility });
        const refs = sourceRefs(records, claim.source_refs, count, seen, `/claims/${i}/source_refs`);
        if (refs) claim.source_refs = refs;
        for (const key of ['known_by_ids', 'asserted_by_ids']) {
            if (!Object.hasOwn(claim, key))
                claim[key] = clone(known[key] ?? []);
            if (!Array.isArray(claim[key]) || claim[key].some((id: any) => !ids.has(id)))
                records.note(refusal(`${key} must name defined nodes`), { path: `/claims/${i}/${key}`, rule: 'claim_holders', value: claim[key] });
        }
        if (!Object.hasOwn(claim, 'validity'))
            claim.validity = known.validity ?? null;
    }
    records.settle();

    // Stage 3, the graph and its evidence: cross-record and scope laws -- source needs, dependencies, readiness,
    // published-value contradictions, pointers the review must reach, required views, and the graph-wide shape laws.
    const graph = new Stage();
    const sourceNeeds: SourceNeed[] = [];
    let needsValid = true;
    for (const [j, need] of array(draft.source_needs).entries())
        needsValid = graph.run(() => {
            try { sourceNeeds.push(...validateSourceNeeds([need], number(row(packet.source).page_count))); } catch (error) { reject(String(error), '/source_needs'); }
        }, { path: `/source_needs/${j}`, rule: 'source_needs', value: need }) && needsValid;
    const pending = needsValid ? sourceNeeds.filter(need => ['source_read', 'uncertain'].includes(need.kind)) : [];
    if (pending.length && !packet.source_unit && !packet.visual_asset)
        graph.note(new RpcError('invalid_params', 'Current source needs remain unresolved', {
            fix: 'Retrieve the required original evidence and repair the candidate; retain runtime inputs and future needs explicitly',
            details: { reason: 'reading_failed', rule: 'source_needs_pending', path: '/source_needs', requests: pending as any },
        }), ...pending.map(need => ({ path: `/source_needs/${sourceNeeds.indexOf(need)}`, rule: 'source_needs_pending', value: need.question })));
    if (!equal(draft.dependencies, []))
        graph.note(refusal("resolve the current scope's source dependencies before publication", '/dependencies'), { rule: 'dependencies', value: draft.dependencies });
    if (skeleton && filled.ready_nodes.length)
        graph.note(refusal('a skeleton cannot grant material readiness; ready_nodes must be empty', '/ready_nodes'), { rule: 'skeleton_readiness', value: filled.ready_nodes });
    if (!filled.ready_nodes.length && !skeleton && !packet.source_unit && !packet.visual_scan && !packet.visual_asset && !packet.map_scope)
        graph.note(refusal('declare the nodes whose material this task has prepared', '/ready_nodes'), { rule: 'readiness_undeclared' });
    const absent = (filled.ready_nodes as any[]).flatMap((id, k) => defined.has(id) ? [] : [{ path: `/ready_nodes/${k}`, rule: 'readiness_unreviewable', value: id }]);
    if (absent.length)
        graph.note(refusal('ready_nodes must be present in the draft so their material can be independently reviewed', '/ready_nodes'), ...absent);
    if (packet.visual_asset) {
        const page = packet.visual_asset.page;
        if (!integer(page) || page < 1 || page > packet.source.page_count)
            graph.note(refusal('Invalid visual asset page'), { rule: 'visual_asset_page' });
        else if (seen && !seen.has(page))
            graph.note(refusal('Visual asset preparation requires the nominated original page'), { rule: 'visual_asset_page', value: page });
        // §204.6: a portrait depicts its person. The draft may name a person as a thin identity (`npc`, no dossier); a place
        // identity carrying a person's name -- of the draft, the known roster or the book's cast -- is refused, because it is
        // the person, and a place-only identity was the only target a portrait's `depicts` had (Cold Harvest p37, p39).
        const nameKeys = (value: Row): string[] => [value.name, ...array(value.aliases)].filter((name): name is string => typeof name === 'string').map(normalize).filter(Boolean);
        const people = new Set([...nodes, ...array(packet.known_nodes)].filter(value => object(value) && value.node_kind === 'npc').flatMap(nameKeys));
        for (const person of array(packet.cast_names)) for (const name of [...array(row(person).book), ...array(row(person).play)]) if (typeof name === 'string' && normalize(name)) people.add(normalize(name));
        for (const [i, node] of nodes.entries()) {
            if (!['asset','handout','scene','location','npc'].includes(node.node_kind))
                graph.note(refusal('Visual discovery prepares visual assets, place identities and the people a picture depicts only', '/nodes'),
                    { path: `/nodes/${i}/node_kind`, rule: 'visual_asset_kind', value: node.node_kind, allowed: ['asset', 'handout', 'scene', 'location', 'npc'] });
            if (['scene','location'].includes(node.node_kind) && Object.keys(row(node.properties)).length)
                graph.note(refusal('Visual discovery must preserve existing place dossiers', '/nodes'), { path: `/nodes/${i}/properties`, rule: 'visual_asset_place' });
            if (node.node_kind === 'npc' && Object.keys(row(node.properties)).length)
                graph.note(refusal('Visual discovery names a pictured person as a thin identity; their dossier is read elsewhere', '/nodes'), { path: `/nodes/${i}/properties`, rule: 'visual_asset_person' });
            if (['scene','location'].includes(node.node_kind) && nameKeys(node).some(name => people.has(name)))
                graph.note(refusal('A place identity cannot carry a person\'s name: a picture of a person depicts that person. Link the asset to the person (node_refs, or a thin npc identity) and drop this place', '/nodes'),
                    { path: `/nodes/${i}`, rule: 'visual_place_is_person', value: node.name });
            if (filled.ready_nodes.includes(node.node_id) && !['asset','handout'].includes(node.node_kind))
                graph.note(refusal('Visual discovery cannot grant scene readiness', '/ready_nodes'), { path: `/ready_nodes/${filled.ready_nodes.indexOf(node.node_id)}`, rule: 'visual_asset_readiness', value: node.node_id });
            if (['asset','handout'].includes(node.node_kind) && !array(row(node.properties).image_sources).length)
                graph.note(refusal('Visual discovery assets require original-page crops', '/nodes'), { path: `/nodes/${i}/properties/image_sources`, rule: 'visual_asset_crops' });
        }
    }
    const knownNodes = new Map(array(packet.known_nodes).map(n => [n.node_id, n]));
    // §22.3.1: a differing value for a published field is judged by span here, before review. A
    // re-transcription of the same span (or one whose span this check cannot see) owes the review.
    // Merges run on `/<collection>/<id>` pointers, as publication's do (the NPC dossier union keys on them);
    // a re-transcription is collected as the draft's own `/<collection>/<i>` pointer for the review.
    const spans = row(packet.field_spans), retranscribed: string[] = [];
    const judge = (base: string, draftBase: string, known: Row, drafted: Row): Retranscription => ({
        spans: path => ({ existing: spanOf(spans, path, known.source_refs), proposed: anchors(drafted.source_refs) }),
        unseen: !Object.hasOwn(known, 'source_refs'),
        preserveExisting:moduleLogicReview(packet)&&(known.ready!==false||known.node_kind==='module'),
        accept: path => retranscribed.push(draftBase + path.slice(base.length)),
    });
    const contradicted = (error: RpcError): Partial<DraftFinding> => ({ rule: 'published_value', value: row(error.details).proposed });
    for (const [i, node] of nodes.entries()) {
        const known = knownNodes.get(node.node_id);
        // The placeholder module node of an unread book carries no source refs and nothing read.
        if (!known || !Object.hasOwn(known, 'ready') || known.node_kind === 'module' && !Object.hasOwn(known, 'source_refs'))
            continue;
        const proposed = Object.fromEntries(entries(node).filter(([key]) => Object.hasOwn(known, key) && key !== 'source_refs'));
        if (!truth(known.ready) && filled.ready_nodes.includes(node.node_id))
            delete proposed.summary;
        graph.run(() => mergeValue(Object.fromEntries(Object.keys(proposed).map(key => [key, known[key]])), proposed, `/nodes/${node.node_id}`,
            judge(`/nodes/${node.node_id}`, `/nodes/${i}`, known, node)), contradicted);
    }
    if (Object.hasOwn(draft, 'source_needs') && needsValid) {
        const view = new ModuleGraph(string(packet.module_id), { nodes: [...array(packet.known_nodes), ...nodes] }, '', {});
        for (const [j, need] of sourceNeeds.entries()) {
            if (!view.find(need.focus))
                graph.note(refusal('A retained source need must name a candidate or accepted entity', '/source_needs'), { path: `/source_needs/${j}/focus`, rule: 'source_need_focus', value: need.focus });
            if ((packet.source_unit || packet.visual_asset) && ['source_read', 'uncertain'].includes(need.kind) && filled.ready_nodes.includes(view.find(need.focus)?.node_id))
                graph.note(refusal('A partial source fragment cannot mark an unresolved entity ready', '/ready_nodes'), { path: `/source_needs/${j}/focus`, rule: 'source_need_ready', value: need.focus });
            if (packet.purpose === 'detail' && need.kind === 'deferred' && string(packet.question).trim() === need.question.trim()
                && view.find(string(packet.focus))?.node_id === view.find(need.focus)?.node_id)
                graph.note(refusal('A detail reading cannot defer its own requested source question', '/source_needs'), { path: `/source_needs/${j}/question`, rule: 'source_need_own_question' });
            sourceRefs(graph, need.source_refs, count, seen, `/source_needs/${j}/source_refs`);
        }
    }
    const opening = packet.opening_scope === 'first_interaction' || Object.hasOwn(draft, 'interaction_scene');
    if (opening) {
        if (packet.purpose !== 'opening') graph.note(refusal('interaction_scene belongs only to an opening reading', '/interaction_scene'), { rule: 'interaction_scene' });
        else graph.run(() => checkOpeningBatch(filled, packet.focus, array(packet.known_nodes), true, array(packet.known_claims)), { rule: 'opening_batch' });
    }
    if (packet.source_unit && seen) {
        const unviewed = array(packet.pages).filter(page => !seen.has(number(page)));
        if (unviewed.length) graph.note(refusal('A source unit requires its assigned original pages', '/coverage'), { rule: 'source_unit_pages', value: unviewed });
    }
    // The pointers the review must reach exist in the draft; a critical entry is named by its own place in /critical.
    const required = new Set<any>(), pointed = new Map<any, string>();
    for (const [k, path] of (filled.critical as any[]).entries()) {
        const root = moduleLogicReview(packet) ? moduleReviewRoot(path) : path;
        if (!required.has(root)) { required.add(root); pointed.set(root, `/critical/${k}`); }
    }
    if (Object.hasOwn(draft, 'source_needs')) required.add('/source_needs');
    if (opening) required.add('/interaction_scene');
    if (!skeleton && (filled.ready_nodes.length || packet.source_unit)) required.add('/coverage');
    for (const path of required)
        graph.run(() => pointer(draft, path), { path: pointed.get(path) ?? path, rule: 'review_pointer', value: path });
    for (const [i, claim] of (filled.claims as Row[]).entries()) {
        const known = knownClaims.get(i) ?? {};
        if (!Object.keys(known).length) continue;
        const fields = Object.fromEntries(entries(claim).filter(([key]) => Object.hasOwn(known, key) && !['claim_id', 'source_refs'].includes(key)));
        graph.run(() => mergeValue(Object.fromEntries(Object.keys(fields).map(key => [key, known[key]])), fields, `/claims/${claim.claim_id}`,
            judge(`/claims/${claim.claim_id}`, `/claims/${i}`, known, claim)), contradicted);
    }
    if (nodes.some(statesObligation))
        graph.run(() => checkObligations(filled, packet, contract), {}, item => `obligation ${item.node}: ${item.path}: ${item.message}`);
    graph.run(() => checkMechanics(filled, packet, contract), {}, item => `mechanics ${item.node}: ${item.path}: ${item.message}`);
    graph.run(() => checkBeings(filled, packet, contract), {}, item => `${item.claim ? `claim ${item.claim}` : `node ${item.node}`}: ${item.path}: ${item.message}`);
    // §192.1: one thing, one node. A new node named like a published node of its kind, and not answered by its distinct_from or
    // by a verdict already recorded, is refused here before any review is spent; `module.read.finish` asks again, against the
    // generation the draft lands on.
    const identitySource = typeof packet.identity_source === 'string' ? packet.identity_source
        : typeof row(packet.source).file_sha256 === 'string' ? row(packet.source).file_sha256 : '';
    // §192.3: pairs are made against survivors, as the claim's view names them.
    const survivors = row(packet.survivors);
    const duplicates = publishedDuplicates(nodes, array(packet.known_nodes), typeof packet.module_id === 'string' ? packet.module_id : 'module',
        array(packet.cast_names), row(packet.identity_verdicts), identitySource, id => typeof survivors[id] === 'string' ? survivors[id] : id).filter(pair => !pair.declared);
    if (duplicates.length)
        graph.note(duplicateRefusal(duplicates), ...duplicates.map(pair => ({ path: pair.path, rule: DUPLICATE_RULE, message: duplicateMessage(pair), value: pair.shared })));
    if (options.openingBatch)
        graph.run(() => checkOpeningBatch(row(draft), packet.focus, packet.known_nodes, packet.opening_scope === 'first_interaction', packet.known_claims), { rule: 'opening_batch' });
    graph.settle();

    // What the independent review must cover.
    for (const [i, node] of nodes.entries()) {
        if(!moduleLogicReview(packet))for (const path of numericPaths(Object.fromEntries(entries(node.properties).filter(([key]) => !['image_sources', 'map_candidates'].includes(key))), `/nodes/${i}/properties`))
            required.add(path);
        if (filled.ready_nodes.includes(node.node_id) || packet.purpose === 'guidance')
            required.add(`/nodes/${i}`);
        // §39.4: a map's kind is checked against the original page, under either review policy.
        if (Object.hasOwn(row(node.properties), 'map_scope'))
            required.add(`/nodes/${i}/properties/map_scope`);
    }
    for (const i of (filled.claims as Row[]).keys())
        required.add(`/claims/${i}`);
    // §192.1: a node's distinct_from is reviewed as written under either policy; an unsupported one refuses (`checkReview`).
    for (const [i, node] of nodes.entries())
        if (Object.hasOwn(node, DISTINCT_FROM))
            required.add(`/nodes/${i}/${DISTINCT_FROM}`);
    // §199.2: a person's summary and first-meeting appearance are their own pointers under either policy (TR-F2: the record
    // `/nodes/5` was supported while its summary made the living husband of a dead woman dead).
    for (const [i, node] of nodes.entries())
        for (const tail of PERSON_STATEMENTS) {
            const path = `/nodes/${i}${tail}`, value = tail === '/summary' ? node.summary : row(node.properties).appearance;
            if (personStatementPath(filled, path) && value !== undefined && value !== null && value !== '')
                required.add(path);
        }
    // The field a later reading re-transcribed is named in the review, so the replacement is a reviewed one.
    for (const path of retranscribed)
        required.add(moduleLogicReview(packet)?moduleReviewRoot(path):path);
    if (nodes.some(statesObligation) && !moduleLogicReview(packet))
        for (const [i, node] of nodes.entries())
            for (const path of obligationReviewPaths(node, `/nodes/${i}`))
                required.add(path);
    if(!moduleLogicReview(packet))for (const [i, node] of nodes.entries())
        for (const path of shapeReviewPaths(node, `/nodes/${i}`))
            required.add(path);
    filled.required_review = sorted(required);
    return filled;
}

/** Contract §134.16: an obligation refusal names its node, its JSON pointer and its stable rule. */
function refuseObligation(refusals: Row[], extra: Row = {}): never {
    const first = refusals[0];
    throw new RpcError('invalid_params', `obligation ${first.node}: ${first.path}: ${first.message}`, {
        fix: 'correct the obligation and its claims against the page it cites (contract 134): record a difficulty or skill the page does not state as difficulty_unstated or approaches_unstated, never guess one; '
            + (Object.hasOwn(extra, 'ruleset') ? 'name each skill and characteristic exactly as details.ruleset spells it; ' : '')
            + 'if the page states no such demand, delete the requirement node and its claims',
        details: { reason: 'reading_failed', path: first.path, rule: first.rule, refusals, ...extra },
    });
}
/** §134.16 step 1: a stated obligation's own source law, before the generic one, so the refusal carries its path and rule. */
function obligationSourceLaw(node: Row, i: number, seen?: ReadonlySet<any>): void {
    const refs = node.source_refs, id = string(node.node_id);
    if (!Array.isArray(refs) || !refs.length)
        refuseObligation([{ node: id, rule: 'obligation_unsourced', path: `/nodes/${i}/source_refs`, message: 'an obligation cites the page that states it' }]);
    if (!seen) return;
    const unviewed = refs.flatMap((ref: any, j: number) => object(ref) && integer(ref.page) && ![...seen].some(page => equal(page, ref.page))
        ? [{ node: id, rule: 'obligation_unviewed_page', path: `/nodes/${i}/source_refs/${j}`, message: `physical page ${ref.page} was not actually viewed by this reader` }] : []);
    if (unviewed.length) refuseObligation(unviewed);
}
/** The validator's dotted path (`properties.obligation.demand[1].values[0].path`) as JSON pointer tokens. */
function pointerTokens(path: string): string {
    return path.split('.').flatMap(part => {
        const [key, ...indices] = part.split('[');
        return [key, ...indices.map(index => index.replace(/]$/, ''))];
    }).filter(key => key !== '').map(key => '/' + key.replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}
/**
 * §134.16 step 2: SO-01's validator over the graph this draft would publish into -- the known nodes and
 * claims overlaid by the draft's, with one relation per claim as `assembleVisual` derives them.
 */
function checkObligations(filled: Row, packet: Row, contract: ModuleContract): void {
    if (!contract.rules)
        throw new Error('the draft states an obligation but the content root carries no ruleset tables to check it against');
    const drafted = new Map<string, number>((filled.nodes as Row[]).map((node, i) => [string(node.node_id), i]));
    const refusals: Refusal[] = obligationRefusals(overlayGraph(filled, packet, contract, false), contract.rules, { starter: false });
    if (!refusals.length) return;
    const located = locate(refusals, drafted);
    refuseObligation(located, located.some(refusal => refusal.rule === 'check_unknown_skill')
        ? { ruleset: { skills: [...contract.rules.skills], characteristics: [...contract.rules.characteristics] } } : {});
}
/** A refusal on a drafted node points into the draft; one on a known node keeps the validator's path. Draft nodes first. */
function locate(refusals: Refusal[], drafted: ReadonlyMap<string, number>): Row[] {
    const located = refusals.map(refusal => drafted.has(string(refusal.node))
        ? { ...refusal, path: `/nodes/${drafted.get(string(refusal.node))}${pointerTokens(refusal.path)}` } : { ...refusal });
    located.sort((a, b) => Number(!drafted.has(string(a.node))) - Number(!drafted.has(string(b.node))));
    return located;
}
/** A drafted value over a known one, objects merged key by key as publication's `mergeValue` merges them. */
function deepOverlay(known: any, drafted: any): any {
    if (!object(known) || !object(drafted)) return drafted;
    const out: Row = { ...known };
    for (const [key, value] of entries(drafted)) out[key] = Object.hasOwn(known, key) ? deepOverlay(known[key], value) : value;
    return out;
}
/**
 * The graph this draft would publish into: `packet.known_nodes` overlaid by the draft's nodes,
 * `packet.known_claims` overlaid by the draft's claims by `claim_id`, and one relation per claim, as
 * `assembleVisual` derives them. §134.16 overlays a drafted node's `properties` over the known node's
 * key by key (`deep` false); §136.26 merges them all the way down (`deep` true), as publication does, so
 * a delta that adds one slot to a known shape is checked as the shape it makes. With `filled` null the
 * view is the known graph alone.
 */
function overlayGraph(filled: Row | null, packet: Row, contract: ModuleContract, deep: boolean): ModuleGraph {
    const nodes = new Map<string, Row>(array(packet.known_nodes).filter(object).map(node => {
        const { ready: _ready, ...known } = node;
        return [string(node.node_id), known];
    }));
    for (const node of array(filled?.nodes)) {
        const known = nodes.get(node.node_id);
        nodes.set(node.node_id, !known ? node : deep ? deepOverlay(known, node)
            : { ...known, ...node, properties: { ...row(known.properties), ...row(node.properties) } });
    }
    const claims = new Map<string, Row>(array(packet.known_claims).filter(object).map((claim, i) => [string(claim.claim_id) || `known-${i}`, claim]));
    for (const claim of array(filled?.claims)) claims.set(claim.claim_id, claim);
    const kinds = array(contract.graph.relation_kinds);
    const relations = [...claims.values()].filter(claim => kinds.includes(claim.predicate)).map(claim => ({
        relation_id: 'rel-' + string(claim.claim_id).replace(/^claim-/, ''), relation_kind: claim.predicate,
        from_node_id: claim.subject_id, to_node_id: row(claim.object).node_id, claim_id: claim.claim_id, properties: {},
    }));
    return new ModuleGraph(string(packet.module_id), { nodes: [...nodes.values()], claims: [...claims.values()], relations }, '', row(contract.graph.actor_dossier));
}

/**
 * Contract §136.26: an actor's numbers outside `mechanics.profile` do not reach the rules engine. The standalone
 * dictionary refusal is §22's, unchanged in its bytes and now also on creatures; a loose characteristic number is
 * refused with its path and rule.
 */
function actorNumbersLaw(props: Row, i: number, contract: ModuleContract): void {
    if (['stats', 'skills', 'characteristics', 'derived'].some(key => object(props[key])) && !object(row(props.mechanics).profile))
        reject('put authored NPC numbers in properties.mechanics.profile (characteristics, derived, skills); a standalone stats dictionary does not reach the rules engine', `/nodes/${i}/properties`);
    const names = array(contract.rules?.characteristics).map(normalize);
    const flat = Object.keys(props).find(key => numeric(props[key]) && names.includes(normalize(key)));
    if (flat !== undefined)
        throw new RpcError('invalid_params', `the characteristic ${repr(flat)} is a number beside the stat block; put it in properties.mechanics.profile.characteristics, where the rules engine reads it`, {
            fix: "move the actor's printed numbers into properties.mechanics.profile (characteristics, derived, skills) and delete the loose copy; do not recalculate them",
            details: { reason: 'reading_failed', path: `/nodes/${i}/properties/${flat.replace(/~/g, '~0').replace(/\//g, '~1')}`, rule: 'profile_outside_seat' },
        });
}
/** §136.26 step 1: a node stating a shape cites pages this reader viewed, refused with its path and rule before the generic law. */
function mechanicsSourceLaw(node: Row, i: number, seen?: ReadonlySet<any>): void {
    const refs = node.source_refs, id = string(node.node_id);
    if (!Array.isArray(refs) || !refs.length)
        refuseMechanics([{ node: id, rule: 'mechanics_unsourced', path: `/nodes/${i}/source_refs`, message: 'a node stating a mechanic cites the page that states it' }]);
    if (!seen) return;
    const unviewed = refs.flatMap((ref: any, j: number) => object(ref) && integer(ref.page) && ![...seen].some(page => equal(page, ref.page))
        ? [{ node: id, rule: 'mechanics_unsourced', path: `/nodes/${i}/source_refs/${j}`, message: `physical page ${ref.page} was not actually viewed by this reader` }] : []);
    if (unviewed.length) refuseMechanics(unviewed);
}
/** Contract §136.26: a shape refusal names its node, its JSON pointer and its stable rule; the fix follows the rules refused. */
function refuseMechanics(refusals: Row[], extra: Row = {}): never {
    const first = refusals[0], rules = new Set(refusals.map(refusal => refusal.rule));
    throw new RpcError('invalid_params', `mechanics ${first.node}: ${first.path}: ${first.message}`, {
        fix: 'correct the shape against the page it cites (contract 136): '
            + (rules.has('mechanics_unsourced') ? 'cite only physical pages you viewed that print the mechanic; ' : '')
            + 'record a value the page does not state as <slot>_unstated: true, never guess one; '
            + (Object.hasOwn(extra, 'ruleset') ? 'name each skill and characteristic exactly as details.ruleset spells it; ' : '')
            + (rules.has('shape_dice') ? 'write dice as the bare expression, such as 1D4+2, with any words in book and a damage bonus as adds_damage_bonus: true; ' : '')
            + (rules.has('mechanics_wrong_kind') || rules.has('mechanics_unknown_shape') ? 'put each shape under its own key on the node that states it, of a kind contract 136.1 admits for that shape; ' : '')
            + 'if the page states no such mechanic, delete that shape',
        details: { reason: 'reading_failed', path: first.path, rule: first.rule, refusals, ...extra },
    });
}
/**
 * §136.26 step 2: the shared validator over the graph this draft would publish into, `starter: false`
 * (no legacy allowance). A refusal the known graph already earns on its own is not the draft's: the draft
 * cannot remove a published key, so only the refusals the draft introduces refuse it.
 */
function checkMechanics(filled: Row, packet: Row, contract: ModuleContract): void {
    const view = overlayGraph(filled, packet, contract, true);
    if (!carriesMechanics(view)) return;
    if (!contract.rules) {
        if ((filled.nodes as Row[]).some(statesMechanics))
            throw new Error('the draft states a mechanic but the content root carries no ruleset tables to check it against');
        return;
    }
    const identity = (refusal: Refusal): string => canonicalJson([string(refusal.node), refusal.rule, refusal.path]);
    const known = new Set(mechanicsRefusals(overlayGraph(null, packet, contract, true), contract.rules, { starter: false }).map(identity));
    const refusals = mechanicsRefusals(view, contract.rules, { starter: false }).filter(refusal => !known.has(identity(refusal)));
    if (!refusals.length) return;
    const drafted = new Map<string, number>((filled.nodes as Row[]).map((node, i) => [string(node.node_id), i]));
    const located = locate(refusals, drafted);
    refuseMechanics(located, located.some(refusal => refusal.rule === 'shape_unknown_skill')
        ? { ruleset: { skills: [...contract.rules.skills], characteristics: [...contract.rules.characteristics], specialization_groups: Object.keys(contract.rules.groups) } } : {});
}
/** Contract §180.7: the literal repair for two nodes of one being. */
const ONE_BEING_FIX = 'one being is one node (contract 180.7): keep the single node whose kind contract 180.2 decides from how the book treats the being in this encounter -- '
    + 'npc when the book lets the investigators deal with it as someone (talk, bargain, persuade, argue it down, call its name), creature when the book presents it only as a body -- '
    + 'put both nodes\' sourced facts, numbers and claims on the node you keep, and delete the other node and its claims from the draft; '
    + 'when the other node is already published (details.pairs[].published), keep the published node and add your facts to it instead of drafting a second one';
/**
 * Contract §180.7, §180.9: one being, one node; the weakness entry when the build bound it; the listed relations'
 * endpoints. Each runs over the graph this draft would publish into, and, as for a mechanical shape, only what the
 * draft introduces refuses it: a published pair or entry is a compile snapshot the draft cannot remove (§180.7).
 */
function checkBeings(filled: Row, packet: Row, contract: ModuleContract): void {
    const view = overlayGraph(filled, packet, contract, true), known = overlayGraph(null, packet, contract, true);
    const drafted = new Map<string, number>((filled.nodes as Row[]).map((node, i) => [string(node.node_id), i]));
    const published = new Set(beingPairs(known).map(pair => canonicalJson([pair.npc, pair.creature])));
    const pairs = beingPairs(view).filter(pair => !published.has(canonicalJson([pair.npc, pair.creature])));
    if (pairs.length) {
        const located = pairs.map(pair => {
            const at = [pair.creature, pair.npc].map(id => drafted.get(id)).find(index => index !== undefined)!;
            return { ...pair, path: `/nodes/${at}`, ...(drafted.has(pair.npc) && drafted.has(pair.creature) ? {} : { published: drafted.has(pair.npc) ? pair.creature : pair.npc }) };
        });
        const first = located[0];
        throw new RpcError('invalid_params', `one being, two nodes: ${first.npc} and ${first.creature} share the name ${repr(first.shared)}`, {
            fix: ONE_BEING_FIX,
            details: { reason: 'one_being_two_nodes', rule: 'one_being_two_nodes', path: first.path, pairs: located },
        });
    }
    const law = contract.graph, bound = weaknessesBound(packet);
    if (bound && !object(law.actor_weaknesses))
        throw new Error('the task binds actor.weaknesses.v1 but the graph contract carries no actor_weaknesses law to check it against');
    const earned = (graph: ModuleGraph): BeingRefusal[] => [
        ...(bound ? weaknessRefusals(graph, row(law.actor_weaknesses)) : []),
        ...(object(law.relation_endpoints) ? endpointRefusals(graph, row(law.relation_endpoints)) : [])];
    const identity = (refusal: BeingRefusal): string => canonicalJson([string(refusal.node), string(refusal.claim ?? ''), refusal.rule, refusal.claim ? '' : refusal.path]);
    const before = new Set(earned(known).map(identity)), refusals = earned(view).filter(refusal => !before.has(identity(refusal)));
    if (!refusals.length) return;
    const claimed = new Map<string, number>((filled.claims as Row[]).map((claim, i) => [string(claim.claim_id), i]));
    const located = [...locate(refusals.filter(refusal => !refusal.claim), drafted),
        ...refusals.filter(refusal => refusal.claim).map(refusal => claimed.has(refusal.claim!) ? { ...refusal, path: `/claims/${claimed.get(refusal.claim!)}` } : { ...refusal })];
    const first = located[0], rules = new Set(located.map(refusal => refusal.rule));
    throw new RpcError('invalid_params', `${first.claim ? `claim ${first.claim}` : `node ${first.node}`}: ${first.path}: ${first.message}`, {
        fix: [
            ...(rules.has('relation_endpoints') ? ['connect each refused claim only between the node kinds task.vocabulary.relation_endpoints lists for its predicate (contract 180.9): '
                + 'misleads runs from the clue to the npc or creature its false belief is about; a false lead against a weakness the book also states truly is contradicts from that clue to the weakness\'s conclusion; '
                + 'if the book supports neither, delete the claim'] : []),
            ...(located.some(refusal => !refusal.claim) ? ['correct each weaknesses entry against the page it cites (contract 180.9): '
                + 'every entry is an object with book, one English line in the book\'s terms saying what harms, repels, binds, banishes or ends the being, with its conditions and degree (a stat-line resistance too); '
                + 'needs lists node_ids of the means the book names, each a node this draft or the published graph defines, of a kind task.vocabulary.actor_weaknesses.node_refs.needs.kinds lists -- draft the means as its own node when it has none; '
                + 'learned_by is the node_id of the conclusion the investigators reach that states the weakness, supported by the clues that teach it, and is left out when the book gives no route; '
                + 'never write an entry, a means or a route the book does not give'] : []),
        ].join('; also '),
        details: { reason: 'reading_failed', path: first.path, rule: first.rule, refusals: located },
    });
}
/** Contract §22.3.2: what a review judged, per draft pointer: the paths it supported and the classification fields it contested. */
export interface ReviewJudgement { supported: Set<string>; contested: Row[] }
/** Contract §22.3.2: a draft pointer is a classification field when the graph contract's `classification_fields` say so. */
export function classificationFields(contract: ModuleContract): (path: string) => boolean {
    return classificationMatcher(row(contract.graph.classification_fields).node);
}
/** §151.3: the host's native-text record of the bound source, as the gate reads it from `claim-support.json`. */
export interface ClaimEvidence { extractionVersion: string; pages: ReadonlyMap<number, { text: string; sha256: string }> }
/**
 * §151.3: the evidence file, or undefined when it is not one for this source: another protocol, another source's digest,
 * no extraction version, or a page whose text does not hash to the digest it states.
 */
export function claimEvidence(value: any, sourceSha: string): ClaimEvidence | undefined {
    if (!object(value) || value.protocol !== CLAIM_SUPPORT_PROTOCOL || value.source_sha256 !== sourceSha
        || typeof value.extraction_version !== 'string' || !value.extraction_version || !Array.isArray(value.pages))
        return undefined;
    const pages = new Map<number, { text: string; sha256: string }>();
    for (const page of value.pages) {
        if (!object(page) || !integer(page.page) || typeof page.text !== 'string' || typeof page.text_sha256 !== 'string'
            || sha256Text(page.text) !== page.text_sha256 || pages.has(number(page.page)))
            return undefined;
        pages.set(number(page.page), { text: page.text, sha256: page.text_sha256 });
    }
    return { extractionVersion: value.extraction_version, pages };
}
function refuseJev(rule: string, message: string, path: string): never {
    throw new RpcError('invalid_params', `Jev-checked review row refused at ${path}: ${message}`, {
        fix: 'review this record with the vision reviewer against its original pages; preserve the completed author draft',
        details: { reason: 'reading_failed', path, rule },
    });
}
/**
 * §151.3's evidence amendment for one `reviewer: "jev"` row: one record's paths, `supported`, an eligible record (§186.6:
 * one carrying no classification field), the page-text digests and extraction version of the evidence file for exactly
 * the record's cited pages, a distribution, and no vision row that marked an overlapping path anything but supported.
 * Returns the paths it reviewed.
 */
function checkJevRow(draft: Row, item: Row, count: number, claims: ClaimEvidence | undefined, negative: string[], classifies: (path: string) => boolean): string[] {
    const paths = Object.hasOwn(item, 'paths') ? item.paths : [item.path ?? null];
    const at = typeof array(paths)[0] === 'string' ? array(paths)[0] : '/';
    if (!Array.isArray(paths) || !paths.length || paths.some(path => typeof path !== 'string'))
        refuseJev(JEV_REVIEW_RULES.ineligible, 'a Jev row names one record\'s draft pointers', at);
    const root = claimRecordRoot(paths[0]);
    if (root === null || paths.some((path: string) => claimRecordRoot(path) !== root))
        refuseJev(JEV_REVIEW_RULES.ineligible, 'a Jev row covers the paths of one claim or node record', at);
    for (const path of paths)
        pointer(draft, path);
    if (item.verdict !== 'supported')
        refuseJev(JEV_REVIEW_RULES.ineligible, 'Jev only clears a record; it never refuses one', root);
    if (!claims)
        refuseJev(JEV_REVIEW_RULES.evidence, 'no native-text evidence of the bound source accompanies this review', root);
    const why = claimSupportIneligibility(draft, root, page => (claims.pages.get(page)?.text.trim() ?? '') !== '', classifies);
    if (why !== null)
        refuseJev(JEV_REVIEW_RULES.ineligible, `this record keeps the vision standard (${why})`, root);
    const cited = claimRecordPages(claimRecord(draft, root)!) as { pages: number[] };
    if (item.extraction_version !== claims.extractionVersion)
        refuseJev(JEV_REVIEW_RULES.evidence, 'the extraction version differs from the native text on record', root);
    const digests = row(item.page_text_sha256), named = Object.keys(digests);
    const refs = references(item.source_refs, count).map(ref => number(ref.page));
    if (named.length !== cited.pages.length || cited.pages.some(page => digests[String(page)] !== claims.pages.get(page)?.sha256)
        || refs.length !== cited.pages.length || refs.some(page => !cited.pages.includes(page)))
        refuseJev(JEV_REVIEW_RULES.evidence, 'the page-text digests do not match the record\'s cited pages on record', root);
    const distribution = row(item.distribution), probability = (value: any) => numeric(value) && number(value) >= 0 && number(value) <= 1;
    if (!probability(distribution.supported) || !probability(distribution.contradicted))
        refuseJev(JEV_REVIEW_RULES.evidence, 'a Jev row carries the distribution it was judged on', root);
    const overruled = paths.find((path: string) => negative.some(other => pathsOverlap(path, other)));
    if (overruled !== undefined)
        refuseJev(JEV_REVIEW_RULES.overruled, 'a vision reviewer did not support this path', overruled);
    return paths;
}
/**
 * The publication gate's review check (§22.3, §22.3.2). A `supported` path is reviewed; any other verdict on a
 * classification field is a contest (reviewed, never a refusal); any other verdict on anything else -- a record's root,
 * a fact field, a word outside the verdicts -- refuses, naming that path, the verdict as written and the reviewer's reason.
 */
export function checkReview(draft: Row, filled: Row, review: any, count: number, seen: ReadonlySet<number>, classifies: (path: string) => boolean = () => false,
    claims?: ClaimEvidence): ReviewJudgement {
    if (!object(review) || !Array.isArray(review.missing) || !Array.isArray(review.checked))
        reject('review must contain checked facts and an empty missing list');
    if (blockingModuleFindings(review.missing,filled).length)
        reject('the independent review found missing or incorrect material: ' + canonicalJson(review.missing), '/review/missing');
    const supported = new Set<string>(), reviewed = new Set<string>(), contested: Row[] = [];
    // §151.3: a Jev-checked row is judged first, against every path a vision row did not support.
    const jev = review.checked.filter((item: any) => object(item) && item.reviewer === JEV_REVIEWER);
    if (jev.length) {
        const negative = review.checked.filter((item: any) => object(item) && item.reviewer !== JEV_REVIEWER && item.verdict !== 'supported')
            .flatMap((item: Row) => Object.hasOwn(item, 'paths') ? array(item.paths) : [item.path]).filter((path: any) => typeof path === 'string');
        for (const item of jev)
            for (const path of checkJevRow(draft, item, count, claims, negative, classifies))
                reviewed.add(path);
    }
    for (const item of review.checked) {
        if (!object(item))
            reject('review entries must be objects');
        if (item.reviewer === JEV_REVIEWER)
            continue;
        const paths = Object.hasOwn(item, 'paths') ? item.paths : [item.path ?? null];
        if (!Array.isArray(paths) || !paths.length)
            reject('review entries need path or a non-empty paths array');
        for (const path of paths)
            pointer(draft, path);
        const refs = references(item.source_refs, count, seen);
        for (const path of paths) {
            reviewed.add(path);
            if (item.verdict === 'supported') {
                supported.add(path);
                continue;
            }
            // §192.1, §199.2: a distinct_from and a person's statements are never a classification and never advisory.
            if (!statementReviewPath(draft, path) && REVIEW_VERDICTS.includes(item.verdict) && (moduleLogicReview(filled)?advisoryModuleFinding(item):classifies(path))) {
                contested.push({ path, verdict: item.verdict, reason: string(item.reason ?? ''), source_refs: refs,...(item.impact?{impact:item.impact}:{}) });
                continue;
            }
            throw new RpcError('invalid_params', `visual review found ${path} unsupported (${string(item.verdict ?? null)}): ${string(item.reason ?? '')}`, {
                fix: 'correct the draft using the original pages and submit again',
                details: { reason: 'reading_failed', path, rule: 'review_unsupported', verdict: typeof item.verdict === 'string' ? item.verdict : null },
            });
        }
    }
    const missing = array(filled.required_review).filter(path => !reviewed.has(path));
    if (missing.length)
        throw new RpcError('invalid_params', `visual review omitted required fields: ${repr(sorted(missing))}`, {
            fix: 'review the omitted source fields against their original pages; preserve the completed author draft',
            details: {reason:'reading_failed',path:'/',rule:'review_incomplete',required_review:sorted(missing)},
        });
    return { supported, contested };
}
/**
 * Contract §22.3.2: the graph's `contested` marks after a reviewed publication. A mark on a field this review supported
 * (the field or an ancestor) is settled and removed; each contest of this review is written (or replaces its mark) under
 * `/nodes/<node_id><field>` with the reader's published value, the reviewer's word, reason and pages.
 */
export function recordContested(graph: Row, filled: Row, judged: ReviewJudgement, moduleId: string, jobId: string, generation: number): void {
    const marks: Row = clone(row(graph.contested)), nodes = array(filled.nodes);
    const published={...filled,nodes:nodes.map(node=>array(graph.nodes).find(current=>current.node_id===node.node_id)??node)};
    const byId = (path: string): string | null => {
        const match = /^\/nodes\/(\d+)(\/.*)?$/.exec(path), node = match ? nodes[Number(match[1])] : undefined;
        return node && typeof node.node_id === 'string' ? `/nodes/${node.node_id}${match![2] ?? ''}` : null;
    };
    const settled = [...judged.supported].map(byId).filter((path): path is string => path !== null);
    for (const key of Object.keys(marks))
        if (!moduleLogicReview(filled)&&settled.some(path => key === path || key.startsWith(path + '/')))
            delete marks[key];
    for (const item of judged.contested) {
        const key = byId(item.path);
        if (key === null) continue;
        marks[key] = { value: clone(pointer(moduleLogicReview(filled)?published:filled, item.path)), ...(item.impact?{impact:item.impact}:{}), verdict: item.verdict, reason: item.reason,
            source_refs: array(item.source_refs).map((ref: Row) => ({ source_id: `pdf:${moduleId}`, pdf_index: typeof ref.page === 'bigint' ? ref.page - 1n : ref.page - 1, ...(Object.hasOwn(ref, 'box') ? { box: ref.box } : {}) })),
            job_id: jobId, generation };
    }
    if (Object.keys(marks).length) graph.contested = orderedObject(new Map(Object.entries(marks).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
    else delete graph.contested;
}
export function resolveStartScene(graph: Row, wanted: string, contract: ModuleContract): string | null {
    const key = normalize(wanted);
    return startSceneCandidates(graph, row(contract.graph.actor_dossier)).find(candidate => ['node_id', 'scene', 'name'].some(field => normalize(candidate[field]) === key))?.node_id ?? null;
}
export function applyOpeningChoice(graph: Row, chosen: string, contract: ModuleContract): boolean {
    const nodes = new Map<string, Row>(array(graph.nodes).map(node => [node.node_id, node]));
    const node = nodes.get(chosen);
    if (!node || node.node_kind !== 'scene')
        return false;
    for (const candidate of startSceneCandidates(graph, row(contract.graph.actor_dossier))) {
        const other = nodes.get(candidate.node_id)!;
        other.properties ??= {};
        other.properties.is_entrance = true;
    }
    graph.entry_scene_ids = [chosen];
    for (const other of nodes.values()) {
        if (other.node_kind !== 'scene')
            continue;
        const record = recordOf(other);
        if (truth(record))
            record.is_start = other === node;
    }
    return true;
}
/**
 * The graph this reviewed draft publishes into `previous`. A re-transcription the merge accepts (§22.3.1)
 * is pushed to `replaced` as `{path, previous, value, source_refs}`; the graph's `field_spans` record the
 * span every written field was read from.
 */
export function assembleVisual(previous: Row | null, filled: Row, meta: Row, contract: ModuleContract, replaced: Row[] = []): Row {
    const graph = clone(previous || {
        contract_id: contract.graph.graph_contract_id, schema_version: 3, module_id: meta.id,
        nodes: [{ node_id: `module-${meta.id}`, node_kind: 'module', name: meta.title, visibility: 'keeper-only', properties: {}, aliases: [], summary: '', source_refs: [{ source_id: `pdf:${meta.id}`, pdf_index: 0 }] }],
        claims: [], relations: [],
    });
    const readyBefore = new Set(array(row(meta.reading).materials).flatMap(m => array(m.node_ids)));
    const spans: Row = clone(row(graph.field_spans)), review = array(filled.required_review);
    for (const [collection, key] of [['nodes', 'node_id'], ['claims', 'claim_id']]) {
        const merged = new Map(array(graph[collection]).map(item => [item[key], item]));
        for (const [i, raw] of (filled[collection] as Row[]).entries()) {
            const value = clone(raw);
            value.source_refs = raw.source_refs.map((ref: Row) => ({ source_id: `pdf:${meta.id}`, pdf_index: typeof ref.page === 'bigint' ? ref.page - 1n : ref.page - 1, ...(Object.hasOwn(ref, 'box') ? { box: ref.box } : {}) }));
            const id = value[key], base = `/${collection}/${id}`, before = merged.get(id);
            if (collection === 'nodes' && id === `module-${meta.id}` && previous === null) {
                merged.set(id, { ...before, ...value });
                recordSpans(spans, base, value, key, undefined, []);
            }
            else if (!before) {
                merged.set(id, value);
                recordSpans(spans, base, value, key, undefined, []);
            }
            else {
                let current = before;
                if (collection === 'nodes' && !readyBefore.has(id) && filled.ready_nodes.includes(id) && Object.hasOwn(value, 'summary')) {
                    current = clone(before);
                    current.summary = value.summary;
                }
                // §22.3.1: the draft names this item `/<collection>/<i>`; a replacement needs a review of that field or an ancestor.
                const drafted = `/${collection}/${i}`, accepted: Row[] = [];
                merged.set(id, mergeValue(current, value, base, {
                    preserveExisting:moduleLogicReview(filled)&&(collection==='claims'||readyBefore.has(id)||value.node_kind==='module'),
                    spans: path => ({ existing: spanOf(spans, path, before.source_refs), proposed: anchors(value.source_refs) }),
                    reviewed: path => { const at = drafted + path.slice(base.length); return review.some(item => at === item || at.startsWith(item + '/')); },
                    accept: (path, previous, value) => accepted.push({ path, previous, value }),
                }));
                if(moduleLogicReview(filled)&&(collection==='claims'||readyBefore.has(id))){
                    const mappings=new Map(array(graph.source_mappings).map(item=>[canonicalJson([item.path,item.source_value]),item]));
                    for(const item of accepted)mappings.set(canonicalJson([item.path,item.value]),{path:item.path,established_value:clone(item.previous),source_value:clone(item.value),source_refs:clone(value.source_refs)});
                    if(mappings.size)graph.source_mappings=[...mappings.values()];
                    const settled=merged.get(id);
                    if(collection==='nodes'&&typeof before.name==='string'&&typeof value.name==='string'&&before.name!==value.name)
                        settled.aliases=[...new Set([...array(settled.aliases),value.name])];
                    recordSpans(spans,base,settled,key,before,[]);
                }else{
                    recordSpans(spans, base, value, key, before, accepted.map(item => item.path));
                    for (const item of accepted) replaced.push({ ...item, source_refs: clone(value.source_refs) });
                }
            }
        }
        graph[collection] = [...merged.values()];
    }
    graph.field_spans = spans;
    const nodes = new Map<string, Row>(graph.nodes.map((node: Row) => [node.node_id, node])), relations = new Map<string, Row>(graph.relations.map((rel: Row) => [rel.relation_id, rel]));
    for (const claim of graph.claims) {
        const target = row(claim.object).node_id;
        if (array(contract.graph.relation_kinds).includes(claim.predicate) && typeof claim.claim_id === 'string' && typeof claim.subject_id === 'string' && typeof target === 'string') {
            const id = 'rel-' + claim.claim_id.replace(/^claim-/, '');
            // Contract §138.9: a road's filled minutes survive the re-assembly its claim goes through at every publication.
            relations.set(id, preserveTravel(relations.get(id), { relation_id: id, relation_kind: claim.predicate, from_node_id: claim.subject_id, to_node_id: target, claim_id: claim.claim_id, properties: {} }));
        }
        if (claim.predicate === 'knows' && target)
            for (const other of graph.claims) {
                if (other.subject_id === target && other !== claim) {
                    other.known_by_ids ??= [];
                    if (!other.known_by_ids.includes(claim.subject_id))
                        other.known_by_ids.push(claim.subject_id);
                }
            }
    }
    attachMapCandidates(graph, array(row(meta.reading).map_candidates), meta.id);
    const view = new ModuleGraph(meta.id, graph, '', row(contract.graph.actor_dossier));
    for (const node of nodes.values()) {
        if (node.node_kind !== 'scene')
            continue;
        node.properties ??= {};
        const props = node.properties, existing = row(row(props.runtime_projection).record);
        const record: Row = orderedObject([
            ['scene_id', view.handle(node)], ['display_name', node.name], ['is_start', false], ['is_final', false],
            ...entries(existing), ...entries(props).filter(([key]) => key !== 'runtime_projection'),
        ]);
        if (Object.hasOwn(props, 'is_entrance') || Object.hasOwn(props, 'is_start'))
            record.is_start = props.is_entrance === true || props.is_start === true;
        if (Object.hasOwn(props, 'is_ending') || Object.hasOwn(props, 'is_final'))
            record.is_final = props.is_ending === true || props.is_final === true;
        props.runtime_projection = { document: 'story-graph.json', collection: 'scenes', record };
    }
    graph.nodes = [...nodes.values()];
    graph.relations = [...relations.values()];
    const declaration = row(graph.nodes.find((node: Row) => node.node_kind === 'module')?.properties);
    for (const key of ['entry_scene_ids', 'ending_scene_ids'])
        if (Object.hasOwn(declaration, key))
            graph[key] = clone(declaration[key]);
    graph.source_languages = meta.languages ?? [];
    graph.source_refs = [...new Map(graph.nodes.flatMap((node: Row) => array(node.source_refs)).map((ref: Row) => [canonicalJson(ref), ref])).values()];
    graph.coverage = { ...row(graph.coverage), ...row(filled.coverage) };
    if(array(filled.source_needs).length){
        const needs=new Map(array(graph.source_needs).map(need=>[sourceNeedKey(need),need]));
        const resolved=new Set(array(row(meta.reading).resolved_source_needs).map(need=>need.key));
        for(const need of array(filled.source_needs)){
            const node=view.resolve(need.focus),entry={...clone(need),node_id:node.node_id,focus:view.handle(node),source_sha256:meta.file_sha256,
                source_refs:array(need.source_refs).map(ref=>({source_id:`pdf:${meta.id}`,pdf_index:number(ref.page)-1}))};
            const key=sourceNeedKey(entry);if(!resolved.has(key))needs.set(key,entry);
        }
        graph.source_needs=[...needs.values()];
    }
    if (truth(row(meta.opening_choice).start_scene))
        applyOpeningChoice(graph, meta.opening_choice.start_scene, contract);
    return graph;
}

/** Index navigation marks scenes that have a source map without authorizing any pixels or regions. */
export function attachMapCandidates(graph: Row, candidates: Row[], moduleId = 'module'): boolean {
    if (!Array.isArray(graph.nodes) || !candidates.length) return false;
    const view = new ModuleGraph(moduleId, graph, '', {});
    let changed = false;
    for (const raw of candidates) {
        const candidate = row(raw), name = string(candidate.name).trim(), focus = string(candidate.focus).trim();
        const pages = [...new Set(array(candidate.pages).filter(integer).map(number))].filter(page => page > 0).sort((a, b) => a - b);
        if (!name || !focus || !pages.length) continue;
        const scene = view.find(focus, ['scene']);
        if (!scene) continue;
        scene.properties ??= {};
        const marker = { name, focus, pages }, existing = array(row(scene.properties).map_candidates);
        if (existing.some(value => equal(value, marker))) continue;
        scene.properties.map_candidates = [...existing, marker];
        changed = true;
    }
    return changed;
}

/** Host first-batch check reuses the kernel's scene identity; publication remains authoritative. */
export function checkOpeningBatch(draft: Row, focus?: string, knownNodes: Row[] = [], requireInteraction = false, knownClaims: Row[] = []): void {
    const ready = new Set(array(draft.ready_nodes));
    const scenes = array(draft.nodes).filter(node => node.node_kind === 'scene' && ready.has(node.node_id));
    const expanded = requireInteraction || Object.hasOwn(draft, 'interaction_scene');
    const claims = [...array(knownClaims), ...array(draft.claims)];
    if (!expanded && scenes.length !== 1) reject('An opening batch must prepare exactly the selected first scene. Keep future scenes out of ready_nodes; prepare them with later detail requests. Retain the source dependencies of the first interaction.', '/ready_nodes');
    if (expanded && (typeof draft.interaction_scene !== 'string' || !scenes.some(scene => scene.node_id === draft.interaction_scene)))
        reject('interaction_scene must name the ready scene of the first substantive player interaction', '/interaction_scene');
    const view = new ModuleGraph('opening-batch', {nodes:scenes}, '', {});
    const entry = focus ? scenes.find(scene => [scene.node_id,scene.name,view.handle(scene)]
        .some(value => typeof value === 'string' && normalize(value) === normalize(focus))) : scenes.find(scene => row(scene.properties).is_entrance === true) ?? scenes[0];
    if (!entry) reject(`The prepared scene does not preserve the selected opening ${repr(focus)}. Keep its identity from task.focus and known_nodes; put extra description in summary instead of decorating its name. Correct this before independent review.`, '/nodes');
    if (expanded) {
        const allowed = new Set([entry.node_id, draft.interaction_scene]);
        if (scenes.length !== allowed.size || scenes.some(scene => !allowed.has(scene.node_id)))
            reject('Only the entry and its first substantive interaction may be ready; future scenes remain deferred', '/ready_nodes');
        const reached = new Set([entry.node_id]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const claim of claims) if (['route-to','play-precedes','may-lead-to','hands-off-to'].includes(claim.predicate)
                && reached.has(claim.subject_id) && !reached.has(row(claim.object).node_id)) {
                reached.add(row(claim.object).node_id); changed = true;
            }
        }
        if (!reached.has(draft.interaction_scene)) reject('The first interaction needs a source-authored route or progression from the selected entry', '/interaction_scene');
    }
    const knownReady = new Set(array(knownNodes).filter(node => node.ready === true).map(node => node.node_id));
    const nodes = new Map([...array(knownNodes),...array(draft.nodes)].map(node => [node.node_id,node]));
    const present = claims.filter(claim => ['present-in','discoverable-at'].includes(claim.predicate)
        && scenes.some(scene => row(claim.object).node_id === scene.node_id)
        && (!expanded||claim.predicate!=='discoverable-at'||row(claim.object).node_id===draft.interaction_scene)).map(claim => claim.subject_id);
    const currentScenes = new Set(scenes.map(scene => scene.node_id));
    if (expanded) for (const claim of claims) if (['uses-rule','has-requirement'].includes(claim.predicate) && currentScenes.has(claim.subject_id))
        present.push(row(claim.object).node_id);
    for (const id of present) {
        if (['npc','clue','handout','asset',...(expanded?['rule','hazard','requirement']:[])].includes(nodes.get(id)?.node_kind)
            && !ready.has(id) && !knownReady.has(id))
            reject(`The first interaction depends on ${repr(id)}. Prepare its current-scene material and include it in ready_nodes, so the first player action does not immediately wait for detail reading. Future scene material stays deferred.`, '/ready_nodes');
    }
}
