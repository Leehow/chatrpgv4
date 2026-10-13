// Controller-only cases retired with single-keeper-streaming-turns; retained cases exercise current shared utilities.
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
import { RATE_LIMITED, lunaEndpoint, registerLuna } from "./luna-endpoint.mjs";
import { askWords, isAskRow } from "./compile-ask.mjs";
import { withOriginTamper } from "./origin-tamper.mjs";
import { DECLARED_CLERKS, DEFAULT_ADMISSION_TIMEOUT_MS, REVIEW_PENDING, REVIEW_TIMEOUT, admissionTimeoutMs, compileAdmission, declaredAction } from "../../extensions/kernel/admission.ts";
import { admissionBindings, createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { BIND_FAMILY, CLERK_AUTHORITY } from "../../runtime/jev/step-policy.ts";
import { COMPILE_FAMILY, COMPILE_PREDICATES, FEATURE_FAMILIES, interpretCompile } from "../../runtime/jev/route-compile.ts";
import { nameSpanBatch } from "../../runtime/jev/untold-name-spans.ts";

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

test("§32.12 (a), §32.12.2: a lane review that streams past its soft cap is collected by the host until its hard deadline, then remains unsettled", async (t) => {
	const before = process.env.PI_COC_ADMISSION_TIMEOUT_MS;
	delete process.env.PI_COC_ADMISSION_TIMEOUT_MS;
	t.after(() => { if (before !== undefined) process.env.PI_COC_ADMISSION_TIMEOUT_MS = before; });
	const provider = await tricklingProvider(t);
	const table = await openTable({
		env: { PI_COC_ADMISSION_MODEL: "trickle/trickle-1" },
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", skill: "Persuade", target: "Ruth Blake", goal: "请她调出旧剪报", method: "说明来意" } })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("output", { text: "你说明了来意。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
	});
	t.after(() => table.dispose());
	table.session.modelRuntime.registerProvider("trickle", { baseUrl: `http://127.0.0.1:${provider.port}/v1`, api: "openai-completions", apiKey: "unused",
		models: [{ id: "trickle-1", name: "trickle", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }] });

	// A hung review is a failure, not a test that never ends: the guard is far past cap + 1 s.
	const prompt = table.session.prompt("我说明来意，请她帮忙调出科比特宅这些年的旧剪报。");
	const outcome = await Promise.race([prompt.then(() => "ended"), new Promise((resolve) => setTimeout(() => resolve("hung"), 35_000).unref())]);
	if (outcome === "hung") { await table.session.abort(); await prompt.catch(() => {}); }
	assert.equal(outcome, "ended", "the hard deadline did not bound the continued call");

	assert.equal(provider.requests(), 1, "one review request, answered 200 and streamed");
	const [row] = admissionRows(table);
	assert.equal(row.verdict, REVIEW_TIMEOUT, "no sufficient verdict by the hard deadline");
	assert.equal(row.admitted, false);
	assert.equal(row.host_continued, true);
	assert.equal(row.cap_ms, 26_000);
	assert.equal(row.hard_cap_ms, 26_000);
	assert.equal(row.path, "lane");
	assert.equal(row.origin, "model", "the Keeper's own call");
	assert.ok(row.ms >= 26_000 && row.ms <= 30_000, `returned within the bounded hard deadline (${row.ms} ms)`);
	assert.equal(table.kernelRequests().filter((entry) => entry.method === "table.resolve").length, 0, "nothing was rolled");
	const refused = table.telemetry().find((entry) => entry.tool === "resolve" && entry.ok === false);
	assert.equal(refused?.reason, REVIEW_TIMEOUT, "the Keeper sees only the terminal timeout");
	assert.ok(table.telemetry().some((entry) => entry.tool === "output" && entry.ok), "the run went on to the delivery");
	assert.equal(table.entries("coc-admission-status").length, 0, "not an outage");
});

test("§32.12, §32.12.2: pending returns and timeouts are not an outage -- a resend past the hard cap is review_timeout, kept for the turn", async (t) => {
	const provider = await tricklingProvider(t);
	const resolve = (target) => fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", skill: "Persuade", target, goal: "请她调出旧剪报", method: "说明来意" } })], { stopReason: "toolUse" });
	const table = await openTable({
		env: { PI_COC_ADMISSION_MODEL: "trickle/trickle-1", PI_COC_ADMISSION_TIMEOUT_MS: "1500" },
		responses: [resolve("Ruth Blake"), resolve("Arty Wilmot"), resolve("Arty Wilmot"),
			fauxAssistantMessage([fauxToolCall("output", { text: "你说明了来意。" })], { stopReason: "toolUse" }), fauxAssistantMessage("after")],
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
		[[REVIEW_TIMEOUT, false, 3000, false], [REVIEW_TIMEOUT, false, 3000, false], [REVIEW_TIMEOUT, true, 3000, false]],
		"the override is the cap; the resend collects the round, which runs out at the hard cap");
	assert.equal(rows[2].ms,0,"a terminal timeout is reused immediately");
	assert.equal(provider.requests(), 2, "the resend made no request of its own");
	assert.equal(table.entries("coc-admission-status").length, 0, "pending returns and a timeout are not an outage");
	const refusals = table.telemetry().filter((entry) => entry.tool === "resolve" && entry.ok === false);
	assert.deepEqual(refusals.map((entry) => entry.reason), [REVIEW_TIMEOUT, REVIEW_TIMEOUT, REVIEW_TIMEOUT]);
	assert.ok(!admissionRows(table).some((row) => row.ok === false), "no unavailability row");
});

test("§32.12: a timeout between two unavailable reviews does not end the outage streak -- the second failure still escalates to the operator", async (t) => {
	// §190.3: a provider 500 is transient and asked again once, so each unavailable review is two 500s.
	const provider = await tricklingProvider(t, ["error", "error", "trickle", "error", "error"]);
	const resolve = (target) => fauxAssistantMessage([fauxToolCall("resolve", { action: { intent: "social", skill: "Persuade", target, goal: "请她调出旧剪报", method: "说明来意" } })], { stopReason: "toolUse" });
	const table = await openTable({
		env: { PI_COC_ADMISSION_MODEL: "trickle/trickle-1", PI_COC_ADMISSION_TIMEOUT_MS: "1500" },
		responses: [resolve("Ruth Blake"), resolve("Arty Wilmot"), resolve("Mrs. Macario"),
			fauxAssistantMessage([fauxToolCall("output", { text: "你说明了来意。" })], { stopReason: "toolUse" }), fauxAssistantMessage("after")],
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
	assert.equal(provider.requests(), 5, "each unavailable review asked its 500 again once (§190.3); the timeout was not");
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
const semanticKey = (key) => key.replace(/__semantic_(facts|execution)$/, '');
const bindChoice = (question, intended) => {
  const [value, confidence, probabilities] = intended, keys = Object.keys(question.criteria);
  const top = (1 + (keys.length - 1) * confidence) / keys.length;
  return choice([value, confidence, Object.fromEntries(keys.map(key => [key, probabilities ? probabilities[key] ?? 0 : key === value ? top : (1-top)/(keys.length-1)]))]);
};
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
				bindChoice(question, [({ skill: "Persuade", bonus: "none", penalty: "none", intent: "social" })[semanticKey(question.key)] ?? "unknown", 0.9])])));
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

/**
 * §177.15's untold-name places, by the product's own batch: its purpose and its `names_s<n>` keys. They ask the same endpoint
 * whether a place in a tool result or a delivery is a person's name; that is no admission review. Captured on fd073fc4f: every
 * request the two compile-selected cases counted was one of these (38 and 39 places of The Haunting's names), and none was
 * an admission request.
 */
const NAME_SPANS_PURPOSE = nameSpanBatch([{ name: "x", text: "\u27e6x\u27e7" }]).state.purpose;
const isNameSpansRequest = (body) => body?.state?.purpose === NAME_SPANS_PURPOSE
	&& Object.keys(body.questions ?? {}).length > 0 && Object.keys(body.questions).every((key) => /^names_s\d+$/.test(key));
/** Admission's own typed endpoint, counted: every request is a typed review this table asked for. */
function countTyped(t) {
	const original = globalThis.fetch, requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== "https://api.typesafe.ai/v1/systemone") return original(url, init);
		const body = JSON.parse(init.body);
		// Time reading, expression references and the untold-name places are independent advisory families, not admission
		// reviews. Their issued question keys identify the family; all still receive the same unavailable endpoint.
		const expression=body.questions?.participates_0&&body.questions?.fit_0_0&&body.questions?.conflict_0_0;
		if (!body.questions?.cut&&!expression&&!isNameSpansRequest(body)) requests.push(body);
		return new Response(JSON.stringify({ error: { message: "the test counts typed requests and answers none" } }), { status: 503 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}

async function hybrid(t, { prepare, compile, responses, env = {}, engine: engineOptions = {}, tamper, laneResponses }) {
	const engine = createHybridEngine({ env: process.env, decision: stubJev(compile), ...engineOptions });
	const table = await openTable({
		realKernel: true, prepareWorkspace: async workspace => {
			await prepare?.(workspace);
			// This fixture counts admission calls, without optional Mod advice decisions.
			kernelSteps(workspace, [["mods.configure", {id: "daily-life", enabled: false}]]);
		}, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: PASS, ...env },
		runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: tamper ? withOriginTamper(engine, tamper) : engine.extension }], responses,
		...(laneResponses ? { laneResponses } : {}),
	});
	t.after(() => table.dispose());
	return table;
}
const narrateOnly = (text) => [fauxAssistantMessage([fauxToolCall("output", { text })], { stopReason: "toolUse" })];

