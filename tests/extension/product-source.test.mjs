import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CANONICAL_PRODUCT = join(REPO, "pipicoc", "product.json");
const ELECTRON_PRODUCT = join(REPO, "Electron", "product.json");
const ELECTRON_APP = join(REPO, "Electron", "apps", "electron");

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

test("the canonical product identity is the only hand-written PipiCOC source", () => {
	assert.deepEqual(readJson(CANONICAL_PRODUCT), {
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
});

test("Electron packaged resources point at the canonical product identity", () => {
	const packageJson = readJson(join(ELECTRON_APP, "package.json"));
	const productResources = packageJson.build.extraResources.filter((entry) => entry.to === "product.json");
	assert.equal(productResources.length, 1, "exactly one packaged product.json resource is shipped");
	const [resource] = productResources;
	assert.equal(resolve(ELECTRON_APP, resource.from), CANONICAL_PRODUCT);
});

test("standalone packager reads product metadata from the canonical identity", () => {
	const source = readFileSync(join(REPO, "pipicoc", "package.mjs"), "utf8");
	assert.match(source, /const productConfigPath=join\(repo,'pipicoc\/product\.json'\),product=JSON\.parse\(fs\.readFileSync\(productConfigPath,'utf8'\)\)/);
	assert.match(source, /fs\.copyFileSync\(productConfigPath,join\(stage,'product\.json'\)\)/);
	assert.match(source, /const config=\{appId:product\.appId,productName:product\.name/);
	assert.match(source, /\{from:productIconPng,to:product\.icon\}/);
	assert.match(source, /mac:\{identity:null,icon:productIconIcns,extendInfo:\{CFBundleDisplayName:product\.name,CFBundleName:product\.name\}/);
});

test("builder staging uses product.name without changing the canonical install path", () => {
	const source = readFileSync(join(REPO, "pipicoc", "package.mjs"), "utf8");
	assert.match(source, /const app=join\(stage,'output\/mac-arm64',`\$\{product\.name\}\.app`\),runtime=/);
	assert.doesNotMatch(source, /output\/mac-arm64\/PipiCOC\.app/);
	assert.match(source, /PIPICOC_APP_BUNDLE\|\|'\/Applications\/PipiCOC\.app'/);
	assert.match(source, /link=join\(home,'PipiCOC\.app'\)/);
});
