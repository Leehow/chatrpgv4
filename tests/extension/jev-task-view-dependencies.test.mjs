/** Closed task-view dependency and host invalidation conformance; fixtures are not gameplay. */
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { build } from "esbuild";
import { createTaskHostAdapter } from "../../runtime/jev/task-host-session.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let taskViews, taskWorldRevision, worldRevision, LABELS, SILENT_REASON, kernelBundle;
before(async () => {
	kernelBundle = await mkdtemp(join(tmpdir(), "jev-task-view-kernel-"));
	const outfile = join(kernelBundle, "task-views.mjs");
	await build({ stdin: { contents: "export {taskViews} from './kernel-ts/read/task-views.ts'; export {taskWorldRevision,worldRevision} from './kernel-ts/read/context.ts'; export {LABELS,SILENT_REASON} from './kernel-ts/voice/fields.ts';",
		resolveDir: ROOT, sourcefile: "task-view-entry.ts", loader: "ts" }, bundle: true, packages: "external", platform: "node", format: "esm",
		target: "node22", outfile });
	({ taskViews, taskWorldRevision, worldRevision, LABELS, SILENT_REASON } = await import(pathToFileURL(outfile).href));
});
after(async () => { if (kernelBundle) await rm(kernelBundle, { recursive: true, force: true }); });

const MOD = "npc-voice";
const voice = (key, value, overrides = {}) => ({ value, label: key === "sample_lines" ? "legacy" : LABELS[key],
	turn: 1, mod: MOD, shape: "lines", ...overrides });
function worldFixture() {
	return {
		active_scene: "office",
		clock: { minutes: 0 },
		objects: { lamp: { holder: "Thomas", quantity: 1 } },
		mods: { state: {
			[MOD]: { dossier: {
				knott: {
					voice_mask: voice("voice_mask", ["measured"]),
					exchanges: voice("exchanges", ["The key is yours.", "Return before dark.", "Keep the door locked."]),
					sample_lines: voice("sample_lines", ["legacy one", "legacy two"]),
					actual_state: { trust: 1 },
					cadence: voice("sample_lines", ["unknown key"]),
				},
				silent: {
					voice_mask: voice("voice_mask", null, { reason: SILENT_REASON }),
					exchanges: voice("exchanges", null, { reason: SILENT_REASON }),
				},
				foreign: { voice_mask: voice("voice_mask", ["foreign owner"], { mod: "other-owner" }) },
				wrong: { exchanges: voice("exchanges", ["wrong shape"], { shape: "object" }) },
			} },
			"unknown-mod": { counter: 1 },
		} },
	};
}

const party = [{ id: "thomas", hp: 10 }];
const receipts = [{ id: "receipt-1", kind: "time" }];
const pendingChoice = { name: "door", options: ["open", "wait"] };

test("only owner-declared voice presentation changes leave core world dependency stable without mutating input", () => {
	const original = worldFixture(), frozen = structuredClone(original);
	const baseline = taskViews(original);
	assert.deepEqual(original, frozen, "partitioning never mutates the authoritative world input");
	assert.equal(baseline.world.mods.state[MOD].dossier.knott.voice_mask, undefined);
	assert.equal(baseline.world.mods.state[MOD].dossier.knott.exchanges, undefined);
	assert.equal(baseline.world.mods.state[MOD].dossier.knott.sample_lines, undefined);
	assert.equal(baseline.world.mods.state[MOD].dossier.silent, undefined);
	assert.deepEqual(baseline.world.mods.state[MOD].dossier.knott.actual_state, { trust: 1 });
	assert.ok(baseline.world.mods.state[MOD].dossier.knott.cadence);
	assert.ok(baseline.world.mods.state[MOD].dossier.foreign.voice_mask);
	assert.ok(baseline.world.mods.state[MOD].dossier.wrong.exchanges);

	for (const [field, value] of [["voice_mask", ["urgent"]],
		["exchanges", ["A different exchange.", "A second exchange.", "A third exchange."]]]) {
		const changed = structuredClone(original);
		changed.mods.state[MOD].dossier.knott[field].value = value;
		assert.notEqual(worldRevision(original, party, receipts, pendingChoice), worldRevision(changed, party, receipts, pendingChoice));
		assert.equal(taskWorldRevision(original, party, receipts, pendingChoice), taskWorldRevision(changed, party, receipts, pendingChoice));
		assert.notEqual(taskViews(original).presentation[MOD], taskViews(changed).presentation[MOD]);
		assert.deepEqual(original, frozen);
	}
});

