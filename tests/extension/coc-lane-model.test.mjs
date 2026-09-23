/**
 * The fast-model settings section (contract §37.10.1): the one quick model every lane that has to be
 * quick runs on. Its storage key is still `ext.coc-keeper.laneModel`.
 *
 * The section keeps no word table of its own: a caption it asks for and the surface lacks renders
 * as the identifier, which is a visible gap rather than another language's word. That only holds
 * while every key it asks for is authored, so this checks the two halves against each other.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_THINKING_DEFAULT, modelReference, sectionCaptions, SETTINGS_KEY, THINKING_LEVELS, thinkingReference } from "../../pipicoc/settings-lane-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("every caption the lane-model section asks for is authored in the source surface", async () => {
  const source = await readFile(join(ROOT, "pipicoc", "settings-lane-model.js"), "utf8");
  const authored = JSON.parse(await readFile(join(ROOT, "content", "ui", "en", "lane-model.json"), "utf8"));
  const asked = [...source.matchAll(/\bt\("([a-z_]+)"\)/g)].map(match => match[1]);
  assert.ok(asked.length >= 5, "the section asks for its captions through the surface");
  assert.deepEqual([...new Set(asked)].filter(key => !(key in authored)), [],
    "a caption the section asks for is missing from content/ui/en/lane-model.json");
});

/**
 * The sidebar entry used to be named in two hand-written Chinese strings -- the manifest's section
 * title and a row in the host's nav-hint table -- which is a per-language word table by another name
 * (§23). The entry now names itself from its own surface, so the three nav captions must be authored
 * keys and must be what `sectionCaptions` answers with; the manifest keeps only an English fallback.
 */
test("the sidebar entry names itself from the section's own surface", async () => {
  const authored = JSON.parse(await readFile(join(ROOT, "content", "ui", "en", "lane-model.json"), "utf8"));
  for (const key of ["section_title", "section_hint", "section_description"])
    assert.ok(typeof authored[key] === "string" && authored[key].trim(), `${key} is not authored`);
  const asked = [];
  const api = { invoke: async (method, params) => { asked.push([method, params]);
    return { ok: true, data: { ui: { tag: "en", words: { "lane-model": authored } } } }; } };
  assert.deepEqual(await sectionCaptions(api),
    { label: authored.section_title, hint: authored.section_hint, description: authored.section_description });
  assert.deepEqual(asked, [["ui-words", {}]], "the entry asks the host the same way its body does");
  // No answer is no captions: the loader then keeps the manifest's title rather than drawing keys.
  assert.equal(await sectionCaptions({ invoke: async () => ({ ok: false }) }), undefined);
  assert.equal(await sectionCaptions({ invoke: async () => { throw new Error("offline"); } }), undefined);
  assert.equal(await sectionCaptions(undefined), undefined);
  const manifest = JSON.parse(await readFile(join(ROOT, "pipiui-extension.json"), "utf8"));
  const section = manifest.app.ui.settingsSections.find(entry => entry.id === "coc-lane-model");
  assert.equal(section.title, authored.section_title, "the manifest's fallback is the English source's own title");
  const host = await readFile(join(ROOT, "Electron", "packages", "ui", "src", "ModelVisibilityModal.tsx"), "utf8");
  assert.doesNotMatch(host, /'coc-lane-model'\s*:/, "the host's hint table must not name this entry by hand again");
});

test("the section is registered where the settings UI and the package both look", async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, "pipiui-extension.json"), "utf8"));
  const section = manifest.app.ui.settingsSections.find(entry => entry.id === "coc-lane-model");
  assert.ok(section, "the settings UI has no section to render");
  assert.equal(section.entry, "pipicoc/settings-lane-model.js");
  assert.ok(SETTINGS_KEY in manifest.app.settings.schema.properties, "the stored key is undeclared");
});

