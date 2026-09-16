/**
 * A player who goes where the book has no scene must not wait forever (contract §36.15).
 *
 * The detour is the whole point of the adaptation path: the player names a destination the module
 * does not contain, and the product opens a reviewed `new_destination` proposal instead of refusing
 * or fabricating. On campaign game-ef7545c5 (2026-09-16) that path dead-ended. A North End
 * pawnbroker left the offered leads and walked into his own shop to read his own pawn-ticket
 * ledger. The Keeper did everything right — two `lookup kind=module expected_kind=scene` misses, one
 * hit proving the place was not already registered, then `lookup kind=adaptation action=prepare` —
 * and the job went `stale` three minutes later, because a preparation is pinned to the world it was
 * prepared against and that world moved. On disk:
 *
 *     {"name":"...","status":"stale","purpose":"new_destination","attempt":1,"error":null}
 *     world.adaptation.records: 0        world.active_scene: "commission-briefing"
 *
 * Nothing noticed. The host had captured `status: "pending"` when the proposal was prepared and
 * never re-read it, so the gate answered every later tool call with, verbatim:
 *
 *     Adaptation preparation for <name> is still running. Use narrate only to tell the player that
 *     preparation is pending ... Inspect the same proposal after new player input.
 *
 * The player then sent two consecutive turns that cannot be read as hesitation — he has the key, the
 * ledger is under the counter, he pushes the door open and lights the lamp — and read the same
 * "still being checked" both times. Nothing re-prepared it. Nothing failed it. The shop was
 * unreachable for as long as the table stayed open.
 *
 * Two halves, tested on their own paths: the kernel's `adaptation.status` over its real RPC, and the
 * host's turn boundary and tool gate through the real extension seam.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/** The product kernel over its own RPC, one workspace kept so the retained job can be read back. */
