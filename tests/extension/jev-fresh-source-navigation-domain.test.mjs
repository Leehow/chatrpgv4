import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { bindDecisionAnswers } from "../../runtime/jev/contracts.ts";
import {
	createFreshSourceNavigationDomain,
	FRESH_SOURCE_CLASSIFICATION_POLICY,
	FRESH_SOURCE_NAVIGATION_CAPABILITY,
	FRESH_SOURCE_NAVIGATION_VERSION,
	FRESH_SOURCE_ROLE_DEFINITIONS,
	FRESH_SOURCE_ROLES,
	materializeNavigation,
} from "../../runtime/jev/fresh-source-navigation-domain.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";

class Store {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

const scope = { owner: "fresh-source", campaign: "campaign", worldline: "main", loop: 0, audience: "keeper" };
const readSet = [{ kind: "source", resource: "module:book", revision: "source-r1" }];
const fileSha = "a".repeat(64);
const rawRef = { version: 1, scope, resource: "fresh-source-request", revision: "request-r1", sourceType: "draft",
	selector: { kind: "field", path: ["request"] } };
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
const snapshot = (page, text, pdfLabel = String(page), extraction = "native-v1") => {
	const textSha = hash(text);
	return { page, pdf_label: pdfLabel, text, text_sha256: textSha,
		revision: hash(JSON.stringify([extraction, fileSha, page, textSha])), availability: text.length ? "text" : "empty" };
};
const packet = (proposal, status, result) => ({ operationId: proposal.id, status, result, refs: [], receipts: [], readSet: proposal.readSet,
	coverage: { used: [], omitted: [], unknown: [] } });

function view(runtime, id) {
	const record = runtime.snapshot(id);
	return { intent: record.intent, plan: record.plan, context: runtime.lease(id).context, observations: record.observations,
		decisions: record.decisions, remainingNeeds: record.remainingNeeds, replans: record.replans };
}

function complete(batch, roleForPage) {
	const pages = new Map(batch.state.parts.map(part => [part.alias, part.page]));
	const raw = {};
	for (const question of batch.questions) {
		const role = FRESH_SOURCE_ROLES.find(value => question.key.endsWith(`:${value}`));
		const alias = question.key.slice("role:".length, -(role.length + 1));
		raw[question.key] = { status: "answered", type: "choice", choice: roleForPage(pages.get(alias), role) };
	}
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

async function fixture({ pageCount, pageText = page => `Page ${page}.`, empty = new Set(), errors = new Set(),
	roleForPage = (page, role) => role === "other" ? "yes" : "no", actions = 100, maxSteps = 256,
	bindingOverride, bundleOverride, holdDecision } = {}) {
	const store = new Store(), calls = [], batches = [];
	let runtime;
	const binding = { pdf: "/source/book.pdf", file_sha256: fileSha, page_count: pageCount, revision: "source-r1", module_id: "book",
		...bindingOverride };
	const operations = {
		async validate() { return structuredClone(readSet); },
		async dispatch(proposal, lease) {
			const reservation = lease.reserve({ inputTokens: 0, outputTokens: 0, costUsd: 0, actions: 1 });
			reservation.settle(); calls.push(structuredClone(proposal));
			if (proposal.operation === "navigation.binding") return packet(proposal, "succeeded", structuredClone(binding));
			if (proposal.operation === "navigation.text") {
				const pages = proposal.args.pages;
				const result = { file_sha256: fileSha, extraction_version: "native-v1", page_count: pageCount,
					snapshots: pages.filter(page => !errors.has(page)).map(page => snapshot(page, empty.has(page) ? "" : pageText(page))),
					errors: pages.filter(page => errors.has(page)).map(page => ({ page, code: "native_extraction_unavailable" })) };
				return packet(proposal, "succeeded", bundleOverride ? bundleOverride(result, pages) : result);
			}
			if (proposal.operation === "navigation.finish") {
				const artifact = materializeNavigation(view(runtime, proposal.taskId));
				assert.ok(artifact, "the private finish owner validates actual task state");
				return packet(proposal, "succeeded", artifact);
			}
			throw new Error(`unexpected navigation operation ${proposal.operation}`);
		},
	};
	let release;
	const decision = { async decide(batch, lease) {
		const reservation = lease.reserve({ inputTokens: 1, outputTokens: 1, costUsd: 0, actions: 1 });
		batches.push(structuredClone(batch));
		if (holdDecision) await new Promise(resolve => { release = resolve; });
		reservation.settle({ inputTokens: 1, outputTokens: 1, costUsd: 0, actions: 1 });
		return complete(batch, roleForPage);
	} };
	runtime = new TaskRuntime({ decision, store, operations, domains: [createFreshSourceNavigationDomain()], maxSteps });
	const id = await runtime.begin({ domain: "fresh-source-navigation", intent: {
		id: "fresh-navigation-intent", rawInput: rawRef, goal: "Map the source for visual author navigation.", limits: ["navigation_only"],
		scope, turn: 0, inputRevision: rawRef.revision,
	}, lease: { owner: "source-navigation", goal: "Map source roles.", scope, capabilities: [FRESH_SOURCE_NAVIGATION_CAPABILITY],
		budget: { deadlineAt: Date.now() + 30_000, remainingInputTokens: 100_000, remainingOutputTokens: 100_000,
			remainingCostUsd: 10, remainingActions: actions }, readSet } });
	const result = runtime.submit(id, { goal: "Map source roles.", subgoals: [], constraints: ["Navigation only."], evidenceRequired: [],
		completion: ["Every source page has explicit coverage."], capabilities: [FRESH_SOURCE_NAVIGATION_CAPABILITY], replanWhen: [], returnWhen: [] });
	return { id, runtime, store, calls, batches, result, release: () => release?.() };
}

test("reads every page in sixteen-page batches and materializes multi-role navigation without proof", async () => {
	const app = await fixture({ pageCount: 17, roleForPage(page, role) {
		if (page === 1 && ["contents", "opening"].includes(role)) return "yes";
		if (page === 17 && ["map", "handout"].includes(role)) return "yes";
		return "no";
	} });
	const result = await app.result;
	assert.equal(result.status, "complete");
	assert.deepEqual(result.refs, []);
	assert.deepEqual(app.calls.filter(row => row.operation === "navigation.text").map(row => row.args.pages), [
		Array.from({ length: 16 }, (_, index) => index + 1), [17],
	]);
	assert.equal(app.calls.at(-1).operation, "navigation.finish");
	const artifact = app.calls.length && app.runtime.snapshot(app.id).observations.find(row => row.proposal.operation === "navigation.finish").packet.result;
	assert.deepEqual(artifact.hints.find(row => row.page === 1).roles, ["contents", "opening"]);
	assert.deepEqual(artifact.hints.find(row => row.page === 17).roles, ["map", "handout"]);
	assert.deepEqual(artifact.coverage, { classified_pages: Array.from({ length: 17 }, (_, index) => index + 1), uncertain_pages: [],
		empty_pages: [], error_pages: [], omitted_pages: [] });
	assert.equal(artifact.navigation_only, true);
	assert.equal(artifact.source_revision, "source-r1");
	assert.equal(artifact.extraction_version, "native-v1");
	assert.equal(artifact.page_count, 17);
	assert.deepEqual([...new Set(app.calls.map(row => row.operation))].sort(), ["navigation.binding", "navigation.finish", "navigation.text"]);
	for (const forbidden of ["file_sha256", "pdf", "module_id", "ref", "proof", "ready"])
		assert.equal(Object.hasOwn(artifact, forbidden), false);
});

test("version 2 carries one immutable precise thirteen-role policy in every decision batch", async () => {
	const app = await fixture({ pageCount: 2 });
	await app.result;
	assert.equal(FRESH_SOURCE_NAVIGATION_VERSION, "2");
	assert.equal(createFreshSourceNavigationDomain().version, "2");
	assert.equal(Object.isFrozen(FRESH_SOURCE_ROLE_DEFINITIONS), true);
	assert.equal(Object.isFrozen(FRESH_SOURCE_CLASSIFICATION_POLICY), true);
	assert.deepEqual(Object.keys(FRESH_SOURCE_ROLE_DEFINITIONS), FRESH_SOURCE_ROLES);
	assert.deepEqual(FRESH_SOURCE_ROLE_DEFINITIONS, {
		contents: "A contents page, index, or listing that points to other pages or sections. A pointer is not the content it names.",
		opening: "Authored first playable entry material: a starting situation, inciting setup, first scene, or explicitly offered opening variant. An ordinary arrival, doorway, local entrance, or later scene transition is not an opening.",
		global_background: "Scenario-wide premise, history, setting, factions, chronology, or context that applies beyond one local scene.",
		scene: "Playable location, situation, encounter, or sequence material describing circumstances, participants, events, or choices at that point in play.",
		npc: "A non-player character description, including role, motive, appearance, behavior, relationships, knowledge, speech, or usable statistics.",
		monster: "Creature, species, supernatural being, or adversary content. It may also be an NPC when the same part describes an individual character.",
		parameters: "Usable game statistics or structured mechanical values, including attributes, skill percentages, HP, damage, armour, movement, dice expressions, and parameter tables, even when the text never uses the word parameters.",
		plot: "Scenario progression material such as events, clues, revelations, dependencies, timelines, branches, goals, consequences, or endings.",
		rule: "A game rule, procedure, resolution instruction, exception, or reusable mechanical explanation rather than a single entity statistics block.",
		map: "A map, floor plan, diagram, spatial key, legend, or explicit pointer to one. This role is navigation to an original page, never proof of visual content or geometry.",
		handout: "A player-facing document, image, letter, newspaper item, clue card, or other authored artifact intended to be shown or read in play.",
		cross_reference: "An explicit direction to another page, section, table, appendix, handout, or external source needed to follow the authored material.",
		other: "Useful authored source material that does not safely fit another issued role.",
	});
	assert.ok(app.batches.every(batch => batch.familyVersion === "2"
		&& JSON.stringify(batch.state.roleDefinitions) === JSON.stringify(FRESH_SOURCE_ROLE_DEFINITIONS)
		&& JSON.stringify(batch.state.classificationPolicy) === JSON.stringify(FRESH_SOURCE_CLASSIFICATION_POLICY)));
	assert.ok(app.batches.flatMap(batch => batch.questions).every(question =>
		FRESH_SOURCE_ROLES.some(role => question.instructions.includes(`roleDefinitions.${role}`))
		&& Object.keys(question.criteria).join(",") === "yes,no,uncertain"));
});

test("packs actual serialized inputs into independent groups rather than a fixed part count", async () => {
	const app = await fixture({ pageCount: 8, pageText: page => `${page}:${"x".repeat(4990)}.` });
	assert.equal((await app.result).status, "complete");
	assert.ok(app.batches.length > 1);
	assert.ok(app.batches.every(batch => Buffer.byteLength(JSON.stringify(batch), "utf8") <= 30_000));
	assert.ok(app.batches.every(batch => batch.questions.length % 13 === 0));
	assert.ok(new Set(app.batches.map(batch => batch.state.parts.length)).size >= 1);
	assert.ok(app.batches.flatMap(batch => batch.state.parts).every(part =>
		/^page:\d+:part:\d+$/.test(part.alias) && Buffer.byteLength(part.text, "utf8") <= 6000));
});

test("finite action budget stores useful partial hints with uncertain, empty, error, and omitted page coverage", async () => {
	const app = await fixture({ pageCount: 20, actions: 4, empty: new Set([2]), errors: new Set([3]),
		roleForPage(page, role) { return page === 4 && role === "plot" ? "uncertain" : role === "other" ? "yes" : "no"; } });
	const result = await app.result;
	assert.equal(result.status, "partial");
	assert.deepEqual(result.refs, []);
	const artifact = app.runtime.snapshot(app.id).observations.find(row => row.proposal.operation === "navigation.finish").packet.result;
	assert.deepEqual(artifact.coverage.empty_pages, [2]);
	assert.deepEqual(artifact.coverage.error_pages, [3]);
	assert.ok(artifact.coverage.uncertain_pages.includes(4));
	assert.deepEqual(artifact.coverage.omitted_pages, [17, 18, 19, 20]);
	assert.ok(artifact.coverage.classified_pages.includes(1));
	assert.deepEqual([...artifact.coverage.classified_pages, ...artifact.coverage.uncertain_pages,
		...artifact.coverage.empty_pages, ...artifact.coverage.error_pages, ...artifact.coverage.omitted_pages].sort((a, b) => a - b),
		Array.from({ length: 20 }, (_, index) => index + 1));
	assert.deepEqual(artifact.hints.find(row => row.page === 4).roles, ["other"]);
	assert.equal(app.calls.filter(row => row.operation === "navigation.text").length, 1);
});

test("malformed binding or extraction coverage fails closed without finish publication", async () => {
	const badBinding = await fixture({ pageCount: 2, bindingOverride: { extra: true } });
	assert.equal((await badBinding.result).status, "unresolved");
	assert.deepEqual(badBinding.calls.map(row => row.operation), ["navigation.binding"]);

	const badBundle = await fixture({ pageCount: 2, bundleOverride(result) { return { ...result, snapshots: result.snapshots.slice(0, 1), errors: [] }; } });
	assert.equal((await badBundle.result).status, "unresolved");
	assert.equal(badBundle.calls.some(row => row.operation === "navigation.finish"), false);
});

test("materialization rejects forged decision state and cancellation publishes no late navigation result", async () => {
	const completeApp = await fixture({ pageCount: 1 });
	await completeApp.result;
	const record = completeApp.runtime.snapshot(completeApp.id), forged = view(completeApp.runtime, completeApp.id);
	forged.decisions[0].batch.state.parts[0].page = 99;
	assert.equal(materializeNavigation(forged), undefined);
	const policyDrift = view(completeApp.runtime, completeApp.id);
	policyDrift.decisions[0].batch.state.roleDefinitions.parameters = "Only text that says parameters.";
	assert.equal(materializeNavigation(policyDrift), undefined);
	assert.ok(materializeNavigation(view(completeApp.runtime, completeApp.id)));
	assert.deepEqual(record.result.refs, []);

	const held = await fixture({ pageCount: 1, holdDecision: true });
	while (!held.batches.length) await new Promise(resolve => setImmediate(resolve));
	await held.runtime.cancelForeground("replacement_input");
	held.release();
	const cancelled = await held.result;
	assert.equal(cancelled.status, "cancelled");
	assert.deepEqual(cancelled.refs, []);
	assert.equal(held.calls.some(row => row.operation === "navigation.finish"), false);
});
