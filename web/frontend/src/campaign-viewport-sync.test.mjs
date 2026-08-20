import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_CAMPAIGN_KEY,
  convergeCampaignViewport,
  createCampaignViewportSync,
} from "./campaign-viewport-sync.ts";

class FakeChannel {
  static channels = new Set();

  listeners = new Set();

  constructor() {
    FakeChannel.channels.add(this);
  }

  postMessage(data) {
    for (const channel of FakeChannel.channels) {
      if (channel === this) continue;
      for (const listener of channel.listeners) listener({ data });
    }
  }

  addEventListener(_type, listener) {
    this.listeners.add(listener);
  }

  removeEventListener(_type, listener) {
    this.listeners.delete(listener);
  }

  close() {
    FakeChannel.channels.delete(this);
  }
}

function fakeStorage(values) {
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function fakeStorageEvents() {
  return {
    addEventListener() {},
    removeEventListener() {},
  };
}

test("start and foreign selection do not open another document's campaign", () => {
  FakeChannel.channels.clear();
  const values = new Map([[ACTIVE_CAMPAIGN_KEY, "lobby-campaign"]]);
  const opened = [];
  const desktop = createCampaignViewportSync({
    storage: fakeStorage(values),
    channel: new FakeChannel(),
    storageEvents: fakeStorageEvents(),
    onCampaign: (campaignId) => {
      opened.push(campaignId);
    },
  });
  const other = createCampaignViewportSync({
    storage: fakeStorage(values),
    channel: new FakeChannel(),
    storageEvents: fakeStorageEvents(),
    onCampaign: (campaignId) => {
      opened.push(`other:${campaignId}`);
    },
  });

  desktop.start();
  other.start();
  assert.deepEqual(opened, []);

  other.publish("the-haunting-qs-mt0cxnej");
  assert.equal(values.get(ACTIVE_CAMPAIGN_KEY), "the-haunting-qs-mt0cxnej");
  assert.deepEqual(opened, []);

  desktop.stop();
  other.stop();
});

test("a settled opening refreshes the sibling document from the same canonical web session", async () => {
  const sharedSession = { campaign_id: "knott-office", session_id: "web-knott-office" };
  let canonicalTranscript = "守秘人正在打开建卡引导。开局后由 KP 按 coc-character……";
  let desktopTranscript = canonicalTranscript;

  canonicalTranscript = "完整 keeper 建卡引导正文";
  await convergeCampaignViewport(
    { campaignId: "knott-office", sessionId: "web-knott-office", updated: true },
    {
      currentSession: () => sharedSession,
      refreshSession: async () => {
        desktopTranscript = canonicalTranscript;
      },
    },
  );

  assert.equal(desktopTranscript, "完整 keeper 建卡引导正文");
});

test("a document broadcasts a settled-session update separately from campaign selection", () => {
  FakeChannel.channels.clear();
  const values = new Map();
  let received = null;
  const desktop = createCampaignViewportSync({
    storage: fakeStorage(values),
    channel: new FakeChannel(),
    storageEvents: fakeStorageEvents(),
    onCampaign() {},
    onSessionUpdated: (signal) => {
      received = signal;
    },
  });
  const mobile = createCampaignViewportSync({
    storage: fakeStorage(values),
    channel: new FakeChannel(),
    storageEvents: fakeStorageEvents(),
    onCampaign() {},
  });
  desktop.start();
  mobile.start();

  mobile.publish("knott-office", "web-knott-office", true);

  assert.deepEqual(received, {
    campaignId: "knott-office",
    sessionId: "web-knott-office",
    updated: true,
  });
  desktop.stop();
  mobile.stop();
});

test("a session-updated publish does not switch the sibling campaign", () => {
  FakeChannel.channels.clear();
  const values = new Map([[ACTIVE_CAMPAIGN_KEY, "haunting"]]);
  let desktopCampaign = "haunting";
  let mobileCampaign = "white-war";
  const desktop = createCampaignViewportSync({
    storage: fakeStorage(values),
    channel: new FakeChannel(),
    storageEvents: fakeStorageEvents(),
    onCampaign: (campaignId) => {
      desktopCampaign = campaignId;
    },
  });
  const mobile = createCampaignViewportSync({
    storage: fakeStorage(values),
    channel: new FakeChannel(),
    storageEvents: fakeStorageEvents(),
    onCampaign: (campaignId) => {
      mobileCampaign = campaignId;
    },
  });
  desktop.start();
  mobile.start();
  desktopCampaign = "haunting";
  mobileCampaign = "white-war";

  desktop.publish("haunting", "web-haunting", true);
  mobile.publish("white-war", "web-white-war", true);

  assert.equal(desktopCampaign, "haunting");
  assert.equal(mobileCampaign, "white-war");
  assert.equal(values.get(ACTIVE_CAMPAIGN_KEY), "haunting");
  desktop.stop();
  mobile.stop();
});
