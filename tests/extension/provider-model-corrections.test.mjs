/**
 * SL-61, contract §135.27.1: provider model data the product knows to be wrong (an opencode-go
 * deepseek catalog entry that declares `thinkingLevelMap.off: null`, when the endpoint actually
 * accepts `thinking: {type: "disabled"}` and cuts a 59-92s turn to 3.1-3.5s -- see
 * docs/kernel-rpc.md §135.27.1 and content/providers/model-corrections.json) is corrected as
 * data, merged into the agent home's models.json at host preparation (`runtime/host.ts`'s
 * `mergeProviderModelCorrections`/`applyProviderModelCorrections`, called from
 * `runtime/launch.ts`'s `piLaunch`).
 *
 * The last two tests exercise the real vendored Pi (`build/node_modules`, ADR-0006 -- the same
 * copy `tests/extension/pi.mjs` re-exports and the Keeper launch actually runs) to prove the
 * merged file is not just shaped right on paper but is the thing Pi's own `ModelRuntime` resolves
 * `thinkingLevelMap.off` from.
 */
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { applyProviderModelCorrections, mergeProviderModelCorrections, PRODUCT_NOTE_KEY } from "../../runtime/host.ts";
import { parseModelsJson } from "../../runtime/json-comments.ts";
import { piLaunch } from "../../runtime/launch.ts";
import { HOST_NOTICES_ENV } from "../../runtime/host-notices.ts";
import { PI_ENTRIES } from "../../runtime/deployment.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const REAL_CORRECTIONS = join(REPO, "content/providers/model-corrections.json");
const VENDORED_PI_INDEX = join(REPO, "build/node_modules/@earendil-works/pi-coding-agent/dist/index.js");

