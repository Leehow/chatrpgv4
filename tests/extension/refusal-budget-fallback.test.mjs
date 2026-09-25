/**
 * Contract §135.11.3 (SL-63). The refusal budget's runaway abort (`ctx.abort()` once `blockedAfterExhausted` reaches
 * `RUNAWAY_ABORT_AT`) ends the Keeper's attempts, not the turn: the run ends `aborted_during_operate` with no
 * further model step, and before it is judged undelivered, one fallback narrate is tried carrying what already
 * landed and the Keeper's own last draft if any. The drop that led there is recorded `reason: "refusal_budget"`;
 * the stranded record is never written for a run this fallback delivers.
 *
 * Evidence: long gate #10 t4 -- three `unknown_entity` refusals of one class tripped the class limit and the
 * refusal budget; the run aborted and the turn stranded, although the compile's move had already landed and the
 * Keeper had material to narrate.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

/**
 * A `resolve` this fixture always refuses `needs` for the same reason (no weapon for a combat intent), each call's
 * own words kept different so the identical-resend guard (§67, two exact repeats) never intercepts it before the
 * refusal budget does. Contract §34.12: eight refusals of any class shut `resolve` (among others) for the rest of
 * the turn; six more blocked calls past that trip the runaway abort (`RUNAWAY_ABORT_AT`), and the extra two calls
 * beyond that are what let the run-driver actually observe the aborted signal (it only registers on a later
 * proposal in the same operate step, once the one that called `ctx.abort()` has already returned its own outcome).
 */
const noWeapon = (n) => fauxToolCall("resolve", { action: { intent: "combat", goal: `打倒他 ${n}`, method: "抓起手边的东西打过去" } }, { id: `r${n}` });
const barrage = fauxAssistantMessage(Array.from({ length: 16 }, (_, i) => noWeapon(i + 1)), { stopReason: "toolUse" });
const narrateCalls = (table) => table.kernelRequests().filter((row) => row.method === "table.narrate");
const releaseCalls = (table) => table.kernelRequests().filter((row) => row.method === "table.release");

test("§135.11.3: the refusal budget's runaway abort delivers the fallback narrate, not a stranded turn", async (t) => {
	const table = await openTable({ responses: [barrage] });
	t.after(() => table.dispose());
	await table.session.prompt("我拔枪就打，什么都不管了");
	await waitForIdle(table.session);

	const rows = table.telemetry();
	const runaway = rows.filter((row) => row.lane === "runaway");
	assert.ok(runaway.some((row) => row.after === "refusal_budget" && row.aborted === true), `the runaway abort fired: ${JSON.stringify(runaway)}`);

	const drop = rows.filter((row) => row.lane === "delivery" && row.reason === "refusal_budget");
	assert.equal(drop.length, 1, `the abort is one drop, not a verdict: ${JSON.stringify(drop)}`);

	const fallback = rows.filter((row) => row.event === undefined && row.tool === "narrate" && row.lane === "delivery");
	assert.deepEqual(fallback.map((row) => [row.ok, row.reason]), [[true, "refusal_budget_fallback"]], `the fallback narrate landed: ${JSON.stringify(fallback)}`);

	// The kernel actually received one real narrate call (a delivered turn, never a bare host notice) and no
	// `table.release {release: "stranded"}` call: the stranded record this fallback delivers is never written.
	assert.equal(narrateCalls(table).length, 1, `one narrate call reached the kernel: ${JSON.stringify(table.kernelRequests())}`);
	assert.equal(releaseCalls(table).some((row) => row.params?.release === "stranded"), false, "no stranded release ran");
	assert.equal(rows.some((row) => row.event === "released" && row.lane === "turn"), false, "no stranded release telemetry either");
});

/**
 * On the legacy engine the floor steer's own pre-existing recovery already delivers a held draft once the run
 * settles (unrelated to SL-63: `agent_end`'s steer, not `agent_settled`'s new check), so this scenario reaches
 * `agent_settled` with `closedThisRun` already true and this section's fallback correctly does not fire a second
 * time -- `deliverRefusalBudgetFallback`'s own preference for `floorDraft` over the notice line is the same
 * shape as that existing recovery, but is exercised for real only on the hybrid engine, where SL-63 lives and
 * where no such earlier recovery runs before the abort (the gate #10 t4 replay is that path's own test). What
 * this test guards here is composition: the new check must not double-deliver over an already-closed run.
 */
test("§135.11.3: a run already delivered by the floor steer's own recovery is not double-delivered by this section", async (t) => {
	const draft = "看门人抬起头，另一个人往后退了一步。";
	const table = await openTable({ responses: [fauxAssistantMessage(draft), barrage] });
	t.after(() => table.dispose());
	await table.session.prompt("我拔枪就打，什么都不管了");
	await waitForIdle(table.session);

	const steer = table.telemetry().filter((row) => row.lane === "delivery" && row.reason === "floor_steer");
	assert.equal(steer.length, 1, `the first leg's prose was dropped for the floor steer, holding the draft: ${JSON.stringify(table.telemetry())}`);

	const calls = narrateCalls(table);
	assert.equal(calls.length, 1, `exactly one narrate reached the kernel -- no second, this-section delivery on top of the existing recovery's: ${JSON.stringify(table.kernelRequests())}`);
	assert.equal(calls[0].params.text, draft, "the dropped draft was delivered verbatim, not a generic notice, and not replaced by this section's own");
});
