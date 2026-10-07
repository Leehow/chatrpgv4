/** Read-only authored graph; names and projections never change the source. */
import { createHash } from "node:crypto";
import { RpcError } from "../errors.js";
import { canonicalJson, compareUnicode, isJsonObject, type JsonValue } from "../json.js";
import { entries, values, array, row, truth, string, repr, integer, normalize, normalizeText, kebab, stripPrefix, sorted, similarity, words, chars, pick, type Row } from "./values.js";
import { SHAPE_KINDS } from "../modules/mechanics-catalog.js";
export const TEMPLATE_NOTE = "the book's pregenerated investigator, not at this table; the table's investigators are in the capsule's known.investigator";
/** Contract §185.4: a name-free campaign's map from a book node's id to its handle (`world.node_handles`). */
export type NodeHandles = ReadonlyMap<string, string>;
/**
 * Contract §185.4: the handle a book node shows in a name-free campaign before a fold maps it -- its kind and the first six
 * hex digits of sha256(node id). Deterministic, so it needs no write, and it stays resolvable after the fold.
 */
export const interimHandle = (kind: string, nodeId: string): string =>
    `${kind || "node"}-${createHash("sha256").update(nodeId).digest("hex").slice(0, 6)}`;
const EXIT_KINDS = ["route-to", "play-precedes", "may-lead-to", "alternative-to", "hands-off-to"];
const CHARACTERISTICS = new Set(["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK", "SAN"]);
const DERIVED = new Set(["HP", "MP", "BUILD", "MOVE", "MAGIC_POINTS", "DAMAGE_BONUS", "AGE", "ARMOR"]);
/** Contract 28.3/28.4: the dossier spine as one list. `profile_keys` stays the core words the
 *  book's own vocabulary names -- the playability measure counts those and only those, so a book
 *  silent about a package's key does not report every actor in it as thin. `contributed` are the
 *  words a package added, bound when the module was built and carried in its provenance. */
export const dossierKeys = (dossier: Row): string[] => [
    ...array(dossier.profile_keys).map(key => string(key)),
    ...array(dossier.contributed).map(entry => string(row(entry).key)),
].filter(key => key !== "");
export function dossierLabels(dossier: Row): Array<[string, string]> {
    const labels = row(dossier.profile_labels),
        core: Array<[string, string]> = truth(labels)
            ? entries(labels).map(([key, label]) => [key, string(label) || key])
            : array(dossier.profile_keys).map(key => [string(key), string(key)]);
    return [...core, ...array(dossier.contributed).map(entry => {
        const key = string(row(entry).key);
        return [key, string(row(entry).label) || key] as [string, string];
    })].filter(([key]) => key !== "");
}
/** The module's own recorded vocabulary merged onto the current contract. A package can only add
 *  a word, never rename or take away a core one, and a key the module was not built with stays
 *  absent -- the same absence as a book that does not say (contract 28.2). */
export function dossierWith(dossier: Row, recorded: Row | null | undefined, creature: Row | null = null): Row {
    const core = new Set([...array(dossier.profile_keys), ...array(row(creature).profile_keys)].map(key => string(key))),
        seen = new Set<string>(),
        contributed = array(row(recorded).actor_profile_keys).flatMap(entry => {
            const key = string(row(entry).key);
            if (!key || core.has(key) || seen.has(key))
                return [];
            seen.add(key);
            // A `shape: "lines"` word (contract §40.7) is carried so the capsule can seat it in `voices`.
            return [{ key, label: string(row(entry).label) || key, ...(row(entry).shape === "lines" ? { shape: "lines" } : {}) }];
        }),
        // §180.8: the creature's words, through the same rule. One key belongs to one spine, so a key the actor spine
        // already carries (or either spine's core names) is not a creature word as well.
        creatureWords = array(row(recorded).creature_profile_keys).flatMap(entry => {
            const key = string(row(entry).key);
            if (!key || core.has(key) || seen.has(key))
                return [];
            seen.add(key);
            return [{ key, label: string(row(entry).label) || key }];
        });
    if (!contributed.length && !(creature && creatureWords.length) && !truth(row(recorded).actor_weaknesses))
        return dossier;
    return {
        ...dossier,
        ...(contributed.length ? { contributed } : {}),
        // Carried beside the actor spine, so every graph built from a module's provenance has both and no constructor changes.
        ...(creature && creatureWords.length ? { creature_dossier: { ...creature, contributed: creatureWords } } : {}),
        // §180.9: the module was built with the weakness shape bound; its authored `weaknesses` reach the table (§28.5).
        ...(truth(row(recorded).actor_weaknesses) ? { actor_weaknesses: true } : {}),
    };
}
const lines = (value: any): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 4 && value.every(line => typeof line === "string" && line.trim());
export function recordOf(node: Row | null | undefined): Row {
    const props = row(node?.properties),
        record = row(props.runtime_projection).record;
    return record && !Array.isArray(record) && typeof record === "object" ? record : Object.fromEntries(entries(props).filter(([k]) => k !== "runtime_projection"));
}
/**
 * The authored identity of a place: the name the book calls it, and the names a table will call it
 * by. A scene handle is a slug, and a slug names a room ("newspaper-morgue") where the book named a
 * building ("Boston Globe offices"); the module writes both, but the identity sat under
 * `runtime_projection.record`, which `entityView` strips, so it reached nobody. That is the whole
 * defect behind three stalled turns of 2026-09-15: the action-admission reviewer (contract 32) was
 * handed `{handle, label, summary}` built from the slug three times over, and could not tell that
 * `newspaper-morgue` *is* the Globe the player had just walked into.
 *
 * Additive, and deliberately not a rename: `displayName` still answers with the module's own
 * `display_name`/`name`/`title` where one is authored, because a module may write both and mean
 * different things by them (mystery-house's `clip-morgue` displays as the Evening Transcript while
 * carrying a canonical name of its own). Identity is what a name *refers to*; display name is what
 * the table calls it.
 */
export function destinationIdentity(node: Row | null | undefined): Row | null {
    const identity = row(recordOf(node).destination_identity),
        text = (value: any): string => typeof value === "string" ? value.trim() : "",
        canonical = text(identity.canonical_name),
        aliases = [...new Set(array(identity.aliases).map(text).filter(Boolean))];
    if (!canonical && !aliases.length)
        return null;
    return { ...(canonical ? { canonical_name: canonical } : {}), ...(aliases.length ? { aliases } : {}) };
}
/** Every authored name for the place a node is, canonical first; empty for a node with no identity. */
export const destinationNames = (node: Row | null | undefined): string[] => {
    const identity = row(destinationIdentity(node));
    return [...(typeof identity.canonical_name === "string" ? [identity.canonical_name] : []), ...array(identity.aliases)];
};
/** The authored answer to "can they walk in": `discoverability` and `direct_entry`, as the book set them. */
export function destinationAccess(node: Row | null | undefined): Row | null {
    const access = row(recordOf(node).destination_access),
        picked = Object.fromEntries(["discoverability", "direct_entry"].map(key => [key, access[key]]).filter(([, value]) => typeof value === "string"));
    return Object.keys(picked).length ? picked : null;
}
export function moduleDeclaration(node: Row | null | undefined): Row {
    if (!node)
        return {};
    const document = array(row(row(node.properties).runtime_projection).documents).find(d => row(d).filename === "module-meta.json");
    return {
        ...Object.fromEntries(entries(row(node.properties)).filter(([k]) => k !== "runtime_projection")),
        ...recordOf(node),
        ...row(document?.root)
    };
}
export function conditionFlag(when: any): string | null {
    if (typeof when === "string")
        return kebab(when) || null;
    if (!["flag", "flag_set"].includes(row(when).kind))
        return null;
    for (const key of ["flag_id", "flag", "name"])
        if (typeof when[key] === "string" && kebab(when[key]))
            return kebab(when[key]);
    return null;
}
export function flagIsSet(flags: Row, slug: string, expected: any = null): boolean {
    return Object.hasOwn(flags, slug) && (expected != null ? flags[slug] === expected : flags[slug] !== false);
}
/**
 * The handles `discovered_clues` can hold for an authored clue id: the book's slug, and in a name-free campaign (§185.4) the
 * mapped handle and the interim one. A legacy world holds neither of the last two.
 */
function clueForms(world: Row, clueId: string): string[] {
    const id = clueId.startsWith("clue-") ? clueId : `clue-${clueId}`, mapped = row(world.node_handles)[id];
    return [stripPrefix(clueId, "clue"), ...(typeof mapped === "string" ? [mapped] : []), interimHandle("clue", id)];
}
export function conditionStatus(when: any, world: Row): boolean | null {
    const flags = row(world.flags);
    if (typeof when === "string") {
        const slug = kebab(when);
        return slug && Object.hasOwn(flags, slug) ? flagIsSet(flags, slug) : null;
    }
    if (!when || typeof when !== "object" || Array.isArray(when))
        return null;
    if (when.kind === "always")
        return true;
    if (when.kind === "clue_discovered")
        return clueForms(world, string(when.clue_id ?? "")).some(handle => array(world.discovered_clues).includes(handle));
    const slug = conditionFlag(when);
    if (slug != null)
        return flagIsSet(flags, slug, when.value);
    const texts = values(when).filter(v => typeof v === "string" && v.trim()).map(v => ` ${normalizeText(v)} `);
    const named = Object.keys(flags).filter(k => normalizeText(k) && texts.some(text => text.includes(` ${normalizeText(k)} `)));
    return named.length ? named.every(k => flagIsSet(flags, k)) : null;
}
export const conditionMet = (when: any, world: Row): boolean => conditionStatus(when, world) === true;
export function describeCondition(when: any): string {
    if (row(when).kind === "clue_discovered")
        return `clue_discovered: ${stripPrefix(string(when.clue_id ?? ""), "clue")}`;
    const slug = conditionFlag(when);
    return slug == null ? canonicalJson(when) : `flag_set: ${slug}${row(when).value != null ? ` = ${repr(when.value)}` : ""}`;
}
/** The phrase's words open or close the key, in order with nothing between, and the key holds more (equal would
 *  have been an exact match).
 *
 *  Anchored, because a name key is not always a name. `nameKeys` indexes whatever the graph put in `name`, and
 *  for a clue that is a whole sentence: "Landlord Steven Knott pays $20/day to examine the Corbitt House...".
 *  An unanchored run turned the bridge into a substring search over prose, and `apply clue "steven-knott"` --
 *  a person, asked for as a clue -- came back with that clue instead of `unknown_entity`. A qualified form of a
 *  name puts the qualifier outside it ("Professor Nemesio Sánchez", "Letter from Nemesio Sánchez", "Nemesio
 *  Sánchez, of the university"), so the run sits at one end; a sentence that merely mentions someone holds it in
 *  the middle. That is the whole difference, and it needs no list of titles. */
