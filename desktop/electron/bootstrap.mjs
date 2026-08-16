import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * First-run preparation that the pi-coc TUI launcher does in bash and the
 * desktop shell must replicate: steward agent mirroring into the workspace's
 * .pi/agents surface, and (packaged mode) creating the uv project
 * environment from the bundled CPython + frozen lock.
 */

function run(bin, args, { env, cwd }, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const take = (stream, prefix) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        out += chunk;
        for (const line of chunk.split("\n")) {
          if (line.trim()) log(`${prefix} ${line}`);
        }
      });
    };
    take(child.stdout, "[bootstrap]");
    take(child.stderr, "[bootstrap]");
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${bin} ${args.join(" ")} exited ${code}\n${out}`)),
    );
  });
}

/**
 * Mirror distributable steward agents from the canonical Pi package into the
 * workspace runtime surface, copy-on-diff, same contract as bin/pi-coc
 * (stewards are discovered from the project .pi/agents/ of the session cwd;
 * keeper workers run with cwd = workspace).
 */
export function mirrorStewardAgents(payloadRoot, workspace, log = () => {}) {
  const srcDir = path.join(payloadRoot, "plugins", "coc-keeper", "pi", "agents");
  const dstDir = path.join(workspace, ".pi", "agents");
  if (!fs.existsSync(srcDir)) {
    log(`[bootstrap] no steward agents at ${srcDir}; skipping mirror`);
    return;
  }
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (!name.startsWith("steward-") || !name.endsWith(".md")) continue;
    const from = path.join(srcDir, name);
    const to = path.join(dstDir, name);
    if (fs.existsSync(to) && fs.readFileSync(to, "utf8") === fs.readFileSync(from, "utf8")) {
      continue;
    }
    fs.copyFileSync(from, to);
    log(`[bootstrap] mirrored steward agent ${name}`);
  }
}

/** Create the uv project environment from the frozen lock (packaged only). */
export async function ensurePythonEnv({ uvBin, payloadRoot, env }, log = () => {}) {
  await run(uvBin, ["sync", "--frozen", "--project", payloadRoot], { env, cwd: payloadRoot }, log);
}
