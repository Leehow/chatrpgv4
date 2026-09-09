import {pythonOracleEnvironment} from "../python-oracle.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("ontology vocabularies match the current Python implementation without content files", () => {
  const run = spawnSync("uv", ["run", "--frozen", "python", "-c", [
    "import json, sys",
    "from pathlib import Path",
    "from coc.rules.graph import REGISTERED_CONDITION_PATHS",
    "from coc.rules.runtime import RulesEngine",
    "from coc.rules.tables import RuleTables",
    "content = Path(sys.argv[1]) / 'absent-content'",
    "assert not content.exists()",
    "engine = RulesEngine(content, RuleTables(content / 'rulesets/coc7/rules-json'))",
    "print(json.dumps({'registered_condition_paths': sorted(REGISTERED_CONDITION_PATHS), 'resolver_names': sorted(engine.resolver_index())}))",
  ].join("\n"), temporary], { cwd: REPO, env:pythonOracleEnvironment(), encoding: "utf8", timeout: 30000 });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  const reference = JSON.parse(run.stdout);
  assert.deepEqual(REGISTERED_CONDITION_PATHS, reference.registered_condition_paths);
  assert.deepEqual(RESOLVER_NAMES, reference.resolver_names);
  assert.deepEqual(Object.keys(bundle.metafile.inputs).map(path => resolve(path)), [join(REPO, "kernel-ts/capabilities.ts")]);
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
