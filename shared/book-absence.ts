/**
 * The owner's book-lookup rule (2026-10-29): while the party is in a part of the book, what that part does not say is not
 * there; the Keeper does not search other parts for it, but plays on from established table memory and improvises
 * plausibly. Table memory outranks the book: where they disagree, memory wins, or the two are fused into one account.
 * Every receipt and guidance line about reading the book says this, never "read on" or "turn the rest of the book".
 */
export const BOOK_ABSENCE_RULE = 'What the book says for here and now is all it holds for this: do not search other parts of the book for what it '
	+ 'does not say; play on from established table memory and improvise plausibly. Table memory outranks the book: where they disagree, '
	+ 'memory wins, or fuse them into one consistent account.';

/**
 * A book read that failed for a technical reason (the reading service, a lean-reading limit, a transport error) is a limit of
 * the host, never a fact of the fiction (1030c du T4/T5: a pointer_reading failure was narrated as illegible print).
 */
export const SOURCE_UNAVAILABLE_NOTE = 'The book service could not read this for a technical reason; it is not something in the fiction. Never narrate it '
	+ 'as illegible, smudged, lost or unreadable, and do not send this read again this turn: play on from the pages already carried and table memory.';
