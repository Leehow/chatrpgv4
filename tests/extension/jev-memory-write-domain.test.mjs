import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryWriteDomain, decideReferencedMemoryStep, MEMORY_WRITE_CAPABILITY, MEMORY_WRITE_POLICY_VERSION } from "../../runtime/jev/memory-write-domain.ts";
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {runNativeMemory} from '../../runtime/jev/memory-native.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

test('native memory classifies kinds before only the needed annotations',async()=>{
 const calls=[],rows=[];
 const projection=await decideReferencedMemoryStep(packet(),{async decide(batch){calls.push(batch);return answer(batch,happySelection);}},new AbortController().signal,async row=>rows.push(row));
 assert.ok(calls.every(b=>b.questions.every(q=>!q.key.startsWith('retain_'))));
 assert.ok(calls[0].questions.some(q=>q.key.startsWith('kind_')));
 assert.ok(calls.slice(1).every(b=>b.questions.every(q=>!q.key.startsWith('kind_')&&!q.key.startsWith('retain_'))));
 assert.ok(calls.every(b=>b.state.prior.every(p=>b.questions.some(q=>q.target.endsWith(' '+p.alias)))),'only compared priors enter shared state');
 assert.ok(calls.every(b=>b.state.relationDefinitions.temporal_change.includes('Speech alone never proves')),'compact questions retain the complete fulfillment policy once in shared state');
 for(const q of calls.flatMap(b=>b.questions).filter(q=>q.key.startsWith('relation_')))assert.ok(calls.some(b=>b.questions.includes(q)&&b.state.prior.some(p=>q.target.endsWith(' '+p.alias)&&p.statement==='Earlier promise wording.')),'every issued comparison retains its exact shared target');
 assert.ok(projection.decisions.every(d=>d.outcome==='retain'&&d.annotations[0].kind==='promise'));
 assert.ok(projection.decisions.every(d=>!JSON.stringify(d).includes('statement')),'kernel owns source text');
 assert.ok(rows.every(r=>r.ms>=0));
});

test('native negative and uncertain kind sets never request annotations',async()=>{
 for(const selection of ['skip','defer']){
  const calls=[];const result=await decideReferencedMemoryStep(packet(),{async decide(batch){calls.push(batch);return answer(batch,q=>selection==='skip'?'no':'uncertain_attribution');}},new AbortController().signal,async()=>{});
  assert.equal(calls.length,1);assert.ok(result.decisions.every(d=>d.outcome===selection));
 }
});

test('native exact-state decisions survive restart without another provider judgment',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'native-memory-cache-'));t.after(()=>rm(cwd,{recursive:true,force:true}));let requests=0;const rows=[];
 const port={async decide(batch){requests++;return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>{const keys=Object.keys(q.criteria),choice=q.key.startsWith('retain_')?'skip':'no';return[q.key,{status:'answered',type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))}];})));}};
 const options={cwd,campaign:'campaign',signal:new AbortController().signal,port,record:async row=>rows.push(row),call:async()=>({status:'done',remaining:0,candidates:0})};
 const initial=packet();initial.story_sources=structuredClone(initial.step.segments);
 assert.equal((await runNativeMemory(initial,options)).status,'complete');const first=requests;
 assert.equal((await runNativeMemory(initial,options)).status,'complete');assert.equal(requests,first);assert.ok(rows.some(r=>r.event==='decision_cache'&&r.hit));
 const repacked=structuredClone(initial);repacked.step.key='repacked';repacked.step.sequence=9;repacked.step.segments.reverse();
 assert.equal((await runNativeMemory(repacked,options)).status,'complete');assert.equal(requests,first,'repacking identical source occurrences cannot repeat successful judgments');
 const changed=packet();changed.step.segments[0].text+=' Changed.';changed.step.segments[0].ref=sourceRef('player',changed.step.segments[0].text);changed.origin.revision='changed';
 await runNativeMemory(changed,options);assert.ok(requests>first,'changed source cannot hit the earlier decision cache');
});

test('an uncertain story with no remaining source cannot append another empty kernel step',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'native-story-pending-'));t.after(()=>rm(cwd,{recursive:true,force:true}));let writes=0;
 const p=packet({status:'pending',segments:[],story_complete:false,story_context:{threads:[{thread:'promise',supporting:[{statement:'An acquired clue.'}]}]},story_sources:[segment('player:0','player','I ask about a promise.')]});p.step.remaining=0;
 const outcome=await runNativeMemory(p,{cwd,campaign:'campaign',signal:new AbortController().signal,record:async()=>{},call:async()=>{writes++;throw Error('must not submit');},port:{async decide(batch){return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:.5}])));}}});
 assert.equal(outcome.status,'pending_review');assert.equal(writes,0);assert.equal(outcome.steps,0);
});

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

