/**
 * A proposal that is over retires from the table (contract §60).
 *
 * Three retained playtests of 2026-09-16 show the same shape from two directions, and the cost is
 * always the same: a tool call the player paid for, spent on a job that is dead.
 *
 * `homes/t8`, campaign `game-2543d551`. Three `new_destination` proposals were prepared in Lima and
 * all three went `stale`; the newest, a corner photography shop, was created at 13:14:20Z. The
 * player was on a reed island in Puno hours later, and turns 39, 40 and 43 each opened with
 * `{"lane":"adaptation","proposal":"<the corner shop>","status":"stale"}` followed by one blocked
 * call — `apply`, then `resolve`, then `lookup`. Three turns, three different verbs, one dead shop.
 *
 * `homes/t9`, campaign `game-ef8e60aa`, and `homes/t4`, campaign `game-1c0faba5`. Here the dead job
 * is `failed`, and `failed` was in `ADAPTATION_HELD`, so it was not merely announced — it was *held*,
 * and a held terminal wait blocks every verb including `narrate`. t9's sanatorium failed on turn 22
 * and blocked an `apply` on turn 45; t4's Benefit Street neighbours failed on turn 24 and blocked
 * both a `lookup` and a `look` on turn 40, by which time the player was upstairs in another house
 * drawing a bolt. Both of those later rows carry `"first": true`, which is the host's own word for
 * *this process had no wait in memory and the cold scan gave it one*.
 *
 * So the in-memory half was never the leak. Within one process the notice really is said once: the
 * gate spends `adaptationStale` on the first tool call, and the next turn boundary returns early on
 * `!held && adaptationScanned`. What re-armed it was the store. `adaptation.status` with no name
 * answers the host's cold-recovery scan out of the retained job files, and it returned `failed` and
 * `stale` jobs among the live ones, newest first, forever. Nothing ever retired them, so every
 * restart for the rest of the campaign's life rediscovered the same corpse and charged the table for
 * it again.
 *
 * The fix is on both ends of that seam, and neither end deletes evidence:
 *   - the kernel's unnamed scan answers about work, not about history, so `failed`, `stale`,
 *     `cancelled` and `accepted` leave it; every one of them is still readable by name;
 *   - the host stops counting `failed` as a wait. A failure is a result, not something to wait for,
 *     and like `stale` it is said once, with the reviewer's own cause and the call that starts a
 *     fresh attempt, and then the table is free.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/** The product kernel over its own RPC; the workspace is kept so the retained job can be read back. */
