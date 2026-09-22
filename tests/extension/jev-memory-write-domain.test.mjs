import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryWriteDomain, MEMORY_WRITE_CAPABILITY, MEMORY_WRITE_POLICY_VERSION } from "../../runtime/jev/memory-write-domain.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";

class Clock {
	value = 0;
	now = () => this.value;
	schedule = () => () => {};
}
class Store {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

const scope = { owner: "memory-owner", campaign: "campaign", worldline: "main", loop: 0, audience: "keeper" };
const digest = value => createHash("sha256").update(value).digest("hex");
const sourceRef = (role, text, start = 0, end = text.length) => ({
	version: 1,
	scope,
	resource: `turn:7:${role}`,
	revision: digest(text),
	sourceType: "turn",
	selector: { kind: "utf16", start, end },
});

function segment(alias, role, text, attribution) {
	return { alias, role, text, ref: sourceRef(role, text), ...(attribution ? { attribution } : {}) };
}

function packet(overrides = {}) {
	const { segments: overrideSegments, ...rest } = overrides;
	const segments = overrideSegments ?? [segment("player:0", "player", "Knott made a promise."), segment("keeper:0", "keeper", "Knott repeated the promise.")];
	return {
		protocol: "memory-reference-v1",
		job_id: "extract:campaign:t7",
		turn: 7,
		commit: "4ede2b4",
		status: "open",
		origin: { scope, revision: "origin-r1" },
		step: { key: "opaque-step-1", sequence: 0, total: segments.length, remaining: segments.length, segments },
		known_entities: [
			{ alias: "name:knott", name: "Steven Knott", kind: "npc" },
			{ alias: "name:investigator", name: "Thomas Hayes", kind: "investigator" },
		],
		prior: [
			{ alias: "prior:0", kind: "promise", subject: "Steven Knott", statement: "Earlier promise wording.", status: "candidate" },
			{ alias: "prior:1", kind: "promise", subject: "Steven Knott", statement: "Earlier promise wording.", status: "candidate" },
		],
		prior_coverage: { total: 5, included: 2, omitted: 3 },
		story_sources: [],
		story_complete: true,
		...rest,
	};
}

function nextPacket(base, status, remaining, segments = []) {
	return {
		...structuredClone(base),
		status,
		step: { ...structuredClone(base.step), sequence: base.step.sequence + 1, remaining, segments: structuredClone(segments) },
		story_complete: status === "done" ? true : base.story_complete,
		result: { status, remaining },
	};
}

function plan() {
	return {
		goal: "Retain exact committed memory without copying statements.",
		subgoals: [], constraints: [], evidenceRequired: [], completion: ["The kernel owner accepts or defers every issued segment."],
		capabilities: [MEMORY_WRITE_CAPABILITY], replanWhen: [], returnWhen: [],
	};
}

function answer(batch, select) {
	const answers = {};
	for (const question of batch.questions) {
		const selected = select(question, batch);
		answers[question.key] = selected === "unknown" ? { status: "unknown" }
			: { status: "answered", type: "choice", choice: selected };
	}
	const answered = Object.entries(answers).filter(([, value]) => value.status === "answered").map(([key]) => key);
	const unknown = Object.keys(answers).filter(key => !answered.includes(key));
	return { batchId: batch.id, status: unknown.length ? "incomplete" : "complete", answers,
		coverage: { required: batch.questions.map(question => question.key), answered, unknown },
		issues: unknown.map(key => ({ key, code: "unknown_answer" })), usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
}

function happySelection(question) {
	if (question.key.startsWith("retain_")) return "retain";
	if (question.key.startsWith("kind_")) return question.target.endsWith(" promise") ? "yes" : "no";
	if (question.key.startsWith("subject_")) return "name:knott";
	if (question.key.startsWith("privacy_")) return "player_safe";
	if (question.key.startsWith("state_")) return "accurate";
	if (question.key.startsWith("knower_")) return "no";
	if (question.key.startsWith("entity_")) return question.target.endsWith("name:investigator") ? "yes" : "no";
	if (question.key.startsWith("relation_")) return "none";
	throw new Error(`unhandled question ${question.key}`);
}

function observation(proposal, result) {
	return { operationId: proposal.id, status: "succeeded", result, refs: proposal.basis, receipts: [], readSet: proposal.readSet,
		coverage: { used: [], omitted: [], unknown: [] } };
}

async function runDomain({ packets, select = happySelection, submitResult, decisionOverride }) {
	const clock = new Clock(), store = new Store(), calls = [], publications = [], jobCalls = [];
	const queue = [...packets];
	let activePacket = packets[0];
	const operations = {
		async validate(task) { return task.readSet; },
		async dispatch(proposal) {
			if (proposal.operation === "memory.job") {
				jobCalls.push(structuredClone(proposal));
				activePacket = queue.shift();
				return observation(proposal, activePacket);
			}
			if (proposal.operation !== "memory.submit") throw new Error(`unexpected operation ${proposal.operation}`);
			publications.push(structuredClone(proposal));
			const value = submitResult ? submitResult(proposal, publications.length, activePacket) : {
				job_id: "extract:campaign:t7", turn: 7, status: "done", remaining: 0, candidates: 2, written: [], superseded: [],
				next: nextPacket(activePacket, "done", 0),
			};
			if (value.status === "open") activePacket = value.next;
			return observation(proposal, value);
		},
	};
	const decision = {
		async decide(batchValue) {
			calls.push(structuredClone(batchValue));
			return decisionOverride ? decisionOverride(batchValue) : answer(batchValue, select);
		},
	};
	const runtime = new TaskRuntime({ decision, store, operations, domains: [createMemoryWriteDomain()], clock });
	const originRef = sourceRef("player", "origin");
	const id = await runtime.begin({
		domain: "memory-write",
		intent: { id: "memory-intent", rawInput: originRef, goal: "Retain committed memory", limits: [], scope, turn: 7, inputRevision: originRef.revision },
		lease: { owner: "memory", goal: "Retain committed memory", scope, capabilities: [MEMORY_WRITE_CAPABILITY],
			budget: { deadlineAt: 10_000, remainingInputTokens: 100_000, remainingOutputTokens: 100_000, remainingCostUsd: 10, remainingActions: 100 },
			readSet: [{ kind: "memory", resource: "campaign", revision: "memory-r1" }], kind: "committed_memory",
			origin: { turn: 7, sourceRefs: [originRef] }, clock },
	});
	const result = await runtime.submit(id, plan());
	return { result, record: runtime.snapshot(id), calls, publications, jobCalls };
}

test("reference-first domain publishes two occurrence-specific promises without model-copied statements or opaque prompt metadata", async () => {
	const issued = packet();
	const run = await runDomain({ packets: [issued] });
	assert.equal(run.result.status, "complete");
	assert.equal(run.jobCalls.length, 1);
	assert.deepEqual(run.jobCalls[0].args, {});
	assert.equal(run.publications.length, 1);
	const referenced = run.publications[0].args.referenced;
	assert.equal(referenced.step, issued.step.key);
	assert.deepEqual(referenced.decisions.map(row => [row.source, row.outcome]), [["player:0", "retain"], ["keeper:0", "retain"]]);
	for (const row of referenced.decisions) {
		assert.equal(row.annotations.length, 1);
		assert.equal(row.annotations[0].kind, "promise");
		assert.equal(row.annotations[0].subject, "Steven Knott");
		assert.deepEqual(row.annotations[0].entities, ["Thomas Hayes"]);
		assert.equal(Object.hasOwn(row.annotations[0], "relations"), false);
		assert.equal(Object.hasOwn(row.annotations[0], "statement"), false);
	}
	assert.equal(run.publications[0].basis.length, 2);
	const prompts = JSON.stringify(run.calls.map(call => call.state));
	for (const forbidden of [issued.job_id, issued.commit, issued.origin.revision, issued.step.key, '"ref"', '"job_id"'])
		assert.equal(prompts.includes(forbidden), false);
	assert.ok(prompts.includes("player:0") && prompts.includes("prior:0"));
	assert.deepEqual(run.record.decisions.map(row => row.result.status), ["complete", "complete", "complete", "complete", "complete"]);
});

test("v4 issues directed relationship attribution, the complete semantic name catalog, and exact kind and occurrence-relation policy", async () => {
	const ooc = segment("player:0", "player", "Please remember my play preference: ask clearly before accepting a commission, and do not prompt my next action.");
	const issued = packet({ segments: [ooc], step: { key: "ooc-policy", sequence: 0, total: 1, remaining: 1, segments: [ooc] } });
	const run = await runDomain({ packets: [issued] });
	assert.equal(createMemoryWriteDomain().version, MEMORY_WRITE_POLICY_VERSION);
	assert.equal(MEMORY_WRITE_POLICY_VERSION, "4");
	assert.ok(run.calls.every(call => call.familyVersion === "4"));

	const kinds = run.calls.find(call => call.family === "memory-write-kinds");
	assert.ok(kinds);
	assert.deepEqual(kinds.state.source.attribution, { kind: "unknown" }, "older packets fail closed without guessing a speaker");
	assert.deepEqual(run.calls.find(call => call.family === "memory-write-retain").state.sources[0].attribution, { kind: "unknown" });
	assert.ok(run.calls.filter(call => call.family === "memory-write-annotations").every(call => call.state.prior.every(row =>
		row.authority === "conversation_report" && row.attribution.kind === "unknown")), "older prior rows normalize as attributed reports");
	assert.deepEqual(kinds.state.kindDefinitions, {
		world_event: "A durable event or changed condition in the shared fiction; not a speaker's knowledge, belief, preference, correction, or promise.",
		knowledge: "A durable proposition known in fiction by one or more issued knowers; attribution to a knower is required.",
		belief: "An attributed in-fiction epistemic stance that may be accurate, uncertain, or distorted; an out-of-character preference or instruction is not a belief.",
		relationship: "A durable directed in-fiction relationship: the subject is the person whose view or cooperation toward exactly one other issued person is established or changed. Preserve the specific shared event or explicit stance; courtesy alone is insufficient, a promise is not its fulfillment, and the reverse person's feelings are not implied.",
		player_assertion: "A durable player claim about the fiction, character, or campaign state; an out-of-character play or style preference is not an additional assertion merely because the player stated it.",
		player_preference: "An explicit out-of-character preference about play style, pacing, boundaries, or how the Keeper should interact.",
		keeper_correction: "An explicit Keeper correction or retraction of a prior durable claim, linked only to the occurrence it corrects.",
		promise: "An in-fiction commitment by the subject to do, provide, avoid, or preserve something.",
	});
	assert.equal(kinds.state.classificationPolicy,
		"Select multiple kinds only when the exact source independently supports distinct durable propositions for those kinds. Do not multiply one proposition across categories: a player preference is not also a belief or player assertion merely because the player stated it.");

	const annotations = run.calls.filter(call => call.family === "memory-write-annotations");
	assert.ok(annotations.length);
	const catalog = new Map(annotations[0].state.knownNames.map(row => [row.alias, row]));
	assert.deepEqual([...catalog.keys()].sort(), ["name:investigator", "name:knott", "reserved:0", "reserved:1", "reserved:2", "reserved:3"]);
	assert.deepEqual(["reserved:0", "reserved:1", "reserved:2", "reserved:3"].map(alias => catalog.get(alias)?.name),
		["world", "party", "keeper", "player"]);
	for (const call of annotations) {
		for (const question of call.questions) {
			const match = question.target.match(/ (?:knower|entity) (\S+)$/);
			if (match) assert.ok(catalog.has(match[1]), `${match[1]} is defined in the same immutable state`);
			if (question.key.startsWith("subject_")) {
				for (const alias of Object.keys(question.criteria).filter(alias => alias !== "uncertain_attribution"))
					assert.ok(catalog.has(alias), `${alias} is defined in the same immutable state`);
				assert.equal(question.criteria.uncertain_attribution,
					"The exact source does not support assigning an issued subject safely.");
			}
		}
	}
	const relation = annotations.flatMap(call => call.questions).find(question => question.key.startsWith("relation_"));
	assert.ok(relation);
	assert.deepEqual(relation.criteria, {
		none: "No semantic relation: the occurrences concern unrelated propositions, relations, or commitments.",
		duplicate: "The same proposition is repeated without meaningful new confirmation, correction, or temporal change.",
		reinforcement: "The same proposition receives new confirmation or support; a shared topic alone is insufficient.",
		independent: "A distinct proposition about the same relation or commitment should coexist with the prior occurrence; an unrelated proposition is none.",
		correction: "The new occurrence explicitly corrects or retracts the prior occurrence.",
		contradiction: "The new occurrence asserts a proposition incompatible with the prior occurrence without framing it as a later state change.",
		temporal_change: "The new occurrence describes a later state replacing or changing the prior state while preserving both points in time.",
		uncertain_attribution: "The issued evidence does not support classifying this occurrence pair safely.",
	});
});

test("pairwise relation input distinguishes a player report from equal NPC speech without opaque identity", async () => {
	const statement = "The key remains with Knott.";
	const issued = packet({ prior: [
		{ alias: "prior:0", kind: "promise", subject: "Steven Knott", statement, status: "candidate",
			authority: "conversation_report", attribution: { kind: "player" } },
		{ alias: "prior:1", kind: "promise", subject: "Steven Knott", statement, status: "candidate",
			authority: "conversation_report", attribution: { kind: "speech", speaker: { name: "Steven Knott", kind: "npc" } } },
	], prior_coverage: { total: 2, included: 2, omitted: 0 } });
	const run = await runDomain({ packets: [issued] });
	const state = run.calls.find(call => call.family === "memory-write-annotations").state;
	assert.deepEqual(state.prior.map(row => ({ alias: row.alias, statement: row.statement, authority: row.authority, attribution: row.attribution })), [
		{ alias: "prior:0", statement, authority: "conversation_report", attribution: { kind: "player" } },
		{ alias: "prior:1", statement, authority: "conversation_report",
			attribution: { kind: "speech", speaker: { name: "Steven Knott", kind: "npc" } } },
	]);
	assert.equal(JSON.stringify(state.prior).includes("npc-steven-knott"), false);
});

test("equal speech occurrences retain distinct semantic speakers, refs, and source order without opaque IDs", async () => {
	const first = segment("keeper:0", "keeper", "Same claim.", { kind: "speech", speaker: { name: "Steven Knott", kind: "npc" } });
	const second = segment("keeper:1", "keeper", "Same claim.", { kind: "speech", speaker: { name: "Thomas Hayes", kind: "investigator" } });
	const issued = packet({ segments: [first, second], step: {
		key: "attributed-duplicates", sequence: 0, total: 2, remaining: 2, segments: [first, second],
	} });
	const run = await runDomain({ packets: [issued] });
	assert.equal(run.result.status, "complete");
	const retain = run.calls.find(call => call.family === "memory-write-retain");
	assert.deepEqual(retain.state.sources.map(source => source.attribution), [
		{ kind: "speech", speaker: { name: "Steven Knott", kind: "npc" } },
		{ kind: "speech", speaker: { name: "Thomas Hayes", kind: "investigator" } },
	]);
	const kindStates = run.calls.filter(call => call.family === "memory-write-kinds").map(call => call.state.source);
	assert.deepEqual(kindStates.map(source => [source.alias, source.attribution.speaker]), [
		["keeper:0", { name: "Steven Knott", kind: "npc" }],
		["keeper:1", { name: "Thomas Hayes", kind: "investigator" }],
	]);
	assert.ok(kindStates.every(source => !JSON.stringify(source.attribution).includes("npc-steven-knott")));
	assert.deepEqual(run.publications[0].basis, [first.ref, second.ref], "host SourceRefs remain byte-for-byte unchanged");
	assert.deepEqual(run.publications[0].args.referenced.decisions.map(row => [row.source, row.outcome, row.annotations[0].kind]), [
		["keeper:0", "retain", "promise"], ["keeper:1", "retain", "promise"],
	]);
	assert.equal(JSON.stringify(run.publications[0].args.referenced).includes("statement"), false);
});

test("speech cannot offer or publish world_event even when a controlled port returns yes", async () => {
	const spoken = segment("keeper:0", "keeper", "The money is still with me.",
		{ kind: "speech", speaker: { name: "Steven Knott", kind: "npc" } });
	const issued = packet({ segments: [spoken], step: { key: "spoken-world", sequence: 0, total: 1, remaining: 1, segments: [spoken] } });
	const select = question => {
		if (question.key.startsWith("retain_")) return "retain";
		if (question.target.endsWith(" world_event")) return "yes";
		if (question.key.startsWith("kind_")) return "no";
		return happySelection(question);
	};
	const run = await runDomain({ packets: [issued], select,
		submitResult: () => ({ job_id: issued.job_id, turn: 7, status: "pending", remaining: 1, candidates: 0, written: [], superseded: [],
			next: nextPacket(issued, "pending", 1, issued.step.segments) }) });
	const kinds = run.calls.find(call => call.family === "memory-write-kinds");
	assert.deepEqual(kinds.questions.find(question => question.target.endsWith(" world_event")).criteria, {
		no: "Host attribution does not identify this exact source as Keeper narration, so it cannot be unqualified world truth.",
	});
	assert.equal(run.calls.some(call => call.family === "memory-write-annotations"), false);
	assert.equal(run.result.status, "failed", "An answer outside the issued closed criteria fails before durable decisions or publication");
	assert.ok(run.result.remainingNeeds.includes("invalid_task_record"));
	assert.deepEqual(run.publications, []);
});

test("strict attribution shape rejects extra fields and malformed semantic speakers", async () => {
	for (const value of [
		{ kind: "speech", speaker: { name: "Knott", kind: "npc" }, opaque_id: "npc-knott" },
		{ kind: "speech", speaker: { name: "Knott", kind: "person" } },
		{ kind: "speech", speaker: { name: "", kind: "npc" } },
		{ kind: "speech", speaker: { name: " Knott ", kind: "npc" } },
		{ kind: "reported" },
	]) {
		const bad = segment("keeper:0", "keeper", "Claim.");
		bad.attribution = value;
		const issued = packet({ segments: [bad], step: { key: "bad-attribution", sequence: 0, total: 1, remaining: 1, segments: [bad] } });
		const run = await runDomain({ packets: [issued] });
		assert.equal(run.result.status, "failed", JSON.stringify(run.result));
		assert.ok(run.result.remainingNeeds.includes("invalid_memory_reference_packet"), JSON.stringify(run.result));
	}
	const player = segment("player:0", "player", "Claim.");
	player.attribution = { kind: "keeper_narration" };
	const issued = packet({ segments: [player], step: { key: "wrong-role-attribution", sequence: 0, total: 1, remaining: 1, segments: [player] } });
	const run = await runDomain({ packets: [issued] });
	assert.equal(run.result.status, "failed");
	assert.ok(run.result.remainingNeeds.includes("invalid_memory_reference_packet"));
});

test("unsupported subject attribution explicitly defers the source instead of forcing an issued name", async () => {
	const issued = packet({ segments: [segment("player:0", "player", "A durable statement with unsupported attribution.")], step: {
		key: "uncertain-subject", sequence: 0, total: 1, remaining: 1,
		segments: [segment("player:0", "player", "A durable statement with unsupported attribution.")],
	} });
	const select = question => question.key.startsWith("subject_") ? "uncertain_attribution" : happySelection(question);
	const run = await runDomain({ packets: [issued], select,
		submitResult: () => ({ job_id: issued.job_id, turn: 7, status: "pending", remaining: 1, candidates: 0, written: [], superseded: [],
			next: nextPacket(issued, "pending", 1, issued.step.segments) }) });
	assert.equal(run.result.status, "pending");
	assert.deepEqual(run.publications[0].args.referenced.decisions, [{ source: "player:0", outcome: "defer" }]);
	const subject = run.calls.flatMap(call => call.questions).find(question => question.key.startsWith("subject_"));
	assert.ok(subject && Object.hasOwn(subject.criteria, "uncertain_attribution"));
});

test("unknown retain and unavailable annotation decisions defer honestly while skip remains skip", async () => {
	const issued = packet({ segments: [segment("player:0", "player", "First."), segment("player:1", "player", "Second."),
		segment("player:2", "player", "Third.")], step: { key: "step-defer", sequence: 0, total: 3, remaining: 3,
			segments: [segment("player:0", "player", "First."), segment("player:1", "player", "Second."), segment("player:2", "player", "Third.")] } });
	const select = question => {
		if (question.key === "retain_0") return "retain";
		if (question.key === "retain_1") return "skip";
		if (question.key === "retain_2") return "unknown";
		return happySelection(question);
	};
	const run = await runDomain({
		packets: [issued], select,
		decisionOverride(batchValue) {
			if (batchValue.family === "memory-write-kinds") return { batchId: batchValue.id, status: "unavailable", answers: {}, issues: [],
				coverage: { required: batchValue.questions.map(row => row.key), answered: [], unknown: batchValue.questions.map(row => row.key) },
				failure: { code: "service_error", retryable: false } };
			return answer(batchValue, select);
		},
		submitResult: () => ({ job_id: issued.job_id, turn: 7, status: "pending", remaining: 2, candidates: 0, written: [], superseded: [],
			story: { status: "unclear", thread: null, bridge_delivered: false }, replayed: false,
			next: nextPacket(issued, "pending", 2, [issued.step.segments[0], issued.step.segments[2]]) }),
	});
	assert.equal(run.result.status, "pending", JSON.stringify(run.result));
	assert.deepEqual(run.publications[0].args.referenced.decisions, [
		{ source: "player:0", outcome: "defer" },
		{ source: "player:1", outcome: "skip" },
		{ source: "player:2", outcome: "defer" },
	]);
	assert.equal(JSON.stringify(run.publications[0].args.referenced).includes("statement"), false);
});

test("a partially answered kind set defers the whole occurrence instead of dropping the unknown kind", async () => {
	const issued = packet({ segments: [segment("player:0", "player", "One uncertain multi-kind statement.")], step: {
		key: "partial-kinds", sequence: 0, total: 1, remaining: 1,
		segments: [segment("player:0", "player", "One uncertain multi-kind statement.")],
	} });
	const select = question => {
		if (question.key.startsWith("retain_")) return "retain";
		if (question.target.endsWith(" promise")) return "yes";
		if (question.target.endsWith(" belief")) return "unknown";
		if (question.key.startsWith("kind_")) return "no";
		return happySelection(question);
	};
	const run = await runDomain({ packets: [issued], select,
		submitResult: () => ({ job_id: issued.job_id, turn: 7, status: "pending", remaining: 1, candidates: 0, written: [], superseded: [],
			next: nextPacket(issued, "pending", 1, issued.step.segments) }) });
	assert.equal(run.result.status, "pending");
	assert.deepEqual(run.publications[0].args.referenced.decisions, [{ source: "player:0", outcome: "defer" }]);
});

test("one Keeper narration segment can retain all eight unique issued kinds", async () => {
	const narration = segment("keeper:0", "keeper", "One segment carries several durable annotations.", { kind: "keeper_narration" });
	const issued = packet({ segments: [narration], step: {
		key: "all-kinds", sequence: 0, total: 1, remaining: 1,
		segments: [narration],
	} });
	const select = question => {
		if (question.key.startsWith("retain_")) return "retain";
		if (question.key.startsWith("kind_")) return "yes";
		if (question.key.startsWith("subject_")) {
			if (question.target.includes("world_event")) return "reserved:0";
			if (question.target.includes("player_assertion") || question.target.includes("player_preference")) return "reserved:3";
			if (question.target.includes("keeper_correction")) return "reserved:2";
			return "name:knott";
		}
		if (question.key.startsWith("privacy_")) return "keeper_only";
		if (question.key.startsWith("state_")) return "uncertain";
		if (question.key.startsWith("knower_")) return "no";
		if (question.key.startsWith("entity_")) return question.target.includes(" relationship ") && question.target.endsWith("name:investigator") ? "yes" : "no";
		if (question.key.startsWith("relation_")) return "none";
		return happySelection(question);
	};
	const run = await runDomain({ packets: [issued], select });
	assert.equal(run.result.status, "complete");
	const annotations = run.publications[0].args.referenced.decisions[0].annotations;
	assert.equal(annotations.length, 8);
	assert.equal(new Set(annotations.map(row => row.kind)).size, 8);
	assert.deepEqual(annotations.map(row => row.kind).sort(), [
		"belief", "keeper_correction", "knowledge", "player_assertion", "player_preference", "promise", "relationship", "world_event",
	]);
});

test("sixty-four occurrence relations split within one kind without losing issued questions", async () => {
	const prior = Array.from({ length: 64 }, (_, index) => ({ alias: `prior:${index}`, kind: "promise", subject: "Steven Knott",
		statement: `Earlier promise ${index}.`, status: "candidate" }));
	const issued = packet({ prior, prior_coverage: { total: 64, included: 64, omitted: 0 },
		segments: [segment("player:0", "player", "A later promise occurrence.")], step: {
			key: "many-prior", sequence: 0, total: 1, remaining: 1, segments: [segment("player:0", "player", "A later promise occurrence.")],
		} });
	const run = await runDomain({ packets: [issued] });
	assert.equal(run.result.status, "complete");
	const annotationCalls = run.calls.filter(call => call.family === "memory-write-annotations");
	assert.ok(annotationCalls.length > 1, "one kind is split into bounded independent question arrays");
	assert.ok(annotationCalls.every(call => Buffer.byteLength(JSON.stringify(call), "utf8") <= 32_768));
	const relationQuestions = annotationCalls.flatMap(call => call.questions).filter(question => question.key.startsWith("relation_"));
	assert.equal(relationQuestions.length, 64);
	assert.deepEqual(relationQuestions.map(question => question.target.split(" ").at(-1)), prior.map(row => row.alias));
	const annotation = run.publications[0].args.referenced.decisions[0].annotations[0];
	assert.equal(annotation.kind, "promise");
	assert.equal(Object.hasOwn(annotation, "relations"), false);
});

test("an oversized immutable prior context explicitly defers instead of dropping relation coverage", async () => {
	const prior = Array.from({ length: 64 }, (_, index) => ({ alias: `prior:${index}`, kind: "promise", subject: "Steven Knott",
		statement: `${index}:${"x".repeat(395)}`, status: "candidate" }));
	const issued = packet({ prior, prior_coverage: { total: 80, included: 64, omitted: 16 },
		segments: [segment("player:0", "player", "A later promise occurrence.")], step: {
			key: "oversized-prior", sequence: 0, total: 1, remaining: 1, segments: [segment("player:0", "player", "A later promise occurrence.")],
		} });
	const run = await runDomain({ packets: [issued],
		submitResult: () => ({ job_id: issued.job_id, turn: 7, status: "pending", remaining: 1, candidates: 0, written: [], superseded: [],
			next: nextPacket(issued, "pending", 1, issued.step.segments) }) });
	assert.equal(run.result.status, "pending");
	assert.deepEqual(run.publications[0].args.referenced.decisions, [{ source: "player:0", outcome: "defer" }]);
	assert.equal(run.calls.some(call => call.family === "memory-write-annotations"), false);
	assert.equal(issued.prior_coverage.omitted, 16, "the kernel-owned packet retains explicit omitted-prior coverage");
});

test("owner supplied next packet advances source order without inventing a cursor or second job read", async () => {
	const first = packet({ segments: [segment("player:0", "player", "First.")], step: {
		key: "step-one", sequence: 0, total: 2, remaining: 2, segments: [segment("player:0", "player", "First.")],
	} });
	const second = packet({ status: "open", segments: [segment("player:1", "player", "Second.")], step: {
		key: "step-two", sequence: 1, total: 2, remaining: 1, segments: [segment("player:1", "player", "Second.")],
	} });
	const run = await runDomain({
		packets: [first],
		select: question => question.key.startsWith("retain_") ? "skip" : happySelection(question),
		submitResult: (_proposal, count) => count === 1
			? { job_id: first.job_id, turn: 7, status: "open", remaining: 1, candidates: 0, written: [], superseded: [], next: second }
			: { job_id: first.job_id, turn: 7, status: "done", remaining: 0, candidates: 0, written: [], superseded: [],
				replayed: true, next: nextPacket(second, "done", 0) },
	});
	assert.equal(run.result.status, "complete", JSON.stringify(run.result));
	assert.equal(run.jobCalls.length, 1);
	assert.deepEqual(run.publications.map(row => row.args.referenced.step), ["step-one", "step-two"]);
	assert.deepEqual(run.publications.map(row => row.args.referenced.decisions[0].source), ["player:0", "player:1"]);
});

test("story assessment submits only issued aliases and never copied frame or delivery text", async () => {
	const player = segment("story-player:0", "player", "I understand the connection."), keeper = segment("story-keeper:0", "keeper", "The bridge is now explicit.");
	const issued = packet({ status: "pending", segments: [], step: {
		key: "story-step", sequence: 1, total: 2, remaining: 0, segments: [],
	}, story_complete: false, story_context: { threads: [{ alias: "thread-issued", thread: "Causal Thread", claim: "A supplied causal claim", supporting: ["acquired"] }] },
	story_sources: [player, keeper] });
	const select = question => {
		if (question.key === "story_status") return "aligned";
		if (question.key === "story_thread") return "thread-issued";
		if (question.key === "frame_source") return player.alias;
		if (question.key === "bridge_delivered") return "yes";
		if (question.key === "delivery_source") return keeper.alias;
		return happySelection(question);
	};
	const run = await runDomain({ packets: [issued], select, submitResult: () => ({ job_id: issued.job_id, turn: 7, status: "done", remaining: 0,
		candidates: 0, written: [], superseded: [], story: { status: "aligned", thread: "Causal Thread", bridge_delivered: true }, replayed: true,
		next: nextPacket(issued, "done", 0) }) });
	assert.equal(run.result.status, "complete", JSON.stringify(run.result));
	assert.deepEqual(run.publications[0].args.referenced.story, {
		status: "aligned", thread: "Causal Thread", frame_source: player.alias, bridge_delivered: true, delivery_source: keeper.alias,
	});
	const payload = JSON.stringify(run.publications[0].args.referenced);
	assert.equal(payload.includes(player.text), false);
	assert.equal(payload.includes(keeper.text), false);
	assert.equal(run.publications[0].basis.length, 2);
	const storyState = run.calls.find(call => call.family === "memory-write-story").state;
	assert.deepEqual(storyState.sources.map(source => source.attribution), [{ kind: "unknown" }, { kind: "unknown" }]);
});
