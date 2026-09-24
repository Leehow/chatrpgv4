/**
 * SL-27 (spec pi-native-single-loop, Ruling "The Keeper is shown what the run has read"; contract §135.31.1): on the 20-turn
 * live gate the Keeper spent five model rounds on `lookup kind=source` for scenes whose authored units the prescreen had
 * located (the Haunting has no original document: every one was `no_source_document`), and one on `look focus=object`
 * by a clue's name (`unknown_entity`).
 *
 * - The passages of a scene (`scenePassages`): the book's passages of a read at that scene, then the scene's own entity,
 *   then the entities whose located units name the scene handle, units merged; nothing of another scene.
 * - On the emitted kernel through the vendored driver, with a controlled prescreen: the first model step of a run that stays
 *   carries its scene's passages and the next step does not; after the clerk's move the first model step carries the
 *   destination's; without a prescreen nothing is carried.
 * - `look focus=object` on the emitted kernel answers a clue by its name or its play-language label, a handout by its title,
 *   and `unknown_entity` for a name that is none of them.
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
import { supportChoices } from "./support-agent-helpers.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { BIND_FAMILY, ROUTE_FAMILY } from "../../runtime/jev/step-policy.ts";
import { COMPILE_FAMILY } from "../../runtime/jev/route-compile.ts";
import { CARRIED_ANSWERS_HEAD, CARRIED_DOCUMENT, CARRIED_NO_DOCUMENT, CARRIED_PASSAGES_HEAD, CARRIED_PENDING_HEAD, CARRIED_VIEW_BYTES, CARRIED_VIEWS_BYTES, CARRIED_VIEWS_HEAD, carriedSection, readCarriedViews, scenePassages } from "../../runtime/jev/carried-views.ts";
import { SOURCE_ANSWER_ALLOWANCE_MS } from "../../extensions/kernel/source-answers.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const size = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

// ---------------------------------------------------------------------------------------------------
// The passages of a scene, over stub packet materials.
// ---------------------------------------------------------------------------------------------------

/** A graph unit as the prescreen's packet carries it: the content is the unit's JSON text, the locator its entity. */
const unit = (kind, name, fields, extra = {}) => ({ kind: "graph_entity", label: `${name} — ${Object.keys(fields).join(",")}`, authority: "module_source",
	content: JSON.stringify({ entity: { name, display_name: name, kind, summary: `${kind} ${name}`, visibility: "keeper-only" }, ...fields }),
	coverage: { projection: "graph_source_unit" }, provenance: { locator: `${kind}:${name}` }, ...extra });
const identity = (kind, name) => ({ ...unit(kind, name, {}), label: name });
const page = (label, text) => ({ kind: "source", label, authority: "native_text", content: text, provenance: { kind: "native_page", page: 12 } });

