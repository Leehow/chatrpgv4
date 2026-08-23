import test from "node:test";
import assert from "node:assert/strict";

import {
  beginCampaignMessageOpen,
  campaignSessionAfterMessageOpen,
  initialCampaignMessageOwner,
  ownsCampaignMessageToken,
  releaseCampaignMessages,
} from "./campaign-message-owner.ts";

test("a new campaign rejects the old campaign's late transcript completion", () => {
  const oldOpen = beginCampaignMessageOpen(initialCampaignMessageOwner(), "old-campaign");
  const newOpen = beginCampaignMessageOpen(oldOpen.owner, "new-campaign");

  assert.equal(oldOpen.clearMessages, true);
  assert.equal(newOpen.clearMessages, true);
  assert.equal(ownsCampaignMessageToken(newOpen.owner, oldOpen.token), false);
  assert.equal(ownsCampaignMessageToken(newOpen.owner, newOpen.token), true);
});

test("a failed cross-campaign open cannot leave the old session owned by the new campaign", () => {
  const oldOpen = beginCampaignMessageOpen(initialCampaignMessageOwner(), "old-campaign");
  const oldSession = { campaign_id: "old-campaign", session_id: "old-session" };
  const newOpen = beginCampaignMessageOpen(oldOpen.owner, "new-campaign");

  assert.equal(
    campaignSessionAfterMessageOpen(oldSession, newOpen.owner),
    null,
    "the old composer session must be cleared before createSession can fail",
  );
  assert.equal(ownsCampaignMessageToken(newOpen.owner, oldOpen.token), false);
});

test("leaving the table invalidates old callbacks even after reopening the same campaign", () => {
  const first = beginCampaignMessageOpen(initialCampaignMessageOwner(), "campaign-1");
  const released = releaseCampaignMessages(first.owner);
  const reopened = beginCampaignMessageOpen(released, "campaign-1");

  assert.equal(ownsCampaignMessageToken(reopened.owner, first.token), false);
  assert.equal(ownsCampaignMessageToken(reopened.owner, reopened.token), true);
});

test("reopening one campaign preserves its messages but rejects the older async generation", () => {
  const first = beginCampaignMessageOpen(initialCampaignMessageOwner(), "campaign-1");
  const session = { campaign_id: "campaign-1", session_id: "session-1" };
  const reopened = beginCampaignMessageOpen(first.owner, "campaign-1");

  assert.equal(reopened.clearMessages, false);
  assert.equal(campaignSessionAfterMessageOpen(session, reopened.owner), session);
  assert.equal(ownsCampaignMessageToken(reopened.owner, first.token), false);
  assert.equal(ownsCampaignMessageToken(reopened.owner, reopened.token), true);
});
