import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createPackageRecipe } from "../../pipicoc/package-config.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CANONICAL_PRODUCT = join(REPO, "pipicoc", "product.json");
const ELECTRON_PRODUCT = join(REPO, "Electron", "product.json");
const ELECTRON_APP = join(REPO, "Electron", "apps", "electron");
const product = readJson(CANONICAL_PRODUCT);
const rootPackage = readJson(join(REPO, "package.json"));
const inputs = { repo: REPO, stage: join(REPO, ".build.noindex/pipicoc/recipe-test"), product, version: rootPackage.version, userHome: "/recipe-user" };

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

// These child tests may read modules, but may never create staging or start build/download work.
function sandbox(t) {
	const root = mkdtempSync(join(tmpdir(), "pipicoc-recipe-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const preload = join(root, "no-side-effects.mjs");
	writeFileSync(preload, `
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const forbid = name => () => { throw new Error('Forbidden side effect: ' + name); };
for (const name of ['mkdir', 'mkdtemp', 'writeFile', 'appendFile', 'copyFile', 'cp', 'rename', 'rm', 'unlink', 'symlink', 'chmod']) {
  fs[name] = forbid(name);
  fs[name + 'Sync'] = forbid(name + 'Sync');
  fsp[name] = forbid(name);
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = forbid(name);
for (const mod of [http, https]) for (const name of ['request', 'get']) mod[name] = forbid(name);
globalThis.fetch = forbid('fetch');
syncBuiltinESMExports();
`);
	return { root, preload };
}

test("the canonical product identity is the only hand-written PipiCOC source", () => {
	assert.deepEqual(product, {
		id: "pipicoc",
		name: "PipiCOC",
		appId: "com.leehow.pipicoc",
		userDataDirname: "Pipi/pipicoc",
		sharedCredentialsDir: "@pipiui/electron/pi-agent",
		icon: "pipicoc.png",
		defaultPack: "coc-keeper",
		agentMaxDepth: 0,
	});
	assert.equal(existsSync(ELECTRON_PRODUCT), false, "Electron/product.json must not become a second hand-written product source");
	assert.equal(Object.hasOwn(product, "version"), false);
});

test("Electron packaged resources point at the canonical product identity", () => {
	const packageJson = readJson(join(ELECTRON_APP, "package.json"));
	const productResources = packageJson.build.extraResources.filter((entry) => entry.to === "product.json");
	assert.equal(productResources.length, 1, "exactly one packaged product.json resource is shipped");
	const [resource] = productResources;
	assert.equal(resolve(ELECTRON_APP, resource.from), CANONICAL_PRODUCT);
});

test("the production recipe derives identity, icons and both bundle names from the canonical manifest", () => {
	const { config } = createPackageRecipe(inputs);
	assert.equal(config.appId, product.appId);
	assert.equal(config.productName, product.name);
	assert.deepEqual(config.mac.extendInfo, { CFBundleDisplayName: product.name, CFBundleName: product.name });
	assert.equal(config.mac.icon, join(REPO, "pipicoc/pipicoc.icns"));
	assert.ok(existsSync(config.mac.icon));
	const renamed = createPackageRecipe({ ...inputs, product: { ...product, name: "Recipe Fixture", icon: "fixture.PNG", appId: "test.recipe" } });
	assert.equal(renamed.config.appId, "test.recipe");
	assert.deepEqual(renamed.config.mac.extendInfo, { CFBundleDisplayName: "Recipe Fixture", CFBundleName: "Recipe Fixture" });
	assert.equal(renamed.config.mac.icon, join(REPO, "pipicoc/fixture.icns"));
	assert.equal(renamed.app, join(inputs.stage, "output/mac-arm64/Recipe Fixture.app"));
	assert.equal(renamed.target, "/Applications/PipiCOC.app");
});

test("App version follows the root package version, not identity or extension metadata", () => {
	assert.equal(createPackageRecipe(inputs).config.extraMetadata.version, rootPackage.version);
	assert.equal(createPackageRecipe({ ...inputs, version: "8.7.6-beta.5", product: { ...product, version: "0.1.0" } }).config.extraMetadata.version, "8.7.6-beta.5");
	assert.throws(() => createPackageRecipe({ ...inputs, version: undefined }), /Root package manifest needs a version/);
});

test("the current resource allow-list excludes old embedded runtimes and defers the Node closure copy", () => {
	const { config } = createPackageRecipe(inputs);
	assert.deepEqual(config.extraResources, [
		{ from: join(inputs.stage, "product.json"), to: "product.json" },
		{ from: join(inputs.stage, "pi-coc-runtime.json"), to: "pi-coc-runtime.json" },
		{ from: join(REPO, "pipicoc", product.icon), to: product.icon },
		{ from: join(REPO, "Electron/packages/ui/dist/browser"), to: "browser-ui" },
	]);
	for (const excluded of ["pi-coc", "pipiui-runtime", "pipiui-embedded", "pi-ext", "pi-philosophy", "swift-extensions"]) {
		assert.equal(config.extraResources.some(entry => entry.to === excluded), false);
	}
	assert.deepEqual(config.files, ["out/**/*", "package.json", "!node_modules/**/*", "node_modules/node-pty/**/*", "node_modules/@xterm/headless/**/*", "node_modules/@xterm/addon-serialize/**/*"]);
	assert.equal(config.forceCodeSigning, false);
	assert.equal(config.mac.identity, null);
	assert.equal(config.mac.binaries, undefined);
	assert.deepEqual(config.mac.target, ["dir"]);
	assert.equal(config.npmRebuild, true);
});

test("the default bundle has one canonical install path, a back-link, and run-owned staging", () => {
	const recipe = createPackageRecipe(inputs);
	assert.equal(recipe.target, "/Applications/PipiCOC.app");
	assert.equal(recipe.home, "/recipe-user/leehow/code/pipicoc-build");
	assert.equal(recipe.link, join(recipe.home, "PipiCOC.app"));
	assert.equal(recipe.config.directories.output, join(inputs.stage, "output"));
	assert.equal(recipe.app, join(inputs.stage, "output/mac-arm64/PipiCOC.app"));
	const override = createPackageRecipe({ ...inputs, appHome: "/explicit/home", appBundle: "/explicit/PipiCOC.app" });
	assert.equal(override.home, "/explicit/home");
	assert.equal(override.link, "/explicit/home/PipiCOC.app");
	assert.equal(override.target, "/explicit/PipiCOC.app");
	assert.equal(override.app, recipe.app);
});

test("the recipe imports and executes without staging, subprocesses or ambient environment reads", t => {
	const { root, preload } = sandbox(t);
	const before = readdirSync(root, { recursive: true });
	const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e", `
const {createPackageRecipe} = await import(${JSON.stringify(pathToFileURL(join(REPO, "pipicoc/package-config.mjs")).href)});
const inputs = ${JSON.stringify(inputs)};
const before = JSON.stringify(inputs);
Object.freeze(inputs.product);
Object.freeze(inputs);
const first = createPackageRecipe(inputs);
first.config.files.push('mutated');
const second = createPackageRecipe(inputs);
if (second.config.files.includes('mutated') || JSON.stringify(inputs) !== before) throw new Error('Recipe mutated shared input/state');
console.log(JSON.stringify(second));
`], { cwd: root, encoding: "utf8", timeout: 10_000, env: { ...process.env, PIPICOC_APP_HOME: "/ambient-home", PIPICOC_APP_BUNDLE: "/ambient.app", NODE_OPTIONS: "" } });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), createPackageRecipe(inputs));
	assert.deepEqual(readdirSync(root, { recursive: true }), before);
});

for (const args of [[], ["--help"], ["--product", "missing-product.json", "--arch", "arm64"], ["--unexpected"]]) {
	test(`legacy product entry refuses before parsing or side effects: ${args.join(" ") || "no args"}`, t => {
		const { root, preload } = sandbox(t);
		const entry = join(root, "Electron/scripts/package-product.mjs");
		mkdirSync(dirname(entry), { recursive: true });
		copyFileSync(join(REPO, "Electron/scripts/package-product.mjs"), entry);
		const before = readdirSync(root, { recursive: true });
		const result = spawnSync(process.execPath, ["--import", preload, entry, ...args], {
			cwd: root, encoding: "utf8", timeout: 10_000, env: { ...process.env, HOME: root, TMPDIR: root, NODE_OPTIONS: "" },
		});
		assert.equal(result.status, 1, result.stderr);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr.trim(), "This product-packaging entry is retired. Use node pipicoc/package.mjs from the repository root.");
		assert.deepEqual(readdirSync(root, { recursive: true }), before);
	});
}