test("§135.31.1 the passages of a scene: the book's first, then the scene's own entity, then what names the scene; units merged, nothing of another scene", () => {
	const rows = [
		// The first read, at the office: a handout discoverable at the house, the office itself, a page read there.
		{ scene: "office", material: identity("handout", "house-map") },
		{ scene: "office", material: unit("handout", "house-map", { relations: { 0: { kind: "discoverable-at", to: "house" }, 1: { kind: "discoverable-at", to: "attic" } } }) },
		{ scene: "office", material: unit("scene", "office", { authored: { affordances: ["ask Knott"] } }) },
		{ scene: "office", material: page("Original PDF page 12", "Knott's office is on the third floor.") },
		// The read after the move, at the house: the beat named for it, the house's two units, a page read there, a person elsewhere.
		{ scene: "house", material: identity("beat", "house") },
		{ scene: "house", material: unit("beat", "house", { authored: { scene_id: "house", note: "Wards, nailed windows." } }) },
		{ scene: "house", material: identity("scene", "house") },
		{ scene: "house", material: unit("scene", "house", { authored: { dramatic_question: "What does the ground floor hide?" } }) },
		{ scene: "house", material: unit("scene", "house", { authored: { exits: ["attic"] } }) },
		{ scene: "house", material: page("Original PDF page 40", "The house's windows are nailed shut.") },
		{ scene: "house", material: unit("npc", "dooley", { relations: { 0: { kind: "present-in", to: "street" } } }) },
		// The same unit again (a reused outcome): once.
		{ scene: "house", material: identity("scene", "house") },
	];
	const house = scenePassages(rows, "house");
	assert.deepEqual(Object.keys(house), ["Original PDF page 40", "scene:house", "handout:house-map", "beat:house"],
		"the book's page read at the house, the house's own entity, then the others that name it in the packet's order");
	assert.deepEqual(house["Original PDF page 40"], { authority: "native_text", content: "The house's windows are nailed shut.", provenance: { kind: "native_page", page: 12 } });
	assert.deepEqual(house["scene:house"], { entity: { name: "house", display_name: "house", kind: "scene", summary: "scene house", visibility: "keeper-only" },
		authored: { dramatic_question: "What does the ground floor hide?", exits: ["attic"] } }, "the identity once, the authored units merged");
	assert.deepEqual(house["handout:house-map"].relations, { 0: { kind: "discoverable-at", to: "house" }, 1: { kind: "discoverable-at", to: "attic" } });
	assert.equal(house["beat:house"].authored.scene_id, "house");
	assert.ok(!JSON.stringify(house).includes("Knott's office"), "a page read at another scene is not this scene's");
	assert.ok(!Object.keys(house).some((key) => key.includes("office") || key.includes("dooley")), "nothing of another scene");
	const office = scenePassages(rows, "office");
	assert.deepEqual(Object.keys(office), ["Original PDF page 12", "scene:office"]);
	assert.equal(scenePassages(rows, "cellar"), undefined, "no passages: no view");
	assert.equal(scenePassages([{ scene: "house", material: { kind: "rule", label: "Spot Hidden", content: "house" } }], "house"), undefined,
		"a rule, a memory or a person's card is not a scene's source");
});

test("§135.31.1 the passages ride last in carried, under the carried view's own 4 KiB, cut and marked; past the message's 12 KiB they are omitted as budget; the head says what they are", async () => {
	const big = (n) => "w".repeat(n);
	const view = { "Original PDF page 40": { authority: "native_text", content: big(3000) }, "scene:house": { entity: { name: "house" }, authored: { note: big(3000) } },
		"beat:house": { entity: { name: "house" } }, "handout:map": { entity: { name: "map" }, authored: { note: big(3000) } } };
	const calls = [];
	const call = async (method, params) => { calls.push([method, params]); return { where: { scene: "house", display_name: "House", summary: "s" }, present: [] }; };
	const carried = await readCarriedViews({ call, scene: "house", people: [], passages: { scene: "house", view } });
	assert.deepEqual(carried.views.map((entry) => entry.focus), ["scene", "source"], "served after the scene");
	assert.equal(calls.length, 1, "nothing is read for the passages");
	const source = carried.views.find((entry) => entry.focus === "source");
	assert.equal(source.name, "house");
	assert.ok(size(source.view) <= CARRIED_VIEW_BYTES, `the passages fit the carried view's ceiling (${size(source.view)})`);
	assert.equal(source.truncated, true);
	assert.deepEqual(source.omitted_fields, ["handout:map"], "the trailing entry goes first");
	assert.ok(Object.hasOwn(source.view, "Original PDF page 40") && Object.hasOwn(source.view, "scene:house"));
	assert.equal(carriedSection(carried).head, `${CARRIED_VIEWS_HEAD} ${CARRIED_PASSAGES_HEAD}`, "the module's source unknown: no sentence about it");
	assert.equal(carriedSection(carried, { document: false }).head, `${CARRIED_VIEWS_HEAD} ${CARRIED_PASSAGES_HEAD} ${CARRIED_NO_DOCUMENT}`);
	assert.match(CARRIED_NO_DOCUMENT, /no_source_document/);
	assert.equal(carriedSection(carried, { document: true }).head, `${CARRIED_VIEWS_HEAD} ${CARRIED_PASSAGES_HEAD} ${CARRIED_DOCUMENT}`);
	assert.equal(carriedSection(await readCarriedViews({ call, scene: "house", people: [] }), { document: false }).head, CARRIED_VIEWS_HEAD, "no passages: the head as before");
	// Past the message's budget: a session and three cards take 12 KiB, the passages are listed as budget.
	const card = (name) => ({ kind: "npc", name, id: name, role: "r", wants: big(3500) });
	const full = await readCarriedViews({ call: async (method, params) => card(params.name), people: ["A", "B", "C"],
		session: { session: { kind: "combat", note: big(3500) }, pending_choice: null }, passages: { scene: "house", view } });
	assert.ok(full.bytes <= CARRIED_VIEWS_BYTES);
	assert.deepEqual(full.omitted.find((entry) => entry.focus === "source"), { focus: "source", name: "house", reason: "budget" });
});

