/** A reading projection; source text and acquisition snapshots stay in the kernel. */
import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, writeFile, rename} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {runReader, type ReaderRequest, type ReaderOutcome} from "../module/reader.ts";

const prompt = fileURLToPath(new URL("./document-presentation.md", import.meta.url));
type Row = Record<string, any>;
type Options = {home:string; model?:string; thinking?:string; signal?:AbortSignal;
  runner?:(request:ReaderRequest)=>Promise<ReaderOutcome>};
const pending = new Map<string, Promise<{title:string; text:string}>>();
const views = new Map<string, {result?:Row; error?:unknown}>();

/** Panel invokes remain short; repeated owned views poll the same background job. */
export function documentPresentationStatus(options:Options, document:Row):Row {
  const key = JSON.stringify([options.home, document.name, document.version, document.play_language]);
  let job = views.get(key);
  if (!job) {
    job = {}; views.set(key, job);
    const current = job;
    void presentDocument(options, document).then(result => {current.result = result;}, error => {current.error = error;});
    if (views.size > 64) for (const [old, value] of views) {
      if (old !== key && (value.result || value.error)) {views.delete(old); break;}
    }
  }
  if (job.error) {views.delete(key); throw job.error;}
  return job.result ? {...document, display_name:job.result.display_name, text:job.result.text, original:job.result.original}
    : {pending:true};
}

export function validateDocumentReading(value:any, source:{text:string}):{title:string; text:string} {
  if (!value || typeof value.title !== "string" || !value.title.trim() || value.title.length > 640
      || typeof value.text !== "string" || value.text.length > 64000
      || (source.text === "" ? value.text !== "" : !value.text.trim())
      || Object.keys(value).some(key => !["title", "text"].includes(key))) {
    throw new Error("Invalid document reading");
  }
  return {title:value.title, text:value.text};
}

async function reading(options:Options, title:string, text:string, language:string) {
  const instructions = await readFile(prompt, "utf8");
  const request = {title, text, play_language:language};
  const fingerprint = createHash("sha256").update(JSON.stringify([request, instructions])).digest("hex");
  const directory = join(options.home, ".coc/document-presentations", fingerprint);
  const accepted = join(directory, "accepted.json");
  try {return validateDocumentReading(JSON.parse(await readFile(accepted, "utf8")), request);}
  catch { /* Missing or invalid cache entries are regenerated from the same source. */ }
  const key = accepted;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    const attempt = join(directory, "attempts", randomUUID());
    await mkdir(attempt, {recursive:true});
    await writeFile(join(attempt, "request.json"), JSON.stringify(request, null, 2));
    await writeFile(join(attempt, "check.mjs"),
      `import {readFileSync} from "node:fs";
import {validateDocumentReading} from ${JSON.stringify(import.meta.url)};
validateDocumentReading(JSON.parse(readFileSync("result.json","utf8")),JSON.parse(readFileSync("request.json","utf8")));
`);
    let result;
    for (let round = 1; round <= 2; round++) {
      const outcome = await (options.runner || runReader)({cwd:attempt, systemPrompt:prompt,
        model:options.model, thinking:options.thinking, signal:options.signal, timeoutMs:120000,
        eventLog:join(attempt, `events-${round}.jsonl`),
        brief:"Read request.json and write result.json. Run node --experimental-strip-types check.mjs and repair any error."
          + (round > 1 ? " Read findings.json and repair the retained result." : "")});
      await writeFile(join(attempt, `run-${round}.json`), JSON.stringify(outcome));
      if (!outcome.ok || options.signal?.aborted) throw new Error("Document reading could not be prepared");
      try {
        result = validateDocumentReading(JSON.parse(await readFile(join(attempt, "result.json"), "utf8")), request);
        break;
      } catch (error) {
        await writeFile(join(attempt, "findings.json"), JSON.stringify({error:String(error)}));
        if (round === 2) throw error;
      }
    }
    if (!result) throw new Error("Document reading could not be validated");
    const temporary = join(directory, randomUUID() + ".tmp");
    await writeFile(temporary, JSON.stringify(result)); await rename(temporary, accepted);
    return result;
  })();
  pending.set(key, task);
  try {return await task;} finally {pending.delete(key);}
}

export async function presentDocument(options:Options, document:Row):Promise<Row> {
  if (!["zh-Hans", "en"].includes(document.play_language)
      || typeof document.name !== "string" || !document.name.trim()
      || typeof document.text !== "string" || typeof document.original !== "string"
      || document.text.length > 64000 || document.original.length > 64000) {
    throw new Error("Invalid document presentation request");
  }
  const original = await reading(options, document.name, document.original, document.play_language);
  const text = document.player_edited ? document.text : document.text === document.original ? original.text
    : (await reading(options, document.name, document.text, document.play_language)).text;
  return {...document, display_name:original.title, original:original.text, text};
}
