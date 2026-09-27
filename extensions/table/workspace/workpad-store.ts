/** KIC-04 host-only Workpad cache (contract §19.2): bounded, atomic, rebuildable, never game state. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {withWorkspaceCacheLock, reserveWorkspaceBytes} from '../../../kernel-ts/read/workspace-cache.ts';

export const WORKPAD_STORE_VERSION = 2;
/** Whole-workpad and single-patch byte bounds (plan §1 configuration starting points). */
export const WORKPAD_BYTES = 2 * 1024;
export const WORKPAD_PATCH_BYTES = 1024;
export const WORKPAD_MAX_ITEMS = 12;
export const WORKPAD_MAX_UPSERTS = 8;
export const WORKPAD_MAX_REMOVES = 8;
export const WORKPAD_TEXT_CHARS = 200;
export const WORKPAD_ID_CHARS = 64;
export const WORKPAD_FOCUS_CHARS = 200;
export const WORKPAD_EVIDENCE_REFS = 4;

export const WORKPAD_KINDS = Object.freeze(["open_question", "hypothesis", "conditional_continuation"] as const);
export const WORKPAD_STATUSES = Object.freeze(["tentative", "needs_recheck", "discarded"] as const);
export type WorkpadKind = typeof WORKPAD_KINDS[number];
export type WorkpadStatus = typeof WORKPAD_STATUSES[number];
export type WorkpadScope = Readonly<{ campaign: string; worldline: string; loop: number; scene?: string }>;

export interface WorkpadUpsert {
  readonly id: string;
  readonly kind: WorkpadKind;
  readonly text: string;
  readonly status: WorkpadStatus;
  /** Names of evidence entries from the same call-start snapshot; membership is checked by the host. */
  readonly evidence: readonly string[];
}
export interface WorkpadPatch {
  readonly focus?: string;
  readonly upserts: readonly WorkpadUpsert[];
  readonly removes: readonly string[];
}
/** One entry as stored; `turn`/`stateStamp` are the publish-time binding used for staleness. */
export interface WorkpadEntry {
  readonly id: string;
  readonly kind: WorkpadKind;
  readonly text: string;
  readonly status: WorkpadStatus;
  readonly evidence: readonly string[];
  readonly turn: number;
  readonly stateStamp: string;
  readonly sourceRevision?: string;
}
export interface WorkpadView {
  readonly revision: number;
  readonly focus: string | null;
  readonly entries: readonly WorkpadEntry[];
  readonly stateStamp?: string;
  readonly sourceRevision?: string;
}
export type WorkpadRead = { readonly status: "empty" } | { readonly status: "ok"; readonly view: WorkpadView };
export type WorkpadPublish =
  | { readonly status: "published"; readonly view: WorkpadView }
  | { readonly status: "discarded"; readonly reason: string };

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const serialized = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

const isScope = (value: unknown): value is WorkpadScope => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return isText(row.campaign) && isText(row.worldline) && typeof row.loop === "number"
    && Number.isSafeInteger(row.loop) && row.loop >= 0
    && (row.scene === undefined || isText(row.scene));
};

/**
 * Strict patch validation. The allowlist is the contract: any unknown key (a confidence number,
 * a do-not-research flag, a fact claim, a JSON Pointer path) makes the whole patch invalid, and
 * an invalid patch is discarded by the host without ever blocking the delivery that carried it.
 */