// ---------------------------------------------------------------------------------------------------
// The engine over the emitted kernel on the Haunting, with a controlled prescreen.
// ---------------------------------------------------------------------------------------------------

function answered(batch, pick = () => undefined) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = pick(question) ?? (question.key === "exit" ? "continue" : Object.keys(question.criteria)[0] === "now" ? "later" : "unknown");
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
/** A prescreen or binder answer from the controlled helpers (never a Keeper or a gameplay driver). */
function supported(batch) {
	return { batchId: batch.id, status: "complete", attempts: 1, usage: { inputTokens: 10, outputTokens: 2 }, coverage: { required: [], answered: [], unknown: [] }, issues: [],
		answers: Object.fromEntries(Object.entries(supportChoices(batch)).map(([key, choice]) => [key, typeof choice === "object"
			? { status: "answered", type: "noul", noul: choice.noul } : { status: "answered", type: "choice", choice }])) };
}
function kernelFrames(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: CAMPAIGN, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	return run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
}
function kernelSteps(workspace, requests) {
	const frames = kernelFrames(workspace, requests);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
// The table has been told where to dig (turn 1's lead clue), so the kernel issues the Globe as a move.
const toldWhereToDig = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "I listen" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "he said so" }] }],
	["table.narrate", { call_id: "t1-c2", text: "He hands you a paper with the places on it." }],
]);
const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});
/** The passages each distinct note carried, in order: `[scene, keys]`. */
function passagesCarried(requests) {
	const seen = new Set(), out = [];
	for (const context of requests) for (const note of clerkNotes(context)) {
		const key = JSON.stringify(note);
		if (seen.has(key)) continue;
		seen.add(key);
		for (const view of note.carried?.views ?? []) if (view.focus === "source") out.push({ scene: view.name, view: view.view, truncated: view.truncated === true });
	}
	return out;
}

// The allowance is generous on purpose: these tests are about what the first model step carries, not about the
// prescreen's budget (SL-22 has its own tests). Under a loaded 12-way test run the 12 s default expired on the second
// read of the move test (status "fallback"), which said nothing about the carrying.
async function hybridTable({ route, responses, allowanceMs = "60000", preselect = "1", env = {} }) {
	const requests = [];
	const port = { async decide(batch) {
		if (batch.family === ROUTE_FAMILY) return route(batch);
		if (batch.family === COMPILE_FAMILY || batch.family === BIND_FAMILY) return answered(batch);
		return supported(batch);
	} };
	const engine = createHybridEngine({ env: { ...process.env, PI_COC_JEV_PRESELECT: preselect, EXT_JEV_APIKEY: "mechanical-test-key",
		PI_COC_JEV_PRESELECT_ALLOWANCE_MS: allowanceMs }, decision: port });
	const table = await openTable({
		realKernel: true, prepareWorkspace: toldWhereToDig, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", ...env },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: responses.map((response) => (context) => { requests.push(context); return response; }),
	});
	return { table, requests, dispose: () => table.dispose() };
}
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });
const look = (focus) => fauxAssistantMessage([fauxToolCall("look", { focus })], { stopReason: "toolUse" });

