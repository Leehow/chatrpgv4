/**
 * Contract 28.7, §180.8 and §180.9: `apply dossier`, the door through which an enabled package establishes at the table
 * what the book left silent, under a word it contributes.
 *
 * A word a book never gave has nowhere to live: the graph is the book's and no package may write it, and the ledger is
 * the kernel's and would outlive the package that filled it. This writes into the package's own namespace instead
 * (`world.mods.state[<id>]`), so turning the package off takes the word with it and the book is left exactly as it was
 * found. A person takes the person words (`actor_profile_keys`), a creature the creature words (`creature_profile_keys`),
 * and either takes `weaknesses` from a package that requires `actor.weaknesses.v1` -- appended after the authored
 * entries, never editing one, never with a `learned_by` (a conclusion is book material).
 */
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { VOCABULARY_SPINES, WEAKNESSES_CAPABILITY } from '../read/mods.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, entries, repr, row, string, truth, type Row } from '../read/values.js';
import type { DomainEvent } from '../transactions.js';
import type { ApplyContext } from '../apply/index.js';
import { required } from '../write/store.js';

const TABLE_CAPABILITY = 'graph.vocabulary.table.v1';
/** The table door's one property that is not a word: the weakness entries of §180.9. */
export const WEAKNESSES_KEY = 'weaknesses';
/** One established word, and one weakness entry's `book`: a bounded line, as the door has always taken. */
const LINE_CHARS = 200;
const WEAKNESS_FIELDS = new Set(['book', 'needs']);

/** The being a dossier names: a person by the book's or the table's name, else a creature (any: a creature without a stat
 *  block still has habits and weaknesses). A miss is the person refusal, whose candidates are the next step. */
function beingNamed(graph: ModuleGraph, name: string): Row {
    try {
        return graph.npc(name);
    }
    catch (error) {
        if (!(error instanceof RpcError) || error.code !== 'unknown_entity')
            throw error;
        const creature = graph.find(name, ['creature']);
        if (creature)
            return creature;
        throw error;
    }
}

/** The package that owns each word at the table: the first active one, in load order, that requires the door. */
function wordOwners(active: Row[]): Map<string, { mod: Row; spine: typeof VOCABULARY_SPINES[number]; entry: Row }> {
    const owners = new Map<string, { mod: Row; spine: typeof VOCABULARY_SPINES[number]; entry: Row }>();
    for (const mod of active) {
        if (!array(mod.requires).includes(TABLE_CAPABILITY))
            continue;
        for (const spine of VOCABULARY_SPINES)
            for (const entry of array(row(row(mod.contributes).vocabulary)[spine]))
                if (!owners.has(string(entry.key)))
                    owners.set(string(entry.key), { mod, spine, entry });
    }
    return owners;
}

function namespace(world: Row, id: string, part: string): Row {
    const namespaces = world.mods.state;
    if (!Object.hasOwn(namespaces, id)) namespaces[id] = {};
    if (!Object.hasOwn(namespaces[id], part)) namespaces[id][part] = {};
    return namespaces[id][part];
}

/**
 * §180.9: the table's weakness entries for one being, checked whole before any is written. `needs` are names the Keeper
 * gives (a model is never handed a node id); each resolves to one node of a kind the contract's `actor_weaknesses` law
 * lists, and is stored as that node's id, which the chain projects back to its name.
 */
async function weaknessEntries(context: ApplyContext, value: unknown, who: string): Promise<Row[]> {
    const { graph, kernel } = context;
    const law = row(row(await kernel.snapshots.readJson(join(kernel.content, 'modules', 'module-graph-contract-v3.json'))).actor_weaknesses);
    const kinds = array(row(row(law.node_refs).needs).kinds).map(string);
    const field = `dossier.values.${WEAKNESSES_KEY}`;
    if (!Array.isArray(value) || !value.length)
        throw new RpcError('invalid_params', `${field} must be a list of one or more {book, needs?} entries`,
            { fix: 'write each weakness the table established as {"book": "<what harms, repels, binds or ends it, in one line>", "needs": ["<means by name>"]}', details: { field } });
    return value.map((entry: unknown, index: number) => {
        const at = `${field}[${index}]`;
        if (!isJsonObject(entry))
            throw new RpcError('invalid_params', `${at} must be an object {book, needs?}`, { details: { field: at } });
        if (Object.hasOwn(entry, 'learned_by'))
            throw new RpcError('invalid_params', `${at}.learned_by is the book's: a conclusion the investigators can reach is book material`,
                { fix: 'leave learned_by out; a weakness the table establishes is found in play', details: { field: `${at}.learned_by` } });
        const unknown = Object.keys(entry).filter(key => !WEAKNESS_FIELDS.has(key));
        if (unknown.length)
            throw new RpcError('invalid_params', `${at} carries ${unknown.map(key => repr(key)).join(', ')}; a table weakness is {book, needs?}`,
                { details: { field: at, unknown } });
        const book = entry.book;
        if (typeof book !== 'string' || !book.trim() || Array.from(book.trim()).length > LINE_CHARS)
            throw new RpcError('invalid_params', `${at}.book must be one bounded line`,
                { fix: `say what harms, repels, binds, banishes or ends ${who}, with its conditions, in at most ${LINE_CHARS} characters`, details: { field: `${at}.book` } });
        if (entry.needs !== undefined && (!Array.isArray(entry.needs) || entry.needs.some(name => typeof name !== 'string' || !name.trim())))
            throw new RpcError('invalid_params', `${at}.needs must be a list of names`, { details: { field: `${at}.needs` } });
        const needs = array(entry.needs).map((name: string) => {
            const node = graph.find(name, kinds);
            if (!node)
                throw new RpcError('unknown_entity', `${at}.needs: nothing the module or the table knows of a means kind is named ${repr(name)}`, {
                    fix: 'name the means by a name details.candidates gives, or leave it to the book line',
                    details: { field: `${at}.needs`, query: name, kinds, candidates: graph.candidates(name, kinds) },
                });
            return string(node.node_id);
        });
        return { book: book.trim(), ...(needs.length ? { needs: [...new Set(needs)] } : {}) };
    });
}

