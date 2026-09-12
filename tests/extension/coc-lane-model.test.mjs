/**
 * The lane-model settings section (the model the Keeper's background lanes run on).
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
import { modelReference, SETTINGS_KEY } from "../../pipicoc/settings-lane-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("every caption the lane-model section asks for is authored in the source surface", async () => {
  const source = await readFile(join(ROOT, "pipicoc", "settings-lane-model.js"), "utf8");
  const authored = JSON.parse(await readFile(join(ROOT, "content", "ui", "en", "lane-model.json"), "utf8"));
  const asked = [...source.matchAll(/\bt\("([a-z_]+)"\)/g)].map(match => match[1]);
  assert.ok(asked.length >= 5, "the section asks for its captions through the surface");
  assert.deepEqual([...new Set(asked)].filter(key => !(key in authored)), [],
    "a caption the section asks for is missing from content/ui/en/lane-model.json");
});

test("the section is registered where the settings UI and the package both look", async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, "pipiui-extension.json"), "utf8"));
  const section = manifest.app.ui.settingsSections.find(entry => entry.id === "coc-lane-model");
  assert.ok(section, "the settings UI has no section to render");
  assert.equal(section.entry, "pipicoc/settings-lane-model.js");
  assert.ok(SETTINGS_KEY in manifest.app.settings.schema.properties, "the stored key is undeclared");
});

test("only a provider/model reference is a choice; anything else follows the table", () => {
  assert.equal(modelReference({ model: "deepseek-extended/deepseek-flash" }), "deepseek-extended/deepseek-flash");
  assert.equal(modelReference({ model: "  xai/grok-4.6  " }), "xai/grok-4.6");
  for (const empty of [undefined, null, {}, { model: "" }, { model: "   " }, { model: 7 }, "x", []])
    assert.equal(modelReference(empty), null, JSON.stringify(empty));
});
