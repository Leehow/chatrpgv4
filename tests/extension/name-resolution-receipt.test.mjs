/**
 * Contract §11.5.6 (SL-62), the kernel half. The host-only `_resolved_from` on an `npc`/`person` effect's name/who,
 * or on a `resolve` action's target/actor, is not a new identity: the exact-match resolution is unchanged (the
 * name it carries must already resolve to a real book person or investigator), and the only thing it adds is one
 * field on the receipt the write or check produces, `resolved_from`, naming what the Keeper originally wrote. A
 * model-sent one is never trusted for identity, only for this one field: this test sends it directly over RPC,
 * exactly as the host would after a fan-out question cleared a variant name, never as a model call.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRealCampaign } from "./harness.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "resolved-from-camp";
const NPC = "Steven Knott";

function rpc(workspace, requests) {
	const input = requests.map(([method, params], index) => JSON.stringify({ id: String(index), method, params })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	return run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
}
function ok(workspace, requests) {
	const frames = rpc(workspace, requests);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} (${requests[Number(frame.id)][0]}) failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
async function turnRecord(workspace, turn) {
	return JSON.parse(await readFile(join(workspace, ".coc/campaigns", CAMPAIGN, "turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));
}

test("§11.5.6 on the emitted kernel: `_resolved_from` rides the npc, person and roll receipts, and identity is unchanged", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "resolved-from-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));
	createRealCampaign(workspace, CAMPAIGN);
	ok(workspace, [["table.open", { campaign: CAMPAIGN }], ["table.player_input", { campaign: CAMPAIGN, text: "I look around." }]]);

	// A book NPC, placed here with a host-marked resolved_from on the npc effect's `name`.
	const [placed] = ok(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t1-c1",
		effects: [{ kind: "npc", name: NPC, to: "here", why: "he steps into the room", _resolved_from: "史蒂夫诺特" }] }]]);
	assert.equal(placed.receipts.length, 1);

	// The same person, labelled: a `person` effect's `who`, with its own resolved_from.
	ok(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t1-c2",
		effects: [{ kind: "person", who: NPC, address: "老诺特", why: "调查员这么称呼他", _resolved_from: "诺特先生" }] }]]);

	// A check against him: resolve's action carries the same host-only field.
	const [rolled] = ok(workspace, [["table.resolve", { campaign: CAMPAIGN, call_id: "t1-c3",
		action: { intent: "investigate", goal: "size him up", method: "watch him for a while", skill: "Spot Hidden",
			decision: "core-check:ordinary-check", target: NPC, _resolved_from: "史蒂夫诺特" } }]]);

	ok(workspace, [["table.narrate", { campaign: CAMPAIGN, call_id: "t1-c4", text: "Knott studies you back." }]]);
	const turn1 = await turnRecord(workspace, 1);

	const npcReceipt = turn1.receipts.find((receipt) => receipt.kind === "npc" && receipt.to != null);
	assert.equal(npcReceipt?.resolved_from, "史蒂夫诺特", `the npc effect's receipt: ${JSON.stringify(npcReceipt)}`);
	assert.equal(npcReceipt?.handle, "steven-knott", "identity is unchanged: the book's own handle, not a new person");

	const personReceipt = turn1.receipts.find((receipt) => receipt.kind === "person");
	assert.equal(personReceipt?.resolved_from, "诺特先生", `the person effect's receipt: ${JSON.stringify(personReceipt)}`);
	assert.equal(personReceipt?.who, "steven-knott");

	const rollReceipt = turn1.receipts.find((receipt) => receipt.kind === "roll");
	assert.equal(rollReceipt?.resolved_from, "史蒂夫诺特", `the check's roll receipt: ${JSON.stringify(rollReceipt)}`);
	assert.equal(rollReceipt?.npc, "steven-knott");

	// A batch with no `_resolved_from` at all carries none: this is additive, never inferred.
	ok(workspace, [["table.player_input", { campaign: CAMPAIGN, text: "I wait." }]]);
	const [plain] = ok(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t2-c1",
		effects: [{ kind: "npc", name: NPC, stance: "hostile" }] }]]);
	ok(workspace, [["table.narrate", { campaign: CAMPAIGN, call_id: "t2-c2", text: "He glares." }]]);
	const turn2 = await turnRecord(workspace, 2);
	const plainReceipt = turn2.receipts.find((receipt) => receipt.kind === "npc");
	assert.equal(Object.hasOwn(plainReceipt ?? {}, "resolved_from"), false, `no field when the host sends none: ${JSON.stringify(plainReceipt)}`);
});
