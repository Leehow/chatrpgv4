import test from "node:test";
import assert from "node:assert/strict";

import {
  beginCampaignMessageOpen,
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

test("leaving the table invalidates old callbacks even after reopening the same campaign", () => {
  const first = beginCampaignMessageOpen(initialCampaignMessageOwner(), "campaign-1");
  const released = releaseCampaignMessages(first.owner);
  const reopened = beginCampaignMessageOpen(released, "campaign-1");

  assert.equal(ownsCampaignMessageToken(reopened.owner, first.token), false);
  assert.equal(ownsCampaignMessageToken(reopened.owner, reopened.token), true);
});

test("reopening one campaign preserves its messages but rejects the older async generation", () => {
  const first = beginCampaignMessageOpen(initialCampaignMessageOwner(), "campaign-1");
  const reopened = beginCampaignMessageOpen(first.owner, "campaign-1");

  assert.equal(reopened.clearMessages, false);
  assert.equal(ownsCampaignMessageToken(reopened.owner, first.token), false);
  assert.equal(ownsCampaignMessageToken(reopened.owner, reopened.token), true);
});
