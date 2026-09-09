/** Stable read-only checking entrypoint for readers and standalone callers. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeRuntimeContext, type RuntimeHostOptions, type RuntimeCheck } from "./host.ts";
import { runCheck } from "./tasks.ts";
import { isKernelError } from "../extensions/kernel/client.ts";

export function checkArguments(input: string[]): RuntimeCheck {
  const args = [...input];
  const take = (flag: string) => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
    args.splice(index, 2);
    return value;
  };
  const kind = take("--kind") ?? "source-draft";
  const draft = take("--draft"), packet = take("--packet");
  if (args.length || !draft || (kind === "source-draft" ? !packet : kind !== "mod-definition" || packet))
    throw new Error("Use --packet <task.json> --draft <draft.json>, or --kind mod-definition --draft <result.json>");
  return kind === "source-draft" ? { kind, packet: packet!, draft } : { kind: "mod-definition", draft };
}

export async function checkMain(args: string[]): Promise<number> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const options: RuntimeHostOptions = process.env.PI_COC_RUNTIME_OPTIONS ? JSON.parse(process.env.PI_COC_RUNTIME_OPTIONS) : {};
    const context = composeRuntimeContext({ owner: "check", home: process.env.PI_COC_HOME ?? process.cwd(), signal: controller.signal }, options);
    const request = checkArguments(args);
    request.draft = resolve(request.draft);
    if (request.kind === "source-draft") request.packet = resolve(request.packet);
    const result = await runCheck(context, request, controller.signal);
    process.stdout.write(JSON.stringify(result) + "\n");
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: isKernelError(error)
      ? { code: error.code, message: error.message, details: error.details } : String(error instanceof Error ? error.message : error) }) + "\n");
    return 1;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await checkMain(process.argv.slice(2));
}