function scratch(t) {
	const dir = mkdtempSync(join(tmpdir(), "provider-model-corrections-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** `unparsable` carries the parse error Pi's own loader meets on the same text (§135.27.1.2). */
function assertUnparsable(outcome) {
	const { error, ...rest } = outcome;
	assert.deepEqual(rest, { status: "left_untouched", reason: "unparsable" });
	assert.ok(typeof error === "string" && error.length > 0, "the outcome carries the parse error");
}

// -- mergeProviderModelCorrections: pure, in-memory ------------------------------------------

test("merges into an empty models.json", () => {
	const corrections = { providers: { "opencode-go": { modelOverrides: {
		"deepseek-v4.1-flash": { thinkingLevelMap: { off: "off" } },
		"deepseek-v4-flash": { thinkingLevelMap: { off: "off" } },
	} } } };
	const { config, entries } = mergeProviderModelCorrections({}, corrections);
	assert.deepEqual(config, { providers: { "opencode-go": { modelOverrides: {
		"deepseek-v4.1-flash": { thinkingLevelMap: { off: "off" } },
		"deepseek-v4-flash": { thinkingLevelMap: { off: "off" } },
	} } } });
	assert.deepEqual(entries, [
		{ provider: "opencode-go", model: "deepseek-v4.1-flash" },
		{ provider: "opencode-go", model: "deepseek-v4-flash" },
	]);
});

test("a user's own override for the corrected model wins untouched; other providers and fields are untouched", () => {
	const existing = {
		providers: {
			"opencode-go": {
				apiKey: "operator-key",
				modelOverrides: {
					// The operator deliberately keeps "off" unsupported for this one; any shape, not
					// just thinkingLevelMap, must survive exactly as written.
					"deepseek-v4.1-flash": { thinkingLevelMap: { off: null, low: "low" }, maxTokens: 9000 },
				},
			},
			"xai": { oauth: "radius", baseUrl: "https://example.invalid" },
		},
	};
	const corrections = { providers: { "opencode-go": { modelOverrides: {
		"deepseek-v4.1-flash": { thinkingLevelMap: { off: "off" } },
		"deepseek-v4-flash": { thinkingLevelMap: { off: "off" } },
	} } } };
	const { config, entries } = mergeProviderModelCorrections(existing, corrections);
	// the user's own override for the model the correction also names: byte-for-byte untouched
	assert.deepEqual(config.providers["opencode-go"].modelOverrides["deepseek-v4.1-flash"],
		{ thinkingLevelMap: { off: null, low: "low" }, maxTokens: 9000 });
	// the provider's other fields: untouched
	assert.equal(config.providers["opencode-go"].apiKey, "operator-key");
	// a model the user had no override for: the product's correction lands
	assert.deepEqual(config.providers["opencode-go"].modelOverrides["deepseek-v4-flash"],
		{ thinkingLevelMap: { off: "off" } });
	// a provider the corrections file never mentions: untouched
	assert.deepEqual(config.providers["xai"], { oauth: "radius", baseUrl: "https://example.invalid" });
	// entries lists what the product knows about, regardless of which ones actually applied
	assert.deepEqual(entries, [
		{ provider: "opencode-go", model: "deepseek-v4.1-flash" },
		{ provider: "opencode-go", model: "deepseek-v4-flash" },
	]);
});

test("a user's override that never mentions a corrected key gets that key filled; the keys it sets stay", () => {
	// 2026-09-29: the operator's own `{low: "low", ...}` (written to expose the low tier) used to shadow
	// the whole correction, so a fast model set to `off` ran on the catalog's `off: null`.
	const existing = { providers: { "opencode-go": { modelOverrides: {
		"deepseek-v4.1-flash": { thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" } },
	} } } };
	const corrections = { providers: { "opencode-go": { modelOverrides: {
		"deepseek-v4.1-flash": { thinkingLevelMap: { off: "off", low: "should-not-replace" }, compat: { thinkingFormat: "deepseek" } },
	} } } };
	const { config } = mergeProviderModelCorrections(existing, corrections);
	assert.deepEqual(config.providers["opencode-go"].modelOverrides["deepseek-v4.1-flash"], {
		thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max", off: "off" },
		compat: { thinkingFormat: "deepseek" },
	});
	assert.equal(existing.providers["opencode-go"].modelOverrides["deepseek-v4.1-flash"].thinkingLevelMap.off, undefined,
		"the input is never mutated");
});

test("documentation keys ($comment) in the corrections source never reach the merged output", () => {
	const corrections = { providers: { "opencode-go": { modelOverrides: {
		"deepseek-v4-flash": { "$comment": "explains the override for maintainers", thinkingLevelMap: { off: "off" } },
	} } } };
	const { config } = mergeProviderModelCorrections({}, corrections);
	assert.deepEqual(config.providers["opencode-go"].modelOverrides["deepseek-v4-flash"], { thinkingLevelMap: { off: "off" } });
});

test("a corrections shape with no modelOverrides, or an empty corrections object, merges to nothing", () => {
	const existing = { providers: { "opencode-go": { apiKey: "k" } } };
	assert.deepEqual(mergeProviderModelCorrections(existing, {}), { config: existing, entries: [] });
	assert.deepEqual(mergeProviderModelCorrections(existing, { providers: { "opencode-go": {} } }), { config: existing, entries: [] });
});

// -- applyProviderModelCorrections: the I/O wrapper piLaunch calls ---------------------------

test("merge into an empty home writes strict-JSON models.json with the product's entries and a data-key note", async t => {
	const home = scratch(t);
	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS), { status: "written" });
	const written = readFileSync(join(home, "models.json"), "utf8");
	// §135.27.1.1: the App reads this file with plain JSON.parse, so the product writes no comments.
	const parsed = JSON.parse(written);
	assert.deepEqual(Object.keys(parsed), [PRODUCT_NOTE_KEY, "providers"], "the note is a data key, placed first");
	const note = parsed[PRODUCT_NOTE_KEY].join("\n");
	assert.match(note, /opencode-go\/deepseek-v4\.1-flash/, "the note names the corrected models");
	assert.match(note, /opencode-go\/deepseek-v4-flash/);
	assert.deepEqual(parsed.providers["opencode-go"].modelOverrides["deepseek-v4.1-flash"], { thinkingLevelMap: { off: "off" } });
	assert.deepEqual(parsed.providers["opencode-go"].modelOverrides["deepseek-v4-flash"], { thinkingLevelMap: { off: "off" } });
});

test("a missing corrections file is one correction fewer, never a failure: the home stays untouched", async t => {
	const home = scratch(t);
	assert.deepEqual(await applyProviderModelCorrections(home, join(home, "no-such-corrections.json")), { status: "no_corrections_file" });
	assert.throws(() => readFileSync(join(home, "models.json"), "utf8"), /ENOENT/);
});

test("a second launch's merge is idempotent: no write, same bytes", async t => {
	const home = scratch(t);
	await applyProviderModelCorrections(home, REAL_CORRECTIONS);
	const path = join(home, "models.json");
	const firstText = readFileSync(path, "utf8");
	const firstMtime = statSync(path).mtimeMs;
	await new Promise(r => setTimeout(r, 20)); // mtime resolution on some filesystems
	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS), { status: "unchanged" });
	assert.equal(readFileSync(path, "utf8"), firstText);
	assert.equal(statSync(path).mtimeMs, firstMtime, "an unchanged merge must not rewrite the file");
});

