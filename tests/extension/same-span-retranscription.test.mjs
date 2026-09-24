/**
 * SL-33 (contract §22.3.1, §22.2.1): a re-transcription of the same span is not a contradiction, and a
 * focus already being read is not read again.
 *
 * SL-29A, 血色公路, book-1: guidance published the module node's `investigator_hook` with two misreadings
 * of one sentence; both opening readings read the same pages more accurately, their reviewers supported
 * the corrected sentence, and publication refused each as "the new reading contradicts a published
 * value". Meanwhile the index publication's read-ahead queued a way-on repair of the same scene, by its
 * handle, while the opening reading of it -- by its name -- was still running.
 *
 * These run the emitted kernel on a two-page PDF the test writes, with the reader's drafts and reviews
 * written by the test: the seam under test is the publication gate and the queue, not a model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ReadingService } from "../../extensions/module/reading-service.ts";

const REPO = resolve(import.meta.dirname, "../..");
const MISREAD = "唯一的卡片要求是：有理由在1975年夏末开车经过西德克萨斯。例子包括轰蹭青少年或电视记者。";
const CORRECT = "唯一的车卡要求是：有理由在1975年夏末开车经过西德克萨斯。例子包括轰趴青少年或电视记者。";

/** A two-page text PDF: the suite's own source, bound through the kernel as the App binds a book. */
function pdf() {
	const streams = ["BT /F1 12 Tf 20 160 Td (Prologue: the highway) Tj ET", "BT /F1 12 Tf 20 160 Td (The roadhouse) Tj ET"];
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${streams.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	for (const [i, stream] of streams.entries()) objects.push(
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
	let text = "%PDF-1.7\n";
	const offsets = [0];
	for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	return text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

function kernelClient(workspace) {
	const child = spawn(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace,
		"--content", join(REPO, "content")], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
	child.stdout.setEncoding("utf8");
	const waiting = new Map();
	let pending = "";
	child.stdout.on("data", chunk => {
		pending += chunk;
		let end;
		while ((end = pending.indexOf("\n")) >= 0) {
			const line = pending.slice(0, end).trim();
			pending = pending.slice(end + 1);
			if (!line) continue;
			let reply;
			try { reply = JSON.parse(line); } catch { continue; }
			waiting.get(reply.id)?.(reply);
			waiting.delete(reply.id);
		}
	});
	let ordinal = 0;
	const call = (method, params) => new Promise(done => {
		const id = `call-${++ordinal}`;
		waiting.set(id, done);
		child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
	});
	return {
		close: () => { child.stdin.end(); child.kill(); },
		err: async (method, params) => {
			const reply = await call(method, params);
			assert.equal(reply.ok, false, `${method} was expected to be refused: ${JSON.stringify(reply.result)}`);
			return reply.error;
		},
		ok: async (method, params) => {
			const reply = await call(method, params);
			assert.equal(reply.ok, true, `${method}: ${JSON.stringify(reply.error)}`);
			return reply.result;
		},
	};
}

const write = (path, value) => writeFile(path, JSON.stringify(value), "utf8");

async function book(t) {
	const home = await mkdtemp(join(tmpdir(), "coc-same-span-"));
	const kernel = kernelClient(home);
	t.after(() => { kernel.close(); return rm(home, { recursive: true, force: true }); });
	const path = join(home, "blood-road.pdf"), bytes = Buffer.from(pdf());
	await writeFile(path, bytes);
	const { module_id: mid } = await kernel.ok("module.source.bind", { source: { path,
		file_sha256: createHash("sha256").update(bytes).digest("hex"), page_count: 2 } });
	const read = async (params, draft, paths, { review = true } = {}) => {
		await kernel.ok("module.read.request", { module_id: mid, ...params });
		const job = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
		await write(join(job.work_dir, "observations.json"),
			{ file_sha256: job.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2] });
		await write(join(job.work_dir, "draft.json"), draft);
		if (review) await write(join(job.work_dir, "review.json"), { missing: [],
			checked: paths.map(path => ({ path, verdict: "supported", source_refs: [{ page: 1 }, { page: 2 }], reason: "fixture support" })) });
		const finish = { module_id: mid, job_id: job.job_id, lease: job.lease, outcome: "completed",
			draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json") };
		return { job, finish };
	};
	// The index, then an opening that publishes the module node with the misread sentence from page 1.
	const index = await read({ purpose: "index", focus: "", question: "" }, { title: "血色公路", language: "zh-Hans",
		sections: [{ name: "序幕", pages: [[1, 2]], topics: ["opening"], entities: ["序幕"], references: [] }] }, [], { review: false });
	await kernel.ok("module.read.finish", { ...index.finish, review_path: undefined });
	const scene = { node_id: "scene-xu-mu", node_kind: "scene", name: "序幕", source_refs: [{ page: 1 }],
		summary: "The investigators drive a remote highway toward Abattoir.", properties: { is_entrance: true, is_final: true } };
	const moduleNode = (hook, refs, extra = {}) => ({ node_id: `module-${mid}`, node_kind: "module", name: "血色公路",
		visibility: "player-safe", source_refs: refs, properties: { investigator_hook: hook, ...extra } });
	const shard = (nodes, ready = ["scene-xu-mu"]) => ({ nodes, claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ready });
	return { home, kernel, mid, read, scene, moduleNode, shard };
}

const graphOf = async (home, mid) => {
	const dir = join(home, ".coc", "modules", mid), meta = JSON.parse(await readFile(join(dir, "module.json"), "utf8"));
	return { meta, graph: JSON.parse(await readFile(join(dir, meta.graph_file), "utf8")) };
};

test("a second reading of the same page that transcribes a published field differently replaces it, reviewed and recorded", async t => {
	const { home, kernel, mid, read, scene, moduleNode, shard } = await book(t);
	const first = await read({ purpose: "opening", focus: "序幕" }, shard([moduleNode(MISREAD, [{ page: 1 }]), scene]), ["/nodes/0", "/nodes/1", "/coverage"]);
	await kernel.ok("module.read.finish", first.finish);
	const hook = `/nodes/module-${mid}/properties/investigator_hook`;

	// The second reader reads page 1 again and gets the sentence right. The review that does not name the
	// re-transcribed field does not cover the replacement: the draft check asked for it by pointer.
	const second = await read({ purpose: "detail", focus: "序幕", question: "What does the book ask of the investigators?" },
		shard([moduleNode(CORRECT, [{ page: 1 }]), scene]), ["/nodes/1", "/coverage"]);
	const unreviewed = await kernel.err("module.read.finish", second.finish);
	assert.equal(unreviewed.code, "invalid_params");
	assert.match(unreviewed.message, /omitted required fields.*\/nodes\/0\/properties\/investigator_hook/);

	await write(join(second.job.work_dir, "review.json"), { missing: [], checked: ["/nodes/0/properties/investigator_hook", "/nodes/1", "/coverage"]
		.map(path => ({ path, verdict: "supported", source_refs: [{ page: 1 }], reason: "read on page 1" })) });
	const published = await kernel.ok("module.read.finish", second.finish);
	assert.equal(published.generation, 2);
	const { meta, graph } = await graphOf(home, mid);
	assert.equal(graph.nodes.find(node => node.node_id === `module-${mid}`).properties.investigator_hook, CORRECT);
	assert.deepEqual(meta.reading.retranscriptions, [{ path: hook, previous: MISREAD, value: CORRECT,
		source_refs: [{ source_id: `pdf:${mid}`, pdf_index: 0 }], job_id: second.job.job_id, generation: 2 }]);
	assert.deepEqual(graph.field_spans[hook], [{ source_id: `pdf:${mid}`, pdf_index: 0 }],
		"publication records the span each written field was read from");
});

test("a different value from a different page is a contradiction, refused at the draft check before any review", async t => {
	const { kernel, mid, read, scene, moduleNode, shard } = await book(t);
	const first = await read({ purpose: "opening", focus: "序幕" }, shard([moduleNode(MISREAD, [{ page: 1 }]), scene]), ["/nodes/0", "/nodes/1", "/coverage"]);
	await kernel.ok("module.read.finish", first.finish);
	// No review.json is written: the refusal comes from the draft check, before the review would be read.
	const second = await read({ purpose: "detail", focus: "序幕", question: "What does page 2 say of the investigators?" },
		shard([moduleNode(CORRECT, [{ page: 2 }]), scene]), [], { review: false });
	const refused = await kernel.err("module.read.finish", second.finish);
	assert.equal(refused.code, "needs_choice");
	assert.equal(refused.details.path, `/nodes/module-${mid}/properties/investigator_hook`);
	assert.deepEqual([refused.details.existing_pages, refused.details.proposed_pages], [[1], [2]]);
	assert.match(refused.message, /another passage.*page\(s\) 1.*page\(s\) 2/);
	assert.equal((await kernel.ok("module.status", { module_id: mid })).generation, 1);
});

test("the same page is one passage only where the boxes meet", async t => {
	const { kernel, mid, read, scene, moduleNode, shard } = await book(t);
	const top = { page: 1, box: [0, 0, 1, 0.4] }, bottom = { page: 1, box: [0, 0.6, 1, 1] }, middle = { page: 1, box: [0, 0.3, 1, 0.7] };
	const first = await read({ purpose: "opening", focus: "序幕" }, shard([moduleNode(MISREAD, [top]), scene]), ["/nodes/0", "/nodes/1", "/coverage"]);
	await kernel.ok("module.read.finish", first.finish);
	const elsewhere = await read({ purpose: "detail", focus: "序幕", question: "What does the lower half say?" },
		shard([moduleNode(CORRECT, [bottom]), scene]), [], { review: false });
	assert.equal((await kernel.err("module.read.finish", elsewhere.finish)).code, "needs_choice");
	await kernel.ok("module.read.finish", { ...elsewhere.finish, outcome: "cancelled" });
	const overlapping = await read({ purpose: "detail", focus: "序幕", question: "What does the middle say?" },
		shard([moduleNode(CORRECT, [middle]), scene]), ["/nodes/0/properties/investigator_hook", "/nodes/1", "/coverage"]);
	assert.equal((await kernel.ok("module.read.finish", overlapping.finish)).generation, 2);
});

test("a field's recorded span outlives its node's growing references", async t => {
	const { kernel, mid, read, scene, moduleNode, shard } = await book(t);
	const first = await read({ purpose: "opening", focus: "序幕" }, shard([moduleNode(MISREAD, [{ page: 1 }]), scene]), ["/nodes/0", "/nodes/1", "/coverage"]);
	await kernel.ok("module.read.finish", first.finish);
	// Page 2 adds another fact to the module node; the node now cites pages 1 and 2, the hook still page 1.
	const second = await read({ purpose: "detail", focus: "序幕", question: "Which year is it?" },
		shard([{ ...moduleNode(MISREAD, [{ page: 2 }]), properties: { era: "1975" } }, scene]), ["/nodes/0", "/nodes/1", "/coverage"]);
	await kernel.ok("module.read.finish", second.finish);
	// A different hook citing only page 2 is from another passage than the one the hook was read from.
	const third = await read({ purpose: "detail", focus: "序幕", question: "What else does page 2 ask?" },
		shard([moduleNode(CORRECT, [{ page: 2 }]), scene]), [], { review: false });
	const refused = await kernel.err("module.read.finish", third.finish);
	assert.equal(refused.code, "needs_choice");
	assert.deepEqual([refused.details.existing_pages, refused.details.proposed_pages], [[1], [2]]);
	assert.equal((await kernel.ok("module.status", { module_id: mid })).generation, 2);
});

test("a replacement no review covered is refused: an older reading cannot quietly write the old transcription back", async t => {
	const { home, kernel, mid, read, scene, moduleNode, shard } = await book(t);
	const first = await read({ purpose: "opening", focus: "序幕" }, shard([moduleNode(MISREAD, [{ page: 1 }]), scene]), ["/nodes/0", "/nodes/1", "/coverage"]);
	await kernel.ok("module.read.finish", first.finish);
	// Reading A was claimed while the hook still read MISREAD, and copies it: nothing for its review to name.
	const older = await read({ purpose: "detail", focus: "序幕", question: "How long is the drive?" },
		shard([moduleNode(MISREAD, [{ page: 1 }]), scene]), ["/nodes/1", "/coverage"]);
	// Reading B, of another focus, corrects the hook from the same page and is reviewed for it.
	const newer = await read({ purpose: "detail", focus: "血色公路", question: "What does the book ask of the investigators?" },
		shard([moduleNode(CORRECT, [{ page: 1 }]), scene]), ["/nodes/0/properties/investigator_hook", "/nodes/1", "/coverage"]);
	assert.notEqual(newer.job.job_id, older.job.job_id);
	await kernel.ok("module.read.finish", newer.finish);
	const refused = await kernel.err("module.read.finish", older.finish);
	assert.equal(refused.code, "needs_choice");
	assert.equal(refused.details.path, `/nodes/module-${mid}/properties/investigator_hook`);
	const { graph } = await graphOf(home, mid);
	assert.equal(graph.nodes.find(node => node.node_id === `module-${mid}`).properties.investigator_hook, CORRECT);
});

test("a repair of a scene another reading is still reading attaches to that reading; after it settles it queues", async t => {
	const { home, kernel, mid, read, scene, moduleNode, shard } = await book(t);
	const first = await read({ purpose: "opening", focus: "序幕" }, shard([moduleNode(MISREAD, [{ page: 1 }]), scene]), ["/nodes/0", "/nodes/1", "/coverage"]);
	await kernel.ok("module.read.finish", first.finish);
	// A reading of the scene by its name is running (claimed, not finished).
	const running = await read({ purpose: "detail", focus: "序幕", question: "Who stops on the highway?" }, shard([scene]), ["/nodes/0", "/coverage"]);
	const queueFile = join(home, ".coc", "modules", mid, "deepen-queue.json");
	const before = JSON.parse(await readFile(queueFile, "utf8")).length;
	// The way-on repair names the same scene by its handle; a detail names it by its id. Neither is read again.
	const repair = await kernel.ok("module.read.request", { module_id: mid, purpose: "opening", focus: "xu-mu", repair: "way_on", foreground: false });
	assert.deepEqual([repair.state, repair.job_id, repair.attached], ["reading", running.job.job_id, true]);
	const detail = await kernel.ok("module.read.request", { module_id: mid, purpose: "detail", focus: "scene-xu-mu", question: "What is the road like?", foreground: true });
	assert.deepEqual([detail.job_id, detail.attached], [running.job.job_id, true]);
	const rows = JSON.parse(await readFile(queueFile, "utf8"));
	assert.equal(rows.length, before, "no second reading of the focus was queued");
	assert.equal(rows.find(row => row.job_id === running.job.job_id).foreground, true, "a foreground wait promotes the reading it attached to");
	// Another focus is not held up.
	const other = await kernel.ok("module.read.request", { module_id: mid, purpose: "detail", focus: "The roadhouse", question: "Who runs it?" });
	assert.equal(other.attached, undefined);

	await kernel.ok("module.read.finish", running.finish);
	const afterwards = await kernel.ok("module.read.request", { module_id: mid, purpose: "opening", focus: "xu-mu", repair: "way_on", foreground: false });
	assert.equal(afterwards.attached, undefined);
	assert.equal(afterwards.state, "queued");
	assert.notEqual(afterwards.job_id, running.job.job_id);
});

test("two queued readings of one focus spelled two ways are claimed one after the other", async t => {
	const { kernel, mid, read, scene, moduleNode, shard } = await book(t);
	const first = await read({ purpose: "opening", focus: "序幕" }, shard([moduleNode(MISREAD, [{ page: 1 }]), scene]), ["/nodes/0", "/nodes/1", "/coverage"]);
	await kernel.ok("module.read.finish", first.finish);
	// Nothing is being read yet, so each question queues as its own identity (22.2: only identical requests merge).
	const byName = await kernel.ok("module.read.request", { module_id: mid, purpose: "detail", focus: "序幕", question: "Who stops on the highway?" });
	const byHandle = await kernel.ok("module.read.request", { module_id: mid, purpose: "detail", focus: "xu-mu", question: "What is the road like?" });
	assert.equal(byName.state, "queued");
	assert.equal(byHandle.state, "queued");
	assert.notEqual(byName.job_id, byHandle.job_id);
	const claimed = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
	assert.equal(claimed.job_id, byName.job_id);
	assert.deepEqual(await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" }), { job_id: null },
		"the handle names the scene the running reading reads");
	await kernel.ok("module.read.finish", { module_id: mid, job_id: claimed.job_id, lease: claimed.lease, outcome: "cancelled" });
	assert.equal((await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" })).job_id, byHandle.job_id);
});

test("a failed reading keeps the refusal the host recorded, and the blocked request returns it", async t => {
	const { kernel, mid } = await book(t);
	await kernel.ok("module.read.request", { module_id: mid, purpose: "opening", focus: "序幕" });
	const job = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
	const refusal = { message: "the new reading contradicts a published value", path: `/nodes/module-${mid}/properties/investigator_hook` };
	await kernel.ok("module.read.finish", { module_id: mid, job_id: job.job_id, lease: job.lease, outcome: "failed",
		detail: "needs_choice: the new reading contradicts a published value", refusal: { ...refusal, stray: { nested: true } } });
	const blocked = await kernel.ok("module.read.request", { module_id: mid, purpose: "opening", focus: "序幕" });
	assert.equal(blocked.state, "blocked");
	assert.deepEqual(blocked.refusal, refusal);
});

test("the preparation says which field stopped it and why, in a sentence it wrote", async t => {
	const refusal = { message: "the new reading contradicts a published value read from another passage: the published value was read from page(s) 6 and the new value cites page(s) 9",
		path: "/nodes/module-book-1/properties/investigator_hook" };
	const blocked = { state: "blocked", missing: ["needs_choice: ..."], fix: "request the same reading with retry: true" };
	for (const [reply, said] of [[{ ...blocked, refusal }, true], [blocked, false]]) {
		const service = new ReadingService({ home: "/unused", model: () => { throw new Error("no reader"); }, progress() {}, record() {},
			async call(method) {
				if (method === "module.read.request") return { generation: 1, ...reply };
				if (method === "module.read.claim") return { job_id: null };
				throw new Error(`unexpected ${method}`);
			} });
		t.after(() => service.dispose());
		const failure = await service.ensure("book-1", { purpose: "opening", focus: "序幕", foreground: true }).then(() => null, error => error);
		assert.ok(failure);
		assert.equal(failure.said === true, said);
		if (said) assert.equal(failure.message, `The reading of "序幕" was refused at ${refusal.path}: ${refusal.message}.`);
	}
});

test("a cancelled wait on another identity's reading does not cancel that reading", async t => {
	for (const attached of [true, false]) {
		const service = new ReadingService({ home: "/unused", model: () => { throw new Error("no reader"); }, progress() {}, record() {},
			async call(method) {
				if (method === "module.read.request") return { state: "reading", job_id: "read-7", generation: 1, ...(attached ? { attached: true } : {}) };
				if (method === "module.read.claim") return { job_id: null };
				if (method === "module.read.unwait") return {};
				throw new Error(`unexpected ${method}`);
			} });
		t.after(() => service.dispose());
		const abort = new AbortController();
		const waiting = service.ensure("book-1", { purpose: "opening", focus: "xu-mu", repair: "way_on", foreground: true }, abort.signal).catch(error => error);
		await new Promise(done => setTimeout(done, 50));
		abort.abort();
		await waiting;
		assert.equal(service.cancelledJobs.size, attached ? 0 : 1, attached ? "the attached reading is left to its owner" : "an owned reading is cancelled");
	}
});
