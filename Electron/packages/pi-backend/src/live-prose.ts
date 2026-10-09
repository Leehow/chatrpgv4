/**
 * Contract §171: the Keeper's delivery is drawn as the story while its arguments stream.
 *
 * A delivering call's prose is one string field of its arguments: `narrate.text`, `ask.text` and
 * `apply.narrate` (the schemas in `extensions/kernel/tools.ts`). Pi streams those arguments as raw
 * JSON, and its `toolcall_start` names the tool. This module reads the field out of the JSON
 * received so far and decides what the player's screen holds; `index.ts` streams what it decides.
 *
 * Nothing here reads prose. The field is found by the JSON grammar, and the machine tokens the
 * kernel strips (`{{marker}}`, `{{say:…}}`, `{{/say}}`, §16.6 and §40.1) are removed by their
 * brace syntax alone.
 */

import {bindPriceText,priceRows} from '../../../../shared/cash-prose.js';
import {EMBEDDED_ARGUMENTS,stripDialectPrefixes} from '../../../../shared/dialect-prefix.js';

/** The delivering tools and the argument that carries their prose. */
export const DELIVERY_PROSE_FIELDS: Readonly<Record<string, string>> = { narrate: "text", ask: "text", apply: "narrate" };

function transportedProse(tool:string,field:string,value:string,complete:boolean):string|undefined{
  const parameter=EMBEDDED_ARGUMENTS[tool]?.[field];
  if(!parameter)return value;
  if(!complete&&parameter.startsWith(value))return;
  const repaired=(stripDialectPrefixes(tool,{[field]:value}).args as Record<string,string>)[field];
  return repaired?.trim()?repaired:undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

/**
 * The string value of `field` at the top level of a JSON object that may still be arriving.
 * `complete` says the closing quote has arrived. Undefined while the field has not begun, when it
 * is not a string, or when the text is not a JSON object. A half-received escape is held back.
 */
export function streamingStringField(json: string, field: string): { value: string; complete: boolean } | undefined {
  let at = 0;
  const skip = () => { while (at < json.length && WHITESPACE.has(json[at])) at += 1; };
  /** A string starting at `at` (on its quote): its decoded value, and whether it closed. */
  const string = (): { value: string; complete: boolean } => {
    at += 1;
    let value = "";
    while (at < json.length) {
      const char = json[at];
      if (char === "\"") { at += 1; return { value, complete: true }; }
      if (char !== "\\") { value += char; at += 1; continue; }
      const kind = json[at + 1];
      if (kind === undefined) break;
      if (kind === "u") {
        const hex = json.slice(at + 2, at + 6);
        if (hex.length < 4) break;
        const code = Number.parseInt(hex, 16);
        if (Number.isNaN(code)) return { value, complete: false };
        // A high surrogate waits for its pair, so half a character never reaches the screen.
        if (code >= 0xd800 && code <= 0xdbff) {
          if (json.length < at + 12) break;
          const low = json.slice(at + 6, at + 8) === "\\u" ? Number.parseInt(json.slice(at + 8, at + 12), 16) : Number.NaN;
          if (low >= 0xdc00 && low <= 0xdfff) { value += String.fromCharCode(code, low); at += 12; continue; }
        }
        value += String.fromCharCode(code);
        at += 6;
        continue;
      }
      value += kind === "n" ? "\n" : kind === "t" ? "\t" : kind === "r" ? "\r" : kind === "b" ? "\b" : kind === "f" ? "\f" : kind;
      at += 2;
    }
    // The text can end between the two halves of one character; its first half waits for the second.
    return { value: /[\ud800-\udbff]$/.test(value) ? value.slice(0, -1) : value, complete: false };
  };
  /** Steps over one value of any kind; false when the text ends inside it. */
  const value = (): boolean => {
    skip();
    if (at >= json.length) return false;
    const char = json[at];
    if (char === "\"") return string().complete;
    if (char !== "{" && char !== "[") {
      while (at < json.length && !WHITESPACE.has(json[at]) && json[at] !== "," && json[at] !== "}" && json[at] !== "]") at += 1;
      return at < json.length;
    }
    let depth = 0;
    while (at < json.length) {
      const next = json[at];
      if (next === "\"") { if (!string().complete) return false; continue; }
      if (next === "{" || next === "[") depth += 1;
      else if (next === "}" || next === "]") depth -= 1;
      at += 1;
      if (depth === 0) return true;
    }
    return false;
  };
  skip();
  if (json[at] !== "{") return undefined;
  at += 1;
  for (;;) {
    skip();
    if (at >= json.length || json[at] === "}") return undefined;
    if (json[at] === ",") { at += 1; continue; }
    if (json[at] !== "\"") return undefined;
    const key = string();
    if (!key.complete) return undefined;
    skip();
    if (json[at] !== ":") return undefined;
    at += 1;
    skip();
    if (key.value === field) return json[at] === "\"" ? string() : undefined;
    if (!value()) return undefined;
  }
}

/** The field's prose from the finished arguments, which Pi hands over parsed at `toolcall_end`. */
export function finishedProseField(args: unknown, field: string): string | undefined {
  let parsed = args;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return streamingStringField(parsed as string, field)?.value; }
  }
  if (!isRecord(parsed)) return undefined;
  const found = parsed[field];
  if (typeof found === "string") return found;
  // An `apply.narrate` written as an object carries its prose in `text`.
  return isRecord(found) && typeof found.text === "string" ? found.text : undefined;
}

