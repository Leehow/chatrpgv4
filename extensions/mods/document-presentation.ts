/** A reading projection; source text and acquisition snapshots stay in the kernel. */
import {createHash, randomUUID} from "node:crypto";
import {readFile, writeFile, rename} from "node:fs/promises";
import {join} from "node:path";
import {resourceRootFrom,runtimeEntryUrl} from "../../runtime/deployment.mjs";
import {PLAY_LANGUAGE_TAG} from "../../runtime/ui-words.ts";
import {coded} from "../ui/errors.ts";
import {reasoned, readerFailureReason} from "../module/reader.ts";
import {runPresentationAttempt} from "../module/presentation-attempt.ts";
import type {ReaderRequest, ReaderOutcome} from "../module/reader.ts";

const resourceRoot = resourceRootFrom(import.meta.url);
const defaultPrompt = join(resourceRoot, 'extensions/mods/document-presentation.md');
type Row = Record<string, any>;
type Options = {home:string; owner?:object; resourceRoot?:string; model?:string; thinking?:string; signal?:AbortSignal;
  runner?:(request:ReaderRequest)=>Promise<ReaderOutcome>};
type OwnerCache = {pending:Map<string, Promise<{title:string; text:string}>>; views:Map<string, {result?:Row; error?:unknown}>};
const owners = new WeakMap<object, OwnerCache>();
function cacheFor(options:Options):OwnerCache {
  // Production supplies its runtime; direct callers can retain a runner or options identity.
  const owner = options.owner ?? options.runner ?? options;
  let cache = owners.get(owner);
  if (!cache) {
    cache = {pending:new Map(), views:new Map()};
    owners.set(owner, cache);
  }
  return cache;
}

/** Panel invokes remain short; repeated owned views poll the same background job. */
export function documentPresentationStatus(options:Options, document:Row):Row {
  const {views} = cacheFor(options);
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
    throw coded("preparation_failed", "Invalid document reading");
  }
  return {title:value.title, text:value.text};
}

async function reading(options:Options, title:string, text:string, language:string) {
  const prompt = options.resourceRoot ? join(options.resourceRoot, 'extensions/mods/document-presentation.md') : defaultPrompt;
  const instructions = await readFile(prompt, "utf8");
  const request = {title, text, play_language:language};
  const fingerprint = createHash("sha256").update(JSON.stringify([request, instructions])).digest("hex");
  const directory = join(options.home, ".coc/document-presentations", fingerprint);
  const accepted = join(directory, "accepted.json");
  try {return validateDocumentReading(JSON.parse(await readFile(accepted, "utf8")), request);}
  catch { /* Missing or invalid cache entries are regenerated from the same source. */ }
  const key = accepted;
  const {pending} = cacheFor(options);
  if (pending.has(key)) return pending.get(key)!;
  const runner = options.runner;
  if (!runner) throw coded("preparation_failed", "Document presentation requires its owner runtime");
  const task = (async () => {
    const attempt = join(directory, "attempts", randomUUID());
    let result:{title:string; text:string}|undefined;
    let failure:unknown;
    await runPresentationAttempt({
      attempt, outputFile:"result.json",
      checkSource:`import {readFileSync} from "node:fs";
import {validateDocumentReading} from ${JSON.stringify(runtimeEntryUrl('documentPresentation',import.meta.url))};
validateDocumentReading(JSON.parse(readFileSync("result.json","utf8")),JSON.parse(readFileSync("request.json","utf8")));
`,
      systemPrompt:prompt, model:options.model, thinking:options.thinking, signal:options.signal, runner,
      prepareRound:async round=>{
        if (round === 1) await writeFile(join(attempt, "request.json"), JSON.stringify(request, null, 2));
        return "Read request.json and write result.json. Run node check.mjs and repair any error."
          + (round > 1 ? " Read findings.json and repair the retained result." : "");
      },
      recordOutcome:async (outcome, round)=>{
        await writeFile(join(attempt, `run-${round}.json`), JSON.stringify(outcome));
      },
      failure:(outcome, aborted)=>coded(aborted ? "presentation_timeout" : "preparation_failed",
        reasoned("Document reading could not be prepared", aborted ? undefined : readerFailureReason(outcome))),
      invalidOutput:error=>{failure=error; return {error:String(error)};},
      accept:value=>{
        try {
          result = validateDocumentReading(value, request);
          return {done:true};
        } catch (error) {
          failure=error;
          return {done:false, findings:{error:String(error)}};
        }
      },
    });
    if (!result) throw failure ?? coded("preparation_failed", "Document reading could not be validated");
    const temporary = join(directory, randomUUID() + ".tmp");
    await writeFile(temporary, JSON.stringify(result)); await rename(temporary, accepted);
    return result;
  })();
  pending.set(key, task);
  try {return await task;} finally {pending.delete(key);}
}

export async function presentDocument(options:Options, document:Row):Promise<Row> {
  // The tag set is open (contract §23, 2026-09-09): a reading is asked for by the shape of the tag
  // it is asked in, never by membership of a registry. This used to load `content/languages.json`
  // and refuse a document in any tag nobody had registered there.
  if (typeof document.play_language !== "string" || !PLAY_LANGUAGE_TAG.test(document.play_language)
      || typeof document.name !== "string" || !document.name.trim()
      || typeof document.text !== "string" || typeof document.original !== "string"
      || document.text.length > 64000 || document.original.length > 64000) {
    throw coded("invalid_params", "Invalid document presentation request");
  }
  const original = await reading(options, document.name, document.original, document.play_language);
  const text = document.player_edited ? document.text : document.text === document.original ? original.text
    : (await reading(options, document.name, document.text, document.play_language)).text;
  return {...document, display_name:original.title, original:original.text, text};
}
