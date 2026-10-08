/**
 * Contract §191.2 (amended 2026-10-07 after TR-C): the page-transcript layout child names no path. Its one tool is the
 * private `submit_layout`; the host writes `layout.md` into the child's work directory, assembles each submission at once
 * and answers with the lines it left out, so the child repairs its layout in the same session.
 *
 * The tool is tested as the adaptation submission is (its hooks driven directly), and the producer through its real
 * entry: `TranscriptService` with a runtime whose `runTask` is the host's own (`runtime/tasks.ts`), which spawns the
 * vendored Pi with the emitted `reader-context` and `layout-submit` against a local Responses endpoint scripted as a model.
 * The child test loads the emitted `build/`: run `npm run build:runtime` first.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import layoutSubmit from "../../extensions/module/layout-submit.ts";
import { transcriptPermutationHolds } from "../../extensions/module/page-transcript.ts";
import { TranscriptService } from "../../extensions/module/transcript-service.ts";
import { TranscriptStore } from "../../extensions/module/transcript-store.ts";
import { TRANSCRIPT_FALLBACK } from "../../runtime/jev/host-budgets.ts";
import { composeRuntimeContext } from "../../runtime/host.ts";
import { runtimeCapabilities } from "../../runtime/tasks.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LINES = ["Chapter 3", "The Village", "The village sits at", "the end of the road.", "17"];
const exists = path => access(path).then(() => true, () => false);
const sha = value => createHash("sha256").update(value, "utf8").digest("hex");

async function temporary(t, prefix) {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

function mounted(dir, submissions) {
	const hooks = {}, reminders = [];
	let tool;
	layoutSubmit({ on(name, fn) { hooks[name] = fn; }, registerTool(value) { tool = value; }, sendMessage(value, options) { reminders.push({ value, options }); } },
		{ env: { PI_COC_LAYOUT_SUBMIT_DIR: dir, PI_COC_LAYOUT_SUBMISSIONS: String(submissions) } });
	return { hooks, reminders, tool };
}

test("§191.2 submit_layout keeps the best layout, names what it left out, and ends the child when it is whole", async t => {
	const dir = await temporary(t, "layout-submit-");
	await writeFile(join(dir, "lines.json"), JSON.stringify(LINES));
	const { hooks, reminders, tool } = mounted(dir, 3);
	assert.equal(tool.name, "submit_layout");
	assert.deepEqual(Object.keys(tool.parameters.properties), ["layout"], "the tool takes a layout, never a path");

	const empty = await tool.execute("call-0", { layout: "  " });
	assert.equal(empty.isError, true);
	assert.equal(hooks.tool_result({ toolName: "submit_layout", details: empty.details }).isError, true);
	assert.equal(await exists(join(dir, "layout.md")), false, "a call without a layout writes nothing and does not count");

	const partial = "# {L2}\n\n{L3}\n\n<!-- drop: L1 L5 -->";
	const first = await tool.execute("call-1", { layout: partial });
	assert.equal(first.terminate, false, "lines are left out and submissions remain");
	assert.match(first.content[0].text, /^L4: the end of the road\.$/m, "the finding names the line and its text");
	assert.doesNotMatch(first.content[0].text, /^L(1|2|3|5):/m);
	assert.match(first.content[0].text, /2 more submissions allowed/);
	assert.equal(await readFile(join(dir, "layout.md"), "utf8"), partial, "the host writes the layout the child handed it");

	hooks.agent_end();
	assert.equal(reminders.length, 1, "a child that stops with lines left out and a submission to spare is asked once more");
	assert.match(reminders[0].value.content, /submit_layout once more/);
	assert.deepEqual(reminders[0].options, { triggerTurn: true, deliverAs: "followUp" });

	const worse = await tool.execute("call-2", { layout: "# {L2}\n\n<!-- drop: L1 L5 -->{L99}" });
	assert.equal(worse.terminate, false);
	assert.match(worse.content[0].text, /earlier submission left fewer lines out/);
	assert.match(worse.content[0].text, /1 placeholder number\(s\) matched no line of this page \(it has 5\)/);
	assert.equal(await readFile(join(dir, "layout.md"), "utf8"), partial, "a worse layout never replaces a better one");

	const whole = "# {L2}\n\n{L3}{L4}\n\n<!-- drop: L1 L5 -->";
	const last = await tool.execute("call-3", { layout: whole });
	assert.equal(last.terminate, true);
	assert.match(last.content[0].text, /every line is placed or dropped/);
	assert.equal(await readFile(join(dir, "layout.md"), "utf8"), whole);
	hooks.agent_end();
	assert.equal(reminders.length, 1, "one reminder per child at most");

	const spent = await tool.execute("call-4", { layout: whole });
	assert.equal(spent.terminate, true);
	assert.match(spent.content[0].text, /No submission is left/);
	const rows = (await readFile(join(dir, "submissions.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
	assert.deepEqual(rows, [{ invalid: true },
		{ submission: 1, unplaced: [4], ignored: 0, free_removed: 0, kept: true },
		{ submission: 2, unplaced: [3, 4], ignored: 1, free_removed: 0, kept: false },
		{ submission: 3, unplaced: [], ignored: 0, free_removed: 0, kept: true }]);
});

test("§191.2 the last submission ends the child even with lines left out; a child that submitted nothing is reminded", async t => {
	const dir = await temporary(t, "layout-submit-last-");
	await writeFile(join(dir, "lines.json"), JSON.stringify(LINES));
	const once = mounted(dir, 1);
	const result = await once.tool.execute("call-1", { layout: "{L1-L3}" });
	assert.equal(result.terminate, true);
	assert.match(result.content[0].text, /the host appends them after your layout/);
	assert.match(result.content[0].text, /^L4: the end of the road\.$/m);
	once.hooks.agent_end();
	assert.equal(once.reminders.length, 0, "nothing left to submit, nothing to remind");

	const silent = mounted(dir, 2);
	silent.hooks.agent_end();
	assert.equal(silent.reminders.length, 1);
	assert.match(silent.reminders[0].value.content, /Call submit_layout now/);
	assert.throws(() => mounted(dir, 0), /submission count/);
});

// ---------------------------------------------------------------------------------------------------------------------
// The real entry: TranscriptService -> runtime/tasks.ts runTask -> a vendored Pi child with the emitted extensions.

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** The function_call_output texts in a Responses request's input. */
function toolOutputs(body) {
	return (body.input ?? []).filter(item => item?.type === "function_call_output")
		.map(item => typeof item.output === "string" ? item.output : (item.output ?? []).map(part => part?.text ?? "").join(""));
}

