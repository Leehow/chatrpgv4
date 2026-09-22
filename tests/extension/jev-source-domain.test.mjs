import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createCanonicalOperationDispatcher } from "../../extensions/kernel/canonical-operation-dispatcher.ts";
import { bindDecisionAnswers } from "../../runtime/jev/contracts.ts";
import { createNativeSourceDomain, nativeConsultationSelection, SOURCE_CONSULT_CAPABILITY } from "../../runtime/jev/native-source-domain.ts";
import { registerSourceOperations } from "../../runtime/jev/source-owner-operations.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";
import { createRuntime } from "../../runtime/host.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const scope = { owner: "session:source-test", campaign: "campaign", worldline: "main", loop: 0, audience: "keeper" };
const readSet = [
	{ kind: "source", resource: "campaign", revision: "source-r1" },
	{ kind: "world", resource: "campaign", revision: "world-r1" },
	{ kind: "model", resource: "keeper", revision: "fixture/keeper" },
];

class MemoryStore {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

function textPdf(streams) {
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${streams.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	for (const [index, stream] of streams.entries()) objects.push(
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 6000] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
	let text = "%PDF-1.7\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(text));
		text += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	return text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const textStream = text => `BT /F1 8 Tf 10 5980 Td 10 TL ${Array.from({ length: Math.ceil(text.length / 80) }, (_, index) =>
	`(${text.slice(index * 80, index * 80 + 80)}) Tj T*`).join(" ")} ET`;

function rootDomain() {
	return {
		id: "root-source",
		version: "1",
		capabilities: [SOURCE_CONSULT_CAPABILITY],
		next(view) {
			if (!view.observations.length) return { kind: "operation", key: "root-consult", operation: "source.consult",
				args: { question: view.plan.goal }, capability: SOURCE_CONSULT_CAPABILITY, basis: [] };
			const packet = view.observations[0].packet;
			const answer = packet.result?.source_answer;
			return { kind: "finish", status: packet.status === "succeeded" && answer?.status === "answered" ? "complete" : "partial",
				remainingNeeds: answer?.status === "answered" ? [] : ["Source consultation did not answer the question."], coverage: packet.coverage };
		},
	};
}

function intent(question) {
	return {
		id: `intent:${question}`,
		rawInput: { version: 1, scope, resource: "turn:1:player", revision: "input-r1", sourceType: "turn",
			selector: { kind: "utf16", start: 0, end: question.length } },
		goal: question,
		limits: ["read_only"],
		scope,
		turn: 1,
		inputRevision: "input-r1",
	};
}

function plan(question) {
	return { goal: question, subgoals: [], constraints: ["Read only."], evidenceRequired: [question],
		completion: ["Return exact supported source evidence or a limitation."], capabilities: [SOURCE_CONSULT_CAPABILITY],
		replanWhen: [], returnWhen: [] };
}

function answerBatch(batch, route) {
	const raw = Object.fromEntries(batch.questions.map(question => {
		let choice;
		if (question.key === "route") choice = route;
		else if (question.key === "coverage") choice = "sufficient";
		else {
			const part = batch.state.parts?.find(row => row.alias === question.key);
			choice = part?.text?.includes("Clinic hours are nine to five") ? "evidence" : "irrelevant";
		}
		return [question.key, { status: "answered", type: "choice", choice }];
	}));
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

function taskView(runtime, id) {
	const record = runtime.snapshot(id);
	return { intent: record.intent, plan: record.plan, context: record.checkpoint.context,
		observations: record.observations, decisions: record.decisions, remainingNeeds: record.remainingNeeds, replans: record.replans };
}

async function fixture(t, options = {}) {
	const home = await mkdtemp(join(tmpdir(), "jev-source-domain-"));
	const filler = "context ".repeat(560);
	const texts = Array.from({ length: 12 }, (_, index) => index === 0
		? `Clinic hours are nine to five. ${filler}`
		: `Background page ${index + 1} only. ${filler}`);
	await writeFile(join(home, "source.pdf"), textPdf(texts.map(textStream)));
	const env = { ...process.env, PI_COC_LAYOUT: "source", PI_COC_RESOURCE_ROOT: ROOT,
		PI_COC_NODE_EXECUTABLE: process.execPath, PI_OFFLINE: "1" };
	const sourceRuntime = createRuntime({ owner: "check", home }, { resourceRoot: ROOT, nodeExecutable: process.execPath, env });
	const info = await sourceRuntime.sourceInfo({ pdf: "source.pdf", cache: "." });
	const calls = [], decisions = [], traces = [], store = new MemoryStore();
	let taskRuntime;
	const decision = { async decide(batch) {
		decisions.push(structuredClone(batch));
		return answerBatch(batch, options.route ?? (String(batch.state.question ?? "").includes("map") ? "visual" : "plaintext"));
	} };
	const dispatcher = createCanonicalOperationDispatcher({
		async prepare() {},
		async execute() { throw new Error("owned source operations must not enter a Pi tool executor"); },
		async finalize() {},
		preparedCallId() { return undefined; },
	});
	const currentReadSet = () => structuredClone(options.stale ? [{ ...readSet[0], revision: "source-r2" }, ...readSet.slice(1)] : readSet);
	taskRuntime = new TaskRuntime({
		decision,
		store,
		domains: [rootDomain(), createNativeSourceDomain()],
		operations: {
			async validate() { return currentReadSet(); },
			async dispatch(proposal, task, journal) {
				return dispatcher.dispatch(proposal, { session: {}, task, journal,
					async validateCurrent() { if (task.revalidate(currentReadSet()).status !== "current") throw new Error("task_read_set_stale"); },
					async recover() { throw new Error("read operations have no settlement recovery"); },
					trace(event) { traces.push(structuredClone(event)); },
				});
			},
		},
		maxSteps: 64,
	});
	let textCalls = 0, visualCalls = 0;
	const binding = { module_id: "book", pdf: "source.pdf", file_sha256: options.badSource ? "0".repeat(64) : info.file_sha256,
		page_count: info.page_count, revision: "binding-r1" };
	const release = registerSourceOperations({
		registerOwned: (name, definition) => dispatcher.registerOwned(name, definition),
		runtime: () => taskRuntime,
		moduleId: () => "book",
		async call(method, params) {
			calls.push({ method, params: structuredClone(params) });
			if (method === "module.source.snapshot") return structuredClone(binding);
			if (method === "module.source.answer.peek") return { cached: false };
			throw new Error(`unexpected owner call ${method}`);
		},
		sourceInfo: (pdf, signal) => sourceRuntime.sourceInfo({ pdf, cache: "." }, signal),
		async sourceText(pdf, pages, expected, signal) {
			textCalls++;
			options.textStarted?.();
			if (options.holdText) await new Promise((resolve, reject) => {
				const abort = () => reject(new Error("controlled source cancellation"));
				signal.addEventListener("abort", abort, { once: true });
				options.releaseText.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
			});
			const bundle=await sourceRuntime.sourceText({ pdf, pages, expected_file_sha256: expected }, signal);
			if(options.changeExtractionOnProof&&textCalls>1){const extraction_version=bundle.extraction_version+":changed";
				return{...bundle,extraction_version,snapshots:bundle.snapshots.map(snapshot=>({...snapshot,revision:createHash("sha256")
					.update(JSON.stringify([extraction_version,bundle.file_sha256,snapshot.page,snapshot.text_sha256])).digest("hex")}))};}
			return bundle;
		},
		async visual(_module, question) {
			visualCalls++;
			return options.visualResult ?? { source_answer: { status: "unresolved", supported: false, prepared: false,
				limitations: [`Review unavailable for ${question}`] } };
		},
	});
	t.after(async () => { release(); await taskRuntime.shutdown(); await sourceRuntime.close(); await rm(home, { recursive: true, force: true }); });
	return { home, taskRuntime, sourceRuntime, dispatcher, store, binding, texts,
		calls, decisions, traces, counts: () => ({ text: textCalls, visual: visualCalls }) };
}

async function runRoot(table, question) {
	const id = await table.taskRuntime.begin({ domain: "root-source", intent: intent(question), lease: {
		owner: "keeper", goal: question, scope, capabilities: [SOURCE_CONSULT_CAPABILITY],
		budget: { deadlineAt: Date.now() + 30_000, remainingInputTokens: 100_000, remainingOutputTokens: 100_000,
			remainingCostUsd: 10, remainingActions: 100 }, readSet,
	} });
	const result = await Promise.race([
		table.taskRuntime.submit(id, plan(question)),
		new Promise((_, reject) => setTimeout(() => reject(new Error("source task deadlocked")), 5_000)),
	]);
	return { id, result, record: table.taskRuntime.snapshot(id) };
}

test("root consultation completes through a child, actual extraction, independent relevance batches, and exact excerpts", async t => {
	const table = await fixture(t);
	const question = "What hours does the clinic keep?";
	const first = await runRoot(table, question);

	assert.equal(first.result.status, "complete");
	assert.equal(first.record.observations.length, 1);
	assert.equal(first.record.observations[0].proposal.operation, "source.consult");
	const sourceAnswer = first.record.observations[0].packet.result.source_answer;
	assert.equal(sourceAnswer.status, "answered");
	assert.equal(sourceAnswer.authority, "native_consultation");
	assert.equal(sourceAnswer.prepared, false);
	assert.equal(sourceAnswer.excerpts.length, 1);
	assert.equal(first.result.refs.length, 1);
	assert.equal(first.result.receipts.length, 0);
	assert.deepEqual(first.result.coverage.used,["p1_0"]);assert.deepEqual(first.result.coverage.unknown,[]);
	assert.deepEqual(first.result.coverage.omitted,[...Array.from({length:11},(_,index)=>`part:p${index+2}_0`)]);
	assert.ok(table.decisions.filter(batch => batch.family === "source-consultation" && batch.questions.some(row => row.key.startsWith("p"))).length >= 2,
		"the large source corpus is classified in independent bounded batches");
	assert.ok(table.decisions.some(batch => batch.questions.some(row => row.key === "coverage")));
	assert.ok(table.traces.some(row => row.stage === "owner-execute"));
	assert.equal(table.calls.some(row => row.method.includes("read") || row.method.includes("finish")), false,
		"native consultation never starts source preparation or publication");

	const child = [...table.store.records.values()].find(record => record.domain.id === "source-consultation");
	assert.ok(child);
	const extracted = child.observations.find(row => row.proposal.operation === "source.text").packet.result.snapshots
		.find(snapshot => snapshot.page === 1).text;
	assert.equal(sourceAnswer.excerpts[0].text, extracted, "the final consultation preserves the actual extracted native text byte-for-byte");
	const selected = nativeConsultationSelection(taskView(table.taskRuntime, child.checkpoint.context.id));
	assert.deepEqual(selected.map(part => [part.alias, part.text]), [["p1_0", extracted]]);
	const unapproved = taskView(table.taskRuntime, child.checkpoint.context.id);
	unapproved.decisions = unapproved.decisions.filter(row => !row.key.startsWith("source-assess:"));
	assert.equal(nativeConsultationSelection(unapproved), undefined, "relevant excerpts without an approved coverage decision are not selectable");

	const decisionCount = table.decisions.length, textCount = table.counts().text;
	const repeated = await runRoot(table, question);
	assert.equal(repeated.result.status, "complete");
	assert.equal(table.decisions.length, decisionCount, "the exact retained consultation makes zero Jev calls");
	assert.equal(table.counts().text, textCount, "the native cache avoids repeated extraction");
	assert.equal(repeated.record.observations[0].packet.result.source_answer.authority, "native_consultation");
});

test("visual and unavailable review paths never acquire native proof or source readiness", async t => {
	const table = await fixture(t, { route: "visual" });
	const result = await runRoot(table, "What shape is the map on the clinic page?");

	assert.equal(result.result.status, "partial");
	assert.equal(table.counts().text, 0);
	assert.equal(table.counts().visual, 1);
	assert.deepEqual(result.result.refs, []);
	assert.equal(result.record.observations[0].packet.result.source_answer.supported, false);
	assert.equal(result.record.observations[0].packet.result.source_answer.prepared, false);
	assert.equal(JSON.stringify(result.record).includes("native_consultation"), false);
	assert.equal(table.calls.some(row => row.method.includes("read") || row.method.includes("finish")), false);
});

test("source-owned proof refuses an extraction version changed after semantic approval",async t=>{
	const table=await fixture(t,{changeExtractionOnProof:true}),result=await runRoot(table,"What hours does the clinic keep?");
	assert.equal(result.result.status,"partial");assert.deepEqual(result.result.refs,[]);assert.equal(table.counts().text,2);
	assert.equal(JSON.stringify(result.record).includes('"authority":"native_consultation"'),false);
});

test("bad source bindings fail stale and cancellation propagates across the parent-child task tree", async t => {
	const bad = await fixture(t, { badSource: true });
	const failed = await runRoot(bad, "What hours does the clinic keep?");
	const badChild = [...bad.store.records.values()].find(record => record.domain.id === "source-consultation");
	assert.equal(failed.result.status, "partial");
	assert.deepEqual(failed.result.refs, []);
	assert.equal(badChild.observations.find(row => row.key === "source-binding").packet.status, "failed");
	assert.equal(badChild.observations.find(row => row.key === "source-binding").packet.result.code, "source_binding_stale");
	assert.equal(bad.counts().text, 0);

	let started;
	const textStarted = new Promise(resolve => { started = resolve; });
	let release;
	const releaseText = new Promise(resolve => { release = resolve; });
	const cancelling = await fixture(t, { holdText: true, textStarted: started, releaseText });
	const running = runRoot(cancelling, "What hours does the clinic keep?");
	await textStarted;
	await cancelling.taskRuntime.cancelForeground("replacement_input");
	release();
	const cancelled = await running;
	assert.equal(cancelled.result.status, "cancelled");
	assert.equal(cancelled.record.status, "closed");
	assert.ok([...cancelling.store.records.values()].filter(record => record.domain.id === "source-consultation")
		.every(record => record.result?.status === "cancelled"));
});

test("canonical owned operations refuse unissued or unapproved native excerpts", async t => {
	const table = await fixture(t);
	const question = "What hours does the clinic keep?";
	const rootId = await table.taskRuntime.begin({ domain: "root-source", intent: intent(question), lease: {
		owner: "keeper", goal: question, scope, capabilities: [SOURCE_CONSULT_CAPABILITY],
		budget: { deadlineAt: Date.now() + 30_000, remainingInputTokens: 100, remainingOutputTokens: 100,
			remainingCostUsd: 1, remainingActions: 10 }, readSet,
	} });
	const task = table.taskRuntime.lease(rootId), identities = new Map();
	const proposal = { id: "unapproved-excerpts", taskId: rootId, operation: "source.excerpts",
		args: { aliases: ["p1_0"], question }, capability: SOURCE_CONSULT_CAPABILITY, scope, readSet, basis: [] };
	const packet = await table.dispatcher.dispatch(proposal, { session: {}, task,
		journal: { async load(id) { return identities.get(id); }, async save(identity) { identities.set(identity.operationId, identity); } },
		async validateCurrent() {}, async recover() { throw new Error("read only"); }, trace() {} });

	assert.equal(packet.status, "failed");
	assert.equal(packet.result.code, "invalid_source_arguments", "an alias is unissued before a bound catalog exists");
	assert.deepEqual(packet.refs, []);
	assert.equal(table.counts().text, 0);
});
