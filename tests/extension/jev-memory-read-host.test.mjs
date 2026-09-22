/** T10 public memory-query host conformance. Controlled decisions and evidence replies are not gameplay. */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as settle } from "node:timers/promises";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import kernelExtension from "../../extensions/kernel/index.ts";
import { bindDecisionAnswers } from "../../runtime/jev/contracts.ts";
import { MEMORY_READ_POLICY_VERSION } from "../../runtime/jev/memory-read-domain.ts";
import { createTaskHostAdapter } from "../../runtime/jev/task-host-session.ts";
import { FAKE_KERNEL } from "./harness.mjs";

class MemoryStore {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async list() { return [...this.records.values()].map(structuredClone); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

function setEnv(values) {
	const previous = new Map();
	for (const [key, value] of Object.entries(values)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	return () => {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

function answers(batch) {
	const raw = Object.fromEntries(batch.questions.map(question => {
		let choice;
		if (question.key.startsWith("relevance:")) choice = "direct";
		else if (question.key.startsWith("priority:")) choice = "essential";
		else if (question.key.startsWith("coverage:")) choice = "essential";
		else if (question.key.startsWith("support:")) choice = "supported";
		else if (question.key.startsWith("applicability:")) choice = "current";
		else if (question.key.startsWith("contradiction:")) choice = "none";
		else choice = Object.keys(question.criteria)[0];
		return [question.key, { status: "answered", type: "choice", choice }];
	}));
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

function planAnswers(batch) {
	if (batch.family !== "table-evidence") return answers(batch);
	const hasObservation = Array.isArray(batch.state.observations) && batch.state.observations.length > 0;
	const memoryCandidate = batch.state.candidates.findIndex(candidate => JSON.stringify(candidate).includes("whole eligible memory pool"));
	assert.ok(hasObservation || memoryCandidate >= 0, JSON.stringify(batch.state.candidates));
	const raw = Object.fromEntries(batch.questions.map(question => {
		let choice;
		if (question.key === "next") choice = hasObservation ? "complete" : `candidate_${memoryCandidate}`;
		else choice = hasObservation ? "sufficient" : "needs_more";
		const probabilities = Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0]));
		return [question.key, { status: "answered", type: "choice", choice, probabilities }];
	}));
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

const privateSnapshot = "snapshot-private-do-not-project";
const privateCommit = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const evidenceRef = {
	version: 1,
	scope: { owner: "session:fixture", campaign: "memory-read-host", worldline: "main", loop: 0, audience: "keeper" },
	resource: `canonical-turn:${privateCommit}:keeper`,
	revision: "original-private-revision",
	sourceType: "turn",
	selector: { kind: "utf16", start: 10, end: 63 },
};
const evidenceRow = {
	alias: "entry:0", origin: "memory", kind: "promise", subject: "Steven Knott",
	text: "Knott promised payment after the written report.", turn: 1, line: "main", loop: 0,
	status: "candidate", state: "accurate", authority: "conversation_report",
	attribution: { kind: "speech", speaker: { name: "Steven Knott", kind: "npc" } }, derived: false, links: [],
};
const boundEvidenceRef = control => ({ ...evidenceRef, scope: structuredClone(control.evidenceScope ?? evidenceRef.scope) });

function evidenceOwner(control, { staleAfterSnapshot, publicPadding = 0 } = {}) {
	return async params => {
		control.evidenceCalls.push(structuredClone(params));
		if (params.action === "snapshot") {
			control.evidenceScope = structuredClone(params.scope);
			const result = { snapshot: privateSnapshot, scope: params.scope, query: params.query, filters: params.filters,
				raw_all: params.raw_all === true, total: 1, indexed: 1, raw: 0,
				source_revision: "private-source-revision", index_revision: "private-index-revision", world_revision: "world-r1",
				coverage: { raw_gap_turns: [], raw_unavailable_lines: [] },
				context: { scene: "office", worldline: "main", loop: 0, clock: null, current_receipts: [] } };
			if (staleAfterSnapshot === "world") control.worldRevision = "world-r2";
			if (staleAfterSnapshot === "source") control.sourceRevision = "source-r2";
			return result;
		}
		if (params.action === "page") return { snapshot: privateSnapshot, offset: 0, total: 1,
			rows: [structuredClone(evidenceRow)], next_offset: null };
		if (params.action === "original") {
			const ref = boundEvidenceRef(control);
			return { alias: evidenceRow.alias, entry: structuredClone(evidenceRow),
			authority: "conversation_report", verified: true, verification_scope: "canonical_original_integrity_only",
			original: { line: "main", loop: 0, turn: 1, commit: privateCommit }, derived: false,
			context: [{ role: "keeper", text: "Knott promised payment after the written report.", range: { offset: 0, end: 49 },
				total_chars: 49, truncated: false, speakers: [{ start: 0, end: 49, name: "Steven Knott", kind: "npc" }], ref }],
			refs: [ref] };
		}
		if (params.action === "finish") return { what: "memory", query: "What did Knott promise?", status: "ready",
			hits: [{ ...structuredClone(evidenceRow), original: { line: "main", loop: 0, turn: 1, commit: privateCommit },
				context: [{ role: "keeper", text: "Knott promised payment after the written report." + "x".repeat(publicPadding) }] }],
			authority: "conversation_report", coverage: { used: [evidenceRow.alias], omitted: [], unknown: [],
				omitted_candidates: 0, total_candidates: 1, raw_gap_turns: [], raw_unavailable_lines: [] }, refs: [boundEvidenceRef(control)] };
		throw new Error(`unexpected evidence action ${params.action}`);
	};
}

async function openHost(t, { responses, decide = answers, memoryReadEnabled = true, ownerOptions, withAdapter = true }) {
	const cwd = await mkdtemp(join(tmpdir(), "jev-memory-read-host-"));
	const requestLog = join(cwd, "kernel-requests.jsonl");
	const hiddenCredentials = Object.fromEntries(Object.keys(process.env)
		.filter(key => /(_API_KEY|_TOKEN|_SECRET)$/.test(key)).map(key => [key, undefined]));
	const restoreEnv = setEnv({ ...hiddenCredentials, PI_COC_KERNEL_CMD: JSON.stringify([process.execPath, FAKE_KERNEL]),
		PI_COC_CAMPAIGN: "memory-read-host", PI_COC_MODE: "play", PI_COC_MEMORY_BACKFILL: "0",
		PI_COC_MODS_WAIT_MS: "0", PI_OFFLINE: "1", FAKE_KERNEL_LOG: requestLog, FAKE_KERNEL_WORKSPACE: "1" });
	const provider = fauxProvider({ provider: "memory-read-host-provider", models: [{ id: "keeper", reasoning: false }] });
	provider.setResponses(responses);
	const modelRuntime = await ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null,
		modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false });
	modelRuntime.registerNativeProvider(provider.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const sessionManager = SessionManager.inMemory(cwd), store = new MemoryStore();
	const control = { worldRevision: "world-r1", sourceRevision: "source-r1", evidenceCalls: [], hooks: [], receiptTracking: [], bridge: undefined };
	const callEvidence = evidenceOwner(control, ownerOptions);
	let session;
	const adapter = withAdapter ? createTaskHostAdapter(() => session, { decide }, { memoryReadEnabled, store, deadlineMs: 30_000 }) : undefined;
	const probe = {
		name: "memory-read-host-probe",
		factory(pi) {
			pi.events.on("coc:kernel-bridge", value => {
				if (!value?.call || control.bridge === value) return;
				control.bridge = value;
				const original = value.call.bind(value);
				value.call = async (method, params) => {
					if (method === "memory.evidence") return callEvidence(params);
					const result = await original(method, params);
					const context = result?._context ?? result?.capsule?._context;
					if (context && typeof context === "object") result._context = { ...structuredClone(context),
						world_revision: control.worldRevision, task_world_revision: control.worldRevision,
						source_revision: control.sourceRevision, task_source_revision: control.sourceRevision };
					return result;
				};
			});
			pi.events.on("coc:capsule", value => {
				const context = value?.context ?? value?.capsule?._context;
				if (context && typeof context === "object") value.context = { ...structuredClone(context),
					world_revision: control.worldRevision, task_world_revision: control.worldRevision,
					source_revision: control.sourceRevision, task_source_revision: control.sourceRevision };
			});
			pi.events.on("coc:task-receipt-tracking", value => control.receiptTracking.push(value));
			pi.on("tool_call", event => control.hooks.push({ type: "tool_call", id: event.toolCallId, name: event.toolName }));
			pi.on("tool_result", event => control.hooks.push({ type: "tool_result", id: event.toolCallId, name: event.toolName, error: event.isError }));
		},
	};
	const factories = [probe, { name: "coc-kernel", factory: kernelExtension }];
	if (adapter) factories.push({ name: "memory-read-task-host", factory: adapter.extension });
	const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager, extensionFactories: factories });
	await loader.reload();
	const created = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), model: provider.getModel("keeper"), modelRuntime,
		thinkingLevel: "off", noTools: "builtin", resourceLoader: loader, sessionManager, settingsManager });
	session = created.session;
	const errors = [...created.extensionsResult.errors];
	await session.bindExtensions({ mode: "rpc", onError: error => errors.push(error) });
	t.after(async () => {
		try {
			if (session._extensionRunner?.hasHandlers?.("session_shutdown")) await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		} finally {
			restoreEnv();
			await settle(50);
			await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
		}
	});
	return { cwd, session, adapter, store, control, errors,
		async requests() { return existsSync(requestLog) ? (await readFile(requestLog, "utf8")).split("\n").filter(Boolean).map(JSON.parse) : []; } };
}

