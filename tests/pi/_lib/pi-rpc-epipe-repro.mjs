#!/usr/bin/env node
/**
 * Minimal reproduction: pi (--mode rpc) crashes with `write EPIPE` when the
 * process owning its stdout pipe read end (the RPC driver peer) dies.
 *
 * Usage:
 *   node pi-rpc-epipe-repro.mjs <workspace-with-agent-home>
 *
 * The workspace needs the pi-coc layout used by the playtest workspaces:
 *   - agent-home/  (settings.json + auth symlinks; see bin/pi-coc bootstrap)
 *   - plugins/coc-keeper/pi/prompts/host-system.md
 *
 * Behavior: spawns `pi --mode rpc --no-session`, waits for the first stdout
 * event line, destroys the read end of pi's stdout pipe (simulating driver
 * peer death), then sends one RPC command so pi writes again. Observed on
 * pi 0.81.1 / Node v22.19.0: pi exits 1 with the unhandled EPIPE crash below.
 *
 * Expected stderr tail (evidence of the upstream gap):
 *   Error: write EPIPE
 *       at afterWriteDispatched (node:internal/stream_base_commons:159:15)
 *       ...
 *       at file:///.../dist/core/output-guard.js:15:40
 *   Emitted 'error' event on Socket instance at: ...
 *   Node.js v22.19.0
 *
 * Exit code: 0 when pi crashed with EPIPE (reproduction confirmed);
 * 2 when pi survived (behavior changed upstream).
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve(process.argv[2] || process.cwd());
const env = {
  ...process.env,
  PI_CODING_AGENT_DIR: resolve(workspace, "agent-home"),
  COC_HOST: "pi",
  COC_PROJECT_ROOT: workspace,
};
const proc = spawn("pi", [
  "--no-builtin-tools", "--approve", "--no-context-files",
  "--append-system-prompt", "plugins/coc-keeper/pi/prompts/host-system.md",
  "--mode", "rpc", "--no-session",
], { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
proc.stderr.on("data", (d) => { stderr += d; });
let sawFirstLine = false;
let crashedWithEpipe = false;
proc.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  if (!sawFirstLine && text.includes("\n")) {
    sawFirstLine = true;
    console.log("REPRO: driver peer death — destroying pi stdout read end");
    proc.stdout.destroy();
    proc.stdout.unref?.();
    setTimeout(() => {
      // Force pi to write again; its pipe peer is gone.
      proc.stdin.write(
        JSON.stringify({ id: "r-1", type: "abort" }) + "\n",
      );
    }, 500);
  }
});
proc.on("exit", (code, signal) => {
  crashedWithEpipe = stderr.includes("write EPIPE")
    && stderr.includes("output-guard.js:15:40");
  console.log(`REPRO: pi exited code=${code} signal=${signal} `
    + `epipeCrash=${crashedWithEpipe}`);
  const lines = stderr.split("\n");
  console.log("REPRO: stderr tail:\n" + lines.slice(-24).join("\n"));
  process.exit(crashedWithEpipe ? 0 : 2);
});
setTimeout(() => {
  console.log("REPRO: pi did NOT crash (still alive)");
  proc.kill("SIGKILL");
  process.exit(2);
}, 30000);
