/** Snapshot-only identity, candidate ranking and continuity ledgers. No extraction jobs. */
import { compareUnicode } from "../json.js";
import { ModuleGraph } from "./module-graph.js";
import { entries, values, array, row, truth, string, normalize, sorted, number, chars, type Row } from "./values.js";
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
        authority: 'conversation_report',
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
    const byId = new Map(rows.map(value => [value.id, value]));
    for (const value of rows) {
        if (!options.includeSuperseded && value.superseded_by != null || options.kinds?.length && !options.kinds.includes(value.kind))
            continue;
        const turn = number(value.valid_from_turn);
        if (options.turns?.length && !(options.turns[0] <= turn && turn <= options.turns[1]))
            continue;
        const linked = value.kind === 'keeper_correction' ? array(value.corrects).flatMap(id => byId.has(id) ? [byId.get(id)!] : []) : [];
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
        while (next.superseded_by && byId.has(next.superseded_by) && !seen.has(next.superseded_by)) {
            seen.add(next.superseded_by); next = byId.get(next.superseded_by)!;
        }
        if (next !== hit.value) view.superseding = {kind: next.kind, statement: next.statement, turn: next.valid_from_turn, status: next.status};
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
        authority: hit.authority
    }));
}
export function fromOtherLines(rows: Row[], index: EntityIndex, name: string, line: string, loop: number, limit = 3): Row[] {
    const key = index.lenientKey(name);
    return rows.filter(value => value.superseded_by == null && (number(value.loop) < loop || typeof value.worldline === "string" && value.worldline !== line) && [value.subject, ...array(value.knowers)].filter(truth).some(n => index.lenientKey(string(n)) === key)).sort((a, b) => number(b.valid_from_turn) - number(a.valid_from_turn) || compareUnicode(string(a.id), string(b.id))).slice(0, limit).map(value => ({
        statement: value.statement ?? null,
        line: value.worldline ?? null,
        loop: number(value.loop),
        turn: value.valid_from_turn ?? null
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
    return rows.filter(value => value.kind === "promise" && value.status === "candidate" && value.superseded_by == null).map(value => ({
        kind: "promise",
        name: string(value.id),
        who: string(value.subject),
        state: chars(string(value.statement || ""), 120),
        ...(array(value.entities).length ? { cue: value.entities.map(string).join(", ") } : {})
    }));
}
