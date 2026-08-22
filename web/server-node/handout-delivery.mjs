import { deliveredHandoutsDisplay } from "./projections.mjs";

/** Per-session delivery cursor shared by refresh hydration, state.materials,
 * and turn SSE. The projection remains the sole player-safety authority. */
export class HandoutSessionDelivery {
  constructor({ project = deliveredHandoutsDisplay } = {}) {
    this.project = project;
    this.seenBySession = new Map();
  }

  materials(workspace, campaignId) {
    return this.project(workspace, campaignId);
  }

  hydrate(workspace, sessionId, campaignId) {
    const cards = this.materials(workspace, campaignId);
    this.seed(sessionId, cards);
    return cards;
  }

  seed(sessionId, cards) {
    this.seenBySession.set(
      sessionId,
      new Set((cards || []).map((card) => card?.asset_id).filter(Boolean)),
    );
  }

  clear(sessionId) {
    this.seenBySession.delete(sessionId);
  }

  pushNew(workspace, sessionId, campaignId, write) {
    let delivered;
    try {
      delivered = this.materials(workspace, campaignId);
    } catch {
      return 0;
    }
    let seen = this.seenBySession.get(sessionId);
    if (!seen) {
      seen = new Set();
      this.seenBySession.set(sessionId, seen);
    }
    let pushed = 0;
    for (const card of delivered) {
      if (seen.has(card.asset_id)) continue;
      // A dropped response must retry on the next turn; mark only after the
      // exact SSE frame writer confirms success.
      if (write("handout", card)) {
        seen.add(card.asset_id);
        pushed += 1;
      }
    }
    return pushed;
  }
}
