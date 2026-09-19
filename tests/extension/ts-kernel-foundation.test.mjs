import assert from "node:assert/strict";
import { withoutPostFreezeRecovery } from "./oracle-fixture.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fstatSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = await mkdtemp(join(tmpdir(), "pi-coc TS foundation "));
after(async () => { await rm(temporary, { recursive: true, force: true }); });
await symlink(join(REPO, "node_modules"), join(temporary, "node_modules"), "dir");
await build({
  entryPoints: { rpc: join(REPO, "kernel-ts/rpc.ts"), api: join(REPO, "kernel-ts/testing/api.ts") },
  outdir: temporary, outExtension: { ".js": ".mjs" },
  bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
});
const api = await import(pathToFileURL(join(temporary, "api.mjs")).href);
const reference = JSON.parse(await readFile(join(REPO, "kernel-ts/testing/python-reference.json"), "utf8"));

async function workspace(name) {
  const path = join(temporary, name);
  await mkdir(path, { recursive: true });
  return path;
}

async function populate(path) {
  for (const [name, source] of Object.entries(reference.rpc.files)) {
    const destination = join(path, ".coc/campaigns", name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source);
  }
}

async function context(name, extra = {}) {
  return api.createKernelContext({ workspace: await workspace(name), content: join(REPO, "content"), seed: "foundation", ...extra });
}

function decode(value) { return JSON.parse(api.pythonJsonDumps(value)); }

test("the public vocabulary and error frames match the locked Python reference", async () => {
  assert.equal(reference.python, "3.14.6");
  const currentOnly = new Set(["table.release", "table.switch", "table.workspace.read", "setup.override", "mods.queued", "mods.review.status", "setup.note", "journal.job", "journal.submit", "journal.fail",
    "voice.job", "voice.submit", "voice.fail",
    "adaptation.prepare", "adaptation.status", "adaptation.draft", "adaptation.review", "adaptation.fail", "adaptation.cancel",
    "mods.prefetch.accept", "mods.prefetch.targets", "module.read.unwait"]);
  assert.deepEqual([...api.KNOWN_METHODS].filter(name => !currentOnly.has(name)).sort(), reference.rpc.methods);
  for (const name of currentOnly) assert.ok(api.KNOWN_METHODS.includes(name), name);
  const ctx = await context("error frames");
  const handlers = api.assembleHandlers(ctx, api.foundationHandlers(ctx));
  assert.equal(Object.isFrozen(handlers), true);
  assert.equal(Object.isFrozen(ctx), true);
  assert.equal(Object.isFrozen(ctx.snapshots), true);
  // Exercise the frozen vocabulary without rewriting its historical error frames.
  const historicalHandlers = Object.freeze(Object.fromEntries(Object.entries(handlers)
    .filter(([name]) => !currentOnly.has(name))));
  for (const row of reference.rpc.invalid) {
    assert.deepEqual(withoutPostFreezeRecovery(decode(await api.handleLine(row.line, historicalHandlers))), row.response, row.line);
  }
  const currentError = decode(await api.handleLine('{"id":"current","method":"unknown"}', handlers));
  assert.deepEqual(currentError.error.details.methods, [...api.KNOWN_METHODS].sort());
  for (const name of reference.rpc.methods.filter(name => !["kernel.hello", "campaign.list"].includes(name))) {
    const response = await api.handleLine(JSON.stringify({ id: "unmigrated", method: name }), handlers);
    assert.equal(response.ok, false, name);
    assert.equal(response.error.code, "not_implemented", name);
  }
  assert.throws(() => api.assembleHandlers(ctx, { "undeclared.method": () => ({}) }), /undeclared/);
  assert.throws(() => api.assembleHandlers(ctx, api.foundationHandlers(ctx), api.foundationHandlers(ctx)), /duplicate/);
});