test("incomplete, malformed, and non-owner-format voice facets remain conservative core state", () => {
	const omit = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
	const validMask = () => voice("voice_mask", ["measured"]);
	const validExchanges = () => voice("exchanges", ["First.", "Second.", "Third."]);
	const cases = [
		...['value', 'label', 'turn', 'mod', 'shape'].map(field => [`missing ${field}`, "voice_mask", omit(validMask(), field)]),
		["raw null", "voice_mask", null],
		["raw scalar", "voice_mask", "measured"],
		["empty list", "voice_mask", voice("voice_mask", [])],
		["blank line", "voice_mask", voice("voice_mask", ["  "])],
		["overlong code points", "voice_mask", voice("voice_mask", ["界".repeat(201)])],
		["mask line count", "voice_mask", voice("voice_mask", ["one", "two"])],
		["exchange line count", "exchanges", voice("exchanges", ["one", "two"])],
		["too many exchanges", "exchanges", voice("exchanges", ["one", "two", "three", "four"])],
		["wrong mask label", "voice_mask", voice("voice_mask", ["one"], { label: "in exchange" })],
		["wrong exchange label", "exchanges", voice("exchanges", ["one", "two", "three"], { label: "mask" })],
		["empty legacy label", "sample_lines", voice("sample_lines", ["one"], { label: "" })],
		["too many legacy lines", "sample_lines", voice("sample_lines", ["one", "two", "three", "four"])],
		["fractional turn", "voice_mask", voice("voice_mask", ["one"], { turn: 1.5 })],
		["negative turn", "voice_mask", voice("voice_mask", ["one"], { turn: -1 })],
		["foreign owner", "voice_mask", voice("voice_mask", ["one"], { mod: "foreign" })],
		["wrong shape", "voice_mask", voice("voice_mask", ["one"], { shape: "text" })],
		["unknown field", "voice_mask", { ...validMask(), hidden: true }],
		["null without silent reason", "voice_mask", voice("voice_mask", null)],
		["null with wrong reason", "voice_mask", voice("voice_mask", null, { reason: "unknown" })],
		["nonnull with silent reason", "voice_mask", voice("voice_mask", ["one"], { reason: SILENT_REASON })],
		["nonnull with null reason", "voice_mask", voice("voice_mask", ["one"], { reason: null })],
		["malformed exchange value", "exchanges", { ...validExchanges(), value: ["one", 2, "three"] }],
	];
	for (const [label, key, value] of cases) {
		const world = { mods: { state: { [MOD]: { dossier: { candidate: { [key]: value } } } } } };
		const frozen = structuredClone(world), projected = taskViews(world);
		assert.equal(Object.hasOwn(projected.world.mods.state[MOD].dossier.candidate, key), true, label);
		assert.deepEqual(world, frozen, `${label} input mutation`);
	}
});

