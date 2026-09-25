/** Pure source-draft validation shared by publication and the offline host check. */
import { RpcError } from '../errors.js';
import { canonicalJson, isJsonObject, orderedObject } from '../json.js';
import { array, clone, entries, equal, integer, normalize, number, numeric, repr, row, sorted, string, truth, type Row } from '../read/values.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { startSceneCandidates } from '../write/source.js';
import { CLAIM_KEYS, NODE_KEYS, SHARD_KEYS, VISUAL_CONTRACT_ID, validSemanticId, type ModuleContract } from './contract.js';
import { obligationRefusals, type Refusal } from './obligation-shape.js';
import { obligationReviewPaths, statesObligation } from './obligation-review.js';
import { carriesMechanics, mechanicsRefusals } from './mechanics-shape.js';
import { shapeReviewPaths, statesMechanics } from './shape-review.js';
import { anchors, pages, recordSpans, sameSpan, spanOf, type Anchor } from './transcription.js';
import { REVIEW_VERDICTS, classificationMatcher } from './review-verdicts.js';
const object = (value: any): boolean => isJsonObject(value);
export function reject(message: string, path = '/'): never {
    throw new RpcError('invalid_params', message, {
        fix: 'correct the draft using the original pages and submit again', details: { reason: 'reading_failed', path },
    });
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
    for (const [collection, key] of [['nodes', 'node_id'], ['claims', 'claim_id']]) {
        const identity = (item: Row) => item.node_id || item.claim_id || canonicalJson([item.subject_id ?? null, item.predicate ?? null, item.object ?? null]);
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
    if (object(old) && object(proposed)) {
        const out = new Map(entries(old));
        for (const [key, value] of entries(proposed))
            out.set(key, out.has(key) ? mergeValue(out.get(key), value, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, transcription) : clone(value));
        return orderedObject(out);
    }
    if (Array.isArray(old) && Array.isArray(proposed) && ['/aliases', '/source_refs', '/known_by_ids', '/asserted_by_ids'].some(key => path.endsWith(key))) {
        return clone([...old, ...proposed.filter(v => !old.some(item => equal(item, v)))]);
    }
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
export function checkDraft(draft: any, packet: Row, contract: ModuleContract, seen?: ReadonlySet<number>): Row {
    if (!object(draft))
        reject('the draft must be an object');
    const unknown = Object.keys(draft).filter(key => !SHARD_KEYS.includes(key));
    if (unknown.length)
        reject(`unknown draft keys: ${repr(sorted(unknown))}`);
    if ((Object.hasOwn(draft, 'contract_id') ? draft.contract_id : VISUAL_CONTRACT_ID) !== VISUAL_CONTRACT_ID)
        reject('use the visual shard contract coc.module-graph-shard.v4');
    if (!equal(draft.dependencies, []))
        reject("resolve the current scope's source dependencies before publication", '/dependencies');
    for (const key of ['nodes', 'claims', 'node_refs', 'critical', 'ready_nodes'])
        if (!Array.isArray(draft[key]))
            reject(`${key} must be an array`, `/${key}`);
    const skeleton = ['skeleton', 'guidance'].includes(packet.purpose), vocab = contract.graph;
    if (skeleton && !draft.nodes.length)
        reject('a skeleton needs source-authored nodes before it can be published', '/nodes');
    if (!object(draft.coverage) || Object.keys(draft.coverage).some(key => !array(vocab.coverage_domains).includes(key)) || Object.values(draft.coverage).some(value => !array(vocab.coverage_status).includes(value))) {
        reject(`coverage must be an object mapping domain to status; domains=${repr(vocab.coverage_domains)}, statuses=${repr(sorted(array(vocab.coverage_status)))}; use {} when no domain is prepared`, '/coverage');
    }
    const filled: Row = clone(draft), nodes = filled.nodes as Row[], existing = new Set(array(packet.known_nodes).map(n => n.node_id)), defined = new Set<string>();
    const count = packet.source.page_count;
    for (const [i, node] of nodes.entries()) {
        if (!object(node) || Object.keys(node).some(key => !NODE_KEYS.includes(key)))
            reject('invalid node fields', `/nodes/${i}`);
        const id = node.node_id, kind = node.node_kind;
        if (!array(vocab.node_kinds).includes(kind) || !validSemanticId(id) || !id.startsWith(kind + '-') || defined.has(id))
            reject('node kind/id must be unique and use the supplied vocabulary', `/nodes/${i}`);
        if (typeof node.name !== 'string' || !node.name.trim())
            reject('each node needs its source name', `/nodes/${i}/name`);
        if (!object(Object.hasOwn(node, 'properties') ? node.properties : {}) || !Array.isArray(Object.hasOwn(node, 'aliases') ? node.aliases : []))
            reject('properties must be an object and aliases an array', `/nodes/${i}`);
        if (array(node.aliases).some(alias => typeof alias !== 'string'))
            reject('aliases must contain names');
        const props = row(node.properties);
        if (Object.hasOwn(props, 'map_candidates')) {
            if (kind !== 'scene' || !Array.isArray(props.map_candidates) || !props.map_candidates.length)
                reject('map_candidates belongs to a scene and must not be empty', `/nodes/${i}/properties/map_candidates`);
            for (const [n, value] of props.map_candidates.entries()) {
                const candidate = row(value);
                if (typeof candidate.name !== 'string' || !candidate.name.trim() || typeof candidate.focus !== 'string' || !candidate.focus.trim()
                    || !Array.isArray(candidate.pages) || !candidate.pages.length || candidate.pages.some(page => !integer(page) || page < 1 || page > count))
                    reject('a scene map candidate needs name, exact place focus and physical page numbers', `/nodes/${i}/properties/map_candidates/${n}`);
            }
        }
        if (['asset', 'handout'].includes(kind) && Object.hasOwn(props, 'asset_ref')) {
            const prior = row(array(packet.known_nodes).find(n => n.node_id === id));
            if (!equal(props.asset_ref, row(prior.properties).asset_ref ?? null))
                reject('asset_ref is owned by the host; declare image_sources instead of a local file path', `/nodes/${i}/properties/asset_ref`);
        }
        if (Object.hasOwn(props, 'image_sources'))
            references(props.image_sources, count, seen);
        if (['npc', 'creature'].includes(kind))
            actorNumbersLaw(props, i, contract);
        if (!Object.hasOwn(node, 'visibility'))
            node.visibility = 'keeper-only';
        if (!array(vocab.visibility).includes(node.visibility))
            reject('node visibility must use the supplied vocabulary');
        if (statesObligation(node))
            obligationSourceLaw(node, i, seen);
        if (statesMechanics(node))
            mechanicsSourceLaw(node, i, seen);
        node.source_refs = references(node.source_refs, count, seen);
        defined.add(id);
    }
    const ids = new Set([...existing, ...defined, `module-${packet.module_id}`]);
    const mapBox = (value: any): boolean => Array.isArray(value) && value.length === 4
        && value.every(item => numeric(item) && Number.isFinite(number(item)) && number(item) >= 0 && number(item) <= 1)
        && number(value[2]) > number(value[0]) && number(value[3]) > number(value[1]);
    for (const [i, node] of nodes.entries()) {
        const regions = row(node.properties).map_regions;
        if (regions == null) continue;
        if (!['asset', 'handout'].includes(node.node_kind) || !Array.isArray(regions) || !regions.length)
            reject('map_regions belongs to an asset or handout and must not be empty', `/nodes/${i}/properties/map_regions`);
        const regionIds = new Set<string>();
        for (const [n, value] of regions.entries()) {
            const region = row(value), id = typeof region.region_id === 'string' ? region.region_id.trim() : '';
            if (!validSemanticId(id) || regionIds.has(id)) reject('map regions need unique semantic region_id values', `/nodes/${i}/properties/map_regions/${n}`);
            regionIds.add(id);
            if (typeof region.name !== 'string' || !region.name.trim() || typeof region.source_asset !== 'string' || !region.source_asset.trim())
                reject('a map region needs name and source_asset', `/nodes/${i}/properties/map_regions/${n}`);
            if (!mapBox(region.source_box ?? [0,0,1,1]) || !mapBox(region.placement) || array(region.redactions).some(value => !mapBox(value)))
                reject('map source, placement and redaction boxes must be normalized rectangles', `/nodes/${i}/properties/map_regions/${n}`);
            const source = [...nodes, ...array(packet.known_nodes)].find(item => item.node_kind === 'asset' && [item.node_id, String(item.node_id).replace(/^asset-/, '')].includes(region.source_asset));
            if (!source) reject('map region source_asset must name an asset node', `/nodes/${i}/properties/map_regions/${n}/source_asset`);
            if (!['player-safe','revealable'].includes(source.visibility) && !(region.safe_after_redactions === true && array(region.redactions).length))
                reject('private map sources require reviewed redactions and safe_after_redactions', `/nodes/${i}/properties/map_regions/${n}`);
        }
    }
    for (const id of [...filled.node_refs, ...filled.ready_nodes])
        if (typeof id !== 'string' || !ids.has(id))
            reject('a node reference must name a defined node');
    if (skeleton && filled.ready_nodes.length)
        reject('a skeleton cannot grant material readiness; ready_nodes must be empty', '/ready_nodes');
    if (!filled.ready_nodes.length && !skeleton)
        reject('declare the nodes whose material this task has prepared', '/ready_nodes');
    if (filled.ready_nodes.some((id: string) => !defined.has(id)))
        reject('ready_nodes must be present in the draft so their material can be independently reviewed', '/ready_nodes');
    const knownNodes = new Map(array(packet.known_nodes).map(n => [n.node_id, n]));
    // §22.3.1: a differing value for a published field is judged by span here, before review. A
    // re-transcription of the same span (or one whose span this check cannot see) owes the review.
    // Merges run on `/<collection>/<id>` pointers, as publication's do (the NPC dossier union keys on them);
    // a re-transcription is collected as the draft's own `/<collection>/<i>` pointer for the review.
    const spans = row(packet.field_spans), retranscribed: string[] = [];
    const judge = (base: string, draftBase: string, known: Row, drafted: Row): Retranscription => ({
        spans: path => ({ existing: spanOf(spans, path, known.source_refs), proposed: anchors(drafted.source_refs) }),
        unseen: !Object.hasOwn(known, 'source_refs'),
        accept: path => retranscribed.push(draftBase + path.slice(base.length)),
    });
    for (const [i, node] of nodes.entries()) {
        const known = knownNodes.get(node.node_id);
        // The placeholder module node of an unread book carries no source refs and nothing read.
        if (!known || !Object.hasOwn(known, 'ready') || known.node_kind === 'module' && !Object.hasOwn(known, 'source_refs'))
            continue;
        const proposed = Object.fromEntries(entries(node).filter(([key]) => Object.hasOwn(known, key) && key !== 'source_refs'));
        if (!truth(known.ready) && filled.ready_nodes.includes(node.node_id))
            delete proposed.summary;
        mergeValue(Object.fromEntries(Object.keys(proposed).map(key => [key, known[key]])), proposed, `/nodes/${node.node_id}`, judge(`/nodes/${node.node_id}`, `/nodes/${i}`, known, node));
    }
    const claimed = new Set<string>(), required = new Set<any>(filled.critical);
    if (!skeleton && filled.ready_nodes.length) required.add('/coverage');
    for (const path of required)
        pointer(draft, path);
    for (const [i, node] of nodes.entries()) {
        for (const path of numericPaths(Object.fromEntries(entries(node.properties).filter(([key]) => !['image_sources', 'map_candidates'].includes(key))), `/nodes/${i}/properties`))
            required.add(path);
        if (filled.ready_nodes.includes(node.node_id) || packet.purpose === 'guidance')
            required.add(`/nodes/${i}`);
    }
    for (const [i, claim] of (filled.claims as Row[]).entries()) {
        if (!object(claim) || Object.keys(claim).some(key => !CLAIM_KEYS.includes(key)))
            reject('invalid claim fields', `/claims/${i}`);
        const target = row(claim.object).node_id;
        if (!ids.has(claim.subject_id) || !ids.has(target) || !array(vocab.relation_kinds).includes(claim.predicate))
            reject('a claim must connect defined nodes with a supplied predicate', `/claims/${i}`);
        if (claim.predicate === 'impersonates' && claim.subject_id === target)
            reject('an alias is not a second person; put it in aliases rather than a self-impersonation claim', `/claims/${i}`);
        if (!equal(Object.keys(claim.object), ['node_id']))
            reject('claim objects contain only node_id');
        const matches = array(packet.known_claims).filter(old => Object.hasOwn(claim, 'claim_id') ? equal(old.claim_id, claim.claim_id) : ['subject_id', 'predicate', 'object'].every(key => equal(old[key] ?? null, claim[key] ?? null)));
        const known = matches.length === 1 ? matches[0] : {};
        if (!Object.hasOwn(claim, 'claim_id'))
            claim.claim_id = known.claim_id || `claim-${claim.subject_id}-${claim.predicate}-${target}`;
        if (!validSemanticId(claim.claim_id) || claimed.has(claim.claim_id))
            reject('claim ids must be unique semantic identifiers');
        claimed.add(claim.claim_id);
        if (!array(vocab.truth_status).includes(claim.truth_status))
            reject('claims must declare authored fact, belief, rumor, lie or inference using the vocabulary');
        if (!Object.hasOwn(claim, 'visibility'))
            claim.visibility = Object.hasOwn(known, 'visibility') ? known.visibility : 'keeper-only';
        if (!array(vocab.visibility).includes(claim.visibility))
            reject('invalid claim visibility');
        claim.source_refs = references(claim.source_refs, count, seen);
        for (const key of ['known_by_ids', 'asserted_by_ids']) {
            if (!Object.hasOwn(claim, key))
                claim[key] = [];
            if (!Array.isArray(claim[key]) || claim[key].some((id: any) => !ids.has(id)))
                reject(`${key} must name defined nodes`);
        }
        if (!Object.hasOwn(claim, 'validity'))
            claim.validity = known.validity ?? null;
        if (Object.keys(known).length) {
            const fields = Object.fromEntries(entries(claim).filter(([key]) => Object.hasOwn(known, key) && !['claim_id', 'source_refs'].includes(key)));
            mergeValue(Object.fromEntries(Object.keys(fields).map(key => [key, known[key]])), fields, `/claims/${claim.claim_id}`,
                judge(`/claims/${claim.claim_id}`, `/claims/${i}`, known, claim));
        }
        required.add(`/claims/${i}`);
    }
    // The field a later reading re-transcribed is named in the review, so the replacement is a reviewed one.
    for (const path of retranscribed)
        required.add(path);
    if (nodes.some(statesObligation)) {
        checkObligations(filled, packet, contract);
        for (const [i, node] of nodes.entries())
            for (const path of obligationReviewPaths(node, `/nodes/${i}`))
                required.add(path);
    }
    checkMechanics(filled, packet, contract);
    for (const [i, node] of nodes.entries())
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
/** Contract §22.3.2: what a review judged, per draft pointer: the paths it supported and the classification fields it contested. */
export interface ReviewJudgement { supported: Set<string>; contested: Row[] }
/** Contract §22.3.2: a draft pointer is a classification field when the graph contract's `classification_fields` say so. */
export function classificationFields(contract: ModuleContract): (path: string) => boolean {
    return classificationMatcher(row(contract.graph.classification_fields).node);
}
/**
 * The publication gate's review check (§22.3, §22.3.2). A `supported` path is reviewed; any other verdict on a
 * classification field is a contest (reviewed, never a refusal); any other verdict on anything else -- a record's root,
 * a fact field, a word outside the verdicts -- refuses, naming that path, the verdict as written and the reviewer's reason.
 */
export function checkReview(draft: Row, filled: Row, review: any, count: number, seen: ReadonlySet<number>, classifies: (path: string) => boolean = () => false): ReviewJudgement {
    if (!object(review) || !Array.isArray(review.missing) || !Array.isArray(review.checked))
        reject('review must contain checked facts and an empty missing list');
    if (review.missing.length)
        reject('the independent review found missing or incorrect material: ' + canonicalJson(review.missing), '/review/missing');
    const supported = new Set<string>(), reviewed = new Set<string>(), contested: Row[] = [];
    for (const item of review.checked) {
        if (!object(item))
            reject('review entries must be objects');
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
            if (REVIEW_VERDICTS.includes(item.verdict) && classifies(path)) {
                contested.push({ path, verdict: item.verdict, reason: string(item.reason ?? ''), source_refs: refs });
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
        reject(`visual review omitted required fields: ${repr(sorted(missing))}`);
    return { supported, contested };
}
/**
 * Contract §22.3.2: the graph's `contested` marks after a reviewed publication. A mark on a field this review supported
 * (the field or an ancestor) is settled and removed; each contest of this review is written (or replaces its mark) under
 * `/nodes/<node_id><field>` with the reader's published value, the reviewer's word, reason and pages.
 */
export function recordContested(graph: Row, filled: Row, judged: ReviewJudgement, moduleId: string, jobId: string, generation: number): void {
    const marks: Row = clone(row(graph.contested)), nodes = array(filled.nodes);
    const byId = (path: string): string | null => {
        const match = /^\/nodes\/(\d+)(\/.*)?$/.exec(path), node = match ? nodes[Number(match[1])] : undefined;
        return node && typeof node.node_id === 'string' ? `/nodes/${node.node_id}${match![2] ?? ''}` : null;
    };
    const settled = [...judged.supported].map(byId).filter((path): path is string => path !== null);
    for (const key of Object.keys(marks))
        if (settled.some(path => key === path || key.startsWith(path + '/')))
            delete marks[key];
    for (const item of judged.contested) {
        const key = byId(item.path);
        if (key === null) continue;
        marks[key] = { value: clone(pointer(filled, item.path)), verdict: item.verdict, reason: item.reason,
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
                    spans: path => ({ existing: spanOf(spans, path, before.source_refs), proposed: anchors(value.source_refs) }),
                    reviewed: path => { const at = drafted + path.slice(base.length); return review.some(item => at === item || at.startsWith(item + '/')); },
                    accept: (path, previous, value) => accepted.push({ path, previous, value }),
                }));
                recordSpans(spans, base, value, key, before, accepted.map(item => item.path));
                for (const item of accepted) replaced.push({ ...item, source_refs: clone(value.source_refs) });
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
            relations.set(id, { relation_id: id, relation_kind: claim.predicate, from_node_id: claim.subject_id, to_node_id: target, claim_id: claim.claim_id, properties: {} });
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
export function checkOpeningBatch(draft: Row, focus?: string, knownNodes: Row[] = []): void {
    const ready = new Set(array(draft.ready_nodes));
    const scenes = array(draft.nodes).filter(node => node.node_kind === 'scene' && ready.has(node.node_id));
    if (scenes.length !== 1) reject('An opening batch must prepare exactly the selected first scene. Keep future scenes out of ready_nodes; prepare them with later detail requests. Retain the source dependencies of the first interaction.', '/ready_nodes');
    const knownReady = new Set(array(knownNodes).filter(node => node.ready === true).map(node => node.node_id));
    const nodes = new Map([...array(knownNodes),...array(draft.nodes)].map(node => [node.node_id,node]));
    const present = array(draft.claims).filter(claim => ['present-in','discoverable-at'].includes(claim.predicate)
        && row(claim.object).node_id === scenes[0].node_id).map(claim => claim.subject_id);
    for (const id of present) {
        if (['npc','clue','handout','asset'].includes(nodes.get(id)?.node_kind)
            && !ready.has(id) && !knownReady.has(id))
            reject(`The first interaction depends on ${repr(id)}. Prepare its current-scene material and include it in ready_nodes, so the first player action does not immediately wait for detail reading. Future scene material stays deferred.`, '/ready_nodes');
    }
    if (focus) {
        const view = new ModuleGraph('opening-batch', {nodes:scenes}, '', {}), scene = scenes[0];
        if (![scene.node_id,scene.name,view.handle(scene)].some(value => typeof value === 'string' && normalize(value) === normalize(focus)))
            reject(`The prepared scene does not preserve the selected opening ${repr(focus)}. Keep its identity from task.focus and known_nodes; put extra description in summary instead of decorating its name. Correct this before independent review.`, '/nodes');
    }
}
