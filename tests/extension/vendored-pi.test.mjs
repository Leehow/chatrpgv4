/**
 * ADR-0006: Pi is consumed from `vendor/pi` (upstream v0.87.0 plus a reviewed patch series) and
 * exactly one copy of pi-agent-core / pi-coding-agent loads.
 *
 * 1. Admission: every TypeScript source the published 0.87.0 packages were built from (the
 *    `sourcesContent` of the installed `dist/*.js.map`) equals the vendored file byte for byte, unless
 *    the patch series names that file. A snapshot that fails this is not 0.87.0.
 * 2. The build reproduces the published JavaScript: every emitted module whose source the series does
 *    not touch is byte-identical to the published one, so the legacy engine is the same code.
 * 3. The patch series, `PATCHES.md` and the digest the build stamps into the package agree.
 * 4. One copy: the Keeper launch, the reader children and pi-backend's in-process loader all point
 *    into `build/node_modules`, and loading those entries together loads one agent-core and one
 *    coding-agent (module identity of a class compared across entries).
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { PI_ENTRIES, runtimeEntrypoints } from "../../runtime/deployment.mjs";
import { patchSeriesDigest, PI_BASE } from "../../scripts/build-pi.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VENDOR = join(REPO, "vendor/pi");
const BUILT = join(REPO, "build/node_modules/@earendil-works");
const STOCK = join(REPO, "node_modules/@earendil-works");
const PACKAGES = [["pi-agent-core", "agent"], ["pi-coding-agent", "coding-agent"]];

/** `| packages/<pkg>/src/<file> | modified|added | …` rows of PATCHES.md. */
function patchedFiles() {
	const rows = readFileSync(join(VENDOR, "PATCHES.md"), "utf8").split("\n")
		.map((line) => line.match(/^\|\s*`?(packages\/[^|`\s]+)`?\s*\|\s*(modified|added)\s*\|/))
		.filter(Boolean);
	return new Map(rows.map((row) => [row[1], row[2]]));
}

/** The files the ordered patch series touches, read from the patches themselves. */
function seriesFiles() {
	const directory = join(VENDOR, "patches");
	if (!existsSync(directory)) return new Set();
	const touched = new Set();
	for (const name of readdirSync(directory).filter((value) => value.endsWith(".patch")).sort()) {
		for (const line of readFileSync(join(directory, name), "utf8").split("\n")) {
			const match = line.match(/^\+\+\+ b\/vendor\/pi\/(\S+)/);
			if (match) touched.add(match[1]);
		}
	}
	return touched;
}

/** Every published module of one package: its dist path and the source it names, with that source's text. */
function publishedModules(pkg) {
	const dist = join(STOCK, pkg, "dist");
	const out = [];
	for (const map of readdirSync(dist, { recursive: true }).filter((file) => file.endsWith(".js.map") && !file.startsWith("bundle"))) {
		const json = JSON.parse(readFileSync(join(dist, map), "utf8"));
		assert.equal(json.sources.length, 1, `${pkg}/${map} maps one source`);
		const source = relative(join(STOCK, pkg), join(dist, dirname(map), json.sourceRoot ?? "", json.sources[0])).split("\\").join("/");
		out.push({ js: map.slice(0, -".map".length), source, content: json.sourcesContent[0] });
	}
	return out;
}

const withoutMapComment = (text) => text.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, "");

test("admission: the vendored tree is upstream v0.87.0 wherever the patch series does not say otherwise", () => {
	const patched = patchedFiles();
	let compared = 0;
	for (const [pkg, dir] of PACKAGES) {
		for (const module of publishedModules(pkg)) {
			const path = `packages/${dir}/${module.source}`;
			const vendored = readFileSync(join(VENDOR, path), "utf8");
			if (patched.get(path) === "modified") {
				assert.notEqual(vendored, module.content, `${path} is listed as patched but equals upstream: drop it from PATCHES.md`);
				continue;
			}
			assert.equal(vendored, module.content, `${path} differs from the published 0.87.0 source and is not in PATCHES.md`);
			compared++;
		}
	}
	assert.ok(compared > 300, `compared ${compared} published sources`);
	const license = readFileSync(join(VENDOR, "LICENSE"), "utf8");
	assert.match(license, /^MIT License/);
	const vendor = readFileSync(join(VENDOR, "VENDOR.md"), "utf8");
	for (const fact of [PI_BASE.repository, PI_BASE.tag, PI_BASE.commit]) assert.ok(vendor.includes(fact), `VENDOR.md records ${fact}`);
});

test("the patch series, PATCHES.md and the digest in the built package agree", () => {
	const listed = new Set(patchedFiles().keys());
	assert.deepEqual([...seriesFiles()].sort(), [...listed].sort(), "PATCHES.md lists exactly the files the patch series touches");
	for (const [pkg] of PACKAGES) {
		const manifest = JSON.parse(readFileSync(join(BUILT, pkg, "package.json"), "utf8"));
		assert.equal(manifest.version, PI_BASE.version);
		assert.deepEqual(manifest.piCoc.base, PI_BASE);
		assert.equal(manifest.piCoc.patchSeriesDigest, patchSeriesDigest(), `${pkg} was built from the current series (run npm run build:runtime)`);
	}
});

test("the build emits the published JavaScript for every module the series does not touch", () => {
	const patched = patchedFiles();
	let identical = 0;
	for (const [pkg, dir] of PACKAGES) {
		for (const module of publishedModules(pkg)) {
			const built = join(BUILT, pkg, "dist", module.js);
			assert.ok(existsSync(built), `the build emits ${pkg}/dist/${module.js}`);
			if (patched.has(`packages/${dir}/${module.source}`)) continue;
			assert.equal(withoutMapComment(readFileSync(built, "utf8")), withoutMapComment(readFileSync(join(STOCK, pkg, "dist", module.js), "utf8")),
				`${pkg}/dist/${module.js} differs from the published build`);
			identical++;
		}
	}
	assert.ok(identical > 300, `${identical} emitted modules identical to 0.87.0`);
});

test("every Pi entry the product starts or imports is the vendored build", () => {
	const entries = runtimeEntrypoints(REPO);
	assert.equal(entries.pi, join(REPO, PI_ENTRIES.pi));
	assert.equal(entries.piModule, join(REPO, PI_ENTRIES.piModule));
	assert.ok(entries.pi.startsWith(join(BUILT, "pi-coding-agent") + "/"), "Keeper launch and reader children start the vendored CLI");
	const manifest = JSON.parse(readFileSync(join(REPO, "pipicoc/runtime-dependencies.json"), "utf8"));
	assert.equal(manifest.deployment.pi, PI_ENTRIES.pi, "the standalone runtime starts the vendored CLI");
	assert.ok(manifest.buildDirectories.includes("node_modules"), "the standalone runtime carries build/node_modules");
});

test("one agent-core and one coding-agent load across the Keeper, an emitted extension and pi-backend's in-process import", () => {
	const entries = runtimeEntrypoints(REPO);
	// A child with a load hook: every module URL of either package that is actually loaded is recorded.
	const probe = `
import {registerHooks} from 'node:module';
const loaded = new Set();
registerHooks({load(url, context, next) { if (/@earendil-works\\/pi-(agent-core|coding-agent)\\//.test(url)) loaded.add(url); return next(url, context); }});
const backend = await import(${JSON.stringify(pathToFileURL(entries.piModule).href)});
await import(${JSON.stringify(pathToFileURL(join(dirname(entries.pi), "main.js")).href)});
await import(${JSON.stringify(pathToFileURL(join(REPO, "build/extensions/kernel/index.mjs")).href)});
const session = await import(${JSON.stringify(pathToFileURL(join(dirname(entries.pi), "core/agent-session.js")).href)});
const agentCore = await import(${JSON.stringify(pathToFileURL(join(BUILT, "pi-agent-core/dist/index.js")).href)});
// pi-backend's in-process copy builds a session; its agent must be an instance of the agent-core class
// the vendored build resolves, which is the module identity the Keeper's session runs on.
const {mkdtempSync} = await import('node:fs'); const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
const home = mkdtempSync(join(tmpdir(), 'vendored-pi-identity-'));
const modelRuntime = await backend.ModelRuntime.create({authPath: join(home, 'auth.json'), modelsPath: null, modelsStorePath: join(home, 'models.json'), refreshOnCreate: false});
const created = await backend.createAgentSession({cwd: home, agentDir: join(home, 'agent'), modelRuntime, noTools: 'builtin',
  sessionManager: backend.SessionManager.inMemory(), settingsManager: backend.SettingsManager.inMemory({compaction: {enabled: false}})});
const roots = [...new Set([...loaded].map(url => url.replace(/(@earendil-works.pi-(?:agent-core|coding-agent)).dist.*$/, '$1')))];
console.log(JSON.stringify({roots, sameSession: backend.AgentSession === session.AgentSession && created.session instanceof session.AgentSession,
  sameAgent: created.session.agent instanceof agentCore.Agent}));
created.session.dispose();
`;
	const output = execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: REPO, encoding: "utf8" });
	const result = JSON.parse(output.trim().split("\n").at(-1));
	assert.deepEqual(result.roots.map((url) => fileURLToPath(url)).sort(),
		[join(BUILT, "pi-agent-core"), join(BUILT, "pi-coding-agent")].sort(), "only the vendored packages load");
	assert.equal(result.sameSession, true, "pi-backend's AgentSession is the Keeper's AgentSession");
	assert.equal(result.sameAgent, true, "the session's Agent is the vendored agent-core's Agent class");
});