test("v5 issues directed relationship attribution, the complete semantic name catalog, and exact kind and occurrence-relation policy", async () => {
	const ooc = segment("player:0", "player", "Please remember my play preference: ask clearly before accepting a commission, and do not prompt my next action.");
	const issued = packet({ segments: [ooc], step: { key: "ooc-policy", sequence: 0, total: 1, remaining: 1, segments: [ooc] } });
	const run = await runDomain({ packets: [issued] });
	assert.equal(createMemoryWriteDomain().version, MEMORY_WRITE_POLICY_VERSION);
	assert.equal(MEMORY_WRITE_POLICY_VERSION, "5");
	assert.ok(run.calls.every(call => call.familyVersion === "5"));

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
				for (const alias of Object.keys(question.criteria).filter(alias => !["uncertain_attribution","no_annotation"].includes(alias)))
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
		temporal_change: "The new occurrence describes a later state replacing or changing the prior state while preserving both points in time. For a prior non-material promise, actual delivery of the promised answer or information, or an explicit terminal refusal or withdrawal, can settle that commitment even when the new annotation has another kind. A repeated pledge, a mere attempt, another referral, or saying the work is done without its promised result does not settle it. Speech alone never proves a cash, item or object transfer; those require canonical effects.",
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

test('native fanout shares prior material and avoids contradictory retention questions',async()=>{
 const p=packet();p.story_sources=structuredClone(p.step.segments);
 p.prior=Array.from({length:31},(_,i)=>({...p.prior[0],alias:`prior:${i}`,statement:`Earlier promise ${i}. `+'Exact retained context. '.repeat(12)}));p.prior_coverage={total:31,included:31,omitted:0};
 const calls=[];const result=await decideReferencedMemoryStep(p,{async decide(b){calls.push(b);return answer(b,happySelection);}},new AbortController().signal,async()=>{});
 assert.ok(calls.length<=5,`two source annotations must not require ${calls.length} requests`);
 assert.equal(calls.flatMap(b=>b.questions).filter(q=>q.key.startsWith('retain_')).length,0,'one exhaustive kind decision owns retention');
 const relations=calls.flatMap(b=>b.questions).filter(q=>q.key.startsWith('relation_'));assert.equal(relations.length,62,'every issued source/prior pair remains covered');
 assert.ok(relations.every(q=>!q.instructions.includes('Exact retained context.')),'prior wording belongs once in shared state');
 assert.ok(calls.every(b=>{const e=packDecisionBatch(b).estimate;return e.totalUpperBound<=64000&&e.stateUpperBound+e.longestQuestionUpperBound<=32000;}));
 assert.ok(result.decisions.every(d=>d.outcome==='retain'));
});

test('native cache invalidates only questions whose compared prior changes',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'native-memory-prior-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const p=packet();p.story_sources=structuredClone(p.step.segments);const sent=[];
 const options={cwd,campaign:'campaign',signal:new AbortController().signal,record:async()=>{},call:async()=>({status:'done',remaining:0,candidates:2}),port:{async decide(b){sent.push(b);const answers={};for(const q of b.questions){const selection=happySelection(q);answers[q.key]={status:'answered',type:'choice',choice:selection,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selection?1:0]))};}return bindDecisionAnswers(b,answers);}}};
 await runNativeMemory(p,options);const first=sent.length;await runNativeMemory(p,options);assert.equal(sent.length,first);
 const changed=structuredClone(p);changed.prior[0].statement='A genuinely different prior promise.';
 await runNativeMemory(changed,options);const newQuestions=sent.slice(first).flatMap(b=>b.questions);
 assert.equal(newQuestions.length,2);assert.ok(sent.slice(first).every(b=>b.state.prior.length===1));assert.ok(newQuestions.every(q=>q.key.startsWith('relation_')&&q.target.endsWith(' prior:0')));
});

test('native kind uncertainty and missing attribution remain deferred with explicit diagnostics',async()=>{
 for(const blocked of ['kind','knower']){
  const rows=[];const result=await decideReferencedMemoryStep(packet(),{async decide(b){return answer(b,q=>q.key.startsWith(blocked+'_')?'uncertain_attribution':happySelection(q));}},new AbortController().signal,async r=>rows.push(r));
  assert.ok(result.decisions.every(d=>d.outcome==='defer'));
  assert.ok(rows.some(r=>r.event==='reference_source_deferred'&&r.blockers.some(b=>b.target.includes(blocked==='kind'?'promise':'knower'))));
 }
});