function kernel(t, requests, { workspace = mkdtempSync(join(tmpdir(), "coc-stale-adaptation-")) } = {}) {
	t.after(() => rmSync(workspace, { recursive: true, force: true }));
	const run = spawnSync(
		process.execPath,
		[join(ROOT, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(ROOT, "content")],
		{ cwd: ROOT, input: requests.map((request, index) => JSON.stringify({ id: String(index), ...request })).join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 28 },
	);
	const answers = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
	assert.equal(answers.length, requests.length, `${run.stderr}\n${run.stdout}`);
	return { answers, workspace };
}

const PROPOSAL = "North End pawnshop";
const REQUEST = "The investigator owns this shop and goes there to read his own pawn-ticket ledger.";
const prepare = (campaign) => ({
	method: "adaptation.prepare",
	params: { campaign, name: PROPOSAL, purpose: "new_destination", request: REQUEST, anchors: ["scene: commission-briefing"] },
});

test("a preparation whose pin has gone stale says so with the call that revives it, and that call revives it", async (t) => {
	const campaign = "stale-adaptation-kernel";
	const { answers } = kernel(t, [
		{ method: "campaign.create", params: { id: campaign, module: "the-haunting", pregen: "thomas-hayes", play_language: "en", title: "stale adaptation" } },
		{ method: "table.open", params: { campaign } },
		{ method: "table.player_input", params: { campaign, text: "I walk to my own pawnshop and read the ledger under the counter." } },
		prepare(campaign),
		{ method: "adaptation.status", params: { campaign, name: PROPOSAL } },
		// The world moves while the retained creator is still working: this is the whole staling
		// mechanism, `pin = digest({world, party, line})`, not a test-only trapdoor.
		{ method: "table.apply", params: { campaign, call_id: "t1-c9", effects: [{ kind: "time", minutes: 10, why: "walking to the shop" }] } },
		{ method: "adaptation.status", params: { campaign, name: PROPOSAL } },
		prepare(campaign),
	]);
	const [created, opened, , prepared, running, moved, stale, again] = answers;
	assert.equal(created.ok, true, JSON.stringify(created));
	assert.equal(opened.ok, true, JSON.stringify(opened));
	assert.equal(moved.ok, true, JSON.stringify(moved));

	// Before the world moved the job was genuinely in flight, and said so.
	assert.equal(prepared.result.status, "pending", JSON.stringify(prepared));
	assert.equal(running.result.status, "pending", JSON.stringify(running));

	// After it, `status` is the diagnostic path the wait instruction points at, so it has to carry
	// both facts: this is over, and this is the one call that starts it again.
	assert.equal(stale.result.status, "stale", JSON.stringify(stale));
	assert.ok(stale.result.reason, "a stale job with no error still owes the Keeper a reason");
	assert.match(stale.result.instruction, /lookup kind=adaptation action=prepare/);
	assert.match(stale.result.instruction, /same name, purpose, anchors and request/);
	assert.doesNotMatch(String(stale.result.instruction), /is still running/,
		"the one sentence the live defect got wrong: a stale job is not still running");

	// And the instruction is true: preparing it again hands back a fresh task, so the player's
	// repeated walk into his own shop has somewhere to go.
	assert.equal(again.result.status, "pending", JSON.stringify(again));
	assert.ok(again.result.task?.key, "re-preparation starts a real attempt");
	assert.notEqual(again.result.task.key, prepared.result.task.key,
		"the revived attempt is pinned to the current turn, not to the world that moved");
});

test("a retained attempt already marked stale is re-prepared, never answered with the dead view", async (t) => {
	const campaign = "stale-adaptation-same-key";
	// The natural route cannot reach this: a job is stale exactly when its pin, source digest,
	// source generation or contract digest differs from the current one, and `prepare` mixes those
	// same four into the packet key, so re-preparing a staled job normally lands on a new key (the
	// test above). It is reachable when a world moves and moves back. So the retained job the kernel
	// itself wrote is marked the way the kernel itself marks it, and the real `prepare` RPC is asked
	// what it does with it -- because the instruction shipped above promises prepare always revives.
	const first = kernel(t, [
		{ method: "campaign.create", params: { id: campaign, module: "the-haunting", pregen: "thomas-hayes", play_language: "en", title: "same key" } },
		{ method: "table.open", params: { campaign } },
		{ method: "table.player_input", params: { campaign, text: "I walk to my own pawnshop and read the ledger under the counter." } },
		prepare(campaign),
	]);
	const key = first.answers.at(-1).result.task.key;
	const jobPath = join(first.workspace, ".coc/adaptation-jobs", campaign, key, "job.json");
	const job = JSON.parse(readFileSync(jobPath, "utf8"));
	assert.equal(job.status, "pending");
	writeFileSync(jobPath, JSON.stringify({ ...job, status: "stale" }));

	const { answers } = kernel(t, [{ method: "table.open", params: { campaign } }, prepare(campaign)], { workspace: first.workspace });
	const revived = answers.at(-1);
	assert.equal(revived.ok, true, JSON.stringify(revived));
	assert.equal(revived.result.status, "pending", JSON.stringify(revived));
	assert.ok(revived.result.task, "a stale retained attempt must not answer preparation with no task");
	assert.equal(revived.result.task.attempt, 2, "it starts the next attempt at the same packet key");
});

const PENDING_TURN = [
	fauxAssistantMessage([fauxToolCall("lookup", { kind: "adaptation", action: "prepare", name: "north-end-pawnshop",
		purpose: "new_destination", request: REQUEST, anchors: ["scene: commission-briefing"] })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("narrate", { text: "铺子的事还在核对，这会儿你没有动身。" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("铺子的事还在核对，这会儿你没有动身。"),
];

test("a job that goes stale after the wait was captured is never reported as running, and the repeated action lands the same turn", async (t) => {
	const delivered = "你推开自家铺子的门，点上灯，把这半年的当票流水搬到柜面上。";
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", FAKE_KERNEL_ADAPTATION_STALE_ON_SECOND_STATUS: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			...PENDING_TURN,
			// The player says it again, so the Keeper acts on it again. This is the call the live
			// table never got to make.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "walking to his own shop" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "walking to his own shop" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我先去自己铺子，没准备好我就等着。");
	const beforeSecond = table.session.messages.length;
	await table.session.prompt("我等。铺子是我自己的，钥匙在我兜里，账本在柜台底下第二格——我推门进去，点上灯。");

	const later = table.session.messages.slice(beforeSecond);
	const said = (messages) => messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
		.map((block) => String(block?.text ?? "")).join("\n");
	const afterwards = said(later) + "\n" + customMessages(table.session, "coc-host")
		.filter((message) => (message.details?.turn ?? 0) >= 2).map((message) => message.content).join("\n");

	// 1. The host must never describe a job as running when it is not.
	assert.doesNotMatch(afterwards, /is still running/,
		"the captured status was pending; the job is stale, and only a re-read can tell the difference");
	// 2. The Keeper is told what is true, once, with the exact call that moves it forward.
	assert.match(afterwards, /is stale, not running/);
	assert.match(afterwards, /lookup kind=adaptation action=prepare name="north-end-pawnshop"/);
	// 3. The table is free: the player's repeated action settles and the turn is delivered.
	const requests = table.kernelRequests();
	assert.equal(requests.filter((row) => row.method === "table.apply").length, 1,
		"the stale job holds nothing back: the resent call goes through");
	assert.equal(requests.filter((row) => row.method === "table.narrate").length, 2);
	assert.equal(requests.filter((row) => row.method === "adaptation.status" && row.params.name).length, 2,
		"the status is re-derived once at the turn boundary, not on every tool call");
});

test("the Keeper that asks a stale proposal for the destination gets the proposal, not a refusal", async (t) => {
	const delivered = "重新排一次队，铺子的事马上就给你个准信。";
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", FAKE_KERNEL_ADAPTATION_STALE_ON_SECOND_STATUS: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			...PENDING_TURN,
			// Exactly what the shipped instruction asks for. Refusing it would make the instruction a loop.
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "adaptation", action: "prepare", name: "north-end-pawnshop",
				purpose: "new_destination", request: REQUEST, anchors: ["scene: commission-briefing"] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我先去自己铺子，没准备好我就等着。");
	await table.session.prompt("我推门进去，把账本搬到柜面上。");
	assert.equal(table.kernelRequests().filter((row) => row.method === "adaptation.prepare").length, 2,
		"the call the stale instruction names must reach the kernel");
});

test("a preparation that really is still running names the one call that reports on it", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			PENDING_TURN[0],
			// A pending job still owns the turn, so this is refused -- and the refusal is the second
			// place the Keeper reads about the job.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "waiting" }] })], { stopReason: "toolUse" }),
			...PENDING_TURN.slice(1),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我先去自己铺子，没准备好我就等着。");
	const status = table.entries("coc-adaptation-status").at(-1);
	assert.equal(status.status, "pending");
	// Both surfaces the Keeper reads about a pending job: the `prepare` result and the gate's refusal.
	// "Inspect the same proposal after new player input" named no call at all, and the live Keeper
	// answered it by repeating `lookup kind=module` until the gate cut the run.
	assert.match(status.message, /lookup kind=adaptation action=status name="north-end-pawnshop"/);
	const refusal = table.session.messages.filter((message) => message.role === "toolResult" && message.isError)
		.flatMap((message) => (Array.isArray(message.content) ? message.content : [])).map((block) => String(block?.text ?? "")).join("\n");
	assert.match(refusal, /is still running/, "a job that really is pending is described as pending");
	assert.match(refusal, /lookup kind=adaptation action=status name="north-end-pawnshop"/);
	assert.equal(table.kernelRequests().filter((row) => row.method === "table.apply").length, 0);
});
