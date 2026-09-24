import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MOD = join(ROOT, "mods/narration-craft");
const HELPERS = ["types.ts", "catalog.ts", "reference.ts", "index.ts"].map(name => join(ROOT, "runtime/craft", name));

/** SHA-256 of the frozen English inputs. Provenance only; the untracked source package is not read. */
const CARDS_SHA256 = "6e31047a044e6c290c6d181b4d98c3b70ae942b5ddb0963d566863fcc282217d";
const STARTER_IDS_SHA256 = "ff2854ac8ba3db37007100a545ab30950e791b4e3e5868169c041236cf40e8ef";

const out = mkdtempSync(join(tmpdir(), "craft-reference-assets-"));
try {
  await build({
    entryPoints: [join(ROOT, "runtime/craft/index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "craft.js"),
  });
} catch (error) {
  rmSync(out, { recursive: true, force: true });
  throw error;
}
const craft = await import(pathToFileURL(join(out, "craft.js")).href);
rmSync(out, { recursive: true, force: true });

const { CraftCatalog, renderCraftReference, GENERATION_FIELDS, CRAFT_REFERENCE_MAX_BYTES } = craft;
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const load = name => JSON.parse(readFileSync(join(MOD, name), "utf8"));
const cards = load("cards.en.json");
const starterIds = load("starter-ids.json");
const catalog = new CraftCatalog(structuredClone(cards), structuredClone(starterIds));

const card = (n, starter = false, patch = {}) => ({
  schemaVersion: "2.0",
  id: `CRAFT-EXC-${String(n).padStart(2, "0")}`,
  family: "exchange",
  sourceStudyIds: ["LIT-01"],
  starter,
  examplesOrigin: "original_editorial_fixture",
  validationStatus: "not_human_calibrated",
  title: "Title",
  purpose: "Purpose",
  useWhen: "Use when",
  avoidWhen: "Avoid when",
  context: "Context",
  acceptable: "Acceptable text",
  stronger: "Stronger text",
  alternative: "Alternative text",
  nearMiss: "NEARMISS-SENTINEL",
  diagnosis: "DIAGNOSIS-SENTINEL",
  boundaryContext: "BOUNDARY-CONTEXT-SENTINEL",
  boundaryText: "BOUNDARY-TEXT-SENTINEL",
  why: "WHY-SENTINEL",
  elaboration: "Elaboration",
  ...patch,
});

test("frozen English assets match the checked input digests and the reference descriptor", () => {
  assert.equal(sha(join(MOD, "cards.en.json")), CARDS_SHA256);
  assert.equal(sha(join(MOD, "starter-ids.json")), STARTER_IDS_SHA256);
  assert.deepEqual(load("craft-reference.json"), {
    schema_version: 1,
    catalog: "cards.en.json",
    candidates: "starter-ids.json",
  });
  assert.equal(CRAFT_REFERENCE_MAX_BYTES, 1800);
});

test("the issued catalog is 48 cards and 12 starter candidates, field-consistent", () => {
  assert.equal(cards.length, 48);
  assert.equal(new Set(cards.map(entry => entry.id)).size, 48);
  assert.equal(starterIds.length, 12);
  assert.deepEqual(catalog.candidateIds, starterIds);
  const marked = cards.filter(entry => entry.starter).map(entry => entry.id);
  assert.equal(marked.length, 12);
  assert.deepEqual([...marked].sort(), [...starterIds].sort());
  assert.deepEqual(catalog.candidates().map(entry => entry.id), starterIds);
  assert.equal(new Set(cards.map(entry => entry.family)).size, 8);
  assert.match(catalog.revision, /^[a-f0-9]{64}$/);
  assert.equal(new CraftCatalog(structuredClone(cards), [...starterIds]).revision, catalog.revision);
});

test("illegal shape, duplicate ids, unknown fields, and starter mistakes are rejected", () => {
  assert.throws(() => new CraftCatalog([], []));
  assert.throws(() => new CraftCatalog(Array.from({ length: 65 }, (_, index) => card(index + 1)), []));
  assert.throws(() => new CraftCatalog([card(1), card(1)], ["CRAFT-EXC-01"]));
  assert.throws(() => new CraftCatalog([card(1, true, { review: "secret" })], ["CRAFT-EXC-01"]));
  assert.throws(() => new CraftCatalog([card(1, true, { id: "voice card" })], ["voice card"]));
  assert.throws(() => new CraftCatalog([card(1, true, { examplesOrigin: "copied" })], ["CRAFT-EXC-01"]));
  assert.throws(() => new CraftCatalog([card(1, true, { sourceStudyIds: ["NOTE-01"] })], ["CRAFT-EXC-01"]));
  assert.throws(() => new CraftCatalog([card(1, true, { purpose: "  " })], ["CRAFT-EXC-01"]));
  assert.throws(() => new CraftCatalog([card(1, true), card(2, false)], ["CRAFT-EXC-02"]));
  assert.throws(() => new CraftCatalog([card(1, true)], ["CRAFT-EXC-01", "CRAFT-EXC-01"]));
  assert.throws(() => new CraftCatalog([card(1, true)], ["CRAFT-ZZZ-99"]));
  assert.throws(() => new CraftCatalog(
    Array.from({ length: 13 }, (_, index) => card(index + 1, true)),
    Array.from({ length: 13 }, (_, index) => card(index + 1, true).id),
  ));
  assert.throws(() => new CraftCatalog(cards));
  assert.equal(new CraftCatalog(Array.from({ length: 64 }, (_, index) => card(index + 1)), []).candidateIds.length, 0);
});

test("unknown ids are rejected with no nearest-card guess", () => {
  assert.throws(() => catalog.get("CRAFT-ZZZ-99"), /Unknown craft card: CRAFT-ZZZ-99/);
  assert.throws(() => catalog.get("CRAFT-EXC-1"), /Unknown craft card: CRAFT-EXC-1/);
  assert.throws(() => catalog.generationCard("CRAFT-VOI-1"), /CRAFT-VOI-1/);
});

test("generation cards expose only the positive whitelist", () => {
  const full = catalog.get("CRAFT-VOI-01");
  const generated = catalog.generationCard("CRAFT-VOI-01");
  assert.deepEqual(Object.keys(generated), [...GENERATION_FIELDS]);
  for (const field of GENERATION_FIELDS) {
    if (field === "id") assert.equal(generated.id, full.id);
    else assert.equal(generated[field], full[field]);
  }
  for (const field of ["nearMiss", "diagnosis", "boundaryText", "boundaryContext", "why", "review", "family", "sourceStudyIds"])
    assert.equal(Object.hasOwn(generated, field), false);
  const summary = catalog.candidates().find(entry => entry.id === "CRAFT-VOI-01");
  assert.deepEqual(Object.keys(summary), ["id", "title", "purpose", "useWhen", "avoidWhen"]);
});

test("a reference stays within 1800 bytes and drops a whole example before the core", () => {
  const wide = card(1, true, { context: "C".repeat(2000), stronger: "S".repeat(400) });
  const dropped = renderCraftReference(wide, "REV-SENTINEL", { maxBytes: 9000 });
  assert.ok(dropped);
  assert.equal(dropped.version, "craft-reference-v1");
  assert.equal(dropped.exampleVariant, null);
  assert.ok(dropped.bytes <= 1800);
  assert.equal(dropped.bytes, Buffer.byteLength(dropped.text));
  assert.equal(dropped.assetRevision, "REV-SENTINEL");
  assert.equal(dropped.cardId, "CRAFT-EXC-01");
  assert.ok(!dropped.text.includes("BEGIN SEPARATE EXAMPLE"));
  assert.ok(!dropped.text.includes("C".repeat(40)));
  assert.ok(!dropped.text.includes("REV-SENTINEL"));
  assert.ok(!dropped.text.includes("CRAFT-EXC-01"));
  assert.ok(!dropped.text.includes("NEARMISS-SENTINEL"));
  assert.ok(!dropped.text.includes("DIAGNOSIS-SENTINEL"));
  assert.ok(!dropped.text.includes("BOUNDARY-TEXT-SENTINEL"));
  assert.ok(dropped.text.includes("separate fiction"));
  assert.ok(dropped.text.includes("play_language"));
  assert.ok(dropped.text.includes("not entities"));
});

test("null, a core that cannot fit, and includeExample false omit the reference or the example", () => {
  assert.equal(renderCraftReference(null, catalog.revision, { maxBytes: 1800 }), null);
  const huge = card(1, true, { purpose: "P".repeat(2000) });
  assert.equal(renderCraftReference(huge, catalog.revision, { maxBytes: 1800 }), null);
  const kept = renderCraftReference(catalog.generationCard("CRAFT-VOI-01"), catalog.revision, { maxBytes: 1800 });
  assert.ok(kept && kept.bytes <= 1800 && kept.exampleVariant === "stronger");
  const coreOnly = renderCraftReference(catalog.generationCard("CRAFT-VOI-01"), catalog.revision, {
    maxBytes: 1800, includeExample: false,
  });
  assert.equal(coreOnly.exampleVariant, null);
  assert.ok(!coreOnly.text.includes("BEGIN SEPARATE EXAMPLE"));
  assert.ok(coreOnly.bytes < kept.bytes);
  const alternative = renderCraftReference(card(3), "rev", { maxBytes: 1800 }, "alternative");
  assert.ok(alternative.text.includes("Alternative text"));
  assert.ok(!alternative.text.includes("Stronger text"));
});

test("invalid budgets and non-positive variants throw", () => {
  const sample = catalog.generationCard("CRAFT-EXC-01");
  assert.throws(() => renderCraftReference(sample, catalog.revision, { maxBytes: Number.NaN }));
  assert.throws(() => renderCraftReference(sample, catalog.revision, { maxBytes: -1 }));
  assert.throws(() => renderCraftReference(sample, catalog.revision, { maxBytes: 1800 }, "nearMiss"));
  assert.throws(() => renderCraftReference(sample, "", { maxBytes: 1800 }));
});

test("catalog and reference results are deeply frozen against caller mutation", () => {
  const raw = structuredClone(cards);
  const listed = [...starterIds];
  const built = new CraftCatalog(raw, listed);
  raw[0].title = "changed by caller";
  raw[0].sourceStudyIds.push("LIT-99");
  listed.push("CRAFT-ZZZ-99");
  assert.notEqual(built.get(cards[0].id).title, "changed by caller");
  assert.ok(!built.get(cards[0].id).sourceStudyIds.includes("LIT-99"));
  assert.equal(built.candidateIds.length, 12);
  const stored = built.get("CRAFT-EXC-01");
  assert.ok(Object.isFrozen(stored) && Object.isFrozen(stored.sourceStudyIds) && Object.isFrozen(built.candidateIds));
  assert.throws(() => { stored.title = "no"; });
  assert.throws(() => { stored.sourceStudyIds.push("LIT-02"); });
  assert.throws(() => { built.candidateIds.push("CRAFT-EXC-09"); });
  const generated = built.generationCard("CRAFT-EXC-01");
  const rows = built.candidates();
  assert.ok(Object.isFrozen(generated) && Object.isFrozen(rows) && Object.isFrozen(rows[0]));
  assert.throws(() => { generated.purpose = "no"; });
  assert.throws(() => { rows[0].title = "no"; });
  const rendered = renderCraftReference(generated, built.revision, { maxBytes: 5000 });
  assert.ok(Object.isFrozen(rendered));
  assert.throws(() => { rendered.text = "no"; });
  const copy = structuredClone(cards);
  copy[0].title = `${copy[0].title}!`;
  assert.notEqual(new CraftCatalog(copy, starterIds).revision, built.revision);
});

test("helpers do not touch the filesystem, a provider, or world state", () => {
  assert.equal(craft.loadCatalog, undefined);
  const forbidden = /node:fs|readFile|writeFile|appendFile|mkdir|fetch\s*\(|process\.env|DecisionPort|from\s+['"][^'"]*jev/;
  for (const path of HELPERS) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, forbidden, path);
    assert.equal(source.includes("JSON.stringify(card)"), false, path);
    assert.equal(source.includes("JSON.stringify(value)"), false, path);
  }
  assert.doesNotMatch(readFileSync(join(ROOT, "runtime/craft/reference.ts"), "utf8"), /JSON\.stringify/);
});