export function validateWorkpadPatch(raw: unknown): { ok: true; patch: WorkpadPatch; bytes: number } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_patch" };
  const row = raw as Record<string, unknown>;
  const allowed = new Set(["focus", "upserts", "removes"]);
  for (const key of Object.keys(row)) if (!allowed.has(key)) return { ok: false, reason: "invalid_patch" };
  if (!("focus" in row || "upserts" in row || "removes" in row)) return { ok: false, reason: "invalid_patch" };
  let focus: string | undefined;
  if (row.focus !== undefined) {
    if (typeof row.focus !== "string" || row.focus.length > WORKPAD_FOCUS_CHARS) return { ok: false, reason: "invalid_patch" };
    focus = row.focus;
  }
  let upserts: WorkpadUpsert[] = [];
  if (row.upserts !== undefined) {
    // An empty array is allowed here: the final no-op check below rejects a patch that carries
    // nothing, and validation must stay idempotent because publish re-validates the normalized
    // patch the bind step already validated.
    if (!Array.isArray(row.upserts) || row.upserts.length > WORKPAD_MAX_UPSERTS) return { ok: false, reason: "invalid_patch" };
    for (const item of row.upserts) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "invalid_patch" };
      const entry = item as Record<string, unknown>;
      for (const key of Object.keys(entry)) if (!["id", "kind", "text", "status", "evidence"].includes(key)) return { ok: false, reason: "invalid_patch" };
      if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) return { ok: false, reason: "invalid_patch" };
      if (!(WORKPAD_KINDS as readonly string[]).includes(String(entry.kind))) return { ok: false, reason: "invalid_patch" };
      if (typeof entry.text !== "string" || entry.text.trim().length === 0 || entry.text.length > WORKPAD_TEXT_CHARS) return { ok: false, reason: "invalid_patch" };
      const status = entry.status === undefined ? "tentative" : entry.status;
      if (!(WORKPAD_STATUSES as readonly string[]).includes(String(status))) return { ok: false, reason: "invalid_patch" };
      if (!Array.isArray(entry.evidence) || entry.evidence.length < 1 || entry.evidence.length > WORKPAD_EVIDENCE_REFS
        || !entry.evidence.every(ref => isText(ref) && ref.length <= WORKPAD_TEXT_CHARS && !ref.startsWith("/") && !ref.includes(".."))) {
        return { ok: false, reason: "invalid_patch" };
      }
      upserts.push({ id: entry.id, kind: entry.kind as WorkpadKind, text: entry.text, status: status as WorkpadStatus,
        evidence: [...entry.evidence as string[]] });
    }
    const ids = new Set(upserts.map(item => item.id));
    if (ids.size !== upserts.length) return { ok: false, reason: "invalid_patch" };
  }
  let removes: string[] = [];
  if (row.removes !== undefined) {
    if (!Array.isArray(row.removes) || row.removes.length > WORKPAD_MAX_REMOVES
      || !row.removes.every(id => typeof id === "string" && ID_PATTERN.test(id))) return { ok: false, reason: "invalid_patch" };
    removes = [...row.removes as string[]];
  }
  const patch: WorkpadPatch = { ...(focus !== undefined ? { focus } : {}), upserts, removes };
  if (upserts.length + removes.length === 0 && focus === undefined) return { ok: false, reason: "invalid_patch" };
  const bytes = serialized(patch);
  if (bytes > WORKPAD_PATCH_BYTES) return { ok: false, reason: "patch_over_budget" };
  return { ok: true, patch, bytes };
}

/** A stored entry is trusted only with the exact shape the store itself writes. */
function safeEntry(value: unknown): value is WorkpadEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && ID_PATTERN.test(row.id)
    && (WORKPAD_KINDS as readonly string[]).includes(String(row.kind))
    && typeof row.text === "string" && row.text.length > 0 && row.text.length <= WORKPAD_TEXT_CHARS
    && (WORKPAD_STATUSES as readonly string[]).includes(String(row.status))
    && Array.isArray(row.evidence) && row.evidence.length >= 1 && row.evidence.length <= WORKPAD_EVIDENCE_REFS
    && row.evidence.every(ref => isText(ref) && ref.length <= WORKPAD_TEXT_CHARS)
    && typeof row.turn === "number" && Number.isSafeInteger(row.turn) && row.turn >= 0
    && isText(row.stateStamp) && row.stateStamp.length <= 64
    && (row.sourceRevision === undefined || isText(row.sourceRevision))
    && Object.keys(row).every(key => ["id", "kind", "text", "status", "evidence", "turn", "stateStamp", "sourceRevision"].includes(key));
}

/**
 * The root is supplied by the host and must be a cache directory (normally under the runtime
 * home). Like the evidence store, this cache has no campaign/world/git dependency: deleting it
 * is always a safe rebuild, and nothing here is authoritative state.
 */
export class WorkpadStore {
  readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();
  /** SL-87: the clock the cross-instance lock's wait is measured on (`withWorkspaceCacheLock`); absent, `Date.now`. */
  private readonly now?: () => number;

  constructor(root: string, options: {now?: () => number} = {}) {
    if (!isText(root) || root.includes("\0")) throw new TypeError("workpad store root must be a non-empty path");
    this.root = resolve(root);
    this.now = options.now;
  }

  private contained(path: string): string {
    const resolved = resolve(path);
    if (resolved !== this.root && !resolved.startsWith(this.root + sep)) throw new TypeError("workpad path escapes the store root");
    return resolved;
  }

