/**
 * Contract §177.2 (amended 2026-10-07): the cast reader names no path. Its one tool is the private `submit_cast`; the host
 * writes `draft.json` into the range directory, runs the reader's own cast check there and answers with what it refused, so
 * the child repairs in the same session; a draft the check passes ends the child.
 *
 * The tool is driven directly first, then through its real entry: the kernel in-process (its cast methods over a bound
 * three-page book), `ReadingService.cast` with the host's own `runTask` (`runtime/tasks.ts`), which spawns the vendored Pi with
 * the emitted extensions and the host's checker wrapper, against a local Responses endpoint scripted as a model. The child
 * test loads the emitted `build/`: run `npm run build:runtime` first.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import castSubmit from "../../extensions/module/cast-submit.ts";
import { ReadingService } from "../../extensions/module/reading-service.ts";
import { composeRuntimeContext } from "../../runtime/host.ts";
import { runtimeCapabilities } from "../../runtime/tasks.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const exists = path => access(path).then(() => true, () => false);

async function temporary(t, prefix) {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

function mounted(dir, exec) {
	const hooks = {}, reminders = [];
	let tool;
	castSubmit({ on(name, fn) { hooks[name] = fn; }, registerTool(value) { tool = value; }, exec,
		sendMessage(value, options) { reminders.push({ value, options }); } },
		{ env: { PI_COC_CAST_SUBMIT_DIR: dir, PI_COC_READER_CHECK: join(dir, "host-bin", "coc-read-check") } });
	return { hooks, reminders, tool };
}

test("§177.2 submit_cast writes the draft, runs the cast check on it, answers with what it refused, and ends the child when it passes", async t => {
	const dir = await temporary(t, "cast-submit-");
	const checks = [];
	const answers = [{ code: 1, stdout: JSON.stringify({ ok: false, people: 1, refused: [{ index: 1, reason: "not_on_page", fix: "add the page that prints Quill" }] }) },
		{ code: 0, stdout: JSON.stringify({ ok: true, people: 2, refused: [] }) }];
	const { hooks, reminders, tool } = mounted(dir, async (command, args) => {
		checks.push([command, args, JSON.parse(await readFile(args[3], "utf8"))]);
		return { stderr: "", ...answers.shift() };
	});
	assert.equal(tool.name, "submit_cast");
	assert.deepEqual(Object.keys(tool.parameters.properties), ["draft"], "the tool takes a draft, never a path");

	const invalid = await tool.execute("call-0", { draft: [] });
	assert.equal(invalid.isError, true);
	assert.equal(hooks.tool_result({ toolName: "submit_cast", details: invalid.details }).isError, true);
	assert.equal(await exists(join(dir, "draft.json")), false, "a call without a draft writes nothing and does not count");

	const first = { people: [{ book: ["Silas Marsh"], play: ["Silas Marsh"], notes: ["Silas Marsh"], pages: [2] },
		{ book: ["Quill"], play: ["Quill"], notes: ["Quill"], pages: [1] }] };
	const refused = await tool.execute("call-1", { draft: first });
	assert.notEqual(refused.terminate, true, "a refused draft is repaired in the same session");
	assert.match(refused.content[0].text, /add the page that prints Quill/, "the check's own fix reaches the model");
	assert.deepEqual(checks[0].slice(0, 2), [join(dir, "host-bin", "coc-read-check"), ["--kind", "module-cast", "--draft", join(dir, "draft.json")]],
		"the host's checker wrapper on the draft the host wrote");
	assert.deepEqual(checks[0][2], first);

	hooks.agent_end({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] });
	assert.equal(reminders.length, 0, "a run that ended on a provider error (Pi may retry it) arms no reminder");
	hooks.agent_end({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
	assert.equal(reminders.length, 1, "a child that stops with its draft refused is asked once more");
	assert.match(reminders[0].value.content, /submit_cast once more/);
	assert.deepEqual(reminders[0].options, { triggerTurn: true, deliverAs: "followUp" });

	const repaired = { people: [first.people[0], { ...first.people[1], pages: [3] }] };
	const passed = await tool.execute("call-2", { draft: repaired });
	assert.equal(passed.terminate, true);
	assert.match(passed.content[0].text, /2 people\. You are done/);
	assert.deepEqual(JSON.parse(await readFile(join(dir, "draft.json"), "utf8")), repaired, "draft.json holds the latest draft");
	hooks.agent_end({ type: "agent_end", messages: [{ role: "assistant", stopReason: "toolUse" }] });
	assert.equal(reminders.length, 1, "one reminder per child at most");
	const rows = (await readFile(join(dir, "submissions.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
	assert.deepEqual(rows, [{ invalid: true }, { submission: 1, ok: false, people: 1, refused: 1 }, { submission: 2, ok: true, people: 2, refused: 0 }]);

	const silent = mounted(dir, async () => ({ code: 0, stdout: "{}", stderr: "" }));
	silent.hooks.agent_end({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
	assert.equal(silent.reminders.length, 1);
	assert.match(silent.reminders[0].value.content, /Call submit_cast now/);
	assert.throws(() => castSubmit({ on() {}, registerTool() {} }, { env: { PI_COC_CAST_SUBMIT_DIR: dir } }), /checker/);
});

// ---------------------------------------------------------------------------------------------------------------------
// The real entry: the kernel's cast methods, ReadingService.cast, runtime/tasks.ts runTask, a vendored Pi child.

await mkdir(join(ROOT, ".coc"), { recursive: true });
const bundleDir = await mkdtemp(join(ROOT, ".coc", "cast-submit-"));
after(() => rm(bundleDir, { recursive: true, force: true }));
await build({ stdin: { contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: ROOT },
	outfile: join(bundleDir, "kernel.mjs"), bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
const kernelApi = await import(pathToFileURL(join(bundleDir, "kernel.mjs")).href);

const PAGES = ["The harbor dock smells of tar. Old Mae mends nets by the water.",
	"The old tower stands beyond the harbor. Its keeper, Silas Marsh, trims the lamp.",
	"Below the tower a cellar floods at high tide. Mae's boy Jonah drowned there last spring."];
const row = (name, pages) => ({ book: [name], play: [name], notes: [name], pages });
const DRAFT = { people: [row("Old Mae", [1]), row("Silas Marsh", [2]), row("Jonah", [3]), row("Harbormaster Quill", [1])] };

const call = (turn, index, name, args) => ({ type: "function_call", id: `fc_${turn}_${index}`, call_id: `call_${turn}_${index}`, name,
	arguments: JSON.stringify(args), status: "completed" });
const prose = turn => ({ type: "message", id: `msg_${turn}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done.", annotations: [] }] });

/** The function_call_output texts in a Responses request's input. */
function toolOutputs(body) {
	return (body.input ?? []).filter(item => item?.type === "function_call_output")
		.map(item => typeof item.output === "string" ? item.output : (item.output ?? []).map(part => part?.text ?? "").join(""));
}

