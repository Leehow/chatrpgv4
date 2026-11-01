/**
 * §14.19.1: a recorded opening (`module.json` `opening_choice`) is a campaign's, held in that campaign's fork. The shared
 * library holds no table's opening: one stored there by older code (live7 du-1101b, cs-1101b: a setup's choice written to the
 * library and cloned into later forks) is ignored by every reader and dropped on the library's next write.
 *
 * The one opening the library does record is the book's own: a reference whose only entry is the book's, published with no
 * `start_scene` asked (§14.19.8 rule 1). It is marked `of: 'book'`; an unmarked library choice is always a table's.
 */
import { row, string, truth, type Row } from '../read/values.js';

/** The marker on an `opening_choice` that is the book's sole reference entry, not any table's choice. */
export const BOOK_OPENING = 'book';

/** Whether this module metadata is a campaign's fork (`campaign_scope`), not the shared library. */
export const isCampaignFork = (meta: Row): boolean => typeof meta?.campaign_scope === 'string' && meta.campaign_scope !== '';

/** Whether this `opening_choice` is the book's own opening (its sole reference entry), which the library may keep. */
export const isBookOpening = (choice: unknown): boolean => row(choice).of === BOOK_OPENING && truth(row(choice).start_scene);

/**
 * The opening this module metadata records: a fork's `opening_choice.start_scene`; on the library only the book's own
 * (`of: 'book'`), never a table's.
 */
export function ownOpeningChoice(meta: Row): string {
    const choice = row(meta?.opening_choice);
    if (!truth(choice.start_scene)) return '';
    return isCampaignFork(meta) || isBookOpening(choice) ? string(choice.start_scene) : '';
}

/** §14.19.1: drops a table's opening stored on the library; a fork's, and the library's book opening, are kept. */
export function dropForeignOpening(meta: Row): void {
    if (!ownOpeningChoice(meta)) delete meta.opening_choice;
}