test("§177.15: the typed-call count leaves out only the untold-name places, never an admission review", () => {
	const names = nameSpanBatch([{ name: "Ruth Blake", text: "\u27e6Ruth Blake\u27e7 at the desk" }, { name: "Arty Wilmot", text: "ask \u27e6Arty Wilmot\u27e7" }]);
	const wire = (batch) => ({ model: batch.model, state: batch.state, questions: Object.fromEntries(batch.questions.map((question) => [question.key, { type: question.type, instructions: question.instructions }])) });
	assert.equal(isNameSpansRequest(wire(names)), true, "the product's own name batch");
	assert.equal(isNameSpansRequest({ state: { purpose: "admission" }, questions: { role_0: {}, choice_0: {}, result_0: {} } }), false, "an admission-roles review is counted");
	assert.equal(isNameSpansRequest({ ...wire(names), questions: { ...wire(names).questions, role_0: {} } }), false, "a batch that also asks anything else is counted");
	assert.equal(isNameSpansRequest({ state: { purpose: "something else" }, questions: wire(names).questions }), false, "names keys under another purpose are counted");
});

// ---- SL-21: the gate #7 shape -- the check carries the book's meeting, then binds ----------------------------------------

/**
 * Turn 1 walked into the morgue and closed; Arty is the book's gatekeeper there and not yet on stage. The journal lane
 * labelled him after turn 1, as it does at a table: the clerk carries his meeting only under that label (§103.8 item 5).
 */
