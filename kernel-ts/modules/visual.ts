/** Pure source-draft validation shared by publication and the offline host check. */
import { RpcError } from '../errors.js';
import { canonicalJson, isJsonObject, orderedObject, sha256Text } from '../json.js';
import { array, clone, entries, equal, integer, normalize, number, numeric, repr, row, sorted, string, truth, type Row } from '../read/values.js';
import { ModuleGraph, recordOf } from '../read/module-graph.js';
import { startSceneCandidates } from '../write/source.js';
import { CLAIM_KEYS, NODE_KEYS, SHARD_KEYS, VISUAL_CONTRACT_ID, validSemanticId, type ModuleContract } from './contract.js';
import { obligationRefusals, type Refusal } from './obligation-shape.js';
import { obligationReviewPaths, statesObligation } from './obligation-review.js';
import { carriesMechanics, mechanicsRefusals } from './mechanics-shape.js';
import { shapeReviewPaths, statesMechanics } from './shape-review.js';
import {validateSourceNeeds,sourceNeedKey} from './source-needs.js';
import {moduleLogicReview,moduleReviewRoot,advisoryModuleFinding,blockingModuleFindings} from './module-review-policy.js';
import { anchors, pages, recordSpans, sameSpan, spanOf, type Anchor } from './transcription.js';
import { REVIEW_VERDICTS, classificationMatcher } from './review-verdicts.js';
import { CLAIM_SUPPORT_PROTOCOL, JEV_REVIEWER, JEV_REVIEW_RULES, claimRecordPages, claimRecordRoot, claimSupportIneligibility, pathsOverlap, claimRecord } from './claim-support.js';
import { preserveTravel } from './route-travel.js';
import {validVisualScan,visualCandidates} from './visual-discovery.js';
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
export function checkDraft(draft: any, packet: Row, contract: ModuleContract, seen?: ReadonlySet<number>): Row {
    if (!object(draft))
        reject('the draft must be an object');
    const unknown = Object.keys(draft).filter(key => !SHARD_KEYS.includes(key)&&!(packet.visual_scan&&key==='visual_candidates'));
    if (unknown.length)
        reject(`unknown draft keys: ${repr(sorted(unknown))}`);
    if ((Object.hasOwn(draft, 'contract_id') ? draft.contract_id : VISUAL_CONTRACT_ID) !== VISUAL_CONTRACT_ID)
        reject('use the visual shard contract coc.module-graph-shard.v4');
    let sourceNeeds;
    if(Object.hasOwn(draft,'source_needs')&&!['guidance','opening','detail'].includes(packet.purpose))reject('source_needs belongs to a checked source reading','/source_needs');
    try{sourceNeeds=validateSourceNeeds(draft.source_needs??[],number(row(packet.source).page_count));}
    catch(error){reject(String(error),'/source_needs');}
    const pending=sourceNeeds!.filter(need=>['source_read','uncertain'].includes(need.kind));
    if(pending.length&&!packet.source_unit&&!packet.visual_asset)throw new RpcError('invalid_params','Current source needs remain unresolved',{
        fix:'Retrieve the required original evidence and repair the candidate; retain runtime inputs and future needs explicitly',
        details:{reason:'reading_failed',rule:'source_needs_pending',path:'/source_needs',requests:pending},
    });
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
    if(packet.visual_scan){
        if(!validVisualScan(packet.visual_scan,number(row(packet.source).page_count)))reject('Invalid visual navigation range');
        try{filled.visual_candidates=visualCandidates(draft.visual_candidates,packet.visual_scan);}catch(error){reject(String(error));}
        if(nodes.length||filled.claims.length||filled.node_refs.length||filled.ready_nodes.length||filled.critical.length
            ||Object.keys(filled.coverage).length||array(filled.source_needs).length)
            reject('Visual navigation may nominate pages only; prepare assets in independent original-page tasks');
    }
    if(moduleLogicReview(packet))filled.review_policy=packet.review_policy;
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
            node.visibility = array(packet.known_nodes).find(known => known.node_id === id)?.visibility ?? 'keeper-only';
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
    if (!filled.ready_nodes.length && !skeleton && !packet.source_unit && !packet.visual_scan && !packet.visual_asset)
        reject('declare the nodes whose material this task has prepared', '/ready_nodes');
    if (filled.ready_nodes.some((id: string) => !defined.has(id)))
        reject('ready_nodes must be present in the draft so their material can be independently reviewed', '/ready_nodes');
    if(packet.visual_asset){
        if(!integer(packet.visual_asset.page)||packet.visual_asset.page<1||packet.visual_asset.page>packet.source.page_count)
            reject('Invalid visual asset page');
        if(seen&&!seen.has(packet.visual_asset.page))reject('Visual asset preparation requires the nominated original page');
        for(const node of nodes){
            if(!['asset','handout','scene','location'].includes(node.node_kind))
                reject('Visual discovery prepares visual assets and place identities only','/nodes');
            if(['scene','location'].includes(node.node_kind)&&Object.keys(row(node.properties)).length)
                reject('Visual discovery must preserve existing place dossiers','/nodes');
            if(filled.ready_nodes.includes(node.node_id)&&!['asset','handout'].includes(node.node_kind))
                reject('Visual discovery cannot grant scene readiness','/ready_nodes');
            if(['asset','handout'].includes(node.node_kind)&&!array(row(node.properties).image_sources).length)
                reject('Visual discovery assets require original-page crops','/nodes');
        }
        if(Object.keys(filled.coverage).length)reject('A visual scan records navigation coverage separately','/coverage');
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
    const claimed = new Set<string>(), required = new Set<any>(moduleLogicReview(packet)?filled.critical.map(moduleReviewRoot):filled.critical);
    if(Object.hasOwn(draft,'source_needs')){
        const graph=new ModuleGraph(string(packet.module_id),{nodes:[...array(packet.known_nodes),...nodes]},'',{});
        for(const need of sourceNeeds!){
            if(!graph.find(need.focus))reject('A retained source need must name a candidate or accepted entity','/source_needs');
            if((packet.source_unit||packet.visual_asset)&&['source_read','uncertain'].includes(need.kind)&&filled.ready_nodes.includes(graph.find(need.focus)?.node_id))reject('A partial source fragment cannot mark an unresolved entity ready','/ready_nodes');
            if(packet.purpose==='detail'&&need.kind==='deferred'&&string(packet.question).trim()===need.question.trim()
                &&graph.find(string(packet.focus))?.node_id===graph.find(need.focus)?.node_id)
                reject('A detail reading cannot defer its own requested source question','/source_needs');
            references(need.source_refs,count,seen);
        }
        required.add('/source_needs');
    }
    if (packet.opening_scope === 'first_interaction' || Object.hasOwn(draft, 'interaction_scene')) {
        if (packet.purpose !== 'opening') reject('interaction_scene belongs only to an opening reading', '/interaction_scene');
        checkOpeningBatch(filled, packet.focus, array(packet.known_nodes), true, array(packet.known_claims));
        required.add('/interaction_scene');
    }
    if(packet.source_unit&&seen&&array(packet.pages).some(page=>!seen.has(number(page))))reject('A source unit requires its assigned original pages','/coverage');
    if (!skeleton && (filled.ready_nodes.length||packet.source_unit)) required.add('/coverage');
    for (const path of required)
        pointer(draft, path);
    for (const [i, node] of nodes.entries()) {
        if(!moduleLogicReview(packet))for (const path of numericPaths(Object.fromEntries(entries(node.properties).filter(([key]) => !['image_sources', 'map_candidates'].includes(key))), `/nodes/${i}/properties`))
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
                claim[key] = clone(known[key] ?? []);
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
        required.add(moduleLogicReview(packet)?moduleReviewRoot(path):path);
    if (nodes.some(statesObligation)) {
        checkObligations(filled, packet, contract);
        if(!moduleLogicReview(packet))for (const [i, node] of nodes.entries())
            for (const path of obligationReviewPaths(node, `/nodes/${i}`))
                required.add(path);
    }
    checkMechanics(filled, packet, contract);
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
 * §151.3's evidence amendment for one `reviewer: "jev"` row: one record's paths, `supported`, an eligible record, the
 * page-text digests and extraction version of the evidence file for exactly the record's cited pages, a distribution,
 * and no vision row that marked an overlapping path anything but supported. Returns the paths it reviewed.
 */
function checkJevRow(draft: Row, item: Row, count: number, claims: ClaimEvidence | undefined, negative: string[]): string[] {
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
    const why = claimSupportIneligibility(draft, root, page => (claims.pages.get(page)?.text.trim() ?? '') !== '');
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
            for (const path of checkJevRow(draft, item, count, claims, negative))
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
            if (REVIEW_VERDICTS.includes(item.verdict) && (moduleLogicReview(filled)?advisoryModuleFinding(item):classifies(path))) {
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
