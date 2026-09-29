/** §151.2.4: the job row's Jev spend counts every host family's own row shape. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readingAccounting, tallyReadingRow } from "../../extensions/module/reading-accounting.ts";

test("§151.2.4 + §151.3: a claim_support row's requests, Jev ms and tokens reach the job's Jev spend", () => {
	const accounting = readingAccounting();
	tallyReadingRow(accounting, { lane: "reading", event: "claim_support", family: "source-claim-support", status: "answered", calls: 1, jev_ms: 544, input_tokens: 8754 });
	tallyReadingRow(accounting, { lane: "reading", event: "claim_support", family: "source-claim-support", status: "answered", calls: 2, jev_ms: 600, input_tokens: 9000, output_tokens: 12 });
	assert.deepEqual(accounting.jev["source-claim-support"], { calls: 3, ms: 1144, input_tokens: 17754, output_tokens: 12 });
});

test("§151.2.4: a claim_support row that asked nothing adds no family, and the jev_decision shape still counts", () => {
	const accounting = readingAccounting();
	tallyReadingRow(accounting, { lane: "reading", event: "claim_support", family: "source-claim-support", status: "no_eligible", calls: 0 });
	assert.deepEqual(accounting.jev, {});
	tallyReadingRow(accounting, { lane: "reading", event: "jev_decision", family: "source-need-answered", attempts: 1, ms: 400, input_tokens: 900, output_tokens: 3 });
	assert.deepEqual(accounting.jev["source-need-answered"], { calls: 1, ms: 400, input_tokens: 900, output_tokens: 3 });
});
