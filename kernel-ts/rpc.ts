import { sep } from "node:path";
import { createKernelContext, type KernelContext } from "./context.js";
import { RpcError } from "./errors.js";
import type { Retarget, RetargetTarget } from "./foundation.js";
import { createKernelRuntime } from "./registry.js";
import { forgetCandidateIndexes } from "./read/workspace-candidates.js";
import { forgetParsedGraphs } from "./read/published-graph.js";
import { forgetParsedFiles } from "./snapshots.js";
import { serve } from "./transport.js";
import { nativeAdvisoryLocks } from "./native-locks.js";

function log(message: string): void { process.stderr.write(`[coc.rpc] ${message}\n`); }

interface Arguments { workspace: string; content: string; retargetable: boolean }

function argumentsFrom(argv: readonly string[]): Arguments {
  const values: Partial<Record<"workspace" | "content", string>> = {};
  let retargetable = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--retargetable") { retargetable = true; continue; }
    const [flag, inline] = argument.split(/=(.*)/s);
    if (flag !== "--workspace" && flag !== "--content") throw new Error(`unrecognized argument: ${argument}`);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
    values[flag.slice(2) as "workspace" | "content"] = value;
  }
  if (!values.workspace || !values.content) throw new Error("--workspace and --content are required");
  return { workspace: values.workspace, content: values.content, retargetable };
}

function bind(target: RetargetTarget): Promise<KernelContext> {
  return createKernelContext({ ...target, seed: process.env.COC_KERNEL_SEED, locks: nativeAdvisoryLocks() });
}

/**
 * Contract §146: what a process keeps across a retarget is exactly what it would rebuild from the
 * same bytes -- parsed files under the content root it still serves, each re-validated by its stamp
 * on every read. Everything scoped to the workspace it leaves, and every cache keyed by a name
 * rather than by file identity, is dropped.
 */
function forgetWorkspaceState(content: string): void {
  const underContent = (path: string) => path === content || path.startsWith(content + sep);
  forgetParsedFiles(underContent);
  forgetParsedGraphs(underContent);
  forgetCandidateIndexes();
}

async function main(): Promise<void> {
  let context: KernelContext, retargetable: boolean;
  try {
    const parsed = argumentsFrom(process.argv.slice(2));
    retargetable = parsed.retargetable;
    context = await bind(parsed);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  log(`ready workspace=${context.workspace} content=${context.content}${retargetable ? " retargetable" : ""}`);
  let generation = 0;
  // The next binding is validated before the current one is released: a refused retarget leaves
  // the process serving exactly what it served, and says so with `invalid_params`.
  const retarget: Retarget = async target => {
    let next: KernelContext;
    try { next = await bind(target); }
    catch (error) { throw new RpcError("invalid_params", error instanceof Error ? error.message : String(error)); }
    await runtime.close();
    forgetWorkspaceState(next.content);
    context = next;
    runtime = createKernelRuntime(context, { retarget });
    generation++;
    log(`retargeted workspace=${context.workspace} content=${context.content} generation=${generation}`);
    return { workspace: context.workspace, content: context.content, generation };
  };
  let runtime = createKernelRuntime(context, retargetable ? { retarget } : {});
  const stop = () => { void runtime.close().then(() => process.stdin.destroy(), error => {
    log(String(error)); process.exitCode = 1; process.stdin.destroy();
  }); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await serve(process.stdin, process.stdout, () => runtime.handlers, log);
    log("stdin closed; exiting");
  } catch (error) {
    log(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await runtime.close();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

await main();
