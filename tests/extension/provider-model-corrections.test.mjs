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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { applyProviderModelCorrections, mergeProviderModelCorrections, PRODUCT_NOTE_KEY } from "../../runtime/host.ts";

const REPO = resolve(import.meta.dirname, "../..");
const REAL_CORRECTIONS = join(REPO, "content/providers/model-corrections.json");
const VENDORED_PI_INDEX = join(REPO, "build/node_modules/@earendil-works/pi-coding-agent/dist/index.js");

function scratch(t) {
	const dir = mkdtempSync(join(tmpdir(), "provider-model-corrections-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
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
	assert.deepEqual(await applyProviderModelCorrections(home, REAL_CORRECTIONS), { status: "left_untouched", reason: "unparsable" });
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
