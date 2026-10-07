/**
 * The `momentary` time-cost row (contract §138.10.1; coordinator decision 2026-10-04, option a of the environment
 * acceptance's turn-4 finding).
 *
 * Turn 4 of `environment-v225-baseline-20261004`, "我在街边安静停留半分钟，只听听周围的声音，不碰门窗。": the clerk's band question
 * named `quick_observation` (0.99) and the kernel rolled 3 minutes inside 0-5. The table now has a row for an act of a moment,
 * `momentary` {min 0, default 0, max 1}, offered through the same closed band choice. Minutes stay whole: the row rolls 0 or
 * 1, an integer approximation of half a minute, never 30 seconds.
 *
 * - On the emitted kernel: `rules.bands` lists the row with its range, and `apply time {band: "momentary"}` rolls inside it
 *   with the seeded dice (both 0 and 1 occur across seeds), recorded `basis: banded`.
 * - Through the hybrid engine over the haunting (a stub Jev; the faux Keeper): the band question offers `momentary` among the
 *   kernel's rows, and when it names it the clerk charges 0 or 1 minute.
 *
 * Assertions are on rows, receipts and the question's options, never on prose.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createRealCampaign, openTable } from "./harness.mjs";
import { COMPILE_FAMILY, REASK_FAMILY, UNCLEAR } from "../../runtime/jev/route-compile.ts";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { BIND_FAMILY, ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INPUT = "我在街边安静停留半分钟，只听听周围的声音，不碰门窗。";

function kernelRun(workspace, requests, env = {}) {
	const input = requests.map(([method, params = {}], index) => JSON.stringify({ id: String(index), method, params: { campaign: "c", ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8", env: { ...process.env, ...env } });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} (${requests[Number(frame.id)][0]}) failed: ${JSON.stringify(frame.error)}`);
	return frames.sort((a, b) => Number(a.id) - Number(b.id)).map((frame) => frame.result);
}

test("§138.10.1 on the emitted kernel: rules.bands lists momentary 0-1 (default 0), and a banded time rolls 0 or 1 whole minutes", (t) => {
	const totals = new Set();
	for (const seed of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
		const workspace = mkdtempSync(join(tmpdir(), "momentary-"));
		t.after(() => rmSync(workspace, { recursive: true, force: true }));
		createRealCampaign(workspace, "c");
		const [bands, , , applied, status] = kernelRun(workspace, [["rules.bands", { field: "time.band" }], ["table.open"],
			["table.player_input", { text: INPUT }], ["table.apply", { call_id: "t1-c1", effects: [{ kind: "time", band: "momentary", why: "half a minute of listening" }] }],
			["table.status"]], { COC_KERNEL_SEED: seed });
		assert.deepEqual(bands.rows.find((row) => row.handle === "momentary"), { handle: "momentary", min: 0, max: 1, default: 0 });
		const receipt = status.receipts.find((row) => row.id === applied.receipts[0]);
		assert.deepEqual([receipt.kind, receipt.basis, receipt.band], ["time", "banded", "momentary"]);
		assert.deepEqual(receipt.band_roll, { min: 0, max: 1, total: receipt.minutes });
		assert.ok(Number.isInteger(receipt.minutes) && receipt.minutes >= 0 && receipt.minutes <= 1, `whole minutes inside the row: ${receipt.minutes}`);
		totals.add(receipt.minutes);
	}
	assert.deepEqual([...totals].sort(), [0, 1], "rolled with the seeded dice, not the row's default");
});

const baseQuestion = (question) => ({ ...question, key: question.key.replace(/__(?:semantic_facts|semantic_execution)$/, "") });
function issuedChoice(question, value, confidence = 0.9) {
	const keys = Object.keys(question.criteria);
	assert.ok(keys.includes(value), `fixture choice ${value} is not issued for ${question.key}`);
	return { status: "answered", type: "choice", choice: value, confidence,
		probabilities: Object.fromEntries(keys.map((key) => [key, keys.length === 1 ? 1 : key === value ? confidence : (1 - confidence) / (keys.length - 1)])) };
}
const choice = ([value, confidence], question) => issuedChoice(question, value, confidence);
const complete = (out) => ({ batchId: "b", status: "complete", answers: out, issues: [], coverage: { required: Object.keys(out), answered: Object.keys(out), unknown: [] } });

test("§138.10.1 through the hybrid engine: the band question offers momentary among the kernel's rows, and naming it charges 0 or 1 minute", async (t) => {
	const bands = [];
	let workspace;
	const decide = async (batch) => {
		if (batch.family === BIND_FAMILY) {
			bands.push(batch);
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(baseQuestion(question).key === "band" ? ["momentary", 0.9] : ["unknown", 0.9], question)])));
		}
		if (batch.family === COMPILE_FAMILY || batch.family === REASK_FAMILY)
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice([Object.hasOwn(question.criteria, "no") ? "no" : UNCLEAR, 0.9], question)])));
		const candidates = batch.state?.candidates ?? {};
		return complete(Object.fromEntries(batch.questions.map((question) => {
			if (question.key === "exit") return [question.key, choice(["finish", 0.9], question)];
			const index = baseQuestion(question).key.slice("need_".length), candidate = candidates[`candidate_${index}`];
			// The time candidate is asked by its own fact (§138.10): the declaration costs table time.
			if (batch.family === ROUTE_FAMILY && Object.hasOwn(question.criteria, "costs")) return [question.key, choice(["costs", 0.9], question)];
			const keys = Object.keys(question.criteria);
			return [question.key, choice([keys[0] === "now" ? "later" : question.criteria.seeks ? "not" : keys.includes("unknown") ? "unknown" : keys[0], 0.9], question)];
		})));
	};
	const engine = createHybridEngine({ env: process.env, decision: { decide } });
	const table = await openTable({ realKernel: true, prepareWorkspace: (at) => { workspace = at; kernelRun(at, [["table.open"],
		["table.player_input", { text: "我听他说完。" }], ["table.narrate", { call_id: "t1-c1", text: "诺特把委托说了一遍。" }]].map(([method, params = {}]) => [method, { ...params, campaign: "test-camp" }])); },
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你在街边站了一会儿，只听见远处的车声。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt(INPUT);

	const band = bands.flatMap((batch) => batch.questions).find((question) => question.key === "band");
	assert.ok(band, "the clerk's band question was asked");
	assert.ok(Object.hasOwn(band.criteria, "momentary") && Object.hasOwn(band.criteria, "quick_observation"), "momentary is one of the kernel's rows, beside the others");
	const record = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns/0002.json"), "utf8"));
	const time = record.receipts.filter((receipt) => receipt.kind === "time");
	assert.equal(time.length, 1, "time is charged once");
	assert.deepEqual([time[0].basis, time[0].band, time[0].band_roll?.min, time[0].band_roll?.max], ["banded", "momentary", 0, 1]);
	assert.ok([0, 1].includes(time[0].minutes), `0 or 1 whole minute, not 30 seconds: ${time[0].minutes}`);
});
