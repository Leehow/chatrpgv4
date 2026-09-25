/**
 * People this table has and the book does not.
 *
 * Twenty of them spoke on H-SIDE t4 (`homes/t4`, campaign game-1c0faba5, 121 turns): a reception
 * nurse, a parish clerk, a building superintendent, four municipal window clerks. They carried 60 of
 * that table's 270 spoken spans across 22 turns, and not one of them existed. `speech.who` already
 * degrades to `{label}` for them (contract §40) and `resolve` already accepts one as
 * `action.target` and rolls against it, because `npcTarget` reads through `graph.find`, which
 * answers null and falls through. Only `apply npc` and `look focus=npc` refused, so
 * `world.npc_presence` never held one, the ledger never held one, and the capsule's `present` and
 * `voices` were `[]` for the whole of turns 96-99 while a superintendent unlocked a cellar, answered
 * three questions, took a card and left in prose. Turn 98 closed with zero receipts and four
 * label-only spans naming the doorman: the only two world writes that turn wanted were his
 * presence and his stance, and both were refused.
 *
 * Refusing the request did not prevent a fabrication. On turn 106, refused on an assessors'-window
 * clerk, the Keeper reached for the book's own `records-clerk` and staged the Hall of Records clerk
 * at the assessors' window instead -- and that was accepted. A refusal with no lawful alternative
 * moves the write onto an authored person's record; it does not stop it.
 *
 * **The record is world state.** Adaptation is the other road and it is not this one: it costs a
 * reviewed proposal and a turn of the table's time, which is the right price for a place or a person
 * the campaign will keep, and far too much for someone who says three lines and goes. The boundary
 * is mechanical and carries no judgement about who matters: a person is persistent when the Keeper
 * called for persistence (`lookup kind=adaptation purpose=persistent_npc`), and a person the table
 * simply used is this. Nothing here reads a name, a role or a description to decide anything.
 *
 * The module spine is untouched (contract §14). The pinned source snapshot stays immutable and
 * `raw` keeps the book; a table person is a projection installed over a loaded graph, in the same
 * position the adaptation overlay already occupies, and it is rebuilt from `world` on every load.
 *
 * **What the Keeper hands in is an appellation, not necessarily a name, and this never asks for
 * one.** Very often there is no name to give: what a Keeper has for the person behind the records
 * counter is "the clerk at the archive window", and a write entrance that demanded a personal name
 * would be asking the Keeper to invent one, which is a fabrication the table never made. So any
 * non-empty string the Keeper is already using is the identity, and nothing here inspects it.
 *
 * That leaves the player-facing word to §79, where it already belongs: `personLabel` prefers
 * `world.person_labels` over the graph's own word for everyone, so `apply person` is what puts a
 * person's name on a card in the play language, whether the graph got them from the book or from
 * here. The book needs that road as badly as the table does -- the-haunting authors an NPC whose
 * printed name is `the Hall of Records clerk`, an English description, and on H-SIDE t4 (a zh-Hans
 * table) it is what every surface naming him carried through 47 resolved spans. Not the prose: the
 * say token strips the name out, so the prose called him by his sleeve-guards. It is the card's own
 * word for him -- §40's delivery card titles each span with the name through `term()` -- and the
 * sheet panel's. `world.person_labels` was `null` for all 121 turns: §79's writer exists and nothing ever
 * sent the Keeper to it.
 */
import { jsonDigest } from '../json.js';
import type { LoadedModule } from './campaign.js';
import type { ModuleGraph } from './module-graph.js';
import { isJsonObject } from '../json.js';
import { array, integer, normalize, row, string, type Row } from './values.js';

/** Minted by the kernel, never copied by the Keeper: the handle is the name they used. */
export const tablePersonId = (name: string): string => `npc-table-${jsonDigest(normalize(name)).slice(0, 20)}`;

/** The people to install: every entry with a name, except one a book person has replaced (§11.5.4). */
export function tablePeople(world: Row): Row[] {
    return array(world.table_people).map(row).filter(person => !!string(person.name).trim() && !person.replaced_by);
}

