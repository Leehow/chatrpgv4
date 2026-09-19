/** Host-owned, rebuildable evidence storage. It never writes campaign state, world files, or Git. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {withWorkspaceCacheLock, reserveWorkspaceBytes} from './workspace-cache.ts';

export const EVIDENCE_STORE_VERSION = 1;
export const EVIDENCE_AUTHORITIES = Object.freeze([
  "module_source", "rules_source", "campaign_adaptation", "table_record", "conversation_report",
] as const);
export type EvidenceAuthority = typeof EVIDENCE_AUTHORITIES[number];
export type EvidenceScope = Readonly<{ campaign: string; worldline: string; loop: number }>;
export type EvidenceCoverage = "complete" | "partial" | "unavailable" | Readonly<{
  status: "complete" | "partial" | "unavailable";
  omitted?: number;
  range?: Readonly<{ from: number; to: number }>;
}>;
export interface EvidenceInput {
  readonly scope: EvidenceScope;
  readonly source_revision: string;
  readonly stateStamp?: string;
  readonly authority: EvidenceAuthority;
  readonly locator: string;
  readonly body: string;
  readonly coverage?: EvidenceCoverage;
  readonly refs?: readonly string[];
  readonly scene_refs?: readonly string[];
  readonly entity_refs?: readonly string[];
  readonly thread_refs?: readonly string[];
}
export interface EvidenceReference {
  readonly id: string;
  readonly content_hash: string;
  readonly bytes: number;
  readonly scope: EvidenceScope;
  readonly source_revision: string;
  readonly stateStamp?: string;
  readonly authority: EvidenceAuthority;
  readonly locator: string;
  readonly coverage: EvidenceCoverage;
  readonly refs: readonly string[];
  readonly scene_refs: readonly string[];
  readonly entity_refs: readonly string[];
  readonly thread_refs: readonly string[];
}
export interface EvidenceBinding {
  readonly scope: EvidenceScope;
  readonly source_revision: string;
  readonly stateStamp?: string;
  readonly authorities?: readonly EvidenceAuthority[];
}
export type EvidenceRead =
  | { readonly status: "valid"; readonly reference: EvidenceReference; readonly body: string }
  | { readonly status: "miss" | "stale" | "unverifiable"; readonly reference?: EvidenceReference };

export interface EvidenceStoreLimits {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

export interface EvidenceStoreUsage {
  readonly entries: number;
  readonly bytes: number;
  /** Body or index bytes that no valid reference owns; quota-visible and rebuildable. */
  readonly orphanBytes: number;
  readonly temporaries: number;
}

const DEFAULT_LIMITS: Required<EvidenceStoreLimits> = Object.freeze({ maxEntries: 256, maxBytes: 128 * 1024 * 1024 });
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isDigest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const authority = (value: unknown): value is EvidenceAuthority => typeof value === "string" && (EVIDENCE_AUTHORITIES as readonly string[]).includes(value);
const scope = (value: unknown): value is EvidenceScope => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return isText(row.campaign) && isText(row.worldline) && typeof row.loop === "number" && Number.isInteger(row.loop) && row.loop >= 0;
};
const coverageValid = (value: unknown): value is EvidenceCoverage => value === undefined || value === "complete" || value === "partial" || value === "unavailable"
  || (typeof value === "object" && value !== null && ["complete", "partial", "unavailable"].includes(String((value as Record<string, unknown>).status)));
const complete = (value: EvidenceCoverage): boolean => value === "complete" || (typeof value === "object" && value !== null && value.status === "complete");
const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

export function evidenceId(value: EvidenceInput): string {
  return digest(JSON.stringify({scope: value.scope, source_revision: value.source_revision, stateStamp: value.stateStamp ?? null,
    authority: value.authority, locator: value.locator, content_hash: digest(value.body),
    refs: (value.refs ?? []).slice(0, 16), scene_refs: (value.scene_refs ?? []).slice(0, 16),
    entity_refs: (value.entity_refs ?? []).slice(0, 16), thread_refs: (value.thread_refs ?? []).slice(0, 16)}));
}

function validInput(value: unknown): value is EvidenceInput {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return scope(row.scope) && isText(row.source_revision) && authority(row.authority) && isText(row.locator)
    && typeof row.body === "string" && row.body.length <= 2 * 1024 * 1024
    && coverageValid(row.coverage) && (row.stateStamp === undefined || isText(row.stateStamp))
    && (row.refs === undefined || Array.isArray(row.refs) && row.refs.every(isText))
    && (row.scene_refs === undefined || Array.isArray(row.scene_refs) && row.scene_refs.every(isText))
    && (row.entity_refs === undefined || Array.isArray(row.entity_refs) && row.entity_refs.every(isText))
    && (row.thread_refs === undefined || Array.isArray(row.thread_refs) && row.thread_refs.every(isText));
}