test("canonical hashes and stored JSON preserve Python numeric types, Unicode order and dict order", () => {
  for (const row of reference.json) {
    const value = api.parsePythonJson(row.source);
    assert.equal(api.canonicalJson(value), row.canonical, row.source);
    assert.equal(api.jsonDigest(value), row.sha256, row.source);
    assert.equal(api.storedJson(value), row.stored, row.source);
    assert.equal(api.pythonJsonDumps(value) + "\n", row.line, row.source);
  }
  assert.notEqual(api.jsonDigest({ value: 1 }), api.jsonDigest({ value: new api.PythonFloat(1) }));
  assert.equal(api.canonicalJson({ value: -0 }), '{"value":-0.0}');
  assert.throws(() => api.canonicalJson({ value: 9007199254740992 }), /unsafe integer/);
  assert.equal(api.canonicalJson({ value: 9007199254740993n }), '{"value":9007199254740993}');
  assert.equal(api.canonicalJson({ value: new api.PythonFloat(1e16) }), '{"value":1e+16}');
  assert.throws(() => api.sha256Text("\ud800"), /unpaired surrogate/);
  assert.throws(() => JSON.stringify(new api.PythonFloat(1)), /numeric identity/);
  assert.throws(() => api.canonicalJson({ missing: undefined }), /unsupported/);
  assert.throws(() => api.canonicalJson(new Date()), /unsupported/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => api.canonicalJson(cyclic), /Circular/);
  assert.equal(Object.prototype.safe, undefined);
  const ordered = api.orderedObject([["10", "ten"], ["2", "two"], ["1", "one"]]);
  assert.equal(api.pythonJsonDumps(ordered), '{"10": "ten", "2": "two", "1": "one"}');
});

test("float formatting matches Python over fixed IEEE-754 bit patterns", () => {
  for (const row of reference.floats) {
    const value = Buffer.from(row.bits, "hex").readDoubleBE();
    assert.equal(api.pythonFloatRepr(value), row.text, row.bits);
  }
});

test("string, integer and worldline seeds reproduce Python sampling including repeated twists", () => {
  for (const row of reference.rng) {
    const seed = row.seed.type === "string" ? row.seed.value : BigInt(row.seed.value);
    const rng = new api.PythonRandom(seed);
    const label = `${row.seed.type}:${row.seed.value.slice(0, 50)}`;
    assert.deepEqual(row.random.map(() => rng.random()), row.random, label);
    assert.deepEqual(row.widths.map(width => String(rng.getrandbits(width))), row.bits, label);
    assert.deepEqual(row.limits.map(limit => String(rng.randbelow(BigInt(limit)))), row.below, label);
    assert.deepEqual(row.ranges.map(values => String(rng.randrange(...values.map(BigInt)))), row.ranged, label);
    assert.deepEqual(row.integers.map(values => String(rng.randint(...values.map(BigInt)))), row.dice, label);
    assert.deepEqual(row.choice.map(() => rng.choice(["first", "second", "third", "fourth", "fifth"])), row.choice, label);
    const sequence = Array.from({ length: 21 }, (_, index) => index);
    assert.equal(rng.shuffle(sequence), undefined);
    assert.deepEqual(sequence, row.shuffled, label);
    rng.shuffle([]); rng.shuffle(["only"]);
    assert.equal(rng.random(), row.tail, label);
    const stream = new api.PythonRandom(seed);
    const bytes = Buffer.alloc(2000 * 4);
    for (let index = 0; index < 2000; index++) bytes.writeUInt32BE(Number(stream.getrandbits(32)), index * 4);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.stream_sha256, label);
    stream.seed(seed);
    assert.equal(stream.random(), row.random[0], label);
  }
});

test("RNG number APIs retain draws and refuse lossy integers without consuming the stream", () => {
  const a = new api.PythonRandom("number arguments");
  const b = new api.PythonRandom("number arguments");
  assert.equal(a.getrandbits(0), 0n);
  assert.throws(() => a.seed(Number.MAX_SAFE_INTEGER + 1), /safe integer/);
  assert.throws(() => a.getrandbits(-1), /non-negative/);
  assert.throws(() => a.getrandbits(0.5), /non-negative/);
  assert.throws(() => a.randrange(5, 5), /empty range/);
  assert.throws(() => a.randrange(0, 5, 0), /zero step/);
  assert.throws(() => a.randrange(10, undefined, 2), /stop/);
  assert.throws(() => a.randint(10, 1), /empty range/);
  assert.throws(() => a.choice([]), /empty sequence/);
  assert.equal(a.randrange(10), Number(b.randrange(10n)));
  assert.equal(a.randrange(50, -40, -3), Number(b.randrange(50n, -40n, -3n)));
  assert.equal(a.randint(-50, 50), Number(b.randint(-50n, 50n)));
  assert.equal(a.randbelow(100), Number(b.randbelow(100n)));
  assert.equal(a.random(), b.random());
  assert.equal(new api.PythonRandom(0).random(), new api.PythonRandom(0n).random());
  assert.notEqual(new api.PythonRandom("0").random(), new api.PythonRandom(0).random());
  assert.throws(() => new api.PythonRandom("\ud800"), /unpaired surrogate/);
});

