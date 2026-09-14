import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPackageRecipe } from "../../pipicoc/package-config.mjs";

/**
 * The shell gates the remote-pairing entry behind an enabled `remote-control`
 * package (App.tsx `useProductExtensionEnabled('remote-control')`; a package,
 * not a base capability). PipiCOC ships that package as a manifest-only
 * extension enabled by default, pairing through the relay (default
 * https://remote.deepwood.cn). Pin the three links of that chain: the manifest
 * exists and is on by default, the gate id matches, and the profile installer
 * actually installs it.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(REPO, "extensions", "remote-control", "pipiui-extension.json"), "utf8"));

test("the remote-control package is enabled by default", () => {
	assert.equal(manifest.id, "remote-control");
	assert.equal(manifest.defaultEnabled, true, "the shell entry must appear without a user toggle");
	assert.equal(manifest.agent, undefined, "remote control is shell-owned; the package only flags availability");
});

test("the shell gate keys on the same id the package declares", () => {
	const app = readFileSync(join(REPO, "Electron", "packages", "ui", "src", "App.tsx"), "utf8");
	assert.ok(
		app.includes("useProductExtensionEnabled('remote-control')"),
		"App.tsx must gate the remote entry on the remote-control package id",
	);
});

test("the profile installer installs the remote-control package", () => {
	const install = readFileSync(join(REPO, "pipicoc", "install"), "utf8");
	assert.ok(
		install.includes("extensions/remote-control"),
		"pipicoc/install must copy extensions/remote-control into the Pi profile",
	);
});

test("the packaged App ships the browser-ui the remote debug lane serves", () => {
	// remote-debug.ts resolves <resources>/browser-ui in a packaged App; the PipiCOC
	// builder config writes its own extraResources list, so the pipiui list carrying
	// browser-ui does not cover it.
	const product = JSON.parse(readFileSync(join(REPO, "pipicoc", "product.json"), "utf8"));
	const { version } = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
	const { config } = createPackageRecipe({
		repo: REPO,
		stage: join(REPO, ".build.noindex", "remote-control-recipe-test"),
		product,
		version,
		userHome: "/recipe-user",
	});
	const resources = config.extraResources.filter(entry => entry.to === "browser-ui");
	assert.equal(resources.length, 1, "the App must ship exactly one browser-ui resource");
	assert.equal(resources[0].from, join(REPO, "Electron/packages/ui/dist/browser"));
	assert.equal(resources[0].to, "browser-ui");
});

test("the packaged runtime resources include the remote-control package", () => {
	// scripts/package-runtime.mjs assembles agent extensions from their `agent.extension`
	// entry; a manifest-only package like this one travels only via resourceDirectories.
	const dependencies = JSON.parse(readFileSync(join(REPO, "pipicoc", "runtime-dependencies.json"), "utf8"));
	assert.ok(
		Array.isArray(dependencies.resourceDirectories) && dependencies.resourceDirectories.includes("extensions/remote-control"),
		"pipicoc/runtime-dependencies.json resourceDirectories must list extensions/remote-control (manifest-only packages are not auto-assembled)",
	);
});
