/**
 * Contract §202: a time cost fits the act.
 *
 * TR-F2 run 3 (App 4ce2e4cab, The Haunting), turn 16, 「我先不管楼上的动静，顺着走廊找通往地下室的门。找到了就用手电照着往下看，先不急着下去。」:
 * the clerk's declared-time band was `careful_house_search` (pooled .44 against single_room_search .29 and
 * quick_observation .12) and the kernel rolled 245 minutes inside 60-360. Jev had chosen among names: each criterion was
 * the row's handle and range, the rows said nothing about the act's extent, and no row was a few minutes of moving and
 * looking inside one place, or one known record brought to hand (turns 8-10 charged 205-401 minutes of
 * `library_research` for a property register).
 *
 * - On the emitted kernel: every time-cost row says what act it covers; the two new rows follow `momentary`, the
 *   seventeen before keep their values and positions; a row without `covers` is malformed; the new rows roll minutes and
 *   the long rows still roll hours.
 * - The question, over the kernel's own rows: each criterion is the row's name, range and `covers`.
 * - Through the hybrid engine over the haunting (the real kernel, a deterministic Jev, the faux Keeper): turn 16's line
 *   at the Corbitt house lands a time receipt of minutes; turn 9's request lands one record's time; a search of the whole
 *   house and an afternoon in the library still take hours.
 *
 * Assertions are on rows, receipts and the questions' criteria, never on prose.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createRealCampaign, openTable } from "./harness.mjs";
import { COMPILE_FAMILY, REASK_FAMILY, UNCLEAR } from "../../runtime/jev/route-compile.ts";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { BIND_FAMILY, ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { ROUTE_TIME_BANDS, timeQuestion } from "../../runtime/jev/band-shadow-domain.ts";
import { readBandRows } from "../../extensions/kernel/band-shadow.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TABLE_FILE = join(REPO, "content/rulesets/coc7/rules-json/time-costs.json");
const SHIPPED = JSON.parse(readFileSync(TABLE_FILE, "utf8")).categories;
/** The seventeen rows as they stood before §202 (handles, values, positions): §202.3 changes none of them. */
const BEFORE = [
	["speak_briefly", 0, 1, 3], ["quick_observation", 0, 1, 5], ["single_room_search", 10, 20, 45], ["careful_house_search", 60, 120, 360],
	["library_research", 60, 180, 480], ["local_travel", 10, 30, 120], ["long_travel", 120, 360, 1440], ["first_aid", 5, 15, 30],
	["medicine_treatment", 30, 60, 120], ["short_rest", 60, 120, 240], ["sleep_night", 360, 480, 600], ["therapy_week", 10080, 20160, 30240],
	["therapy_month", 40320, 43200, 44640], ["spell_learning", 2016, 18144, 36288], ["tome_study", 168, 1344, 6720],
	["investigation_recovery", 5, 30, 60], ["momentary", 0, 0, 1],
];
/** §202.3: the two rungs the ladder lacked. */
const ADDED = [["brief_activity", 2, 5, 10], ["record_lookup", 10, 20, 45]];

const T16 = "我先不管楼上的动静，顺着走廊找通往地下室的门。找到了就用手电照着往下看，先不急着下去。";
const T9 = "我请档案职员帮我调出科比特家那栋房子的产权登记，看看沃尔特·科比特是怎么处置这房子的，他后来又怎么样了。";
const WHOLE_HOUSE = "我把这栋房子从地下室到阁楼一间一间仔细搜一遍，每个抽屉、柜子和地板缝都不放过。";
const LIBRARY_AFTERNOON = "我在中央图书馆待一下午，一卷一卷地翻旧报纸的缩微胶片，把科比特宅所有的报道都找出来。";

