import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

const IDENTITY = ["-c", "user.name=coc-kernel", "-c", "user.email=kernel@coc.invalid",
  "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"];

export class CommitFailed extends Error { override name = "CommitFailed"; }
export interface GitResult { readonly code: number; readonly stdout: string; readonly stderr: string }
export interface GitRuntime {
  requireAvailable(): void;
  run(campaign: string, args: readonly string[]): Promise<GitResult>;
  init(campaign: string): Promise<GitResult>;
  lineBlob(campaign: string, line: string, path: string): Promise<string | null>;
  rootCommit(campaign: string): Promise<string | null>;
  close(): Promise<void>;
}

function executable(command: string, env: NodeJS.ProcessEnv): string | undefined {
  const candidates = isAbsolute(command) || command.includes("/")
    ? [resolve(command)] : (env.PATH ?? "").split(delimiter).filter(Boolean).map(path => resolve(path, command));
  return candidates.find(path => {
    try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
  });
}

/** One captured subprocess adapter for the existing sidecar Git contract. */
export function createGitRuntime(workspace: string, suppliedEnv: NodeJS.ProcessEnv = process.env): GitRuntime {
  const env = Object.freeze({...suppliedEnv});
  const command = executable(env.PI_COC_GIT ?? "git", env);
  const lifetime = new AbortController();
  const active = new Set<Promise<GitResult>>();
  let closing: Promise<void> | undefined;
  function requireAvailable() {
    if (lifetime.signal.aborted) throw new CommitFailed("The Git runtime is closed");
    if (!command) throw new CommitFailed("The managed Git executable is unavailable");
  }
  function paths(campaign: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(campaign)) throw new CommitFailed("Invalid campaign for Git operation");
    return {repo: join(workspace, ".coc", "repos", `${campaign}.git`), work: join(workspace, ".coc", "campaigns", campaign)};
  }
  function execute(cwd: string, args: readonly string[]): Promise<GitResult> {
    if (lifetime.signal.aborted) return Promise.reject(new CommitFailed("The Git runtime is closed"));
    if (!command) return Promise.reject(new CommitFailed("The managed Git executable is unavailable"));
    const pending = new Promise<GitResult>((accept, reject) => {
      const grouped = process.platform !== "win32";
      const child = spawn(command, [...IDENTITY, ...args], {cwd, env, detached: grouped, stdio: ["ignore", "pipe", "pipe"]});
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      let failure: Error | undefined, settled = false;
      let escalation: NodeJS.Timeout | undefined, deadline: NodeJS.Timeout | undefined;
      const kill = (signal: NodeJS.Signals) => {
        try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
        catch { /* The owned process may already have exited. */ }
      };
      const stop = () => {
        if (settled || escalation) return;
        failure ??= new CommitFailed("Git operation cancelled");
        kill("SIGTERM");
        // Finish before the host's two-second kernel SIGKILL escalation.
        escalation = setTimeout(() => kill("SIGKILL"), 1000);
        deadline = setTimeout(() => finish(Object.assign(new CommitFailed("Git shutdown did not complete"), {reason: "runtime_shutdown"})), 1750);
      };
      const timer = setTimeout(() => { failure = new CommitFailed("Git command exceeded 60 seconds"); stop(); }, 60_000);
      function finish(error?: Error, code = -1) {
        if (settled) return;
        settled = true;
        clearTimeout(timer); clearTimeout(escalation); clearTimeout(deadline);
        lifetime.signal.removeEventListener("abort", stop);
        if (error) { reject(error); return; }
        try {
          const decode = (parts: Buffer[]) => new TextDecoder("utf-8", {fatal: true, ignoreBOM: true})
            .decode(Buffer.concat(parts)).replace(/\r\n?/g, "\n");
          accept({code, stdout: decode(stdout), stderr: decode(stderr)});
        } catch (error) { reject(new CommitFailed(String(error))); }
      }
      child.stdout.on("data", chunk => stdout.push(chunk));
      child.stderr.on("data", chunk => stderr.push(chunk));
      child.on("error", error => { failure = new CommitFailed(error.message); });
      child.once("exit", () => { clearTimeout(timer); if (grouped) kill("SIGKILL"); });
      child.once("close", code => finish(failure, code ?? -1));
      lifetime.signal.addEventListener("abort", stop, {once: true});
      if (lifetime.signal.aborted) stop();
    });
    active.add(pending);
    void pending.then(() => active.delete(pending), () => active.delete(pending));
    return pending;
  }
  const run = (campaign: string, args: readonly string[]) => {
    const {repo, work} = paths(campaign);
    return execute(work, [`--git-dir=${repo}`, `--work-tree=${work}`, ...args]);
  };
  return Object.freeze({run, requireAvailable,
    async init(campaign) {
      const {repo, work} = paths(campaign);
      requireAvailable();
      await mkdir(dirname(repo), {recursive: true});
      return execute(work, ["init", "--quiet", "--bare", repo]);
    },
    async lineBlob(campaign, line, path) {
      const result = await run(campaign, ["show", `wl/${line}:${path}`]);
      return result.code === 0 ? result.stdout : null;
    },
    async rootCommit(campaign) {
      const result = await run(campaign, ["rev-list", "--max-parents=0", "--abbrev-commit", "HEAD"]);
      return result.code === 0 ? result.stdout.trim().split(/\s+/).filter(Boolean).at(-1) ?? null : null;
    },
    close() {
      if (closing) return closing;
      lifetime.abort();
      return closing = Promise.allSettled([...active]).then(results => {
        const failed = results.find(result => result.status === "rejected" && result.reason?.reason === "runtime_shutdown");
        if (failed?.status === "rejected") throw failed.reason;
      });
    },
  } satisfies GitRuntime);
}
