#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const module = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/debug-experiment.ts",
));

const priorHttpProxy = process.env.HTTP_PROXY;
const priorXaiApiKey = process.env.XAI_API_KEY;
process.env.HTTP_PROXY = "http://127.0.0.1:19080";
process.env.XAI_API_KEY = "must-not-forward";

const calls = [];
const host = module.createDebugExperimentHost({
  repoRoot: root,
  async runCommand(command, args, options) {
    calls.push({ command, args, options });
    return {
      stdout: JSON.stringify({
        ok: true,
        receipt: {
          status: "started",
          experiment_id: "debug-haunting-r1",
        },
      }),
      stderr: "",
      exitCode: 0,
    };
  },
});
const receipt = await host.dispatch(
  'run {"player_input":"我检查伤口。","lanes":[{"id":"production-1","profile":"production"}]}',
  {
    workspaceRoot: "/tmp/pi-coc-debug-workspace",
    campaignId: "haunting",
    role: "play",
    hostIsIdle: true,
    provider: "xai",
    model: "grok-4.6",
    thinking: "low",
    agentHome: "/tmp/pi-coc-debug-agent-home",
  },
);
if (priorHttpProxy === undefined) delete process.env.HTTP_PROXY;
else process.env.HTTP_PROXY = priorHttpProxy;
if (priorXaiApiKey === undefined) delete process.env.XAI_API_KEY;
else process.env.XAI_API_KEY = priorXaiApiKey;
assert.deepEqual(receipt, {
  status: "started",
  experiment_id: "debug-haunting-r1",
});
assert.equal(calls.length, 1);
assert.equal(calls[0].command, "uv");
assert.deepEqual(calls[0].args.slice(0, 5), [
  "run", "--frozen", "--project", root, "python",
]);
assert.equal(calls[0].args.at(6), "dispatch");
assert.equal(calls[0].args.at(7), "--command");
assert.equal(calls[0].args.at(8).startsWith("run "), true);
assert.equal(calls[0].args.at(9), "--context-json");
assert.deepEqual(JSON.parse(calls[0].args.at(10)), {
  workspace_root: "/tmp/pi-coc-debug-workspace",
  campaign_id: "haunting",
  role: "play",
  host_is_idle: true,
  provider: "xai",
  model: "grok-4.6",
  thinking: "low",
  agent_home: "/tmp/pi-coc-debug-agent-home",
});
assert.equal(calls[0].options.cwd, root);
assert.equal(calls[0].options.timeoutMs, 3000);
assert.equal(calls[0].options.env.HTTP_PROXY, "http://127.0.0.1:19080");
assert.equal("XAI_API_KEY" in calls[0].options.env, false);

const failing = module.createDebugExperimentHost({
  repoRoot: root,
  async runCommand() {
    return {
      stdout: JSON.stringify({
        ok: false,
        error: { code: "debug_not_play", message: "play only" },
      }),
      stderr: "",
      exitCode: 2,
    };
  },
});
await assert.rejects(
  failing.dispatch("status current", {
    workspaceRoot: "/tmp/pi-coc-debug-workspace",
    campaignId: "haunting",
    role: "setup",
    hostIsIdle: true,
    provider: "xai",
    model: "grok-4.6",
    thinking: "low",
    agentHome: "/tmp/pi-coc-debug-agent-home",
  }),
  (error) => error.code === "debug_not_play" && error.message === "play only",
);

console.log(JSON.stringify({ ok: true, seam: "DebugExperimentHost.dispatch" }));
