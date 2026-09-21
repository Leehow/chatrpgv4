/** Snapshot-only identity, candidate ranking and continuity ledgers. No extraction jobs. */
import { compareUnicode, isJsonObject, jsonDigest } from "../json.js";
import { ModuleGraph } from "./module-graph.js";
import { entries, values, array, row, truth, string, normalize, sorted, number, chars, type Row } from "./values.js";
import {derivePromiseFulfillment,fulfillmentDecimal} from '../memory/fulfillment-view.js';
import {assertSourceRef} from '../../runtime/jev/source-ref.ts';
import type {SourceRef} from '../../runtime/jev/value-contracts.ts';

// This weak marker holds no receipt data and never enters JSON or retained memory.
const DERIVED_FULFILLMENT=new WeakSet<object>();
const unavailableFulfillment=()=>({status:'unavailable',terms:[],reason:'invalid_fulfillment_receipts'});
/** Host-only identity: equal text or reused turn-local IDs never collapse different originals. */
export function memoryOccurrenceKey(value:Row):string {
    return jsonDigest({id:value.id??null,commit:row(value.source).commit??null,turn:row(value.source).turn??value.valid_from_turn??null,
        worldline:value.worldline??null,loop:value.loop??null,refs:value.source_refs??null});
}
export function canonicalMemoryReceipts(records:readonly Row[],current:readonly Row[]=[]):Row[] {
    // An undelivered close still retains real atomic apply receipts even when no narration was committed.
    return [...records.flatMap(record=>array(record.receipts)),...current];
}
export function withPromiseFulfillment(rows:readonly Row[],evidence:{campaign?:string;receipts:readonly Row[];world?:Row;available?:boolean}):Row[] {
    return rows.map(value=>{
        if(value.kind!=='promise'||DERIVED_FULFILLMENT.has(value)) return value;
        let fulfillment:Row={status:'open',terms:[]};
        try {
            if(evidence.available===false) throw new Error('receipt_history_unavailable');
            const refs=array(value.source_refs) as SourceRef[],primary=value.statement_ref as SourceRef|undefined;
            const related=evidence.receipts.filter(receipt=>row(receipt.fulfillment).promise===value.id);
            if(related.length) {
                if(value.memory_version!==2||!primary||!refs.length) throw new Error('unbound_promise_occurrence');
                for(const ref of refs) assertSourceRef(ref);
                assertSourceRef(primary);
                const scope=primary.scope;
                if(typeof scope.campaign!=='string'||scope.owner!==`campaign:${scope.campaign}`||!refs.some(ref=>jsonDigest(ref as any)===jsonDigest(primary as any))
                    ||scope.campaign!==(evidence.campaign??scope.campaign)
                    ||typeof scope.worldline!=='string'||!Number.isSafeInteger(scope.loop)||scope.audience!=='keeper'
                    ||value.worldline!==scope.worldline||Number(value.loop)!==scope.loop) throw new Error('foreign_promise_scope');
                const derived=derivePromiseFulfillment(string(value.id),evidence.receipts,{scope:{campaign:scope.campaign,worldline:scope.worldline,loop:scope.loop!},promiseRefs:refs});
                fulfillment={status:derived.status,terms:derived.terms.map(term=>{
                    const world=evidence.world??{},definition=row(row(row(world.objects).definitions)[term.definition]),instance=row(row(row(world.objects).instances)[term.instance]);
                    const receipt=related.find(receipt=>row(receipt.fulfillment).term===term.ordinal&&receipt.kind==='item'
                        &&jsonDigest(row(receipt.fulfillment).scope)===jsonDigest({campaign:scope.campaign!,worldline:scope.worldline!,loop:scope.loop!}));
                    const display=typeof receipt?.name==='string'?receipt.name:typeof instance.name==='string'?instance.name:typeof definition.name==='string'?definition.name:undefined;
                    return {kind:term.kind,total:term.total,fulfilled:term.fulfilled,remaining:term.remaining,
                        ...(typeof term.currency==='string'?{currency:term.currency}:{}),...(typeof term.item==='string'?{item:term.item}:{}),
                        ...(term.kind==='object'&&display?{display_name:display}:{})};
                })};
            }
        } catch {fulfillment=unavailableFulfillment();}
        const projected={...value,fulfillment};DERIVED_FULFILLMENT.add(projected);return projected;
    });
}
function fulfillmentEvidenceView(value:Row):Row {
    if(value.kind!=='promise'&&value.fulfillment===undefined) return {};
    if(value.fulfillment===undefined) return {};
    const accepted=DERIVED_FULFILLMENT.has(value)||value.authority==='conversation_report',view=row(value.fulfillment);
    if(!accepted||!['open','partial','complete','unavailable'].includes(view.status)||!Array.isArray(view.terms)||view.terms.length>8)
        return {fulfillment:unavailableFulfillment()};
    if(view.status==='unavailable') return {fulfillment:unavailableFulfillment()};
    const terms:Row[]=[];
    for(const term of view.terms) {
        if(!isJsonObject(term)||!['cash','item','object'].includes(string(term.kind))
            ||!['total','fulfilled','remaining'].every(key=>typeof term[key]==='string'&&term[key].length<=128)) return {fulfillment:unavailableFulfillment()};
        try {for(const key of ['total','fulfilled','remaining']) {const amount=fulfillmentDecimal(string(term[key]));
            if(amount.coefficient<0n||key==='total'&&amount.coefficient===0n||term.kind!=='cash'&&amount.exponent<0) throw new Error('invalid_amount');}}
        catch {return {fulfillment:unavailableFulfillment()};}
        terms.push(Object.fromEntries(['kind','currency','item','display_name','total','fulfilled','remaining']
            .filter(key=>typeof term[key]==='string').map(key=>[key,term[key]])));
    }
    return {fulfillment:{status:view.status,terms}};
}
export const CANDIDATE_TIERS = [["world_event", "knowledge", "relationship", "promise"], ["belief", "player_preference", "keeper_correction"], ["player_assertion"]];
export const kindRank = (kind: any): number => {
    const index = CANDIDATE_TIERS.findIndex(tier => tier.includes(kind));
    return index < 0 ? CANDIDATE_TIERS.length : index;
};
export class EntityIndex {
    constructor(readonly graph: ModuleGraph, readonly party: Row[], readonly labels: Row = {}, readonly allowed: string[] | null = null) {
    }
    matches(name: string, options: {
        reserved?: readonly string[];
        kinds?: readonly string[];
        investigators?: boolean;
    } = {}): string[] {
        const key = normalize(name), found: string[] = [];
        if (!key)
            return found;
        if ((options.reserved ?? ["world", "party", "keeper", "player"]).includes(key))
            found.push(`reserved:${key}`);
        for (const sheet of options.investigators === false ? [] : this.party)
            if ([normalize(sheet.id), normalize(sheet.name)].includes(key))
                found.push(`investigator:${string(sheet.id)}`);
        for (const id of sorted(this.graph.names.get(key) ?? [])) {
            const node = this.graph.nodes.get(id)!;
            if ((options.kinds ?? ["npc", "scene", "clue"]).includes(node.node_kind) && (this.allowed === null || this.allowed.includes(id)))
                found.push(`${node.node_kind}:${id}`);
        }
        for (const [handle, label] of (options.kinds ?? ["npc", "scene", "clue"]).includes("scene") ? entries(this.labels) : [])
            if (normalize(label) === key) {
                const node = this.graph.find(handle, ["scene"]), id = node ? `scene:${node.node_id}` : null;
                if (id && (this.allowed === null || this.allowed.includes(node!.node_id)) && !found.includes(id))
                    found.push(id);
            }
        return found;
    }
    looseMatches(name: string, kinds: readonly string[] = ["npc", "scene", "clue"]): string[] {
        const key = normalize(name), people: string[] = [], others: string[] = [];
        if (!key)
            return [];
        for (const sheet of this.party) {
            const words = new Set([...normalize(sheet.name).split(" "), ...normalize(sheet.id).split(" ")]);
            if (words.has(key))
                people.push(`investigator:${string(sheet.id)}`);
        }
        for (const kind of kinds)
            for (const node of this.graph.kind(kind)) {
                if (this.allowed !== null && !this.allowed.includes(node.node_id))
                    continue;
                const aliases = [this.graph.displayName(node), this.graph.handle(node), node.node_id,
                    ...(kind === "scene" ? [this.labels[this.graph.handle(node)]] : [])];
                if (aliases.filter(truth).some(alias => normalize(alias).split(" ").includes(key)))
                    (kind === "npc" ? people : others).push(`${kind}:${node.node_id}`);
            }
        return people.length ? people : others;
    }
    usableNames(): string[] {
        const ids = this.allowed ?? ["npc", "scene", "clue"].flatMap(kind => this.graph.kind(kind).map(node => node.node_id));
        return [...this.party.map(sheet => string(sheet.name)), ...ids.filter(id => this.graph.nodes.has(id)).map(id => this.canonicalName(`x:${id}`))];
    }
    describe(key: string): Row {
        const split = key.indexOf(":"), kind = key.slice(0, split), id = key.slice(split + 1);
        return { name: this.canonicalName(key), kind, id };
    }
    lenientKey(name: string): string {
        const matches = this.matches(name);
        return matches.length === 1 ? matches[0] : `name:${normalize(name)}`;
    }
    canonicalName(key: string): string {
        const at = key.indexOf(":"), kind = key.slice(0, at), rest = key.slice(at + 1);
        if (kind === "reserved")
            return rest;
        if (kind === "investigator")
            return string(this.party.find(s => string(s.id) === rest)?.name || rest);
        const node = this.graph.nodes.get(rest);
        return !node ? rest : node.node_kind === "clue" ? this.graph.handle(node) : this.graph.displayName(node);
    }
}
function attributionView(value: Row): Row {
    if (!Object.hasOwn(value, 'attribution') && value.memory_version !== 2) return {};
    const item = value.attribution;
    const unknown = {attribution: {kind: 'unknown'}};
    if (!isJsonObject(item) || Object.keys(item).some(key => !['kind', 'speaker'].includes(key))
        || !['player', 'keeper_narration', 'speech', 'mixed', 'unknown'].includes(string(item.kind))) return unknown;
    if (item.kind !== 'speech') return item.speaker === undefined ? {attribution: {kind: item.kind}} : unknown;
    const speaker = item.speaker;
    if (!isJsonObject(speaker) || Object.keys(speaker).sort().join(',') !== 'kind,name'
        || !['npc', 'investigator', 'label'].includes(string(speaker.kind)) || typeof speaker.name !== 'string' || !speaker.name.trim()) return unknown;
    return {attribution: {kind: 'speech', speaker: {name: speaker.name, kind: speaker.kind}}};
}
export function memoryEvidenceView(value: Row): Row {
    return {authority: 'conversation_report', ...attributionView(value), ...fulfillmentEvidenceView(value)};
}
export function hitView(value: Row): Row {
    return {
        id: value.id ?? null,
        kind: value.kind ?? null,
        subject: value.subject ?? null,
        knowers: [...array(value.knowers)],
        entities: [...array(value.entities)],
        statement: value.statement ?? null,
        privacy: value.privacy ?? null,
        state: value.state ?? null,
        confidence: value.confidence ?? null,
        status: value.status ?? null,
        ...memoryEvidenceView(value),
        source: row(value.source),
        turn: value.valid_from_turn ?? null,
        worldline: value.worldline ?? null,
        loop: value.loop ?? null,
        ...(value.superseded_by != null ? {
            superseded_by: value.superseded_by,
            valid_until_turn: value.valid_until_turn ?? null
        } : {})
    };
}
export function queryCandidates(rows: Row[], index: EntityIndex, about: string[], options: {
    narrow?: boolean;
    turns?: number[];
    kinds?: string[];
    includeSuperseded?: boolean;
    limit?: number;
} = {}): Row[] {
    const keys = new Set(about.map(name => index.lenientKey(name))), hits: Array<{
        overlap: number;
        tier: number;
        turn: number;
        id: string;
        correction: number;
        value: Row;
    }> = [];
    const byId = (from:Row,id:any):Row|undefined => {
        const matches=rows.filter(value=>value.id===id&&(value.worldline??'main')===(from.worldline??'main')&&number(value.loop)===number(from.loop));
        return matches.length===1?matches[0]:undefined;
    };
    for (const value of rows) {
        if (!options.includeSuperseded && value.superseded_by != null || options.kinds?.length && !options.kinds.includes(value.kind))
            continue;
        const turn = number(value.valid_from_turn);
        if (options.turns?.length && !(options.turns[0] <= turn && turn <= options.turns[1]))
            continue;
        const linked = value.kind === 'keeper_correction' ? array(value.corrects).flatMap(id => byId(value,id) ? [byId(value,id)!] : []) : [];
        const names = new Set([value, ...linked].flatMap(entry => [entry.subject, ...array(entry.knowers), ...array(entry.entities)]).filter(truth).map(name => index.lenientKey(string(name)))), overlap = [...names].filter(name => keys.has(name)).length;
        if (options.narrow && !overlap)
            continue;
        hits.push({
            overlap,
            tier: kindRank(value.kind),
            turn,
            id: string(value.id),
            correction: value.kind === 'keeper_correction' && value.superseded_by == null && overlap > 0 ? 0 : 1,
            value
        });
    }
    return hits.sort((a, b) => a.correction - b.correction || b.overlap - a.overlap || a.tier - b.tier || b.turn - a.turn || compareUnicode(a.id, b.id)).slice(0, options.limit ?? 12).map(hit => {
        const view = hitView(hit.value), seen = new Set<string>();
        let next = hit.value;
        while (next.superseded_by && byId(next,next.superseded_by) && !seen.has(next.superseded_by)) {
            seen.add(next.superseded_by); next = byId(next,next.superseded_by)!;
        }
        if (next !== hit.value) view.superseding = {kind: next.kind, statement: next.statement, turn: next.valid_from_turn, status: next.status, ...memoryEvidenceView(next)};
        return view;
    });
}
export function capsuleMemory(rows: Row[], index: EntityIndex, about: string[]): Row[] {
    return queryCandidates(rows, index, about, { limit: 6 }).map(hit => ({
        id: hit.id,
        kind: hit.kind,
        statement: hit.statement,
        subject: hit.subject,
        turn: hit.turn,
        status: hit.status,
        state: hit.state,
        ...memoryEvidenceView(hit)
    }));
}
export function fromOtherLines(rows: Row[], index: EntityIndex, name: string, line: string, loop: number, limit = 3): Row[] {
    const key = index.lenientKey(name);
    return rows.filter(value => value.superseded_by == null && (number(value.loop) < loop || typeof value.worldline === "string" && value.worldline !== line) && [value.subject, ...array(value.knowers)].filter(truth).some(n => index.lenientKey(string(n)) === key)).sort((a, b) => number(b.valid_from_turn) - number(a.valid_from_turn) || compareUnicode(string(a.id), string(b.id))).slice(0, limit).map(value => ({
        statement: value.statement ?? null,
        line: value.worldline ?? null,
        loop: number(value.loop),
        turn: value.valid_from_turn ?? null,
        ...memoryEvidenceView(value)
    }));
}
export function latestNamed(rows: Row[], status: string): Row[] {
    const latest = new Map<string, Row>();
    rows.forEach((value, seq) => {
        const key = normalize(value.name || "");
        if (key)
            latest.set(key, {
                ...value,
                seq
            });
    });
    return [...latest.values()].filter(value => value.status === status);
}
const newest = (rows: Row[]) => [...rows].sort((a, b) => number(b.turn) - number(a.turn) || number(b.seq) - number(a.seq));
export function noteObligations(rows: Row[], present: string[], here: string[]): Row[] {
    const notes = latestNamed(rows, "open"), names = new Set([...present, ...here].filter(Boolean).map(normalize)), linked = notes.filter(note => array(note.entities).some(entity => names.has(normalize(entity))));
    return [...linked, ...newest(notes.filter(note => !linked.includes(note))).slice(0, 3)].map(note => ({
        kind: "note",
        name: string(note.name),
        who: "keeper",
        state: string(note.text || ""),
        turn: note.turn ?? null,
        ...(array(note.entities).length ? { cue: note.entities.map(string).join(", ") } : {})
    }));
}
export function rulingsForCapsule(rows: Row[], session: string | null, present: string[], scene: string, module: string, party: string[] = []): Row[] {
    const families: Row = {
        combat: "combat",
        chase: "chase",
        sanity_bout: "sanity"
    // An anchor surfaces its ruling where the thing it judges is: NPCs and scenes come and go, and a
    // ruling about one is silent everywhere else. An investigator is never elsewhere -- they are the
    // table -- so a ruling anchored on one is in scope for every turn they are playing, or it would
    // be a record nobody could ever read back.
    }, family = session ? families[session] ?? null : null, here = [...present, scene, ...party];
    const hits = latestNamed(rows, "active").filter(value => {
        if (value.scope === "scene" && value.scene !== scene || value.scope === "module" && value.module != null && value.module !== module)
            return false;
        const anchor = row(value.anchor), judged = values(families).includes(anchor.family);
        return value.scope === "scene" && value.scene === scene || (judged || truth(anchor.entities)) && (!judged || anchor.family == null || anchor.family === family) && (!truth(anchor.entities) || array(anchor.entities).some(entity => here.includes(entity)));
    });
    return newest(hits).slice(0, 3).map(value => ({
        name: string(value.name),
        statement: string(value.statement),
        anchor: value.anchor ?? null,
        scope: value.scope ?? null
    }));
}
export function promiseObligations(rows: Row[]): Row[] {
    return rows.filter(value => value.kind === "promise" && value.status === "candidate" && value.superseded_by == null
        && row(memoryEvidenceView(value).fulfillment).status !== "complete").map(value => ({
        kind: "promise",
        name: string(value.id),
        who: string(value.subject),
        state: chars(string(value.statement || ""), 120),
        ...memoryEvidenceView(value),
        ...(array(value.entities).length ? { cue: value.entities.map(string).join(", ") } : {})
    }));
}