/**
 * A local OpenAI Responses endpoint scripted as a layout model. Call 1 tries to write its layout to a path it made up,
 * as the TR-C children did, and submits a layout that leaves line 4 out. Call 2 resubmits with exactly the lines the
 * host's answer named, so a repair happens only if the finding reached the model. Any later call answers in prose.
 */
function layoutModel(t, outside) {
	const seen = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", chunk => { body += chunk; });
		request.on("end", () => {
			const parsed = JSON.parse(body || "{}");
			seen.push(parsed);
			const call = (index, name, args) => ({ type: "function_call", id: `fc_${seen.length}_${index}`, call_id: `call_${seen.length}_${index}`, name,
				arguments: JSON.stringify(args), status: "completed" });
			let items;
			if (seen.length === 1) items = [call(0, "write", { path: join(outside, " .coc", "layout.md"), content: "{L1-L5}" }),
				call(1, "submit_layout", { layout: "# {L2}\n\n{L3}\n\n<!-- drop: L1 L5 -->" })];
			else if (seen.length === 2) {
				const named = [...toolOutputs(parsed).join("\n").matchAll(/^L(\d+): /gm)].map(match => `{L${match[1]}}`).join("");
				items = [call(0, "submit_layout", { layout: `# {L2}\n\n{L3}${named}\n\n<!-- drop: L1 L5 -->` })];
			} else items = [{ type: "message", id: `msg_${seen.length}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done.", annotations: [] }] }];
			response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			const send = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
			send({ type: "response.created", response: { id: `resp_${seen.length}`, status: "in_progress" } });
			for (const [index, item] of items.entries()) {
				send({ type: "response.output_item.added", output_index: index, item: item.type === "function_call" ? { ...item, arguments: "" } : { ...item, content: [] } });
				if (item.type === "message") send({ type: "response.output_text.delta", output_index: index, content_index: 0, delta: "Done." });
				send({ type: "response.output_item.done", output_index: index, item });
			}
			send({ type: "response.completed", response: { id: `resp_${seen.length}`, status: "completed", output: items,
				usage: { input_tokens: 1000, output_tokens: 40, total_tokens: 1040 } } });
			response.end();
		});
	});
	t.after(() => new Promise(done => server.close(done)));
	return new Promise(ready => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, seen })));
}

test("§191.2 through the real child: no file tool, the host writes the layout, and a finding is repaired in the same session", async t => {
	const home = await temporary(t, "layout child home ");
	const outside = await temporary(t, "layout child outside ");
	const agent = join(home, "agent");
	await mkdir(agent, { recursive: true });
	const { port, seen } = await layoutModel(t, outside);
	await writeFile(join(agent, "models.json"), JSON.stringify({ providers: { layoutbox: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-responses",
		apiKey: "unused", models: [{ id: "layout-1", input: ["text", "image"], contextWindow: 100000, maxTokens: 4096 }] } } }));
	await writeFile(join(agent, "settings.json"), JSON.stringify({ quietStartup: true }));
	const context = composeRuntimeContext({ owner: "preparation", home }, { resourceRoot: ROOT, agentHome: agent,
		env: { ...process.env, PI_OFFLINE: "1", UV_OFFLINE: "1", UV_NO_SYNC: "1", PI_COC_READER_CMD: undefined, PI_COC_CONTENT_ROOT: undefined } });
	const file = sha("layout child fixture");
	const runtime = {
		home, contentRoot: context.contentRoot,
		runTask: (task, signal) => runtimeCapabilities.runTask(context, task, signal),
		async sourceLines({ pages }) {
			return { file_sha256: file, extraction_version: "pdfjs-fixture:native-text-v1", page_count: 1,
				pages: pages.map(page => ({ page, pdf_label: String(page), native_sha256: sha(LINES.join("\n")), lines: LINES })), errors: [] };
		},
		async sourcePage({ cache, page }) {
			await mkdir(cache, { recursive: true });
			const path = join(cache, `page-${page}.png`);
			await writeFile(path, PNG);
			return { path, page };
		},
	};
	const rows = [];
	const service = new TranscriptService({ runtime, record: row => rows.push(row), extractionVersion: "pdfjs-fixture:native-text-v1",
		model: () => ({ id: "layoutbox/layout-1", vision: true, contextWindow: 100000 }),
		budget: { ...TRANSCRIPT_FALLBACK, timeoutMs: 90_000, cooldownMs: 0 } });
	t.after(() => service.close());
	const queued = await service.ensure({ pdf: "source.pdf", file_sha256: file, pages: [1] });
	assert.deepEqual(queued.queued, [1]);
	await service.idle();

	const page = rows.find(row => row.event === "page");
	assert.ok(page, JSON.stringify(rows));
	assert.deepEqual([page.outcome, page.attempts, page.submissions, page.unplaced], ["repaired", 1, 2, 0], JSON.stringify(page));
	assert.equal(seen.length, 2, "the whole layout ended the child: no call after it");
	const offered = seen[0].tools.map(tool => tool.name);
	assert.deepEqual(offered, ["submit_layout"], "the child is offered no file tool");
	const first = JSON.stringify(seen[0].input);
	assert.match(first, /input_image/, "the page image is attached");
	assert.match(first, /L4: the end of the road\./, "the numbered lines are attached");
	assert.match(toolOutputs(seen[1]).join("\n"), /Tool write not found/, "the made-up path never reached a write tool");
	assert.match(toolOutputs(seen[1]).join("\n"), /^L4: the end of the road\.$/m, "the host's finding reached the model");
	assert.equal(await exists(join(outside, " .coc")), false, "nothing was written at the path the model made up");

	const store = new TranscriptStore({ home, contentRoot: context.contentRoot, extractionVersion: "pdfjs-fixture:native-text-v1" });
	const { record } = await store.read(file, 1);
	assert.deepEqual([record.unplaced, record.dropped, record.attempts], [[], [1, 5], 1]);
	assert.ok(transcriptPermutationHolds(record.text, LINES));
	const work = store.workDir(file, 1, 1);
	assert.equal(await readFile(join(work, "layout.md"), "utf8"), "# {L2}\n\n{L3}{L4}\n\n<!-- drop: L1 L5 -->", "the host wrote the kept layout");
	assert.deepEqual((await readdir(work)).filter(name => !name.startsWith("run.jsonl") && name !== ".pi" && name !== "host-bin").sort(),
		["layout.md", "lines.json", "lines.txt", "submissions.jsonl"], "page.png is removed with the page; nothing else was written");
	assert.equal(await exists(store.workDir(file, 1, 2)), false, "no repair child");
});