test("an operator's own hand-written models.json keeps its override and its other provider after merge", async t => {
	const home = scratch(t);
	writeFileSync(join(home, "models.json"), JSON.stringify({
		providers: {
			"opencode-go": { modelOverrides: { "deepseek-v4.1-flash": { thinkingLevelMap: { off: null } } } },
			"grok-build": { name: "the operator's own grok-build tweaks" },
		},
	}, null, 2) + "\n");
	await applyProviderModelCorrections(home, REAL_CORRECTIONS);
	const parsed = JSON.parse(readFileSync(join(home, "models.json"), "utf8"));
	assert.deepEqual(parsed.providers["opencode-go"].modelOverrides["deepseek-v4.1-flash"], { thinkingLevelMap: { off: null } });
	assert.deepEqual(parsed.providers["grok-build"], { name: "the operator's own grok-build tweaks" });
	// the model the operator had no override for still gets the product's correction
	assert.deepEqual(parsed.providers["opencode-go"].modelOverrides["deepseek-v4-flash"], { thinkingLevelMap: { off: "off" } });
});

test("a hand-broken models.json is left untouched rather than blocking the table", async t => {
	const home = scratch(t);
	const broken = "{ not valid json";
	writeFileSync(join(home, "models.json"), broken);
	assertUnparsable(await applyProviderModelCorrections(home, REAL_CORRECTIONS));
	assert.equal(readFileSync(join(home, "models.json"), "utf8"), broken);
});

// -- §135.27.1.1: strict JSON, the old header healed, an operator's comments never erased -----

/** The installed App's models.json on 2026-10-03, in shape: the `//` header the merge wrote 09-25..10-03, then JSON. */
const LEGACY_HEADER = [
	"// Product corrections merged by chatrpgv4 (contract §135.27.1; source",
	"// content/providers/model-corrections.json). A key below is filled in only where your own",
	"// override for that exact provider+model does not set it; a key you set is never replaced. The",
	"// product currently knows a correction for:",
	"//   - opencode-go/deepseek-v4.1-flash",
	"//   - opencode-go/deepseek-v4-flash",
	"",
].join("\n");

test("the header the merge used to write is dropped on the next launch; the operator's data is kept", async t => {
	const home = scratch(t);
	const path = join(home, "models.json");
	const operator = {
		providers: {
			"opencode-go": { modelOverrides: {
				"deepseek-v4.1-flash": { thinkingLevelMap: { minimal: null, low: "low", off: "off" } },
				"deepseek-v4-flash": { thinkingLevelMap: { off: "off" } },
			} },
			"my-proxy": { baseUrl: "https://proxy.example/v1", api: "openai-completions", apiKey: "sk-literal",
				models: [{ id: "gpt-x", name: "gpt-x", reasoning: true }] },
		},
	};
	writeFileSync(path, `${LEGACY_HEADER}${JSON.stringify(operator, null, 2)}\n`);
	assert.throws(() => JSON.parse(readFileSync(path, "utf8")), /not valid JSON/, "the 10-03 shape a strict reader fails on");

	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS), { status: "written" });
	const written = readFileSync(path, "utf8");
	assert.doesNotMatch(written, /^\/\//m, "no comment line survives");
	const parsed = JSON.parse(written);
	assert.deepEqual(parsed.providers, operator.providers, "every provider and override the operator had is kept as read");
	assert.ok(Array.isArray(parsed[PRODUCT_NOTE_KEY]));
	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS), { status: "unchanged" });
});

