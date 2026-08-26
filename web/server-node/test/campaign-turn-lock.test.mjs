import test from "node:test";
import assert from "node:assert/strict";

import { createCampaignTurnLock } from "../campaign-turn-lock.mjs";

test("same campaign cannot start a second turn", () => {
  const lock = createCampaignTurnLock();
  assert.equal(lock.tryAcquire("haunting-a"), true);
  assert.equal(lock.tryAcquire("haunting-a"), false);
  assert.equal(lock.isBusy("haunting-a"), true);
  lock.release("haunting-a");
  assert.equal(lock.tryAcquire("haunting-a"), true);
});

test("different campaigns do not block each other", () => {
  const lock = createCampaignTurnLock();
  assert.equal(lock.tryAcquire("haunting-a"), true);
  assert.equal(lock.tryAcquire("haunting-b"), true);
  assert.equal(lock.isBusy("haunting-a"), true);
  assert.equal(lock.isBusy("haunting-b"), true);
  lock.release("haunting-a");
  assert.equal(lock.isBusy("haunting-a"), false);
  assert.equal(lock.isBusy("haunting-b"), true);
});