/** A complete machine token: §16.6 markers, §40.1 say spans, and whatever else sits in double braces (§40.4). */
const TOKEN = /\{\{[^{}\n]*\}\}/g;
/** A token still being written where the text ends: `{{` and up to 64 characters (one `}` at most), or a lone `{`. */
const TOKEN_TAIL = /\{\{[^{}\n]{0,64}\}?$|\{$/;

/** The prose as the player reads it: tokens out, an unclosed one held back until it closes. */
export function displayedProse(raw: string, rows: readonly Record<string,any>[] = []): string {
  return bindPriceText(raw,rows).text.replace(TOKEN, "").replace(TOKEN_TAIL, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "");
}

/** Only complete top-level structured values may supply a streaming price. */
function completeField(json:string,field:string): unknown {
  // Read-only partial JSON is insufficient for numbers: 0.55 can arrive first as 0.
  // Try each complete object prefix by the same JSON grammar, never by prose content.
  let quoted=false,escaped=false,depth=0;
  for(let at=0;at<json.length;at++){
    const char=json[at];
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"'){quoted=true;continue;}
    if(char==='{'||char==='[')depth++;
    else if(char==='}'||char===']')depth--;
    if(depth===1 && (char===']'||char==='}'||char===',')){
      try{const prefix=json.slice(0,char===','?at:at+1).trimEnd();const row=JSON.parse(prefix+'}');if(Object.hasOwn(row,field))return row[field];}catch{}
    }
  }
  try{return JSON.parse(json)[field];}catch{return undefined;}
}

/** What the screen should now hold: the draft card's id and text. `first` is the first time it holds prose. */
export type LiveProseDraw = { id: string; text: string; first: boolean; replace?: true };

/**
 * One table's live delivery prose (§171.2). A turn holds at most one draft. The first delivering
 * call fills it as it streams. A later call in the same turn -- a delivery the kernel refused and
 * the Keeper resent -- leaves it alone while it streams and, once complete, replaces it in place if
 * its prose differs (owner ruling, 2026-10-03: identical prose stays, different prose replaces it
 * where it is, nothing already shown is withdrawn). The turn's delivered prose then takes the
 * draft's place (`delivered`).
 */
export class LiveDeliveryProse {
  private draft?: { id: string; shown: string };
  private readonly calls = new Map<number, { tool: string; field: string; live: boolean }>();
  private drafts = 0;

  constructor(private readonly prefix: string) {}

  /** A new turn: the previous turn's draft, delivered or not, is no longer this host's to change. */
  startTurn(): void {
    this.draft = undefined;
    this.calls.clear();
  }

  /** Pi restarts `contentIndex` with every assistant message. */
  messageEnded(): void {
    this.calls.clear();
  }

  /** A tool call began streaming; only a delivering one is followed. */
  start(index: number, toolName: unknown): void {
    const field = typeof toolName === "string" ? DELIVERY_PROSE_FIELDS[toolName] : undefined;
    if (!field) {
      this.calls.delete(index);
      return;
    }
    // A draft with nothing on screen yet is still open to whichever delivery fills it first.
    const live = !this.draft?.shown;
    if (live) {
      this.draft ??= { id: `${this.prefix}:${++this.drafts}`, shown: "" };
      for (const other of this.calls.values()) other.live = false;
    }
    this.calls.set(index, { tool: String(toolName), field, live });
  }

  /** More of a call's arguments arrived; `json` is everything received for it so far. */
  update(index: number, json: string): LiveProseDraw | undefined {
    const call = this.calls.get(index);
    if (!call?.live) return undefined;
    const found = streamingStringField(json, call.field);
    const prose=found?transportedProse(call.tool,call.field,found.value,found.complete):undefined;
    return prose!==undefined ? this.show(displayedProse(prose,priceRows(completeField(json,'effects'),completeField(json,'quotes')))) : undefined;
  }

  /** A call's arguments are complete. */
  end(index: number, args: unknown): LiveProseDraw | undefined {
    const call = this.calls.get(index);
    this.calls.delete(index);
    if (!call) return undefined;
    const value = finishedProseField(args, call.field);
    const prose=value===undefined?undefined:transportedProse(call.tool,call.field,value,true);
    if (prose === undefined) return undefined;
    let parsed=args;
    if(typeof args==='string'){try{parsed=JSON.parse(args);}catch{}}
    const row=isRecord(parsed)?parsed:{};
    return this.show(displayedProse(prose,priceRows(row.effects,row.quotes)).trim(), !call.live);
  }

  /** The turn's prose was delivered: the id of the draft it replaces, if one is on screen. */
  delivered(): string | undefined {
    const id = this.draft?.shown ? this.draft.id : undefined;
    this.draft = undefined;
    this.calls.clear();
    return id;
  }

  private show(text: string, replace = false): LiveProseDraw | undefined {
    const draft = this.draft;
    if (!draft || !text.trim() || text === draft.shown) return undefined;
    const first = !draft.shown;
    draft.shown = text;
    return { id: draft.id, text, first, ...(replace ? { replace: true as const } : {}) };
  }
}
