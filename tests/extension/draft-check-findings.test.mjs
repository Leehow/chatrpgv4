/**
 * RC-03 (contract §186.3): the draft check reports every independent finding of a stage at once.
 *
 * Measured on the installed App home (2026-10-02..10-06): 40 % of reading-author calls were the fix loop after the first
 * refused submission, because the check threw at its first finding -- a draft with seven independent mistakes took seven
 * submissions. Vocabulary refusals named neither the field, the value nor the allowed list, and authors cycled guesses.
 *
 * These travel the real entries: `module.read.finish` on the emitted kernel, the `coc-read-check` binary, and the
 * `submit_reading` tool that execs it. The drafts are structural replicas written by the test; no model runs.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import readerSubmit from "../../extensions/module/reader-submit.ts";

const REPO = resolve(import.meta.dirname, "../.."), START = process.cwd();
const contract = JSON.parse(await readFile(join(REPO, "content/modules/module-graph-contract-v3.json"), "utf8"));
const write = (path, value) => writeFile(path, JSON.stringify(value) + "\n", "utf8");
// `checkSourceDraft` from source: what the `coc-read-check` binary runs, so a change to the check is seen without a rebuild.
// The bundle sits inside the repository so its bare imports resolve against the repository's packages.
await mkdir(join(REPO, ".coc"), { recursive: true });
const bundleDir = await mkdtemp(join(REPO, ".coc", "draft-findings-"));
after(() => rm(bundleDir, { recursive: true, force: true }));
await build({ stdin: { contents: "export {checkSourceDraft} from './kernel-ts/check.ts';", resolveDir: REPO, sourcefile: "draft-findings-api.ts", loader: "ts" },
	outfile: join(bundleDir, "api.mjs"), bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
const { checkSourceDraft } = await import(pathToFileURL(join(bundleDir, "api.mjs")).href);
/** The source check of `draft` against an opening task, as the reader's `coc-read-check` runs it: the refusal, or null. */
async function sourceCheck(t, draft, task = {}) {
	const dir = await mkdtemp(join(bundleDir, "case-"));
	await write(join(dir, "task.json"), { purpose: "opening", opening_batch: true, module_id: "book-1", source: { page_count: 2 }, known_nodes: [], focus: "Dock", ...task });
	await write(join(dir, "draft.json"), draft);
	const result = await checkSourceDraft(join(REPO, "content"), join(dir, "task.json"), join(dir, "draft.json"));
	return result.ok ? null : result.error;
}