function kernelRun(workspace, requests, { env = {}, content = join(REPO, "content") } = {}) {
	const input = requests.map(([method, params = {}], index) => JSON.stringify({ id: String(index), method, params: { campaign: "c", ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", content],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8", env: { ...process.env, ...env } });
	return run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress)
		.sort((a, b) => Number(a.id) - Number(b.id));
}
function kernelResults(workspace, requests, options) {
	const frames = kernelRun(workspace, requests, options);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} (${requests[Number(frame.id)][0]}) failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
const scratch = (t, prefix) => {
	const at = mkdtempSync(join(tmpdir(), prefix));
	t.after(() => rmSync(at, { recursive: true, force: true }));
	return at;
};

test("§202.1/§202.3 on the emitted kernel: every time-cost row says what act it covers; the two new rungs follow momentary and the seventeen before are unchanged", (t) => {
	const [bands] = kernelResults(scratch(t, "time-fit-"), [["rules.bands", { field: "time.band" }]]);
	assert.deepEqual(bands.rows.map((row) => [row.handle, row.min, row.default, row.max]), [...BEFORE, ...ADDED]);
	for (const row of bands.rows) {
		assert.equal(typeof row.covers, "string", `${row.handle} carries covers`);
		assert.ok(row.covers.trim().length > 0, `${row.handle}'s covers is not blank`);
		assert.equal(row.covers, SHIPPED[row.handle].covers.trim(), `${row.handle}'s covers is the table's own`);
	}
	assert.equal(bands.rows.findIndex((row) => row.handle === "momentary"), 16, "momentary keeps its position");
});

test("§202.1 a time-cost row without covers is malformed: rules.bands and apply time {band} fail naming the table and the row", (t) => {
	const content = join(scratch(t, "time-fit-content-"), "content");
	cpSync(join(REPO, "content"), content, { recursive: true });
	const path = join(content, "rulesets/coc7/rules-json/time-costs.json");
	const table = JSON.parse(readFileSync(path, "utf8"));
	table.categories.single_room_search.covers = "   ";
	writeFileSync(path, JSON.stringify(table, null, 2));
	const workspace = scratch(t, "time-fit-");
	createRealCampaign(workspace, "c");
	const frames = kernelRun(workspace, [["rules.bands", { field: "time.band" }], ["table.open"], ["table.player_input", { text: T16 }],
		["table.apply", { call_id: "t1-c1", effects: [{ kind: "time", band: "brief_activity", why: "a walk down a corridor" }] }]], { content });
	for (const index of [0, 3]) {
		assert.equal(frames[index].ok, false, `step ${index} refused`);
		assert.equal(frames[index].error.code, "campaign_not_ready");
		assert.deepEqual([frames[index].error.details.table, frames[index].error.details.row], ["time-costs", "single_room_search"]);
		assert.match(frames[index].error.fix, /rules-json\/time-costs\.json/);
	}
});

test("§202.3 on the emitted kernel: brief_activity rolls minutes, record_lookup one record's time, and the long rows still roll hours", (t) => {
	const totals = { brief_activity: new Set(), record_lookup: new Set(), careful_house_search: new Set(), library_research: new Set() };
	for (const seed of ["1", "2", "3", "4", "5", "6"]) {
		const workspace = scratch(t, "time-fit-roll-");
		createRealCampaign(workspace, "c");
		const bands = Object.keys(totals);
		const results = kernelResults(workspace, [["table.open"], ["table.player_input", { text: T16 }],
			...bands.map((band, index) => ["table.apply", { call_id: `t1-c${index + 1}`, effects: [{ kind: "time", band, why: `a ${band}` }] }]),
			["table.status"]], { env: { COC_KERNEL_SEED: seed } });
		const status = results.at(-1);
		for (const [index, band] of bands.entries()) {
			const receipt = status.receipts.find((row) => row.id === results[2 + index].receipts[0]);
			const [, min, , max] = [...BEFORE, ...ADDED].find(([handle]) => handle === band);
			assert.deepEqual([receipt.basis, receipt.band, receipt.band_roll.min, receipt.band_roll.max], ["banded", band, min, max]);
			assert.ok(receipt.minutes >= min && receipt.minutes <= max, `${band} rolled ${receipt.minutes} inside ${min}-${max}`);
			totals[band].add(receipt.minutes);
		}
	}
	assert.ok(Math.max(...totals.brief_activity) <= 10, "a few minutes never reaches a quarter hour");
	assert.ok(Math.max(...totals.record_lookup) <= 45, "one record never reaches an hour");
	assert.ok(Math.min(...totals.careful_house_search) >= 60 && Math.min(...totals.library_research) >= 60, "a whole house and a library session still take hours");
	assert.ok(totals.brief_activity.size > 1, "rolled with the seeded dice, not the default");
});

test("§202.2 the time question over the kernel's own rows: each criterion is the row's name, range and covers; the road rows stay out", (t) => {
	const [answer] = kernelResults(scratch(t, "time-fit-"), [["rules.bands", { field: "time.band" }]]);
	const read = readBandRows("time", answer);
	assert.ok(read && read.rows.every((row) => typeof row.covers === "string" && row.covers.length > 0), "the host keeps every row's covers");
	const question = timeQuestion(read.rows);
	for (const road of ROUTE_TIME_BANDS) assert.ok(!Object.hasOwn(question.criteria, road), `${road} is a road's time, never offered`);
	for (const row of read.rows.filter((value) => !ROUTE_TIME_BANDS.includes(value.handle)))
		assert.equal(question.criteria[row.handle], `${row.handle.replace(/_/g, " ")}, ${row.min} to ${row.max} minutes: ${SHIPPED[row.handle].covers}`);
	assert.ok(Object.hasOwn(question.criteria, "brief_activity") && Object.hasOwn(question.criteria, "record_lookup"));
	assert.ok(Object.hasOwn(question.criteria, "unknown"), "the exit stays");
	assert.match(question.instructions, /extent/, "the question asks the act's extent, not only its kind");
});

// ---- through the hybrid engine ---------------------------------------------------------------------------------------

const baseKey = (key) => key.replace(/__(?:semantic_facts|semantic_execution)$/, "");
function issuedChoice(question, value, confidence = 0.9) {
	const keys = Object.keys(question.criteria);
	assert.ok(keys.includes(value), `fixture choice ${value} is not issued for ${question.key}`);
	return { status: "answered", type: "choice", choice: value, confidence,
		probabilities: Object.fromEntries(keys.map((key) => [key, keys.length === 1 ? 1 : key === value ? confidence : (1 - confidence) / (keys.length - 1)])) };
}
const complete = (out) => ({ batchId: "b", status: "complete", answers: out, issues: [], coverage: { required: Object.keys(out), answered: Object.keys(out), unknown: [] } });

/** Turn 1 puts the investigator at `scene` through the kernel's own RPC; turn 2 is the line under test. */
const arrive = (scene, unlock) => (workspace) => kernelResults(workspace, [["table.open"], ["table.player_input", { text: "我接下委托，动身。" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: unlock, how: "诺特交代了去处。", label: "去处" }, { kind: "move", to: scene }] }],
	["table.narrate", { call_id: "t1-c2", text: "你到了。" }]].map(([method, params = {}]) => [method, { ...params, campaign: "test-camp" }]));