test("an operator's own comments leave the file byte for byte untouched and report the corrections that did not land", async t => {
	const home = scratch(t);
	const path = join(home, "models.json");
	const commented = [
		"{",
		"  // my relay; ask before changing",
		"  \"providers\": {",
		"    \"opencode-go\": { \"modelOverrides\": { \"deepseek-v4.1-flash\": { \"thinkingLevelMap\": { \"off\": \"off\" } } } }",
		"  }",
		"}",
		"",
	].join("\n");
	writeFileSync(path, commented);
	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS), {
		status: "left_untouched", reason: "operator_comments",
		missing: [{ provider: "opencode-go", model: "deepseek-v4-flash" }],
	}, "only the correction the operator lacks is reported");
	assert.equal(readFileSync(path, "utf8"), commented);

	// The same operator header above the product's old header: the old header goes, the operator's comment keeps the file.
	writeFileSync(path, `${LEGACY_HEADER}// mine\n{"providers": {}}\n`);
	const before = readFileSync(path, "utf8");
	const outcome = await applyProviderModelCorrections(home, REAL_CORRECTIONS);
	assert.equal(outcome.reason, "operator_comments");
	assert.equal(readFileSync(path, "utf8"), before);
});

test("an operator's comments with every correction already present report nothing missing", async t => {
	const home = scratch(t);
	const path = join(home, "models.json");
	const commented = `// mine\n${JSON.stringify({ providers: { "opencode-go": { modelOverrides: {
		"deepseek-v4.1-flash": { thinkingLevelMap: { off: null } },
		"deepseek-v4-flash": { thinkingLevelMap: { off: "off" } },
	} } } }, null, 2)}\n`;
	writeFileSync(path, commented);
	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS),
		{ status: "left_untouched", reason: "operator_comments", missing: [] });
	assert.equal(readFileSync(path, "utf8"), commented);
});

test("an operator's own top-level $comment is never touched; the product note is its own key", async t => {
	const home = scratch(t);
	const path = join(home, "models.json");
	writeFileSync(path, JSON.stringify({ "$comment": "the operator's own note", providers: {} }, null, 2));
	await applyProviderModelCorrections(home, REAL_CORRECTIONS);
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	assert.equal(parsed.$comment, "the operator's own note");
	assert.notEqual(PRODUCT_NOTE_KEY, "$comment");
	assert.ok(Array.isArray(parsed[PRODUCT_NOTE_KEY]));
});

test("with no corrections left, a stale product note is removed and nothing else changes", async t => {
	const home = scratch(t);
	const path = join(home, "models.json");
	const empty = join(home, "empty-corrections.json");
	writeFileSync(empty, JSON.stringify({ providers: {} }));
	writeFileSync(path, JSON.stringify({ [PRODUCT_NOTE_KEY]: ["stale"], providers: { xai: { baseUrl: "https://example.invalid" } } }, null, 2));
	assert.deepEqual(await applyProviderModelCorrections(home, empty), { status: "written" });
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { providers: { xai: { baseUrl: "https://example.invalid" } } });
});

// -- §135.27.1.2: the file is read in Pi's own grammar -------------------------------------

/** An operator's hand-written relay, with the trailing commas Pi accepts and strict JSON does not. */
const TRAILING_COMMAS = [
	"{",
	"  \"providers\": {",
	"    \"my-proxy\": {",
	"      \"baseUrl\": \"https://proxy.example/v1\",",
	"      \"api\": \"openai-completions\",",
	"      \"apiKey\": \"sk-literal\",",
	"      \"models\": [",
	"        { \"id\": \"gpt-x\", \"name\": \"gpt-x\" },",
	"      ],",
	"    },",
	"  },",
	"}",
	"",
].join("\n");
const MY_PROXY = { baseUrl: "https://proxy.example/v1", api: "openai-completions", apiKey: "sk-literal", models: [{ id: "gpt-x", name: "gpt-x" }] };
/** The same relay with a block comment, which Pi refuses: `Failed to parse models.json`, every custom model disabled. */
const BLOCK_COMMENT = `/* my relay; ask before changing */\n${JSON.stringify({ providers: { "my-proxy": MY_PROXY } }, null, 2)}\n`;

