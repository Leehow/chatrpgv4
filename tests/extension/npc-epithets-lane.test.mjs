/**
 * Contract §176.3: the epithet lane, mounted in a real Pi session against a stubbed kernel and a faux provider (not a
 * playtest). It runs in both modes, asks once at start, retries refused people once with the kernel's reasons, and its
 * prompt names the play language the word is written in.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "./pi.mjs";
import { waitFor } from "./harness.mjs";
import { epithetSystemPrompt, epithetUserInput, shapeEpithets } from "../../extensions/npc-epithets/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reply = (epithets) => fauxAssistantMessage(JSON.stringify({ epithets }));
const inputText = (context) => context.messages.filter((message) => message.role !== "system").flatMap((message) => message.content).map((block) => block.text ?? "").join("\n");

const PACKET = {
	job_id: "epithets:camp:abc", play_language: "zh-Hans",
	people: [{ id: "book-4-lars-williams", role: "加油站老板", looks: "高瘦，灰发，白衬衫" }, { id: "book-4-steve-brown", looks: "啤酒肚，一口烂牙" }],
	taken: ["海军纹身的老人"], budget: { max_chars: 20 }, instruction: "Give each person below the word ... play language zh-Hans.",
};

async function openLane(t, { mode = "play", responses = [], rpc } = {}) {
	const workspace = mkdtempSync(join(tmpdir(), "pi-coc-epithets-lane-"));
	const values = { PI_COC_MODE: mode, PI_COC_HOME: workspace, PI_OFFLINE: "1", PI_COC_EPITHETS_MODEL: "epithets/e1" };
	const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) process.env[key] = value;
	let session;
	t.after(async () => {
		if (session) {
			await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
		for (const [key, value] of previous) value === undefined ? delete process.env[key] : (process.env[key] = value);
		rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});
	const provider = fauxProvider({ provider: "epithets", models: [{ id: "e1" }] });
	provider.setResponses(responses);
	const modelRuntime = await ModelRuntime.create({ authPath: join(workspace, "auth.json"), modelsPath: null, modelsStorePath: join(workspace, "models-store.json"), refreshOnCreate: false });
	modelRuntime.registerNativeProvider(provider.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	let api;
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace, agentDir: join(workspace, "agent"), settingsManager,
		additionalExtensionPaths: [join(ROOT, "extensions/npc-epithets")],
		extensionFactories: [{ name: "probe", factory: (pi) => { api = pi; } }],
	});
	await resourceLoader.reload();
	const created = await createAgentSession({ cwd: workspace, agentDir: join(workspace, "agent"), model: provider.getModel(), modelRuntime,
		thinkingLevel: "off", noTools: "all", resourceLoader, settingsManager, sessionManager: SessionManager.inMemory() });
	session = created.session;
	assert.deepEqual(created.extensionsResult.errors, []);
	const requests = [];
	const call = async (method, params) => { requests.push({ method, params }); return rpc(method, params); };
	api.events.emit("coc:kernel-bridge", { campaign: "camp", call });
	await session.bindExtensions({ mode: "print" });
	return {
		calls: (method) => requests.filter((row) => row.method === method),
		commit: (turn) => api.events.emit("coc:turn-committed", { campaign: "camp", turn }),
	};
}

test("the prompt names the play language and the shape is closed", () => {
	assert.match(epithetSystemPrompt(PACKET), /play language zh-Hans/);
	assert.match(epithetSystemPrompt(PACKET), /at most 20 characters/);
	const input = epithetUserInput(PACKET);
	assert.match(input, /\[Play language\] zh-Hans/);
	assert.match(input, /海军纹身的老人/, "the taken words reach the model");
	assert.ok(!input.includes("epithets:camp:abc"), "the job id never reaches the model");
	assert.deepEqual(shapeEpithets({ epithets: [{ id: "book-4-lars-williams", word: " 白衬衫老板 " }] }, PACKET), [{ id: "book-4-lars-williams", word: "白衬衫老板" }]);
	for (const bad of [
		{ epithets: [] }, { epithets: [{ id: "someone-else", word: "x" }] }, { epithets: [{ id: "book-4-lars-williams", word: "x".repeat(21) }] },
		{ epithets: [{ id: "book-4-lars-williams", word: "a" }, { id: "book-4-lars-williams", word: "b" }] },
		{ epithets: [{ id: "book-4-lars-williams", word: "a", turn: 3 }] }, { epithets: [], extra: true },
	]) assert.equal(shapeEpithets(bad, PACKET), undefined, JSON.stringify(bad));
});

for (const mode of ["setup", "play"]) test(`in ${mode} mode the lane asks once at start, submits, and retries the refused once with the kernel's reasons`, async (t) => {
	let jobs = 0, seenRetry;
	const lane = await openLane(t, {
		mode,
		responses: [
			reply([{ id: "book-4-lars-williams", word: "白衬衫老板" }, { id: "book-4-steve-brown", word: "海军纹身的老人" }]),
			(context) => { seenRetry = context; return reply([{ id: "book-4-steve-brown", word: "烂牙卡车司机" }]); },
		],
		rpc: async (method, params) => {
			if (method === "epithets.job") return ++jobs === 1 ? PACKET : { job_id: null };
			if (method === "epithets.submit") return params.entries.length === 2
				? { written: [params.entries[0]], refused: [{ id: "book-4-steve-brown", word: "海军纹身的老人", reason: "taken", message: "already what this table calls someone else" }] }
				: { written: params.entries, refused: [] };
			return {};
		},
	});
	await waitFor(() => lane.calls("epithets.submit").length === 2, { label: "two submits" });
	assert.deepEqual(lane.calls("epithets.submit").map((row) => row.params.entries.map((entry) => entry.id)), [["book-4-lars-williams", "book-4-steve-brown"], ["book-4-steve-brown"]]);
	assert.match(inputText(seenRetry), /refused \(taken\): already what this table calls someone else/);
	assert.ok(!inputText(seenRetry).includes("book-4-lars-williams"), "the retry asks only for the refused person");
	assert.match(getCurrentSystemPrompt(seenRetry.messages) ?? seenRetry.systemPrompt ?? "", /zh-Hans/);
	// A round that wrote something asks again (a big cast comes in parts); the next job is empty and ends it.
	await waitFor(() => lane.calls("epithets.job").length === 2, { label: "second job" });
	lane.commit(1);
	await waitFor(() => lane.calls("epithets.job").length === 3, { label: "a committed turn asks again" });
});
