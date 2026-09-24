/**
 * SL-15 (spec pi-native-single-loop, Ruling "The Keeper is shown what the run has read"; contract §135.31): before each
 * model step the `coc-clerk` message carries what the run has read that the Keeper would otherwise `look` for -- the
 * scene it moved into, the card of each person a candidate names, the session underway -- exactly as `look` returns
 * them, under §135.20's ceilings. A `look`/`lookup` the Keeper still makes is recorded with its arguments and its step,
 * and the turn record keeps the arguments beside their digest.
 *
 * On the emitted kernel through the vendored driver, with the faux provider and a stub Jev (the kernel is the subject:
 * the views are the kernel's own reads), plus the pure ceilings over stub reads.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createRealCampaign, openTable } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { BIND_FAMILY, ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { CARD_FIELD_ORDER, CARRIED_VIEW_BYTES, CARRIED_VIEWS_BYTES, CARRIED_VIEWS_HEAD, carriedSection, fitView, namedPeople, PRESENT_FIELDS, readCarriedViews } from "../../runtime/jev/carried-views.ts";
import { readArguments } from "../../extensions/kernel/index.ts";
import { isRunEvent } from "./pi-agent-core.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const size = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** A Jev answer in the adapter's result shape: `pick(question)` returns a choice or undefined (then "later" / "continue"). */
function answered(batch, pick = () => undefined) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = pick(question) ?? (question.key === "exit" ? "continue" : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown");
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/** Kernel requests on a workspace through the emitted kernel's own RPC; every frame, in order. */
function kernelFrames(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: CAMPAIGN, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	return run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
}
/** The same, each frame's result; a failed one throws. */
function kernelSteps(workspace, requests) {
	const frames = kernelFrames(workspace, requests);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}

/** The Knott fight of SL-07/SL-08's seam tests: turn 1 opened it, the landlord owes a defence when the player speaks again. */
const knottFight = (extra = []) => (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我揍他" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "npc", name: "Steven Knott", archetype: "ordinary_adult", why: "test fixture" }] }],
	["table.resolve", { call_id: "t1-c2", action: { intent: "combat", goal: "hit him", method: "fists", target: "Steven Knott", weapon: "unarmed" } }],
	...extra.map((effect, index) => ["table.apply", { call_id: `t1-c${3 + index}`, effects: [effect] }]),
	["table.narrate", { call_id: `t1-c${3 + extra.length}`, text: "你挥出一拳。" }],
]);

async function hybridTable({ decide, responses, prepareWorkspace }) {
	const decisions = [], events = [], requests = [];
	const engine = createHybridEngine({ env: process.env, decision: { decide: async (batch, lease) => { decisions.push(batch); return decide(batch, decisions.length, lease); } } });
	const table = await openTable({
		// The kernel's dice are seeded, so the fight's rounds are the same on every run.
		realKernel: true, prepareWorkspace, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: "7" },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: responses.map((response) => (context) => { requests.push(context); return response; }),
	});
	table.session.subscribe((event) => { if (isRunEvent(event)) events.push(event); });
	return { table, decisions, events, requests, dispose: () => table.dispose() };
}