test("an operator's trailing commas are not comments: the corrections land and the operator's provider stays", async t => {
	const home = scratch(t);
	const path = join(home, "models.json");
	writeFileSync(path, TRAILING_COMMAS);
	assert.throws(() => JSON.parse(TRAILING_COMMAS), /JSON/, "a shape a strict reader fails on");

	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS), { status: "written" });
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	assert.deepEqual(parsed.providers["my-proxy"], MY_PROXY, "the operator's provider is kept as read");
	assert.deepEqual(parsed.providers["opencode-go"].modelOverrides["deepseek-v4.1-flash"], { thinkingLevelMap: { off: "off" } });
	assert.deepEqual(parsed.providers["opencode-go"].modelOverrides["deepseek-v4-flash"], { thinkingLevelMap: { off: "off" } });
	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS), { status: "unchanged" });
});

test("a BOM is not a comment either: the corrections land", async t => {
	const home = scratch(t);
	const path = join(home, "models.json");
	writeFileSync(path, `\uFEFF${JSON.stringify({ providers: { "my-proxy": MY_PROXY } }, null, 2)}\n`);
	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS), { status: "written" });
	const written = readFileSync(path, "utf8");
	assert.equal(written.startsWith("{"), true, "the rewrite is strict JSON, without the BOM");
	assert.deepEqual(JSON.parse(written).providers["my-proxy"], MY_PROXY);
});

test("a /* */ comment fails Pi's grammar, so the file is left byte for byte and nothing is merged into it", async t => {
	const home = scratch(t);
	const path = join(home, "models.json");
	writeFileSync(path, BLOCK_COMMENT);
	assertUnparsable(await applyProviderModelCorrections(home, REAL_CORRECTIONS));
	assert.equal(readFileSync(path, "utf8"), BLOCK_COMMENT);
});

// -- Integration: the real vendored Pi actually resolves the correction ----------------------

const REAL_PI = existsSync(VENDORED_PI_INDEX);

test("Pi's own ModelRuntime resolves thinkingLevelMap.off === null before correction, \"off\" after", { skip: !REAL_PI && "vendored Pi not built (npm run build:runtime)" }, async t => {
	const { ModelRuntime, ModelRegistry } = await import(VENDORED_PI_INDEX);
	const home = scratch(t);
	const modelsPath = join(home, "models.json");

	const before = await ModelRuntime.create({ modelsPath, refreshOnCreate: false });
	const beforeModel = new ModelRegistry(before).find("opencode-go", "deepseek-v4.1-flash");
	assert.equal(beforeModel?.thinkingLevelMap?.off ?? null, null, "the uncorrected catalog entry has no usable off");

	await applyProviderModelCorrections(home, REAL_CORRECTIONS);
	const after = await ModelRuntime.create({ modelsPath, refreshOnCreate: false });
	const registry = new ModelRegistry(after);
	assert.equal(registry.find("opencode-go", "deepseek-v4.1-flash")?.thinkingLevelMap?.off, "off");
	assert.equal(registry.find("opencode-go", "deepseek-v4-flash")?.thinkingLevelMap?.off, "off");
});

test("Pi's own ModelRuntime honors a user's pre-existing off:null override over the product's correction", { skip: !REAL_PI && "vendored Pi not built (npm run build:runtime)" }, async t => {
	const { ModelRuntime, ModelRegistry } = await import(VENDORED_PI_INDEX);
	const home = scratch(t);
	const modelsPath = join(home, "models.json");
	writeFileSync(modelsPath, JSON.stringify({
		providers: { "opencode-go": { modelOverrides: { "deepseek-v4.1-flash": { thinkingLevelMap: { off: null } } } } },
	}));

	await applyProviderModelCorrections(home, REAL_CORRECTIONS);
	const runtime = await ModelRuntime.create({ modelsPath, refreshOnCreate: false });
	const registry = new ModelRegistry(runtime);
	assert.equal(registry.find("opencode-go", "deepseek-v4.1-flash")?.thinkingLevelMap?.off, null,
		"the operator's own decision to keep off unsupported for this model must survive the merge");
	assert.equal(registry.find("opencode-go", "deepseek-v4-flash")?.thinkingLevelMap?.off, "off",
		"a model the operator did not override still gets the product's correction");
});

