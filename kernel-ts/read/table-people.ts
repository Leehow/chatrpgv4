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
 * `{label: 门房}` spans: the only two world writes that turn wanted were his presence and his
 * stance, and both were refused.
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
 * table) that string reached the player 47 times. `world.person_labels` was `null` for all 121
 * turns: §79's writer exists and nothing ever sent the Keeper to it.
 */
import { jsonDigest } from '../json.js';
import type { LoadedModule } from './campaign.js';
import type { ModuleGraph } from './module-graph.js';
import { array, normalize, row, string, type Row } from './values.js';

/** Minted by the kernel, never copied by the Keeper: the handle is the name they used. */
export const tablePersonId = (name: string): string => `npc-table-${jsonDigest(normalize(name)).slice(0, 20)}`;

export function tablePeople(world: Row): Row[] {
    return array(world.table_people).map(row).filter(person => !!string(person.name).trim());
}

/** Rehydrate the world's record onto a loaded graph. Idempotent: `addTablePerson` keeps the first. */
export function installTablePeople(graph: ModuleGraph, world: Row): ModuleGraph {
    for (const person of tablePeople(world)) {
        const name = string(person.name).trim();
        graph.addTablePerson(tablePersonId(name), name, { reason: string(person.why), turn: person.turn ?? null });
    }
    return graph;
}

/**
 * A table person needs no source reading, and the two material authorities would both have said
 * otherwise: the pinned one requires ready anchors a table person has none of, and the plain one
 * looks the name up in `raw.nodes`, where it is not. Either answer refuses the very `apply` that
 * established them.
 */
export function withTablePeople(module: LoadedModule, world: Row): LoadedModule {
    installTablePeople(module.graph, world);
    const source = module.material;
    const material = (name: string): string => module.graph.isTablePerson(module.graph.find(name)) ? 'ready' : source(name);
    if (module.graph.materialOverride) module.graph.materialOverride = material;
    return { ...module, material };
}
