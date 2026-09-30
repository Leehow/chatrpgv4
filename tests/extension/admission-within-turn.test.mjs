/**
 * SL-18, admission within the turn (contract §32.12; the owner's rulings after live gate #6, 2026-09-24).
 *
 * - The lane review is bounded inside the turn: a provider that answers 200 and then streams without ever producing a
 *   verdict is cut at the cap (12 s by default, measured from the lane request), and the review ends `review_timeout`:
 *   a refusal naming the cap, never an admit, not an outage; the row says `timed_out` with its ms and `first_byte_ms`.
 * - A clerk write the compile selected is admitted on the compile's evidence (`path: "compile"`, no lane call, no typed
 *   call) when every feature its predicate reads cleared the gate and every bound parameter has a recorded SL-12 path;
 *   a read feature under the gate, a parameter with no recorded path, a write the compile did not select and a Keeper's
 *   own write all keep the review.
 *
 * The seam: the real `resolve`/`apply` tools, the real admission seam, the emitted kernel, the product's hybrid engine
 * with a stub Jev for its own questions, and a counted typed endpoint behind `fetch` for admission's.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { askWords, isAskRow } from "./compile-ask.mjs";
import { withOriginTamper } from "./origin-tamper.mjs";
import { DECLARED_CLERKS, DEFAULT_ADMISSION_TIMEOUT_MS, REVIEW_PENDING, REVIEW_TIMEOUT, admissionTimeoutMs, compileAdmission, declaredAction } from "../../extensions/kernel/admission.ts";
import { admissionBindings, createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { BIND_FAMILY, CLERK_AUTHORITY } from "../../runtime/jev/step-policy.ts";
import { COMPILE_FAMILY, COMPILE_PREDICATES, FEATURE_FAMILIES, interpretCompile } from "../../runtime/jev/route-compile.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MORGUE = "newspaper-morgue", ACCESS = "globe-clippings-access";
const PASS = "4";
const admissionRows = (table, campaign) => table.telemetry(campaign).filter((row) => row.lane === "admission");

// ---- the cap ---------------------------------------------------------------------------------------------------------

test("§32.12, §32.12.2: the review's cap is 13 s by default (measured; it was 12 s), read per review; the variable still overrides", (t) => {
	const before = process.env.PI_COC_ADMISSION_TIMEOUT_MS;
	t.after(() => { if (before === undefined) delete process.env.PI_COC_ADMISSION_TIMEOUT_MS; else process.env.PI_COC_ADMISSION_TIMEOUT_MS = before; });
	delete process.env.PI_COC_ADMISSION_TIMEOUT_MS;
	assert.equal(DEFAULT_ADMISSION_TIMEOUT_MS, 13_000);
	assert.equal(admissionTimeoutMs(), 13_000);
	process.env.PI_COC_ADMISSION_TIMEOUT_MS = "30000";
	assert.equal(admissionTimeoutMs(), 30_000);
	process.env.PI_COC_ADMISSION_TIMEOUT_MS = "soon";
	assert.equal(admissionTimeoutMs(), 13_000);
});

/**
 * A Chat Completions endpoint that answers 200 at once and then streams a verdict that never ends: the opening of the
 * JSON, then one more character every 150 ms, for as long as the connection stays open -- the live gate #6 review
 * (headers at 1.7 s, then 55 s of streaming) with nothing idle about it.
 */
function tricklingProvider(t, script = []) {
	const sockets = new Set();
	let requests = 0;
	const server = createServer((socket) => {
		sockets.add(socket);
		let received = "", timer;
		socket.on("error", () => {});
		socket.on("close", () => { clearInterval(timer); sockets.delete(socket); });
		socket.on("data", (data) => {
			received += data;
			if (!received.includes("\r\n\r\n")) return;
			received = "";
			requests++;
			// `script[i]`: what the i-th request gets; `error` is a provider 500, anything else (the default) the trickle.
			if (script[requests - 1] === "error") {
				const body = JSON.stringify({ error: { message: "test: the provider failed", type: "server_error" } });
				socket.end(`HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
				return;
			}
			socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nTransfer-Encoding: chunked\r\n\r\n");
			const chunk = (text) => socket.write(`${Buffer.byteLength(text).toString(16)}\r\n${text}\r\n`);
			const delta = (content) => chunk(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "trickle-1",
				choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`);
			delta('{"verdict":"not_authorized","grounds":"');
			timer = setInterval(() => delta("a"), 150);
		});
	});
	t.after(() => new Promise((done) => { for (const socket of sockets) socket.destroy(); server.close(done); }));
	return new Promise((ready) => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, requests: () => requests })));
}