/** A local OpenAI Responses endpoint scripted as a cast reader: `script(turn, body)` returns output items, or `{status}`. */
function castModel(t, script) {
	const seen = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", chunk => { body += chunk; });
		request.on("end", () => {
			const parsed = JSON.parse(body || "{}");
			seen.push(parsed);
			const answer = script(seen.length, parsed);
			if (answer.status) {
				response.writeHead(answer.status, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: "Our servers are currently overloaded. Please try again later.", type: "server_error" } }));
				return;
			}
			response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			const send = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
			send({ type: "response.created", response: { id: `resp_${seen.length}`, status: "in_progress" } });
			for (const [index, item] of answer.items.entries()) {
				send({ type: "response.output_item.added", output_index: index, item: item.type === "function_call" ? { ...item, arguments: "" } : { ...item, content: [] } });
				if (item.type === "message") send({ type: "response.output_text.delta", output_index: index, content_index: 0, delta: "Done." });
				send({ type: "response.output_item.done", output_index: index, item });
			}
			send({ type: "response.completed", response: { id: `resp_${seen.length}`, status: "completed", output: answer.items,
				usage: { input_tokens: 1000, output_tokens: 40, total_tokens: 1040 } } });
			response.end();
		});
	});
	t.after(() => { server.closeAllConnections?.(); return new Promise(done => server.close(done)); });
	return new Promise(ready => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, seen })));
}

