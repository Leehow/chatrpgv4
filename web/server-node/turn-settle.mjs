/**
 * Attach the existing table-transcript projection to the current turn SSE
 * payload. This is display wiring only — not a second Keeper or protocol.
 */
import { tableTranscriptMessages } from "./projections.mjs";

export function latestKeeperProjection(workspace, campaignId) {
  const messages = tableTranscriptMessages(workspace, campaignId);
  if (!Array.isArray(messages) || messages.length === 0) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.role === "keeper") return message;
  }
  return null;
}

export function projectionIdentity(message) {
  if (!message || typeof message !== "object") return null;
  if (typeof message.finalization_id === "string" && message.finalization_id) {
    return `fin:${message.finalization_id}`;
  }
  if (typeof message.entry_id === "string" && message.entry_id) {
    return `entry:${message.entry_id}`;
  }
  if (message.turn != null && message.turn !== "") {
    return `turn:${message.turn}`;
  }
  return null;
}

export function buildTurnSseData({
  state,
  usage,
  workspace,
  campaignId,
  liveId = null,
  previousIdentity = null,
}) {
  const payload = { events: [], state, usage };
  const message = latestKeeperProjection(workspace, campaignId);
  if (!message) return payload;
  const identity = projectionIdentity(message);
  // live_id is request correlation only. Never echo an unchanged / unidentifiable
  // latest keeper as if this prompt produced a new projection.
  if (!identity || identity === previousIdentity) return payload;
  if (typeof liveId === "string" && liveId) {
    message.live_id = liveId;
  }
  payload.message = message;
  return payload;
}