/** A two-page text PDF, bound through the kernel as the App binds a book. */
function pdf() {
	const streams = ["BT /F1 12 Tf 20 160 Td (The dock) Tj ET", "BT /F1 12 Tf 20 160 Td (The warehouse) Tj ET"];
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
	const child = spawn(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
	child.stdout.setEncoding("utf8");
	const waiting = new Map();
	let pending = "", ordinal = 0;
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
	const call = (method, params) => new Promise(done => {
		const id = `call-${++ordinal}`;
		waiting.set(id, done);
		child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
	});
	return {
		close: () => { child.stdin.end(); child.kill(); },
		ok: async (method, params) => { const reply = await call(method, params); assert.equal(reply.ok, true, `${method}: ${JSON.stringify(reply.error)}`); return reply.result; },
		err: async (method, params) => { const reply = await call(method, params); assert.equal(reply.ok, false, `${method} was expected to be refused`); return reply.error; },
	};
}

/** A bound two-page book with its index published and one opening reading claimed; `finish` publishes a draft for it. */
async function claimedOpening(t) {
	const home = await mkdtemp(join(tmpdir(), "coc-draft-findings-"));
	const kernel = kernelClient(home);
	t.after(() => { kernel.close(); return rm(home, { recursive: true, force: true }); });
	const path = join(home, "book.pdf"), bytes = Buffer.from(pdf());
	await writeFile(path, bytes);
	const { module_id: mid } = await kernel.ok("module.source.bind", { source: { path, file_sha256: createHash("sha256").update(bytes).digest("hex"), page_count: 2 } });
	const claim = async params => {
		await kernel.ok("module.read.request", { module_id: mid, ...params });
		const job = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
		await write(join(job.work_dir, "observations.json"), { file_sha256: job.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2] });
		return job;
	};
	const index = await claim({ purpose: "index", focus: "", question: "" });
	await write(join(index.work_dir, "draft.json"), { title: "Book", language: "en",
		sections: [{ name: "The dock", pages: [[1, 2]], topics: ["opening"], entities: ["Dock"], references: [] }] });
	await kernel.ok("module.read.finish", { module_id: mid, job_id: index.job_id, lease: index.lease, outcome: "completed", draft_path: join(index.work_dir, "draft.json") });
	const job = await claim({ purpose: "opening", focus: "Dock" });
	const finish = async draft => {
		await write(join(job.work_dir, "draft.json"), draft);
		await write(join(job.work_dir, "review.json"), { missing: [], checked: [] });
		return kernel.err("module.read.finish", { module_id: mid, job_id: job.job_id, lease: job.lease, outcome: "completed",
			draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json") });
	};
	return { kernel, mid, job, finish };
}

const node = (id, kind, name, extra = {}) => ({ node_id: id, node_kind: kind, name, source_refs: [{ page: 1 }], properties: {}, ...extra });
const claim = (subject, predicate, object, extra = {}) => ({ subject_id: subject, predicate, object: { node_id: object }, truth_status: "authored-fact", source_refs: [{ page: 1 }], ...extra });
/** A clean opening draft: the dock, a witness present there, a crate, three claims. */
function clean() {
	return { nodes: [node("scene-dock", "scene", "Dock", { properties: { is_entrance: true } }), node("npc-witness", "npc", "Witness"), node("object-crate", "object", "Crate")],
		claims: [claim("npc-witness", "present-in", "scene-dock"), claim("object-crate", "located-in", "scene-dock"), claim("npc-witness", "knows", "object-crate")],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-dock", "npc-witness"] };
}
const LONG = "an authored fact of the dock, as the reader remembered it from the page, written out at full length here";
/** Seven independent mistakes, all in the records stage, as a fix loop meets them one per submission today. */
function sevenMistakes() {
	const draft = clean();
	draft.nodes[0].visibility = "keeper";
	draft.nodes[1].node_kind = "person";
	draft.nodes[2].name = "  ";
	draft.claims[0].truth_status = LONG;
	draft.claims[1].predicate = "stored-at";
	draft.claims[2].visibility = "private";
	draft.node_refs = ["scene-missing"];
	return draft;
}
const SEVEN = [
	["/nodes/0/visibility", "node_visibility", "keeper", contract.visibility],
	["/nodes/1/node_kind", "node_kind", "person", contract.node_kinds],
	["/nodes/2/name", "node_name", "  ", undefined],
	["/node_refs/0", "node_reference", "scene-missing", undefined],
	["/claims/0/truth_status", "truth_status", LONG.slice(0, 77) + "...", contract.truth_status],
	["/claims/1/predicate", "claim_predicate", "stored-at", contract.relation_kinds],
	["/claims/2/visibility", "claim_visibility", "private", contract.visibility],
];
function assertSeven(error) {
	assert.equal(error.code, "invalid_params");
	// The refusal is the first finding, worded and located as the check always worded it.
	assert.equal(error.message, "node visibility must use the supplied vocabulary");
	assert.equal(error.details.path, "/");
	assert.equal(error.details.reason, "reading_failed");
	const findings = error.details.findings;
	assert.deepEqual(findings.map(finding => [finding.path, finding.rule, finding.value, finding.allowed]), SEVEN);
	assert.equal(findings[0].message, error.message);
	assert.equal(error.details.truncated, undefined);
}

test("the source check returns seven independent mistakes in one call, the first worded as before", async t => {
	assertSeven(await sourceCheck(t, sevenMistakes()));
});

test("module.read.finish refuses a draft with seven independent mistakes once, naming all seven, and publishes nothing", async t => {
	const { kernel, mid, finish } = await claimedOpening(t);
	const before = (await kernel.ok("module.status", { module_id: mid })).generation;
	assertSeven(await finish(sevenMistakes()));
	assert.equal((await kernel.ok("module.status", { module_id: mid })).generation, before, "publication never accepts a draft with findings");
});

test("a later stage runs only when every earlier stage is clean", async t => {
	const finish = draft => sourceCheck(t, draft);
	const draft = clean();
	draft.coverage = { assets: "complete", visual_assets: "accepted" };
	draft.nodes[0].visibility = "keeper";
	draft.dependencies = [{ focus: "Warehouse", question: "What is stored there?" }];
	const envelope = await finish(draft);
	assert.match(envelope.message, /^coverage must be an object mapping domain to status/);
	assert.equal(envelope.details.path, "/coverage");
	assert.deepEqual(envelope.details.findings.map(finding => [finding.path, finding.rule, finding.value]),
		[["/coverage/assets", "coverage_status", "complete"], ["/coverage/visual_assets", "coverage_domain", "visual_assets"]]);
	assert.deepEqual(envelope.details.findings[1].allowed, contract.coverage_domains);
	assert.deepEqual(envelope.details.findings[0].allowed, contract.coverage_status);
	draft.coverage = {};
	const records = await finish(draft);
	assert.deepEqual(records.details.findings.map(finding => finding.rule), ["node_visibility"], "the dependency is a third-stage law and waits");
	delete draft.nodes[0].visibility;
	const graph = await finish(draft);
	assert.equal(graph.message, "resolve the current scope's source dependencies before publication");
	assert.deepEqual(graph.details.findings.map(finding => [finding.path, finding.rule]), [["/dependencies", "dependencies"]]);
});

test("the host's first-batch law is the last law of the third stage, listed with the others", async t => {
	const draft = clean();
	draft.nodes.push(node("scene-warehouse", "scene", "Warehouse"));
	draft.ready_nodes.push("scene-warehouse");
	draft.dependencies = [{ focus: "Warehouse", question: "What is stored there?" }];
	const error = await sourceCheck(t, draft);
	assert.equal(error.message, "resolve the current scope's source dependencies before publication");
	assert.deepEqual(error.details.findings.map(finding => [finding.path, finding.rule]), [["/dependencies", "dependencies"], ["/ready_nodes", "opening_batch"]]);
	assert.match(error.details.findings[1].message, /^An opening batch must prepare exactly the selected first scene/);
});

test("the findings are bounded to 40 entries and 8 KB, with the rest counted", async t => {
	const finish = draft => sourceCheck(t, draft);
	const draft = clean();
	for (let i = 0; i < 45; i++) draft.nodes.push(node(`object-box-${i}`, "object", `Box ${i}`, { visibility: `hidden-${i}` }));
	const error = await finish(draft);
	assert.equal(error.details.findings.length, 40);
	assert.equal(error.details.truncated, 5);
	assert.ok(Buffer.byteLength(JSON.stringify(error.details.findings)) <= 8 * 1024);
	const wide = clean();
	for (let i = 0; i < 39; i++) wide.nodes.push(node(`object-box-${i}`, "object", `Box ${i}`, { visibility: `${"x".repeat(200)}-${i}` }));
	const bounded = await finish(wide);
	assert.ok(bounded.details.findings.length < 39 && bounded.details.findings.length > 0, "the byte bound cuts before the count bound");
	assert.equal(bounded.details.findings.length + bounded.details.truncated, 39);
	assert.ok(Buffer.byteLength(JSON.stringify(bounded.details.findings)) <= 8 * 1024);
	assert.ok(bounded.details.findings.every(finding => Array.from(finding.value).length <= 80), "a written value is clipped to 80 characters");
});

test("the coc-read-check binary prints every finding of the stage in one run", async t => {
	const dir = await mkdtemp(join(tmpdir(), "coc-draft-findings-check-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await write(join(dir, "task.json"), { purpose: "opening", opening_batch: true, module_id: "book-1", source: { page_count: 2 }, known_nodes: [], focus: "Dock" });
	await write(join(dir, "draft.json"), sevenMistakes());
	const run = await promisify(execFile)(join(REPO, "bin/coc-read-check"), ["--packet", join(dir, "task.json"), "--draft", join(dir, "draft.json")]).catch(error => error);
	assert.equal(run.code, 1);
	const printed = JSON.parse(run.stdout);
	assert.equal(printed.ok, false);
	assertSeven(printed.error);
});

async function submitter(t, task, draft) {
	const dir = await mkdtemp(join(tmpdir(), "coc-draft-findings-submit-"));
	t.after(async () => { process.chdir(START); await rm(dir, { recursive: true, force: true }); });
	await write(join(dir, "task.json"), { module_id: "book-1", source: { page_count: 2 }, known_nodes: [], ...task });
	await write(join(dir, "draft.json"), draft);
	process.chdir(dir);
	const handlers = {};
	let tool;
	await readerSubmit({ on(name, fn) { handlers[name] = fn; }, registerTool(value) { tool = value; }, async exec(file, args, options) {
		try { return { ...await promisify(execFile)(file, args, options), code: 0 }; } catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; } } });
	handlers.context({ messages: [{ role: "toolResult", content: [{ type: "image", data: "AA==" }], details: { kind: "source_pages", observations: [{ page: 1 }, { page: 2 }] } }] });
	return { tool, dir };
}

test("submit_reading shows the author every finding with its pointer, value and allowed list, and translates nothing", async t => {
	const { tool, dir } = await submitter(t, { purpose: "opening", opening_batch: true, focus: "Dock" }, sevenMistakes());
	const refused = await tool.execute("seven", {}).then(() => assert.fail("the draft has seven findings"), error => error.message);
	const lines = refused.split("\n");
	assert.match(lines[0], /reading_failed/, "the check's own refusal comes first, as before");
	for (const [i, [path, rule, value, allowed]] of SEVEN.entries()) {
		const line = lines.find(text => text.startsWith(`${i + 1}. ${path} (${rule}): `));
		assert.ok(line, `finding ${i + 1} at ${path} is shown: ${refused}`);
		assert.ok(line.includes(`Written: ${JSON.stringify(value)}.`), line);
		if (allowed) assert.ok(line.includes(`Allowed: ${allowed.map(item => JSON.stringify(item)).join(", ")}.`), line);
	}
	const saved = JSON.parse(await readFile(join(dir, "draft.json"), "utf8"));
	assert.equal(saved.nodes[0].visibility, "keeper", "a value outside the vocabulary is named, never mapped to one inside it");
	assert.equal(saved.claims[2].visibility, "private");
});

test("a verbatim copy of a task field is dropped before the check and listed in the receipt; anything else stays a finding", async t => {
	const task = { purpose: "opening", opening_batch: true, focus: "Dock", question: "Prepare the dock and its witness.", pages: [1, 2] };
	const draft = { ...clean(), task: { focus: task.focus, question: task.question }, focus: task.focus, question: task.question, pages: [1, 2] };
	const { tool, dir } = await submitter(t, task, draft);
	const receipt = await tool.execute("copies", {});
	assert.equal(receipt.terminate, true);
	assert.deepEqual(receipt.details.normalized.map(entry => [entry.path, entry.action]),
		[["/task", "task_field_copy"], ["/focus", "task_field_copy"], ["/question", "task_field_copy"], ["/pages", "task_field_copy"]]);
	const saved = JSON.parse(await readFile(join(dir, "draft.json"), "utf8"));
	assert.deepEqual(["task", "focus", "question", "pages"].filter(key => Object.hasOwn(saved, key)), []);
	// A key that differs from the task field by one byte is the author's, not a copy: the check names it.
	await write(join(dir, "draft.json"), { ...clean(), focus: "Dock.", task: { focus: task.focus, purpose: "detail" } });
	const refused = await tool.execute("not-a-copy", {}).then(() => assert.fail("not a copy"), error => error.message);
	assert.match(refused, /unknown draft keys: \['focus', 'task'\]/);
	assert.match(refused, /1\. \/ \(unknown_key\): .* Written: \["focus","task"\]\./);
});

test("a visual scan's coverage is host-owned: the host writes {} and lists the value it replaced", async t => {
	const asset = node("asset-dock-map", "asset", "Dock map", { properties: { image_sources: [{ page: 1, box: [0, 0, 1, 0.5] }] } });
	const task = { purpose: "detail", focus: "Visual assets on physical page 1", question: "Prepare the visual assets on this nominated original page.",
		visual_asset: { page: 1 }, pages: [1] };
	const draft = { nodes: [asset], claims: [], node_refs: [], coverage: { assets: "accepted" }, dependencies: [], critical: [], ready_nodes: ["asset-dock-map"],
		visual_asset: { page: 1 } };
	const { tool, dir } = await submitter(t, task, draft);
	const receipt = await tool.execute("asset", {});
	assert.equal(receipt.terminate, true);
	assert.deepEqual(receipt.details.normalized, [{ path: "/visual_asset", action: "task_field_copy" }, { path: "/coverage", action: "host_owned", value: { assets: "accepted" } }]);
	assert.deepEqual(JSON.parse(await readFile(join(dir, "draft.json"), "utf8")).coverage, {});
	// Another job kind's coverage stays the author's, judged by the check against the vocabulary.
	const { visual_asset: _asset, ...detailTask } = task, { visual_asset: _copy, ...detailDraft } = draft;
	const other = await submitter(t, detailTask, { ...detailDraft, coverage: { assets: "complete" } });
	const refused = await other.tool.execute("detail", {}).then(() => assert.fail("coverage outside the vocabulary"), error => error.message);
	assert.match(refused, /\/coverage\/assets \(coverage_status\): coverage must be an object mapping domain to status.* Written: "complete"\./);
});
