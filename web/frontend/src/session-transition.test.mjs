import test from "node:test";
import assert from "node:assert/strict";

import {
  HANDOFF_EVENT_TYPE,
  HANDOFF_TIMEOUT_MS,
  composerLocked,
  initialTransitionState,
  isHandoffEvent,
  reduceTransition,
} from "./session-transition.ts";

const history = Object.freeze([
  { kind: "player", text: "我叫艾伦" },
  { kind: "keeper", text: "记下了。" },
]);

test("contract coc_setup_handoff event opens the interlude", () => {
  const event = {
    type: HANDOFF_EVENT_TYPE,
    campaign_id: "amaranthine-16",
    receipt: { decision_id: "setup.complete" },
    at: "2026-04-09T00:00:00Z",
  };
  assert.equal(isHandoffEvent(event), true);
  const next = reduceTransition(initialTransitionState, {
    kind: "handoff",
    campaign_id: event.campaign_id,
    at: 1_000,
  });
  assert.equal(next.phase, "interlude");
  assert.equal(next.campaignId, "amaranthine-16");
  assert.equal(next.startedAt, 1_000);
  assert.equal(composerLocked(next), true);
});

test("campaign_status transitioning=true also opens the interlude", () => {
  const next = reduceTransition(initialTransitionState, {
    kind: "campaign_status",
    session_role: "setup",
    transitioning: true,
    now: 2_000,
  });
  assert.equal(next.phase, "interlude");
  assert.equal(next.startedAt, 2_000);
});

test("transitioning=false and session_role=play closes the interlude", () => {
  const open = reduceTransition(initialTransitionState, {
    kind: "handoff",
    campaign_id: "c1",
    at: 10,
  });
  const closed = reduceTransition(open, {
    kind: "campaign_status",
    session_role: "play",
    transitioning: false,
    now: 20,
  });
  assert.equal(closed.phase, "idle");
  assert.equal(composerLocked(closed), false);
  assert.equal(closed.campaignId, "c1");
});

test("closing the interlude does not mutate chat history", () => {
  const snapshot = history.slice();
  const open = reduceTransition(initialTransitionState, { kind: "handoff", at: 1 });
  reduceTransition(open, {
    kind: "campaign_status",
    session_role: "play",
    transitioning: false,
  });
  assert.deepEqual(history, snapshot);
  assert.equal(history.length, 2);
});

test("tick past the timeout surfaces a stalled prompt without auto-retry", () => {
  const open = reduceTransition(initialTransitionState, {
    kind: "handoff",
    campaign_id: "c1",
    at: 0,
  });
  const stillWaiting = reduceTransition(open, {
    kind: "tick",
    now: HANDOFF_TIMEOUT_MS - 1,
  });
  assert.equal(stillWaiting.phase, "interlude");
  const stalled = reduceTransition(open, {
    kind: "tick",
    now: HANDOFF_TIMEOUT_MS,
  });
  assert.equal(stalled.phase, "stalled");
  const ignored = reduceTransition(stalled, {
    kind: "campaign_status",
    session_role: "setup",
    transitioning: true,
    now: HANDOFF_TIMEOUT_MS + 5_000,
  });
  assert.equal(ignored.phase, "stalled");
  const retried = reduceTransition(stalled, { kind: "retry", now: 99_000 });
  assert.equal(retried.phase, "interlude");
  assert.equal(retried.startedAt, 99_000);
});