test('native large closed-answer batches reserve enough output before the real adapter',async()=>{
 const {createDecisionAdapter}=await import('../../runtime/jev/decision-adapter.ts');
 const p=packet({segments:Array.from({length:12},(_,i)=>segment(`player:${i}`,'player',`Knott made the promise numbered ${i}.`))});p.story_sources=structuredClone(p.step.segments);
 let sent=0,large=0;const adapter=createDecisionAdapter({enabled:true,apiKey:'fixture-only',fetcher:async(_url,options)=>{
  sent++;const body=JSON.parse(options.body),answers={};for(const [key,q] of Object.entries(body.questions)){const selected=happySelection({key,target:q.instructions.target});answers[key]={type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selected?1:0]))};}
  return new Response(JSON.stringify({model:body.model,answers,usage:{input_tokens:1,output_tokens:1}}));
 }});
 const result=await decideReferencedMemoryStep(p,{async decide(b,lease){if(packDecisionBatch(b).estimate.responseUpperBound>10000)large++;return adapter.decide(b,lease);}},new AbortController().signal,async()=>{});
 assert.ok(large>0,'the regression must reach a batch the old fixed output reservation refused');assert.ok(sent>0);assert.ok(result.decisions.every(d=>d.outcome==='retain'));
});

test('native source-complete cache reuses identical semantic input across committed turns',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'native-memory-turn-'));t.after(()=>rm(cwd,{recursive:true,force:true}));const p=packet();p.story_sources=structuredClone(p.step.segments);let requests=0;const submitted=[];
 const options={cwd,campaign:'campaign',signal:new AbortController().signal,record:async()=>{},call:async(_m,args)=>{submitted.push(args);return {status:'done',remaining:0,candidates:2};},port:{async decide(b){requests++;const answers={};for(const q of b.questions){const selected=happySelection(q);answers[q.key]={status:'answered',type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selected?1:0]))};}return bindDecisionAnswers(b,answers);}}};
 await runNativeMemory(p,options);const first=requests;
 const next=structuredClone(p);next.turn++;next.job_id='extract:campaign:t8';next.commit='new-commit';next.origin.revision='new-origin';for(const s of [...next.story_sources,...next.step.segments])s.ref.resource=s.ref.resource.replace('turn:7:','turn:8:');
 await runNativeMemory(next,options);assert.equal(requests,first);assert.equal(submitted.at(-1).job_id,next.job_id,'current owner still validates and submits its own issued sources');
 const changed=structuredClone(next);changed.story_sources[0].text+=' A different surrounding context.';await runNativeMemory(changed,options);assert.ok(requests>first,'same source text with changed context must not reuse attribution');
});

test('native long context is explicit, conditional, and preserves every question',async()=>{
 const p=packet();p.story_sources=structuredClone(p.step.segments);p.prior=Array.from({length:64},(_,i)=>({...p.prior[0],alias:`prior:${i}`,statement:`Exact promise ${i}. `+'Known commitment context. '.repeat(8)}));p.prior_coverage={total:64,included:64,omitted:0};
 const arms=[];for(const longContext of [false,true]){const calls=[];await decideReferencedMemoryStep(p,{async decide(b){calls.push(b);return answer(b,happySelection);}},new AbortController().signal,async()=>{},{longContext});arms.push(calls);}
 assert.ok(arms[1].length<arms[0].length);assert.ok(arms[1].some(b=>b.longContext));assert.ok(arms[1].every(b=>packDecisionBatch(b).estimate.totalUpperBound<=262000));
 assert.deepEqual(arms[0].flatMap(b=>b.questions.map(q=>q.target)).sort(),arms[1].flatMap(b=>b.questions.map(q=>q.target)).sort());
 assert.ok(arms[1].filter(b=>b.longContext).every(b=>{try{packDecisionBatch({...b,longContext:false});return false;}catch{return true;}}));
});

test('native legacy layout delimiters never inherit a surrounding proposition',async()=>{
 const p=packet({segments:[segment('keeper:0','keeper','\u300d\n')]});p.story_sources=structuredClone(p.step.segments);let calls=0;
 const result=await decideReferencedMemoryStep(p,{async decide(){calls++;throw Error('layout delimiters have no annotation');}},new AbortController().signal,async()=>{});
 assert.equal(calls,0);assert.equal(result.decisions[0].outcome,'skip');
});

test('native large memory plans bound packing work rather than reserialize every prefix',async()=>{
 const p=packet({segments:Array.from({length:12},(_,i)=>segment(`player:${i}`,'player',`A promise numbered ${i}.`))});p.story_sources=structuredClone(p.step.segments);p.prior=Array.from({length:64},(_,i)=>({...p.prior[0],alias:`prior:${i}`}));p.prior_coverage={total:64,included:64,omitted:0};const rows=[],calls=[];
 const result=await decideReferencedMemoryStep(p,{async decide(b){calls.push(b);return answer(b,happySelection);}},new AbortController().signal,async r=>rows.push(r),{longContext:true});
 assert.equal(calls.flatMap(b=>b.questions).filter(q=>q.key.startsWith('relation_')).length,768);assert.ok(result.decisions.every(d=>d.outcome==='retain'));
 const planning=rows.filter(r=>r.event==='reference_planning');assert.equal(planning.length,2);assert.ok(planning.reduce((n,r)=>n+r.pack_checks,0)<100);assert.equal(planning.reduce((n,r)=>n+r.batches,0),calls.length);
});