test("§32.12 (a), §32.12.2: a lane review that answers 200 and then streams past the cap returns the call review_pending within cap + 1 s; nothing is settled and the run goes on", async (t) => {
	const before = process.env.PI_COC_ADMISSION_TIMEOUT_MS;
	delete process.env.PI_COC_ADMISSION_TIMEOUT_MS;
	t.after(() => { if (before !== undefined) process.env.PI_COC_ADMISSION_TIMEOUT_MS = before; });
	const provider = await tricklingProvider(t);
	const table = await openTable({
		env: { PI_COC_ADMISSION_MODEL: "trickle/trickle-1" },
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", skill: "Persuade", target: "Ruth Blake", goal: "请她调出旧剪报", method: "说明来意" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你说明了来意。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
	});
	t.after(() => table.dispose());
	table.session.modelRuntime.registerProvider("trickle", { baseUrl: `http://127.0.0.1:${provider.port}/v1`, api: "openai-completions", apiKey: "unused",
		models: [{ id: "trickle-1", name: "trickle", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] });

	// A hung review is a failure, not a test that never ends: the guard is far past cap + 1 s.
	const prompt = table.session.prompt("我说明来意，请她帮忙调出科比特宅这些年的旧剪报。");
	const outcome = await Promise.race([prompt.then(() => "ended"), new Promise((resolve) => setTimeout(() => resolve("hung"), 25_000).unref())]);
	if (outcome === "hung") { await table.session.abort(); await prompt.catch(() => {}); }
	assert.equal(outcome, "ended", "the call was still waiting 25 s in: the cap did not bound it");

	assert.equal(provider.requests(), 1, "one review request, answered 200 and streamed");
	const [row] = admissionRows(table);
	assert.equal(row.verdict, REVIEW_PENDING, "a cap bounds waiting and decides nothing (§32.12.2)");
	assert.equal(row.admitted, false);
	assert.equal(row.cause, "cap");
	assert.equal(row.cap_ms, 13_000);
	assert.equal(row.hard_cap_ms, 26_000);
	assert.equal(row.path, "lane");
	assert.equal(row.origin, "model", "the Keeper's own call");
	assert.ok(row.ms >= 13_000 && row.ms <= 14_000, `returned within cap + 1 s (${row.ms} ms)`);
	assert.equal(table.kernelRequests().filter((entry) => entry.method === "table.resolve").length, 0, "nothing was rolled");
	const refused = table.telemetry().find((entry) => entry.tool === "resolve" && entry.ok === false);
	assert.equal(refused?.reason, REVIEW_PENDING, "the Keeper read a review_pending refusal");
	assert.ok(table.telemetry().some((entry) => entry.tool === "narrate" && entry.ok), "the run went on to the delivery");
	assert.equal(table.entries("coc-admission-status").length, 0, "not an outage");
});

test("§32.12, §32.12.2: pending returns and timeouts are not an outage -- a resend past the hard cap is review_timeout, kept for the turn", async (t) => {
	const provider = await tricklingProvider(t);
	const resolve = (target) => fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", skill: "Persuade", target, goal: "请她调出旧剪报", method: "说明来意" } })], { stopReason: "toolUse" });
	const table = await openTable({
		env: { PI_COC_ADMISSION_MODEL: "trickle/trickle-1", PI_COC_ADMISSION_TIMEOUT_MS: "1500" },
		responses: [resolve("Ruth Blake"), resolve("Arty Wilmot"), resolve("Arty Wilmot"),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你说明了来意。" })], { stopReason: "toolUse" }), fauxAssistantMessage("after")],
	});
	t.after(() => table.dispose());
	table.session.modelRuntime.registerProvider("trickle", { baseUrl: `http://127.0.0.1:${provider.port}/v1`, api: "openai-completions", apiKey: "unused",
		models: [{ id: "trickle-1", name: "trickle", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] });
	const prompt = table.session.prompt("我说明来意，请她帮忙调出科比特宅这些年的旧剪报。");
	const outcome = await Promise.race([prompt.then(() => "ended"), new Promise((resolve) => setTimeout(() => resolve("hung"), 20_000).unref())]);
	if (outcome === "hung") { await table.session.abort(); await prompt.catch(() => {}); }
	assert.equal(outcome, "ended", "a call was still waiting 20 s in: the 1.5 s cap and its 3 s hard cap did not bound it");

	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.verdict, row.reused, row.cap_ms, row.resend ?? false]),
		[[REVIEW_PENDING, false, 1500, false], [REVIEW_PENDING, false, 1500, false], [REVIEW_TIMEOUT, false, 3000, true]],
		"the override is the cap; the resend collects the round, which runs out at the hard cap");
	assert.ok(rows[2].ms <= 2500, `the resend waited only for the rest of the round (${rows[2].ms} ms)`);
	assert.equal(provider.requests(), 2, "the resend made no request of its own");
	assert.equal(table.entries("coc-admission-status").length, 0, "pending returns and a timeout are not an outage");
	const refusals = table.telemetry().filter((entry) => entry.tool === "resolve" && entry.ok === false);
	assert.deepEqual(refusals.map((entry) => entry.reason), [REVIEW_PENDING, REVIEW_PENDING, REVIEW_TIMEOUT]);
	assert.ok(!admissionRows(table).some((row) => row.ok === false), "no unavailability row");
});

