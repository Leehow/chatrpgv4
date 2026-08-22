import type { ChatMessage, HandoutCard } from "./types";

/** Append only genuine server presentation events. The stable material may be
 * shown again only when the server supplies a new presentation identity. */
export function appendHandoutPresentation(
  messages: ChatMessage[],
  card: HandoutCard,
  at: number,
): ChatMessage[] {
  if (!card.asset_id || !card.presentation_id) return messages;
  if (messages.some((message) =>
    message.kind === "handout"
      && message.card.presentation_id === card.presentation_id)) {
    return messages;
  }
  return [...messages, { kind: "handout", card, at }];
}

/** Persistent Materials entitlement is keyed only by the stable asset id. */
export function dedupeHandoutMaterials(cards: HandoutCard[]): HandoutCard[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (!card.asset_id || seen.has(card.asset_id)) return false;
    seen.add(card.asset_id);
    return true;
  });
}