const movedIn = (workspace) => kernelSteps(workspace, [
	["table.open", {}], ["table.player_input", { text: "我去《环球报》报馆" }],
	["table.apply", { call_id: "t1-c1", effects: [{ kind: "move", to: MORGUE }] }],
	["table.narrate", { call_id: "t1-c2", text: "报馆里油墨味很重。" }],
	["journal.submit", { job_id: "journal:test-camp:t1", entries: [{ name: "Arty Wilmot", label: "城市版编辑" }] }],
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
			return complete(Object.fromEntries(batch.questions.map((question) => [question.key, bindChoice(question, semanticKey(question.key) === "skill" ? skill
				: [({ bonus: "none", penalty: "none", intent: "social" })[semanticKey(question.key)] ?? "unknown", 0.84])])));
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key,
			choice([question.key === "exit" ? "finish" : Object.keys(question.criteria)[0] === "now" ? "later" : question.criteria.seeks ? "not" : "unknown", 0.9])])));
	} };
}

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
    return complete(Object.fromEntries(batch.questions.map(rawQuestion => {
      const question = {...rawQuestion, key: rawQuestion.key.replace(/__semantic_(facts|execution)$/, '')};
      if (question.type === 'noul') {
        let p = 0.01;
        if (batch.family === 'check-selection-profiles' && question.key === 'remaining') p = settled ? 0.01 : 0.99;
        if (batch.family.startsWith('check-selection-need')) {
          const check = batch.state.checks[question.key.replace(/_(uncertain|unsettled|blocked|selected)$/, '')];
          if (question.key.endsWith('_selected')) p = check?.action.skill === 'Spot Hidden' ? method : 0.01;
          else if (question.key.endsWith('_unsettled')) p = settled ? 0.01 : 0.99;
          else if (question.key.endsWith('_uncertain')) p = uncertainty;
          else if (!question.key.endsWith('_blocked') && check?.action.skill === 'Spot Hidden') p = method;
        }
        if (batch.family.startsWith('check-selection-defaults')) p = question.target === 'difficulty' ? difficultyOverride : question.target === 'penalty' ? penaltyOverride : 0.01;
        if (batch.family === 'check-selection-authority') p = 0.99;
        return [rawQuestion.key, {status: 'answered', type: 'noul', noul: p}];
      }
      let value;
      if (batch.family === 'single-loop-route' && question.key.startsWith('need_')) {
        const candidate = batch.state.candidates[question.key.replace('need_', 'candidate_')];
        if (candidate?.bound?.decision === 'core-check:ordinary-check') value = 'now';
      }
      if (batch.family === 'check-selection-profiles') value = aliasWhere(question, option => option?.skill === 'Spot Hidden');
      if (batch.family === 'check-selection-bind') value = aliasWhere(question, option => option === ({intent: 'investigate', difficulty: 'hard', penalty: 'one'})[question.target]);
      value ??= question.key === 'exit' ? 'finish' : 'unknown' in question.criteria ? 'unknown' : 'later' in question.criteria ? 'later' : Object.keys(question.criteria)[0];
      const confidence = 0.99, keys = Object.keys(question.criteria);
      const probabilities = Object.fromEntries(keys.map(key => [key, key === value ? confidence : (1 - confidence) / (keys.length - 1)]));
      return [rawQuestion.key, choice([value, confidence, probabilities])];
    })));
  }};
}

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
		return complete(Object.fromEntries(batch.questions.map((question) => [question.key, bindChoice(question, [semanticKey(question.key) === "weapon" ? "unarmed" : "unknown", 0.9])])));
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

test("§143.15: declaredAction reads the host origin's clerk authority only -- the declared clerks, never a consequence, a person's act, a Keeper or a host call", () => {
	for (const clerk of ["declared_bookkeeping", "declared_check", "stated_obligation", "first_blow", "session_step", "mod_contact"])
		assert.equal(declaredAction({ origin: "policy", clerk }), true, clerk);
	for (const clerk of ["consequence_bookkeeping", "npc_act", "disposition_inference", undefined])
		assert.equal(declaredAction({ origin: "policy", ...(clerk ? { clerk } : {}) }), false, String(clerk));
	assert.equal(declaredAction({ origin: "model", clerk: "first_blow" }), false, "only the dispatcher's policy origin");
	assert.equal(declaredAction(undefined), false);
	assert.ok([...DECLARED_CLERKS].every((clerk) => CLERK_AUTHORITY.includes(clerk)), "every declared clerk is a clerk authority");
});