/** Rehydrate the world's record onto a loaded graph. Idempotent: `addTablePerson` keeps the first. */
export function installTablePeople(graph: ModuleGraph, world: Row): ModuleGraph {
    for (const person of tablePeople(world)) {
        const name = string(person.name).trim();
        graph.addTablePerson(tablePersonId(name), name, { reason: string(person.why), turn: person.turn ?? null,
            ...(isJsonObject(person.from_passage) ? { from_passage: person.from_passage } : {}) });
    }
    return graph;
}

/**
 * §11.5.4 (SL-51): the comparison a carried passage and a person's name meet under. The kernel's own name normalization
 * (§2), then no whitespace at all: a page's line breaks are layout, and the book breaks a name across two lines. Exact
 * after that -- no near name, no alias, nothing about a language.
 */
export const passageKey = (value: unknown): string => normalize(value).replace(/\s+/gu, '');

/**
 * §11.5.4: the host's `_passage` on an `npc`/`person` effect, when its sentence holds `name`, as the record keeps it; else
 * null (absent, malformed, or a sentence that does not hold the name all count as absent). The host strips any `_passage`
 * a model sent, so only the host's reaches here.
 */
export function passageOf(effect: Row, name: string): Row | null {
    const value = effect._passage;
    if (!isJsonObject(value) || typeof value.sentence !== 'string') return null;
    const key = passageKey(name);
    if ([...key].length < 2 || !passageKey(value.sentence).includes(key)) return null;
    return { scene: typeof value.scene === 'string' && value.scene ? value.scene : null,
        page: integer(value.page) ? value.page : null,
        label: typeof value.label === 'string' && value.label ? value.label : null,
        sentence: value.sentence.trim() };
}

/** The per-person world maps, keyed by a person's handle or node id; re-keyed when a book person replaces a provisional one. */
export const PERSON_WORLD_MAPS: readonly string[] = Object.freeze(['npc_presence', 'npc_resources', 'npc_character', 'npc_profiles',
    'npc_disposition', 'npc_defense', 'npc_action', 'person_labels']);

/**
 * §11.5.4: a person established from a carried passage is replaced by the book's person of that name once the graph has
 * one. Before this entry is installed, the loaded graph is asked for the name: a person that is not a table person (the
 * scene's reviewed record landed with them) takes the entry's place. The world's per-person maps move from the provisional
 * handle and id to the book's (the book's entry wins where both exist), and the entry gains `replaced_by`, after which it is
 * never installed again. A write persists this with its commit, so it happens once; a read computes the same in memory.
 */
export function replacePassagePeople(graph: ModuleGraph, world: Row): void {
    for (const person of array(world.table_people)) {
        if (!isJsonObject(person) || !isJsonObject(person.from_passage) || person.replaced_by) continue;
        const name = string(person.name).trim();
        if (!name) continue;
        const node = graph.find(name, ['npc']);
        if (!node || graph.isTablePerson(node)) continue;
        const handle = graph.handle(node);
        for (const [from, to] of [[name, handle], [tablePersonId(name), string(node.node_id)]]) {
            if (from === to) continue;
            for (const key of PERSON_WORLD_MAPS) {
                const map = world[key];
                if (!isJsonObject(map) || !Object.hasOwn(map, from)) continue;
                if (!Object.hasOwn(map, to)) map[to] = map[from];
                delete map[from];
            }
        }
        person.replaced_by = handle;
    }
}

/**
 * A table person needs no source reading, and the two material authorities would both have said
 * otherwise: the pinned one requires ready anchors a table person has none of, and the plain one
 * looks the name up in `raw.nodes`, where it is not. Either answer refuses the very `apply` that
 * established them.
 */
export function withTablePeople(module: LoadedModule, world: Row): LoadedModule {
    replacePassagePeople(module.graph, world);
    installTablePeople(module.graph, world);
    const source = module.material;
    const material = (name: string): string => module.graph.isTablePerson(module.graph.find(name)) ? 'ready' : source(name);
    if (module.graph.materialOverride) module.graph.materialOverride = material;
    return { ...module, material };
}
