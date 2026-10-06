/**
 * Contract §185.5 and §185.11 NFH-03: the handle lane, mounted in a real Pi session against a stubbed kernel and a faux
 * provider (not a playtest). It shows the model each node under a key, never its node id; asks once at start in both modes,
 * again after a committed turn and after a reading publishes; retries each node it could not use alone, with the kernel's
 * refusal verbatim; gives up a node refused or unanswered twice, and nothing when a whole ask fails; writes one telemetry row
 * per round; costs nothing on a legacy campaign; and names a published book in the library form before its campaign exists.
 */
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "./pi.mjs";
import { waitFor } from "./harness.mjs";
import { handleSystemPrompt, handleUserInput, keyNodes, shapeHandles } from "../../extensions/node-handles/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A reader-built book's nodes: every id carries the book's words, the last one names a person in a clue. */
const PACKET = {
	job_id: "handles:camp:abc",
	nodes: [
		{ id: "npc-book-4-robert-taylor", kind: "npc", name: "Robert Taylor", summary: "Runs the bar and the motel; a pencil mustache." },
		{ id: "scene-book-4-dr-brenner-home", kind: "scene", name: "Dr. Brenner's home", summary: "A clapboard house at the edge of town." },
		{ id: "clue-book-4-john-hides-book-under-counter", kind: "clue", name: "John hides the book", summary: "A book hidden under the gift shop counter." },
		{ id: "item-book-4-lantern", kind: "item", name: "Lantern", summary: "" },
	],
	avoid: ["Robert Taylor", "Robert", "Taylor", "Brenner", "John"],
	taken: ["tar-smelling-dock"],
	instruction: "Give each node below a handle: the short English phrase the game will use to refer to this thing. (kernel)",
};
const IDS = PACKET.nodes.map((node) => node.id);
const KEY = Object.fromEntries(IDS.map((id, index) => [id, `n${index + 1}`]));
const reply = (handles) => fauxAssistantMessage(JSON.stringify({ handles }));
const failure = () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider down" });
const inputText = (context) => context.messages.filter((message) => message.role !== "system").flatMap((message) => message.content).map((block) => block.text ?? "").join("\n");
/** The nodes one ask showed the model: the JSON line under [Nodes]. */
const askedNodes = (context) => {
	const lines = inputText(context).split("\n");
	return JSON.parse(lines[lines.indexOf("[Nodes]") + 1]);
};
const kernelError = (code, message, details) => Object.assign(new Error(message), { code, ...(details ? { details } : {}) });