  /** Scope names are sanitized and disambiguated by a digest, so a crafted scope cannot escape. */
  private path(scope: WorkpadScope): string {
    const safe = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48);
    return this.contained(join(this.root,
      `${safe(scope.campaign)}.${safe(scope.worldline)}.${scope.loop}.${digest(JSON.stringify(scope)).slice(0, 12)}.json`));
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const locked = () => withWorkspaceCacheLock(this.root, job, this.now);
    const next = this.queue.then(locked, locked);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async atomic(path: string, data: string, signal?: AbortSignal): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(data, "utf8");
      await handle.sync();
      await handle.close();
      if (signal?.aborted) throw new Error('workpad publication cancelled');
      await rename(temporary, path);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * A document that is corrupt, foreign-scoped, oversized or shape-broken reads as an empty
   * workpad — a miss on a rebuildable cache, never an error and never partial trust.
   */
  private async readLocked(scope: WorkpadScope): Promise<WorkpadRead> {
    let raw: string;
    try { raw = await readFile(this.path(scope), "utf8"); }
    catch { return { status: "empty" }; }
    if (Buffer.byteLength(raw, "utf8") > WORKPAD_BYTES) return { status: "empty" };
    let document: Record<string, unknown>;
    try { document = JSON.parse(raw) as Record<string, unknown>; } catch { return { status: "empty" }; }
    if (document.version !== WORKPAD_STORE_VERSION || !isScope(document.scope)) return { status: "empty" };
    const fileScope = document.scope as WorkpadScope;
    if (fileScope.campaign !== scope.campaign || fileScope.worldline !== scope.worldline || fileScope.loop !== scope.loop
      || fileScope.scene !== scope.scene) return { status: "empty" };
    if (!Number.isSafeInteger(document.revision) || (document.revision as number) < 0) return { status: "empty" };
    if (document.focus !== null && typeof document.focus !== "string") return { status: "empty" };
    if (!Array.isArray(document.entries)) return { status: "empty" };
    if (document.entries.length > WORKPAD_MAX_ITEMS) return { status: "empty" };
    if (!document.entries.every(safeEntry)) return { status: "empty" };
    const ids = new Set((document.entries as WorkpadEntry[]).map(entry => entry.id));
    if (ids.size !== document.entries.length) return { status: "empty" };
    const view: WorkpadView = { revision: document.revision as number, focus: (document.focus as string | null) ?? null,
      entries: document.entries as WorkpadEntry[],
      ...(typeof document.stateStamp === 'string' ? {stateStamp: document.stateStamp} : {}),
      ...(typeof document.sourceRevision === 'string' ? {sourceRevision: document.sourceRevision} : {}) };
    if (serialized(view) > WORKPAD_BYTES) return { status: "empty" };
    return { status: "ok", view };
  }

  async read(scope: WorkpadScope): Promise<WorkpadRead> {
    if (!isScope(scope)) return { status: "empty" };
    return this.readLocked(scope);
  }

  /**
   * Revision-compared publish. A patch bound to a revision that is no longer current is
   * discarded, never merged; a patch that would push the workpad past a bound is discarded as
   * over-limit instead of silently evicting the Keeper's earlier items.
   */
  async publish(input: {
    scope: WorkpadScope; baseRevision: number; turn: number; stateStamp: string; sourceRevision?: string; patch: WorkpadPatch; signal?: AbortSignal;
  }): Promise<WorkpadPublish> {
    if (!isScope(input.scope) || !isText(input.stateStamp) || !Number.isSafeInteger(input.turn) || input.turn < 0) {
      return { status: "discarded", reason: "invalid_scope" };
    }
    const validated = validateWorkpadPatch(input.patch);
    if (!validated.ok) return { status: "discarded", reason: validated.reason };
    return this.serialize(() => this.publishLocked(input.scope, input.baseRevision, input.turn, input.stateStamp, validated.patch, input.sourceRevision, input.signal));
  }

  private async publishLocked(scope: WorkpadScope, baseRevision: number, turn: number, stateStamp: string, patch: WorkpadPatch, sourceRevision?: string, signal?: AbortSignal): Promise<WorkpadPublish> {
    const current = await this.readLocked(scope);
    if (signal?.aborted) return {status: 'discarded', reason: 'cancelled'};
    const currentRevision = current.status === "ok" ? current.view.revision : 0;
    if (currentRevision !== baseRevision) return { status: "discarded", reason: "revision_conflict" };
    const focus = patch.focus !== undefined ? patch.focus : current.status === "ok" ? current.view.focus : null;
    let entries: WorkpadEntry[] = current.status === "ok" ? [...current.view.entries] : [];
    for (const id of patch.removes) entries = entries.filter(entry => entry.id !== id);
    for (const upsert of patch.upserts) {
      entries = entries.filter(entry => entry.id !== upsert.id);
      entries.push({ id: upsert.id, kind: upsert.kind, text: upsert.text, status: upsert.status,
        evidence: [...upsert.evidence], turn, stateStamp, ...(sourceRevision ? {sourceRevision} : {}) });
    }
    const view: WorkpadView = { revision: currentRevision + 1, focus, entries, stateStamp, ...(sourceRevision ? {sourceRevision} : {}) };
    const document = { version: WORKPAD_STORE_VERSION, scope: { ...scope }, ...view };
    if (entries.length > WORKPAD_MAX_ITEMS || serialized(document) > WORKPAD_BYTES) return { status: "discarded", reason: "workpad_over_limit" };
    await reserveWorkspaceBytes(this.root, scope.campaign, serialized(document), [this.path(scope)]);
    await this.atomic(this.path(scope), JSON.stringify(document), signal);
    return { status: "published", view };
  }
}

export function workpadStoreRoot(home: string): string {
  if (!isText(home) || home.includes("\0")) throw new TypeError("host home must be a non-empty path");
  return join(resolve(home), ".coc", "workspace-cache", "workpad");
}

export function createWorkpadStore(homeOrRoot: string, options: {now?: () => number} = {}): WorkpadStore {
  return new WorkpadStore(homeOrRoot, options);
}
