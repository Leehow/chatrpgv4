/** Shared delivery formatting only; callers own turn transitions, writes and commit recovery. */
import { array, number, truth, type Row } from '../read/values.js';
import { RpcError } from '../errors.js';
import { isJsonObject, jsonDigest } from '../json.js';
import { nowIso } from './store.js';
import { bindMarkers, droppedMarkers, placeUnplacedMechanics, stripMarkers } from './text.js';
import { speechPass, unresolvedSpeakers, type SpeakerResolver } from './speech.js';

/** The say pass runs first (§40.2) so `bindMarkers` never meets a say token as a marker naming no
 *  receipt; with no resolver every name is a label, which is what a caller without a table gets. */
export function deliveryText(text: string | null, receipts: Row[], resolve: SpeakerResolver = name => ({ label: name })): Row {
    const spoken = speechPass(text || '', resolve);
    const binding = bindMarkers(spoken.text, receipts);
    const marked = placeUnplacedMechanics(binding.text, receipts, binding.placed);
    const dropped = droppedMarkers(binding, receipts), unresolved = unresolvedSpeakers(spoken.speech);
    return {
        rendered_text: stripMarkers(marked.text),
        placed: marked.placed,
        speech: spoken.speech,
        ...(truth(marked.placed) || spoken.speech.length ? { marked_text: marked.text } : {}),
        ...(dropped ? { dropped_markers: dropped } : {}),
        ...(unresolved.length ? { unresolved_speakers: { names: unresolved, note: 'these say tokens named nobody at the table and stand as labels; a person present is named exactly as present[].name gives it' } } : {}),
    };
}

export function deliveryRecord(turn: Row, text: string | null, receipts: Row[], delivery: Row, world: Row): Row {
    return {
        turn: number(turn.turn),
        player_text: turn.player_text ?? null,
        receipts,
        text: text || '',
        rendered_text: delivery.rendered_text,
        mechanics: delivery.mechanics,
        // §42.6: what the player was told stood on them this turn, which is not a receipt and so
        // survives nowhere else. A record that kept only the receipts could not answer afterwards
        // whether a turn said the state or said nothing, which is the whole defect.
        ...(delivery.standing ? { standing: delivery.standing } : {}),
        speech: array(delivery.speech),
        labels: delivery.labels,
        calls: turn.calls || {},
        commit: null,
        opened_at: turn.opened_at ?? null,
        closed_at: nowIso(),
        pending_choice: turn.pending_choice ?? null,
        world,
        capsule: turn.capsule ?? null,
        intents: [...array(turn.intents)],
    };
}

/** Contract §135.31: at most this many of a turn's `look`/`lookup` calls ride on its delivery. */
export const KEEPER_READS_MAX = 64;
/**
 * Contract §135.31: the turn's read-only Keeper calls, as the host carries them on the delivery (`keeper_reads`, host-only),
 * for the turn record's `reads`: each call's arguments beside the digest `calls` keeps for a write. Absent: none.
 */
export function keeperReads(value: unknown): Row[] {
    if (value == null)
        return [];
    if (!Array.isArray(value) || value.length > KEEPER_READS_MAX)
        throw new RpcError('invalid_params', `keeper_reads must be a list of at most ${KEEPER_READS_MAX} reads`);
    return value.map((entry, index) => {
        const read = isJsonObject(entry) ? entry : undefined;
        const withheld = read?.withheld;
        if (!read || (read.tool !== 'look' && read.tool !== 'lookup') || !isJsonObject(read.args) || (read.ok !== undefined && typeof read.ok !== 'boolean')
            || (read.run !== undefined && typeof read.run !== 'string') || (read.step !== undefined && typeof read.step !== 'string')
            || (withheld !== undefined && (!Array.isArray(withheld) || withheld.some(key => typeof key !== 'string'))))
            throw new RpcError('invalid_params', `keeper_reads[${index}] must be {tool: look | lookup, args: {...}, withheld?: [keys], ok?, run?, step?}`);
        return {
            tool: read.tool,
            args: read.args,
            params_sha256: jsonDigest(read.args),
            ...(withheld !== undefined ? { withheld } : {}),
            ...(read.ok !== undefined ? { ok: read.ok } : {}),
            ...(read.run !== undefined ? { run: read.run } : {}),
            ...(read.step !== undefined ? { step: read.step } : {})
        };
    });
}
