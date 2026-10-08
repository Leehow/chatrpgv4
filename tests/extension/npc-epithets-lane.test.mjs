/**
 * Contract §176.3 and §199.5: the epithet lane, mounted in a real Pi session against a stubbed kernel and a faux provider (not
 * a playtest). It runs in both modes, asks once at start, asks the model about one person per request -- by their role and
 * looks alone, never their id and never anyone else (TR-F2: Sofia, with no row of her own, was given her neighbour Timur's
 * glasses and beard; nine words carried what the handle ids said) -- retries a refused person once with the kernel's reason,
 * asks again when the book's cast lands (§177.5), and its prompt names the play language the word is written in.
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
import { epithetSystemPrompt, epithetUserInput, shapeEpithet } from "../../extensions/npc-epithets/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reply = (word) => fauxAssistantMessage(JSON.stringify({ word }));
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
		emit: (name, payload) => api.events.emit(name, payload),
	};
}

test("the prompt names the play language, the request carries one person and no id, and the shape is closed", () => {
	assert.match(epithetSystemPrompt(PACKET), /play language zh-Hans/);
	assert.match(epithetSystemPrompt(PACKET), /at most 20 characters/);
	const [lars, steve] = PACKET.people;
	const input = epithetUserInput(PACKET, lars, PACKET.taken);
	assert.match(input, /\[Play language\] zh-Hans/);
	assert.match(input, /海军纹身的老人/, "the taken words reach the model");
	assert.match(input, /加油站老板/);
	assert.match(input, /高瘦，灰发，白衬衫/);
	assert.ok(!input.includes("epithets:camp:abc"), "the job id never reaches the model");
	assert.ok(!input.includes(lars.id) && !input.includes("lars"), "nor the person's id, which is a handle made from the Keeper's summary");
	assert.ok(!input.includes(steve.looks) && !input.includes(steve.id), "nor anyone else");
	assert.equal(shapeEpithet({ word: " 白衬衫老板 " }, PACKET), "白衬衫老板");
	for (const bad of [{}, { word: "" }, { word: "x".repeat(21) }, { word: "a", id: "book-4-lars-williams" }, { epithets: [] }, [], "白衬衫老板"])
		assert.equal(shapeEpithet(bad, PACKET), undefined, JSON.stringify(bad));
});

for (const mode of ["setup", "play"]) test(`in ${mode} mode the lane asks once at start, one person per request, submits each under its own id, and retries a refused person once with the kernel's reason`, async (t) => {
	let jobs = 0;
	const inputs = [];
	// Each request is answered from what it shows: the lane cannot know which person a request is, so neither can the faux model.
	const answer = (context) => {
		const text = inputText(context);
		inputs.push(text);
		if (text.includes("加油站老板")) return reply("白衬衫老板");
		return reply(text.includes("refused (taken)") ? "烂牙卡车司机" : "海军纹身的老人");
	};
	const lane = await openLane(t, {
		mode,
		responses: [answer, answer, answer],
		rpc: async (method, params) => {
			if (method === "epithets.job") return ++jobs === 1 ? PACKET : { job_id: null };
			if (method === "epithets.submit") {
				const [entry] = params.entries;
				return entry.word === "海军纹身的老人"
					? { written: [], refused: [{ id: entry.id, word: entry.word, reason: "taken", message: "already what this table calls someone else" }] }
					: { written: params.entries, refused: [] };
			}
			return {};
		},
	});
	await waitFor(() => lane.calls("epithets.submit").length === 3, { label: "three submits" });
	const submitted = lane.calls("epithets.submit").map((row) => row.params.entries);
	assert.ok(submitted.every((entries) => entries.length === 1), "one person per submit");
	assert.deepEqual(submitted.map(([entry]) => `${entry.id}=${entry.word}`).sort(),
		["book-4-lars-williams=白衬衫老板", "book-4-steve-brown=海军纹身的老人", "book-4-steve-brown=烂牙卡车司机"]);
	assert.equal(inputs.length, 3);
	for (const text of inputs) {
		assert.ok(!text.includes("book-4-"), "no id reaches the model");
		assert.ok(!(text.includes("加油站老板") && text.includes("啤酒肚")), "no request shows two people");
	}
	const retry = inputs.find((text) => text.includes("refused (taken)"));
	assert.match(retry, /refused \(taken\): already what this table calls someone else/);
	assert.match(retry, /啤酒肚/, "the retry asks again about the refused person, alone");
	// A round that wrote something asks again (a big cast comes in parts); the next job is empty and ends it.
	await waitFor(() => lane.calls("epithets.job").length === 2, { label: "second job" });
	lane.commit(1);
	await waitFor(() => lane.calls("epithets.job").length === 3, { label: "a committed turn asks again" });
	// §177.5: the book's cast landed: its unread people want a word, so the lane asks again; another table's cast does not.
	lane.emit("coc:cast-published", { campaign: "other", module_id: "book-4" });
	lane.emit("coc:cast-published", { campaign: "camp", module_id: "book-4" });
	await waitFor(() => lane.calls("epithets.job").length === 4, { label: "a published cast asks again" });
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(lane.calls("epithets.job").length, 4, "another campaign's cast queued nothing");
});

test("a person the kernel refuses for who they are (settled, unknown_entity) is not asked again", async (t) => {
	const inputs = [];
	const packet = { ...PACKET, people: [{ id: "book-4-sofia", role: "家属" }, { id: "book-4-steve-brown", looks: "啤酒肚，一口烂牙" }] };
	let jobs = 0;
	const answer = (context) => { const text = inputText(context); inputs.push(text); return reply(text.includes("家属") ? "守卧室的妻子" : "烂牙卡车司机"); };
	const lane = await openLane(t, {
		responses: [answer, answer, answer],
		rpc: async (method, params) => {
			if (method === "epithets.job") return ++jobs === 1 ? packet : { job_id: null };
			if (method === "epithets.submit") {
				const [entry] = params.entries;
				return entry.id === "book-4-sofia"
					? { written: [], refused: [{ id: entry.id, word: entry.word, reason: "settled", message: "told or already has a word" }] }
					: { written: params.entries, refused: [] };
			}
			return {};
		},
	});
	await waitFor(() => lane.calls("epithets.job").length === 2, { label: "the job ran" });
	assert.equal(lane.calls("epithets.submit").length, 2, "no retry for a person refused for who they are");
	assert.equal(inputs.length, 2);
});
