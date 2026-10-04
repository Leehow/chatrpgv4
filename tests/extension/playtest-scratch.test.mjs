import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { inspectRun, KEPT_NOTE, OWNER, RUN_OWNER, SCRATCH_ROOT } from "./playtest-scratch.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const HELPER = pathToFileURL(join(import.meta.dirname, "playtest-scratch.mjs")).href;

function child(t, body, options = "") {
  const env = { ...process.env };
  delete env.COC_TEST_SCRATCH_RUN;
  const script = `import {playtestScratch} from ${JSON.stringify(HELPER)};\nconst directory = playtestScratch('lifecycle-selftest', 'suite-', ${options || "{}"});\nprocess.stdout.write(directory);\n${body}`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" });
  const directory = result.stdout;
  assert.ok(directory.startsWith(SCRATCH_ROOT + "/run-"), result.stderr);
  t.after(() => {
    const run = dirname(directory);
    if (existsSync(run)) {
      const owner = JSON.parse(readFileSync(join(run, RUN_OWNER), "utf8"));
      assert.equal(owner.kind, "node-contract-test-run");
      rmSync(run, { recursive: true, force: true });
    }
  });
  return { ...result, directory };
}

test("contract fixtures do not allocate inside the real playtest evidence tree", () => {
  const sources = [];
  for (const [directory, suffix] of [["tests/extension", ".mjs"], ["tests/kernel", ".py"], ["tests", ".py"]]) {
    for (const name of readdirSync(join(ROOT, directory))) if (name.endsWith(suffix)) sources.push(`${directory}/${name}`);
  }
  const pattern = /['"]\.coc\/playtests|['"]\.coc['"]\s*[,/]\s*['"]playtests['"]/;
  assert.deepEqual(sources.filter((path) => pattern.test(readFileSync(join(ROOT, path), "utf8"))), []);
});

test("a passing process removes only its own scratch, including read-only corners", (t) => {
  const { directory, status, stderr } = child(t, `
    import {chmodSync, mkdirSync, writeFileSync} from 'node:fs';
    import {join} from 'node:path';
    mkdirSync(join(directory, 'locked'));
    writeFileSync(join(directory, 'locked', 'data'), 'fixture');
    chmodSync(join(directory, 'locked'), 0o500);
  `);
  assert.equal(status, 0, stderr);
  assert.equal(existsSync(directory), false);
  assert.equal(existsSync(dirname(directory)), false);
});

test("ordinary failure retains the allocation with its initial owner and failure note", (t) => {
  const { directory, status } = child(t, "process.exitCode = 1;");
  assert.equal(status, 1);
  const owner = JSON.parse(readFileSync(join(directory, OWNER), "utf8"));
  const note = JSON.parse(readFileSync(join(directory, KEPT_NOTE), "utf8"));
  assert.equal(owner.kind, "node-contract-test-scratch");
  assert.equal(note.owner_id, owner.id);
  assert.deepEqual([note.status, note.exit_code], ["failed", 1]);
  assert.deepEqual(inspectRun(dirname(directory)), { kept: [directory], leaked: [] });
});

test("explicit retention keeps a successful fixture without treating it as a leak", (t) => {
  const { directory, status } = child(t, "", "{retain: true}");
  assert.equal(status, 0);
  assert.equal(JSON.parse(readFileSync(join(directory, KEPT_NOTE), "utf8")).status, "retained");
  assert.deepEqual(inspectRun(dirname(directory)), { kept: [directory], leaked: [] });
});

test("SIGINT and SIGTERM preserve evidence with the signal, without success cleanup", (t) => {
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const result = child(t, `setInterval(() => {}, 1000); process.kill(process.pid, '${signal}');`);
    assert.equal(result.status, code, result.stderr);
    const note = JSON.parse(readFileSync(join(result.directory, KEPT_NOTE), "utf8"));
    assert.deepEqual([note.status, note.signal, note.exit_code], ["interrupted", signal, code]);
  }
});

test("SIGKILL leaves initial ownership and is detected only in that unfinished run", (t) => {
  const interrupted = child(t, "process.kill(process.pid, 'SIGKILL');");
  const concurrent = child(t, "", "{retain: true}");
  assert.equal(interrupted.signal, "SIGKILL");
  assert.equal(existsSync(join(interrupted.directory, OWNER)), true);
  assert.deepEqual(inspectRun(dirname(interrupted.directory)), { kept: [], leaked: [interrupted.directory] });
  assert.deepEqual(inspectRun(dirname(concurrent.directory)), { kept: [concurrent.directory], leaked: [] });
});

test("cleanup refuses a replaced allocation and does not follow a symlink to another directory", (t) => {
  const result = child(t, `
    import {mkdirSync, renameSync, symlinkSync, writeFileSync} from 'node:fs';
    import {join} from 'node:path';
    const foreign = directory + '-foreign';
    mkdirSync(foreign);
    writeFileSync(join(foreign, 'sentinel'), 'keep');
    renameSync(directory, directory + '-original');
    symlinkSync(foreign, directory, 'dir');
  `);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /cleanup refused/);
  assert.equal(readFileSync(join(result.directory + "-foreign", "sentinel"), "utf8"), "keep");
  assert.equal(existsSync(result.directory + "-original"), true);
});

test("invalid path components cannot allocate outside the dedicated test root", () => {
  const script = `import {playtestScratch} from ${JSON.stringify(HELPER)}; playtestScratch('../foreign');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid test scratch/);
});
