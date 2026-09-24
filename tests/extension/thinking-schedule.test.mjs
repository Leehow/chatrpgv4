import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "./pi.mjs";
import { Type } from "typebox";
import thinkingSchedule from "../../extensions/thinking-schedule/index.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

const previousMode = process.env.PI_COC_MODE;
afterEach(() => {
	if (previousMode === undefined) delete process.env.PI_COC_MODE;
	else process.env.PI_COC_MODE = previousMode;
});

function fixture({ mode = "play", initial = "high", minimum = "minimal" } = {}) {
	process.env.PI_COC_MODE = mode;
	const hooks = new Map();
	const changes = [];
	let level = initial;
	const pi = {
		on(name, handler) { hooks.set(name, handler); },
		getThinkingLevel() { return level; },
		setThinkingLevel(requested) {
			const previous = level;
			level = requested === "off" && previous !== "off" ? minimum : requested;
			if (level !== previous) changes.push({ requested, effective: level });
		},
	};
	thinkingSchedule(pi);
	return {
		hooks,
		changes,
		level: () => level,
		externalLevel(next) {
			const previous = level;
			level = next;
			if (level !== previous) changes.push({ requested: next, effective: next });
		},
		async emit(name, event = {}) {
			const handler = hooks.get(name);
			assert.ok(handler, `missing ${name} hook`);
			return handler(event, {});
		},
	};
}

async function toolBatch(runtime, names) {
	await runtime.emit("turn_end", {
		message: { content: names.map((name) => ({ type: "toolCall", name })) },
		toolResults: names.map((toolName) => ({ toolName })),
	});
}

test("the first complete non-delivery tool batch lowers later model requests and settled restores the table level", async () => {
	const runtime = fixture({ initial: "high", minimum: "minimal" });
	await runtime.emit("before_agent_start");

	assert.equal(runtime.level(), "high", "the level remains unchanged while a tool batch is executing");
	await toolBatch(runtime, ["look", "lookup"]);
	assert.equal(runtime.level(), "minimal");

	await toolBatch(runtime, ["resolve"]);
	assert.deepEqual(runtime.changes, [{ requested: "off", effective: "minimal" }], "later tools do not append repeated changes");

	await runtime.emit("agent_settled");
	assert.equal(runtime.level(), "high");
	assert.deepEqual(runtime.changes, [
		{ requested: "off", effective: "minimal" },
		{ requested: "high", effective: "high" },
	]);
});

test("the requested minimum is clamped by Pi and delivery-only batches do not churn the session level", async () => {
	const runtime = fixture({ initial: "high", minimum: "low" });
	await runtime.emit("before_agent_start");
	await toolBatch(runtime, ["narrate"]);
	assert.equal(runtime.level(), "high");
	assert.deepEqual(runtime.changes, []);

	await toolBatch(runtime, ["look", "ask"]);
	assert.equal(runtime.level(), "high", "a batch that closes delivery buys no lower-effort follow-up");
	assert.deepEqual(runtime.changes, []);

	await toolBatch(runtime, ["look"]);
	assert.equal(runtime.level(), "low", "Pi's effective minimum is read back after requesting off");
	await runtime.emit("agent_settled");
	assert.equal(runtime.level(), "high");
});

test("off is never raised and an external in-run level change is not overwritten", async () => {
	const off = fixture({ initial: "off", minimum: "low" });
	await off.emit("before_agent_start");
	await toolBatch(off, ["look"]);
	await off.emit("agent_settled");
	assert.equal(off.level(), "off");
	assert.deepEqual(off.changes, []);

	const changed = fixture({ initial: "high", minimum: "minimal" });
	await changed.emit("before_agent_start");
	await toolBatch(changed, ["look"]);
	changed.externalLevel("medium");
	await changed.emit("agent_settled");
	assert.equal(changed.level(), "medium");
});

// Once from the source directory and once from the emitted entry `COC_EXTENSIONS` mounts at a table
// (contract §135.27): the bundle the launch names must behave as the source does.
for (const [origin, extensionPath] of [
	["source", join(REPO, "extensions", "thinking-schedule")],
	["emitted", join(REPO, "build", "extensions", "thinking-schedule", "index.mjs")],
]) test(`a real Pi blocked-tool loop still sends the reduced level on the next provider request (${origin})`, async (t) => {
	process.env.PI_COC_MODE = "play";
	const workspace = await mkdtemp(join(tmpdir(), "coc-thinking-schedule-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));

	const faux = fauxProvider();
	Object.assign(faux.models[0], {
		reasoning: true,
		thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high" },
	});
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("step", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	]);
	const levels = [];
	const streamSimple = faux.provider.streamSimple;
	faux.provider.streamSimple = (model, context, options) => {
		levels.push(options?.reasoning ?? "off");
		return streamSimple(model, context, options);
	};

	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(workspace, "models-store.json"),
		refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: join(workspace, "agent"),
		settingsManager,
		additionalExtensionPaths: [extensionPath],
		extensionFactories: [{
			name: "step-tool",
			factory(pi) {
				pi.registerTool({
					name: "step",
					label: "Step",
					description: "A tool blocked by the host before execution.",
					parameters: Type.Object({}),
					async execute() { throw new Error("blocked step executed"); },
				});
				pi.on("tool_call", (event) => event.toolName === "step"
					? { block: true, reason: "fixture refusal" }
					: undefined);
			},
		}],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: workspace,
		agentDir: join(workspace, "agent"),
		model: faux.getModel(),
		modelRuntime,
		thinkingLevel: "high",
		noTools: "builtin",
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
		settingsManager,
	});
	t.after(() => session.dispose());
	await session.bindExtensions({ mode: "print" });

	await session.prompt("go");
	assert.deepEqual(levels, ["high", "minimal"]);
	assert.equal(session.thinkingLevel, "high", "the table level is restored only after the full agent prompt settles");
});

test("the schedule is absent from setup mode", () => {
	const runtime = fixture({ mode: "setup" });
	assert.equal(runtime.hooks.size, 0);
});
