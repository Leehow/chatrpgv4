import test from "node:test";
import assert from "node:assert/strict";

import {
  cashLedgerRows,
  cashWhenLabel,
  hasCashBalances,
  showsCashSection,
} from "./panel-cash.ts";

test("items tab shows cash; time tab does not", () => {
  assert.equal(showsCashSection("items"), true);
  assert.equal(showsCashSection("character"), true);
  assert.equal(showsCashSection("all"), true);
  assert.equal(showsCashSection("time"), false);
});

test("setup pending hides cash instead of inventing a zero wallet", () => {
  assert.equal(showsCashSection("items", true), false);
  assert.equal(hasCashBalances(null), false);
  assert.equal(hasCashBalances({}), false);
  assert.equal(hasCashBalances({ balances: {} }), false);
});

test("ledger helper does not invent rows or require audit fields", () => {
  assert.deepEqual(cashLedgerRows({ balances: { GBP: { amount: "12" } } }), []);
  assert.equal(hasCashBalances({ balances: { GBP: { amount: "12" } } }), true);
  assert.equal(cashWhenLabel({ localized_reason: "报酬" }), "");
  assert.equal(cashWhenLabel({ player_time: "上午十时" }), "上午十时");
});
