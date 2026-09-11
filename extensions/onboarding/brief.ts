/**
 * The creation brief (contract §26 Guided Creation): the exchange before the draft is a form. The
 * package declares the slots, the kernel keeps the notes, and this file computes the one move the
 * setup model is allowed this turn and prints the brief it reads. No judgment of the player's mood
 * lives here or anywhere: depth is the slot table and the cap.
 */
export interface SetupSlot { id: string; required: boolean; purpose: string; ask: string; mod?: string; version?: string }
export interface SetupNotes { slots: Record<string, { value: string; origin: string; turn: number }>; turns: number }
export interface BriefMove { move: 'ask' | 'draft'; slot?: SetupSlot; missing: string[]; reason: 'complete' | 'stopped' | 'cap' | 'missing' }

export const STOP_SLOT = 'stop';

export function emptyNotes(): SetupNotes { return { slots: {}, turns: 0 }; }

/** The move: draft when every required slot is filled, when the player ended it, or at the cap; otherwise ask the first missing required slot. */
export function computeMove(slots: readonly SetupSlot[], notes: SetupNotes | null | undefined, cap: number): BriefMove {
  const filled = notes?.slots ?? {};
  const missing = slots.filter((slot) => slot.required && !Object.hasOwn(filled, slot.id)).map((slot) => slot.id);
  if (Object.hasOwn(filled, STOP_SLOT)) return { move: 'draft', missing, reason: 'stopped' };
  if (!missing.length) return { move: 'draft', missing, reason: 'complete' };
  if ((notes?.turns ?? 0) >= cap) return { move: 'draft', missing, reason: 'cap' };
  return { move: 'ask', slot: slots.find((slot) => slot.id === missing[0]), missing, reason: 'missing' };
}

/** The brief as the model reads it, in the system language: the state, then exactly one move. */
export function renderBrief(slots: readonly SetupSlot[], notes: SetupNotes | null | undefined, cap: number): string {
  const filled = notes?.slots ?? {}, turns = notes?.turns ?? 0, move = computeMove(slots, notes, cap);
  const lines = [`Creation brief (host-computed from the package's slots and the kernel's notes; turn ${turns} of ${cap}):`];
  for (const slot of slots) {
    const note = filled[slot.id];
    lines.push(note
      ? `- ${slot.id} (${slot.required ? 'required' : 'optional'}): FILLED — "${note.value}" (${note.origin}); do not ask about it again.`
      : `- ${slot.id} (${slot.required ? 'required' : 'optional'}): missing. Purpose: ${slot.purpose}. Ask: ${slot.ask}.`);
  }
  if (Object.hasOwn(filled, STOP_SLOT)) lines.push(`- stop: the player ended the exchange ("${filled[STOP_SLOT].value}").`);
  const why = move.reason === 'complete' ? 'every required slot is filled' : move.reason === 'stopped' ? 'the player asked for the card' : move.reason === 'cap' ? `the cap of ${cap} guiding turns is reached` : '';
  lines.push(move.move === 'draft'
    ? `Move: draft — ${why}. Use setup create-investigator in this reply and ask nothing.`
    : `Move: ask ${move.slot!.id} — record with setup note anything the player's words already answer first, then acknowledge the last answer concretely, say what this question decides (its purpose), and ask it. Do not draft: create-investigator is refused while a required slot is missing.`);
  return lines.join('\n');
}
