/**
 * Beginner hints (docs/specs/opening-guidance.md §4): a fold opens by itself once per home, only while
 * the product setting is on, and the record lives in the host's files -- never browser storage.
 */
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "../..");
const temporary = await mkdtemp(join(tmpdir(), "beginner-hints-"));
after(() => rm(temporary, { recursive: true, force: true }));
await build({
	stdin: { contents: "export * from './extensions/ui/hints.ts';", resolveDir: ROOT, sourcefile: "hints-entry.ts" },
	outfile: join(temporary, "hints.mjs"), bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
});
const hints = await import(pathToFileURL(join(temporary, "hints.mjs")).href);

async function desk(name) {
	const home = join(temporary, name, "home"), agentHome = join(temporary, name, "agent");
	await mkdir(home, { recursive: true });
	await mkdir(agentHome, { recursive: true });
	return { home, agentHome };
}
const WORDS = ["这是在创建你的调查员。", "名字加营生就够了。"];

test("the first time a home meets a moment the fold opens, and it is recorded in the home's own file", async () => {
	const where = await desk("first");
	const first = await hints.openingHelp("setup-opening", "这是在做什么？", WORDS, where);
	assert.deepEqual(first, { moment: "setup-opening", title: "这是在做什么？", lines: WORDS, open: true });
	const record = JSON.parse(await readFile(join(where.home, ".coc", "ui-hints.json"), "utf8"));
	assert.equal(typeof record.seen["setup-opening"], "string");
	const second = await hints.openingHelp("setup-opening", "这是在做什么？", WORDS, where);
	assert.equal(second.open, false, "shown once: the next table on this desk gets the button only");
	// Another moment on the same desk is its own first time.
	assert.equal((await hints.openingHelp("play-opening", "从这里开始怎么玩", WORDS, where)).open, true);
});

test("the product setting off means nothing opens by itself and nothing is recorded", async () => {
	const where = await desk("off");
	await writeFile(join(where.agentHome, "pipiui-settings.json"), JSON.stringify({ extensions: { "coc-keeper": { settings: { [hints.SETTING_KEY]: { enabled: false } } } } }));
	assert.equal(await hints.hintsEnabled(where.agentHome), false);
	const help = await hints.openingHelp("setup-opening", "t", WORDS, where);
	assert.equal(help.open, false);
	assert.equal(await hints.hintSeen(where.home, "setup-opening"), false, "a fold that did not open is still owed");
});

test("no settings document, or one that says nothing about hints, means on", async () => {
	const where = await desk("default");
	assert.equal(await hints.hintsEnabled(where.agentHome), true);
	await writeFile(join(where.agentHome, "pipiui-settings.json"), JSON.stringify({ extensions: { "coc-keeper": { settings: {} } } }));
	assert.equal(await hints.hintsEnabled(where.agentHome), true);
});