test("ordinary recall query runs a shared child owner task, keeps refs private, and then narrates normally", async t => {
	const batches = [];
	const host = await openHost(t, {
		ownerOptions: { publicPadding: 9_000 },
		responses: [
			fauxAssistantMessage([fauxToolCall("recall", { what: "memory", query: "What did Knott promise?" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "Knott's reported promise was payment after the written report." })], { stopReason: "toolUse" }),
		],
		decide(batch) { batches.push(structuredClone(batch)); return answers(batch); },
	});
	await host.session.prompt("What did Knott promise?", { source: "rpc" });

	const status = host.adapter.status(), requests = await host.requests();
	assert.deepEqual(host.errors, []);
	assert.equal(status.task.status, "closed");
	assert.equal(status.task.reason, "delivered");
	assert.deepEqual(host.control.evidenceCalls.map(call => call.action), ["snapshot", "page", "original", "finish"],
		JSON.stringify([...host.store.records.values()].map(record => ({ domain: record.domain, phase: record.phase,
			status: record.status, result: record.result, decisions: record.decisions.map(row => ({ key: row.key, result: row.result })) }))));
	assert.deepEqual(batches.map(batch => batch.family), ["memory-read", "memory-read"]);
	assert.deepEqual(batches.map(batch => batch.questions.map(question => question.key.split(":", 1)[0])),
		[["coverage"], ["support", "applicability", "contradiction"]]);
	assert.ok(batches.every(batch => batch.familyVersion === MEMORY_READ_POLICY_VERSION));
	const child = [...host.store.records.values()].find(record => record.domain.id === "memory-read");
	assert.equal(child.result.status, "complete");
	assert.equal(child.checkpoint.context.parentId, status.task.checkpoint.context.id);
	const recalled = status.task.observations.find(row => row.proposal.operation === "recall");
	assert.ok(recalled);
	assert.deepEqual(recalled.packet.refs, [boundEvidenceRef(host.control)]);
	assert.deepEqual(recalled.packet.refs[0].scope, status.task.checkpoint.context.scope);
	assert.equal(recalled.packet.receipts.length, 0);
	const toolResult = host.session.messages.find(message => message.role === "toolResult" && message.toolName === "recall");
	const modelText = (toolResult?.content ?? []).filter(block => block.type === "text").map(block => block.text).join("");
	assert.ok(modelText.includes("Knott promised payment"));
	assert.equal(modelText.includes('"raw_gap_turns"'), false);
	assert.equal(modelText.includes('"extraction_backlog"'), true);
	assert.equal(modelText.includes("available original transcript text was included as raw candidates"), true);
	for (const hidden of [privateSnapshot, privateCommit, "private-source-revision", "private-index-revision", evidenceRef.resource, '"refs"', '"ref"']) {
		assert.equal(modelText.includes(hidden), false, hidden);
	}
	assert.ok(Buffer.byteLength(modelText, "utf8") <= 12 * 1024);
	assert.equal(requests.some(row => row.method === "table.recall"), false, "the typed owner answers without bypassing into raw kernel recall");
	assert.equal(requests.filter(row => row.method === "table.narrate").length, 1);
	assert.equal(requests.some(row => row.method === "table.apply"), false);
	assert.ok(host.control.receiptTracking.includes(true));
	for (const name of ["recall", "narrate"]) {
		assert.deepEqual(host.control.hooks.filter(row => row.name === name).map(row => row.type), ["tool_call", "tool_result"]);
	}
});

