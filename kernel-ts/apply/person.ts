/**
 * What this table calls a person (contract §79).
 *
 * `apply move` writes `world.scene_labels` and `apply clue` writes `world.clue_labels`, so a place
 * and a clue each have one per-table record and every surface reads it back. A person had none:
 * nothing anywhere held "what this table calls Jackson Elias", so the prose re-invented the
 * transliteration every turn while the engine answered the book's English forever, and a form of
 * address the player corrected and an NPC accepted came back two turns later.
 *
 * This is the writer for the record. It records what was established -- it never judges it, and it
 * never reads a name to decide anything about the person who carries it.
 */
import { RpcError } from '../errors.js';
import type { DomainEvent } from '../transactions.js';
import { personRecord } from '../read/capsule.js';
import { entries, normalize, repr, row, string, type Row } from '../read/values.js';
import { nowIso, required } from '../write/store.js';
import type { ApplyContext } from './index.js';

/** §40.1's name text, for the same reason: this word is written into spoken lines and say tokens. */
export const LABEL_LIMIT = 60;

/**
 * The person the effect is about, as `{id, name, is_investigator}`.
 *
 * `id` is the identity a receipt already carries -- an investigator's sheet id, an NPC's graph
 * handle -- so the record is keyed by the thing that never gets renamed (§76.2). The table's own
 * name resolves too: a Keeper who named someone here may hand that name back, exactly as
 * `world.scene_labels` is an alias for a place everywhere a place is named.
 */
async function personOf(context: ApplyContext, who: any): Promise<Row> {
    if (typeof who !== 'string' || !who.trim())
        throw new RpcError('invalid_params', 'who must name an investigator at the table or an NPC', { fix: 'name the person this is about', details: { field: 'person.who' } });
    const key = normalize(who);
    for (const sheet of await context.campaign.party() as Row[])
        if ([normalize(string(sheet.id)), normalize(string(sheet.name))].includes(key))
            return { id: string(sheet.id), name: string(sheet.name || sheet.id), is_investigator: true };
    const node = context.graph.find(who, ['npc']);
    if (node)
        return { id: context.graph.handle(node), name: context.graph.displayName(node), is_investigator: false };
    for (const [id, record] of entries(row(context.world.person_labels)))
        if (normalize(string(row(record).name)) === key) {
            const named = context.graph.find(id, ['npc']);
            if (named)
                return { id: context.graph.handle(named), name: context.graph.displayName(named), is_investigator: false };
            const sheet = (await context.campaign.party() as Row[]).find(value => string(value.id) === id);
            if (sheet)
                return { id: string(sheet.id), name: string(sheet.name || sheet.id), is_investigator: true };
        }
    throw new RpcError('unknown_entity', `${repr(who)} is nobody at this table`, {
        fix: 'name an investigator of the party or an NPC this table has; someone the book never had is established first by apply npc under that name, and goes through lookup kind adaptation only when they must persist as a source-connected figure',
        details: { field: 'person.who', who },
    });
}

function word(effect: Row, field: string): string | null {
    const value = effect[field];
    if (value == null)
        return null;
    if (typeof value !== 'string' || !value.trim())
        throw new RpcError('invalid_params', `person.${field} must be one short word or phrase`, { fix: `say what this table calls them, or leave ${field} out`, details: { field: `person.${field}` } });
    const trimmed = value.trim();
    if (trimmed.length > LABEL_LIMIT || trimmed.includes('\n') || trimmed.includes('{{'))
        throw new RpcError('invalid_params', `person.${field} must be a single line of at most ${LABEL_LIMIT} characters and carry no marker`, {
            fix: 'a name, not a sentence about them',
            details: { field: `person.${field}`, limit: LABEL_LIMIT },
        });
    return trimmed;
}

export async function stagePerson(context: ApplyContext, effect: Row): Promise<{ receipt: Row; event: DomainEvent }> {
    const { world, callId, turn, ordinal } = context;
    const person = await personOf(context, required(effect, 'who'));
    const name = word(effect, 'name'), address = word(effect, 'address');
    const why = typeof effect.why === 'string' && effect.why.trim() ? effect.why.trim() : null;
    if (name == null && address == null)
        throw new RpcError('invalid_params', 'a person effect needs `name`, `address`, or both', {
            fix: "name: what this table calls them in the player's language; address: what they are called to their face",
            details: { fields: ['name', 'address'] },
        });
    // An investigator's name is the player's, written on the sheet, already in the play language.
    // A second record for it is exactly the defect §76 closed: one fact, one place it lives.
    if (name != null && person.is_investigator === true)
        throw new RpcError('invalid_params', `${person.name} carries their own name on their sheet`, {
            fix: 'set address for how they are spoken to; a name a player chose is not renamed at the table',
            details: { field: 'person.name', who: person.id },
        });
    const before = personRecord(world, string(person.id));
    const record = { ...before, ...(name != null ? { name } : {}), ...(address != null ? { address } : {}) };
    (world.person_labels ??= {})[string(person.id)] = record;
    return {
        receipt: {
            id: context.mint(`person:${person.id}-t${turn.turn}-c${ordinal}`),
            kind: 'person',
            call_id: callId,
            who: person.id,
            is_investigator: person.is_investigator,
            name: person.name,
            label: string(record.name || person.name),
            address: record.address ?? null,
            why,
            visibility: 'keeper',
            at: nowIso(),
        },
        event: { type: 'person-named', data: { who: person.id, name: record.name ?? null, address: record.address ?? null } },
    };
}
