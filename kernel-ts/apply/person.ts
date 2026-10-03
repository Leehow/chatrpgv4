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
import { calledPerson, personRecord, untoldBlock } from '../read/capsule.js';
import { CampaignSnapshot } from '../read/campaign.js';
import { bookNames, namePieces, occurs } from '../journal/naming.js';
import { normalize, repr, row, string, type Row } from '../read/values.js';
import { nowIso, required } from '../write/store.js';
import type { ApplyContext } from './index.js';
import { passageOf } from '../read/table-people.js';
import { establishPerson, leanOrigin } from './entities.js';

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
async function personOf(context: ApplyContext, who: any, effect: Row = {}): Promise<Row> {
    if (typeof who !== 'string' || !who.trim())
        throw new RpcError('invalid_params', 'who must name an investigator at the table or an NPC', { fix: 'name the person this is about', details: { field: 'person.who' } });
    const key = normalize(who);
    for (const sheet of await context.campaign.party() as Row[])
        if ([normalize(string(sheet.id)), normalize(string(sheet.name))].includes(key))
            return { id: string(sheet.id), name: string(sheet.name || sheet.id), is_investigator: true };
    // The table's word after the book's, through the junction every person entrance reads (§87.8): one owner is that
    // person, two are refused rather than the first one picked. Only an NPC carries a word here; §79 refuses an
    // investigator a `name`, and the party was asked above.
    const node = context.graph.find(who, ['npc']) ?? calledPerson(context.graph, context.world, who);
    if (node)
        return { id: context.graph.handle(node), name: context.graph.displayName(node), is_investigator: false };
    // §11.5.4 (SL-51): a person the source text carried this turn names is not invented. Established from that passage
    // exactly as `apply npc` establishes one (§87's record with `from_passage`), so the label is written on them.
    const passage = passageOf(effect, who);
    if (passage) {
        const node = establishPerson(context, who, typeof effect.why === 'string' && effect.why.trim() ? effect.why.trim() : leanOrigin(context, passage), passage);
        return { id: context.graph.handle(node), name: context.graph.displayName(node), is_investigator: false, established: 'passage', from_passage: passage };
    }
    throw new RpcError('unknown_entity', `${repr(who)} is nobody at this table`, {
        fix: 'name an investigator of the party or an NPC this table has; someone the book never had is established first by apply npc under that name with walk_on: true, and goes through lookup kind adaptation only when they must persist as a source-connected figure',
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

/** §103.8: refuse a book name, or a piece of one, as the word for a book person nobody has named to the investigator. */
async function refuseUntoldName(context: ApplyContext, handle: string, name: string): Promise<void> {
    const { graph, world } = context, node = graph.find(handle, ['npc']);
    if (!node || graph.isTablePerson(node)) return;
    const said = normalize(name), pieces = namePieces(bookNames(graph, node)).map(normalize).filter(Boolean);
    if (!pieces.some(piece => occurs(said, piece))) return;
    const snapshot = new CampaignSnapshot(context.kernel, context.campaign.id);
    const journal = row(await snapshot.optional('npc-journal.json')), records = await snapshot.files('turns');
    if (untoldBlock(graph, world, journal, node, records) === null) return;
    throw new RpcError('invalid_params', `${repr(name)} uses the name the book gives this person, and nobody has said it to the investigator`, {
        fix: "name is their epithet until the fiction names them: build it from the one visible thing only they have here -- something they carry or wear, a mark, a habit, the job they are doing. Their name reaches the prose only as {{name:<their name field>}}, written where someone in the scene says it",
        details: { field: 'person.name', reason: 'untold_name', name },
    });
}

/** The fields a person effect carries (extensions/kernel/tools.ts `PersonEffect`, plus `owed` on any effect); `_` keys are the host's. */
const PERSON_FIELDS = ['kind', 'who', 'name', 'address', 'why', 'intent_ref', 'intent_outcome', 'owed'];

export async function stagePerson(context: ApplyContext, effect: Row): Promise<{ receipt: Row; event: DomainEvent }> {
    const { world, callId, turn, ordinal } = context;
    // §103.7: a field the effect does not have was dropped without a word. Table 16 (2026-10-03): the Keeper put the epithet
    // in `label` and the handle in `name`, and the handle became what the table calls the person.
    const unknown = Object.keys(effect).filter(key => !key.startsWith('_') && !PERSON_FIELDS.includes(key));
    if (unknown.length)
        throw new RpcError('invalid_params', `a person effect has no field ${unknown.map(key => repr(key)).join(', ')}`, {
            fix: "the word this table calls them goes in name (for someone untold, their epithet); how they are spoken to goes in address; who is the person it is about",
            details: { fields: unknown },
        });
    const person = await personOf(context, required(effect, 'who'), effect);
    const name = word(effect, 'name'), address = word(effect, 'address');
    const why = typeof effect.why === 'string' && effect.why.trim() ? effect.why.trim() : null;
    if (name == null && address == null)
        throw new RpcError('invalid_params', 'a person effect needs `name`, `address`, or both', {
            fix: "name: what this table calls them in the player's language; address: what they are called to their face",
            details: { fields: ['name', 'address'] },
        });
    // An investigator's name is the player's, written on the sheet, already in the play language.
    // A second record for it is exactly the defect §76 closed: one fact, one place it lives.
    // §103.7: a book person's handle is for tool calls; it is not a word the table calls anyone. A person the table itself
    // established has their name as their handle, and that name is theirs.
    if (name != null && context.graph.kind('npc').some(node => !context.graph.isTablePerson(node) && context.graph.handle(node) === name))
        throw new RpcError('invalid_params', `${repr(name)} is a handle, not what the table calls anyone`, {
            fix: "name is the word the prose calls them, in the play language: for someone untold, an epithet built from the one visible thing only they have here",
            details: { field: 'person.name', name },
        });
    // §103.8 (owner, 2026-10-03, "除了烂牙司机其他名字还是全漏出来了"): table 20's Keeper wrote the veteran's book name and the
    // owner's nickname as their epithets, and the prose then used them. While a book person is untold, the word the table
    // calls them carries none of the book's names for them, nor a piece of one. The refusal names no name: it would tell it.
    if (name != null && person.is_investigator !== true) await refuseUntoldName(context, string(person.id), name);
    if (name != null && person.is_investigator === true)
        throw new RpcError('invalid_params', `${person.name} carries their own name on their sheet`, {
            fix: 'set address for how they are spoken to; a name a player chose is not renamed at the table',
            details: { field: 'person.name', who: person.id },
        });
    // §103.7 (owner, 2026-10-03, asking for distinctive, unique epithets): the word this table calls someone tells them from everyone
    // else. Two people under one word cannot be told apart in prose, in a say token or on the card, and a later `who` that
    // names it resolves to nobody (§87.8 refuses two owners). Refused only when it is the same words as another person's
    // (normalized); whether a word is distinctive enough is the Keeper's, from the rule in this effect's description.
    if (name != null && person.is_investigator !== true) {
        const others = Object.entries(row(world.person_labels)).filter(([id, record]) => id !== string(person.id) && string(row(record).name).trim())
            .map(([, record]) => string(row(record).name).trim());
        const taken = others.find(other => normalize(other) === normalize(name));
        if (taken)
            throw new RpcError('invalid_params', `${repr(name)} is already what this table calls someone else`, {
                fix: `give this person a word of their own: the one visible thing only they have here -- something they carry or wear, a mark, a habit, the job they are doing -- not age, height, build or sex alone. Words in use: ${others.map(word => repr(word)).join(', ')}`,
                details: { field: 'person.name', name, taken, in_use: others },
            });
    }
    const before = personRecord(world, string(person.id));
    const record = { ...before, ...(name != null ? { name } : {}), ...(address != null ? { address } : {}) };
    (world.person_labels ??= {})[string(person.id)] = record;
    // §11.5.6 (SL-62): the host's `_resolved_from` -- the name the Keeper wrote, once a fan-out question against the
    // scene's known people cleared it to this person's handle and the host rewrote `who` before the retry.
    const resolvedFrom = typeof effect._resolved_from === 'string' && effect._resolved_from.trim() ? effect._resolved_from.trim() : undefined;
    return {
        receipt: {
            id: context.mint(`person:${person.id}-t${turn.turn}-c${ordinal}`),
            kind: 'person',
            call_id: callId,
            who: person.id,
            is_investigator: person.is_investigator,
            ...(person.established ? { established: person.established, from_passage: person.from_passage } : {}),
            ...(resolvedFrom ? { resolved_from: resolvedFrom } : {}),
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
