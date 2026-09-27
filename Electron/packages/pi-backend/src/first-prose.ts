import type { ProseArrival } from "./turn-telemetry.js";

/**
 * Contract §135.11.5 (SL-94): what one event the backend streams to the renderer means for the
 * moment the player first sees the turn's prose.
 *
 * The owner's latency target runs from the player's input to the first character of prose the
 * player finally sees. It is read where the host forwards to the renderer, not from raw pi events,
 * because the host decides what is forwarded: a mechanics row can project to nothing, presentations
 * are deduplicated and redrawn in place, and host deliveries are projected asynchronously.
 *
 * Every decision here is by shape. Nothing reads the words: a delivery and a notice are both prose
 * in the play language, and only their fields say which is which.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

/**
 * A §55 service notice: a `coc-delivery` row whose `details` carry any key besides the channel mark
 * (`coc_delivery`) and the `turn`. Every notice names its subject with a flag of its own
 * (`provider_outage`, `turn_unfinished`, `review_unavailable`, ...); the §8 `placed_by_host` fallback,
 * which carries the turn's own prose, is `{coc_delivery: true, turn}` and nothing else. A notice added
 * later is therefore a notice without being registered here.
 */
export function isServiceNoticeRow(row: unknown): boolean {
  if (!isRecord(row) || row.customType !== "coc-delivery") return false;
  const details = isRecord(row.details) ? row.details : {};
  return Object.keys(details).some((key) => key !== "coc_delivery" && key !== "turn");
}

/**
 * Classify one stream event.
 *
 * `row` is the transcript row a presentation draws for the first time. A redraw of a row already on
 * screen (a lane's projection, a §132 patch) passes none: it replaces a card in place and is never
 * new prose, which is what keeps an earlier turn's card, redrawn during this one, out of this turn.
 *
 * - A `coc-mechanics` card counts when it carries delivery prose: a non-blank `marked_text` or
 *   `rendered_text`, the two fields `pipicoc/mechanics.js` draws as prose. A mechanics-only card
 *   (a roll or clue card, the §50 settled-without-delivery card) does not.
 * - A host-placed row (`placedByHost`, §83) counts unless its row is a service notice.
 * - Assistant text: a non-blank delta is a candidate that counts only if `message_end` keeps it; a
 *   replacement counts at once when it carries non-blank text and never when it carries none.
 */
export function proseArrival(event: unknown, row?: unknown): ProseArrival | undefined {
  if (!isRecord(event)) return undefined;
  if (event.type === "text") {
    if (event.replace === true) return { kind: "text_replace", prose: nonBlank(event.delta) };
    return nonBlank(event.delta) ? { kind: "text" } : undefined;
  }
  if (event.type !== "presentation" || row === undefined) return undefined;
  const entry = isRecord(event.entry) ? event.entry : {};
  if (isRecord(entry.presentation)) {
    if (entry.presentation.renderer !== "coc-mechanics") return undefined;
    const details = isRecord(entry.presentation.details) ? entry.presentation.details : {};
    return nonBlank(details.marked_text) || nonBlank(details.rendered_text)
      ? { kind: "prose", via: "mechanics" }
      : undefined;
  }
  if (entry.placedByHost === true && nonBlank(entry.content) && !isServiceNoticeRow(row)) {
    return { kind: "prose", via: "host" };
  }
  return undefined;
}
