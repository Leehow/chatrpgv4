/**
 * A refusal's `fix` may point the Keeper at `details.<key>`; the model sees only the tool result
 * text, so whatever a `fix` names has to be rendered there (contract §8, #66). Real play had
 * `reading_timeout` say "the exact focus and question in details.read; do not invent another
 * question" while the projection dropped `details.read`, and the Keeper could not take the
 * recovery path it was pointed at. The rule is generic: the host reads the key names out of the
 * `fix` text, so a kernel-side `fix` such as `discover one of details.clues_here` is covered too.
 *
 * Both cases travel the product path: the real extension's tool, the real reading service timing
 * out on a foreground wait (the kernel answers `reading` and lets nobody claim the job), and the
 * real kernel refusing an `apply` on the Haunting graph.
 */
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { ReadingService } from "../../extensions/module/reading-service.ts";
import { openTable, waitForIdle } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/** The text of every tool result the model was shown for `tool`, in order. */
function toolResultTexts(session, tool) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === tool)
		.map((message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""));
}

test("a reading timeout shows the Keeper the focus and question its fix tells it to reuse", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_READING: "1", PI_COC_READ_WAIT_MS: "50" },
		responses: [
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "the-ruins", question: "What waits at the ruins?" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "The road to the ruins is still being prepared." })], { stopReason: "toolUse" }),
			fauxAssistantMessage("The road to the ruins is still being prepared."),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("I walk out toward the ruins.");
	const [text] = toolResultTexts(table.session, "lookup");
	assert.ok(text, "the lookup returned a tool result");
	assert.match(text, /^needs: the source is still being read$/m);
	assert.match(text, /^fix: .*details\.read.*do not invent another question$/m);
	// What the fix names, as one line the Keeper can copy from: purpose, focus and question, verbatim.
	assert.match(text, /^read: \{"purpose":"detail","focus":"the-ruins","question":"What waits at the ruins\?"\}$/m);
	// What the fix does not name stays out of the model's text: the job handle is telemetry's.
	assert.doesNotMatch(text, /read-7/);

	// The refusal row says what it waited for (#65): the queue's job and the read's target, never the question's prose.
	const refusal = table.telemetry().find((row) => row.tool === "lookup" && row.ok === false);
	assert.equal(refusal?.reason, "reading_timeout", JSON.stringify(refusal));
	assert.deepEqual([refusal.job_id, refusal.read_purpose, refusal.read_focus], ["read-7", "detail", "the-ruins"]);
	assert.ok(!JSON.stringify(refusal).includes("What waits"));
});

test("the claim row names the job and the wake it answered; a wake that finds nothing says so", async () => {
	const rows = [];
	let queued = true;
	const service = new ReadingService({ home: "/unused", model() { return {}; }, progress() {}, record(row) { rows.push(row); },
		async call(method) {
			assert.equal(method, "module.read.claim");
			if (queued) { queued = false; return { job_id: "read-7", purpose: "detail", focus: "the-ruins", foreground: true, concurrency: 3, at: new Date().toISOString() }; }
			return { job_id: null };
		} });
	service.runJob = async () => {};
	await service.prefetch("book", "scene-queued");
	await service.prefetch("book", "turn-committed");
	await service.close();
	const claimed = rows.find((row) => row.event === "concurrency");
	assert.deepEqual([claimed.job_id, claimed.purpose, claimed.focus, claimed.wake], ["read-7", "detail", "the-ruins", "scene-queued"]);
	assert.deepEqual(rows.filter((row) => row.event === "claim_empty").map((row) => row.wake), ["turn-committed"]);
});