/**
 * Contract §37.10: the setting must not travel in the session's spawn environment.
 *
 * It used to. The host resolved `ext.coc-keeper.laneModel` at spawn and wrote it into the child's
 * `PI_COC_MOD_MODEL`, and `runtime/tasks.ts` treats that variable as the operator's override, which
 * wins over everything. A process environment cannot change, so the value a table ran with was the
 * one that stood when its session started: on 2026-09-14 the choice moved off `grok-build/grok-4.6`
 * at 06:42 and the review child launched at 06:43 still ran it, baked in at 06:30. Reading the
 * setting live does nothing at all while the stale variable is still there to win — this is the half
 * of the fix no runtime test can see, so it is checked at the source.
 */
test("the host does not hand the lane setting to a child as an environment variable", async () => {
  const host = await readFile(join(ROOT, "Electron", "packages", "pi-backend", "src", "index.ts"), "utf8");
  // A read (`this.env.PI_COC_MOD_MODEL`) is the operator's own override and stays. A write
  // (`PI_COC_MOD_MODEL:` inside an environment object) is the setting wearing its clothes.
  assert.deepEqual([...host.matchAll(/PI_COC_MOD_(?:MODEL|THINKING)\s*:/g)].map(match => match[0]), [],
    "the lane setting is being injected into a spawn environment again");
  assert.ok(/this\.env\.PI_COC_MOD_MODEL\?\.trim\(\)/.test(host),
    "the operator's own environment override is no longer honoured");
});

/**
 * Contract §37.11: the unchosen effort is the lane's own, and the panel shows the level it will run.
 *
 * Two copies of one value — the runtime decides it, the panel displays it — so they are pinned to
 * each other here. A panel that advertises a level the lane does not use is the same defect as the
 * one this change removes: a setting that reads correctly and does something else.
 */
test("the panel's unchosen level is the one the runtime actually runs", async () => {
  const runtime = await readFile(join(ROOT, "runtime", "fast-model.ts"), "utf8");
  const declared = /const LANE_THINKING_DEFAULT = "([a-z]+)";/.exec(runtime);
  assert.ok(declared, "runtime/fast-model.ts no longer declares a lane default");
  assert.equal(declared[1], LANE_THINKING_DEFAULT, "the panel advertises a level the runtime does not use");
  assert.ok(THINKING_LEVELS.includes(LANE_THINKING_DEFAULT), "the default is one of the runtime's own levels");
  // `low` rather than `off` or `minimal` is a fact about the authorized lane models' thinking maps,
  // not a taste: `grok-build/grok-4.6` maps `off` to null and pi clamps a requested `off` up to
  // `minimal`, while the DeepSeek family maps `minimal` to null and clamps that up to `low`. A
  // default whose meaning changes with the lane model is the wrong coupling in another costume.
  const grok = await readFile(join(ROOT, "extensions", "grok-build-oauth", "agent", "models.js"), "utf8");
  assert.match(grok, /thinkingLevelMap:\s*\{\s*off:\s*null/, "grok-build no longer refuses `off`; re-read the default");
  const deepseek = await readFile(join(ROOT, "extensions", "deepseek", "agent", "models.js"), "utf8");
  assert.match(deepseek, /minimal:\s*null/, "the DeepSeek family no longer refuses `minimal`; re-read the default");
  for (const map of [grok, deepseek]) assert.match(map, /low:\s*"low"/, "a level both families support as written");
});

test("following the table's effort is not a reachable choice at all", () => {
  // It added no capability — every level it could produce is directly selectable — and its one
  // distinctive behaviour was to change under the operator when the table's effort changed, which
  // is the failure. So there is no sentinel to store and nothing that accepts one (§37.11).
  for (const sentinel of ["table", "follow", "auto", "inherit", ""])
    assert.equal(thinkingReference({ level: sentinel }), null, sentinel);
  assert.equal(thinkingReference(null), null, "no choice stored is the lane's own level, not the table's");
});

test("only a provider/model reference is a choice; anything else follows the table", () => {
  assert.equal(modelReference({ model: "deepseek-extended/deepseek-flash" }), "deepseek-extended/deepseek-flash");
  assert.equal(modelReference({ model: "  xai/grok-4.6  " }), "xai/grok-4.6");
  for (const empty of [undefined, null, {}, { model: "" }, { model: "   " }, { model: 7 }, "x", []])
    assert.equal(modelReference(empty), null, JSON.stringify(empty));
});