/**
 * A reference read back from disk is trusted with filesystem paths only when every identifier it
 * carries is a strict hex digest the store itself would have minted. A tampered or corrupt index
 * therefore fails closed instead of steering a body read outside the root.
 */
function safeReference(row: unknown): row is EvidenceReference {
  if (!row || typeof row !== "object") return false;
  const value = row as Record<string, unknown>;
  return value.version === EVIDENCE_STORE_VERSION && isDigest(value.id) && isDigest(value.content_hash)
    && typeof value.bytes === "number" && Number.isInteger(value.bytes) && value.bytes >= 0 && scope(value.scope)
    && isText(value.source_revision) && authority(value.authority) && isText(value.locator)
    && coverageValid(value.coverage) && Array.isArray(value.refs) && value.refs.every(isText)
    && Array.isArray(value.scene_refs) && value.scene_refs.every(isText)
    && Array.isArray(value.entity_refs) && value.entity_refs.every(isText)
    && Array.isArray(value.thread_refs) && value.thread_refs.every(isText)
    && (value.stateStamp === undefined || isText(value.stateStamp));
}

/**
 * The root is supplied by the host and should be a cache directory (normally under HostRuntime.home).
 * The store intentionally has no campaign/world/git dependency, so deleting it is always a rebuild.
 */
