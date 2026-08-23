import {
  deliveredHandoutPresentationsDisplay,
  deliveredHandoutsDisplay,
} from "./projections.mjs";

/** Per-session delivery cursor shared by refresh hydration, state.materials,
 * and turn SSE. The projection remains the sole player-safety authority. */
export class HandoutSessionDelivery {
  constructor({
    projectMaterials = deliveredHandoutsDisplay,
    projectPresentations = deliveredHandoutPresentationsDisplay,
  } = {}) {
    this.projectMaterials = projectMaterials;
    this.projectPresentations = projectPresentations;
    this.seenBySession = new Map();
  }

  materials(workspace, campaignId) {
    return this.projectMaterials(workspace, campaignId);
  }

  hydrate(workspace, sessionId, campaignId) {
    const materials = this.materials(workspace, campaignId);
    const presentations = this.projectPresentations(workspace, campaignId);
    this.seed(sessionId, presentations);
    return materials;
  }

  seed(sessionId, cards) {
    this.seenBySession.set(
      sessionId,
      new Set((cards || []).map((card) => card?.presentation_id).filter(Boolean)),
    );
  }

  clear(sessionId) {
    this.seenBySession.delete(sessionId);
  }

  pushNew(workspace, sessionId, campaignId, write) {
    let delivered;
    try {
      delivered = this.projectPresentations(workspace, campaignId);
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
      if (!card.presentation_id || seen.has(card.presentation_id)) continue;
      // A dropped response must retry on the next turn; mark only after the
      // exact SSE frame writer confirms success.
      if (write("handout", card)) {
        seen.add(card.presentation_id);
        pushed += 1;
      }
    }
    return pushed;
  }
}