test("gameplay, unknown, malformed, party, receipt, and choice changes remain core dependencies", () => {
	const original = worldFixture(), baseline = taskWorldRevision(original, party, receipts, pendingChoice);
	const cases = {
		"actual NPC state": [world => { world.mods.state[MOD].dossier.knott.actual_state.trust = 2; }, party, receipts, pendingChoice],
		"unknown Mod state": [world => { world.mods.state["unknown-mod"].counter = 2; }, party, receipts, pendingChoice],
		"unknown voice key": [world => { world.mods.state[MOD].dossier.knott.cadence.value = ["changed"]; }, party, receipts, pendingChoice],
		"foreign presentation owner": [world => { world.mods.state[MOD].dossier.foreign.voice_mask.value = ["changed"]; }, party, receipts, pendingChoice],
		"wrong presentation shape": [world => { world.mods.state[MOD].dossier.wrong.exchanges.value = ["changed"]; }, party, receipts, pendingChoice],
		movement: [world => { world.active_scene = "street"; }, party, receipts, pendingChoice],
		object: [world => { world.objects.lamp.quantity = 0; }, party, receipts, pendingChoice],
		party: [() => {}, [{ id: "thomas", hp: 9 }], receipts, pendingChoice],
		receipts: [() => {}, party, [...receipts, { id: "receipt-2", kind: "clue" }], pendingChoice],
		"pending choice": [() => {}, party, receipts, { name: "window", options: ["look"] }],
	};
	for (const [label, [mutate, nextParty, nextReceipts, nextChoice]] of Object.entries(cases)) {
		const changed = structuredClone(original);
		mutate(changed);
		assert.notEqual(taskWorldRevision(changed, nextParty, nextReceipts, nextChoice), baseline, label);
	}
	assert.deepEqual(original, worldFixture(), "revision calculation never mutates caller-owned state");
});

class MemoryStore {
	records = new Map();
	async load(id) { return structuredClone(this.records.get(id)); }
	async save(record) { this.records.set(record.checkpoint.context.id, structuredClone(record)); }
}

const plan = {
	goal: "Read the investigator record.", subgoals: [], constraints: ["Read only."],
	evidenceRequired: ["The investigator record."], completion: ["The record supports the answer."],
	capabilities: ["look"], replanWhen: [], returnWhen: [],
};

function answer(batch, next, support) {
	const answers = Object.fromEntries(batch.questions.map(question => {
		const choice = question.key === "next" ? next : support;
		return [question.key, { status: "answered", type: "choice", choice,
			probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0])) }];
	}));
	const keys = batch.questions.map(question => question.key);
	return { batchId: batch.id, status: "complete", answers, coverage: { required: keys, answered: keys, unknown: [] },
		issues: [], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
}

async function hostFixture(t, { decide, omitTaskWorld = false } = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "jev-task-views-"));
	const faux = fauxProvider({ provider: "task-view-provider", models: [{ id: "keeper", reasoning: false }] });
	const modelRuntime = await ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null,
		modelsStorePath: join(cwd, "models.json"), refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const store = new MemoryStore(), control = { world: worldFixture(), party: structuredClone(party), receipts: [], pendingChoice: null,
		sourceRevision: "source-r1", dispatches: [], api: undefined };
	let session;
	const adapter = createTaskHostAdapter(() => session, { decide }, { store });
	const context = () => {
		const broad = worldRevision(control.world, control.party, control.receipts, control.pendingChoice);
		const core = taskWorldRevision(control.world, control.party, control.receipts, control.pendingChoice);
		return { version: 1, campaign: "view-campaign", worldline: "main", loop: 0, turn: 1,
			world_revision: broad, ...(omitTaskWorld ? {} : { task_world_revision: core }),
			source_revision: control.sourceRevision, task_source_revision: control.sourceRevision,
			task_presentation_revisions: taskViews(control.world).presentation };
	};
	const dispatcher = { async dispatch(proposal, operationContext) {
		await operationContext.validateCurrent(proposal);
		control.dispatches.push(structuredClone(proposal));
		return { operationId: proposal.id, status: "succeeded", result: { investigator: "checked" }, refs: [], receipts: [],
			readSet: proposal.readSet, coverage: { used: ["investigator"], omitted: [], unknown: [] } };
	} };
	const probe = { name: "task-view-host", factory(pi) {
		control.api = pi;
		pi.on("session_start", () => {
			pi.events.emit("coc:kernel-bridge", { campaign: "view-campaign", runtime: { home: cwd, signal: new AbortController().signal },
				async call(method) { if (method === "table.capsule") return { _context: context() }; throw new Error(`unexpected ${method}`); } });
			pi.events.emit("coc:operation-dispatcher", dispatcher);
		});
		pi.on("before_agent_start", () => pi.events.emit("coc:capsule", { campaign: "view-campaign", turn: 1, epoch: "view",
			capsule: { turn: 1, where: { scene: "office" }, known: { investigator: { name: "Thomas" } }, present: [] }, context: context() }));
	} };
	const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
		extensionFactories: [probe, { name: "task-view-adapter", factory: adapter.extension }] });
	await loader.reload();
	const created = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), model: faux.getModel("keeper"), modelRuntime,
		thinkingLevel: "off", noTools: "builtin", resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), settingsManager });
	session = created.session;
	const errors = [...created.extensionsResult.errors];
	await session.bindExtensions({ mode: "rpc", onError: error => errors.push(error) });
	t.after(async () => {
		await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
		await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});
	assert.deepEqual(errors, []);
	const begin = async (input = "Read the record.") => {
		await session._extensionRunner.emit({ type: "input", text: input, source: "rpc" });
		await session._extensionRunner.emit({ type: "before_agent_start", prompt: input, systemPrompt: "fixture", systemPromptOptions: {} });
	};
	const submit = async () => session.extensionRunner.getToolDefinition("submit_plan_packet")
		.execute("task-view-plan", plan, new AbortController().signal, undefined, session.extensionRunner.createContext());
	return { session, adapter, store, control, context, begin, submit };
}