test("actual JSONL subprocess serves hello and existing campaigns and drains EOF", async () => {
  const path = await workspace("subprocess with spaces");
  await populate(path);
  const requests = [
    { id: "hello", method: "kernel.hello", params: null },
    { id: "list", method: "campaign.list" },
    { id: "registered invalid job", method: "mods.job", params: {} },
    { id: "unknown", method: "table.not_real" },
    { id: "after errors", method: "kernel.hello" },
  ];
  const run = spawnSync(process.execPath, [join(temporary, "rpc.mjs"), "--workspace", path, "--content", join(REPO, "content")], {
    cwd: temporary, encoding: "utf8", timeout: 10000,
    input: "\n" + requests.map(value => JSON.stringify(value)).join("\r\n"),
  });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  const responses = run.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(responses.length, requests.length);
  assert.deepEqual(responses.map(row => row.id), requests.map(row => row.id));
  assert.deepEqual(responses[0].result, reference.rpc.hello);
  const listLine = run.stdout.split("\n")[1];
  assert.equal(listLine, '{"id": "list", "ok": true, "result": ' + reference.rpc.campaign_list_line + '}');
  assert.deepEqual(responses[2].error, {code: "invalid_params", message: "params.campaign is required", next: "change_input", retryable: false});
  assert.equal(responses[3].error.code, "unknown_method");
  assert.deepEqual(responses[4].result, reference.rpc.hello);
  assert.match(run.stderr, /ready workspace=/);
  assert.match(run.stderr, /stdin closed; exiting/);
  assert.deepEqual(await readdir(join(path, ".coc")), ["campaigns"]);
  for (const [name, source] of Object.entries(reference.rpc.files)) {
    assert.equal(await readFile(join(path, ".coc/campaigns", name), "utf8"), source);
  }
});

test("read-only handlers use fresh snapshots and Python content filtering", async () => {
  const path = await workspace("fresh reads");
  const content = await workspace("custom content");
  for (const name of ["coc7", "zeta", "\ue000", "\u{10000}"]) await mkdir(join(content, "rulesets", name), { recursive: true });
  await writeFile(join(content, "rulesets", "not-a-directory"), "ignored");
  for (const name of ["zeta", "alpha", "ignored"]) await mkdir(join(content, "starters", name), { recursive: true });
  await writeFile(join(content, "starters", "zeta", "module-graph.json"), "{}");
  await writeFile(join(content, "starters", "alpha", "module-graph.json"), "{}");
  const ctx = await api.createKernelContext({ workspace: path, content, seed: "read test" });
  const methods = api.buildHandlers(ctx);
  assert.deepEqual((await methods["kernel.hello"]({})).content, { rulesets: ["coc7", "zeta", "\ue000", "\u{10000}"], modules: ["alpha", "zeta"] });
  assert.deepEqual(await methods["campaign.list"]({}), reference.rpc.empty_list);
  await populate(path);
  const first = await methods["campaign.list"]({});
  assert.equal(api.pythonJsonDumps(first), reference.rpc.campaign_list_line);
  await writeFile(join(path, ".coc/campaigns/zeta/turn.json"), '{"turn":9}');
  assert.equal((await methods["campaign.list"]({})).campaigns.find(row => row.id === "zeta").turn, 9);
  const snapshot = await api.readJson(join(path, ".coc/campaigns/zeta/campaign.json"));
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => { snapshot.title = "mutated"; }, TypeError);
  await writeFile(join(path, ".coc/campaigns/zeta/campaign.json"), "[]");
  const broken = await api.handleLine('{"id":"broken","method":"campaign.list"}', methods);
  assert.equal(broken.error.code, "internal");
  assert.equal(broken.error.message, "AttributeError: 'list' object has no attribute 'get'");
});