test("Pi's own ModelRuntime gets the corrected off under an operator override that never mentions off", { skip: !REAL_PI && "vendored Pi not built (npm run build:runtime)" }, async t => {
	// The installed App's agent home on 2026-09-29, verbatim in shape: a hand-written tier list with no
	// `off` key. Before the key-by-key merge this shadowed the correction and `off` resolved to null.
	const { ModelRuntime, ModelRegistry } = await import(VENDORED_PI_INDEX);
	const home = scratch(t);
	const modelsPath = join(home, "models.json");
	writeFileSync(modelsPath, JSON.stringify({
		providers: { "opencode-go": { modelOverrides: { "deepseek-v4.1-flash": {
			thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
		} } } },
	}));

	await applyProviderModelCorrections(home, REAL_CORRECTIONS);
	const model = new ModelRegistry(await ModelRuntime.create({ modelsPath, refreshOnCreate: false })).find("opencode-go", "deepseek-v4.1-flash");
	assert.equal(model?.thinkingLevelMap?.off, "off");
	assert.equal(model?.thinkingLevelMap?.low, "low", "the operator's own tiers are kept");
	assert.equal(model?.thinkingLevelMap?.medium, null);
});

test("Pi's own ModelRuntime has the operator's trailing-comma relay before the merge, and it plus the correction after", { skip: !REAL_PI && "vendored Pi not built (npm run build:runtime)" }, async t => {
	const { ModelRuntime, ModelRegistry } = await import(VENDORED_PI_INDEX);
	const home = scratch(t);
	const modelsPath = join(home, "models.json");
	writeFileSync(modelsPath, TRAILING_COMMAS);
	const before = await ModelRuntime.create({ modelsPath, refreshOnCreate: false });
	assert.equal(before.getError(), undefined);
	assert.ok(new ModelRegistry(before).find("my-proxy", "gpt-x"), "Pi reads the operator's file as written");

	await applyProviderModelCorrections(home, REAL_CORRECTIONS);
	const after = await ModelRuntime.create({ modelsPath, refreshOnCreate: false });
	const registry = new ModelRegistry(after);
	assert.equal(after.getError(), undefined);
	assert.ok(registry.find("my-proxy", "gpt-x"));
	assert.equal(registry.find("opencode-go", "deepseek-v4.1-flash")?.thinkingLevelMap?.off, "off");
});

test("Pi's own ModelRuntime refuses the /* */ file the merge left untouched: neither side reads it", { skip: !REAL_PI && "vendored Pi not built (npm run build:runtime)" }, async t => {
	const { ModelRuntime, ModelRegistry } = await import(VENDORED_PI_INDEX);
	const home = scratch(t);
	const modelsPath = join(home, "models.json");
	writeFileSync(modelsPath, BLOCK_COMMENT);
	assert.equal((await applyProviderModelCorrections(home, REAL_CORRECTIONS)).reason, "unparsable");
	const runtime = await ModelRuntime.create({ modelsPath, refreshOnCreate: false });
	assert.match(runtime.getError() ?? "", /^Failed to parse models\.json/);
	assert.equal(new ModelRegistry(runtime).find("my-proxy", "gpt-x"), undefined, "Pi disables the operator's custom models");
	assert.equal(new ModelRegistry(runtime).find("opencode-go", "deepseek-v4.1-flash")?.thinkingLevelMap?.off ?? null, null);
});

// -- §135.27.1.2: piLaunch names a models.json Pi cannot parse --------------------------------

/** A source-layout resource root piLaunch can prepare: the prompt, the two Pi entries, the shipped corrections. */
function launchRoot(t) {
	const root = scratch(t);
	mkdirSync(join(root, "prompts"));
	writeFileSync(join(root, "prompts", "keeper.md"), "# Keeper\n");
	for (const entry of [PI_ENTRIES.pi, "build/runtime/pi-hybrid.mjs"]) {
		mkdirSync(dirname(join(root, entry)), { recursive: true });
		writeFileSync(join(root, entry), "");
	}
	mkdirSync(join(root, "content", "providers"), { recursive: true });
	copyFileSync(REAL_CORRECTIONS, join(root, "content", "providers", "model-corrections.json"));
	mkdirSync(join(root, ".pi", "coc-agent"), { recursive: true });
	return { root, modelsPath: join(root, ".pi", "coc-agent", "models.json") };
}

/**
 * What piLaunch writes to stderr while it prepares the agent home, and the notices it hands the Pi child (§135.27.1.3).
 * It returns the launch; nothing is spawned.
 */
