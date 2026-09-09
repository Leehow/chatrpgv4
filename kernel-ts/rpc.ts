import { createKernelContext } from "./context.js";
import { createKernelRuntime } from "./registry.js";
import { serve } from "./transport.js";
import { nativeAdvisoryLocks } from "./native-locks.js";

function log(message: string): void { process.stderr.write(`[coc.rpc] ${message}\n`); }

function argumentsFrom(argv: readonly string[]): { workspace: string; content: string } {
  const values: Partial<Record<"workspace" | "content", string>> = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const [flag, inline] = argument.split(/=(.*)/s);
    if (flag !== "--workspace" && flag !== "--content") throw new Error(`unrecognized argument: ${argument}`);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
    values[flag.slice(2) as "workspace" | "content"] = value;
  }
  if (!values.workspace || !values.content) throw new Error("--workspace and --content are required");
  return values as { workspace: string; content: string };
}

async function main(): Promise<void> {
  let context;
  try {
    context = await createKernelContext({ ...argumentsFrom(process.argv.slice(2)), seed: process.env.COC_KERNEL_SEED,
      locks: nativeAdvisoryLocks() });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  log(`ready workspace=${context.workspace} content=${context.content}`);
  const runtime = createKernelRuntime(context);
  const stop = () => { void runtime.close().then(() => process.stdin.destroy(), error => {
    log(String(error)); process.exitCode = 1; process.stdin.destroy();
  }); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await serve(process.stdin, process.stdout, runtime.handlers, log);
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