/** The `coc-clerk` notes a request carries, in order. */
const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});
/** The views the last note of a request carried. */
const carriedIn = (context) => clerkNotes(context).at(-1)?.carried;
const recordOf = (table, turn) => JSON.parse(readFileSync(join(table.table.workspace, ".coc/campaigns", CAMPAIGN, "turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));

/** Two notes are the same note when their JSON is: dedupe the repeats across requests. */
function newCarried(requests) {
	const seen = new Set(), out = [];
	for (const context of requests) for (const note of clerkNotes(context)) {
		const key = JSON.stringify(note);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(note.carried);
	}
	return out;
}
const pick = (row, keys) => Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** The table has been told where to dig (the lead clue landed on turn 1), so the kernel issues the Globe as a move. */
const toldWhereToDig = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我听着" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "he said so" }] }],
	["table.narrate", { call_id: "t1-c2", text: "他递给你一张写着地方的纸。" }],
]);

test("§135.31 after a clerk move: the scene the run moved into and the people the fresh read's candidates name, each as look returns it, whole under the carried view's own 4 KiB", async (t) => {
	let routes = 0;
	const table = await hybridTable({
		prepareWorkspace: toldWhereToDig,
		// First route: the move the player declared; after it, nothing more before the Keeper writes the prose. The §135.30
		// compile answers `unknown` here (the default), so nothing clears and the move reaches the route.
		decide: (batch) => batch.family !== ROUTE_FAMILY ? answered(batch)
			: ++routes === 1 ? answered(batch, (question) => question.key === "exit" ? "continue" : /Boston Globe offices/.test(question.target) ? "now" : undefined)
				: answered(batch, (question) => question.key === "exit" ? "finish" : undefined),
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "你到了报馆。" })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("我去《环球报》报馆。");
	const { requests } = table;
	assert.equal(requests.length, 1, "one model step: the prose after the clerk's move");
	const carried = carriedIn(requests[0]);
	assert.ok(carried, "the Keeper's note carries what the run read");
	assert.equal(carried.head, CARRIED_VIEWS_HEAD);
	const byFocus = (focus) => carried.views.filter((entry) => entry.focus === focus);

	// The scene: the run began at Knott's office and the clerk moved it to the Globe, so its view is carried: look's own
	// `{where, present}`, whole (the Globe's is under 4 KiB): exits, affordances and the people there travel with it.
	const [scene] = byFocus("scene");
	assert.equal(scene?.name, "newspaper-morgue");
	const [lookScene, lookArty, lookRuth] = kernelSteps(table.table.workspace, [["table.look", { focus: "scene" }],
		["table.look", { focus: "npc", name: "Arty Wilmot" }], ["table.look", { focus: "npc", name: "Ruth Blake" }]]);
	assert.equal(scene.truncated, undefined, `the Globe's scene view is ${size(lookScene)} bytes: carried whole`);
	assert.deepEqual(scene.view.where, lookScene.where, "the scene view is look focus=scene");
	// `present` is reduced to who is there: name, called and role; the dossiers are what the person cards carry.
	assert.deepEqual(scene.view.present, lookScene.present.map((person) => Object.fromEntries(PRESENT_FIELDS.filter((key) => Object.hasOwn(person, key)).map((key) => [key, person[key]]))));
	assert.ok(scene.view.present.length > 0 && scene.view.present.every((person) => Object.keys(person).every((key) => PRESENT_FIELDS.includes(key))));
	assert.ok(lookScene.present.some((person) => Object.hasOwn(person, "wants")), "the look's own present carries dossiers; the carried one does not");
	assert.ok(scene.view.where.affordances.length > 0 && scene.view.where.exits.length > 0);

	// The people: the gatekeeper the Globe's obligation puts in the way (its carried meeting) and the archivist the Mod's
	// first-impression check targets; the investigator is never among them.
	const people = byFocus("npc");
	assert.deepEqual(people.map((entry) => entry.name).sort(), ["Arty Wilmot", "Ruth Blake"]);
	for (const [entry, look] of [[people.find((value) => value.name === "Arty Wilmot"), lookArty], [people.find((value) => value.name === "Ruth Blake"), lookRuth]]) {
		const { kind: _kind, ...card } = look;
		assert.deepEqual(pick(entry.view, ["name", "id", "role", "wants", "fears", "hides", "voice"]), pick(card, ["name", "id", "role", "wants", "fears", "hides", "voice"]),
			"a person's view is look focus=npc");
		assert.equal(entry.truncated, undefined, `a card of ${size(card)} bytes travels whole`);
		assert.deepEqual(Object.keys(entry.view).sort(), Object.keys(card).sort(), "every field of the card, mechanics and the combat fields among them");
		assert.ok(Object.hasOwn(entry.view, "mechanics"));
	}
	assert.ok(!JSON.stringify(carried.views).includes('"id":"thomas-hayes"'));

	// The carried section's own ceilings: one view at most 4 KiB, the message's views at most 12 KiB; the row says what went.
	for (const entry of carried.views) assert.ok(size(entry.view) <= CARRIED_VIEW_BYTES, `${entry.focus} ${entry.name} is ${size(entry.view)} bytes`);
	assert.ok(size(carried.views) <= CARRIED_VIEWS_BYTES);
	const rows = table.table.telemetry(CAMPAIGN).filter((row) => row.lane === "run" && row.event === "carried");
	assert.equal(rows.length, 1);
	assert.deepEqual(rows[0].views.map((view) => view.focus).sort(), ["npc", "npc", "scene"]);
	assert.equal(rows[0].reads, 3, "the scene and the two cards were read by the host for this step");
});

test("§135.31 at a pending defence: the defender's card and the session view, byte-identical to look focus=session", async (t) => {
	const table = await hybridTable({
		prepareWorkspace: knottFight(),
		// Jev: Knott's disposition once, then his standing attack runs; every route finishes.
		decide: (batch) => batch.family === BIND_FAMILY
			? answered(batch, (question) => question.key === "disposition" ? "fights_to_the_end" : "unknown")
			: answered(batch, (question) => question.key === "exit" ? "finish" : undefined),
		responses: [fauxAssistantMessage([fauxToolCall("narrate", { text: "他的拳头朝你脸上砸来，你侧身闪开。" })], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("继续揍他");
	const { requests } = table;
	assert.equal(requests.length, 1);
	const carried = carriedIn(requests[0]);
	const [lookSession, lookKnott] = kernelSteps(table.table.workspace, [["table.look", { focus: "session" }], ["table.look", { focus: "npc", name: "steven-knott" }]]);

	const session = carried.views.find((entry) => entry.focus === "session");
	assert.ok(session, "a session is active: its view is carried");
	assert.deepEqual(session.view, { session: lookSession.session, pending_choice: lookSession.pending_choice }, "exactly what look focus=session returns");
	assert.equal(session.truncated, undefined);

	// Knott: the actor of the pending defence the clerk settled (and of the disposition write and his attack).
	const knott = carried.views.find((entry) => entry.focus === "npc");
	assert.equal(knott.view.id, "steven-knott");
	const { kind: _kind, ...card } = lookKnott;
	assert.deepEqual(pick(knott.view, ["name", "id", "role", "wants"]), pick(card, ["name", "id", "role", "wants"]));
	assert.equal(knott.truncated, undefined, `his card (${size(card)} bytes) travels whole`);
	assert.deepEqual(Object.keys(knott.view).sort(), Object.keys(card).sort());
	assert.ok(Object.hasOwn(knott.view, "mechanics"), "the field that says whether he has a stat block");
	assert.deepEqual(carried.views.map((entry) => entry.focus), ["session", "npc"], "served session, then people; no scene: the run did not move");
	assert.equal(carried.views.filter((entry) => entry.focus === "npc").length, 1, "the investigator (the attacker, the target) is not a person here");
	assert.equal(carried.omitted, undefined);
});

test("§135.31 with a session active: carried before every model step it changed for, never repeated unchanged; a Keeper look is recorded with its arguments and step, and the turn record keeps them beside the digest", async (t) => {
	const table = await hybridTable({
		prepareWorkspace: knottFight(),
		decide: (batch) => batch.family === BIND_FAMILY
			? answered(batch, (question) => question.key === "disposition" ? "fights_to_the_end" : "unknown")
			: answered(batch, (question) => question.key === "exit" ? "finish" : undefined),
		responses: [
			// Round 2 is the investigator's: the Keeper resolves his punch (the session changes); then it looks anyway; then prose.
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "combat", decision: "combat:attack", goal: "hit him again", method: "fists", target: "Steven Knott", weapon: "unarmed" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("look", { focus: "session" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你们扭打在一起。" })], { stopReason: "toolUse" }),
		],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("继续揍他");
	const { requests, events } = table;
	assert.equal(requests.length, 3);
	const sections = newCarried(requests).filter(Boolean);
	assert.equal(sections.length, 2, "carried before the first step and before the step after the fight changed; not before the step after the Keeper's look");
	const [first, second] = sections;
	assert.deepEqual(first.views.map((entry) => entry.focus), ["session", "npc"]);
	assert.deepEqual(second.views.map((entry) => entry.focus), ["session"], "the changed session again; Knott's card is not repeated");
	assert.notDeepEqual(first.views[0].view, second.views[0].view);
	assert.equal(second.views[0].view.session.round, first.views[0].view.session.round + 1, "the Keeper's punch closed a round");
	const [lookSession] = kernelSteps(table.table.workspace, [["table.look", { focus: "session" }]]);
	assert.deepEqual(second.views[0].view, { session: lookSession.session, pending_choice: lookSession.pending_choice });
	const rows = table.table.telemetry(CAMPAIGN);
	assert.equal(rows.filter((row) => row.lane === "run" && row.event === "carried").length, 2);

	// The Keeper looked anyway: its row keeps the arguments and the step, and the turn record keeps them beside the digest.
	const look = rows.find((row) => row.tool === "look");
	assert.deepEqual(look.args, { focus: "session" });
	assert.equal(look.origin, "model");
	const prepared = events.find((event) => event.type === "operation_prepared" && event.operation === "look");
	assert.equal(look.run, prepared.runId);
	assert.equal(look.step, prepared.stepId, "the step the model call came from");
	const record = recordOf(table, 2);
	assert.deepEqual(record.reads, [{ tool: "look", args: { focus: "session" }, params_sha256: sha256('{"focus":"session"}'), ok: true, run: prepared.runId, step: prepared.stepId }]);
});

test("§135.31 on the legacy engine: a look row keeps its arguments (no run step), and the turn record keeps the turn's reads", async (t) => {
	const table = await openTable({
		realKernel: true, prepareWorkspace: toldWhereToDig,
		responses: [
			fauxAssistantMessage([fauxToolCall("look", { focus: "npc", name: "Steven Knott" }), fauxToolCall("lookup", { kind: "module", query: "x".repeat(260) })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特点了点头。" })], { stopReason: "toolUse" }),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我问诺特还有什么要交代的");
	const rows = table.telemetry(CAMPAIGN);
	const look = rows.find((row) => row.tool === "look"), lookup = rows.find((row) => row.tool === "lookup");
	assert.deepEqual(look.args, { focus: "npc", name: "Steven Knott" });
	assert.equal(look.about, "Steven Knott", "the old columns stay");
	assert.equal(look.origin, undefined);
	assert.equal(look.step, undefined);
	assert.equal(lookup.args.query, "x".repeat(200), "a long argument is cut at 200 code points");
	assert.deepEqual(lookup.args_cut, ["query"]);
	const reads = JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "turns", "0002.json"), "utf8")).reads;
	assert.deepEqual(reads.map((read) => [read.tool, read.ok]), [["look", true], ["lookup", true]]);
	assert.deepEqual(reads[0], { tool: "look", args: { focus: "npc", name: "Steven Knott" }, params_sha256: sha256('{"focus":"npc","name":"Steven Knott"}'), ok: true });
});

test("§135.31 in the kernel: keeper_reads is host-only, shape-checked, and outside the delivery's idempotency digest", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const workspace = mkdtempSync(join(tmpdir(), "sl15-kernel-"));
	try {
		createRealCampaign(workspace, CAMPAIGN);
		const read = { tool: "lookup", args: { kind: "module", query: "Steven Knott", expected_kind: "npc" }, ok: true, run: "run-1", step: "run-1:s3" };
		const frames = kernelFrames(workspace, [
			["table.open", {}], ["table.player_input", { text: "我听着" }],
			["table.narrate", { call_id: "t1-c1", text: "他点头。", keeper_reads: [{ tool: "recall", args: {} }] }],
			["table.narrate", { call_id: "t1-c1", text: "他点头。", keeper_reads: [read] }],
			["table.narrate", { call_id: "t1-c1", text: "他点头。", keeper_reads: [read, read] }],
		]);
		assert.equal(frames[2].ok, false);
		assert.equal(frames[2].error.code, "invalid_params", "only look and lookup calls ride on a delivery");
		assert.equal(frames[3].ok, true);
		assert.equal(frames[4].ok, true, "a replay with other reads is the same delivery, not an idempotency conflict");
		assert.equal(frames[4].result.replayed, true);
		const record = JSON.parse(readFileSync(join(workspace, ".coc/campaigns", CAMPAIGN, "turns", "0001.json"), "utf8"));
		assert.deepEqual(record.reads, [{ ...read, params_sha256: sha256('{"expected_kind":"npc","kind":"module","query":"Steven Knott"}') }],
			"the digest is the kernel's canonical one (sorted keys), the one calls keeps for a write");
		assert.equal(Object.hasOwn(record.calls["t1-c1"], "keeper_reads"), false);
	} finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("§135.31 ceilings: each view at most 4 KiB and the message's at most 12 KiB (not §135.20's 1/8 KiB), served session, people, scene; a cut is named and what does not fit or resolve is listed", async () => {
	const big = (n) => "w".repeat(n);
	const card = (name) => ({ kind: "npc", name, id: name.toLowerCase(), role: "r", wants: big(1200), fears: big(1200), hides: big(1200), mechanics: { hp: 9 }, properties: { note: big(2000) } });
	const calls = [];
	const call = async (method, params) => {
		calls.push([method, params]);
		if (params.focus === "scene") return { where: { scene: "hall", display_name: "Hall", summary: "s", exits: [{ to: "a" }], affordances: big(6000) }, present: [{ name: "P", note: big(2000) }] };
		if (params.name === "Nobody") { const error = new Error("no npc"); error.code = "unknown_entity"; throw error; }
		if (params.name === "Broken") throw new Error("kernel down");
		return card(params.name);
	};
	const names = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "Nobody", "Broken"];
	const session = { session: { kind: "combat", round: 1, participants: [{ name: "a", note: big(6000) }] }, pending_choice: null };
	const carried = await readCarriedViews({ call, scene: "hall", people: names, skip: new Set(["A9"]), session });
	assert.equal(carried.views[0].focus, "session");
	assert.ok(carried.views.every((entry) => size(entry.view) <= CARRIED_VIEW_BYTES));
	assert.ok(carried.views.some((entry) => size(entry.view) > 1024), "not §135.20's 1 KiB body ceiling");
	const section = carriedSection(carried);
	assert.ok(size(section.views) <= CARRIED_VIEWS_BYTES, `the message's views are ${size(section.views)} bytes`);
	assert.ok(size(section.views) > 8 * 1024, "not §135.20's 8 KiB section ceiling");
	assert.ok(carried.bytes <= CARRIED_VIEWS_BYTES);
	// A wrapper's fields are the view's fields for the cut: the trailing `pending_choice` goes first, then (the first three
	// fields are kept, as fitBody keeps a body's identity) long strings are clipped.
	assert.deepEqual(carried.views[0].omitted_fields, ["pending_choice"]);
	assert.equal(carried.views[0].view.session.kind, "combat");
	assert.ok(carried.views[0].view.session.participants[0].note.endsWith("…"));
	const person = carried.views.find((entry) => entry.focus === "npc");
	assert.equal(person.truncated, true);
	assert.deepEqual(person.omitted_fields, ["properties"]);
	assert.equal(person.view.mechanics.hp, 9);
	// The budget runs out among the people: the rest and the scene are listed, never dropped silently.
	assert.ok(section.omitted.some((entry) => entry.focus === "npc" && entry.reason === "budget"));
	const order = ["session", "npc", "scene"];
	assert.deepEqual(carried.views.map((entry) => order.indexOf(entry.focus)), carried.views.map((entry) => order.indexOf(entry.focus)).sort(), "served session, people, scene");
	assert.ok(carried.views.some((entry) => entry.focus === "scene") || section.omitted.some((entry) => entry.focus === "scene" && entry.reason === "budget"));
	assert.deepEqual(section.omitted.find((entry) => entry.name === "Nobody"), { focus: "npc", name: "Nobody", reason: "not_found" });
	assert.deepEqual(section.omitted.find((entry) => entry.name === "Broken"), { focus: "npc", name: "Broken", reason: "read_failed" });
	assert.ok(!calls.some(([, params]) => params.name === "A9"), "a person already shown is not read again");
	assert.ok(!JSON.stringify(section).includes('"read"'), "the host's reads stay off the Keeper's section");
	// The scene alone: cut over where's fields in order, present first to go.
	const scene = fitView({ where: { scene: "hall", display_name: "Hall", summary: "s", exits: [{ to: "a" }], affordances: big(6000) }, present: [{ name: "P" }] });
	assert.deepEqual(scene.view.where.scene, "hall");
	assert.deepEqual(scene.omitted_fields, ["where.affordances", "present"]);
	assert.ok(size(scene.view) <= CARRIED_VIEW_BYTES);
});

test("§135.31 the clerk orders a card before it cuts: mechanics and the fight's fields travel, the prose tail goes; a scene's present is who is there", async () => {
	// A card shaped like the gate's Knott two turns in (8 KB): the kernel puts mechanics and the combat fields after about
	// 5.5 KB of dossier, knowledge and ledger, so a cut in the kernel's order drops them.
	const long = (n) => "p".repeat(n);
	const card = { kind: "npc", name: "Steven Knott", called: { name: "Knott" }, id: "steven-knott", node_id: "npc-steven-knott", scene: "office", summary: "s",
		visibility: "keeper-only", role: "employer", wants: "rent", fears: "ruin", hides: "rumour", voice: long(80), personality: long(1200), "in exchange": long(900),
		knows: [{ clue: "c", summary: long(500) }], would_lie_about: ["x"], ledger: { note: long(700) }, keeper_note: long(150), social_role: long(290),
		deflect_options: [{ deflect_id: "d", player_safe_line: long(150) }], lie_options: [], availability: null, mechanics: null,
		combat_tactic: { defense: null, basis: "rule-default" }, combat_disposition: { disposition: null, options: { a: long(900) } },
		combat_standing: { action: null, basis: "rule-default" }, properties: { note: long(600) }, recent_speech: [long(1200)], reunion: { background: [long(1000)] } };
	const call = async (method, params) => params.focus === "scene"
		? { where: { scene: "office", display_name: "Office", summary: "s", dramatic_question: long(80), pressure_moves: [long(130)], exits: [{ to: "a" }],
			affordances: [{ id: "f", cue: long(300) }], keeper_notes: [long(270)] }, present: [{ name: "Steven Knott", called: { name: "Knott" }, role: "employer", wants: long(2000), hides: long(2000) }] }
		: card;
	assert.ok(size(card) > 8000);
	const carried = await readCarriedViews({ call, scene: "office", people: ["Steven Knott"] });
	const knott = carried.views.find((entry) => entry.focus === "npc");
	assert.equal(knott.truncated, true);
	for (const field of ["mechanics", "combat_tactic", "combat_disposition", "combat_standing", "deflect_options", "wants", "fears", "hides"])
		assert.ok(Object.hasOwn(knott.view, field), `${field} travels`);
	assert.deepEqual(Object.keys(knott.view).slice(0, 6), ["name", "called", "id", "role", "scene", "visibility"], "identity first");
	assert.ok(knott.omitted_fields.includes("reunion") && knott.omitted_fields.includes("recent_speech"), "the prose tail goes");
	assert.ok(!knott.omitted_fields.some((field) => CARD_FIELD_ORDER.includes(field) && CARD_FIELD_ORDER.indexOf(field) < CARD_FIELD_ORDER.indexOf("keeper_note")
		&& ["mechanics", "combat_tactic", "combat_disposition", "combat_standing", "deflect_options"].includes(field)));
	assert.ok(size(knott.view) <= CARRIED_VIEW_BYTES);
	// The scene: present is who is there, whatever look put in it; exits and affordances travel ahead of the prose.
	const scene = carried.views.find((entry) => entry.focus === "scene");
	assert.deepEqual(scene.view.present, [{ name: "Steven Knott", called: { name: "Knott" }, role: "employer" }]);
	assert.equal(scene.truncated, undefined, "reduced to who is there, the view fits whole");
});

test("§135.31 who a candidate names: closed fields of its structure, never its words", () => {
	assert.deepEqual(namedPeople({ family: "combat", bound: { decision: "combat:defend", actor: "steven-knott" },
		basis: { path: "context.session.pending_defense", row: { actor: "steven-knott", attacker: "thomas-hayes" } } }), ["steven-knott", "thomas-hayes"]);
	assert.deepEqual(namedPeople({ family: "npc", bound: { kind: "npc", name: "steven-knott", why: "Steven Knott is scared of Arty Wilmot" } }), ["steven-knott"]);
	assert.deepEqual(namedPeople({ family: "obligation_check", bound: { obligation: "o", target: "arty-wilmot" }, before: { family: "person", bound: { kind: "person", who: "Arty Wilmot" } } }),
		["arty-wilmot", "Arty Wilmot"]);
	assert.deepEqual(namedPeople({ family: "combat", bound: { actor: "ghoul" }, unbound: [{ name: "target", required: true, vocabulary: "closed", options: ["a", "b"] }],
		variants: { "combat:attack": { label: "x", bound: { target: "c" }, unbound: [] } } }), ["ghoul", "c", "a", "b"]);
	assert.deepEqual(namedPeople({ family: "clue", bound: { kind: "clue", clue: "Arty Wilmot's ledger" } }), [], "a clue names no one, whatever its words");
});

test("§135.31 read arguments: host-only keys left out, long strings cut and named, the Keeper's prose withheld and named", () => {
	assert.deepEqual(readArguments({ campaign: "c", call_id: "t1-c1", _context_read: true, focus: "npc", name: "A", anchors: ["y".repeat(201)] }),
		{ args: { focus: "npc", name: "A", anchors: ["y".repeat(200)] }, cut: ["anchors[0]"], withheld: [] });
	assert.deepEqual(readArguments({ kind: "source", query: "the-ruins", question: "What waits at the ruins?" }),
		{ args: { kind: "source", query: "the-ruins" }, cut: [], withheld: ["question"] }, "§22's #65 rule: the question is the Keeper's prose");
	assert.deepEqual(readArguments({ kind: "support", query: "Why does Knott lie about the tenants?" }), { args: { kind: "support" }, cut: [], withheld: ["query"] });
	assert.deepEqual(readArguments({ kind: "adaptation", action: "prepare", purpose: "new_destination", name: "pier", request: "The player rows out to the pier." }),
		{ args: { kind: "adaptation", action: "prepare", purpose: "new_destination", name: "pier" }, cut: [], withheld: ["request"] });
});