test("enabling semantic memory keeps the configured deadline while granting its bounded action and input budget", async t => {
	const host = await openHost(t, { responses: [] });
	const before = Date.now();
	await host.session._extensionRunner.emit({ type: "input", text: "Inspect retained evidence.", source: "rpc" });
	await host.session._extensionRunner.emit({ type: "before_agent_start", prompt: "Inspect retained evidence.", systemPrompt: "fixture", systemPromptOptions: {} });
	const budget = host.adapter.status().task.checkpoint.context.budget;
	assert.equal(budget.remainingActions, 128);
	assert.equal(budget.remainingInputTokens, 1_000_000);
	assert.ok(budget.deadlineAt >= before + 29_000 && budget.deadlineAt <= before + 31_000, budget.deadlineAt - before);
});

test("a private plan may choose memory search while opaque evidence coordinates stay out of model text", async t => {
	const privatePlan = { goal: "What did Knott promise?", subgoals: ["Search retained conversation evidence."],
		constraints: ["Read only."], evidenceRequired: ["The exact promise and its current applicability."],
		completion: ["Return supported attributed evidence."], capabilities: ["recall"], replanWhen: [], returnWhen: [] };
	const host = await openHost(t, {
		responses: [
			fauxAssistantMessage([fauxToolCall("submit_plan_packet", privatePlan)], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "Knott's reported promise was payment after the written report." })], { stopReason: "toolUse" }),
		],
		decide: planAnswers,
	});
	await host.session.prompt("What did Knott promise?", { source: "rpc" });

	const status = host.adapter.status(), observed = status.task.observations.find(row => row.proposal.operation === "memory.search");
	assert.equal(status.task.result.status, "complete");
	assert.ok(observed);
	assert.deepEqual(observed.packet.refs, [boundEvidenceRef(host.control)]);
	assert.deepEqual(observed.packet.refs[0].scope, status.task.checkpoint.context.scope);
	const result = host.session.messages.find(message => message.role === "toolResult" && message.toolName === "submit_plan_packet");
	const modelText = JSON.stringify(result?.content ?? []);
	assert.ok(modelText.includes("Knott promised payment"));
	for (const hidden of [privateSnapshot, privateCommit, "private-source-revision", "private-index-revision", evidenceRef.resource, '"refs"', '"ref"']) {
		assert.equal(modelText.includes(hidden), false, hidden);
	}
	assert.ok(Buffer.byteLength(modelText, "utf8") <= 12 * 1024);
});