test("transport awaits each asynchronous handler and handles split UTF-8 and CRLF", async () => {
  const entered = [];
  let inFlight = false;
  const methods = { "kernel.hello": async params => {
    assert.equal(inFlight, false);
    inFlight = true;
    entered.push(params.order);
    await new Promise(resolve => setImmediate(resolve));
    inFlight = false;
    return { text: params.text };
  } };
  const source = [1, 2, 3].map(order => JSON.stringify({ id: String(order), method: "kernel.hello", params: { order, text: "\u8c03\u67e5\u{1f3b2}" } })).join("\r\n");
  const chunks = [...Buffer.from(source)].map(byte => Buffer.from([byte]));
  let output = "";
  await api.serve(Readable.from(chunks), new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } }), methods);
  assert.deepEqual(entered, [1, 2, 3]);
  const responses = output.trim().split("\n").map(JSON.parse);
  assert.deepEqual(responses.map(row => row.id), ["1", "2", "3"]);
  assert.equal(responses[0].result.text, "\u8c03\u67e5\u{1f3b2}");
  await assert.rejects(api.serve(Readable.from([Buffer.from([0xff])]), new Writable({ write(_chunk, _encoding, done) { done(); } }), methods), /encoded data/);
});

test("invalid deployment roots fail without response frames or state writes", async () => {
  const path = join(temporary, "nonexistent workspace");
  const run = spawnSync(process.execPath, [join(temporary, "rpc.mjs"), "--workspace", path, "--content", join(temporary, "missing content")], { encoding: "utf8", timeout: 10000 });
  assert.equal(run.status, 2);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /has no rulesets\/coc7/);
  assert.equal(await api.pathExists(path), false);
  const file = join(temporary, "workspace-is-a-file");
  await writeFile(file, "unchanged");
  await assert.rejects(api.createKernelContext({ workspace: file, content: join(REPO, "content") }), /not a directory/);
  assert.equal(await readFile(file, "utf8"), "unchanged");
});

test("atomic writes, JSONL and failure cleanup retain Python stored bytes", async () => {
  const root = await workspace("file primitives");
  const target = join(root, "nested", "state.json");
  const row = reference.json[2];
  await api.writeJsonAtomic(target, api.parsePythonJson(row.source));
  assert.equal(await readFile(target, "utf8"), row.stored);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  assert.equal(await api.sha256File(target), createHash("sha256").update(row.stored).digest("hex"));
  await assert.rejects(api.writeJsonAtomic(target, { value: 9007199254740992 }), /unsafe integer/);
  await assert.rejects(api.writeTextAtomic(target, "\ud800"), /unpaired surrogate/);
  assert.equal(await readFile(target, "utf8"), row.stored);
  const directory = join(root, "rename target directory");
  await mkdir(directory);
  await assert.rejects(api.writeTextAtomic(directory, "cannot replace directory"));
  assert.equal((await readdir(root)).some(name => name.startsWith(".tmp-")), false);
  const actual = join(root, "symlink target");
  const linked = join(root, "symlink destination");
  await writeFile(actual, "original");
  await symlink(actual, linked);
  await api.writeTextAtomic(linked, "replacement");
  assert.equal(await readFile(actual, "utf8"), "original");
  assert.equal(await readFile(linked, "utf8"), "replacement");
  const log = join(root, "events.jsonl");
  assert.deepEqual(await api.readJsonl(log), []);
  await api.appendJsonl(log, api.parsePythonJson(row.source));
  const priorSize = await api.fileSize(log);
  await api.appendJsonl(log, { later: true });
  assert.equal((await api.readJsonl(log)).length, 2);
  await api.truncateFile(log, priorSize);
  assert.equal(await readFile(log, "utf8"), row.line);
  assert.equal((await api.readJsonl(log)).length, 1);
  await writeFile(log, '\u00a0 {"value": 1} \u0085\r\n\u001c\r\n');
  assert.deepEqual(await api.readJsonl(log), [{ value: 1 }]);
  assert.equal(await api.fileSize(join(root, "absent")), 0);
  await api.truncateFile(join(root, "absent"), 0);
});