export class EvidenceStore {
  readonly root: string;
  readonly limits: Required<EvidenceStoreLimits>;
  /** Every quota check and write runs on this chain: usage-then-write is serialized per store. */
  private queue: Promise<unknown> = Promise.resolve();
  constructor(root: string, limits: EvidenceStoreLimits = {}) {
    if (!isText(root) || root.includes("\0")) throw new TypeError("evidence store root must be a non-empty path");
    this.root = resolve(root);
    this.limits = {
      maxEntries: Number.isInteger(limits.maxEntries) && limits.maxEntries! > 0 ? limits.maxEntries! : DEFAULT_LIMITS.maxEntries,
      maxBytes: Number.isInteger(limits.maxBytes) && limits.maxBytes! > 0 ? limits.maxBytes! : DEFAULT_LIMITS.maxBytes,
    };
  }
  /** Defense in depth: even a hex id is resolved and checked against the root before use. */
  private contained(path: string): string {
    const resolved = resolve(path);
    if (resolved !== this.root && !resolved.startsWith(this.root + sep)) throw new TypeError("evidence path escapes the store root");
    return resolved;
  }
  private bodyPath(hash: string): string { return this.contained(join(this.root, "bodies", hash)); }
  private refPath(id: string): string { return this.contained(join(this.root, "refs", `${id}.json`)); }
  paths(id: string): Readonly<{ body: string; reference: string }> {
    if (!isDigest(id)) throw new TypeError("evidence reference id is invalid");
    return Object.freeze({ body: this.bodyPath(id), reference: this.refPath(id) });
  }
  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const locked = () => withWorkspaceCacheLock(this.root, job);
    const next = this.queue.then(locked, locked);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async atomic(path: string, data: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(data, "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporary, path);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  /** Quota-relevant bytes include orphan bodies and abandoned temporaries, not only valid refs. */
  private async scan(): Promise<{ entries: number; bytes: number; orphanBytes: number; temporaries: number; validIds: Set<string> }> {
    const validIds = new Set<string>();
    let entries = 0, bytes = 0, orphanBytes = 0, temporaries = 0;
    let names: string[];
    try { names = await readdir(join(this.root, "refs")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") names = []; else throw error; }
    for (const name of names) {
      const size = (await stat(join(this.root, "refs", name)).catch(() => null))?.size ?? 0;
      if (name.endsWith(".tmp")) { temporaries++; bytes += size; continue; }
      if (!name.endsWith(".json") || !isDigest(name.slice(0, -5))) continue;
      bytes += size;
      try {
        const ref = JSON.parse(await readFile(join(this.root, "refs", name), "utf8")) as Record<string, unknown>;
        if (!safeReference(ref) || ref.id !== name.slice(0, -5)) continue;
        validIds.add(String(ref.id));
        entries++;
      } catch { /* Corrupt indexes do not count against a future rebuild. */ }
    }
    let bodies: string[];
    try { bodies = await readdir(join(this.root, "bodies")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries, bytes, orphanBytes, temporaries, validIds }; throw error; }
    for (const name of bodies) {
      const size = (await stat(join(this.root, "bodies", name)).catch(() => null))?.size ?? 0;
      if (name.endsWith(".tmp")) { temporaries++; bytes += size; continue; }
      bytes += size;
      if (!validIds.has(name)) orphanBytes += size;
    }
    return { entries, bytes, orphanBytes, temporaries, validIds };
  }
  private async rebuildLocked(): Promise<Required<Omit<EvidenceStoreUsage, "temporaries" | "orphanBytes">> & { droppedOrphans: number; droppedTemporaries: number }> {
    const before = await this.scan();
    let droppedOrphans = 0, droppedTemporaries = 0;
    for (const folder of ["bodies", "refs"]) {
      let names: string[];
      try { names = await readdir(join(this.root, folder)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      for (const name of names) {
        const owned = folder === "bodies" ? before.validIds.has(name)
          : name.endsWith(".json") && before.validIds.has(name.slice(0, -5));
        if (owned && !name.endsWith(".tmp")) continue;
        await rm(join(this.root, folder, name), { force: true });
        if (name.endsWith(".tmp")) droppedTemporaries++;
        else droppedOrphans++;
      }
    }
    const after = await this.scan();
    return { entries: after.entries, bytes: after.bytes, droppedOrphans, droppedTemporaries };
  }
  /** Drop orphan bodies and abandoned temporaries; valid references and their bodies are kept. */
  async rebuild(): Promise<{ entries: number; bytes: number; droppedOrphans: number; droppedTemporaries: number }> {
    return this.serialize(() => this.rebuildLocked());
  }
  async put(value: EvidenceInput): Promise<EvidenceReference> {
    if (!validInput(value)) throw new TypeError("invalid evidence metadata or body");
    if (!complete(value.coverage ?? "complete")) throw new TypeError("incomplete evidence cannot be stored as valid evidence");
    return this.serialize(() => this.putLocked(value));
  }
  /** Host caches evict oldest optional references; standalone adapters keep explicit refusal semantics. */
  private async makeRoom(bytes: number): Promise<void> {
    if (basename(dirname(this.root)) !== 'workspace-cache') return;
    const names = (await readdir(join(this.root, 'refs')).catch(() => [])).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const ordered = await Promise.all(names.map(async name => ({name, modified: (await stat(join(this.root, 'refs', name))).mtimeMs})));
    for (const {name} of ordered.sort((a, b) => a.modified - b.modified)) {
      const usage = await this.scan();
      if (usage.entries < this.limits.maxEntries && usage.bytes + bytes <= this.limits.maxBytes) return;
      const id = name.slice(0, -5);
      await rm(this.refPath(id), {force: true}); await rm(this.bodyPath(id), {force: true});
    }
  }
  private async putLocked(value: EvidenceInput): Promise<EvidenceReference> {
    const content_hash = digest(value.body), bytes = Buffer.byteLength(value.body, "utf8");
    const id = evidenceId(value);
    const reference: EvidenceReference = Object.freeze({ version: EVIDENCE_STORE_VERSION, id, content_hash, bytes,
      scope: { ...value.scope }, source_revision: value.source_revision, ...(value.stateStamp ? { stateStamp: value.stateStamp } : {}),
      authority: value.authority, locator: value.locator, coverage: value.coverage ?? "complete",
      refs: [...(value.refs ?? [])].slice(0, 16), scene_refs: [...(value.scene_refs ?? [])].slice(0, 16),
      entity_refs: [...(value.entity_refs ?? [])].slice(0, 16), thread_refs: [...(value.thread_refs ?? [])].slice(0, 16) }) as EvidenceReference;
    const existing = await this.readReference(id);
    const referenceBytes = Buffer.byteLength(JSON.stringify(reference), 'utf8');
    await reserveWorkspaceBytes(this.root, value.scope.campaign, bytes + referenceBytes,
      [this.bodyPath(id), this.refPath(id)]);
    if (!existing) {
      let usage = await this.scan();
      if (usage.entries >= this.limits.maxEntries || usage.bytes + bytes + referenceBytes > this.limits.maxBytes) {
        // Orphans and temporaries are quota-visible and rebuildable: drop them once before giving up.
        await this.rebuildLocked();
        await this.makeRoom(bytes + referenceBytes);
        usage = await this.scan();
      }
      if (usage.entries >= this.limits.maxEntries || usage.bytes + bytes + referenceBytes > this.limits.maxBytes) throw new Error("evidence store quota exceeded");
      // The reference id includes the body hash and binding metadata, so this filename is
      // content-addressed while keeping `paths(id)` synchronous for host diagnostics.
      // Body first, reference last: a crash can only leave a rebuildable orphan body.
      await this.atomic(this.bodyPath(id), value.body);
      await this.atomic(this.refPath(id), JSON.stringify(reference));
    } else {
      // Self-heal: the id binds this exact body, so a missing or corrupted body is rewritten.
      let healthy = false;
      try {
        const body = await readFile(this.bodyPath(id), "utf8");
        healthy = Buffer.byteLength(body, "utf8") === bytes && digest(body) === content_hash;
      } catch { healthy = false; }
      if (!healthy) await this.atomic(this.bodyPath(id), value.body);
    }
    return reference;
  }
  private async readReference(id: string): Promise<EvidenceReference | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.refPath(id), "utf8"));
      return safeReference(value) && (value as EvidenceReference).id === id ? value as EvidenceReference : null;
    } catch { return null; }
  }
  async read(id: string, binding: EvidenceBinding): Promise<EvidenceRead> {
    if (!isDigest(id) || !scope(binding.scope) || !isText(binding.source_revision)) return { status: "unverifiable" };
    const reference = await this.readReference(id);
    if (!reference) return { status: "miss" };
    if (reference.scope.campaign !== binding.scope.campaign || reference.scope.worldline !== binding.scope.worldline || reference.scope.loop !== binding.scope.loop)
      return { status: "unverifiable" };
    if (binding.authorities && !binding.authorities.includes(reference.authority)) return { status: "unverifiable" };
    if (reference.source_revision !== binding.source_revision) return { status: "stale", reference };
    if (reference.stateStamp !== undefined && reference.stateStamp !== binding.stateStamp) return { status: "stale", reference };
    if (!complete(reference.coverage)) return { status: "miss", reference };
    try {
      const body = await readFile(this.bodyPath(reference.id), "utf8");
      if (Buffer.byteLength(body, "utf8") !== reference.bytes || digest(body) !== reference.content_hash
        || evidenceId({...reference, body}) !== reference.id) return { status: "miss", reference };
      return { status: "valid", reference, body };
    } catch { return { status: "miss", reference }; }
  }
  /** Alias used by host adapters that call the operation a lookup rather than a read. */
  async get(id: string, binding: EvidenceBinding): Promise<EvidenceRead> { return this.read(id, binding); }
  /** Alias used by capture adapters; writing remains optional and never changes formal state. */
  async write(value: EvidenceInput): Promise<EvidenceReference> { return this.put(value); }
  async manifest(binding: EvidenceBinding, limit = 24): Promise<readonly EvidenceReference[]> {
    if (!scope(binding.scope) || !isText(binding.source_revision) || !Number.isInteger(limit) || limit < 1) return [];
    let names: string[];
    try { names = await readdir(join(this.root, "refs")); } catch { return []; }
    const result: EvidenceReference[] = [];
    for (const name of names.filter(name => name.endsWith(".json")).sort().slice(0, Math.min(limit, 128))) {
      if (result.length >= Math.min(limit, 128)) break;
      const id = name.slice(0, -5);
      // A tampered index (foreign id, non-hex filename) is not manifest material.
      if (!isDigest(id)) continue;
      const reference = await this.readReference(id);
      if (!reference || reference.scope.campaign !== binding.scope.campaign || reference.scope.worldline !== binding.scope.worldline || reference.scope.loop !== binding.scope.loop
        || reference.source_revision !== binding.source_revision || (reference.stateStamp !== undefined && reference.stateStamp !== binding.stateStamp) || !complete(reference.coverage)) continue;
      if (binding.authorities && !binding.authorities.includes(reference.authority)) continue;
      result.push(reference);
    }
    return result;
  }
}

export function evidenceStoreRoot(home: string): string {
  if (!isText(home) || home.includes("\0")) throw new TypeError("host home must be a non-empty path");
  return join(resolve(home), ".coc", "workspace-cache", "evidence");
}

export function createEvidenceStore(homeOrRoot: string, limits?: EvidenceStoreLimits): EvidenceStore {
  return new EvidenceStore(homeOrRoot, limits);
}