for (const revision of ["world", "source"]) {
	test(`a ${revision} revision change during the child read refuses the query and prevents delivery`, async t => {
		const host = await openHost(t, {
			ownerOptions: { staleAfterSnapshot: revision },
			responses: [
				fauxAssistantMessage([fauxToolCall("recall", { what: "memory", query: "What did Knott promise?" })], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxToolCall("narrate", { text: "This stale answer must not be delivered." })], { stopReason: "toolUse" }),
			],
		});
		await host.session.prompt("What did Knott promise?", { source: "rpc" }).catch(() => undefined);
		for (let index = 0; index < 50 && host.session.isStreaming; index++) await settle(10);
		await settle(50);
		const requests = await host.requests(), status = host.adapter.status();
		assert.equal(requests.some(row => row.method === "table.narrate"), false);
		const recalled = status.task.observations.find(row => row.proposal.operation === "recall");
		assert.equal(recalled.packet.status, "refused");
		assert.deepEqual(recalled.packet.result, { coc_error: { code: "internal", message: "memory_query_unavailable" } });
		assert.deepEqual(host.control.evidenceCalls.map(call => call.action), ["snapshot"]);
	});
}

test("cancelling a running semantic decision aborts the shared query and prevents delivery", async t => {
	const started = Promise.withResolvers();
	const host = await openHost(t, {
		responses: [
			fauxAssistantMessage([fauxToolCall("recall", { what: "memory", query: "What did Knott promise?" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "This cancelled answer must not be delivered." })], { stopReason: "toolUse" }),
		],
		decide(_batch, lease) {
			started.resolve();
			return new Promise((_resolve, reject) => lease.signal.addEventListener("abort", () => reject(new Error("controlled cancellation")), { once: true }));
		},
	});
	const running = host.session.prompt("What did Knott promise?", { source: "rpc" }).catch(() => undefined);
	await started.promise;
	// Use the public cancellation path. Fabricating an input event also queues a new
	// player turn, which Pi 0.87 now runs before the previous prompt promise resolves.
	await host.session.abort();
	await Promise.race([running, settle(5_000).then(() => { throw new Error("cancelled query did not settle"); })]);
	const requests = await host.requests(), status = host.adapter.status();
	assert.equal(requests.some(row => row.method === "table.narrate"), false);
	assert.equal(status.task.result.status, "cancelled");
});