test("§135.31.1 at the extension seam: after the clerk's move the Keeper's first model step carries the destination's passages from the prescreen, once, and never the scene the run left", async (t) => {
	let routes = 0;
	const table = await hybridTable({
		route: (batch) => ++routes === 1 ? answered(batch, (question) => question.key === "exit" ? "continue" : /Boston Globe offices/.test(question.target) ? "now" : undefined)
			: answered(batch, (question) => question.key === "exit" ? "ask_llm" : undefined),
		responses: [look("time"), narrate("You reach the Globe's morgue.")],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I go to the Boston Globe offices.");

	const reads = table.table.telemetry(CAMPAIGN).filter((row) => row.lane === "run" && row.event === "read");
	assert.deepEqual(reads.map((row) => row.scene), ["commission-briefing", "newspaper-morgue"]);
	assert.ok(reads.every((row) => row.prescreen.status === "prepared"), `both reads ran the prescreen: ${JSON.stringify(reads.map((row) => row.prescreen.status))}`);
	const moved = table.table.telemetry(CAMPAIGN).find((row) => row.tool === "apply" && row.origin === "policy");
	assert.ok(moved && moved.ok !== false, "the clerk moved before the Keeper was asked");
	const carried = passagesCarried(table.requests);
	assert.deepEqual(carried.map((entry) => entry.scene), ["newspaper-morgue"],
		"the Keeper's first step came after the move: the destination's passages, once, and never the office's (the run was no longer there)");
	const [globe] = carried;
	assert.ok(Object.hasOwn(globe.view, "scene:newspaper-morgue"), `the scene's own entity leads: ${Object.keys(globe.view)}`);
	assert.equal(Object.keys(globe.view)[0], "scene:newspaper-morgue");
	assert.equal(globe.view["scene:newspaper-morgue"].entity.name, "newspaper-morgue");
	assert.ok(size(globe.view) <= CARRIED_VIEW_BYTES);
	// What the Keeper was shown is what the prescreen's packet held: every entry is one of its materials' entities.
	const packet = table.requests[0].messages.map((message) => typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join(""))
		.filter((text) => text.includes('"kind":"keeper_support"'));
	assert.ok(packet.length, "the prescreen's packet reached the request");
	for (const key of Object.keys(globe.view)) assert.ok(packet.some((text) => text.includes(key.slice(key.indexOf(":") + 1))), `${key} is from the packet`);
	const rows = table.table.telemetry(CAMPAIGN).filter((row) => row.lane === "run" && row.event === "carried");
	assert.deepEqual(rows.flatMap((row) => row.views.filter((view) => view.focus === "source").map((view) => view.name)), ["newspaper-morgue"]);
	assert.ok(rows.every((row) => row.reads <= 1 + row.views.filter((view) => view.focus === "npc").length), "the passages cost no kernel read");
});

test("§135.31.1 at the extension seam: a run that stays carries its scene's passages on its first model step, and not again on its second", async (t) => {
	const table = await hybridTable({
		route: (batch) => answered(batch, (question) => question.key === "exit" ? "ask_llm" : undefined),
		responses: [look("time"), narrate("Knott waits.")],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I look over Knott's desk for anything about the house.");
	const carried = passagesCarried(table.requests);
	assert.deepEqual(carried.map((entry) => entry.scene), ["commission-briefing"], "once, on the first model step");
	// The Haunting reads its built-in window (§14.16, SL-28): its capsule has `reading`, so the head says the original
	// document answers what the passages do not cover (it said no_source_document before the window shipped).
	assert.equal(clerkNotes(table.requests[0]).at(-1).carried.head, `${CARRIED_VIEWS_HEAD} ${CARRIED_PASSAGES_HEAD} ${CARRIED_DOCUMENT}`);
	assert.equal(Object.keys(carried[0].view)[0], "scene:commission-briefing");
	assert.equal(table.requests.length, 2, "two model steps");
	assert.ok((clerkNotes(table.requests[0]).at(-1)?.carried?.views ?? []).some((view) => view.focus === "source"), "the first step's note carries them");
	// The second request keeps the first note (append-only, §135.23); a note of its own, if any, carries no passages.
	const second = clerkNotes(table.requests[1]).slice(clerkNotes(table.requests[0]).length);
	assert.ok(second.every((note) => !(note.carried?.views ?? []).some((view) => view.focus === "source")), "the second step's own note does not carry them again");
});

test("§135.31.1 without a prescreen there are no passages: nothing is read or invented for them", async (t) => {
	const table = await hybridTable({ preselect: "0",
		route: (batch) => answered(batch, (question) => question.key === "exit" ? "ask_llm" : undefined),
		responses: [narrate("Knott waits.")],
	});
	t.after(() => table.dispose());
	await table.table.session.prompt("I look over Knott's desk for anything about the house.");
	assert.deepEqual(passagesCarried(table.requests), []);
});

// ---------------------------------------------------------------------------------------------------
// §135.31.2 (SL-36, SL-37): a consultation past its allowance, and a text read still pending, ride in the note.
// ---------------------------------------------------------------------------------------------------

/** Every distinct clerk note of the table, in order (a request repeats the run's earlier notes, §135.23). */
function distinctNotes(requests) {
	const seen = new Set(), out = [];
	for (const [index, context] of requests.entries()) for (const note of clerkNotes(context)) {
		const key = JSON.stringify(note);
		if (!seen.has(key)) { seen.add(key); out.push({ request: index, note }); }
	}
	return out;
}
const consult = (query, question) => fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", source_mode: "answer", query, question })], { stopReason: "toolUse" });
const turnRecord = (table, turn) => JSON.parse(readFileSync(join(table.table.workspace, ".coc", "campaigns", CAMPAIGN, "turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));

test("§135.31.2 at the extension seam: a consultation past its allowance answers pending, the note carries it pending, and the next turn's first step carries the landed answer once", async (t) => {
	let land;
	const settled = new Promise((resolve) => { land = resolve; });
	const ensures = [];
	const answer = { status: "answered", answer: "Corbitt died in 1918; the house has been let since.", source_refs: [{ source_id: "pdf:the-haunting", pdf_index: 1 }],
		limitations: "", authority: "source-consultation", prepared: false, supported: true };
	const table = await hybridTable({
		route: (batch) => answered(batch, (question) => question.key === "exit" ? "ask_llm" : undefined),
		responses: [consult("commission-briefing", "Who lived in the house before?"), narrate("Knott shrugs and taps the lease."),
			look("time"), narrate("You fold the paper and pocket it.")],
	});
	t.after(() => table.dispose());
	// The turn's provider budget, as the task runtime would offer it: the consultation must not take it past its allowance.
	const turnBudget = { signal: new AbortController().signal, deadlineAt: Date.now() + 600_000, async reserve() { return { settle() {}, release() {} }; } };
	table.table.emit("coc:task-provider-budget", () => turnBudget);
	table.table.emit("coc:reading-bridge", {
		async ensure(_mid, params, _signal, options) {
			ensures.push({ params, options });
			return { state: "pending", job_id: "read-1", index: [{ name: "Knott's Office", pages: [[0, 0]] }], read: { purpose: "answer", focus: params.focus, question: params.question }, settled };
		},
		reading() { return false; },
	});
	await table.table.session.prompt("I ask Knott who lived in the house before.");

	assert.equal(ensures.length, 1);
	assert.equal(ensures[0].params.purpose, "answer");
	assert.equal(ensures[0].options.allowanceMs, SOURCE_ANSWER_ALLOWANCE_MS, "the named default, not a literal at the call");
	assert.equal(ensures[0].options.providerBudget, undefined, "past the allowance the reading is not the turn's provider work");
	const result = table.table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "lookup");
	const body = JSON.parse(result.content.map((block) => block.text ?? "").join(""));
	assert.equal(body.source_answer.status, "pending");
	assert.deepEqual(body.source_answer.index, [{ name: "Knott's Office", pages: [[0, 0]] }], "what the index holds on the focus");
	const afterLookup = clerkNotes(table.requests[1]).at(-1);
	assert.deepEqual(afterLookup.carried.pending.map((row) => [row.focus, row.purpose]), [["commission-briefing", "answer"]], "the note carries it pending");
	assert.ok(afterLookup.carried.head.includes(CARRIED_PENDING_HEAD));
	assert.equal(turnRecord(table, 2).closed_by, "narrate", "the turn delivered without the answer");

	land({ state: "ready", generation: 2, source_answer: answer });
	await new Promise((resolve) => setTimeout(resolve, 20));
	await table.table.session.prompt("I go on to the Globe tomorrow.");

	const answers = distinctNotes(table.requests).flatMap(({ request, note }) => (note.carried?.views ?? [])
		.filter((view) => view.focus === "source_answer").map((view) => ({ request, view })));
	assert.equal(answers.length, 1, `carried once: ${JSON.stringify(answers)}`);
	assert.equal(answers[0].request, 2, "on the next turn's first model step");
	assert.equal(answers[0].view.name, "commission-briefing");
	assert.equal(answers[0].view.view.answer, answer.answer);
	assert.equal(answers[0].view.view.question, "Who lived in the house before?");
	assert.ok(clerkNotes(table.requests[2]).at(-1).carried.head.includes(CARRIED_ANSWERS_HEAD));
	const rows = table.table.telemetry(CAMPAIGN).filter((row) => row.lane === "reading" && String(row.event).startsWith("answer_"));
	assert.deepEqual(rows.map((row) => row.event), ["answer_pending", "answer_landed"]);
	assert.ok(rows.every((row) => !Object.hasOwn(row, "question")), "telemetry never writes the Keeper's question");
});

test("§22.4.4 at the extension seam: a pending text read with a draft delivers the draft, and the note carries the pending read", async (t) => {
	const draft = "You read the lease twice while Knott watches the clock.";
	const table = await hybridTable({
		env: { PI_COC_SPEECH_STEER: "0" },
		route: (batch) => answered(batch, (question) => question.key === "exit" ? "ask_llm" : undefined),
		responses: [fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "commission-briefing", question: "What does the lease say?" })], { stopReason: "toolUse" }),
			fauxAssistantMessage(draft), fauxAssistantMessage("a leg nobody should ask for")],
	});
	t.after(() => table.dispose());
	table.table.emit("coc:reading-bridge", {
		async ensure(_mid, params) {
			throw Object.assign(new Error("the source is still being read"), { code: "needs",
				details: { reason: "reading_timeout", read: { purpose: "detail", focus: params.focus, question: params.question } } });
		},
		reading(_mid, params) { return params.focus === "commission-briefing"; },
	});
	await table.table.session.prompt("I read the lease.");

	const note = clerkNotes(table.requests[1]).at(-1);
	assert.deepEqual(note.carried.pending.map((row) => [row.focus, row.purpose]), [["commission-briefing", "detail"]]);
	const record = turnRecord(table, 2);
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.text, draft, "the delivered receipt is the Keeper's draft");
	const delivery = table.table.telemetry(CAMPAIGN).filter((row) => row.lane === "delivery");
	assert.deepEqual(delivery.filter((row) => row.reason === "reading_wait"), [], "no reading_wait drop");
	assert.equal(delivery.filter((row) => row.reason === "reading_wait_draft_kept").length, 1);
	assert.equal(table.requests.length, 2, "no steer bought a third model step");
});

// ---------------------------------------------------------------------------------------------------
// look focus=object on the emitted kernel.
// ---------------------------------------------------------------------------------------------------

test("§135.31.1 B look focus=object answers the clue or handout the kernel knows by that name, in either language, before unknown_entity", () => {
	const workspace = mkdtempSync(join(tmpdir(), "sl27-look-object-"));
	try {
		createRealCampaign(workspace, CAMPAIGN);
		const frames = kernelFrames(workspace, [
			["table.open", {}],
			["table.look", { focus: "object", name: "Corbitt Diaries" }],
			["table.look", { focus: "object", name: "Handout 1: Mr. Knott's Commission" }],
			["table.look", { focus: "object", name: "a brass telescope" }],
			["table.player_input", { text: "我听着" }],
			["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", label: "查档的路子", how: "he said so" }] }],
			["table.look", { focus: "object", name: "查档的路子" }],
			["table.lookup", { kind: "module", query: "corbitt-diaries", expected_kind: "clue" }],
		]);
		for (const index of [1, 2, 6, 7]) assert.equal(frames[index].ok, true, JSON.stringify(frames[index].error));
		const diaries = frames[1].result;
		assert.equal(diaries.kind, "clue");
		assert.equal(diaries.entity.name, "corbitt-diaries", "the clue's handle, by the name the Keeper used for it");
		assert.deepEqual(diaries.entity, frames[7].result.entities[0], "the entity row is the one lookup kind=module returns");
		assert.equal(diaries.discovered, false);
		assert.equal(Object.hasOwn(diaries, "label"), false, "no play-language label before apply clue filed one");
		assert.match(diaries.note, /apply clue/);
		assert.doesNotMatch(diaries.note, /\bdefine\b[^;]*$|place it/, "the note never tells the Keeper to define or place it");
		const handout = frames[2].result;
		assert.equal(handout.kind, "handout");
		assert.equal(handout.entity.name, "the-haunting-handout-1-knott-commission");
		assert.equal(handout.shown, false);
		assert.match(handout.note, /apply handout/);
		assert.equal(frames[3].ok, false);
		assert.equal(frames[3].error.code, "unknown_entity", "a name that is no object, clue or handout is still unknown");
		const labelled = frames[6].result;
		assert.equal(labelled.kind, "clue");
		assert.equal(labelled.entity.name, "knott-research-leads", "the play-language label apply clue filed resolves to its clue");
		assert.equal(labelled.label, "查档的路子");
		assert.equal(labelled.discovered, true);
	} finally { rmSync(workspace, { recursive: true, force: true }); }
});
