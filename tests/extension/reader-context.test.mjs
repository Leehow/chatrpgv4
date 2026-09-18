import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readerContext, { boundImages, confineReaderEnvironment, createReaderToolGuard } from "../../extensions/module/reader-context.ts";

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function confinementFixture(t, options = {}) {
	const home = await mkdtemp(join(tmpdir(), "reader-confinement-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	// A campaign-scoped read owns a private module workspace; a library read uses the shared one.
	const module = options.campaign
		? join(home, ".coc", "module-campaigns", options.campaign, "modules", "book")
		: join(home, ".coc", "modules", "book");
	const cwd = join(module, "work", "read-1", "attempt-1");
	const cache = join(module, "cache", "pages");
	const source = join(module, "source.pdf");
	const outside = await mkdtemp(join(tmpdir(), "reader-outside-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	await mkdir(join(cwd, "host-bin"), { recursive: true });
	await mkdir(join(home, ".coc", "modules"), { recursive: true });
	if (!options.withoutCache) await mkdir(cache, { recursive: true });
	await writeFile(source, "%PDF-1.7\n");
	for (const name of ["draft.json", "baseline.json", "findings.json", "review.json"])
		await writeFile(join(cwd, name), "{}\n");
	await writeFile(join(outside, "secret.txt"), "outside\n");
	await symlink(join(outside, "secret.txt"), join(cwd, "escape.txt"));
	await symlink(outside, join(cwd, "escape-dir"));
	const checker = `coc-read-check --packet ${quote(join(cwd, "task.json"))} --draft ${quote(join(cwd, "draft.json"))}`;
	await writeFile(join(cwd, "task.json"), JSON.stringify({ commands: { check: checker } }) + "\n");
	await writeFile(join(cwd, "packet.json"), "{}\n");
	const wrapper = join(cwd, "host-bin", "coc-read-check");
	await writeFile(wrapper, "#!/bin/sh\nexit 0\n");
	const env = { PI_COC_HOME: home, PI_COC_READER_SOURCE: JSON.stringify({ pdf: source, cache }),
		PI_COC_READER_CHECK: wrapper, PATH: `${join(cwd, "host-bin")}:/usr/bin:/bin`, HOME: "/Users/example" };
	return { home, module, cwd, cache, source, outside, checker, wrapper, env };
}

test("the reader blocks read-6 shell traversal before execution and permits only the captured checker", async t => {
	const fixture = await confinementFixture(t), guard = createReaderToolGuard(fixture.cwd, fixture.env);
	let executed = 0;
	const run = event => { const result = guard(event); if (!result?.block) executed++; return result; };
	for (const command of [
		"find / -maxdepth 8 -type f",
		"cd /Applications/PipiCOC.app/Contents/Resources/pi-coc && find .",
		"python3 -c 'print(1)'",
		"cat ~/Documents/secret.txt",
		`${fixture.checker}; find / -maxdepth 8`,
	]) assert.match(run({ toolName: "bash", input: { command } }).reason, /Reader confinement blocked bash/);
	assert.equal(executed, 0);
	assert.equal(run({ toolName: "bash", input: { command: fixture.checker } }), undefined);
	assert.equal(executed, 1);
	await writeFile(fixture.wrapper, "#!/bin/sh\nfind /\n");
	assert.match(run({ toolName: "bash", input: { command: fixture.checker } }).reason, /unchanged host-generated/);
	assert.equal(executed, 1);
});

test("read/write/edit stay in the task and bound source cache across traversal and symlink attempts", async t => {
	const fixture = await confinementFixture(t), guard = createReaderToolGuard(fixture.cwd, fixture.env);
	for (const path of ["/Applications/PipiCOC.app/Contents/Resources/pi-coc/content", "../../../../../../../../etc/passwd",
		join(fixture.outside, "secret.txt"), "escape.txt", "@/etc/passwd", "~/Documents/secret.txt"])
		assert.match(guard({ toolName: "read", input: { path } }).reason, /blocked read/);
	for (const path of ["../outside.json", join(fixture.outside, "new.json"), "escape.txt", "escape-dir/new.json"])
		for (const toolName of ["write", "edit"])
			assert.match(guard({ toolName, input: { path } }).reason, new RegExp(`blocked ${toolName}`));
	for (const path of ["task.json", "packet.json", "baseline.json", "findings.json", "observations.json", "read-complete.json", "review-input.json", "host-bin/coc-read-check"])
		assert.match(guard({ toolName: "write", input: { path } }).reason, /host-owned/);
	for (const path of ["task.json", "draft.json", "baseline.json", "findings.json", "review.json", fixture.source])
		assert.equal(guard({ toolName: "read", input: { path } }), undefined);
	const page = join(fixture.cache, "page-4.jpg");
	await writeFile(page, "image");
	assert.equal(guard({ toolName: "read", input: { path: page } }), undefined);
	for (const [toolName, path] of [["write", "draft.json"], ["write", "notes/source.json"], ["edit", "review.json"]])
		assert.equal(guard({ toolName, input: { path } }), undefined);
	assert.equal(guard({ toolName: "pdf", input: { pages: [4] } }), undefined);
});

test("an externally rebound PDF or cache fails closed before the private pdf tool runs", async t => {
	const fixture = await confinementFixture(t);
	const guard = createReaderToolGuard(fixture.cwd, {...fixture.env,
		PI_COC_READER_SOURCE: JSON.stringify({pdf:join(fixture.outside,"secret.txt"),cache:fixture.cache})});
	assert.match(guard({toolName:"pdf",input:{pages:[1]}}).reason, /blocked pdf/);
	assert.match(guard({toolName:"read",input:{path:"task.json"}}).reason, /does not match one internal module/);
	const guardUnparseable = createReaderToolGuard(fixture.cwd, {...fixture.env, PI_COC_READER_SOURCE: "{"});
	assert.match(guardUnparseable({toolName:"read",input:{path:"task.json"}}).reason, /PI_COC_READER_SOURCE is invalid/);
});

test("a campaign's private module workspace is an internal source, not an escape", async t => {
	const fixture = await confinementFixture(t, { campaign: "game-3dd94f0a" });
	const guard = createReaderToolGuard(fixture.cwd, fixture.env);
	// The PDF lives under .coc/module-campaigns/<campaign>/modules/book, never under .coc/modules.
	assert.equal(guard({ toolName: "pdf", input: { pages: [4] } }), undefined);
	assert.equal(guard({ toolName: "read", input: { path: fixture.source } }), undefined);
	const page = join(fixture.cache, "page-4.jpg");
	await writeFile(page, "image");
	assert.equal(guard({ toolName: "read", input: { path: page } }), undefined);
	assert.equal(guard({ toolName: "read", input: { path: "task.json" } }), undefined);
});

test("a private module PDF paired with another workspace's page cache fails closed", async t => {
	const fixture = await confinementFixture(t, { campaign: "game-3dd94f0a" });
	const library = join(fixture.home, ".coc", "modules", "book", "cache", "pages");
	await mkdir(library, { recursive: true });
	const guard = createReaderToolGuard(fixture.cwd, { ...fixture.env,
		PI_COC_READER_SOURCE: JSON.stringify({ pdf: fixture.source, cache: library }) });
	assert.match(guard({ toolName: "pdf", input: { pages: [1] } }).reason, /blocked pdf/);
	assert.match(guard({ toolName: "read", input: { path: "task.json" } }).reason,
		/does not match one internal module/);
});

test("a freshly seeded workspace whose page cache is not rendered yet still binds its source", async t => {
	const fixture = await confinementFixture(t, { campaign: "game-3dd94f0a", withoutCache: true });
	const guard = createReaderToolGuard(fixture.cwd, fixture.env);
	// The cache is a derived directory the first page render creates; its absence is not a
	// broken binding, and must not be reported as an invalid PI_COC_READER_SOURCE.
	assert.equal(guard({ toolName: "pdf", input: { pages: [1] } }), undefined);
	assert.equal(guard({ toolName: "read", input: { path: "task.json" } }), undefined);
});

test("a source outside every module workspace is still refused", async t => {
	const fixture = await confinementFixture(t, { campaign: "game-3dd94f0a" });
	const stray = join(fixture.home, ".coc", "module-campaigns", "game-3dd94f0a", "source.pdf");
	await writeFile(stray, "%PDF-1.7\n");
	const guard = createReaderToolGuard(fixture.cwd, { ...fixture.env,
		PI_COC_READER_SOURCE: JSON.stringify({ pdf: stray, cache: fixture.cache }) });
	assert.match(guard({ toolName: "pdf", input: { pages: [1] } }).reason, /blocked pdf/);
});

test("the extension installs the guard and confines shell startup environment without breaking the agent home", async t => {
	const fixture = await confinementFixture(t);
	const handlers = new Map();
	const env = {...fixture.env, BASH_ENV: "/Users/example/.bashrc", ENV: "/Users/example/.profile", CDPATH: "/Users/example",
		PI_CODING_AGENT_DIR: join(fixture.home, "agent") };
	readerContext({ on(name, handler) { handlers.set(name, handler); } }, {cwd:fixture.cwd,env});
	assert.equal(env.HOME, fixture.cwd);
	assert.equal(env.BASH_ENV, undefined);
	assert.equal(env.ENV, undefined);
	assert.equal(env.CDPATH, undefined);
	assert.equal(env.PI_CODING_AGENT_DIR, join(fixture.home, "agent"));
	assert.match(handlers.get("tool_call")({ toolName: "bash", input: { command: "find /" } }).reason, /blocked bash/);
	assert.equal(handlers.get("tool_call")({ toolName: "bash", input: { command: fixture.checker } }), undefined);
});

test("non-PDF tool-enabled lanes keep their existing tools and environment", () => {
	const handlers = new Map(), env = { HOME: "/Users/example", BASH_ENV: "/Users/example/.bashrc" };
	readerContext({ on(name, handler) { handlers.set(name, handler); } }, {cwd:"/unused",env});
	assert.equal(handlers.has("tool_call"), false);
	assert.equal(env.HOME, "/Users/example");
	assert.equal(env.BASH_ENV, "/Users/example/.bashrc");
});

test("all new images reach the model before historical eviction", () => {
	const image = { type: "image", mimeType: "image/png", data: Buffer.alloc(100).toString("base64") };
	const original = Array.from({ length: 6 }, (_, i) => ({ role: "toolResult", toolCallId: `read-${i}`, content: [{ type: "text", text: `page ${i}` }, image] }));
	const result = boundImages(original, new Set(["read-0"]), 250, 4);
	assert.deepEqual(result.included, ["read-5", "read-4", "read-3", "read-2", "read-1"]);
	assert.equal(result.bytes, 500);
	assert.match(result.messages[0].content[1].text, /Earlier page/);
	assert.equal(result.messages[1].content[1].type, "image");
	const later = boundImages(original, new Set(original.map(m => m.toolCallId)), 250, 4);
	assert.deepEqual(later.included, ["read-5", "read-4"]);
	assert.ok(original.every(m => m.content[1].type === "image"));
	assert.deepEqual(result.messages.map(m => m.toolCallId), original.map(m => m.toolCallId));
});

test("the newest image remains available even if it alone exceeds the soft budget", () => {
	const result = boundImages([{ role: "toolResult", toolCallId: "new", content: [{ type: "image", data: Buffer.alloc(300).toString("base64") }] }], new Set(), 100);
	assert.deepEqual(result.included, ["new"]);
});

test("a host-owned provider request ceiling aborts before an extra model call", () => {
	const previous = process.env.PI_COC_READER_MAX_REQUESTS;
	process.env.PI_COC_READER_MAX_REQUESTS = "1";
	try {
		const hooks = {};
		readerContext({on(name, fn) { hooks[name] = fn; }});
		let aborted = 0;
		hooks.before_provider_request({}, {abort() { aborted++; }});
		assert.throws(() => hooks.before_provider_request({}, {abort() { aborted++; }}), /1-request limit/);
		assert.equal(aborted, 1);
	} finally {
		if (previous == null) delete process.env.PI_COC_READER_MAX_REQUESTS;
		else process.env.PI_COC_READER_MAX_REQUESTS = previous;
	}
});