async function launchNotices(t, root, inherited = {}) {
	const env = { ...process.env, ...inherited };
	for (const key of ["PI_COC_LOOP_ENGINE", "PI_COC_LAYOUT", "PI_CODING_AGENT_DIR", "PI_COC_HOME", "PI_COC_CONTENT_ROOT", "PI_COC_CAMPAIGN"]) delete env[key];
	const written = [];
	const stderr = t.mock.method(process.stderr, "write", chunk => { written.push(String(chunk)); return true; });
	let launch;
	try { launch = await piLaunch(["--campaign", "models-json"], { resourceRoot: root, env }); }
	finally { stderr.mock.restore(); }
	const handed = launch.env[HOST_NOTICES_ENV];
	return Object.assign(written, { handed: handed === undefined ? undefined : JSON.parse(handed) });
}

/** The provider/model pairs the shipped corrections name, in their own order. */
function correctedPairs() {
	const { providers } = JSON.parse(readFileSync(REAL_CORRECTIONS, "utf8"));
	return Object.entries(providers).flatMap(([provider, entry]) => Object.keys(entry.modelOverrides ?? {})
		.filter(model => !model.startsWith("$")).map(model => `${provider}/${model}`));
}

function parseError(text) {
	try { parseModelsJson(text); } catch (error) { return error.message; }
	assert.fail("the fixture must not parse");
}

test("piLaunch names a models.json Pi cannot parse, with the error Pi records, and leaves the file as it was", async t => {
	for (const [shape, text] of [["/* */ comment", BLOCK_COMMENT], ["hand-broken", "{ not valid json"]]) await t.test(shape, async t => {
		const { root, modelsPath } = launchRoot(t);
		writeFileSync(modelsPath, text);
		const detail = parseError(text);
		const notices = await launchNotices(t, root);
		assert.equal(notices.length, 1, notices.join(""));
		assert.ok(notices[0].startsWith(`${modelsPath} `), "the notice names the file");
		assert.ok(notices[0].includes(`(${detail})`), "and carries the parse error");
		assert.match(notices[0], /§135\.27\.1\.2/);
		assert.equal(readFileSync(modelsPath, "utf8"), text);
		// §135.27.1.3: the same notice is handed to the Pi child, for the transcript.
		assert.deepEqual(notices.handed, [{ notice: "models_json_unparsable", path: modelsPath, error: detail }]);
		if (!REAL_PI) return;
		// The error Pi records for this file and shows only in its TUI is the one the notice carries.
		const { ModelRuntime } = await import(VENDORED_PI_INDEX);
		const recorded = (await ModelRuntime.create({ modelsPath, refreshOnCreate: false })).getError() ?? "";
		assert.ok(recorded.startsWith(`Failed to parse models.json: ${detail}\n`), recorded);
	});
});

test("piLaunch says nothing about a file Pi parses; an operator's // comments keep their own notice", async t => {
	const relay = JSON.stringify({ providers: { "my-proxy": MY_PROXY } }, null, 2);
	const cases = [
		["strict", relay, []],
		["trailing commas", TRAILING_COMMAS, []],
		["BOM", `\uFEFF${relay}\n`, []],
		["empty", "", []],
		["// comment", `// mine\n${relay}\n`, [/§135\.27\.1\.1/]],
	];
	for (const [shape, text, expected] of cases) await t.test(shape, async t => {
		const { root, modelsPath } = launchRoot(t);
		writeFileSync(modelsPath, text);
		const notices = await launchNotices(t, root);
		assert.equal(notices.length, expected.length, notices.join(""));
		expected.forEach((pattern, index) => assert.match(notices[index], pattern));
		assert.ok(notices.every(notice => !notice.includes("§135.27.1.2")), "no unparsable notice for a file Pi reads");
		assert.deepEqual(notices.handed, expected.length
			? [{ notice: "models_json_operator_comments", path: modelsPath, missing: correctedPairs() }] : undefined);
	});
});

test("piLaunch never passes on a notice it did not decide itself", async t => {
	const { root, modelsPath } = launchRoot(t);
	writeFileSync(modelsPath, JSON.stringify({ providers: { "my-proxy": MY_PROXY } }));
	const stale = [{ notice: "models_json_unparsable", path: "/elsewhere/models.json", error: "stale" }];
	const notices = await launchNotices(t, root, { [HOST_NOTICES_ENV]: JSON.stringify(stale) });
	assert.equal(notices.handed, undefined, "an inherited value is dropped, not forwarded");
});