test('native relation candidates respect closed targets and correction ownership', async () => {
 const p=packet();p.step.segments[1].attribution={kind:'keeper_narration'};p.prior[0].status='superseded';const seen=[];
 await decideReferencedMemoryStep(p,{async decide(batch){seen.push(...batch.questions);return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>{const key=Object.keys(q.criteria)[0];const choice=q.key.startsWith('kind_')?(q.target.endsWith(' world_event')?'yes':'no'):q.key.startsWith('subject_')?key:q.key.startsWith('privacy_')?'player_safe':q.key.startsWith('state_')?'accurate':q.key.startsWith('relation_')?'none':'no';return[q.key,{status:'answered',type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))}];})));}},new AbortController().signal,async()=>{},{longContext:true});
 const closed=seen.filter(q=>q.key.startsWith('relation_')&&q.target.endsWith('prior:0')),open=seen.filter(q=>q.key.startsWith('relation_')&&q.target.endsWith('prior:1'));
 assert.ok(closed.length&&open.length);for(const q of closed){assert.equal(q.criteria.temporal_change,undefined);assert.equal(q.criteria.correction,undefined);assert.ok(q.criteria.contradiction);}
 for(const q of open){assert.ok(q.criteria.temporal_change);assert.equal(q.criteria.correction,undefined);}
});

test('native conflicting closures are jointly selected with explicit non-closing fallbacks', async () => {
 for(const uncertain of [false,true]){
 const p=packet({segments:[segment('keeper:0','keeper','The party enters the lobby.',{kind:'keeper_narration'}),segment('keeper:1','keeper','The party reaches the upstairs room.',{kind:'keeper_narration'})]});p.prior=p.prior.slice(0,1);p.prior_coverage={total:1,included:1,omitted:0};const phases=[],trace=[];
 const result=await decideReferencedMemoryStep(p,{async decide(batch){phases.push(batch.id);return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>{const choice=q.key.startsWith('kind_')?(q.target.endsWith(' world_event')?'yes':'no'):q.key.startsWith('closure_')?(uncertain?'uncertain_attribution':'closer:1'):q.key.startsWith('relation_fallback_')?'independent':q.key.startsWith('relation_')?'temporal_change':q.key.startsWith('privacy_')?'player_safe':q.key.startsWith('state_')?'accurate':q.key.startsWith('subject_')?Object.keys(q.criteria)[0]:'no';return[q.key,{status:'answered',type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))}];})));}},new AbortController().signal,async r=>trace.push(r),{longContext:true});
 if(uncertain){assert.ok(result.decisions.every(d=>d.outcome==='defer'));assert.ok(trace.some(r=>r.reason==='closing_conflict'));}
 else{assert.ok(result.decisions.every(d=>d.outcome==='retain'));assert.equal(result.decisions[0].annotations[0].relations[0].relation,'independent');assert.equal(result.decisions[1].annotations[0].relations[0].relation,'temporal_change');}
 assert.ok(phases.some(id=>id.includes(':closures:')));
 }
});

test('a false promise premise can close without assigning its source to a person or losing other kinds', async () => {
 for(const subject of ['no_annotation','uncertain_attribution']){
  const p=packet({segments:[segment('player:0','player','I plan to return tomorrow, but I am making no promise.')]});p.story_sources=structuredClone(p.step.segments);const seen=[];
  const result=await decideReferencedMemoryStep(p,{async decide(batch){seen.push(...batch.questions);return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>{const selected=q.key.startsWith('kind_')?(q.target.endsWith(' promise')||q.target.endsWith(' player_assertion')?'yes':'no'):q.key.startsWith('subject_')?(q.target.includes(' promise ')?subject:'reserved:3'):q.key.startsWith('privacy_')?'player_safe':q.key.startsWith('state_')?'accurate':q.key.startsWith('relation_')?'none':'no';return[q.key,{status:'answered',type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selected?1:0]))}];})));}},new AbortController().signal,async()=>{},{longContext:true});
  const promiseSubject=seen.find(q=>q.target==='player:0 promise subject');assert.ok(promiseSubject.criteria.no_annotation,'negative premise is distinct from an unknown real promisor');
  assert.ok(!Object.values(promiseSubject.criteria).some(v=>v?.kind==='scene'||v?.kind==='clue'));
  if(subject==='no_annotation'){assert.equal(result.decisions[0].outcome,'retain');assert.deepEqual(result.decisions[0].annotations.map(a=>a.kind),['player_assertion']);}
  else assert.equal(result.decisions[0].outcome,'defer','a genuinely unknown promisor is not silently skipped');
 }
});