test("§32.12: a timeout between two unavailable reviews does not end the outage streak -- the second failure still escalates to the operator", async (t) => {
	const provider = await tricklingProvider(t, ["error", "trickle", "error"]);
	const resolve = (target) => fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", skill: "Persuade", target, goal: "请她调出旧剪报", method: "说明来意" } })], { stopReason: "toolUse" });
	const table = await openTable({
		env: { PI_COC_ADMISSION_MODEL: "trickle/trickle-1", PI_COC_ADMISSION_TIMEOUT_MS: "1500" },
		responses: [resolve("Ruth Blake"), resolve("Arty Wilmot"), resolve("Mrs. Macario"),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你说明了来意。" })], { stopReason: "toolUse" }), fauxAssistantMessage("after")],
	});
	t.after(() => table.dispose());
	table.session.modelRuntime.registerProvider("trickle", { baseUrl: `http://127.0.0.1:${provider.port}/v1`, api: "openai-completions", apiKey: "unused",
		models: [{ id: "trickle-1", name: "trickle", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] });
	const prompt = table.session.prompt("我说明来意，请她帮忙调出科比特宅这些年的旧剪报。");
	const outcome = await Promise.race([prompt.then(() => "ended"), new Promise((resolve) => setTimeout(() => resolve("hung"), 20_000).unref())]);
	if (outcome === "hung") { await table.session.abort(); await prompt.catch(() => {}); }
	assert.equal(outcome, "ended");

	assert.deepEqual(admissionRows(table).map((row) => row.ok === false ? `unavailable:${row.reason}` : row.verdict),
		["unavailable:model_error", REVIEW_PENDING, "unavailable:model_error"]);
	const notices = table.entries("coc-admission-status");
	assert.equal(notices.length, 1, "unavailable, pending, unavailable is a streak of two: the pending return neither counted nor reset it");
	assert.equal(notices[0].data?.streak ?? notices[0].streak, 2);
});

// ---- the compile's evidence (pure) -----------------------------------------------------------------------------------

const evidence = (overrides = {}) => ({
	origin: "policy",
	basis: { obligation: ACCESS, compile: { predicate: "obligation_check", features: { ask: `obligation:${ACCESS}`, addressee: "Arty Wilmot", act: "social" },
		read_features: { ask: { row: `obligation:${ACCESS}`, confidence: 0.91, cleared: true }, addressee: { row: "Arty Wilmot", confidence: 0.55, cleared: true },
			act: { row: "social", confidence: 0.96, cleared: true } } } },
	bindings: [{ name: "obligation", path: "stated" }, { name: "target", path: "stated" }, { name: "goal", path: "composed" }, { name: "skill", path: "jev" },
		{ name: "bonus", path: "rule-default" }],
	...overrides,
});

test("§32.12 compileAdmission: the gate #6 check (addressee 0.55 cleared by the margin) is admitted on its evidence; anything missing refuses the exemption", () => {
	const admitted = compileAdmission(evidence());
	assert.deepEqual(admitted, { ok: true, predicate: "obligation_check",
		features: { ask: { row: `obligation:${ACCESS}`, confidence: 0.91 }, addressee: { row: "Arty Wilmot", confidence: 0.55 }, act: { row: "social", confidence: 0.96 } },
		bindingPaths: { obligation: "stated", target: "stated", goal: "composed", skill: "jev", bonus: "rule-default" } });
	// Not a compile selection at all: nothing to say, the review runs.
	assert.equal(compileAdmission(undefined), undefined);
	assert.equal(compileAdmission({ label: "model" }), undefined, "the Keeper's own call");
	assert.equal(compileAdmission(evidence({ origin: "host" })), undefined, "another host operation");
	assert.equal(compileAdmission(evidence({ basis: { obligation: ACCESS } })), undefined, "a clerk write the route selected");
	// A compile selection whose evidence does not hold: refused, so reviewed.
	const refused = (value) => compileAdmission(value)?.ok === false ? compileAdmission(value).reason : "admitted";
	// Owner ruling (2026-09-24): a guard that did not clear is not a feature the predicate fired on, and not evidence against.
	const unclear = evidence();
	unclear.basis.compile.read_features.addressee = { row: null, confidence: 0.9, cleared: false };
	delete unclear.basis.compile.features.addressee;
	assert.deepEqual(compileAdmission(unclear)?.ok && Object.keys(compileAdmission(unclear).features), ["ask", "act"], "an unclear addressee: admitted on the ask and the act");
	// A feature it fired on whose record is under the gate, or missing: refused.
	const under = evidence();
	under.basis.compile.read_features.ask = { row: `obligation:${ACCESS}`, confidence: 0.41, cleared: false };
	assert.equal(refused(under), "feature_not_cleared:ask", "a fired-on feature under the gate");
	const missing = evidence();
	delete missing.basis.compile.read_features.act;
	assert.equal(refused(missing), "feature_unrecorded:act");
	const noFeatures = evidence();
	delete noFeatures.basis.compile.read_features;
	assert.equal(refused(noFeatures), "features_unrecorded");
	assert.equal(refused(evidence({ bindings: undefined })), "bindings_unrecorded");
	assert.equal(refused(evidence({ bindings: [] })), "bindings_unrecorded");
	assert.equal(refused(evidence({ bindings: [{ name: "target", path: "stated" }, { name: "skill", path: null }] })), "parameter_path_unrecorded:skill");
	assert.equal(refused(evidence({ bindings: [{ name: "target", path: "stated" }, { name: "why", path: "llm" }] })), "parameter_path_not_exempt:why");
	const unknown = evidence();
	unknown.basis.compile.predicate = "hunch";
	assert.equal(refused(unknown), "unknown_predicate");
	// A family the compile never asked is not read: the move reads its destination only.
	assert.equal(compileAdmission({ origin: "policy", bindings: [{ name: "to", path: "stated" }],
		basis: { compile: { predicate: "move", features: { destination: "morgue" }, read_features: { destination: { row: "morgue", confidence: 0.99, cleared: true } } } } })?.ok, true);
});

test("§32.12: every compile predicate declares the feature families it reads (first_blow included), so its selections carry read_features", () => {
	const declared = Object.fromEntries(COMPILE_PREDICATES.map((predicate) => [predicate.name, [...(predicate.features ?? [])]]));
	assert.deepEqual(declared.first_blow, ["act", "target"]);
	for (const [name, families] of Object.entries(declared)) {
		assert.ok(families.length > 0, `${name} declares its features`);
		assert.ok(families.every((family) => FEATURE_FAMILIES.includes(family)), `${name} reads only compile families`);
	}
});

test("§32.12: the bind records admission reads list a parameter the bind step carried with no record as path null", () => {
	assert.deepEqual(admissionBindings([{ name: "target", path: "stated", value: "Arty" }, { name: "skill", path: "jev", value: "Persuade" }], { skill: "Persuade", bonus: "none" }),
		[{ name: "target", path: "stated" }, { name: "skill", path: "jev" }, { name: "bonus", path: null }]);
});

test("§32.12: basis.compile.read_features records every family the predicate reads that was asked, a guard under the gate included", () => {
	const check = { key: `resolve:obligation:${ACCESS}`, verb: "resolve", family: "obligation_check", label: "check", source: "t", clerk: "stated_obligation",
		bound: { obligation: ACCESS, target: "Arty" }, unbound: [], basis: { obligation: ACCESS } };
	const rows = { ask: [{ id: `obligation:${ACCESS}`, describe: {} }], addressee: [{ id: "Arty", describe: {} }], act: [{ id: "social", describe: "social" }] };
	const result = { batchId: "b", status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] }, answers: {
		ask_1: { status: "answered", type: "choice", choice: "yes", confidence: 0.9, probabilities: { yes: 0.9, no: 0.1 } },
		addressee: { status: "answered", type: "choice", choice: "addressee_1", confidence: 0.47, probabilities: { addressee_1: 0.47, unclear: 0.45 } },
		act: { status: "answered", type: "choice", choice: "act_1", confidence: 0.95, probabilities: { act_1: 0.95 } } } };
	const [selected] = interpretCompile({ candidates: [check], rows }, result, 0.6).selected;
	assert.ok(selected, "the demand alone selects the check (the addressee guards only when it clears)");
	assert.deepEqual(selected.candidate.basis.compile.features, { ask: `obligation:${ACCESS}`, act: "social" });
	assert.deepEqual(selected.candidate.basis.compile.read_features, { ask: { row: `obligation:${ACCESS}`, confidence: 0.9, cleared: true },
		addressee: { row: "Arty", confidence: 0.47, cleared: false }, act: { row: "social", confidence: 0.95, cleared: true } });
});

// ---- at the extension seam: the emitted kernel and the hybrid engine ----------------------------------------------------

/** Kernel requests run once on the prepared workspace, through the emitted kernel's own RPC. */
function kernelSteps(workspace, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign: "test-camp", ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")], { cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
/** Turn 1 walked into the morgue and met Arty (the city editor), and closed; the player now asks him for the clippings. */
const metArty = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: MORGUE }] }],
	["table.apply", { call_id: "t1-c2", effects: [{ kind: "person", who: "Arty Wilmot", name: "城市版编辑" }] }],
	["table.narrate", { call_id: "t1-c3", text: "城市版编辑挡在剪报室门口。" }],
]);
/** Turn 1 took the commission and its research leads; the exits are open and the investigator is still in the office. */
const tookTheJob = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我接下这份委托" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "clue", clue: "knott-research-leads", how: "诺特列出该去查的地方。", label: "查档的路" }] }],
	["table.narrate", { call_id: "t1-c2", text: "诺特把要查的地方写在纸上。" }],
]);

const aliasWhere = (question, match) => Object.entries(question?.criteria ?? {}).find(([, value]) => match(value))?.[0];
/** One choice answer: `[choice, confidence, probabilities?]`. */
const choice = ([value, confidence, probabilities]) => ({ status: "answered", type: "choice", choice: value, confidence, probabilities: probabilities ?? { [value]: confidence } });
const complete = (answers) => ({ batchId: "b", status: "complete", answers, issues: [],
	coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] } });
/**
 * Stub Jev for the engine's own questions. The compile: `compile(question)` answers a family (else `unclear`). The check's
 * bind: Persuade, no dice, social. Every route: finish (nothing else for the clerk this run).
 */