/** One book's cast through `ReadingService.cast`: the real kernel, the host's own runTask, a vendored Pi child against `script`. */
async function castOf(t, script) {
	const home = await mkdtemp(join(bundleDir, "home-"));
	const context = await kernelApi.createKernelContext({ workspace: home, content: join(ROOT, "content"), seed: "cast-submit",
		locks: kernelApi.nativeAdvisoryLocks(), env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
	const kernel = kernelApi.createKernelRuntime(context);
	t.after(() => kernel.close());
	const pdf = join(home, "harbor.pdf");
	await writeFile(pdf, `%PDF-1.7\n% ${PAGES.join(" | ")}\n%%EOF\n`);
	const sha = createHash("sha256").update(await readFile(pdf)).digest("hex");
	const { module_id: mid } = await kernel.handlers["module.source.bind"]({ source: { path: pdf, page_count: PAGES.length, file_sha256: sha } });

	const agent = join(home, "agent");
	await mkdir(agent, { recursive: true });
	const { port, seen } = await castModel(t, script);
	await writeFile(join(agent, "models.json"), JSON.stringify({ providers: { castbox: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-responses",
		apiKey: "unused", models: [{ id: "cast-1", contextWindow: 100000, maxTokens: 4096 }] } } }));
	await writeFile(join(agent, "settings.json"), JSON.stringify({ quietStartup: true }));
	const host = composeRuntimeContext({ owner: "preparation", home }, { resourceRoot: ROOT, agentHome: agent,
		env: { ...process.env, PI_OFFLINE: "1", UV_OFFLINE: "1", UV_NO_SYNC: "1", PI_COC_READER_CMD: undefined, PI_COC_CONTENT_ROOT: undefined } });
	const runtime = { contentRoot: host.contentRoot,
		async sourceText({ pages }) { return { snapshots: pages.map(page => ({ page, text: PAGES[page - 1] })) }; },
		runTask: (task, signal) => runtimeCapabilities.runTask(host, task, signal ?? new AbortController().signal) };
	const rows = [];
	const reading = new ReadingService({ home, runtime, call: (method, params) => kernel.handlers[method](params), campaign: () => undefined,
		model: () => ({ id: "castbox/cast-1", vision: false, thinking: "off" }), progress() {}, record: entry => rows.push(entry), published() {} });
	t.after(() => reading.close());
	const result = await reading.cast(mid);
	return { result, rows, seen, home, mid };
}

/** The range directory the kernel gave the child: the one directory holding the host's submissions.jsonl. */
async function rangeDir(home) {
	const walk = async dir => {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isFile() && entry.name === "submissions.jsonl") return dir;
			if (entry.isDirectory() && entry.name !== "agent") { const found = await walk(path); if (found) return found; }
		}
	};
	return walk(join(home, ".coc"));
}

test("§177.2 through the real child: no file tool, the host writes and checks the draft, and a refused row is repaired in the same session", async t => {
	const outside = await temporary(t, "cast child outside ");
	// Call 1 tries to write its draft to a path it made up and submits a row no cited page prints. Call 2 drops exactly the
	// rows the host's check named, so the repair happens only if the check's answer reached the model.
	const { result, seen, home } = await castOf(t, (turn, body) => {
		if (turn === 1) return { items: [call(turn, 0, "write", { path: join(outside, " .coc", "draft.json"), content: "{}" }),
			call(turn, 1, "submit_cast", { draft: DRAFT })] };
		if (turn === 2) {
			const refused = new Set([...toolOutputs(body).join("\n").matchAll(/"index":\s*(\d+)/g)].map(match => Number(match[1])));
			return { items: [call(turn, 0, "submit_cast", { draft: { people: DRAFT.people.filter((_, index) => !refused.has(index)) } })] };
		}
		return { items: [prose(turn)] };
	});
	assert.deepEqual([result.state, result.people, result.accepted], ["complete", 3, 3], JSON.stringify(result));
	assert.equal(seen.length, 2, "the passing draft ended the child: no call after it");
	assert.deepEqual(seen[0].tools.map(tool => tool.name), ["submit_cast"], "the child is offered no file tool");
	const first = JSON.stringify(seen[0].input);
	assert.match(first, /Its keeper, Silas Marsh, trims the lamp\./, "the page files are attached");
	assert.match(first, /\\"purpose\\":\s*\\"cast\\"/, "task.json is attached");
	assert.equal(first.includes("draft.json"), false, "nothing tells the child a file to write");
	assert.match(toolOutputs(seen[1]).join("\n"), /Tool write not found/, "the made-up path never reached a write tool");
	assert.match(toolOutputs(seen[1]).join("\n"), /not_on_page/, "the cast check's refusal reached the model");
	assert.equal(await exists(join(outside, " .coc")), false, "nothing was written at the path the model made up");
	const dir = await rangeDir(home);
	assert.deepEqual(JSON.parse(await readFile(join(dir, "draft.json"), "utf8")).people.map(person => person.book[0]), ["Old Mae", "Silas Marsh", "Jonah"],
		"the host wrote the draft the kernel then checked");
	assert.deepEqual((await readFile(join(dir, "submissions.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)).map(entry => [entry.ok, entry.refused]),
		[[false, 1], [true, 0]]);
});

test("§177.2 through the real child: a provider error before Pi's retry queues no reminder, so a passing draft is submitted once", async t => {
	const good = { people: DRAFT.people.slice(0, 3) };
	const { result, seen, home } = await castOf(t, turn => turn === 1 ? { status: 503 } : { items: [call(turn, 0, "submit_cast", { draft: good })] });
	assert.equal(result.state, "complete");
	assert.equal(seen.length, 2, "the failed call and its retry; no reminder turn after the passing draft");
	const dir = await rangeDir(home);
	assert.equal((await readFile(join(dir, "submissions.jsonl"), "utf8")).trim().split("\n").length, 1);
});
