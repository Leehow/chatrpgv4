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
import { withOriginTamper } from "./origin-tamper.mjs";
import { DEFAULT_ADMISSION_TIMEOUT_MS, REVIEW_TIMEOUT, admissionTimeoutMs, compileAdmission } from "../../extensions/kernel/admission.ts";
import { admissionBindings, createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { BIND_FAMILY } from "../../runtime/jev/step-policy.ts";
import { COMPILE_FAMILY, COMPILE_PREDICATES, FEATURE_FAMILIES, interpretCompile } from "../../runtime/jev/route-compile.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MORGUE = "newspaper-morgue", ACCESS = "globe-clippings-access";
const PASS = "4";
const admissionRows = (table, campaign) => table.telemetry(campaign).filter((row) => row.lane === "admission");

// ---- the cap ---------------------------------------------------------------------------------------------------------

test("§32.12: the lane review's cap is 12 s by default, read per review; the variable still overrides", (t) => {
	const before = process.env.PI_COC_ADMISSION_TIMEOUT_MS;
	t.after(() => { if (before === undefined) delete process.env.PI_COC_ADMISSION_TIMEOUT_MS; else process.env.PI_COC_ADMISSION_TIMEOUT_MS = before; });
	delete process.env.PI_COC_ADMISSION_TIMEOUT_MS;
	assert.equal(DEFAULT_ADMISSION_TIMEOUT_MS, 12_000);
	assert.equal(admissionTimeoutMs(), 12_000);
	process.env.PI_COC_ADMISSION_TIMEOUT_MS = "30000";
	assert.equal(admissionTimeoutMs(), 30_000);
	process.env.PI_COC_ADMISSION_TIMEOUT_MS = "soon";
	assert.equal(admissionTimeoutMs(), 12_000);
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

test("§32.12 (a): a lane review that answers 200 and then streams past the cap ends review_timeout within cap + 1 s; nothing is settled and the run goes on", async (t) => {
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
	assert.equal(outcome, "ended", "the review was still streaming 25 s in: the cap did not cut it");

	assert.equal(provider.requests(), 1, "one review request, answered 200 and streamed");
	const [row] = admissionRows(table);
	assert.equal(row.verdict, REVIEW_TIMEOUT);
	assert.equal(row.admitted, false);
	assert.equal(row.timed_out, true);
	assert.equal(row.cap_ms, 12_000);
	assert.equal(row.path, "lane");
	assert.equal(row.origin, "model", "the Keeper's own call");
	assert.ok(row.ms >= 12_000 && row.ms <= 13_000, `ended within cap + 1 s (${row.ms} ms)`);
	assert.equal(typeof row.first_byte_ms, "number", "the headers came first");
	assert.ok(row.first_byte_ms < 2_000, `headers at ${row.first_byte_ms} ms`);
	assert.equal(table.kernelRequests().filter((entry) => entry.method === "table.resolve").length, 0, "nothing was rolled");
	const refused = table.telemetry().find((entry) => entry.tool === "resolve" && entry.ok === false);
	assert.equal(refused?.reason, REVIEW_TIMEOUT, "the Keeper read a review_timeout refusal");
	assert.ok(table.telemetry().some((entry) => entry.tool === "narrate" && entry.ok), "the run went on to the delivery");
	assert.equal(table.entries("coc-admission-status").length, 0, "not an outage");
});

test("§32.12: review timeouts are not an outage -- two in a row leave no service notice and no streak; the identical proposal is refused again at once", async (t) => {
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
	assert.equal(outcome, "ended", "a review was still streaming 20 s in: the 1.5 s cap did not cut it");

	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.verdict, row.reused, row.cap_ms]),
		[[REVIEW_TIMEOUT, false, 1500], [REVIEW_TIMEOUT, false, 1500], [REVIEW_TIMEOUT, true, 1500]], "the override is the cap; the resend is refused from the turn's verdict");
	assert.equal(provider.requests(), 2, "the reused refusal made no request");
	assert.equal(table.entries("coc-admission-status").length, 0, "two timeouts in a row are not an outage");
	const refusals = table.telemetry().filter((entry) => entry.tool === "resolve" && entry.ok === false);
	assert.deepEqual(refusals.map((entry) => entry.reason), [REVIEW_TIMEOUT, REVIEW_TIMEOUT, REVIEW_TIMEOUT]);
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
		["unavailable:model_error", REVIEW_TIMEOUT, "unavailable:model_error"]);
	const notices = table.entries("coc-admission-status");
	assert.equal(notices.length, 1, "unavailable, timeout, unavailable is a streak of two: the timeout neither counted nor reset it");
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
		ask: { status: "answered", type: "choice", choice: "ask_1", confidence: 0.9, probabilities: { ask_1: 0.9, none: 0.1 } },
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
const askArty = (addressee) => (question) => question.key === "ask" ? [aliasWhere(question, (value) => value && typeof value === "object" && "demand" in value), 0.9]
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
		requests.push(JSON.parse(init.body));
		return new Response(JSON.stringify({ error: { message: "the test counts typed requests and answers none" } }), { status: 503 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}

async function hybrid(t, { prepare, compile, responses, env = {}, engine: engineOptions = {}, tamper }) {
	const engine = createHybridEngine({ env: process.env, decision: stubJev(compile), ...engineOptions });
	const table = await openTable({
		realKernel: true, prepareWorkspace: prepare, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: PASS, ...env },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: tamper ? withOriginTamper(engine, tamper) : engine.extension }], responses,
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

test("§32.12 (d): a Keeper-origin write in the same turn is still reviewed by the lane, beside the clerk's compile admission", async (t) => {
	const table = await hybrid(t, { prepare: metArty, compile: askArty(clearedArty), responses: [
		fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", skill: "Persuade", target: "Ruth Blake", goal: "请她调出旧剪报", method: "下楼后说明要查的街道" } })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "编辑松了口。" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("after"),
	] });
	await table.session.prompt("我说明来意，请他帮忙调出科比特宅这些年的旧剪报。");
	const rows = admissionRows(table, "test-camp").filter((entry) => entry.verb === "resolve" && !entry.skipped);
	assert.deepEqual(rows.map((entry) => [entry.origin, entry.path]), [["policy", "compile"], ["model", "lane"]]);
	assert.equal(table.lanes.admission.requests().length, 1, "one lane review: the Keeper's");
	assert.match(table.lanes.admission.requests()[0], /Ruth Blake/, "and it read the Keeper's proposal");
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
const gate7Compile = (question) => question.key === "ask" ? [aliasWhere(question, (value) => value && typeof value === "object" && "demand" in value), 0.91]
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
 * binder answers an ordinary Spot Hidden (its profile answer as given); every route: finish.
 */
function ordinaryJev(profile) {
	return { decide: async (batch) => {
		if (batch.family === COMPILE_FAMILY)
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(question.key === "act"
				? [aliasWhere(question, (value) => typeof value === "string" && value.startsWith("investigate")), 0.95, { [aliasWhere(question, (value) => typeof value === "string" && value.startsWith("investigate"))]: 0.97, unclear: 0.03 }]
				: question.key === "destination" ? ["none", 0.96] : ["unclear", 0.9])])));
		if (batch.family === "ordinary-resolve")
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, choice(question.key === "profile"
				? profile(question) : [({ route: "ordinary", consent: "authorized", actor: "actor_0", intent: "social", difficulty: "regular", bonus: "none", penalty: "none" })[question.key] ?? "unknown", 0.9])])));
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
			choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9])])));
	} };
}
const spotHidden = (question) => aliasWhere(question, (value) => value?.skill === "Spot Hidden");
const libraryUse = (question) => aliasWhere(question, (value) => value?.skill === "Library Use");