function stubJev(compile) {
	return { decide: async (batch) => {
		if (batch.family === COMPILE_FAMILY)
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(compile(question) ?? ["unclear", 0.9])])));
		if (batch.family === BIND_FAMILY)
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
				choice([({ skill: "Persuade", bonus: "none", penalty: "none", intent: "social" })[question.key] ?? "unknown", 0.9])])));
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
			choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9])])));
	} };
}
/** The compile at the morgue: the demand asked of Arty (`addressee` as given), a social act. */
const askArty = (addressee) => (question) => isAskRow(question) ? [askWords(question)?.demand ? "yes" : "no", 0.9]
	: question.key === "addressee" ? addressee(aliasWhere(question, (value) => JSON.stringify(value).includes("城市版编辑")))
	: question.key === "act" ? [aliasWhere(question, (value) => typeof value === "string" && value.startsWith("social")), 0.95]
	: undefined;
const clearedArty = (alias) => [alias, 0.9];
const arty047 = (alias) => [alias, 0.47, { [alias]: 0.47, unclear: 0.45, none: 0.08 }];

/** Admission's own typed endpoint, counted: every request is a typed review this table asked for. */
function countTyped(t) {
	const original = globalThis.fetch, requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== "https://api.typesafe.ai/v1/systemone") return original(url, init);
		const body = JSON.parse(init.body);
		// §145.2: the time reading is a family of its own; it falls back (503) and is not counted with this file's requests.
		if (!body.questions?.cut) requests.push(body);
		return new Response(JSON.stringify({ error: { message: "the test counts typed requests and answers none" } }), { status: 503 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}

async function hybrid(t, { prepare, compile, responses, env = {}, engine: engineOptions = {}, tamper, laneResponses }) {
	const engine = createHybridEngine({ env: process.env, decision: stubJev(compile), ...engineOptions });
	const table = await openTable({
		realKernel: true, prepareWorkspace: prepare, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: PASS, ...env },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: tamper ? withOriginTamper(engine, tamper) : engine.extension }], responses,
		...(laneResponses ? { laneResponses } : {}),
	});
	t.after(() => table.dispose());
	return table;
}
const narrateOnly = (text) => [fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" })];

test("§32.12 (b): the clerk's obligation check the compile selected is admitted on its evidence -- path compile, no lane call and no typed call, even with Jev as reviewer", async (t) => {
	const typed = countTyped(t);
	const table = await hybrid(t, { prepare: metArty, compile: askArty(clearedArty), responses: narrateOnly("编辑松了口，放你下楼。"),
		env: { PI_COC_ADMISSION_REVIEWER: "jev", EXT_JEV_APIKEY: "test-jev-key" } });
	await table.session.prompt("我说明来意，请他帮忙调出科比特宅这些年的旧剪报。");
	const telemetry = table.telemetry("test-camp");
	assert.ok(telemetry.some((row) => row.tool === "resolve" && row.origin === "policy" && row.ok && row.basis?.obligation === ACCESS), "the clerk's check was rolled");
	const [row] = admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.verb === "resolve");
	assert.deepEqual([row.path, row.reviewer, row.verdict, row.admitted, row.predicate], ["compile", "compile", "authorized", true, "obligation_check"]);
	assert.deepEqual(row.features, { ask: { row: `obligation:${ACCESS}`, confidence: 0.9 }, addressee: { row: "Arty Wilmot", confidence: 0.9 }, act: { row: "social", confidence: 0.95 } });
	assert.equal(row.binding_paths.skill, "jev");
	assert.equal(row.binding_paths.obligation, "stated");
	assert.equal(typeof row.ms, "number");
	assert.equal(table.lanes.admission.requests().length, 0, "the lane was never asked");
	assert.equal(typed.length, 0, "the typed reviewer was never asked");
});

test("§32.12: an unclear addressee with a cleared ask is admitted by the compile -- the guard that did not clear is not evidence against", async (t) => {
	const table = await hybrid(t, { prepare: metArty, compile: askArty(arty047), responses: narrateOnly("编辑松了口，放你下楼。") });
	await table.session.prompt("我说明来意，请他帮忙调出科比特宅这些年的旧剪报。");
	const [row] = admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.verb === "resolve");
	assert.ok(row, "the compile selected the check on the demand");
	assert.equal(row.basis.compile.read_features.addressee.cleared, false, "the addressee (0.47 against unclear 0.45) did not clear");
	assert.deepEqual([row.path, row.reviewer, row.compile_refused], ["compile", "compile", undefined]);
	assert.deepEqual(Object.keys(row.features), ["ask", "act"], "the evidence is the features it fired on");
	assert.equal(table.lanes.admission.requests().length, 0);
});

test("§32.12 (c): the check whose fired-on ask record is under the gate, or whose bind records carry a parameter with no path, is reviewed by the lane", async (t) => {
	for (const [label, tamper, reason] of [
		["the ask under the gate", (origin) => { origin.basis.compile.read_features.ask = { ...origin.basis.compile.read_features.ask, confidence: 0.41, cleared: false }; return origin; },
			"feature_not_cleared:ask"],
		["a parameter with no recorded path", (origin) => { origin.bindings = [...origin.bindings, { name: "difficulty", path: null }]; return origin; },
			"parameter_path_unrecorded:difficulty"],
	]) await t.test(label, async (tt) => {
		const table = await hybrid(tt, { prepare: metArty, compile: askArty(clearedArty), responses: narrateOnly("编辑松了口，放你下楼。"),
			tamper: (origin) => origin.origin === "policy" && origin.basis?.compile ? tamper(origin) : origin });
		await table.session.prompt("我说明来意，请他帮忙调出科比特宅这些年的旧剪报。");
		const [row] = admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.verb === "resolve");
		assert.ok(row, "the clerk's check reached admission");
		assert.deepEqual([row.path, row.reviewer, row.compile_refused], ["lane", "lane", reason]);
		assert.equal(typeof row.first_byte_ms, "number", "a lane row names when the headers came");
		assert.equal(table.lanes.admission.requests().length, 1);
	});
});

test("§159: a model-origin check cannot reuse the clerk's same-turn authority or reach admission", async (t) => {
	const table = await hybrid(t, { prepare: metArty, compile: askArty(clearedArty), responses: [
		fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", skill: "Persuade", target: "Ruth Blake", goal: "请她调出旧剪报", method: "下楼后说明要查的街道" } })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "编辑松了口。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("after"),
	] });
	await table.session.prompt("我说明来意，请他帮忙调出科比特宅这些年的旧剪报。");
	const rows = admissionRows(table, "test-camp").filter((entry) => entry.verb === "resolve" && !entry.skipped);
	assert.deepEqual(rows.map((entry) => [entry.origin, entry.path]), [["policy", "compile"]]);
	assert.equal(table.lanes.admission.requests().length, 0, "the model cannot repair or select a check through an admission review");
	assert.equal(table.telemetry("test-camp").some(row => row.tool === 'resolve' && row.ok && row.origin !== 'policy'), false);
});

