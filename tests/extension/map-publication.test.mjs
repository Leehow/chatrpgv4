import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ReadingService } from "../../extensions/module/reading-service.ts";
import { reviewUnits } from "../../extensions/module/reader-review.ts";
import { publishableAssetNodes, validateMapRegions } from "../../extensions/module/map-publication.ts";
import { renderMapView } from "../../extensions/kernel/map-view.ts";
import { KernelError } from "../../extensions/kernel/client.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const MAP_QUESTION = "prepare independently revealable map regions for arrival";
const WHOLE_MAP_MISSING = "source shows separately knowable barn and house; a whole-map region is not an independent reveal unit";

function mapPdf() {
	const streams = [
		"1 0 0 rg 0 0 100 100 re f 0 0 1 rg 100 0 100 100 re f",
		"0 0.6 0 rg 0 0 200 100 re f 1 1 0 rg 20 20 40 40 re f",
	];
	const pages = streams.map((stream, index) => {
		const page = 3 + index * 2, content = page + 1;
		return { page, content, stream };
	});
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${pages.map(row => `${row.page} 0 R`).join(" ")}] /Count ${streams.length} >>`,
		...pages.flatMap(row => [
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents ${row.content} 0 R >>`,
			`<< /Length ${row.stream.length} >>\nstream\n${row.stream}\nendstream`,
		]),
	];
	let text = "%PDF-1.7\n";
	const offsets = [0];
	for (let i = 0; i < objects.length; i++) {
		offsets.push(Buffer.byteLength(text));
		text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
	}
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	text += `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return text;
}

function farmDraft({ whole = false, secret = true } = {}) {
	const regions = whole
		? [{ region_id: "farm", name: "Farm", source_asset: "player-farm", source_box: [0, 0, 1, 1], placement: [0, 0, 1, 1] }]
		: [
			{ region_id: "barn", name: "Barn", source_asset: "player-farm", source_box: [0, 0, 0.5, 1], placement: [0, 0, 0.5, 1] },
			{ region_id: "house", name: "Farmhouse", source_asset: "player-farm", source_box: [0.5, 0, 1, 1], placement: [0.5, 0, 1, 1] },
		];
	if (secret && !whole) regions.push({
		region_id: "cellar", name: "Cellar", source_asset: "keeper-farm",
		source_box: [0, 0, 1, 1], placement: [0.25, 0.25, 0.75, 0.75],
		redactions: [[0.1, 0.1, 0.4, 0.4]], safe_after_redactions: true,
	});
	const player = { node_id: "asset-player-farm", node_kind: "asset", name: "Farm plan", visibility: "player-safe",
		source_refs: [{ page: 1 }], properties: { image_sources: [{ page: 1, box: [0, 0, 1, 1] }], map_regions: regions } };
	const keeper = { node_id: "asset-keeper-farm", node_kind: "asset", name: "Keeper farm", visibility: "keeper-only",
		source_refs: [{ page: 2 }], properties: { image_sources: [{ page: 2, box: [0, 0, 1, 1] }] } };
	const nodes = secret ? [player, keeper] : [player];
	return { nodes, claims: [], dependencies: [], critical: [], ready_nodes: nodes.map(node => node.node_id), coverage: {} };
}

async function countColors(pathOrData) {
	const buffer = pathOrData.startsWith?.("data:image/png;base64,")
		? Buffer.from(pathOrData.split(",")[1], "base64")
		: await readFile(pathOrData);
	const image = await loadImage(buffer);
	const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0);
	const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
	let red = 0, blue = 0, green = 0, yellow = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
		if (r > 200 && g < 40 && b < 40) red++;
		else if (b > 200 && r < 40 && g < 40) blue++;
		else if (g > 120 && r < 40 && b < 40) green++;
		else if (r > 200 && g > 200 && b < 40) yellow++;
	}
	return { red, blue, green, yellow };
}

async function seePages(request, cache, fileSha, pages) {
	const call = `pages-${pages.join("-")}`;
	for (const page of pages)
		await appendFile(join(cache, "requests.jsonl"), JSON.stringify({ file_sha256: fileSha, path: join(cache, `page-${page}.png`), page, box: [0, 0, 1, 1] }) + "\n");
	request.onEvent?.({ type: "tool_execution_end", toolCallId: call, isError: false,
		result: { content: [{ type: "image" }], details: { kind: "source_pages", observations: pages.map(page => ({ path: join(cache, `page-${page}.png`), page })) } } });
	await writeFile(request.eventLog + ".images.jsonl", JSON.stringify({ included: [call] }) + "\n");
}

async function runMapJob(t, { jobId = "read-2", focus = "farm", question = MAP_QUESTION, knownNodes, resumeFrom, whole = false, rejectReview = false, rejectFinish = false }) {
	const home = await mkdtemp(join(tmpdir(), "coc-map-pub-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const moduleDir = join(home, ".coc", "modules", "book");
	await mkdir(moduleDir, { recursive: true });
	const pdfPath = join(moduleDir, "source.pdf");
	await writeFile(pdfPath, mapPdf());
	const fileSha = createHash("sha256").update(await readFile(pdfPath)).digest("hex");
	const cwd = join(home, "work", jobId, "attempt-1");
	const cache = join(moduleDir, "cache", "pages");
	await mkdir(cwd, { recursive: true });
	await mkdir(cache, { recursive: true });
	const tasks = [], briefs = [], finishes = [];
	const runtime = {
		contentRoot: join(ROOT, "content"),
		async runTask({ request }) {
			const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
			if (request.prompt.phase === "read") {
				tasks.push(task);
				await writeFile(join(request.cwd, "draft.json"), JSON.stringify(farmDraft({ whole })) + "\n");
				await seePages(request, cache, fileSha, whole ? [1] : [1, 2]);
				return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
			}
			briefs.push(request.brief);
			const pages = request.prompt.phase === "verify" && task.review_scope_pages?.length ? task.review_scope_pages : [1];
			const missing = rejectReview && task.required_review.includes("/coverage") ? [WHOLE_MAP_MISSING] : [];
			await writeFile(join(request.cwd, "review.json"), JSON.stringify({
				checked: [{ paths: task.required_review, verdict: missing.length ? "unclear" : "supported",
					source_refs: pages.map(page => ({ page })), reason: missing.length ? "Whole-map region is not enough for arrival." : "Compared this assigned map scope." }],
				missing,
			}) + "\n");
			await seePages(request, cache, fileSha, pages);
			return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
		},
		async check() { return { ok: true }; },
		async sourceInfo() { throw new Error("not a guidance job"); },
	};
	const service = new ReadingService({ home, runtime, model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }),
		progress() {}, record() {}, async call(method, params) {
			assert.equal(method, "module.read.finish");
			finishes.push(params);
			if (params.outcome === "completed" && (rejectFinish || rejectReview))
				throw new KernelError({ code: "invalid_params", message: `the independent review found missing or incorrect material: ${WHOLE_MAP_MISSING}` });
			return { state: params.outcome === "completed" ? "ready" : params.outcome };
		} });
	t.after(() => service.close());
	await service.runJob({
		job_id: jobId, module_id: "book", purpose: "detail", material: "map", focus, question, key: `${focus}:${question}`,
		foreground: true, lease: "lease-1", work_dir: cwd, resume_from: resumeFrom,
		source: { path: pdfPath, page_count: 2, file_sha256: fileSha },
		index: {}, known_nodes: knownNodes ?? [{ node_id: "scene-opening", node_kind: "scene", name: "Opening", ready: true }],
		known_claims: [], vocabulary: {}, coverage_domains: [],
	}, new AbortController().signal);
	return { home, cwd, cache, pdfPath, fileSha, tasks, briefs, finishes };
}

test("map region geometry, unique reveal boxes and private-source correspondence are checked before publication", () => {
	const ok = farmDraft();
	assert.doesNotThrow(() => validateMapRegions(ok));
	const duplicate = farmDraft();
	duplicate.nodes[0].properties.map_regions[1].source_box = [0, 0, 0.5, 1];
	assert.throws(() => validateMapRegions(duplicate), /distinct source_box/);
	const privateLeak = farmDraft();
	privateLeak.nodes[0].properties.map_regions[2].redactions = [];
	assert.throws(() => validateMapRegions(privateLeak), /private source without reviewed redactions/);
	const badBox = farmDraft({ secret: false });
	badBox.nodes[0].properties.map_regions[0].source_box = [0, 0, 2, 1];
	assert.throws(() => validateMapRegions(badBox), /box must be/);
	const opening = farmDraft();
	opening.ready_nodes = ["asset-player-farm"];
	assert.deepEqual(publishableAssetNodes(opening, "opening").map(node => node.node_id), ["asset-player-farm", "asset-keeper-farm"]);
	const unread = farmDraft();
	unread.nodes.push({ node_id: "asset-later-map", node_kind: "asset", name: "Later", visibility: "player-safe",
		source_refs: [{ page: 1 }], properties: { image_sources: [{ page: 1 }] } });
	unread.ready_nodes = ["asset-player-farm"];
	assert.equal(publishableAssetNodes(unread, "opening").some(node => node.node_id === "asset-later-map"), false);
});

test("map_regions are assigned as a review unit with independently revealable-unit instructions", async t => {
	const draft = farmDraft({ secret: false });
	const paths = reviewUnits(draft).flat();
	assert.ok(paths.includes("/nodes/0/properties/map_regions"));
	assert.ok(paths.includes("/coverage"));
	const cwd = await mkdtemp(join(tmpdir(), "coc-map-review-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const { reviewCandidate } = await import("../../extensions/module/reader-review.ts");
	const briefs = [];
	await reviewCandidate({
		cwd, task: { purpose: "detail", focus: "farm", question: MAP_QUESTION, review_scope_pages: [1] },
		draft, instructions: "unused", round: 1, model: { id: "fixture/vision" }, source: { pdf: "unused", cache: "unused" },
		signal: new AbortController().signal, record() {}, progress() {},
		async run(request) {
			briefs.push(request.brief);
			const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
			const pages = task.review_scope_pages?.length ? task.review_scope_pages : [1];
			request.onEvent({ type: "tool_execution_end", toolCallId: "pages", isError: false,
				result: { details: { kind: "source_pages", observations: pages.map(page => ({ page })) } } });
			await writeFile(request.eventLog + ".images.jsonl", JSON.stringify({ included: ["pages"] }) + "\n");
			await writeFile(join(request.cwd, "review.json"), JSON.stringify({
				checked: [{ paths: task.required_review, verdict: "supported", source_refs: pages.map(page => ({ page })), reason: "Compared this assigned map scope." }],
				missing: [],
			}));
			return { ok: true, ms: 1, stderr: "" };
		},
	});
	assert.ok(briefs.some(brief => brief.includes("independently revealable units")));
	assert.ok(briefs.some(brief => brief.includes(MAP_QUESTION)));
});

test("a focused map detail request selects its own task after opening instead of inheriting another job", async t => {
	const home = await mkdtemp(join(tmpdir(), "coc-map-scope-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const moduleDir = join(home, ".coc", "modules", "book");
	await mkdir(moduleDir, { recursive: true });
	const pdfPath = join(moduleDir, "source.pdf");
	await writeFile(pdfPath, mapPdf());
	const fileSha = createHash("sha256").update(await readFile(pdfPath)).digest("hex");
	const failed = join(home, "work", "read-1", "attempt-1");
	const cwd = join(home, "work", "read-2", "attempt-1");
	const cache = join(moduleDir, "cache", "pages");
	await mkdir(failed, { recursive: true });
	await mkdir(cwd, { recursive: true });
	await mkdir(cache, { recursive: true });
	await writeFile(join(failed, "draft.json"), JSON.stringify(farmDraft({ whole: true })) + "\n");
	await writeFile(join(failed, "findings.json"), JSON.stringify({ error: WHOLE_MAP_MISSING }) + "\n");
	const requests = [], finishes = [];
	let claim = "idle";
	const runtime = {
		contentRoot: join(ROOT, "content"),
		async runTask({ request }) {
			const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
			if (request.prompt.phase === "read") {
				await writeFile(join(request.cwd, "draft.json"), JSON.stringify(farmDraft()) + "\n");
				await seePages(request, cache, fileSha, [1, 2]);
				return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
			}
			const pages = task.review_scope_pages?.length ? task.review_scope_pages : [1];
			await writeFile(join(request.cwd, "review.json"), JSON.stringify({
				checked: [{ paths: task.required_review, verdict: "supported", source_refs: pages.map(page => ({ page })), reason: "Compared this assigned map scope." }],
				missing: [],
			}) + "\n");
			await seePages(request, cache, fileSha, pages);
			return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
		},
		async check() { return { ok: true }; },
		async sourceInfo() { throw new Error("not a guidance job"); },
	};
	const service = new ReadingService({ home, runtime, model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }),
		progress() {}, record() {}, async call(method, params) {
			if (method === "module.read.request") {
				requests.push({ purpose: params.purpose, ...(params.material ? { material: params.material } : {}), focus: params.focus ?? "", question: params.question ?? "", retry: params.retry === true });
				if (params.purpose === "opening") return { state: "ready", opening_ready: true };
				if (claim === "done") return { state: "ready" };
				if (claim === "idle") claim = "pending";
				return { state: "queued", job_id: "read-2" };
			}
			if (method === "module.read.claim") {
				if (claim !== "pending") return { job_id: null };
				claim = "running";
				return {
					job_id: "read-2", module_id: "book", purpose: "detail", material: "map", focus: "farm", question: MAP_QUESTION,
					key: "focused-map", foreground: true, lease: "lease-2", work_dir: cwd,
					source: { path: pdfPath, page_count: 2, file_sha256: fileSha },
					index: {}, known_nodes: [{ node_id: "scene-opening", node_kind: "scene", name: "Opening", ready: true }],
					known_claims: [], vocabulary: {}, coverage_domains: [],
				};
			}
			if (method === "module.read.finish") {
				finishes.push(params);
				if (params.outcome === "completed") claim = "done";
				return { state: params.outcome === "completed" ? "ready" : params.outcome };
			}
			throw new Error(`unexpected ${method}`);
		} });
	t.after(() => service.close());
	assert.equal((await service.ensure("book", { purpose: "opening", foreground: true })).opening_ready, true);
	await service.ensure("book", { purpose: "detail", material: "map", focus: "farm", question: MAP_QUESTION, foreground: true });
	assert.deepEqual(requests[0], { purpose: "opening", focus: "", question: "", retry: false });
	assert.equal(requests[1].purpose, "detail");
	assert.equal(requests[1].material, "map");
	assert.equal(requests[1].focus, "farm");
	assert.equal(requests[1].question, MAP_QUESTION);
	const task = JSON.parse(await readFile(join(cwd, "task.json"), "utf8"));
	assert.equal(task.purpose, "detail");
	assert.equal(task.material, "map");
	assert.equal(task.focus, "farm");
	assert.equal(task.question, MAP_QUESTION);
	assert.deepEqual(task.known_nodes.map(node => node.node_id), ["scene-opening"]);
	assert.equal("repair" in task, false);
	assert.equal(JSON.parse(await readFile(join(cwd, "read-complete.json"), "utf8")).job_id, "read-2");
	assert.deepEqual(JSON.parse(await readFile(join(failed, "draft.json"), "utf8")).nodes[0].properties.map_regions.map(region => region.region_id), ["farm"]);
	assert.ok(finishes.some(row => row.outcome === "completed" && row.assets?.some(asset => asset.node_id === "asset-player-farm")));
});

test("independently revealable regions publish source-backed crops the conversation viewer can show separately", async t => {
	const result = await runMapJob(t, {});
	const completed = result.finishes.find(row => row.outcome === "completed");
	assert.ok(completed, "focused map publication must complete");
	assert.deepEqual(completed.assets.map(asset => asset.node_id).sort(), ["asset-keeper-farm", "asset-player-farm"]);
	const draft = JSON.parse(await readFile(join(result.cwd, "draft.json"), "utf8"));
	assert.deepEqual(draft.nodes[0].properties.map_regions.map(region => region.region_id), ["barn", "house", "cellar"]);
	const player = completed.assets.find(asset => asset.node_id === "asset-player-farm");
	const barn = await renderMapView({
		map: "farm", name: "Farm", source_revision: "g1",
		regions: [{ id: "barn", label: "Barn" }],
		render: { layers: [{ path: player.path, source_box: [0, 0, 0.5, 1], placement: [0, 0, 0.5, 1], redactions: [] }] },
	}, { modulesRoot: result.cwd, campaignDir: join(result.home, ".coc", "campaigns", "c1") });
	assert.equal(barn.available, true);
	const pixels = await countColors(barn.image);
	assert.ok(pixels.red > 0);
	assert.equal(pixels.blue, 0);
	assert.equal(pixels.green, 0);
});

test("review rejection of a whole-map region stays unavailable and preserves the failed artifacts", async t => {
	const result = await runMapJob(t, { whole: true, rejectReview: true });
	assert.equal(result.finishes.at(-1).outcome, "failed");
	assert.ok(result.finishes.some(row => row.outcome === "completed"), "rejected publication still goes through the existing finish gate");
	const draft = JSON.parse(await readFile(join(result.cwd, "draft.json"), "utf8"));
	assert.deepEqual(draft.nodes[0].properties.map_regions.map(region => region.region_id), ["farm"]);
	const findings = JSON.parse(await readFile(join(result.cwd, "findings.json"), "utf8"));
	assert.match(JSON.stringify(findings), /whole-map region/);
	const review = JSON.parse(await readFile(join(result.cwd, "review.json"), "utf8"));
	assert.ok(review.missing.includes(WHOLE_MAP_MISSING));
	assert.ok(result.briefs.some(brief => brief.includes("independently revealable units")));
});

test("published player assets keep source identity and normalized boxes and contain no private bytes", async t => {
	const result = await runMapJob(t, {});
	const completed = result.finishes.find(row => row.outcome === "completed");
	const player = completed.assets.find(asset => asset.node_id === "asset-player-farm");
	const keeper = completed.assets.find(asset => asset.node_id === "asset-keeper-farm");
	assert.equal(createHash("sha256").update(await readFile(player.path)).digest("hex"), player.sha256);
	assert.equal(player.media_type, "image/png");
	const draft = JSON.parse(await readFile(join(result.cwd, "draft.json"), "utf8"));
	for (const region of draft.nodes[0].properties.map_regions) {
		for (const box of [region.source_box, region.placement, ...(region.redactions ?? [])]) {
			assert.equal(box.length, 4);
			assert.ok(box.every(value => value >= 0 && value <= 1));
			assert.ok(box[2] > box[0] && box[3] > box[1]);
		}
	}
	assert.deepEqual(draft.nodes[0].properties.image_sources[0], { page: 1, box: [0, 0, 1, 1] });
	const publicPixels = await countColors(player.path);
	assert.ok(publicPixels.red > 0 && publicPixels.blue > 0);
	assert.equal(publicPixels.green, 0);
	assert.equal(publicPixels.yellow, 0);
	const privatePixels = await countColors(keeper.path);
	assert.ok(privatePixels.green > 0);
	assert.ok(privatePixels.yellow > 0);
});