test("SL-26 (§135.30.3): the declared ordinary check is selected by the compile, bound by the binder, executed by the clerk; admitted on the compile's evidence only when the skill cleared", async (t) => {
	const words = "我把诺特办公室的书桌仔细搜一遍，看有没有夹层。";
	for (const [label, profile, expected] of [
		["the skill above the gate", (question) => [spotHidden(question), 0.9, { [spotHidden(question)]: 0.92, unknown: 0.08 }],
			{ cleared: true, path: "compile", reviewer: "compile", refused: undefined, lane: 0 }],
		["the skill under the gate (Spot Hidden 0.50 / Library Use 0.45)", (question) => [spotHidden(question), 0.45, { [spotHidden(question)]: 0.5, [libraryUse(question)]: 0.45, unknown: 0.05 }],
			{ cleared: false, path: "lane", reviewer: "lane", refused: "parameter_not_cleared:skill", lane: 1 }],
	]) await t.test(label, async (tt) => {
		const table = await hybrid(tt, { prepare: tookTheJob, compile: () => undefined, engine: { decision: ordinaryJev(profile) }, responses: narrateOnly("书桌里只有账单。") });
		await table.session.prompt(words);
		const telemetry = table.telemetry("test-camp");
		const compileRow = telemetry.find((row) => row.lane === "route" && row.purpose === "compile");
		assert.deepEqual(compileRow.selected, ["resolve:core-check:ordinary-check"], "the compile selected the declared check");
		assert.equal(compileRow.fired[0].predicate, "ordinary_check");
		const binder = telemetry.find((row) => row.lane === "route" && row.purpose === "bind-ordinary");
		assert.equal(binder.skill.value, "Spot Hidden", "the binder's row names the skill it read, by name");
		assert.deepEqual([binder.route?.choice, binder.consent?.choice], ["ordinary", "authorized"], "and the route and consent answers that decided the disposition");
		const roll = telemetry.find((row) => row.tool === "resolve" && row.origin === "policy");
		assert.ok(roll?.ok, "the clerk rolled the check in both cases: the binder executes its answer");
		const bind = telemetry.find((row) => row.lane === "run" && row.event === "bind" && row.candidate === "resolve:core-check:ordinary-check");
		const paths = Object.fromEntries(bind.bindings.map((entry) => [entry.name, entry.path]));
		assert.deepEqual([paths.decision, paths.goal, paths.method, paths.intent, paths.skill], ["stated", "composed", "composed", "jev", "jev"]);
		const intent = bind.bindings.find((entry) => entry.name === "intent"), skill = bind.bindings.find((entry) => entry.name === "skill");
		assert.deepEqual([intent.value, intent.confidence], ["investigate", 0.95], "the intent is the compile's act, not the binder's own reading (social)");
		assert.deepEqual([skill.value, skill.cleared], ["Spot Hidden", expected.cleared]);
		const [row] = admissionRows(table, "test-camp").filter((entry) => entry.origin === "policy" && entry.verb === "resolve");
		assert.deepEqual([row.path, row.reviewer, row.compile_refused], [expected.path, expected.reviewer, expected.refused]);
		assert.equal(row.basis?.compile?.predicate, "ordinary_check");
		assert.equal(table.lanes.admission.requests().length, expected.lane);
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