test("§32.12: a clerk move the compile selected is admitted without the fast path's typed call; the same move selected by the route takes the review", async (t) => {
	const destination = (question) => question.key === "destination" ? [aliasWhere(question, (value) => value?.handle === MORGUE), 0.99] : undefined;
	const words = "先去《环球报》剪报室，翻科比特宅这些年的旧报道。";
	await t.test("compile-selected", async (tt) => {
		const typed = countTyped(tt);
		const table = await hybrid(tt, { prepare: tookTheJob, compile: destination, responses: narrateOnly("你到了报馆。"), env: { EXT_JEV_APIKEY: "test-jev-key" } });
		await table.session.prompt(words);
		const [row] = admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.verb === "apply");
		assert.deepEqual([row.path, row.predicate, row.features.destination.row, row.binding_paths.to], ["compile", "move", MORGUE, "stated"]);
		assert.equal(typed.length, 0, "no fast-path typed call");
		assert.equal(table.lanes.admission.requests().length, 0);
	});
	await t.test("route-selected (the compile switched off)", async (tt) => {
		const table = await hybrid(tt, { prepare: tookTheJob, compile: destination, responses: narrateOnly("你到了报馆。"),
			env: { PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" }, engine: { compile: false,
				// The route's need question: `now` for the candidate whose bound destination is the morgue (read from the batch's own
				// candidate rows), `later` for the rest; then finish.
				decision: { decide: async (batch) => complete(Object.fromEntries(batch.questions.map((question) => {
					const candidate = batch.state?.candidates?.[`candidate_${question.key.split("_")[1]}`];
					return [question.key, choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now"
						? (candidate?.bound?.to === MORGUE ? "now" : "later") : "unknown", 0.9])];
				}))) } } });
		await table.session.prompt(words);
		const [row] = admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.verb === "apply");
		assert.ok(row, "the route selected the move and the clerk ran it");
		assert.equal(row.basis?.compile, undefined);
		assert.deepEqual([row.path, row.compile_refused], ["lane", undefined]);
		assert.equal(table.lanes.admission.requests().length, 1);
	});
});

// ---- SL-21: the gate #7 shape -- the check carries the book's meeting, then binds ----------------------------------------

/** Turn 1 walked into the morgue and closed; Arty is the book's gatekeeper there and not yet on stage. */
const movedIn = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: MORGUE }] }],
	["table.narrate", { call_id: "t1-c2", text: "报馆里油墨味很重。" }],
]);
/** The gate #7 compile: the demand at 0.91; Arty as the addressee at 0.51 (0.63 against unclear 0.35: the margin rule); social. */
const gate7Compile = (question) => isAskRow(question) ? [askWords(question)?.demand ? "yes" : "no", 0.91]
	: question.key === "addressee" ? (() => { const alias = aliasWhere(question, (value) => JSON.stringify(value).includes("Arty") || JSON.stringify(value).includes("城市版编辑") || JSON.stringify(value).includes("gatekeeper"));
		return [alias, 0.51, { [alias]: 0.63, unclear: 0.35, none: 0.01 }]; })()
	: question.key === "act" ? [aliasWhere(question, (value) => typeof value === "string" && value.startsWith("social")), 0.97]
	: undefined;
/** Jev for the gate #7 run: the compile above; the check's bind with the approach as given; every route: finish. */
function gate7Jev(skill) {
	return { decide: async (batch) => {
		if (batch.family === COMPILE_FAMILY)
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(gate7Compile(question) ?? ["unclear", 0.9])])));
		if (batch.family === BIND_FAMILY)
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(question.key === "skill" ? skill
				: [({ bonus: "none", penalty: "none", intent: "social" })[question.key] ?? "unknown", 0.84])])));
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
			choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9])])));
	} };
}

test("SL-21 (§32.12): the check the compile selected keeps its evidence through the book's meeting and its bind -- admitted path compile, no lane", async (t) => {
	for (const [label, skill, expected] of [
		["Jev's approach above the gate", ["Persuade", 0.9], { value: "Persuade", path: "jev" }],
		["the gate #7 approach: Persuade 0.67 at confidence 0.59, under the gate", ["Persuade", 0.59, { Persuade: 0.67, unknown: 0.31, Intimidate: 0, Charm: 0, "Fast Talk": 0.02 }],
			{ value: "Persuade", path: "rule-default", rule: "jev_lead" }],
	]) await t.test(label, async (tt) => {
		const table = await hybrid(tt, { prepare: movedIn, compile: gate7Compile, engine: { decision: gate7Jev(skill) }, responses: narrateOnly("编辑松了口，放你下楼。") });
		await table.session.prompt("我说明来意，请他帮忙调出科比特宅这些年的旧剪报。");
		const telemetry = table.telemetry("test-camp");
		const binds = telemetry.filter((row) => row.lane === "run" && row.event === "bind");
		assert.deepEqual(binds.map((row) => [row.candidate, row.status]), [["apply:person:Arty Wilmot", "succeeded"], [`resolve:obligation:${ACCESS}`, "succeeded"]],
			"the book's meeting is carried first, then the check");
		const record = binds[1].bindings.find((entry) => entry.name === "skill");
		assert.deepEqual([record.value, record.path, record.rule], [expected.value, expected.path, expected.rule]);
		const [row] = admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.verb === "resolve");
		assert.ok(row, "the clerk's check reached admission");
		assert.equal(row.basis?.compile?.predicate, "obligation_check", "the check that ran after the meeting still carries the compile's basis");
		assert.deepEqual(row.basis.compile.read_features.ask, { row: `obligation:${ACCESS}`, confidence: 0.91, cleared: true });
		assert.deepEqual([row.path, row.reviewer, row.verdict, row.compile_refused], ["compile", "compile", "authorized", undefined]);
		assert.equal(row.binding_paths.skill, expected.path);
		assert.equal(table.lanes.admission.requests().length, 0, "the lane was never asked");
	});
	// The carried check whose exemption is refused says why, like any compile selection (§32.12).
	await t.test("the carried check with its fired-on ask under the gate: reviewed, compile_refused recorded", async (tt) => {
		const table = await hybrid(tt, { prepare: movedIn, compile: gate7Compile, engine: { decision: gate7Jev(["Persuade", 0.9]) }, responses: narrateOnly("编辑松了口，放你下楼。"),
			tamper: (origin) => { if (origin.origin === "policy" && origin.basis?.compile) origin.basis.compile.read_features.ask = { ...origin.basis.compile.read_features.ask, confidence: 0.41, cleared: false }; return origin; } });
		await table.session.prompt("我说明来意，请他帮忙调出科比特宅这些年的旧剪报。");
		const [row] = admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.verb === "resolve");
		assert.deepEqual([row?.path, row?.compile_refused], ["lane", "feature_not_cleared:ask"]);
		assert.equal(table.lanes.admission.requests().length, 1);
	});
});