test("the read row names its job and the physical pages the reader consumed", async (t) => {
	const home = await mkdtemp(join(tmpdir(), "reading-intent-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const cwd = join(home, "work", "read-3");
	await mkdir(cwd, { recursive: true });
	const cache = join(home, ".coc", "modules", "book", "cache", "pages");
	await mkdir(cache, { recursive: true });
	const page12 = join(cache, "page-12-region-0-0-1-1-1400.png");
	// The page tool's own log: one page the model kept, one it rendered but was never shown.
	await writeFile(join(cache, "requests.jsonl"), [
		JSON.stringify({ file_sha256: "abc", path: page12, page: 12, box: [0, 0, 1, 1] }),
		JSON.stringify({ file_sha256: "abc", path: join(cache, "page-40.png"), page: 40, box: [0, 0, 1, 1] }),
	].join("\n") + "\n");
	const rows = [], calls = [];
	const runtime = {
		contentRoot: join(ROOT, "content"),
		async runTask(task) {
			const request = task.request;
			await writeFile(join(request.cwd, "draft.json"), JSON.stringify({ nodes: [], claims: [] }) + "\n");
			request.onEvent?.({ type: "tool_execution_start", toolName: "read", toolCallId: "call-1", args: { path: "pdf" } });
			request.onEvent?.({ type: "tool_execution_end", toolCallId: "call-1", isError: false,
				result: { content: [{ type: "image" }], details: { kind: "source_pages", observations: [{ path: page12, page: 12 }] } } });
			await writeFile(`${request.eventLog}.images.jsonl`, JSON.stringify({ included: ["call-1"] }) + "\n");
			return { ok: true, ms: 7, stderr: "" };
		},
		async check() { return { ok: true }; },
		async sourceInfo() { throw new Error("not a guidance job"); },
	};
	const service = new ReadingService({ home, runtime, model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }), progress() {},
		record: (row) => rows.push(row), async call(method, params) { calls.push({ method, params }); return { state: "ready" }; } });
	const job = { job_id: "read-3", module_id: "book", purpose: "detail", focus: "hotel-espana", question: "", pages: [], foreground: true, lease: "L1",
		work_dir: cwd, at: new Date().toISOString(), source: { path: join(home, ".coc", "modules", "book", "source.pdf"), page_count: 60, file_sha256: "abc" },
		index: {}, known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [] };
	await service.runJob(job, new AbortController().signal);
	const read = rows.find((row) => row.phase === "read");
	assert.ok(read, JSON.stringify(rows));
	assert.deepEqual(
		{ job_id: read.job_id, purpose: read.purpose, focus: read.focus, round: read.round, pages: read.pages, image_reads: read.image_reads, ok: read.ok },
		{ job_id: "read-3", purpose: "detail", focus: "hotel-espana", round: 1, pages: [12], image_reads: 1, ok: true },
	);
	assert.ok(calls.some((call) => call.method === "module.read.finish" && call.params.outcome === "completed"), JSON.stringify(calls));
	// The row and the observations the kernel publishes from are built from the same set.
	assert.deepEqual(JSON.parse(await readFile(join(cwd, "observations.json"), "utf8")).read_pages, [12]);
});

test("a kernel refusal that points at details.clues_here shows the clues that are here", async (t) => {
	const table = await openTable({
		realKernel: true,
		campaign: "clues-here-seam",
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特律师把文件放在桌上，等你开口。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("开场后不应再交付的文字。"),
			// The diaries are in the Corbitt house; the table is still at the commission briefing.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "clue", clue: "clue-corbitt-diaries" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "这里没有什么日记。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("这里没有什么日记。"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt("我翻找科比特的日记。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	const [text] = toolResultTexts(table.session, "apply");
	assert.ok(text, "the apply returned a tool result");
	assert.match(text, /^not_here: /m);
	assert.match(text, /^fix: discover one of details\.clues_here, or move first$/m);
	const line = text.split("\n").find((row) => row.startsWith("clues_here: "));
	assert.ok(line, `the clues here reach the model:\n${text}`);
	// Graph handles, as the kernel's own list names them (the `clue-` prefix is the node id's, not the handle's).
	const clues = JSON.parse(line.slice("clues_here: ".length));
	assert.ok(clues.includes("knott-research-leads"), JSON.stringify(clues));
	assert.ok(!clues.includes("corbitt-diaries"));
});