const phraseWithin = (phrase: string[], key: string[]): boolean => {
    if (phrase.length >= key.length)
        return false;
    const opens = phrase.every((word, i) => key[i] === word),
        closes = phrase.every((word, i) => key[key.length - phrase.length + i] === word);
    return opens || closes;
};
/**
 * §185.3/§188.3: one word as the request showed it, and every string the rename put it in place of: a person's names, aliases
 * and pieces, and in a legacy campaign their node id and handle; for a joined word (§177.4), the name its owners share, then
 * each owner's own names. `called` marks a word the §87.8 junction reads as a person's (`calledOwners`).
 */
export interface RenameUndoRow { readonly shown: string; readonly names: readonly string[]; readonly called?: boolean }
/** §188.3: the most spellings one miss tries; a reference holds one or two places, each a handful of names. */
export const UNDO_SPELLINGS = 48;
const latinRun = (char: string | undefined): boolean => !!char && /^[A-Za-z0-9]$/.test(char);
/**
 * §185.3/§188.3: every spelling `reference` may have had before the request's rename (`extensions/kernel/untold-view.ts`) put
 * a word where a name stood. A word counts where it stands as the rename leaves one: the longer word first where two overlap,
 * and only with the names that have no Latin letter or digit running on past an end where the name has one (the rename's
 * own boundary test, read backwards). Each place is read back as each of its names, in the rows' order, up to
 * `UNDO_SPELLINGS`. A reference that is one person's word and nothing else, a word the junction reads (§87.8), is the
 * junction's and is left alone. Pure string data from the rows; nothing is classified.
 */
function renameUndone(reference: string, rows: readonly RenameUndoRow[]): string[] {
    const ordered = [...rows].sort((a, b) => b.shown.length - a.shown.length);
    const places: { start: number; end: number; names: string[]; called: boolean }[] = [];
    for (const row of ordered) {
        if (!row.shown) continue;
        for (let at = reference.indexOf(row.shown); at >= 0; at = reference.indexOf(row.shown, at + 1)) {
            const end = at + row.shown.length;
            if (places.some(place => at < place.end && place.start < end)) continue;
            const names = row.names.filter(name => name && !(latinRun(name[0]) && latinRun(reference[at - 1])) && !(latinRun(name[name.length - 1]) && latinRun(reference[end])));
            if (names.length) places.push({ start: at, end, names, called: row.called === true });
        }
    }
    if (!places.length || (places.length === 1 && places[0].called && places[0].start === 0 && places[0].end === reference.length))
        return [];
    let spellings = [""], from = 0;
    for (const place of places.sort((a, b) => a.start - b.start)) {
        const between = reference.slice(from, place.start);
        spellings = spellings.flatMap(prefix => place.names.map(name => prefix + between + name)).slice(0, UNDO_SPELLINGS);
        from = place.end;
    }
    return [...new Set(spellings.map(spelling => spelling + reference.slice(from)))].filter(spelling => spelling !== reference);
}
/**
 * SL-73 (§11.5.7 addendum, gate #12): `resolve()`'s own `unknown_entity` (`no ${what} named … in the
 * module graph`, `fix: "pick a name from details.candidates or look first"`) is a real answer when
 * `details.candidates` has entries, and a dead end when it does not -- "pick from an empty list" is not
 * a fix. This is that error, re-shaped for a caller resolving a *person* (an npc effect, a check's actor
 * or target): when the ranked candidates are empty, it says what the query actually is when the kernel
 * can tell, instead of repeating advice with nothing to act on.
 *
 * No hard-coded name or kind list: `is_investigator` comes from a match against the party the caller
 * hands in (the campaign's own sheets), and `matched_kind` from the graph's own `node_kind` on whatever
 * `graph.candidates` turns up as an exact name match once the person-only search has already failed --
 * both closed, structural facts the kernel already has, never a semantic guess about the name's text.
 */
/**
 * The refusals `resolve` gave because a word names more than one entity, by an exact key or as a run
 * inside two names. A caller that may establish a newcomer on a miss must never do so on such a word
 * (contract §87.7), and must tell the two refusals apart without reading the message. The mark rides
 * beside the error rather than in it: `resolve`'s error JSON is compared field for field against the
 * frozen Python oracle, which never had one.
 */
const ambiguities = new WeakMap<RpcError, readonly string[]>();
/** The mark carries the node ids the word named, so §188.3's undo can count a spelling that names several. */
const markAmbiguity = (error: RpcError, ids: readonly string[]): RpcError => (ambiguities.set(error, ids), error);
export const isAmbiguity = (error: unknown): boolean => error instanceof RpcError && ambiguities.has(error);
export function personRefusal(error: unknown, name: string, graph: ModuleGraph, party: readonly Row[]): unknown {
    if (!(error instanceof RpcError) || error.code !== "unknown_entity" || typeof name !== "string")
        return error;
    if (array((error.details as Row | undefined)?.candidates).length)
        return error; // today's answer already has something to act on.
    return notAPerson(name, graph, party, error.message) ?? new RpcError("unknown_entity", error.message, {
        fix: `${repr(name)} is not in the module graph or this table's roster; establish them first (an npc effect with walk_on: true and why, or the carried text's own person) or look npc to check the name before trying again`,
        details: { query: name }
    });
}
/**
 * SL-73's two structural answers on their own: the word is the investigator at this table, or exactly
 * the name of something else the graph holds. Either way it is not a person anybody may establish, so
 * `apply npc` asks this before it would ever offer `walk_on` (contract §87.7), whatever the candidates.
 */
export function notAPerson(name: string, graph: ModuleGraph, party: readonly Row[], message: string): RpcError | null {
    const key = normalize(name);
    const investigator = party.find(sheet => [normalize(string(sheet.id)), normalize(string(sheet.name))].includes(key));
    if (investigator)
        return new RpcError("unknown_entity", message, {
            fix: `${repr(name)} is the investigator at this table (${repr(string(investigator.name || investigator.id))}), not an npc; write the investigator's own sheet or effect instead of an npc one`,
            details: { query: name, is_investigator: true }
        });
    // `graph.find` (unrestricted kinds) throws -- and is swallowed to null -- on the common case of a
    // scene sharing its exact name with the graph's own paired "beat" bookkeeping node; `candidates`
    // ranks instead of resolving, so it survives that and everything else `resolve` would call
    // ambiguous. A "beat" is the graph's own internal pacing record, never a thing an effect names, so
    // it is skipped here the same way `graph.actor` already looks past a scene to find an npc.
    const other = graph.candidates(name, undefined, 6).find(candidate => string(candidate.kind) !== "beat" && normalize(string(candidate.name)) === key);
    if (other)
        return new RpcError("unknown_entity", message, {
            fix: `${repr(name)} is a ${other.kind} in the module graph, not a person; use the effect or lookup for a ${other.kind} instead of an npc one`,
            details: { query: name, matched_kind: other.kind }
        });
    return null;
}
/**
 * §185.6.1: whether a stored handle names this node -- `ModuleGraph.sameNode` in a name-free graph. A legacy graph, or a
 * graph-shaped reader without a map, compares the handle as written, as every reader did before §185.
 */
export const sameNode = (graph: ModuleGraph, stored: unknown, node: Row): boolean =>
    graph.nodeHandles ? graph.sameNode(stored, node) : typeof stored === "string" && stored !== "" && stored === graph.handle(node);