export async function stageDossier(context: ApplyContext, effect: Row, active: Row[]): Promise<{ receipt: Row; event: DomainEvent }> {
    const { graph, world, callId } = context, turn = context.turn.turn, mint = (id: string) => context.mint(id);
    const node = beingNamed(graph, required(effect, 'name')!), handle = graph.handle(node), person = graph.isPerson(node);
    const who = graph.displayName(node);
    const values = effect.values;
    if (!isJsonObject(values) || !entries(values).length)
        throw new RpcError('invalid_params', 'a dossier effect needs `values`, one or more contributed keys',
            { fix: 'name the keys this package contributes and what the table established for each', details: { field: 'dossier.values' } });
    const owners = wordOwners(active);
    const weaknessOwner = active.find(mod => array(mod.requires).includes(TABLE_CAPABILITY) && array(mod.requires).includes(WEAKNESSES_CAPABILITY));
    // The words this being can take: a person's words on a person, a creature's on a creature (§180.8), and weaknesses.
    const fits = (spine: string) => spine === (person ? 'actor_profile_keys' : 'creature_profile_keys');
    const available = [...[...owners].filter(([, owner]) => fits(owner.spine)).map(([key]) => key), ...(weaknessOwner ? [WEAKNESSES_KEY] : [])];
    const staged: Array<() => void> = [], written: string[] = [], shown: Row = {};
    for (const [key, value] of entries(values)) {
        if (key === WEAKNESSES_KEY && weaknessOwner) {
            const established = await weaknessEntries(context, value, who), id = string(weaknessOwner.id);
            staged.push(() => {
                const recorded = namespace(world, id, WEAKNESSES_KEY);
                recorded[node.node_id] = [...array(recorded[node.node_id]), ...established.map(entry => ({ ...entry, turn, mod: id }))];
            });
            written.push(key);
            shown[key] = established.map(entry => ({ book: entry.book, ...(entry.needs ? { needs: entry.needs.map((id: string) => graph.displayName(graph.nodes.get(id)!)) } : {}) }));
            continue;
        }
        const owner = owners.get(key);
        if (!owner)
            throw new RpcError('invalid_params', `no active package establishes ${repr(key)} at the table`,
                { fix: `use a key contributed by a package requiring ${TABLE_CAPABILITY}${available.length ? `: ${available.join(', ')}` : ''}`,
                  details: { field: 'dossier.values', key, available } });
        if (!fits(owner.spine))
            throw new RpcError('invalid_params', `${repr(key)} is a ${person ? 'creature' : 'person'}'s word and ${who} is a ${person ? 'person' : 'creature'}`,
                { fix: `establish one of ${available.join(', ') || 'nothing this package offers'} for ${who}`, details: { field: 'dossier.values', key, available } });
        // The book outranks the table on its own material: a word the source gave is not the Keeper's to overwrite, and
        // silently keeping the losing value would leave two answers on record.
        const authored = (person ? graph.npcProfile(node) : graph.creatureProfile(node))[key];
        if (truth(authored))
            throw new RpcError('invalid_params', `the source already gives ${who} ${key} ${repr(authored)}`,
                { fix: 'the book\'s own word stands; establish this only for someone the source leaves silent',
                  details: { field: 'dossier.values', actor: handle, key, authored_value: authored } });
        if (row(owner.entry).shape === 'lines')
            throw new RpcError('invalid_params', `${key} is written by the package's own lane, not at the table`,
                { fix: 'leave this word to the npc-voice lane; it fills it for anyone the source leaves silent', details: { field: 'dossier.values', key } });
        if (typeof value !== 'string' || !value.trim() || value.length > LINE_CHARS)
            throw new RpcError('invalid_params', `dossier.values.${key} must be one bounded line`,
                { fix: 'say what the table established, in a phrase', details: { field: `dossier.values.${key}` } });
        const id = string(owner.mod.id);
        // The record carries the word's Keeper-facing name with it. The label a module recorded at build is exactly what
        // a table this feature exists for does not have, so reading one back through the build-time spine would leave the
        // value written and unreadable.
        staged.push(() => {
            const recorded = namespace(world, id, 'dossier');
            if (!Object.hasOwn(recorded, node.node_id)) recorded[node.node_id] = {};
            recorded[node.node_id][key] = { value: value.trim(), label: string(row(owner.entry).label) || key, turn, mod: id };
        });
        written.push(key);
        shown[key] = value.trim();
    }
    // Every value is checked before any is written: one refused key leaves the namespace as it was.
    for (const write of staged) write();
    return {
        receipt: { id: mint(`dossier:${handle}-t${turn}`), kind: 'dossier', call_id: callId, npc: node.node_id, handle,
            name: who, keys: written, values: shown,
            ...(truth(effect.why) ? { why: effect.why } : {}), visibility: 'keeper' },
        event: { type: 'dossier-established', data: { npc: handle, keys: written } },
    };
}
