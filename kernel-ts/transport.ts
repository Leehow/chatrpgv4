import type { Readable, Writable } from "node:stream";
import { internalError, pythonStringRepr, RpcError } from "./errors.js";
import type { HandlerGroup } from "./handlers.js";
import { compareUnicode, isJsonObject, parsePythonJson, PythonJsonDecodeError, pythonJsonDumps, utf8Bytes, type JsonValue, type ReadonlyJson } from "./json.js";
import { isBlankLine } from "./snapshots.js";

export type Diagnostic = (message: string) => void;

export async function handleLine(line: string, methods: HandlerGroup, diagnostic: Diagnostic = () => {}): Promise<ReadonlyJson> {
  let requestId: JsonValue = null;
  try {
    const request = parsePythonJson(line);
    if (!isJsonObject(request)) throw new RpcError("invalid_params", "request must be a JSON object");
    requestId = Object.hasOwn(request, "id") ? request.id : null;
    const method = request.method;
    const params = request.params === null || request.params === undefined ? {} : request.params;
    if (typeof requestId !== "string") throw new RpcError("invalid_params", "request.id must be a string");
    if (typeof method !== "string") throw new RpcError("invalid_params", "request.method must be a string");
    if (!isJsonObject(params)) throw new RpcError("invalid_params", "request.params must be an object");
    if (!Object.hasOwn(methods, method)) {
      throw new RpcError("unknown_method", `unknown method ${pythonStringRepr(method)}`, { details: { methods: Object.keys(methods).sort(compareUnicode) } });
    }
    const result = await methods[method](params);
    return { id: requestId, ok: true, result };
  } catch (error) {
    let rpcError: RpcError;
    if (error instanceof PythonJsonDecodeError) rpcError = new RpcError("invalid_params", `request is not valid JSON: ${error.message}`);
    else if (error instanceof RpcError) rpcError = error;
    else { diagnostic(error instanceof Error ? error.stack ?? error.message : String(error)); rpcError = internalError(error); }
    return { id: requestId, ok: false, error: rpcError.toJson() };
  }
}

async function* utf8Lines(input: Readable): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let buffered = "";
  for await (const chunk of input) {
    buffered += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let consumed = 0;
    for (let index = 0; index < buffered.length; index++) {
      if (buffered[index] !== "\n" && buffered[index] !== "\r") continue;
      if (buffered[index] === "\r" && index + 1 === buffered.length) break;
      yield buffered.slice(consumed, index);
      if (buffered[index] === "\r" && buffered[index + 1] === "\n") index++;
      consumed = index + 1;
    }
    buffered = buffered.slice(consumed);
  }
  buffered += decoder.decode();
  if (buffered.endsWith("\r")) buffered = buffered.slice(0, -1);
  if (buffered) yield buffered;
}

/** Arrival order, response writes and EOF draining all belong to one loop. */
export async function serve(input: Readable, output: Writable, methods: HandlerGroup, diagnostic: Diagnostic = () => {}): Promise<void> {
  for await (const line of utf8Lines(input)) {
    if (isBlankLine(line)) continue;
    const response = await handleLine(line, methods, diagnostic);
    const bytes = utf8Bytes(pythonJsonDumps(response) + "\n");
    await new Promise<void>((resolve, reject) => output.write(bytes, error => error ? reject(error) : resolve()));
  }
}