/** §185.6.1: a stored handle as the current handle of the node it names in a name-free graph; as written otherwise. */
export const currentHandle = (graph: ModuleGraph, stored: string): string => graph.nodeHandles ? graph.currentHandle(stored) : stored;
export class ModuleGraph {
    /** Source queue/asset routing only; never authored graph data. */
    sourceCampaign?: string;
    /** Only the campaign resolver installs this pinned material authority. */
    materialOverride?: (name: string) => string;
    assetOverride?: (name: string) => Promise<Row | null>;
    /** Contract §177.2: the cast reader's `cast.json` for this book, when the module has one (`loadModule`); read by `bookCast`. */
    castStore?: Row | null;
    /**
     * Contract §185.13: every name the investigators at this table are registered under (each sheet's name and id), installed
     * by the campaign loader (`loadCampaignModule`); read by `knownNamePieces`. Empty for a graph no campaign serves.
     */
    investigatorNames: readonly string[] = [];
    readonly nodes = new Map<string, Row>();
    readonly byKind = new Map<string, Row[]>();
    readonly out = new Map<string, Row[]>();
    readonly incoming = new Map<string, Row[]>();
    readonly claimsBySubject = new Map<string, Row[]>();
    readonly names = new Map<string, Set<string>>();
    /** Handles for the people this table established; see `addTablePerson`. */
    readonly tableNames = new Map<string, string>();
    /** Handles for the creatures this table declared (contract §180.6); see `addTableCreature`. Never a person's. */
    readonly tableCreatureNames = new Map<string, string>();
    /** Creatures whose stat block this table pinned from the rules catalog (contract §180.6); see `pinBody`. */
    readonly pinnedBodies = new Set<string>();
    readonly tableEntityNames = new Map<string, string>();
    readonly sourcePlaceNames = new Map<string, string>();
    /**
     * §185.3/§188.3: the request rename read backwards -- every word the roster can show beside the strings it stood for --
     * installed by the campaign loader in both schemes (`read/rename-undo.ts`). Empty for a graph no campaign serves: no retry.
     */
    renameUndo: readonly RenameUndoRow[] = [];
    /** §188.3: each book person's word as the request shows them (node id to word), for the candidates of an ambiguous undo. */
    shownWords: ReadonlyMap<string, string> = new Map();
    /**
     * §188.2: each node of an individual the cast holds more than once (a later page reading wrote someone the graph had again,
     * under another id), by node id, to the node that stands for them -- their first, whose word the roster shows first.
     * Installed by the campaign loader with the undo rows (`read/rename-undo.ts`); a name they share is one candidate.
     */
    individuals: ReadonlyMap<string, string> = new Map();
    private undoing = false;
    readonly moduleNode: Row | null;
    /** §185.4: each book node's kind as the book gave it (a projected location stays a location) and its interim handle. */
    private readonly bookKinds = new Map<string, string>();
    private readonly interims = new Map<string, string>();
    /**
     * `nodeHandles` is a name-free campaign's map (contract §185.4), passed at construction so the names index and the source
     * place projection both read it; null for a legacy campaign and for a graph no campaign serves.
     */
    constructor(readonly moduleId: string, readonly raw: Row, readonly digest: string, readonly dossier: Row,
        readonly semanticNames: ReadonlyMap<string, string> = new Map(), readonly campaignView = false,
        readonly nodeHandles: NodeHandles | null = null) {
        const append = (map: Map<string, Row[]>, key: string, value: Row) => map.set(key, [...(map.get(key) ?? []), value]);
        for (const node of array(raw.nodes)) {
            this.nodes.set(node.node_id, node);
            this.bookKinds.set(node.node_id, typeof node.node_kind === "string" ? node.node_kind : "");
            append(this.byKind, node.node_kind, node);
        }
        for (const rel of array(raw.relations)) {
            append(this.out, rel.from_node_id, rel);
            append(this.incoming, rel.to_node_id, rel);
        }
        for (const node of this.nodes.values())
            for (const key of this.nameKeys(node)) {
                const normalized = normalize(key);
                this.names.set(normalized, new Set([...(this.names.get(normalized) ?? []), node.node_id]));
            }
        for (const claim of array(raw.claims))
            if (typeof row(claim).subject_id === "string")
                append(this.claimsBySubject, claim.subject_id, claim);
        this.moduleNode = this.kind("module")[0] ?? null;
    }
    kind(kind: string): Row[] {
        return this.byKind.get(kind) ?? [];
    }
    nameKeys(node: Row): string[] {
        const record = recordOf(node);
        return [node.node_id, this.handle(node), node.name || "", ...array(node.aliases), ...["display_name", "name", "scene_id", "title"].map(k => record[k]).filter(v => typeof v === "string"),
            ...this.inputOnlyKeys(node)].filter(Boolean);
    }
    /**
     * Contract §185.4: in a name-free campaign a book node also answers to its interim handle and to the slug the book's words
     * made (the stripped node id), so a reference the Keeper copied before a fold, or one internal code wrote with a slug, still
     * resolves. Input only: nothing emits these. Empty in a legacy campaign, where the slug is the handle.
     */
    private inputOnlyKeys(node: Row): string[] {
        if (!this.nodeHandles || !this.isBookNode(node))
            return [];
        return [this.interimHandle(node), stripPrefix(string(node.node_id), this.bookKind(node))];
    }
    /** §185.1: whether this graph serves a name-free campaign. */
    get nameFree(): boolean {
        return this.nodeHandles !== null;
    }
    /** §185.4: a node the book has -- not a person, place, clue or creature this table established, nor one an adaptation minted. */
    isBookNode(node: Row | null | undefined): boolean {
        const id = string(node?.node_id);
        return this.bookKinds.has(id) && !this.tableNames.has(id) && !this.tableEntityNames.has(id) && !this.tableCreatureNames.has(id) && !this.semanticNames.has(id);
    }
    /** The node's kind as the book gave it: a source location projected into a scene (§22.6) is still a location here. */
    bookKind(node: Row): string {
        return this.bookKinds.get(string(node.node_id)) ?? string(node.node_kind);
    }
    /** §185.4: the node's interim handle, `<kind>-<six hex>`. */
    interimHandle(node: Row): string {
        const id = string(node.node_id);
        let value = this.interims.get(id);
        if (value === undefined)
            this.interims.set(id, value = interimHandle(this.bookKind(node), id));
        return value;
    }
    /**
     * §185.6.1: whether a handle written before now -- in a turn record, an event, a job packet -- names this node. Exact: its
     * current handle, or in a name-free campaign one of its input-only keys, which is what a node shown before a fold was
     * written under. Never a name.
     */
    sameNode(stored: unknown, node: Row): boolean {
        if (typeof stored !== "string" || !stored)
            return false;
        return stored === this.handle(node) || (this.nodeHandles !== null && (stored === node.node_id || this.inputOnlyKeys(node).includes(stored)));
    }
    /** §185.6.1: the node a stored handle names by `sameNode`, or null (none, or more than one). */
    nodeOfHandle(stored: unknown): Row | null {
        if (typeof stored !== "string" || !stored)
            return null;
        const found = [...this.nodes.values()].filter(node => this.sameNode(stored, node));
        return found.length === 1 ? found[0] : null;
    }
    /** §185.6.1: a stored handle read as the current handle of the node it names; anything else as it is. */
    currentHandle(stored: string): string {
        if (!this.nodeHandles || !stored)
            return stored;
        const node = this.nodeOfHandle(stored);
        return node ? this.handle(node) : stored;
    }
    /**
     * §185.7: a value as a Keeper-facing surface shows it. In a name-free campaign every string that is exactly a node id of
     * this graph -- an object key or a value, at any depth of plain objects and arrays -- becomes that node's handle; anything
     * else is copied as it is. A legacy graph returns the value itself: its surfaces stay byte-identical.
     *
     * Exact, never a substring: a composite reference (`clue:<handle>-t3`, `intent:<handle>:<digest>`) is built from handles
     * already. It reads stored state (a receipt, the ledger, the book's raw properties and claims) for the Keeper and never
     * writes it back, so every internal reader keeps the node id it compares (`receipt.npc === node.node_id`).
     */
    shownIds<T>(value: T): T {
        if (!this.nodeHandles)
            return value;
        const shown = (item: unknown): unknown => {
            if (typeof item === "string") {
                const node = this.nodes.get(item);
                return node ? this.handle(node) : item;
            }
            if (Array.isArray(item))
                return item.map(shown);
            if (isJsonObject(item))
                return Object.fromEntries(Object.entries(item).map(([key, child]) => [shown(key) as string, shown(child)]));
            return item;
        };
        return shown(value) as T;
    }
    /**
     * The handle the book's own words give a node -- a scene's `scene_id`, else its node id without the kind (the old slug) --
     * the identifier a legacy campaign shows and the reading layer keeps (§185.12). A projected location strips its own kind.
     */
    bookHandle(node: Row): string {
        return node.node_kind === "scene" && typeof recordOf(node).scene_id === "string" ? recordOf(node).scene_id : stripPrefix(node.node_id, this.bookKind(node));
    }
    /**
     * What `search` matches on: the name keys plus the place names the module authored. A Keeper
     * looking up the destination a player just named -- "the Boston Globe" -- found nothing, and
     * `table.lookup kind=module expected_kind=scene` reads nothing as a destination to *prepare*:
     * a second scene, adapted into the campaign, for a place the book had already registered.
     *
     * Only `search`. `nameKeys` also builds the `names` index that `resolve` and `candidates` read,
     * where a name is an identifier: an alias there changes which handle an exact name resolves to
     * and which candidates a miss suggests, and the frozen captures in `ts-kernel-read` show it
     * does (`resolve "unlisted-person"` gains a candidate off "ruined chapel"). Discovery is the
     * seam that was broken; the identifier lookup was not.
     */
    searchKeys(node: Row): string[] {
        return [...this.nameKeys(node), ...destinationNames(node)];
    }
    /**
     * The place a name belongs to, or null: the registered scene whose own identity already covers
     * it. Two shapes, both exact on authored words and neither of them a list:
     *
     *  - the name IS one of the place's names ("Boston Globe" -> `newspaper-morgue`);
     *  - one of the place's names opens or closes the name, and the name holds more ("Boston Globe
     *    lobby", "the counter at the Boston Globe") -- a part, entrance, room or counter of a place
     *    that the module registered whole.
     *
     * The second is `phraseWithin` with its arguments the other way round. `resolve` asks whether a
     * shorter query sits anchored inside a longer authored key ("Nemesio Sánchez" in "Professor
     * Nemesio Sánchez"); this asks whether a shorter authored key sits anchored inside a longer
     * request. Anchoring is what makes it safe without a vocabulary of "lobby", "entrance", "desk":
     * a place's name at one end of a phrase qualifies that place, and in the middle it does not.
     *
     * Two or more words are required of the authored name, exactly as `resolve` requires of a
     * phrase: a single word is a hint, not an identity, and "morgue" belongs to no one building.
     * Ties between different scenes answer null -- an ambiguous name is not a covered one.
     */
    placeOf(name: string, kinds: string[] = ["scene"]): Row | null {
        const key = normalize(name);
        if (!key)
            return null;
        const requested = key.split(" ");
        let best: { length: number; nodes: Set<string> } | null = null;
        for (const node of this.nodes.values()) {
            if (!kinds.includes(node.node_kind))
                continue;
            for (const authored of [...this.nameKeys(node), ...destinationNames(node)]) {
                const place = normalize(authored), words = place.split(" ");
                if (!place)
                    continue;
                const covers = place === key || (words.length >= 2 && phraseWithin(words, requested));
                if (!covers)
                    continue;
                if (!best || words.length > best.length)
                    best = { length: words.length, nodes: new Set([node.node_id]) };
                else if (words.length === best.length)
                    best.nodes.add(node.node_id);
            }
        }
        return best && best.nodes.size === 1 ? this.nodes.get([...best.nodes][0])! : null;
    }
    /**
     * What to call a place in front of the Keeper. `displayName` answers with the handle when the
     * module authored no display name, and a handle is a slug: the capsule, the exits and the trail
     * said "newspaper-morgue" for a place the same module calls the Boston Globe offices.
     *
     * Separate from `displayName` on purpose. `displayName` is the graph's naming of any node and is
     * compared against the retired implementation case for case; this is the place layer, and it
     * only ever fills a gap `displayName` was going to answer with the slug.
     */
    placeName(node: Row): string {
        const display = this.displayName(node);
        if (display !== this.handle(node))
            return display;
        const identity = row(destinationIdentity(node));
        return typeof identity.canonical_name === "string" && identity.canonical_name ? identity.canonical_name : display;
    }
    handle(node: Row): string {
        if (this.sourcePlaceNames.has(node.node_id)) return this.sourcePlaceNames.get(node.node_id)!;
        if (this.tableEntityNames.has(node.node_id)) return this.tableEntityNames.get(node.node_id)!;
        if (this.tableNames.has(node.node_id)) return this.tableNames.get(node.node_id)!;
        if (this.tableCreatureNames.has(node.node_id)) return this.tableCreatureNames.get(node.node_id)!;
        if (this.semanticNames.has(node.node_id)) return this.semanticNames.get(node.node_id)!;
        // §185.4: a name-free campaign shows its map's handle, else the interim one; never the book's slug.
        if (this.nodeHandles) return this.nodeHandles.get(node.node_id) ?? this.interimHandle(node);
        return this.bookHandle(node);
    }
    /**
     * A person this table has and the book does not.
     *
     * The record is world state, written by `apply npc` and rehydrated on every load; this is only
     * its projection. It exists because every consumer of a person in this kernel is node-typed --
     * `npcsPresent`, `npcEntry`, `npcView`, the voices lane, continuity, the resolve context, the
     * worldline merge, the continuity audit -- so a person represented any other way reaches none of
     * them. The source snapshot is untouched: `raw` keeps the book, and the module spine gains
     * nothing (contract §14).
     *
     * `id` is minted by the kernel and never travels to the model; `tableNames` makes the handle the
     * name the Keeper used, which is the only identifier a model is given here (contract §2).
     */
    addTablePerson(id: string, name: string, origin: Row = {}): Row {
        const existing = this.nodes.get(id);
        if (existing) return existing;
        const node: Row = {
            node_id: id, node_kind: "npc", name, aliases: [], summary: null, visibility: "keeper-only",
            properties: { name, semantic_name: name, facts: [] },
            campaign_origin: { ...origin, kind: "table" }
        };
        this.nodes.set(id, node);
        this.tableNames.set(id, name);
        this.byKind.set("npc", [...this.kind("npc"), node]);
        for (const key of this.nameKeys(node)) {
            const normalized = normalize(key);
            this.names.set(normalized, new Set([...(this.names.get(normalized) ?? []), id]));
        }
        return node;
    }
    /** A source location is a playable place; preserve its identity and all existing links. */
    projectSourcePlaces(): void {
        const locations = this.kind('location');
        const registered = new Set(this.kind('scene').flatMap(scene => this.nameKeys(scene).map(normalize)));
        const retained: Row[] = [];
        for (const location of locations) {
            // An authored scene already representing this exact place keeps precedence.
            if (this.nameKeys(location).some(name => registered.has(normalize(name)))) { retained.push(location); continue; }
            this.sourcePlaceNames.set(location.node_id, this.handle(location));
            const scene = {...location, node_kind: 'scene', source_kind: 'location'};
            this.nodes.set(location.node_id, scene);
            this.byKind.set('scene', [...this.kind('scene'), scene]);
        }
        if (locations.length) this.byKind.set('location', retained);
    }
    /** Install persisted campaign content without modifying the source graph. */
    addTableEntity(record: Row): Row {
        const id = string(record.id), name = string(record.name), kind = string(record.kind);
        const existing = this.nodes.get(id);
        if (existing) return existing;
        if (!id || !name || !['scene', 'clue'].includes(kind)) throw new RpcError('invalid_params', 'Invalid campaign entity record');
        const node: Row = {node_id: id, node_kind: kind, name, aliases: [], summary: record.summary,
            visibility: 'keeper-only', properties: {name, semantic_name: name}, campaign_origin: {kind: 'table', reason: 'Established during play.', turn: record.turn}};
        this.nodes.set(id, node);
        this.tableEntityNames.set(id, name);
        this.byKind.set(kind, [...this.kind(kind), node]);
        for (const key of this.nameKeys(node)) {
            const normalized = normalize(key);
            this.names.set(normalized, new Set([...(this.names.get(normalized) ?? []), id]));
        }
        // §187.2.1: a minted scene's way back to the scene the party left, and the book place it lies in. A handle the
        // current graph no longer resolves writes no relation; the record keeps it.
        const relate = (to: Row | null, relation_kind: string) => {
            if (!to || to.node_id === id) return;
            const relation = {from_node_id: id, to_node_id: to.node_id, relation_kind, properties: {}, campaign_origin: {kind: 'table'}};
            this.out.set(id, [...(this.out.get(id) ?? []), relation]);
            this.incoming.set(to.node_id, [...(this.incoming.get(to.node_id) ?? []), relation]);
        };
        if (kind === 'scene' && typeof record.within === 'string') relate(this.find(record.within, ['scene', 'location']), 'located-in');
        if (kind === 'scene' && typeof record.from === 'string') relate(this.find(record.from, ['scene']), 'route-to');
        if (kind === 'clue' && record.scene) {
            const scene = this.scene(record.scene);
            const relation = {from_node_id: id, to_node_id: scene.node_id, relation_kind: 'discoverable-at', properties: {}};
            this.out.set(id, [relation]);
            this.incoming.set(scene.node_id, [...(this.incoming.get(scene.node_id) ?? []), relation]);
        }
        return node;
    }
    isTableEntity(node: Row | null | undefined): boolean {
        return !!node && this.tableEntityNames.has(string(node.node_id));
    }
    /** True for a person `apply npc` established at the table rather than the book or a reviewed adaptation. */
    isTablePerson(node: Row | null | undefined): boolean {
        return !!node && this.tableNames.has(string(node.node_id));
    }
    /**
     * Contract §180.6: an animal or monster this table has and the book does not -- the Keeper's yard dog, a mule, a swarm
     * in the cellar. The record is `world.table_creatures`, written by `apply npc` with `walk_on` and `creature` and
     * reinstalled on every load (`read/table-creatures.ts`); this is its projection, exactly as `addTablePerson` is a table
     * person's, except that the node is a `creature`, so no person consumer (`isPerson`, `kind("npc")`) ever meets it.
     * `id` is kernel-minted (`creature-table-<digest>`); the handle is the word the Keeper used.
     */
    addTableCreature(id: string, name: string, origin: Row = {}): Row {
        const existing = this.nodes.get(id);
        if (existing) return existing;
        const node: Row = {
            node_id: id, node_kind: "creature", name, aliases: [], summary: null, visibility: "keeper-only",
            properties: { name, semantic_name: name, facts: [] },
            campaign_origin: { ...origin, kind: "table" }
        };
        this.nodes.set(id, node);
        this.tableCreatureNames.set(id, name);
        this.byKind.set("creature", [...this.kind("creature"), node]);
        for (const key of this.nameKeys(node)) {
            const normalized = normalize(key);
            this.names.set(normalized, new Set([...(this.names.get(normalized) ?? []), id]));
        }
        return node;
    }
    /** True for a creature `apply npc` declared at the table (contract §180.6). */
    isTableCreature(node: Row | null | undefined): boolean {
        return !!node && this.tableCreatureNames.has(string(node.node_id));
    }
    /**
     * Contract §180.6: this creature's stat block is the one the table pinned from the rules catalog
     * (`world.npc_profiles[<handle>]`), so it is an actor (`isActor`) although its node states none. Called where the
     * pin is written (`apply npc creature`) and on every load for a pin already written (`read/table-creatures.ts`).
     */
    pinBody(node: Row | null | undefined): void {
        if (node && node.node_kind === "creature")
            this.pinnedBodies.add(string(node.node_id));
    }
    /**
     * §11.5.8 (SL-67): every person this campaign has established -- table-invented and `from_passage` alike,
     * `establishPerson` makes no distinction between them in `tableNames` -- described the same way `candidates()`
     * describes a book person. Unconditioned by scene or presence: this is the roster itself, not a ranking against
     * any one name, so a person named `unknown_entity` before it can resolve them against the scene's present
     * people (§11.5.6) can also resolve them against this.
     */
    establishedPeople(): Row[] {
        return [...this.tableNames.keys()].map(id => this.describe(this.nodes.get(id)!));
    }
    displayName(node: Row): string {
        for (const key of ["display_name", "name", "title"])
            if (typeof recordOf(node)[key] === "string" && recordOf(node)[key])
                return recordOf(node)[key];
        return typeof node.name === "string" && node.name && node.name.replaceAll(" ", "-") !== node.node_id ? node.name : this.handle(node);
    }
    title(): string {
        return this.moduleNode?.name ? string(this.moduleNode.name) : this.moduleId;
    }
    resolve(name: string, kinds?: string[], what = "entity"): Row {
        // Later source publication cannot steal an established campaign handle.
        const table = [...this.tableEntityNames].filter(([id, label]) => normalize(label) === normalize(name) && (!kinds?.length || kinds.includes(this.nodes.get(id)!.node_kind)));
        if (table.length === 1) return this.nodes.get(table[0][0])!;
        const key = normalize(name),
            wanted = (id: string) => !kinds?.length || kinds.includes(this.nodes.get(id)!.node_kind),
            exact = [...this.nodes.values()].filter(n => wanted(n.node_id) && key === normalize(this.handle(n)));
        if (exact.length === 1)
            return exact[0];
        // §185.4: in a name-free campaign the identifiers a legacy handle used to be (node id, interim handle, old slug) come
        // next, before any name, as the slug did when it was the handle.
        if (this.nodeHandles) {
            const identified = [...this.nodes.values()].filter(n => wanted(n.node_id) && [n.node_id, ...this.inputOnlyKeys(n)].some(value => normalize(value) === key));
            if (identified.length === 1)
                return identified[0];
        }
        const ambiguous = (ids: string[]) => markAmbiguity(new RpcError("unknown_entity", `${what} ${repr(name)} is ambiguous`, {
            fix: "use one of details.candidates by its exact name",
            details: {
                query: name,
                candidates: sorted(ids).map(id => this.describe(this.nodes.get(id)!))
            }
        }), ids);
        // §188.2: the copies of one individual are one candidate, the node that stands for them.
        const ids = this.oneEach([...(this.names.get(key) ?? [])].filter(wanted));
        if (ids.length === 1)
            return this.nodes.get(ids[0])!;
        if (ids.length > 1)
            throw ambiguous(ids);
        // Both exact paths missed. The book prints "Professor Nemesio Sánchez"; the Keeper says
        // "Nemesio Sánchez". No title list exists (the rules forbid one), so the only mechanical
        // bridge is the shape itself: the query's words, in order and unbroken, at one end of a name
        // key (contract section 2). One word is a hint for candidates, not an identity, so a phrase it
        // must be; and one owner it must have, or the ambiguity is reported, never resolved.
        const phrase = key.split(" ");
        if (phrase.length >= 2) {
            const owners = new Set<string>();
            for (const [normalized, holders] of this.names)
                if (phraseWithin(phrase, normalized.split(" ")))
                    for (const id of holders)
                        if (wanted(id))
                            owners.add(id);
            const one = this.oneEach(owners);
            if (one.length === 1)
                return this.nodes.get(one[0])!;
            if (one.length > 1)
                throw ambiguous(one);
        }
        // Last: the place layer. A scene asked for by one of the names its own module gives the
        // place -- or by a part, entrance or counter of it -- is that scene, not an absent
        // destination. Absent is an expensive answer here: `apply move` turns it into
        // `destination_missing`, and `lookup` turns it into "prepare this destination", which
        // minted a second `add_scene` for the Boston Globe on 2026-09-15 while the creator's own
        // reason said "Same building". Only for a caller that asked for scenes, and only after
        // every identifier path has missed, so no handle, alias or phrase match changes meaning.
        if (kinds?.includes("scene")) {
            const place = this.placeOf(name, kinds);
            if (place && wanted(place.node_id))
                return place;
        }
        // §185.3/§188.3: the request showed a word where a name stood -- a person's word for their names, inside longer names and
        // handles too (`<word>-home`), and a joined word for a name several people share. Only after every path above missed is
        // the reference read once more with the rename undone.
        const undone = this.undoRename(name, kinds, what);
        if (undone)
            return undone;
        // A spelling the undo tries and misses is only counted; the ranked candidates are for the Keeper's own miss.
        if (this.undoing)
            throw new RpcError("unknown_entity", `no ${what} named ${repr(name)} in the module graph`);
        throw new RpcError("unknown_entity", `no ${what} named ${repr(name)} in the module graph`, {
            fix: "pick a name from details.candidates or look first",
            details: {
                query: name,
                candidates: this.candidates(name, kinds)
            }
        });
    }
    find(name: string, kinds?: string[]): Row | null {
        try {
            return this.resolve(name, kinds);
        }
        catch (error) {
            if (error instanceof RpcError)
                return null;
            throw error;
        }
    }
    /**
     * §188.3 (amends §185.3): the one retry. Every spelling with the rename undone is resolved as written. The spellings that
     * name exactly one node decide: all the same node, that node; different nodes, the reference is ambiguous. When none names
     * exactly one and some name several, those several are the candidates. The refusal is `resolve`'s own ambiguity
     * (`unknown_entity`, marked, so no caller mints a newcomer under it), with `details.reason: "ambiguous"` and each
     * candidate named by the word the request shows them by -- never a book name.
     */
    private undoRename(name: string, kinds: string[] | undefined, what: string): Row | null {
        if (this.undoing || !this.renameUndo.length)
            return null;
        const spellings = renameUndone(name, this.renameUndo);
        if (!spellings.length)
            return null;
        const found = new Map<string, Row>(), several = new Set<string>();
        this.undoing = true;
        try {
            for (const spelling of spellings) {
                try {
                    // §188.2: a spelling that reaches a copy by its own handle (a legacy slug) is the individual's first node.
                    const [id] = this.oneEach([string(this.resolve(spelling, kinds, what).node_id)]);
                    found.set(id!, this.nodes.get(id!)!);
                }
                catch (error) {
                    if (!(error instanceof RpcError))
                        throw error;
                    for (const id of ambiguities.get(error) ?? [])
                        several.add(id);
                }
            }
        }
        finally {
            this.undoing = false;
        }
        if (found.size === 1)
            return [...found.values()][0];
        const ids = found.size ? [...found.keys()] : [...several];
        if (ids.length < 2)
            return null;
        throw markAmbiguity(new RpcError("unknown_entity", `${what} ${repr(name)} is ambiguous`, {
            fix: "use one of details.candidates by its name; two of them shown by one word are told apart by giving one another word with apply person",
            details: { query: name, reason: "ambiguous", candidates: sorted(ids).map(id => this.shownCandidate(this.nodes.get(id)!)) },
        }), ids);
    }
    /** §188.2: node ids with the copies of one individual counted once, as the node that stands for them; order kept. */
    private oneEach(ids: Iterable<string>): string[] {
        return [...new Set([...ids].map(id => this.individuals.get(id) ?? id))];
    }
    /**
     * §188.3: a candidate of an ambiguous undo as the request shows it -- a book person by their word (`shownWords`), anything
     * else by its handle -- never by the book's name. `name` is what names it in a call: the handle in a name-free campaign,
     * which carries no name (§185.7); the word in a legacy one, whose handles are the book's names as slugs.
     */
    private shownCandidate(node: Row): Row {
        const handle = this.handle(node), shown = this.shownWords.get(string(node.node_id)) ?? handle;
        return { name: this.nameFree ? handle : shown, kind: node.node_kind, shown };
    }
    /**
     * The ranked part of `candidates()` alone -- name overlap, then similarity -- never the roster
     * `candidates()` appends afterwards (contract §11.5.7/SL-64, extended by §11.5.7's SL-70 addendum).
     * `personOfEffect` (`kernel-ts/apply/entities.ts`) consults this to decide whether to *refuse* an
     * unmatched name instead of minting it a table person: the established roster is a list of this
     * table's own people to resolve a name against (§87.4, §11.5.6/SL-62's Jev question), never a count
     * that bars minting a person nobody has named before.
     *
     * `opts.roster === false` excludes this table's own established people from the search *pool*
     * itself, not only from the appended list `candidates()` adds afterwards (SL-70): `addTablePerson`
     * indexes a newly minted person into `this.names` the same way a book name is indexed, so a person
     * this table established -- a moment ago in the very same `apply` batch, or on any earlier turn --
     * is otherwise still found here by name overlap or similarity and mistaken for the book/graph
     * "having something to say", refusing a second, unrelated new name in the same call. Contract
     * §11.5.7's own promise -- that this table's established people are never a bar to minting -- only
     * holds once they are excluded from the ranked pool as well as the appended roster.
     */
    private rankedCandidateIds(name: string, kinds?: string[], limit = 6, opts: { roster?: boolean } = {}): string[] {
        const key = normalize(name),
            pool = new Map<string, string>(),
            ranked: string[] = [];
        for (const [normalized, ids] of this.names)
            for (const id of ids)
                if ((!kinds?.length || kinds.includes(this.nodes.get(id)!.node_kind)) && !pool.has(normalized)
                    && (opts.roster !== false || !this.tableNames.has(id)))
                    pool.set(normalized, id);
        for (const [normalized, id] of pool)
            if (key && (key.includes(normalized) || normalized.includes(key)) && !ranked.includes(id))
                ranked.push(id);
        const close = [...pool.keys()].map(value => [similarity(value, key), value] as const).filter(([score]) => score >= 0.5).sort((a, b) => b[0] - a[0] || compareUnicode(b[1], a[1])).slice(0, limit * 2);
        for (const [, value] of close) {
            const id = pool.get(value)!;
            if (!ranked.includes(id))
                ranked.push(id);
        }
        return ranked;
    }
    candidates(name: string, kinds?: string[], limit = 6, opts: { roster?: boolean } = {}): Row[] {
        const ranked = this.rankedCandidateIds(name, kinds, limit, opts);
        // Last, and only after everything the query itself ranked: the people this table established
        // (see `read/table-people.ts`). A Keeper who has called one man the caretaker, the doorman,
        // superintendent and the janitor makes four of him: deciding those are one person is the open
        // semantic judgement this project forbids and no code here will make it. What a roster does
        // instead is give the Keeper the chance to pick a handle it already used -- a list, not a
        // match. Nothing compares the query to these names; they are appended, so a genuine near-name
        // is never displaced by one. `opts.roster: false` (§11.5.7/SL-64) leaves it off entirely, for the
        // one caller that must not see an established person as a candidate at all: appending it there
        // is what turns "this table has met someone before" into a bar against minting someone new.
        if (opts.roster !== false)
            for (const id of this.tableNames.keys())
                if (!ranked.includes(id) && (!kinds?.length || kinds.includes("npc")))
                    ranked.push(id);
        return ranked.slice(0, limit).map(id => this.describe(this.nodes.get(id)!));
    }
    describe(node: Row): Row {
        return {
            name: this.handle(node),
            kind: node.node_kind,
            display_name: this.displayName(node),
            ...(['object', 'artifact', 'tome'].includes(string(node.node_kind)) && array(node.source_refs).length && !node.campaign_origin
                ? {source_object:this.handle(node)} : {}),
            ...(node.node_kind === "investigator-template" ? { note: TEMPLATE_NOTE } : {})
        };
    }
    scene(name: string): Row {
        return this.resolve(name, ["scene"], "scene");
    }
    scenes(): Row[] {
        return [...this.kind("scene")];
    }
    startScene(): Row {
        const starts = this.scenes().filter(scene => recordOf(scene).is_start === true);
        if (starts.length === 1)
            return starts[0];
        throw new RpcError("campaign_not_ready", `module ${this.moduleId} declares ${starts.length} start scenes`, {
            fix: starts.length ? `module.opening.choose {module_id: ${repr(this.moduleId)}, scene: <one of details.candidates>}` : "the book declares no opening scene; read the section that holds it",
            details: {
                field: "start_scene",
                candidates: (starts.length ? starts : this.scenes()).slice(0, 20).map(scene => ({
                    scene: this.handle(scene),
                    name: this.displayName(scene)
                }))
            },
        });
    }
    sceneByHandle(name: string): Row | null {
        return this.find(name, ["scene"]);
    }
    npc(name: string): Row {
        return this.resolve(name, ["npc"], "npc");
    }
    clue(name: string): Row {
        return this.resolve(name, ["clue"], "clue");
    }
    private exitEntry(to: string, props: Row): Row {
        const result: Row = { to };
        if (integer(props.travel_minutes) || typeof props.travel_minutes === "boolean")
            result.travel_minutes = props.travel_minutes;
        let when = truth(props.when) ? props.when : truth(props.unlock_when) ? props.unlock_when : props.conditions;
        if (!truth(when) && typeof props.flag === "string" && props.flag.trim())
            when = {
                kind: "flag_set",
                flag_id: props.flag
            };
        if (truth(when))
            result.when = when;
        return result;
    }
    sceneExits(scene: Row): Row[] {
        const exits = new Map<string, Row>();
        for (const rel of this.out.get(scene.node_id) ?? []) {
            const target = this.nodes.get(rel.to_node_id);
            if (!EXIT_KINDS.includes(rel.relation_kind) || target?.node_kind !== "scene")
                continue;
            const entry = this.exitEntry(this.handle(target), row(rel.properties));
            if (rel.relation_kind !== "route-to")
                entry.via ??= rel.relation_kind;
            if (!exits.has(entry.to))
                exits.set(entry.to, entry);
        }
        for (const edge of array(recordOf(scene).scene_edges)) {
            const target = typeof edge.to === "string" ? this.find(edge.to, ["scene"]) : null;
            if (!target)
                continue;
            const entry = this.exitEntry(this.handle(target), edge);
            exits.set(entry.to, {
                ...exits.get(entry.to),
                ...Object.fromEntries(entries(entry).filter(([, v]) => v != null))
            });
        }
        return [...exits.values()];
    }
    /**
     * Contract §168.3: the entrance relation (`play-precedes`, `may-lead-to`, `alternative-to`, `hands-off-to` -- the
     * template's `entrance_relation_kinds`, the book's playing order) that leads from `from` to `to`, or null when the
     * two are joined only by `route-to` (travel between places) or not at all.
     */
    entranceRelation(from: Row, to: Row): string | null {
        const rel = (this.out.get(from.node_id) ?? []).find(rel => rel.to_node_id === to.node_id && rel.relation_kind !== "route-to" && EXIT_KINDS.includes(rel.relation_kind));
        return rel ? string(rel.relation_kind) : null;
    }
    sceneEndings(scene: Row): Row[] {
        const seen = new Set<string>(),
            result: Row[] = [];
        for (const rel of this.out.get(scene.node_id) ?? []) {
            const node = this.nodes.get(rel.to_node_id);
            if (!node || node.node_kind !== "ending" || seen.has(node.node_id))
                continue;
            if (result.length >= 4)
                break;
            seen.add(node.node_id);
            const line = chars(words(node.summary || ""), 140),
                name = this.displayName(node);
            result.push({
                name,
                via: rel.relation_kind,
                ...(line && line !== name ? { line } : {})
            });
        }
        return result;
    }
    sceneDanglingExits(scene: Row): string[] {
        return [...new Set((this.out.get(scene.node_id) ?? []).filter(rel => EXIT_KINDS.includes(rel.relation_kind) && !this.nodes.has(string(rel.to_node_id))).map(rel => string(rel.to_node_id)))];
    }
    sceneClueIds(scene: Row): string[] {
        return [...new Set([...array(recordOf(scene).available_clues), ...(this.incoming.get(scene.node_id) ?? []).filter(r => r.relation_kind === "discoverable-at").map(r => r.from_node_id)].filter(id => this.nodes.get(id)?.node_kind === "clue"))];
    }
    sceneNpcIds(scene: Row): string[] {
        return [...new Set([...(this.incoming.get(scene.node_id) ?? []).filter(r => r.relation_kind === "present-in").map(r => r.from_node_id), ...array(recordOf(scene).npc_ids)].filter(id => this.isActor(this.nodes.get(id))))];
    }
    /** The scene's assets; a handout already handed over says so (`shown`, from the world's `handouts_shown`; §135.2). */
    sceneAssets(scene: Row, shown: readonly unknown[] = []): Row[] {
        return this.sceneAssetNodes(scene).map(node => ({
            name: this.displayName(node),
            kind: node.node_kind,
            ...(node.node_kind === "handout" && shown.includes(this.handle(node)) ? { shown: true } : {})
        }));
    }
    /** The nodes behind `sceneAssets`: what the scene, or the place it occurs at, depicts or holds (never a clue). */
    sceneAssetNodes(scene: Row): Row[] {
        const links = [...(this.incoming.get(scene.node_id) ?? [])],
            seen = new Set<string>(),
            result: Row[] = [];
        for (const rel of this.out.get(scene.node_id) ?? [])
            if (rel.relation_kind === "occurs-at")
                links.push(...(this.incoming.get(rel.to_node_id) ?? []).filter(r => r.relation_kind === "depicts"));
        for (const rel of links) {
            // §152.4: a printed visual the reviewer found to be a variant is listed as the print it stands for.
            const found = this.nodes.get(rel.from_node_id), node = found ? this.survivorOf(found) : undefined;
            if (!["depicts", "discoverable-at", "located-in"].includes(rel.relation_kind) || !node || node.node_kind === "clue" || this.isTableEntity(node) || seen.has(node.node_id))
                continue;
            seen.add(node.node_id);
            result.push(node);
        }
        // §39.4: a map of a place this scene lies in is a map of this scene too -- the same maps
        // arrival presents (`mapsForScene`), so the Keeper and the player are handed one list.
        for (const place of this.placesOutward(scene).slice(1))
            for (const rel of this.incoming.get(place) ?? []) {
                const found = this.nodes.get(rel.from_node_id), node = found ? this.survivorOf(found) : undefined;
                if (rel.relation_kind !== "depicts" || !node || seen.has(node.node_id) || !array(row(node.properties).map_regions).length)
                    continue;
                seen.add(node.node_id);
                result.push(node);
            }
        return result;
    }
    /**
     * Contract §39.4: the scene, then the places it occurs at, then every place those lie in by
     * `located-in`, walking outward. Nearest first, each node once, at most eight steps out.
     */
    placesOutward(scene: Row): string[] {
        const places = [scene.node_id as string], seen = new Set(places);
        let frontier: string[] = [];
        for (const rel of this.out.get(scene.node_id) ?? [])
            if (rel.relation_kind === "occurs-at" && !seen.has(rel.to_node_id)) { seen.add(rel.to_node_id); places.push(rel.to_node_id); frontier.push(rel.to_node_id); }
        frontier = [scene.node_id, ...frontier];
        for (let step = 0; step < 8 && frontier.length; step++) {
            const next: string[] = [];
            for (const id of frontier)
                for (const rel of this.out.get(id) ?? [])
                    if (rel.relation_kind === "located-in" && !seen.has(rel.to_node_id)) { seen.add(rel.to_node_id); places.push(rel.to_node_id); next.push(rel.to_node_id); }
            frontier = next;
        }
        return places;
    }
    private listedNodes(ids: string[], extra: (node: Row) => Row = () => ({})): Row[] {
        const seen = new Set<string>(),
            result: Row[] = [];
        for (const id of ids) {
            const node = this.nodes.get(id);
            if (!node || seen.has(id))
                continue;
            seen.add(id);
            const line = words(node.summary || ""),
                name = this.displayName(node);
            result.push({
                name,
                ...(line && line !== name ? { line } : {}),
                ...extra(node)
            });
        }
        return result;
    }
    scenePlaces(scene: Row): Row[] {
        return this.listedNodes((this.out.get(scene.node_id) ?? []).filter(r => r.relation_kind === "occurs-at").flatMap(r => (this.incoming.get(r.to_node_id) ?? []).filter(inner => inner.relation_kind === "located-in").map(inner => inner.from_node_id)));
    }
    /** The scene's `uses-rule` rows; `extra` adds the keys a caller projects from each node (the capsule's `mech`, §136.11). */
    sceneRules(scene: Row, extra?: (node: Row) => Row): Row[] {
        return this.listedNodes(this.ruleNodes(scene).map(node => node.node_id), extra);
    }
    /** The nodes a node links by `uses-rule`, in relation order. */
    ruleNodes(node: Row): Row[] {
        return (this.out.get(node.node_id) ?? []).filter(r => r.relation_kind === "uses-rule").map(r => this.nodes.get(r.to_node_id)).filter((target): target is Row => !!target);
    }
    /**
     * Contract §136.17: the `reward` shapes of the rule nodes a conclusion scene or an ending links by `uses-rule`,
     * each as `{rule, ...the typed reward}` without its `book` line.
     */
    statedRewards(node: Row): Row[] {
        const seen = new Set<string>();
        return this.ruleNodes(node).flatMap(rule => {
            const reward = this.mechanicsOf(rule).reward;
            if (!reward || seen.has(rule.node_id))
                return [];
            seen.add(rule.node_id);
            const { book: _book, ...typed } = reward;
            return [{ rule: this.handle(rule), ...typed }];
        });
    }
    /**
     * Contract §136.10: the node's mechanical shapes -- the only reader of `mechanics`. Each key of the record's
     * container that the catalog seats on this node's kind and whose value is an object; nothing else (the
     * starters' legacy provenance keys, an unknown key, a shape on the wrong kind). A `spell` node without a typed
     * `mechanics.spell` answers its flat `cost_*` properties as its spell: the registered seat's legacy form,
     * bridged here and nowhere else, as `clueProfile` bridges the clue gate.
     */
    mechanicsOf(node: Row | null | undefined): Row {
        if (!node)
            return {};
        const container = row(recordOf(node).mechanics), kind = string(node.node_kind), shapes: Row = {};
        for (const [key, value] of entries(container))
            if (Object.hasOwn(SHAPE_KINDS, key) && SHAPE_KINDS[key].includes(kind) && isJsonObject(value))
                shapes[key] = value;
        if (kind === "spell" && !shapes.spell) {
            const flat = pick(row(node.properties), ["cost_mp", "cost_sanity", "cost_pow"]);
            if (Object.keys(flat).length)
                shapes.spell = flat;
        }
        return shapes;
    }
    /**
     * Contract §136.12: a body the engine acts with or against -- an `npc`, or a `creature` that states a stat
     * block. A creature without one is scenery to the engine, exactly as before shapes existed.
     */
    isActor(node: Row | null | undefined): boolean {
        if (!node)
            return false;
        const profile = node.node_kind === "creature" ? this.mechanicsOf(node).profile : null;
        // §180.6: a creature whose stat block this table pinned from the rules catalog is one too.
        return node.node_kind === "npc" || !!profile || this.pinnedBodies.has(string(node.node_id));
    }
    /**
     * Contract §180.3: a being the Keeper plays as a person -- an `npc` node, the book's or the table's. Every person
     * feature (an epithet, the untold block, a voice, the journal, social offers, a personality) selects by this, never
     * by `isActor`: a creature with a stat block is an actor and no person. Read from `node_kind` alone (§180.2).
     */
    isPerson(node: Row | null | undefined): boolean {
        return !!node && node.node_kind === "npc";
    }
    /**
     * The actor of that name: the `npc` first, so a creature never shadows a person of the same handle. Since §180.7 the
     * npc-first order is only the tie-break for a compile snapshot that carries one being as both kinds.
     */
    actor(name: string): Row | null {
        const person = this.find(name, ["npc"]);
        if (person)
            return person;
        const creature = this.find(name, ["creature"]);
        return creature && this.isActor(creature) ? creature : null;
    }
    threatClock(threat: Row, clockId: string): Row | null {
        return array(recordOf(threat).clocks).map(row).find(clock => [clock.clock_id, clock.id, clock.name].some(value => typeof value === "string" && normalize(value) === normalize(clockId))) ?? null;
    }
    sceneBeat(scene: Row): Row | null {
        // A beat names its scene by the book's slug, which in a name-free campaign (§185.4) is no longer the scene's handle.
        return this.kind("beat").map(recordOf).find(r => r.scene_id === this.handle(scene) || (this.nodeHandles !== null && r.scene_id === this.bookHandle(scene))) ?? null;
    }
    /** Canonical clue-owned metadata, with the old conclusion table retained as a fallback. */
    clueProfile(node: Row): Row {
        const legacy: Row = {};
        for (const conclusion of this.kind('conclusion'))
            for (const entry of array(recordOf(conclusion).clues))
                if (entry.clue_id === node.node_id) Object.assign(legacy, entry);
        return {...legacy, ...recordOf(node), ...Object.fromEntries(entries(row(node.properties)).filter(([key]) => key !== 'runtime_projection'))};
    }
    clueView(node: Row): Row {
        return {
            name: this.handle(node),
            summary: node.summary || node.name || null,
            delivery_kind: this.clueProfile(node).delivery_kind ?? null
        };
    }
    actorProfile(node: Row): Row {
        const props = row(node.properties),
            nested = row(this.mechanicsOf(node).profile),
            characteristics: Row = {},
            skills: Row = {},
            flat: Row = {};
        for (const [key, value] of entries(props))
            if (integer(value))
                (CHARACTERISTICS.has(key.toUpperCase()) ? characteristics : DERIVED.has(key.toUpperCase()) ? flat : skills)[key] = value;
        for (const [key, value] of entries(row(props.skills)))
            if (integer(value))
                skills[key] = value;
        for (const [name, target] of [["characteristics", characteristics], ["skills", skills]] as const)
            for (const [key, value] of entries(row(nested[name])))
                if (integer(value) && !Object.hasOwn(target, key))
                    target[key] = value;
        return {
            characteristics,
            skills,
            derived: {
                ...flat,
                ...row(nested.derived)
            },
            ...pick(nested, ["attacks", "attacks_per_round", "weapons", "spells", "armor_rule", "san_loss_to_see"])
        };
    }
    actorSkillValue(node: Row, skill: string): number | null {
        const profile = this.actorProfile(node),
            key = normalize(skill);
        for (const table of ["skills", "characteristics"])
            for (const [name, value] of entries(profile[table]))
                if (normalize(name) === key)
                    return Number(value);
        return null;
    }
    npcProfile(node: Row): Row {
        const profile: Row = {};
        for (const key of dossierKeys(this.dossier)) {
            let value = row(node.properties)[key];
            if (!(typeof value === "string" && value.trim()) && !lines(value))
                value = recordOf(node)[key];
            if (typeof value === "string" && value.trim())
                profile[key] = value.trim();
            // A `shape: "lines"` word (§40.5, §40.7) is authored as a short list of lines: a mask of one, exchanges of three.
            else if (lines(value))
                profile[key] = value.map((line: string) => line.trim());
        }
        return profile;
    }
    /** Contract §180.8: the creature's spine, the counterpart of `dossier` -- empty when the module bound no creature word. */
    creatureDossier(): Row {
        return row(this.dossier.creature_dossier);
    }
    /** Contract §180.8: what the book says of a creature under the words its module was built with, read as `npcProfile`
     *  reads a person's: the authored property, else the record's, one line each. A key the module never bound is absent. */
    creatureProfile(node: Row): Row {
        const profile: Row = {};
        for (const key of dossierKeys(this.creatureDossier())) {
            let value = row(node.properties)[key];
            if (!(typeof value === "string" && value.trim()))
                value = recordOf(node)[key];
            if (typeof value === "string" && value.trim())
                profile[key] = value.trim();
        }
        return profile;
    }
    /** Contract §180.9: whether this module was built with `actor.weaknesses.v1` bound (its provenance says so). */
    weaknessesBound(): boolean {
        return this.dossier.actor_weaknesses === true;
    }
    /** Contract §180.9: the stated weakness entries of an npc or creature, as authored (`properties.weaknesses`, else the
     *  record's), only when the module bound the shape; each an object with a `book` line. */
    authoredWeaknesses(node: Row): Row[] {
        if (!this.weaknessesBound() || !["npc", "creature"].includes(string(node.node_kind)))
            return [];
        const value = Array.isArray(row(node.properties).weaknesses) ? node.properties.weaknesses : recordOf(node).weaknesses;
        return array(value).filter(entry => isJsonObject(entry) && typeof entry.book === "string" && entry.book.trim()).map(row);
    }
    /** Contract §180.9: the clues whose belief about this being is false (`clue --misleads--> npc|creature`). */
    misleadingClues(node: Row): Row[] {
        const seen = new Set<string>();
        return (this.incoming.get(node.node_id) ?? []).flatMap(rel => {
            const clue = this.nodes.get(rel.from_node_id);
            if (rel.relation_kind !== "misleads" || clue?.node_kind !== "clue" || seen.has(clue.node_id))
                return [];
            seen.add(clue.node_id);
            return [clue];
        });
    }
    /** The clues that support a conclusion (`clue --supports--> conclusion`), the reading `thread.ts` counts. */
    supportingClues(conclusion: Row): Row[] {
        return (this.incoming.get(conclusion.node_id) ?? [])
            .filter(rel => rel.relation_kind === "supports" && this.nodes.get(rel.from_node_id)?.node_kind === "clue")
            .map(rel => this.nodes.get(rel.from_node_id)!);
    }
    npcClaims(node: Row, predicate: string): Row[] {
        return (this.claimsBySubject.get(node.node_id) ?? []).filter(c => c.predicate === predicate);
    }
    npcKnows(node: Row): Array<{
        node: Row;
        handle: string;
        origin?: Row;
    }> {
        const ids = [...this.npcClaims(node, "knows").map(c => row(c.object).node_id), ...array(recordOf(node).facts).map(f => f.clue_id)],
            seen = new Set<string>();
        return ids.flatMap(id => {
            const target = this.nodes.get(id);
            if (!target || seen.has(id))
                return [];
            seen.add(id);
            return [{
                    node: target,
                    handle: this.handle(target),
                    ...(this.adaptationOrigin(array(recordOf(node).facts).find(f => f.clue_id === id)?.campaign_origin)
                        ? {origin: this.adaptationOrigin(array(recordOf(node).facts).find(f => f.clue_id === id)?.campaign_origin)!} : {})
                }];
        });
    }
    claimLines(claims: Row[]): string[] {
        return claims.flatMap(claim => {
            const object = row(claim.object),
                target = this.nodes.get(object.node_id);
            let line = target?.node_kind === "npc" ? claim.reason || claim.statement : target ? target.summary || target.name : null;
            for (const key of ["statement", "text", "value"])
                if (!(typeof line === "string" && line.trim()) && typeof object[key] === "string")
                    line = object[key];
            if (!(typeof line === "string" && line.trim()) && typeof claim.statement === "string")
                line = claim.statement;
            return typeof line === "string" && line.trim() ? [line.trim()] : [];
        });
    }
    npcClaimLines(node: Row, predicate: string): string[] {
        return this.claimLines(this.npcClaims(node, predicate));
    }
    authoredLines(node: Row, key: string): string[] {
        const value = row(node.properties)[key];
        return (typeof value === "string" ? [value] : array(value)).filter(v => typeof v === "string" && v.trim()).map(v => v.trim());
    }
    npcBeliefs(node: Row): string[] {
        return [...new Set([...this.npcClaimLines(node, "believes"), ...this.authoredLines(node, "beliefs"), ...this.claimLines(this.npcClaims(node, "asserts").filter(c => c.truth_status === "authored-belief"))])];
    }
    npcWouldSay(node: Row): string[] {
        return [...new Set([...this.claimLines(this.npcClaims(node, "asserts").filter(c => ["authored-lie", "authored-rumor"].includes(c.truth_status))), ...this.authoredLines(node, "lies"), ...array(row(node.properties).deflect_lines).map(v => typeof v === "string" ? v : row(v).line).filter(v => typeof v === "string" && v.trim()).map(v => v.trim())])];
    }
    npcsKnowing(node: Row): string[] {
        return this.kind("npc").filter(npc => this.npcKnows(npc).some(entry => entry.node.node_id === node.node_id)).map(npc => npc.node_id);
    }
    npcHasMaterial(node: Row): boolean {
        // Core words only, matching `npcs_without_material`: a book silent about a package's key must
        // not report every actor in it as thin, and a key only a package asked for must not stand in
        // for the material the book itself owes an actor (contract 28.5).
        const profile = this.npcProfile(node), core = array(this.dossier.profile_keys).some(key => truth(profile[string(key)]));
        return core || array(this.dossier.claim_predicates).some(predicate => this.npcClaims(node, predicate).length > 0) || truth(recordOf(node).facts);
    }
    npcTies(node: Row): Row[] {
        const result: Row[] = [],
            seen = new Set<string>();
        for (const [rel, id] of [...(this.out.get(node.node_id) ?? []).map(r => [r, r.to_node_id]), ...(this.incoming.get(node.node_id) ?? []).map(r => [r, r.from_node_id])] as [
            Row,
            string
        ][]) {
            const target = this.nodes.get(id),
                key = canonicalJson([rel.relation_kind, id]);
            if (!array(this.dossier.tie_relation_kinds).includes(rel.relation_kind) || !target || rel.from_node_id === rel.to_node_id || seen.has(key))
                continue;
            seen.add(key);
            result.push({
                kind: rel.relation_kind,
                to: this.displayName(target),
                node: target
            });
        }
        return result;
    }
    search(query: string, limit = 8): Row[] {
        const key = normalize(query);
        if (!key)
            return [];
        const exact: Row[] = [],
            names: Array<[
            number,
            number,
            Row
        ]> = [],
            summaries: Row[] = [];
        [...this.nodes.values()].forEach((node, order) => {
            if (!this.isTableEntity(node) && [...this.tableEntityNames].some(([id, name]) => this.nodes.get(id)!.node_kind === node.node_kind && normalize(name) === normalize(node.name))) return;
            const keys = this.searchKeys(node).map(normalize);
            if (keys.includes(key))
                exact.push(node);
            else {
                const hits = keys.filter(k => k.includes(key));
                if (hits.length)
                    names.push([Math.min(...hits.map(k => Array.from(k).length)), order, node]);
                else if (normalize(node.summary || "").includes(key) || normalize(this.prose(node)).includes(key))
                    summaries.push(node);
            }
        });
        names.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        return [...exact, ...names.map(n => n[2]), ...summaries].sort((a, b) => Number(a.node_kind === "investigator-template") - Number(b.node_kind === "investigator-template")).slice(0, limit);
    }
    /**
     * Contract §127.1: a query that is two or more words, each exactly a node's handle or node id,
     * names those nodes in the order given. The Keeper holds these handles from its capsule and
     * receipts (`knott-macario-summary knott-keys`); `search` reads the whole string as one name and
     * finds nothing. Identifier grammar only: one word that is not an exact handle makes the whole
     * query ordinary search text (null), never a partial list.
     */
    handleList(query: string): Row[] | null {
        const words = query.split(/[\s,]+/).filter(Boolean);
        if (words.length < 2)
            return null;
        const nodes: Row[] = [];
        for (const word of words) {
            const key = normalize(word),
                matches = [...this.nodes.values()].filter(node => [node.node_id, this.handle(node), ...this.inputOnlyKeys(node)].some(value => normalize(value) === key));
            if (!matches.length)
                return null;
            // A handle two nodes share (`knott-commission` is a clue and a quest) answers with both,
            // exactly as `search` does when that handle is the whole query.
            for (const node of matches)
                if (!nodes.includes(node))
                    nodes.push(node);
        }
        return nodes;
    }
    prose(node: Row): string {
        for (const key of ["prose", "description", "note", "summary"])
            if (typeof recordOf(node)[key] === "string")
                return recordOf(node)[key];
        return "";
    }
    summary(node: Row): string {
        return this.prose(node) || node.summary || node.name || "";
    }
    relationsOf(node: Row, limit = 12): Row[] {
        const result: Row[] = [];
        for (const rel of this.out.get(node.node_id) ?? []) {
            const target = this.nodes.get(rel.to_node_id);
            if (target)
                result.push({
                    kind: rel.relation_kind,
                    to: this.handle(target),
                    ...(this.adaptationOrigin(rel.campaign_origin) ? {origin: this.adaptationOrigin(rel.campaign_origin)} : {})
                });
        }
        for (const rel of this.incoming.get(node.node_id) ?? []) {
            const source = this.nodes.get(rel.from_node_id);
            if (source && ["present-in", "discoverable-at", "located-in", "supports"].includes(rel.relation_kind))
                result.push({
                    kind: rel.relation_kind,
                    from: this.handle(source),
                    ...(this.adaptationOrigin(rel.campaign_origin) ? {origin: this.adaptationOrigin(rel.campaign_origin)} : {})
                });
        }
        return result.slice(0, limit);
    }
    entityView(node: Row): Row {
        return {
            name: this.handle(node),
            display_name: this.displayName(node),
            ...(['object', 'artifact', 'tome'].includes(string(node.node_kind)) && array(node.source_refs).length && !node.campaign_origin
                ? {source_object:this.handle(node)} : {}),
            kind: node.node_kind,
            summary: this.summary(node),
            ...(this.sourceMappings(node).length?{source_mappings:this.sourceMappings(node),source_mapping_note:'Established campaign values remain canonical; these source differences are mappings, not retcon instructions.'}:{}),
            ...(this.sourceNeeds(node).length?{source_needs:this.sourceNeeds(node)}:{}),
            ...(destinationIdentity(node) ? { destination_identity: destinationIdentity(node) } : {}),
            ...(destinationAccess(node) ? { destination_access: destinationAccess(node) } : {}),
            properties: Object.fromEntries(entries(row(node.properties)).filter(([k]) => !["runtime_projection", "asset_ref"].includes(k))),
            visibility: node.visibility ?? null,
            relations: this.relationsOf(node),
            ...(this.adaptationOrigin(node.campaign_origin) ? {origin: this.adaptationOrigin(node.campaign_origin)} : {}),
            ...(node.node_kind === "investigator-template" ? { note: TEMPLATE_NOTE } : {})
        };
    }
    sourceMappings(node:Row):Row[]{
        const result:Row[]=[],prefix='/nodes/'+node.node_id+'/';
        const shown=(value:JsonValue|undefined)=>{const text=canonicalJson(value??null);return text.length>1200?{truncated:true,preview:text.slice(0,1200)}:value;};
        for(const item of array(this.raw.source_mappings)){
            if(typeof item.path!=='string')continue;
            let field:string|undefined,relation:Row|undefined;
            if(item.path.startsWith(prefix))field=item.path.slice(prefix.length);
            else{
                const match=/^\/claims\/([^/]+)\/(.*)$/.exec(item.path);
                const claim=match?array(this.raw.claims).find(row=>row.claim_id===match[1]):undefined;
                if(!claim||![claim.subject_id,row(claim.object).node_id,item.source_value].includes(node.node_id))continue;
                field=match![2];
                const subject=this.nodes.get(claim.subject_id),object=this.nodes.get(row(claim.object).node_id);
                relation={subject:subject?this.handle(subject):null,predicate:claim.predicate,object:object?this.handle(object):null};
            }
            const value=(value:JsonValue|undefined)=>relation&&['subject_id','object/node_id'].includes(field!)&&typeof value==='string'&&this.nodes.has(value)
                ?this.handle(this.nodes.get(value)!):shown(value);
            result.push({field,...(relation?{relation}:{}),established_value:value(item.established_value),source_value:value(item.source_value),source_refs:item.source_refs});
        }
        return result.slice(-8);
    }
    sourceNeeds(node:Row,runtimeOnly=false):Row[]{
        return array(this.raw.source_needs).filter(need=>need.node_id===node.node_id&&(!runtimeOnly||need.kind==='runtime_context'))
            .map(need=>({kind:need.kind,focus:this.handle(node),question:need.question,reason:need.reason,trigger:need.trigger,source_refs:need.source_refs}));
    }
    adaptationOrigin(value: any): Row | null {
        if (!value || typeof value !== 'object') return null;
        // A table person's origin is not gated on `campaignView`: they exist on a plain source load
        // too, because a table can establish one before it has ever run an adaptation. Saying which
        // of the three -- book, reviewed adaptation, table -- a person came from is the whole point
        // of the row, and the answer must never be silently "the book".
        if (string(value.kind) === 'table')
            return {kind: 'table', reason: chars(string(value.reason), 400), turn: value.turn ?? null};
        if (!this.campaignView) return null;
        return {kind: 'campaign_adaptation', reason: chars(string(value.reason), 400),
            sources: array(value.sources).flatMap(id => {const node = this.nodes.get(id); return node ? [{kind: node.node_kind, name: node.name}] : [];})};
    }
    /**
     * Contract §152.4: the `variant-of` hops a printed-visual node takes toward the node it stands for. Only a relation
     * from one visual node (`asset` or `handout`) to another counts; a node with several takes the first in relation
     * order. The walk stops at a node with no such relation, before revisiting a node, or after `VARIANT_STEPS` hops.
     */
    private variantWalk(node: Row): { path: Row[]; hops: Row[]; cycle: number } {
        const path: Row[] = [node], hops: Row[] = [], seen = new Set<string>([string(node.node_id)]);
        if (!VISUAL_KINDS.includes(node.node_kind)) return { path, hops, cycle: -1 };
        let current = node;
        for (let step = 0; step < VARIANT_STEPS; step++) {
            const hop = (this.out.get(string(current.node_id)) ?? []).find(rel => rel.relation_kind === "variant-of"
                && VISUAL_KINDS.includes(this.nodes.get(string(rel.to_node_id))?.node_kind) && rel.to_node_id !== current.node_id);
            if (!hop) return { path, hops, cycle: -1 };
            const next = this.nodes.get(string(hop.to_node_id))!;
            if (seen.has(string(next.node_id))) return { path, hops: [...hops, hop], cycle: path.findIndex(item => item.node_id === next.node_id) };
            seen.add(string(next.node_id));
            path.push(next);
            hops.push(hop);
            current = next;
        }
        return { path, hops, cycle: -1 };
    }
    /**
     * Contract §152.4: the node a printed-visual variant stands for, following `variant-of` to the node that is not one.
     * Where the relations close a cycle, the cycle's first node in node-id order stands for all of it, so the survivor of a
     * survivor is itself. Any node that is not a variant (a scene, a person, a map nobody linked) is its own survivor.
     */
    survivorOf(node: Row): Row {
        const walk = this.variantWalk(node);
        if (walk.cycle < 0) return walk.path[walk.path.length - 1];
        return [...walk.path.slice(walk.cycle)].sort((a, b) => compareUnicode(string(a.node_id), string(b.node_id)))[0];
    }
    /** Contract §152.4: a printed visual the reviewer found to be the same print as another; map and handout readers skip it. */
    isVariant(node: Row): boolean {
        return this.survivorOf(node).node_id !== node.node_id;
    }
    /**
     * Contract §152.4: which region of `survivor` each region of `variant` is, as the reviewer matched them on the
     * pixels (`properties.region_correspondence` on each `variant-of` hop between them, composed along the way). A region
     * the reviewer did not match is absent: two crops never share coordinates by assumption (session-maps Decision 5).
     * Empty when `survivor` is not where `variant` leads or when no hop carries a correspondence.
     */
    regionCorrespondence(variant: Row, survivor: Row): Record<string, string> {
        if (variant.node_id === survivor.node_id) return {};
        // A survivor inside a cycle is still on the path: the walk lists every node once before it would revisit one.
        const walk = this.variantWalk(variant), end = walk.path.findIndex((node, index) => index > 0 && node.node_id === survivor.node_id);
        if (end <= 0) return {};
        let mapped: Record<string, string> | null = null;
        for (const hop of walk.hops.slice(0, end)) {
            const step = row(row(hop.properties).region_correspondence), next: Record<string, string> = {};
            for (const [from, to] of mapped ? entries(mapped) : entries(step).map(([key]) => [key, key] as [string, string]))
                if (typeof step[to] === "string") next[from] = step[to];
            mapped = next;
            if (!Object.keys(mapped).length) return {};
        }
        return mapped ?? {};
    }
    /** Contract §152.4: a visual node's handle read through its survivor; a handle no visual node carries stays as it is. */
    survivorHandle(handle: string): string {
        const node = [...this.nodes.values()].find(item => VISUAL_KINDS.includes(item.node_kind) && this.handle(item) === handle);
        return node ? this.handle(this.survivorOf(node)) : handle;
    }
    /**
     * Contract §152.4: `world.handouts_shown` read through survivors -- a handout shown under a variant's handle counts as
     * shown for its survivor -- in the order first shown, each survivor once.
     */
    shownThroughSurvivors(shown: readonly unknown[]): string[] {
        const out: string[] = [];
        for (const value of shown) {
            if (typeof value !== "string" || !value) continue;
            const handle = this.survivorHandle(value);
            if (!out.includes(handle)) out.push(handle);
        }
        return out;
    }
}
/** Contract §152.4: the node kinds a printed visual is published as, the only ends a `variant-of` hop is read between. */
const VISUAL_KINDS: readonly string[] = ["asset", "handout"];
/** Contract §152.4: the most `variant-of` hops a survivor walk takes. */
const VARIANT_STEPS = 64;