test("descriptor lock seam retains inode lifetime and fails closed without native flock", async () => {
  const root = await workspace("lock lifecycle");
  const missing = join(root, "not-created", "lock");
  await assert.rejects(api.createAdvisoryLocks().acquire(missing, "exclusive", { createParents: true }), error => error.code === "not_implemented");
  assert.equal(await api.pathExists(dirname(missing)), false);
  const operations = [];
  let descriptor;
  const locks = api.createAdvisoryLocks(async (fd, operation) => {
    descriptor = fd;
    fstatSync(fd);
    operations.push(operation);
  });
  const path = join(root, "persistent.lock");
  const lease = await locks.acquire(path, "exclusive", { createParents: true });
  const inode = (await stat(path)).ino;
  const firstRelease = lease.release();
  assert.equal(lease.release(), firstRelease);
  await firstRelease;
  assert.deepEqual(operations, ["ex", "un"]);
  assert.throws(() => fstatSync(descriptor), error => error.code === "EBADF");
  const shared = await locks.acquire(path, "shared", { nonblocking: true });
  assert.equal((await stat(path)).ino, inode);
  await shared.release();
  assert.deepEqual(operations, ["ex", "un", "shnb", "un"]);
  let failedDescriptor;
  const busy = api.createAdvisoryLocks(async (fd, operation) => {
    failedDescriptor = fd;
    assert.equal(operation, "exnb");
    throw Object.assign(new Error("busy"), { code: "EAGAIN" });
  });
  assert.equal(await busy.acquire(path, "exclusive", { nonblocking: true }), null);
  assert.throws(() => fstatSync(failedDescriptor), error => error.code === "EBADF");
  const unexpected = api.createAdvisoryLocks(async () => { throw Object.assign(new Error("unsupported filesystem"), { code: "ENOTSUP" }); });
  await assert.rejects(unexpected.acquire(path, "exclusive", { nonblocking: true }), /unsupported filesystem/);
  await assert.rejects(api.withExclusiveLock(locks, path, async () => { throw new Error("body failed"); }), /body failed/);
  assert.equal(operations.at(-1), "un");
  const ctx = await context("campaign lock guard", { locks });
  await populate(ctx.workspace);
  assert.equal((await api.handleLine('{"id":"hello","method":"kernel.hello","params":{"campaign":"zeta"}}', api.buildHandlers(ctx))).ok, true);
  // The guard offers non-blocking and waits against its own deadline, so a campaign held by
  // another process is a refusal that names the campaign rather than a wait with nothing to say.
  assert.deepEqual(operations.slice(-2), ["exnb", "un"]);
  const held = await context("campaign lock guard", {
    workspace: ctx.workspace, content: ctx.content, campaignLockTimeoutMs: 60,
    locks: api.createAdvisoryLocks(async (_fd, operation) => {
      if (operation === "exnb") throw Object.assign(new Error("busy"), { code: "EAGAIN" });
    }),
  });
  const started = Date.now();
  const contended = await api.handleLine('{"id":"busy","method":"kernel.hello","params":{"campaign":"zeta"}}', api.buildHandlers(held));
  assert.ok(Date.now() - started >= 60, "the guard waits for its deadline before refusing");
  assert.equal(contended.error.code, "internal");
  assert.equal(contended.error.details.reason, "campaign_locked");
  assert.equal(contended.error.details.campaign, "zeta");
  assert.match(contended.error.message, /zeta/);
  assert.ok(contended.error.fix);
  const unbacked = await api.createKernelContext({ workspace: ctx.workspace, content: ctx.content });
  const refusal = await api.handleLine('{"id":"guard","method":"campaign.list","params":{"campaign":"zeta"}}', api.buildHandlers(unbacked));
  assert.equal(refusal.error.code, "not_implemented");
});