test("without the typed owner a query is refused explicitly while ordinary raw recall still reaches the kernel", async t => {
	const host = await openHost(t, { withAdapter: false, memoryReadEnabled: false, responses: [
		fauxAssistantMessage([fauxToolCall("recall", { what: "memory", query: "What did Knott promise?" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("recall", { what: "memory" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "The direct memory listing remains available." })], { stopReason: "toolUse" }),
	] });
	await host.session.prompt("Check the memory owner fallback.", { source: "rpc" });
	const requests = await host.requests();
	const recalls = host.session.messages.filter(message => message.role === "toolResult" && message.toolName === "recall");
	assert.equal(recalls.length, 2);
	assert.equal(JSON.stringify(recalls[0]).includes("memory_query_requires_host"), true);
	assert.equal(requests.filter(row => row.method === "table.recall").length, 1);
	assert.equal(requests.filter(row => row.method === "table.narrate").length, 1);
});

test("public query rejects direct read, detail, and nonzero unissued page combinations before kernel recall", async t => {
	const query = "What did Knott promise?";
	const host = await openHost(t, { withAdapter: false, memoryReadEnabled: false, responses: [
		fauxAssistantMessage([fauxToolCall("recall", { what: "memory", query, read: { turn: 1, role: "keeper" } })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("recall", { what: "memory", query, detail: { section: "hits", index: 0 } })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("recall", { what: "memory", query, page: { section: "hits", offset: 1 } })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "The invalid continuations were refused." })], { stopReason: "toolUse" }),
	] });
	await host.session.prompt("Try invalid memory continuations.", { source: "rpc" });
	const requests = await host.requests();
	const recalls = host.session.messages.filter(message => message.role === "toolResult" && message.toolName === "recall");
	assert.equal(recalls.length, 3);
	for (const result of recalls) {
		const text = JSON.stringify(result);
		assert.equal(text.includes("invalid_params"), true);
		assert.equal(text.includes("unissued listing offset") || text.includes("direct read/detail"), true);
	}
	assert.equal(requests.some(row => row.method === "table.recall"), false);
});