/**
 * One declared turn through the engine with a deterministic Jev: the route judges that the declaration costs table time
 * (the time candidate's fact), the bind names `band`, everything else stays out of the way. Returns the band question
 * the clerk asked and the turn's time receipts.
 */
async function declare(t, { scene, unlock, input, band }) {
	const bindQuestions = [];
	let workspace;
	const decide = async (batch) => {
		if (batch.family === BIND_FAMILY) {
			bindQuestions.push(...batch.questions);
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
				issuedChoice(question, baseKey(question.key) === "band" ? band : "unknown")])));
		}
		if (batch.family === COMPILE_FAMILY || batch.family === REASK_FAMILY)
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, issuedChoice(question, Object.hasOwn(question.criteria, "no") ? "no" : UNCLEAR)])));
		return complete(Object.fromEntries(batch.questions.map((question) => {
			if (question.key === "exit") return [question.key, issuedChoice(question, "finish")];
			if (batch.family === ROUTE_FAMILY && Object.hasOwn(question.criteria, "costs")) return [question.key, issuedChoice(question, "costs")];
			const keys = Object.keys(question.criteria);
			return [question.key, issuedChoice(question, keys[0] === "now" ? "later" : question.criteria.seeks ? "not" : keys.includes("unknown") ? "unknown" : keys[0])];
		})));
	};
	const engine = createHybridEngine({ env: process.env, decision: { decide } });
	const table = await openTable({ realKernel: true, prepareWorkspace: (at) => { workspace = at; arrive(scene, unlock)(at); },
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你照着做了。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt(input);
	const record = JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/turns/0002.json"), "utf8"));
	assert.equal(record.player_text, input, "the turn under test is the declared line");
	return { question: bindQuestions.find((question) => question.key === "band"), time: record.receipts.filter((receipt) => receipt.kind === "time") };
}

test("§202 run 3 turn 16 through the hybrid engine: a walk down a corridor to a door is a few minutes, not a house search", async (t) => {
	const { question, time } = await declare(t, { scene: "corbitt-house-ground", unlock: "knott-keys", input: T16, band: "brief_activity" });
	assert.ok(question, "the clerk asked the band question");
	assert.equal(question.criteria.brief_activity, `brief activity, 2 to 10 minutes: ${SHIPPED.brief_activity.covers}`, "the row is offered by what it covers");
	assert.equal(question.criteria.careful_house_search, `careful house search, 60 to 360 minutes: ${SHIPPED.careful_house_search.covers}`);
	assert.equal(time.length, 1, "time is charged once");
	assert.deepEqual([time[0].basis, time[0].band, time[0].band_roll.min, time[0].band_roll.max], ["banded", "brief_activity", 2, 10]);
	assert.ok(time[0].minutes <= 10, `in proportion to a corridor and a look down the stairs: ${time[0].minutes} minutes (run 3 charged 245)`);
});

test("§202 run 3 turn 9 through the hybrid engine: a clerk fetching one register is one record's time, not hours of research", async (t) => {
	const { question, time } = await declare(t, { scene: "hall-of-records", unlock: "knott-research-leads", input: T9, band: "record_lookup" });
	assert.equal(question.criteria.record_lookup, `record lookup, 10 to 45 minutes: ${SHIPPED.record_lookup.covers}`);
	assert.equal(time.length, 1);
	assert.deepEqual([time[0].band, time[0].band_roll.min, time[0].band_roll.max], ["record_lookup", 10, 45]);
	assert.ok(time[0].minutes <= 45, `one record brought to hand: ${time[0].minutes} minutes (run 3 charged 401)`);
});

test("§202 long acts through the hybrid engine still take hours: a whole house searched room by room, an afternoon in the library", async (t) => {
	for (const [scene, unlock, input, band] of [["corbitt-house-ground", "knott-keys", WHOLE_HOUSE, "careful_house_search"],
		["central-library", "knott-research-leads", LIBRARY_AFTERNOON, "library_research"]]) {
		const { time } = await declare(t, { scene, unlock, input, band });
		assert.equal(time.length, 1, `${band}: time is charged once`);
		assert.equal(time[0].band, band);
		assert.ok(time[0].minutes >= 60, `${band} takes at least an hour: ${time[0].minutes}`);
	}
});
