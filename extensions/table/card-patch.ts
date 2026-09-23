/**
 * Contract §132: the one word an asynchronous lane uses to enrich a delivery card after it was drawn.
 *
 * A card is drawn when its turn is delivered, and the player reads it at once (§129, §130). Work that
 * finishes later -- an object's definition, a prefetched usage, whatever lane comes next -- used to need
 * its own session entry and its own backend plumbing before its result could reach a card the player
 * was already looking at. This is the general road instead: append one `coc-card-patch` naming the card
 * and a JSON merge patch (RFC 7396) over that card's `details`; the Electron backend
 * (`coc-view.ts` `CocCardLedger`) redraws the card in place on the live transcript and folds the same
 * patch into it on every re-read.
 *
 * The selector, in precedence order:
 *
 *  - `card.id`: the `coc-mechanics` entry id, when the writer knows it;
 *  - `card.turn`: the card of that turn -- the latest one read before the patch, or the next one if the
 *    patch arrives first;
 *  - neither: every card with an item row the patch names, under `definitions` (keyed by the row's
 *    `definition_name`) or `objects` (keyed by its `name`). A lane that cannot know which card named an
 *    object patches by the object's name and the backend matches the rows.
 *
 * What a patch says is player-facing by construction: the writer projects it through the same
 * function the sheet uses (`publicDefinition`, `publicUsage`), never from Keeper material.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CARD_PATCH = "coc-card-patch";

/** Which card: the entry id, else the turn, else every card whose rows the patch names. */
export type CardSelector = {id?: string; turn?: number};
export type CardPatch = {campaign: string; card?: CardSelector; patch: Record<string, unknown>; source: string};
type Appender = {appendEntry?: ExtensionAPI["appendEntry"]};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Append one `coc-card-patch`. Returns whether it was written; never throws, because a card that cannot
 * be enriched keeps what it already shows, and no lane's result is worth a turn.
 */
export function patchCard(pi: Appender | null | undefined, request: CardPatch | null | undefined): boolean {
  try {
    const {campaign, card, patch, source} = request ?? ({} as Partial<CardPatch>);
    if (typeof campaign !== "string" || !campaign || typeof source !== "string" || !source) return false;
    if (!isRecord(patch) || !Object.keys(patch).length) return false;
    const selector: CardSelector = {
      ...(typeof card?.id === "string" && card.id ? {id: card.id} : {}),
      ...(Number.isSafeInteger(card?.turn) ? {turn: card!.turn} : {}),
    };
    if (typeof pi?.appendEntry !== "function") return false;
    pi.appendEntry(CARD_PATCH, {campaign, card: selector, patch, source, at: new Date().toISOString()});
    return true;
  } catch {
    return false;
  }
}
