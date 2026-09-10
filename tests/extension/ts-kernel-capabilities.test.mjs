import assert from "node:assert/strict";

import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = await mkdtemp(join(tmpdir(), "pi-coc-capabilities-"));
after(async () => { await rm(temporary, { recursive: true, force: true }); });
await symlink(join(REPO, "node_modules"), join(temporary, "node_modules"), "dir");
const bundle = await build({
  entryPoints: { capabilities: join(REPO, "kernel-ts/capabilities.ts") },
  outdir: temporary, outExtension: { ".js": ".mjs" },
  bundle: true, format: "esm", platform: "node", target: "node22", metafile: true, logLevel: "silent",
});
const { REGISTERED_CONDITION_PATHS, RESOLVER_NAMES } = await import(pathToFileURL(join(temporary, "capabilities.mjs")).href);

test("the ontology vocabularies are declared without reading content or anything else", () => {
  // The declarations are a closed list the kernel carries, not something assembled from the rules
  // data at import: the module bundles to itself alone, with no content file and no other input.
  assert.deepEqual(Object.keys(bundle.metafile.inputs).map(path => resolve(path)), [join(REPO, "kernel-ts/capabilities.ts")]);
  assert.ok(REGISTERED_CONDITION_PATHS.length && RESOLVER_NAMES.length);
});

test("the closed declarations cannot be changed by ontology consumers", () => {
  for (const values of [REGISTERED_CONDITION_PATHS, RESOLVER_NAMES]) {
    assert.equal(Object.isFrozen(values), true);
    assert.equal(new Set(values).size, values.length);
    assert.throws(() => values.push("invented.capability"), TypeError);
    assert.throws(() => { values[0] = "invented.capability"; }, TypeError);
  }
});

test("declared resolver names do not enable unmigrated kernel dispatch", async () => {
  await build({
    entryPoints: [join(REPO, "kernel-ts/testing/api.ts")],
    outfile: join(temporary, "api.mjs"),
    bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
  });
  const api = await import(pathToFileURL(join(temporary, "api.mjs")).href);
  const context = await api.createKernelContext({ workspace: temporary, content: join(REPO, "content"), seed: "capability-declarations" });
  const methods = api.assembleHandlers(context, api.foundationHandlers(context));
  for (const name of RESOLVER_NAMES) assert.equal(Object.hasOwn(methods, name), false, name);
  for (const method of ["table.resolve", "table.apply"]) {
    const response = await api.handleLine(JSON.stringify({ id: method, method, params: {} }), methods);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "not_implemented");
  }
});
