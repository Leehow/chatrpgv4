/** Shared delivery formatting only; callers own turn transitions, writes and commit recovery. */
import { array, number, truth, type Row } from '../read/values.js';
import { nowIso } from './store.js';
import { bindMarkers, droppedMarkers, placeUnplacedMechanics, stripMarkers } from './text.js';

export function deliveryText(text: string | null, receipts: Row[]): Row {
    const binding = bindMarkers(text || '', receipts);
    const marked = placeUnplacedMechanics(binding.text, receipts, binding.placed);
    const dropped = droppedMarkers(binding, receipts);
    return {
        rendered_text: stripMarkers(marked.text),
        placed: marked.placed,
        ...(truth(marked.placed) ? { marked_text: marked.text } : {}),
        ...(dropped ? { dropped_markers: dropped } : {}),
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
