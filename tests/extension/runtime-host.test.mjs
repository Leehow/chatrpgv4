import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createRuntime } from "../../runtime/host.ts";

const root = resolve(import.meta.dirname, "../..");

function fixture(t, env = {}) {
	const home = mkdtempSync(join(tmpdir(), "runtime host "));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const entry = join(home, "transport fixture.mjs");
	writeFileSync(entry, `
import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line', line => {
 const request=JSON.parse(line);
 if(request.method==='exit') return process.exit(0);
 if(request.method==='ignore-term') { process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); }
 process.stdout.write(JSON.stringify({id:request.id,ok:true,result:{pid:process.pid,value:process.env.RUNTIME_TEST_VALUE,home:process.env.PI_COC_HOME,late:process.env.PI_COC_TEST_ENV_LEAK}})+'\\n');
});
`);
	const captured = { ...process.env, PI_COC_KERNEL_CMD: JSON.stringify([process.execPath, entry]), ...env };
	const runtime = createRuntime({ owner: "check", home }, { resourceRoot: root, env: captured });
	t.after(() => runtime.close());
	return { runtime, captured, home };
}

test("runtime captures launch configuration and does not share kernels between owners", async t => {
	const previous = process.env.PI_COC_TEST_ENV_LEAK;
	delete process.env.PI_COC_TEST_ENV_LEAK;
	t.after(() => { if (previous === undefined) delete process.env.PI_COC_TEST_ENV_LEAK; else process.env.PI_COC_TEST_ENV_LEAK = previous; });
	const first = fixture(t, { RUNTIME_TEST_VALUE: "captured" });
	process.env.PI_COC_TEST_ENV_LEAK = "must-not-leak";
	first.captured.RUNTIME_TEST_VALUE = "changed";
	first.captured.PI_COC_KERNEL_CMD = JSON.stringify(["missing-executable"]);
	const second = fixture(t, { RUNTIME_TEST_VALUE: "independent" });
	const a = first.runtime.openKernel();
	assert.equal(first.runtime.openKernel(), a);
	const one = await a.call("kernel.hello");
	const two = await second.runtime.openKernel().call("kernel.hello");
	assert.equal(one.value, "captured");
	assert.equal(one.late, undefined);
	assert.equal(one.home, first.home);
	assert.equal(two.value, "independent");
	assert.notEqual(one.pid, two.pid);
	await first.runtime.close();
	assert.throws(() => process.kill(one.pid, 0), { code: "ESRCH" });
	assert.equal((await second.runtime.openKernel().call("kernel.hello")).pid, two.pid);
});

test("runtime closure is idempotent, rejects late calls and verifies a stubborn child exits", async t => {
	const { runtime } = fixture(t);
	const client = runtime.openKernel();
	const { pid } = await client.call("ignore-term");
	const closing = runtime.close();
	assert.equal(runtime.close(), closing);
	assert.throws(() => runtime.openKernel(), /closed/);
	await assert.rejects(client.call("kernel.hello"), /closed/);
	await closing;
	assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("cancelled owners cannot launch work and cancellation stops an existing child", async t => {
	const cancelled = new AbortController();
	cancelled.abort();
	assert.throws(() => createRuntime({ owner: "check", home: root, signal: cancelled.signal }), /cancelled/);
	const { captured, home } = fixture(t);
	const controller = new AbortController();
	const runtime = createRuntime({ owner: "preparation", home, signal: controller.signal }, { resourceRoot: root, env: captured });
	t.after(() => runtime.close());
	const { pid } = await runtime.openKernel().call("kernel.hello");
	controller.abort();
	assert.throws(() => runtime.openKernel(), /closed|cancelled/);
	await runtime.close();
	assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("a restart retains the captured environment and closed owners cannot respawn", async t => {
	const { runtime, captured } = fixture(t, { RUNTIME_TEST_VALUE: "original" });
	let reopened;
	const restart = new Promise(resolve => { reopened = resolve; });
	const client = runtime.openKernel({ onRestart: async () => reopened(await client.callImmediate("kernel.hello")) });
	const first = await client.call("kernel.hello");
	captured.RUNTIME_TEST_VALUE = "mutated";
	await assert.rejects(client.call("exit"), /ended/);
	const second = await Promise.race([restart, delay(3000).then(() => { throw new Error("restart did not complete"); })]);
	assert.equal(second.value, "original");
	assert.notEqual(second.pid, first.pid);
	await runtime.close();
	assert.throws(() => client.start(), /closed/);
});

test("invalid composition preserves existing files and never starts a fallback", t => {
	const home = mkdtempSync(join(tmpdir(), "runtime-invalid-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const retained = join(home, "retained.json");
	writeFileSync(retained, '{"keep":true}');
	assert.throws(() => createRuntime({ owner: "check", home }, {
		resourceRoot: root, env: { PI_COC_KERNEL_CMD: JSON.stringify(["definitely-no-runtime"]), PATH: home },
	}), /Runtime configuration failed/);
	assert.equal(readFileSync(retained, "utf8"), '{"keep":true}');
});

test("capabilities use captured context, and closure rejects late task results", async t => {
	const { captured, home } = fixture(t);
	let started;
	const running = new Promise(resolve => { started = resolve; });
	const runtime = createRuntime({ owner: "preparation", home }, {
		resourceRoot: root, env: captured,
		capabilities: { check: async (context, _request, signal) => {
			assert.equal(context.home, home);
			assert.equal(context.nodeExecutable, process.execPath);
			started();
			await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
			return { ok: true };
		} },
	});
	t.after(() => runtime.close());
	const task = runtime.check({ kind: "mod-definition", draft: "unused" });
	const rejected = assert.rejects(task, /closed|cancelled/);
	await running;
	await runtime.close();
	await rejected;
	await assert.rejects(runtime.check({ kind: "mod-definition", draft: "unused" }), /closed/);
});

test("unregistered capabilities fail explicitly without booting a kernel", async t => {
	const { home, captured } = fixture(t);
	const runtime = createRuntime({ owner: "check", home }, {resourceRoot: root, env: captured, capabilities: {check: undefined}});
	await assert.rejects(runtime.check({ kind: "source-draft", packet: "unused", draft: "unused" }), { code: "not_implemented" });
	await runtime.close();
});

test("an OS spawn failure leaves no failed child that shutdown must wait for", async t => {
	const { home } = fixture(t);
	const entry = join(home, "unavailable interpreter");
	writeFileSync(entry, "#!/definitely/missing/runtime\n");
	chmodSync(entry, 0o700);
	const runtime = createRuntime({ owner: "check", home }, {
		resourceRoot: root, env: { ...process.env, PI_COC_KERNEL_CMD: JSON.stringify([entry]) },
	});
	t.after(() => runtime.close());
	await assert.rejects(runtime.openKernel().call("kernel.hello"), /process ended/);
	await runtime.close();
});
