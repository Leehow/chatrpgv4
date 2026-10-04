/**
 * Contract §135.27.1.2: the product reads the agent home's `models.json` in exactly Pi's grammar.
 *
 * `runtime/json-comments.ts` is a copy of what Pi's `ModelConfig.load` runs, because Pi does not
 * export it. The first test pins the decisions this tree took (trailing commas and a BOM read, a
 * `/* *\/` comment does not) without needing a build; the other two hold the copy to the vendored Pi
 * itself (`build/node_modules`, ADR-0006 -- the copy the Keeper and every lane child run), so a Pi
 * upgrade that changes its grammar fails here instead of splitting the Keeper's models from the lanes'.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { parseModelsJson, stripJsonComments, stripLineComments } from "../../runtime/json-comments.ts";

const REPO = resolve(import.meta.dirname, "../..");
const VENDORED_PI = join(REPO, "build/node_modules/@earendil-works/pi-coding-agent/dist");
const REAL_PI = existsSync(join(VENDORED_PI, "index.js"));
const NOT_BUILT = !REAL_PI && "vendored Pi not built (npm run build:runtime)";

const PROVIDER = `"custom": {"baseUrl": "http://127.0.0.1:1/v1", "api": "openai-completions", "models": [{"id": "only"}]}`;

/** Every shape an operator's hand can give the file, and the ones Pi's patterns have to step around. */
const CORPUS = {
  strict: `{"providers": {${PROVIDER}}}`,
  "// header": `// mine\n{"providers": {${PROVIDER}}}`,
  "// after a value": `{"providers": {${PROVIDER}} // trailing note\n}`,
  "// inside a string": `{"providers": {"custom": {"baseUrl": "http://127.0.0.1:1/v1", "api": "openai-completions", "models": [{"id": "only"}]}}}`,
  "escaped quote then //": `{"providers": {"custom": {"baseUrl": "http://x/\\"//not-a-comment", "api": "openai-completions", "models": [{"id": "only"}]}}}`,
  "CRLF // comment": `{\r\n  // mine\r\n  "providers": {${PROVIDER}}\r\n}`,
  "trailing commas": `{"providers": {"custom": {"baseUrl": "http://127.0.0.1:1/v1", "api": "openai-completions", "models": [{"id": "only"},],},},}`,
  "trailing comma then // comment": `{"providers": {${PROVIDER}, // last one\n},\n}`,
  "comma and bracket inside a string": `{"providers": {"custom": {"baseUrl": "http://x/,}", "api": "openai-completions", "models": [{"id": "only,]"}]}}}`,
  BOM: `﻿{"providers": {${PROVIDER}}}`,
  "BOM and trailing comma": `﻿{"providers": {${PROVIDER},}}`,
  "/* */ comment": `/* mine */\n{"providers": {${PROVIDER}}}`,
  "/* // */ comment": `{"providers": {${PROVIDER}} /* see // below */}`,
  "single-quoted string": `{'providers': {${PROVIDER}}}`,
  empty: "",
};

function outcome(text) {
  try { return { ok: true, value: parseModelsJson(text) }; }
  catch { return { ok: false }; }
}

test("the product's reader takes trailing commas and a BOM, and refuses /* */, as Pi does", () => {
  for (const name of ["strict", "// header", "trailing commas", "trailing comma then // comment", "BOM", "BOM and trailing comma"])
    assert.deepEqual(Object.keys(outcome(CORPUS[name]).value?.providers ?? {}), ["custom"], name);
  for (const name of ["/* */ comment", "/* // */ comment", "single-quoted string", "empty"])
    assert.equal(outcome(CORPUS[name]).ok, false, name);
  assert.equal(parseModelsJson(CORPUS["comma and bracket inside a string"]).providers.custom.models[0].id, "only,]");
  // Only `//` is a comment: a trailing comma or a BOM is not something a rewrite would lose.
  assert.equal(stripLineComments(CORPUS["trailing commas"]), CORPUS["trailing commas"]);
  assert.equal(stripLineComments(CORPUS.BOM), CORPUS.BOM);
  assert.notEqual(stripLineComments(CORPUS["// header"]), CORPUS["// header"]);
  assert.equal(stripLineComments(CORPUS["// inside a string"]), CORPUS["// inside a string"]);
});

test("the copy strips exactly what the vendored Pi's own stripJsonComments strips", { skip: NOT_BUILT }, async () => {
  const pi = await import(pathToFileURL(join(VENDORED_PI, "utils/json.js")).href);
  for (const [name, text] of Object.entries(CORPUS)) assert.equal(stripJsonComments(text), pi.stripJsonComments(text), name);
});

test("every shape parses here exactly when the vendored Pi's ModelConfig.load parses it, to the same providers", { skip: NOT_BUILT }, async t => {
  const { ModelConfig } = await import(pathToFileURL(join(VENDORED_PI, "core/model-config.js")).href);
  const dir = mkdtempSync(join(tmpdir(), "models-json-grammar-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(CORPUS)) {
    const path = join(dir, "models.json");
    writeFileSync(path, text);
    const pi = await ModelConfig.load(path);
    const mine = outcome(text);
    const piFailed = /^Failed to parse models\.json/.test(pi.getError() ?? "");
    assert.equal(mine.ok, !piFailed, `${name}: product ${mine.ok ? "parsed" : "refused"}, Pi ${piFailed ? "refused" : "parsed"}`);
    if (!mine.ok) continue;
    assert.equal(pi.getError(), undefined, `${name}: the corpus entry must satisfy Pi's schema to compare providers`);
    assert.deepEqual(pi.getProviderIds(), Object.keys(mine.value.providers), name);
    for (const id of pi.getProviderIds()) assert.deepEqual(pi.getProvider(id), mine.value.providers[id], `${name}: ${id}`);
  }
});
