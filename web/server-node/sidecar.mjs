/**
 * Stdio JSON-RPC client for the canonical runtime sidecar
 * (runtime/sdk/rpc_server.py). One long-lived Python child process; requests
 * are newline-JSON with ids, stream events arrive as notifications carrying
 * the originating request id.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export class SidecarError extends Error {
  constructor(payload) {
    super(payload?.message || "sidecar error");
    this.errorClass = payload?.class || "SidecarError";
    this.kind = payload?.kind ?? null;
  }
}

export class Sidecar {
  #child = null;
  #nextId = 0;
  #pending = new Map(); // id -> {resolve, reject, onNotify}

  constructor(workspace) {
    this.workspace = workspace;
  }

  start() {
    if (this.#child) return;
    // Python contract: uv run --frozen python ... from the repo root.
    const child = spawn(
      "uv",
      [
        "run",
        "--project",
        REPO_ROOT,
        "--frozen",
        "python",
        path.join(REPO_ROOT, "runtime/sdk/rpc_server.py"),
        "--workspace",
        this.workspace,
      ],
      { cwd: REPO_ROOT, stdio: ["pipe", "pipe", "inherit"] },
    );
    child.on("exit", (code, signal) => {
      const err = new SidecarError({
        class: "SidecarExitedError",
        message: `runtime sidecar exited (code=${code} signal=${signal})`,
      });
      for (const pending of this.#pending.values()) pending.reject(err);
      this.#pending.clear();
      this.#child = null;
    });
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => this.#onLine(line));
    this.#child = child;
  }

  #onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stderr.write(`[sidecar] non-JSON stdout line ignored: ${line}\n`);
      return;
    }
    if (msg.notify) {
      const pending = this.#pending.get(msg.id);
      pending?.onNotify?.(msg.notify, msg.data);
      return;
    }
    const pending = this.#pending.get(msg.id);
    if (!pending) return;
    this.#pending.delete(msg.id);
    if (msg.error) pending.reject(new SidecarError(msg.error));
    else pending.resolve(msg.result);
  }

  /** Call a sidecar method. onNotify(name, data) receives in-flight events. */
  request(method, params = {}, { onNotify } = {}) {
    this.start();
    const id = ++this.#nextId;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onNotify });
      this.#child.stdin.write(payload + "\n", (err) => {
        if (err) {
          this.#pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async stop() {
    if (!this.#child) return;
    this.#child.stdin.end();
    this.#child.kill("SIGTERM");
    this.#child = null;
  }
}