function kernel(t, requests, { workspace = mkdtempSync(join(tmpdir(), "coc-dead-proposal-")) } = {}) {
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

const PROPOSAL = "Roxbury sanatorium";
const REQUEST = "The investigator follows the discharge note to the sanatorium named on it.";
const prepare = (campaign) => ({
	method: "adaptation.prepare",
	params: { campaign, name: PROPOSAL, purpose: "new_destination", request: REQUEST, anchors: ["scene: commission-briefing"] },
});
const open = (campaign) => [
	{ method: "campaign.create", params: { id: campaign, module: "the-haunting", pregen: "thomas-hayes", play_language: "en", title: "dead proposal" } },
	{ method: "table.open", params: { campaign } },
	{ method: "table.player_input", params: { campaign, text: "I take the discharge note and go to the sanatorium." } },
];

test("a failed proposal leaves the cold-recovery scan and stays readable by name", async (t) => {
	const campaign = "dead-proposal-failed";
	const { answers, workspace } = kernel(t, [
		...open(campaign),
		prepare(campaign),
		{ method: "adaptation.status", params: { campaign } },
	]);
	const prepared = answers[3];
	assert.equal(prepared.result.status, "pending", JSON.stringify(prepared));
	// While it is running it is exactly what cold recovery exists for, so it answers the unnamed scan.
	assert.equal(answers[4].result.name, PROPOSAL, JSON.stringify(answers[4]));
	assert.equal(answers[4].result.status, "pending");

	const { key, attempt } = prepared.result.task;
	const second = kernel(t, [
		{ method: "table.open", params: { campaign } },
		{ method: "adaptation.fail", params: { campaign, name: PROPOSAL, key, attempt, error: "Independent review did not support every change without unresolved issues" } },
		{ method: "adaptation.status", params: { campaign } },
		{ method: "adaptation.status", params: { campaign, name: PROPOSAL } },
	], { workspace });
	const [, failed, scan, named] = second.answers;
	assert.equal(failed.result.status, "failed", JSON.stringify(failed));

	// The whole defect in one assertion: a job that is over is not what the next process is waiting on.
	assert.equal(scan.result.status, "none", "a failed proposal must not be handed back to a restarted table");
	assert.equal(scan.result.name, undefined);

	// And nothing was destroyed to achieve that: the failure, and the reviewer's own cause, are
	// still there for the one who asks for them by name.
	assert.equal(named.result.status, "failed", JSON.stringify(named));
	assert.match(String(named.result.reason), /Independent review did not support every change/);
	const jobs = join(workspace, ".coc/adaptation-jobs", campaign, key, "job.json");
	assert.equal(JSON.parse(readFileSync(jobs, "utf8")).status, "failed", "the retained evidence stays on disk");
});

test("a proposal whose pinned world moved is staled on disk and retired from the scan in the same breath", async (t) => {
	const campaign = "dead-proposal-stale";
	const { answers, workspace } = kernel(t, [
		...open(campaign),
		prepare(campaign),
		// The pin is world/party/worldline plus source generation, so ordinary play moves it. This is
		// the mechanism that killed all three of t8's Lima proposals, not a test-only trapdoor.
		{ method: "table.apply", params: { campaign, call_id: "t1-c9", effects: [{ kind: "time", minutes: 10, why: "the walk across town" }] } },
		{ method: "adaptation.status", params: { campaign } },
		{ method: "adaptation.status", params: { campaign, name: PROPOSAL } },
	]);
	const [, , , prepared, moved, scan, named] = answers;
	assert.equal(moved.ok, true, JSON.stringify(moved));
	assert.equal(scan.result.status, "none", "a stale proposal must not be handed back to a restarted table");
	assert.equal(named.result.status, "stale", JSON.stringify(named));
	const jobs = join(workspace, ".coc/adaptation-jobs", campaign, prepared.result.task.key, "job.json");
	assert.equal(JSON.parse(readFileSync(jobs, "utf8")).status, "stale",
		"the scan still writes what it learned; it just stops offering it");
});

const PREPARE_TURN = [
	fauxAssistantMessage([fauxToolCall("lookup", { kind: "adaptation", action: "prepare", name: "roxbury-sanatorium",
		purpose: "new_destination", request: REQUEST, anchors: ["scene: commission-briefing"] })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("narrate", { text: "你把出院单折好，先没动身。" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("你把出院单折好，先没动身。"),
];

test("a proposal that failed is told once with its cause and holds nothing back", async (t) => {
	const delivered = "你推开疗养院的铁门，登记簿摊在门房桌上。";
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", FAKE_KERNEL_ADAPTATION_FAILED_ON_SECOND_STATUS: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			...PREPARE_TURN,
			// The player says it again, so the Keeper acts on it again. Under `failed` as a wait this
			// call and every one after it was refused, `narrate` included.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the walk to the sanatorium" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the walk to the sanatorium" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我先托人打听疗养院，没打听到我就等着。");
	await table.session.prompt("我不等了。出院单上写着地址，我自己走过去，推门进去。");
	await waitForIdle(table.session);

	const refusals = table.session.messages.filter((message) => message.role === "toolResult" && message.isError)
		.flatMap((message) => (Array.isArray(message.content) ? message.content : [])).map((block) => String(block?.text ?? "")).join("\n");
	// 1. A failure is a result, and the Keeper is told which result it is.
	assert.match(refusals, /has failed/);
	assert.doesNotMatch(refusals, /is still running/, "a failed job is not running");
	assert.doesNotMatch(refusals, /Use lookup kind=adaptation action=status/,
		"a failed job has nothing further to report, so it must not send the Keeper to look");
	// 2. With the reviewer's own cause, which until now never left the job file.
	assert.match(refusals, /the reviewer refused the placement/);
	// 3. And the one call that starts a fresh attempt, spelled out, because a Keeper executes what it reads.
	assert.match(refusals, /lookup kind=adaptation action=prepare name="roxbury-sanatorium" retry=true/);
	// 4. The table is free: the resent action settles and the turn is delivered.
	const requests = table.kernelRequests();
	assert.equal(requests.filter((row) => row.method === "table.apply").length, 1,
		"a failed proposal holds nothing back: the resent call goes through");
	assert.equal(requests.filter((row) => row.method === "table.narrate").length, 2);

	// 5. The cause reaches the evidence too. `status: "failed"` alone is what three retained tables
	//    recorded, and it is why nobody could say why any of them failed.
	const rows = table.telemetry();
	const lane = rows.filter((row) => row.lane === "adaptation").at(-1);
	assert.equal(lane.status, "failed", JSON.stringify(lane));
	assert.match(String(lane.cause), /the reviewer refused the placement/);
	const blocked = rows.find((row) => row.code === "blocked" && row.reason === "adaptation_failed");
	assert.ok(blocked, `a block that costs a tool call must be legible: ${JSON.stringify(rows.filter(r => r.code === "blocked"))}`);
	assert.equal(blocked.proposal, "roxbury-sanatorium");
});

test("a dead proposal is not re-armed at the next turn boundary", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", FAKE_KERNEL_ADAPTATION_STALE_ON_SECOND_STATUS: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			...PREPARE_TURN,
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the walk" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the walk" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "铁门在你身后合上。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("铁门在你身后合上。"),
			// A third turn, with the dead proposal never mentioned again by anyone.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 5, why: "reading the register" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "登记簿上有一行被划掉了。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("登记簿上有一行被划掉了。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我先托人打听疗养院，没打听到我就等着。");
	await table.session.prompt("我不等了，自己走过去推门进去。");
	const settled = table.kernelRequests().length;
	await table.session.prompt("我翻登记簿，找出院那一页。");
	await waitForIdle(table.session);

	const third = table.kernelRequests().slice(settled);
	assert.equal(third.filter((row) => row.method === "adaptation.status").length, 0,
		"the dead job was spent a turn ago; the boundary has nothing left to re-read");
	assert.equal(third.filter((row) => row.method === "table.apply").length, 1,
		"and nothing of the third turn is spent on it");
	const rows = table.telemetry().filter((row) => row.code === "blocked" && String(row.reason ?? "").startsWith("adaptation_"));
	assert.equal(rows.length, 1, `a dead proposal costs exactly one tool call, ever: ${JSON.stringify(rows)}`);
});

test("cold recovery hands back live work and never a corpse", async (t) => {
	// The host half of the kernel assertions above: whatever the store answers, a terminal status is
	// never restored as something the table is waiting on. t4 turn 40 and t9 turn 45 are this row.
	const table = await openTable({
		env: { FAKE_KERNEL_RETAINED_ADAPTATION_STATUS: "failed" },
		responses: [
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 5, why: "drawing the bolt" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "插销拔开了。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("插销拔开了。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我上二楼，去拔西头卧室门外的插销。");
	await waitForIdle(table.session);

	const requests = table.kernelRequests();
	assert.equal(requests.filter((row) => row.method === "adaptation.status" && row.params.name).length, 0,
		"a job that is over owes the table no status call");
	assert.equal(requests.filter((row) => row.method === "table.apply").length, 1,
		"the player's own action is what this turn is for");
	const blocked = table.telemetry().filter((row) => row.code === "blocked" && row.reason === "preparation_wait");
	assert.equal(blocked.length, 0, `a terminal proposal is not a wait: ${JSON.stringify(blocked)}`);
});