// ---- SL-26 (§135.30.3): the declared ordinary check, selected by the compile, admitted on its evidence when the skill cleared ----

/**
 * Jev for the ordinary check at the office: the compile reads `investigate` 0.95 and no destination (0.96); the ordinary
 * family route selects the ordinary tool, which answers Spot Hidden (its profile answer as given).
 */
function scopedCheckJev({method = 0.99, uncertainty = 0.99, difficultyOverride = 0.01, penaltyOverride = 0.01} = {}) {
  return {async decide(batch) {
    if (batch.family === COMPILE_FAMILY) return complete(Object.fromEntries(batch.questions.map(question => [question.key,
      choice(question.key === 'act' ? [aliasWhere(question, value => typeof value === 'string' && value.startsWith('investigate')), 0.99]
        : question.key === 'destination' ? ['none', 0.99] : ['unclear', 0.99])])));
    const settled = batch.state.context?.current_receipts?.some(receipt => receipt.kind === 'roll' && receipt.skill === 'Spot Hidden');
    return complete(Object.fromEntries(batch.questions.map(question => {
      if (question.type === 'noul') {
        let p = 0.01;
        if (batch.family === 'check-selection-profiles' && question.key === 'remaining') p = settled ? 0.01 : 0.99;
        if (batch.family.startsWith('check-selection-need')) {
          const check = batch.state.checks[question.key.replace(/_(uncertain|unsettled|blocked)$/, '')];
          if (question.key.endsWith('_unsettled')) p = settled ? 0.01 : 0.99;
          else if (question.key.endsWith('_uncertain')) p = uncertainty;
          else if (!question.key.endsWith('_blocked') && check?.action.skill === 'Spot Hidden') p = method;
        }
        if (batch.family.startsWith('check-selection-defaults')) p = question.target === 'difficulty' ? difficultyOverride : question.target === 'penalty' ? penaltyOverride : 0.01;
        if (batch.family === 'check-selection-authority') p = 0.99;
        return [question.key, {status: 'answered', type: 'noul', noul: p}];
      }
      let value;
      if (batch.family === 'single-loop-route' && question.key.startsWith('need_')) {
        const candidate = batch.state.candidates[question.key.replace('need_', 'candidate_')];
        if (candidate?.bound?.decision === 'core-check:ordinary-check') value = 'now';
      }
      if (batch.family === 'check-selection-profiles') value = aliasWhere(question, option => option?.skill === 'Spot Hidden');
      if (batch.family === 'check-selection-bind') value = aliasWhere(question, option => option === ({intent: 'investigate', difficulty: 'hard', penalty: 'one'})[question.target]);
      value ??= question.key === 'exit' ? 'finish' : 'unknown' in question.criteria ? 'unknown' : 'later' in question.criteria ? 'later' : Object.keys(question.criteria)[0];
      return [question.key, choice([value, 0.99])];
    })));
  }};
}

test('the agent-selected check uses the scoped Jev binder; an unclear method never reaches LLM admission', async t => {
  for (const method of [0.99, 0.5]) await t.test('method probability ' + method, async tt => {
    const table = await hybrid(tt, {prepare: tookTheJob, compile: () => undefined,
      engine: {decision: scopedCheckJev({method})}, responses: narrateOnly('The desk stands in the quiet office.')});
    await table.session.prompt('I carefully search the desk for a hidden compartment.');
    const rows = table.telemetry('test-camp');
    assert.ok(rows.some(row => row.lane === 'route' && row.purpose === 'route' && row.selected?.some(key => key.startsWith('resolve:check:core-check:ordinary-check:'))));
    assert.ok(!rows.some(row => row.lane === 'route' && row.purpose === 'compile' && row.fired?.some(item => item.predicate === 'ordinary_check')));
    const rolls = rows.filter(row => row.tool === 'resolve' && row.origin === 'policy' && row.ok);
    assert.equal(rolls.length, method > 0.85 ? 1 : 0);
    if (method > 0.85) {
      assert.ok(rolls[0].basis.selection_snapshot);
      const admission = admissionRows(table, 'test-camp').find(row => row.origin === 'policy' && row.verb === 'resolve');
      assert.notEqual(admission.path, 'compile', 'new check parameters receive canonical admission');
      assert.equal(admission.admitted, true);
    } else {
      assert.equal(admissionRows(table, 'test-camp').some(row => row.verb === 'resolve'), false);
      assert.ok(rows.some(row => row.lane === 'check-selection' && row.status === 'unresolved'));
    }
  });
});

test("SL-26 (§32.12): compileAdmission refuses a bind record that says it did not clear; admissionBindings carries the flag", () => {
	const ordinary = { origin: "policy", basis: { compile: { predicate: "ordinary_check", features: { act: "investigate", destination: null },
		read_features: { act: { row: "investigate", confidence: 0.95, cleared: true }, destination: { row: null, confidence: 0.96, cleared: true } } } },
	bindings: [{ name: "decision", path: "stated" }, { name: "intent", path: "jev" }, { name: "skill", path: "jev" }, { name: "goal", path: "composed" }] };
	assert.deepEqual(compileAdmission(ordinary), { ok: true, predicate: "ordinary_check",
		features: { act: { row: "investigate", confidence: 0.95 }, destination: { row: null, confidence: 0.96 } },
		bindingPaths: { decision: "stated", intent: "jev", skill: "jev", goal: "composed" } });
	const under = { ...ordinary, bindings: ordinary.bindings.map((entry) => entry.name === "skill" ? { ...entry, cleared: false } : entry) };
	assert.deepEqual(compileAdmission(under), { ok: false, reason: "parameter_not_cleared:skill" });
	assert.deepEqual(admissionBindings([{ name: "skill", path: "jev", value: "Listen", cleared: false }, { name: "intent", path: "jev", value: "investigate", confidence: 0.9 }], {}),
		[{ name: "skill", path: "jev", cleared: false }, { name: "intent", path: "jev" }]);
});

test('a complete Jev-selected check can be refused by canonical admission without a roll', async t => {
  const table = await hybrid(t, {prepare: tookTheJob, compile: () => undefined,
    engine: {decision: scopedCheckJev()}, responses: narrateOnly('You remain by the desk.'),
    laneResponses: {admission: [fauxAssistantMessage(JSON.stringify({verdict: 'not_authorized', grounds: 'The proposal targets an action the player did not choose.'}))]}});
  await table.session.prompt('I carefully search the desk for a hidden compartment.');
  const rows = table.telemetry('test-camp');
  assert.ok(rows.some(row => row.lane === 'check-selection' && row.status === 'selected'));
  assert.equal(rows.some(row => row.tool === 'resolve' && row.ok), false);
  assert.ok(admissionRows(table, 'test-camp').some(row => row.verb === 'resolve' && row.admitted === false));
});