async function openLane(t, { mode = "play", respond, rpc, model = "handles/h1" } = {}) {
	const workspace = mkdtempSync(join(tmpdir(), "pi-coc-handles-lane-"));
	const values = { PI_COC_MODE: mode, PI_COC_HOME: workspace, PI_OFFLINE: "1", PI_COC_HANDLES_MODEL: model };
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
	const provider = fauxProvider({ provider: "handles", models: [{ id: "h1" }] });
	const asks = [];
	// Every ask goes to the same responder, which answers by what the ask shows: retries run at once, in no fixed order.
	provider.setResponses(Array.from({ length: 40 }, () => (context) => { asks.push(context); return respond(context, asks.length); }));
	const modelRuntime = await ModelRuntime.create({ authPath: join(workspace, "auth.json"), modelsPath: null, modelsStorePath: join(workspace, "models-store.json"), refreshOnCreate: false });
	modelRuntime.registerNativeProvider(provider.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	let api;
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace, agentDir: join(workspace, "agent"), settingsManager,
		additionalExtensionPaths: [join(ROOT, "extensions/node-handles")],
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
	const telemetry = join(workspace, ".coc", "campaigns", "camp", "telemetry.jsonl");
	return {
		asks,
		calls: (method) => requests.filter((row) => row.method === method),
		commit: (turn) => api.events.emit("coc:turn-committed", { campaign: "camp", turn }),
		emit: (name, payload) => api.events.emit(name, payload),
		/** This lane's round rows: its own outcome, not the nested `lane-call` rows of each completion. */
		rounds: () => (existsSync(telemetry) ? readFileSync(telemetry, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [])
			.filter((row) => row.lane === "handles" && typeof row.ok === "boolean"),
		callCount: () => provider.state.callCount,
	};
}

test("§185.5: the model sees each node by key, kind, name and summary, never its id; the shape takes what is usable", () => {
	const nodes = keyNodes({ ...PACKET, nodes: [...PACKET.nodes, { kind: "npc", name: "no id" }] });
	assert.deepEqual(nodes.map((node) => [node.key, node.id]), IDS.map((id, index) => [`n${index + 1}`, id]), "a row without an id is no node");
	const system = handleSystemPrompt(PACKET), input = handleUserInput(nodes, PACKET, PACKET.taken);
	assert.ok(system.startsWith(PACKET.instruction), "the kernel's instruction, verbatim, first");
	assert.match(system, /a person by their role or how they look, a place by what it is, a clue by what it shows/);
	assert.match(system, /"handles":\[\{"key"/);
	for (const id of IDS) {
		assert.ok(!input.includes(id) && !system.includes(id), `${id} reaches the model`);
		assert.ok(!input.includes(id.slice(id.indexOf("-") + 1)), `the slug of ${id} reaches the model`);
	}
	assert.ok(!input.includes(PACKET.job_id), "the job id never reaches the model");
	assert.deepEqual(JSON.parse(input.split("\n")[1])[0], { key: "n1", kind: "npc", name: "Robert Taylor", summary: PACKET.nodes[0].summary });
	assert.deepEqual(JSON.parse(input.split("\n")[1])[3], { key: "n4", kind: "item", name: "Lantern" }, "an empty summary is left out");
	assert.ok(input.includes(JSON.stringify(PACKET.avoid)) && input.includes(JSON.stringify(PACKET.taken)));
	const keys = new Set(nodes.map((node) => node.key));
	assert.deepEqual(shapeHandles({ handles: [
		{ key: "n1", handle: " bar-owner-pencil-mustache " }, { key: "n9", handle: "stranger" }, { key: "n2", handle: "" },
		{ key: "n1", handle: "second-answer" }, { key: "n3", handle: 7 }, "n4", { key: "n4", handle: "brass-lantern", note: "ok" },
	] }, keys), [{ key: "n1", handle: "bar-owner-pencil-mustache" }, { key: "n4", handle: "brass-lantern" }]);
	for (const bad of [{}, { handles: [] }, { handles: [{ key: "n9", handle: "x" }] }, { epithets: [] }, [], null])
		assert.equal(shapeHandles(bad, keys), undefined, JSON.stringify(bad));
});

for (const mode of ["setup", "play"]) test(`§185.5: in ${mode} mode the lane asks once at start, writes the job, asks again until it is empty, and again on a commit or a publication`, async (t) => {
	let jobs = 0;
	const lane = await openLane(t, {
		mode,
		respond: (context) => reply(askedNodes(context).map((node) => ({ key: node.key, handle: `the-${node.kind}-number-${node.key.slice(1)}` }))),
		rpc: async (method, params) => {
			if (method === "handles.job") return ++jobs === 1 ? PACKET : { job_id: null };
			if (method === "handles.submit") return { written: params.entries.map(({ id, handle }) => ({ id, handle })), refused: [] };
			return {};
		},
	});
	await waitFor(() => lane.rounds().length === 1, { label: "the round's row" });
	assert.deepEqual(lane.calls("handles.submit").map((row) => row.params), [{ campaign: "camp",
		entries: IDS.map((id) => ({ id, handle: `the-${PACKET.nodes[IDS.indexOf(id)].kind}-number-${KEY[id].slice(1)}` })) }], "each key maps back to its node id");
	const [row] = lane.rounds();
	assert.equal(typeof row.ms, "number");
	const { ms: _ms, ...shape } = row;
	assert.deepEqual(shape, { lane: "handles", form: "campaign", job_id: PACKET.job_id, ok: true, model: "handles/h1", asked: 4, written: 4, refused: {}, given_up: 0 });
	await waitFor(() => lane.calls("handles.job").length === 2, { label: "the next job, empty" });
	assert.equal(lane.asks.length, 1, "one ask for the whole job; nothing retried");
	lane.commit(1);
	await waitFor(() => lane.calls("handles.job").length === 3, { label: "a committed turn asks again" });
	lane.emit("coc:source-published", { campaign: "other", module_id: "book-4" });
	lane.emit("coc:source-published", { campaign: "camp", module_id: "book-4" });
	await waitFor(() => lane.calls("handles.job").length === 4, { label: "a reading published for this table asks again" });
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(lane.calls("handles.job").length, 4, "another campaign's reading queued nothing");
	assert.ok(lane.calls("handles.job").every((row) => JSON.stringify(row.params) === '{"campaign":"camp"}'));
});

test("§185.5: a node the kernel refused, or the model left out, is asked again alone with the reason; refused or unanswered twice it is given up", async (t) => {
	const [taylor, brenner, john, lantern] = IDS;
	let jobs = 0;
	const retries = new Map();
	const lane = await openLane(t, {
		respond: (context) => {
			const asked = askedNodes(context);
			// The whole job: the lantern is left out.
			if (asked.length === 4) return reply([{ key: "n1", handle: "bar-owner-pencil-mustache" }, { key: "n2", handle: "brenner-clapboard-house" },
				{ key: "n3", handle: "tar-smelling-dock" }]);
			retries.set(asked[0].key, context);
			if (asked[0].key === "n2") return reply([{ key: "n2", handle: "clapboard-house-at-town-edge" }]);
			if (asked[0].key === "n3") return reply([{ key: "n3", handle: "john-book-under-counter" }]);
			return reply([{ key: "n1", handle: "brass-lantern" }]);   // the lantern's retry answers another key: no answer
		},
		rpc: async (method, params) => {
			if (method === "handles.job") return ++jobs === 1 ? PACKET : { job_id: null };
			if (method !== "handles.submit") return {};
			if (params.given_up) return { written: params.given_up.map((id) => ({ id, given_up: true })), refused: [] };
			const written = [], refused = [];
			for (const { id, handle } of params.entries) {
				if (handle === "brenner-clapboard-house") refused.push({ id, handle, reason: "carries_name", message: "'brenner-clapboard-house' carries 'Brenner', a form of a name in the book's cast; describe the thing without any name" });
				else if (handle === "tar-smelling-dock") refused.push({ id, handle, reason: "taken", message: "'tar-smelling-dock' already names another node of this book" });
				else if (handle === "john-book-under-counter") refused.push({ id, handle, reason: "carries_name", message: "'john-book-under-counter' carries 'John', a form of a name in the book's cast; describe the thing without any name" });
				else written.push({ id, handle });
			}
			return { written, refused };
		},
	});
	await waitFor(() => lane.rounds().length === 1, { label: "the round's row" });
	assert.deepEqual([...retries.keys()].sort(), ["n2", "n3", "n4"], "three retries, one per node: two refused, one left out");
	for (const [key, context] of retries) {
		assert.deepEqual(askedNodes(context).map((node) => node.key), [key], `${key} is asked alone`);
		for (const other of ["n1", "n2", "n3", "n4"].filter((value) => value !== key)) assert.ok(!inputText(context).includes(`- ${other}:`), `${key}'s retry carries no other node's reason`);
		assert.ok(JSON.parse(inputText(context).split("\n")[5]).includes("bar-owner-pencil-mustache"), "a handle this round wrote is taken for the retry");
	}
	assert.ok(inputText(retries.get("n2")).includes(`- n2: "brenner-clapboard-house" refused (carries_name): 'brenner-clapboard-house' carries 'Brenner', a form of a name in the book's cast; describe the thing without any name`),
		"the kernel's refusal, verbatim");
	assert.ok(inputText(retries.get("n3")).includes(`- n3: "tar-smelling-dock" refused (taken): 'tar-smelling-dock' already names another node of this book`));
	assert.ok(inputText(retries.get("n4")).includes("- n4: your answer gave this node no handle"));
	const submits = lane.calls("handles.submit").map((row) => row.params);
	assert.equal(submits.length, 4, "the job, the two retries the model answered, and the nodes given up");
	assert.deepEqual(submits.slice(1, 3).flatMap((params) => params.entries ?? []).map((entry) => entry.id).sort(), [brenner, john].sort(), "a retry submits only its own node");
	assert.deepEqual(submits.at(-1).given_up.sort(), [john, lantern].sort(), "refused twice, and unanswered twice, are given up");
	assert.ok(!submits.some((params) => params.entries?.some((entry) => entry.id === lantern)), "nothing was ever submitted for the lantern");
	assert.ok(!submits.at(-1).given_up.includes(taylor) && !submits.at(-1).given_up.includes(brenner));
	const { ms: _ms, ...row } = lane.rounds()[0];
	assert.deepEqual(row, { lane: "handles", form: "campaign", job_id: PACKET.job_id, ok: true, model: "handles/h1", asked: 4, written: 2,
		refused: { carries_name: 2, taken: 1 }, given_up: 2, unanswered: 1, retried: 3 });
});

test("§185.5: a retry the model fails gives the node up; a refusal about the node itself is never retried", async (t) => {
	const [taylor, brenner, john] = IDS;
	let jobs = 0;
	const lane = await openLane(t, {
		respond: (context) => {
			const asked = askedNodes(context);
			if (asked.length === 4) return reply(asked.map((node) => ({ key: node.key, handle: `${node.kind}-thing-${node.key}` })));
			return failure();
		},
		rpc: async (method, params) => {
			if (method === "handles.job") return ++jobs === 1 ? PACKET : { job_id: null };
			if (method !== "handles.submit") return {};
			if (params.given_up) return { written: params.given_up.map((id) => ({ id, given_up: true })), refused: [] };
			return { written: params.entries.filter((entry) => entry.id === IDS[3]),
				refused: [{ id: taylor, handle: "npc-thing-n1", reason: "shape", message: "a handle is lowercase ASCII kebab-case" },
					{ id: brenner, handle: "scene-thing-n2", reason: "settled", message: "already has a handle or was given up" },
					{ id: john, handle: "clue-thing-n3", reason: "unknown_entity", message: "is no node of this campaign's book graph" }] };
		},
	});
	await waitFor(() => lane.rounds().length === 1, { label: "the round's row" });
	assert.equal(lane.asks.length, 2, "only the shape refusal is asked again");
	assert.deepEqual(askedNodes(lane.asks[1]).map((node) => node.key), ["n1"]);
	assert.deepEqual(lane.calls("handles.submit").at(-1).params, { campaign: "camp", given_up: [taylor] }, "the model failed on its retry");
	const { ms: _ms, ...row } = lane.rounds()[0];
	assert.deepEqual(row, { lane: "handles", form: "campaign", job_id: PACKET.job_id, ok: true, model: "handles/h1", asked: 4, written: 1,
		refused: { shape: 1, settled: 1, unknown_entity: 1 }, given_up: 1, retried: 1 });
});

test("§185.5: a whole ask that fails gives up nothing, writes one failed row, and the next trigger asks again", async (t) => {
	let jobs = 0;
	const answers = [failure(), fauxAssistantMessage("I cannot name these."), null];
	const lane = await openLane(t, {
		respond: (context, count) => answers[count - 1] ?? reply(askedNodes(context).map((node) => ({ key: node.key, handle: `named-${node.key}` }))),
		rpc: async (method, params) => {
			if (method === "handles.job") return jobs++ < 3 ? PACKET : { job_id: null };
			if (method === "handles.submit") return { written: params.entries.map(({ id, handle }) => ({ id, handle })), refused: [] };
			return {};
		},
	});
	await waitFor(() => lane.rounds().length === 1, { label: "the failed round's row" });
	assert.deepEqual(lane.calls("handles.submit"), [], "nothing submitted, nothing given up");
	const { ms: _ms, ...failed } = lane.rounds()[0];
	assert.deepEqual(failed, { lane: "handles", form: "campaign", job_id: PACKET.job_id, ok: false, model: "handles/h1", asked: 4, written: 0, refused: {}, given_up: 0,
		reason: "model_error", detail: "provider down" });
	lane.commit(1);
	await waitFor(() => lane.rounds().length === 2, { label: "the second trigger's row" });
	assert.equal(lane.rounds()[1].reason, "bad_output", "nothing usable in the reply is a failed ask too");
	assert.deepEqual(lane.calls("handles.submit"), [], "still nothing given up");
	lane.commit(2);
	await waitFor(() => lane.rounds().length === 3, { label: "the third trigger's row" });
	assert.equal(lane.rounds()[2].ok, true);
	assert.equal(lane.calls("handles.submit").length, 1);
	assert.ok(!lane.calls("handles.submit")[0].params.given_up);
});

test("§185.5: a lane model that cannot be resolved fails the round without giving anything up", async (t) => {
	let jobs = 0;
	const lane = await openLane(t, {
		model: "handles/missing",
		respond: () => reply([]),
		rpc: async (method) => (method === "handles.job" ? (jobs++ ? { job_id: null } : PACKET) : {}),
	});
	await waitFor(() => lane.rounds().length === 1, { label: "the failed round's row" });
	assert.equal(lane.rounds()[0].reason, "model_unavailable");
	assert.match(lane.rounds()[0].detail, /PI_COC_HANDLES_MODEL=handles\/missing/);
	assert.equal(lane.callCount(), 0);
	assert.deepEqual(lane.calls("handles.submit"), []);
});

for (const mode of ["setup", "play"]) test(`§185.1: in ${mode} mode a legacy campaign, or a book with nothing left, costs nothing: no model call, no submit, no row`, async (t) => {
	const lane = await openLane(t, { mode, model: "handles/missing", respond: () => reply([]), rpc: async (method) => (method === "handles.job" ? { job_id: null } : {}) });
	await waitFor(() => lane.calls("handles.job").length === 1, { label: "the initial job" });
	lane.commit(1);
	await waitFor(() => lane.calls("handles.job").length === 2, { label: "a committed turn's job" });
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(lane.callCount(), 0);
	assert.deepEqual(lane.calls("handles.submit"), []);
	assert.deepEqual(lane.rounds(), [], "an unresolvable lane model is never even looked up");
});

test("§185.5: before the campaign exists, a book a reading published is named in the library form; an authored book is not asked again", async (t) => {
	let created = false, bookJobs = 0;
	const lane = await openLane(t, {
		mode: "setup",
		respond: (context) => reply(askedNodes(context).map((node) => ({ key: node.key, handle: `library-${node.key}` }))),
		rpc: async (method, params) => {
			if (method === "handles.job" && params.campaign) {
				if (!created) throw kernelError("campaign_not_found", "no campaign 'camp'");
				return { job_id: null };
			}
			if (method === "handles.job" && params.module === "starter-pack") throw kernelError("invalid_params", "module 'starter-pack' is authored and keeps its own handles", { reason: "authored", module: "starter-pack" });
			if (method === "handles.job") return bookJobs++ ? { job_id: null } : { ...PACKET, job_id: "handles:book:book-4:abc" };
			if (method === "handles.submit") return { written: params.entries.map(({ id, handle }) => ({ id, handle })), refused: [] };
			return {};
		},
	});
	await waitFor(() => lane.calls("handles.job").length === 1, { label: "the initial job" });
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepEqual(lane.rounds(), [], "a campaign not created yet is no failure");
	assert.equal(lane.callCount(), 0);
	lane.emit("coc:source-published", { campaign: "other", module_id: "book-9" });
	lane.emit("coc:source-published", { module_id: "book-4" });
	await waitFor(() => lane.rounds().length === 1, { label: "the library round's row" });
	assert.deepEqual(lane.calls("handles.submit").map((row) => Object.keys(row.params).sort()), [["entries", "module"]]);
	assert.equal(lane.calls("handles.submit")[0].params.module, "book-4");
	assert.ok(!lane.calls("handles.job").some((row) => row.params.module === "book-9"), "another campaign's book is not this table's");
	const { ms: _ms, ...row } = lane.rounds()[0];
	assert.deepEqual(row, { lane: "handles", form: "library", module: "book-4", job_id: "handles:book:book-4:abc", ok: true, model: "handles/h1",
		asked: 4, written: 4, refused: {}, given_up: 0 });
	lane.emit("coc:source-published", { module_id: "starter-pack" });
	await waitFor(() => lane.calls("handles.job").filter((call) => call.params.module === "starter-pack").length === 1, { label: "the authored book asked once" });
	lane.emit("coc:source-published", { module_id: "starter-pack" });
	await waitFor(() => lane.calls("handles.job").filter((call) => call.params.campaign).length === 4, { label: "the second publication's job" });
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(lane.calls("handles.job").filter((call) => call.params.module === "starter-pack").length, 1, "an authored book is not asked again");
	assert.equal(lane.rounds().length, 1, "the authored refusal writes no row");
	// setup.create made the campaign: from now on it answers for its own book.
	created = true;
	lane.emit("coc:session-bound", { campaign: "camp", mode: "setup", play_language: "en" });
	await waitFor(() => lane.calls("handles.job").filter((call) => call.params.campaign).length === 5, { label: "the campaign form after creation" });
});

/** A book of six jobs: each `handles.job` offers a fresh part until the sixth is named. */
function sixJobs(form = "campaign") {
	let jobs = 0;
	return {
		jobs: () => jobs,
		respond: (context) => reply(askedNodes(context).map((node) => ({ key: node.key, handle: `named-${node.key}` }))),
		rpc: async (method, params) => {
			if (method === "handles.job" && form === "library" && params.campaign) throw kernelError("campaign_not_found", "no campaign 'camp'");
			if (method === "handles.job") return ++jobs <= 6 ? { ...PACKET, job_id: `handles:part:${jobs}` } : { job_id: null };
			if (method === "handles.submit") return { written: params.entries.map(({ id, handle }) => ({ id, handle })), refused: [] };
			return {};
		},
	};
}

test("§185.5: during character creation nobody waits, and one trigger names the whole book", async (t) => {
	const book = sixJobs();
	const lane = await openLane(t, { mode: "setup", respond: book.respond, rpc: book.rpc });
	await waitFor(() => lane.rounds().length === 6, { label: "six rounds from the initial job alone" });
	await waitFor(() => lane.calls("handles.job").length === 7, { label: "the job that answers job_id null" });
	assert.deepEqual(lane.rounds().map((row) => row.job_id), [1, 2, 3, 4, 5, 6].map((part) => `handles:part:${part}`));
});

test("§185.5: a book named in the library form is named whole in one trigger, at a table too", async (t) => {
	const book = sixJobs("library");
	const lane = await openLane(t, { mode: "play", respond: book.respond, rpc: book.rpc });
	await waitFor(() => lane.calls("handles.job").length === 1, { label: "the initial job, no campaign yet" });
	lane.emit("coc:source-published", { module_id: "book-4" });
	await waitFor(() => lane.rounds().length === 6, { label: "six library rounds from one publication" });
	assert.ok(lane.rounds().every((row) => row.form === "library" && row.module === "book-4"));
});

test("§185.5: at a table a trigger asks four jobs, and the next trigger goes on", async (t) => {
	const book = sixJobs();
	const lane = await openLane(t, { mode: "play", respond: book.respond, rpc: book.rpc });
	await waitFor(() => lane.rounds().length === 4, { label: "the initial job's four rounds" });
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(lane.rounds().length, 4, "a turn's background work stays small");
	assert.equal(lane.calls("handles.job").length, 4);
	lane.commit(1);
	await waitFor(() => lane.calls("handles.job").length === 7, { label: "the committed turn names the rest" });
	assert.equal(lane.rounds().length, 6);
});