test("presentation-only voice work may cross a decision while actual world and source changes still stale the same host pipeline", async t => {
	for (const variant of ["presentation", "world", "source"]) await t.test(variant, async t => {
		const started = Promise.withResolvers(), release = Promise.withResolvers();
		let calls = 0;
		const host = await hostFixture(t, { async decide(batch) {
			calls++;
			if (calls === 1) { started.resolve(); await release.promise; return answer(batch, "candidate_0", "needs_more"); }
			return answer(batch, "complete", "sufficient");
		} });
		await host.begin();
		const initial = host.context();
		const running = host.submit();
		await started.promise;
		if (variant === "presentation") host.control.world.mods.state[MOD].dossier.knott.voice_mask.value = ["new voice"];
		else if (variant === "world") host.control.world.active_scene = "street";
		else host.control.sourceRevision = "source-r2";
		const current = host.context();
		release.resolve();
		const result = await running;

		if (variant === "presentation") {
			assert.notEqual(current.world_revision, initial.world_revision);
			assert.equal(current.task_world_revision, initial.task_world_revision);
			assert.notDeepEqual(current.task_presentation_revisions, initial.task_presentation_revisions);
			assert.equal(result.details.status, "complete");
			assert.equal(host.control.dispatches.length, 1);
			assert.equal(calls, 2);
		} else {
			assert.equal(result.details.status, "stale");
			assert.equal(host.control.dispatches.length, 0);
			assert.equal(calls, 1);
		}
	});
});

test("receipt advancement selects task core revisions when present and broad legacy revisions when absent", async t => {
	for (const modern of [true, false]) await t.test(modern ? "task core" : "legacy broad", async t => {
		const host = await hostFixture(t, { omitTaskWorld: !modern, async decide() { throw new Error("planning-only receipt fixture"); } });
		await host.begin();
		const before = host.context(), next = modern ? "task-core-after" : "broad-after";
		host.control.api.events.emit("coc:task-receipt-advance", {
			campaign: "view-campaign", turn: 1, worldline: "main", loop: 0,
			operationId: "t1-c1", receiptIds: ["receipt-1"], before: before.world_revision, after: "broad-after",
			...(modern ? { task_before: before.task_world_revision, task_after: next } : {}),
		});
		await Promise.resolve();
		const task = host.adapter.status().task;
		assert.equal(task.checkpoint.context.readSet.find(row => row.kind === "world").revision, next);
		assert.deepEqual(task.checkpoint.settledReceipts, ["receipt-1"]);
	});
});