test('a routed ordinary family does not force a roll when the check tool finds routine action or unresolved necessity', async t => {
  for (const uncertainty of [0.01, 0.5]) await t.test('uncertainty ' + uncertainty, async tt => {
    const table = await hybrid(tt, {prepare: tookTheJob, compile: () => undefined,
      engine: {decision: scopedCheckJev({uncertainty})}, responses: narrateOnly('You remain by the desk.')});
    await table.session.prompt('I look across the desk.');
    const rows = table.telemetry('test-camp');
    assert.equal(rows.some(row => row.tool === 'resolve' && row.ok), false);
    assert.ok(rows.some(row => row.lane === 'check-selection' && row.status === (uncertainty < 0.35 ? 'no_roll' : 'unresolved')));
  });
});

test('rule defaults require established absence of overrides; uncertain modifiers stay unresolved', async t => {
  for (const [label, settings, expected] of [
    ['no override', {}, {difficulty: 'regular', penalty: 'none'}],
    ['established hard difficulty', {difficultyOverride: 0.99}, {difficulty: 'hard', penalty: 'none'}],
    ['uncertain difficulty', {difficultyOverride: 0.5}, undefined],
    ['established penalty', {penaltyOverride: 0.99}, {difficulty: 'regular', penalty: 'one'}],
  ]) await t.test(label, async tt => {
    const table = await hybrid(tt, {prepare: tookTheJob, compile: () => undefined,
      engine: {decision: scopedCheckJev(settings)}, responses: narrateOnly('You stand beside the cabinet.')});
    await table.session.prompt('I carefully search the cabinet for a concealed compartment.');
    const rows = table.telemetry('test-camp');
    assert.equal(rows.filter(row => row.tool === 'resolve' && row.origin === 'policy' && row.ok).length, expected ? 1 : 0);
    if (expected) {
      const defaults = rows.find(row => row.lane === 'check-selection' && row.purpose === 'defaults');
      assert.ok(defaults, 'the defaults decision is recorded before canonical execution');
      if (expected.difficulty === 'hard' || expected.penalty === 'one') assert.ok(rows.some(row => row.lane === 'check-selection' && row.purpose === 'bind'));
    } else assert.ok(rows.some(row => row.lane === 'check-selection' && row.status === 'unresolved' && row.needs.includes('unbound:difficulty')));
  });
});

// ---- §143.15 (ticket 16): the lane failed on the investigator's own declared action -----------------------------------

/**
 * Live table C3, turn 3's malformed answer: the grounds open on an ASCII quote of the player's words, which fails the lane's
 * JSON repair at position 36 exactly as the table's did.
 */
const malformed = () => fauxAssistantMessage(`{"verdict":"authorized","grounds":""我走过去，照他脸上就是一拳。" chose the punch"}`);
const laneVerdict = (row) => fauxAssistantMessage(JSON.stringify(row));
/** SL-19's state (`single-loop-settlement.test.mjs`): Knott has numbers and holds back when hit; no fight is running. */
const knottAtHisDesk = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我盯着他" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "npc", name: "Steven Knott", archetype: "ordinary_adult", why: "test fixture" }] }],
	["table.apply", { call_id: "t1-c2", effects: [{ kind: "npc", name: "Steven Knott", disposition: "avoids_fighting", why: "test fixture" }] }],
	["table.narrate", { call_id: "t1-c3", text: "他在桌后看着你。" }],
]);
/** Jev for the punch: the compile reads a combat act on Knott (the first blow's predicate), the bind takes his fists; routes finish. */
const firstBlowJev = { decide: async (batch) => {
	if (batch.family === COMPILE_FAMILY)
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(question.key === "act"
			? [aliasWhere(question, (value) => typeof value === "string" && value.startsWith("combat")), 0.95]
			: question.key === "target" ? [aliasWhere(question, (value) => JSON.stringify(value).includes("Steven Knott")), 0.95] : ["unclear", 0.9])])));
	if (batch.family === BIND_FAMILY)
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice([question.key === "weapon" ? "unarmed" : "unknown", 0.9])])));
	return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
		choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9])])));
} };
/**
 * The compile's target record under the gate, on the first blow only: its exemption is refused (§32.12), so the lane reviews
 * the clerk's punch. The product's own compile does not produce this record for a blow it selects; it stands for any
 * declared write the lane reviews (a skill under the gate, a route selection).
 */
const targetUnderGate = (origin) => {
	if (origin.origin === "policy" && origin.clerk === "first_blow" && origin.basis?.compile?.read_features?.target)
		origin.basis.compile.read_features.target = { ...origin.basis.compile.read_features.target, confidence: 0.41, cleared: false };
	return origin;
};
const PUNCH = "我不拉闩。我走过去，照他脸上就是一拳。";
const punchRows = (table) => admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.clerk === "first_blow");
const clerkPunch = (table) => table.telemetry("test-camp").find((row) => row.tool === "resolve" && row.origin === "policy" && row.clerk === "first_blow");
/** The investigator's attack rolls among the turn's mechanics (§16.2): what the player sees as the dice. */
const brawl = (table) => table.mechanics().flatMap((entry) => entry.mechanics ?? [])
	.filter((row) => row.kind === "roll" && row.skill === "Fighting (Brawl)" && row.actor_is_investigator === true);

test("§143.15: the player's punch, two malformed answers -- the host runs the one resend at once, the fresh review admits it and the attack is rolled", async (t) => {
	const table = await hybrid(t, { prepare: knottAtHisDesk, engine: { decision: firstBlowJev }, tamper: targetUnderGate, responses: narrateOnly("你一拳打在他脸上。"),
		laneResponses: { admission: [malformed(), malformed(), laneVerdict({ verdict: "authorized", grounds: "the player said they walk over and punch him in the face" })] } });
	await table.session.prompt(PUNCH);

	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 3, "the round's two attempts, then the resend's fresh review");
	assert.match(requests[1], /Your previous answer was not valid JSON for this review \(JSON parse failed: .*position 36/);
	assert.doesNotMatch(requests[2], /Your previous answer/, "the resend is a fresh review, not a third attempt of the round");
	const [failed, resend, ...rest] = punchRows(table);
	assert.equal(rest.length, 0, JSON.stringify(rest));
	assert.deepEqual([failed.ok, failed.reason, failed.attempts, failed.declared, failed.late_rule, failed.then, failed.compile_refused, failed.path],
		[false, "bad_output", 2, true, "not_bookkeeping", "resend", "feature_not_cleared:target", "lane"], "the lane's failure, said as such, and what came next");
	assert.deepEqual([resend.verdict, resend.admitted, resend.resend, resend.resend_by, resend.attempts, resend.path, resend.reviewer],
		["authorized", true, true, "host", 1, "lane", "lane"], "the resend's verdict admitted the punch");
	assert.equal(typeof resend.resend_wait_ms, "number");
	const roll = clerkPunch(table);
	assert.ok(roll?.ok, "the clerk's first blow reached the kernel and was settled");
	assert.equal(roll.outcome_kind, "combat");
	const bind = table.telemetry("test-camp").find((row) => row.lane === "run" && row.event === "bind" && row.candidate === "resolve:combat:first-blow");
	assert.equal(bind?.status, "succeeded");
	assert.ok(brawl(table).length > 0, `the investigator's Fighting (Brawl) roll landed: ${JSON.stringify(table.mechanics())}`);
	assert.match(brawl(table)[0].receipt, /^roll:fighting-brawl-/);
	assert.equal(table.entries("coc-admission-status").length, 0, "no outage");
});

test("§143.15: the resend fails too (four malformed answers) -- §32.2's refusal, counted once; nothing admitted on a failure", async (t) => {
	const table = await hybrid(t, { prepare: knottAtHisDesk, engine: { decision: firstBlowJev }, tamper: targetUnderGate, responses: narrateOnly("他挡开了你的手。"),
		laneResponses: { admission: [malformed(), malformed(), malformed(), malformed()] } });
	await table.session.prompt(PUNCH);

	assert.equal(table.lanes.admission.requests().length, 4, "one resend, never a second");
	const [failed, resend, ...rest] = punchRows(table);
	assert.equal(rest.length, 0, JSON.stringify(rest));
	assert.deepEqual([failed.ok, failed.declared, failed.then], [false, true, "resend"]);
	assert.deepEqual([resend.ok, resend.reason, resend.attempts, resend.resend, resend.resend_by], [false, "bad_output", 2, true, "host"]);
	const refused = clerkPunch(table);
	assert.deepEqual([refused?.ok, refused?.reason], [false, "admission_unavailable"], "unavailability still refuses (§32.2)");
	assert.notEqual(table.telemetry("test-camp").find((row) => row.lane === "run" && row.event === "bind" && row.candidate === "resolve:combat:first-blow")?.status, "succeeded");
	assert.equal(brawl(table).length, 0, "no attack was rolled");
	assert.equal(table.entries("coc-admission-status").length, 0, "the streak counts the one failure returned, not the resend's first review");
});

/** Admission's typed endpoint answering every line `verdict` at `confidence` (the shape `admission-late.test.mjs` answers in). */
function typedAnswers(t, verdict, confidence) {
	const original = globalThis.fetch, requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== "https://api.typesafe.ai/v1/systemone") return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		// The role-first design (§32.12.3.2, roles-2a.3, line-2's SL-97) since the line-2 merge: the line is the investigator's act,
		// every element question admits, and `choice` carries the verdict -- P(admit) = (1 + confidence) / 2 on `chosen` makes the
		// line's confidence |2·P(admit) − 1| the one asked for. v1's `verdict_*` keys are answered as before.
		const roles = { role: "investigator_act", target: "addressed", gate: "no_obstacle", order: "in_step", result: "answers_player", span: "activity_time" };
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria), family = key.replace(/_\d+$/, "");
			let picked, level;
			if (key.startsWith("verdict_")) [picked, level] = [verdict, confidence];
			else if (family === "choice") [picked, level] = [verdict === "authorized" ? "chosen" : "keeper_choice", (1 + confidence) / 2];
			else if (roles[family]) [picked, level] = [roles[family], 1];
			else [picked, level] = [key.startsWith("missing_") ? "none" : keys.includes("none") ? "none" : body.state.playerWords?.[0]?.alias ?? keys[0], 0.97];
			if (!keys.includes(picked)) picked = keys[0];
			const rest = keys.length > 1 ? (1 - level) / (keys.length - 1) : 0;
			return [key, { type: "choice", choice: picked, confidence: level, probabilities: Object.fromEntries(keys.map((option) => [option, option === picked ? level : rest])) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}

test("§143.15 with line-2's typed settle (§32.12.3.2): the route-selected move, two malformed answers, the typed reading authorized at 0.80 -- a move is not a listed class, so no typed_late; the host resends and the lane's verdict settles", async (t) => {
	const typed = typedAnswers(t, "authorized", 0.8);
	const table = await hybrid(t, { prepare: tookTheJob, compile: () => undefined, responses: narrateOnly("你到了报馆。"), env: { EXT_JEV_APIKEY: "test-jev-key" },
		engine: { compile: false, decision: { decide: async (batch) => complete(Object.fromEntries(batch.questions.map((question) => {
			const candidate = batch.state?.candidates?.[`candidate_${question.key.split("_")[1]}`];
			return [question.key, choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now"
				? (candidate?.bound?.to === MORGUE ? "now" : "later") : "unknown", 0.9])];
		}))) } },
		laneResponses: { admission: [malformed(), malformed()] } });
	await table.session.prompt("先去《环球报》剪报室，翻科比特宅这些年的旧报道。");

	// Since the line-2 merge the typed reading settles only the classes `admission.typed_settle.classes` lists (data: `time`);
	// a move is not one, so §32.12.2's late rule does not take it and §143.15's one host resend runs.
	assert.equal(table.lanes.admission.requests().length, 3, "the two malformed answers of one round, then the host's one resend");
	assert.ok(typed.length >= 1, "the typed reviewer read the move");
	const rows = admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.verb === "apply");
	assert.deepEqual(rows.map((row) => [row.ok, row.reason ?? row.verdict, row.path]), [[false, "bad_output", "lane"], [true, "authorized", "lane"]]);
	assert.deepEqual([rows[0].attempts, rows[0].declared, rows[0].late_rule, rows[0].then, rows[0].clerk], [2, true, "class_not_listed", "resend", "declared_bookkeeping"]);
	assert.deepEqual([rows[1].admitted, rows[1].reviewer, rows[1].resend_by], [true, "lane", "host"]);
	const move = table.telemetry("test-camp").find((row) => row.tool === "apply" && row.origin === "policy");
	assert.ok(move?.ok, "the declared move landed");
});

test("§143.15: declaredAction reads the host origin's clerk authority only -- the declared clerks, never a consequence, a person's act, a Keeper or a host call", () => {
	for (const clerk of ["declared_bookkeeping", "declared_check", "stated_obligation", "first_blow", "session_step", "mod_contact"])
		assert.equal(declaredAction({ origin: "policy", clerk }), true, clerk);
	for (const clerk of ["consequence_bookkeeping", "npc_act", "disposition_inference", undefined])
		assert.equal(declaredAction({ origin: "policy", ...(clerk ? { clerk } : {}) }), false, String(clerk));
	assert.equal(declaredAction({ origin: "model", clerk: "first_blow" }), false, "only the dispatcher's policy origin");
	assert.equal(declaredAction(undefined), false);
	assert.ok([...DECLARED_CLERKS].every((clerk) => CLERK_AUTHORITY.includes(clerk)), "every declared clerk is a clerk authority");
});
