/**
 * KIC-04 host lifecycle for the workpad_patch tool parameter (contract §19.2).
 *
 * The patch is the Keeper's own reversible working notes. The host deletes it from the call
 * arguments before the payload exists, binds it to the call-start snapshot, and publishes it
 * only after the same delivery truly succeeds. Every discard is a telemetry row and nothing
 * else: the delivery never changes shape, and no model round is spent on a dropped draft.
 */
import type { WorkspaceMode } from './projection.ts';
import {workspaceCandidates} from './projection.ts';
import {createHash} from 'node:crypto';
import { createWorkpadStore, validateWorkpadPatch,
  type WorkpadPatch, type WorkpadScope } from './workpad-store.ts';

export interface WorkpadBinding {
  readonly tool: string;
  readonly scope: WorkpadScope;
  readonly turn: number;
  readonly stateStamp: string;
  readonly baseRevision: number;
  readonly patch: WorkpadPatch;
  readonly bytes: number;
  readonly root: string;
  readonly sourceRevision: string;
}

export interface WorkpadHost {
  /** The same host-only read the projection lane uses; it never enters the turn state machine. */
  workspaceRead(campaign: string, references?: string[]): Promise<unknown>;
  /** The host cache root, or undefined when the session cannot name one. */
  root(): string | undefined;
  record(row: Record<string, unknown>): void | Promise<void>;
}
/** Publish and drop only ever write telemetry; the delivery that carried the patch is done. */
export type WorkpadSink = Pick<WorkpadHost, "record">;

/** Delete-and-capture: past this line no payload, Mod hook, admission check or RPC sees the patch. */
export function takeWorkpadPatch(tool: string, params: Record<string, unknown>): unknown {
  if ((tool !== 'narrate' && tool !== 'ask') || !('workpad_patch' in params)) return undefined;
  const raw = params.workpad_patch;
  delete params.workpad_patch;
  return raw;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The evidence universe of one snapshot: module locators plus committed record locators. */
function evidenceUniverse(snapshot: Record<string, unknown>): Set<string> {
  return new Set(workspaceCandidates(snapshot, object(snapshot.binding) as any).map(ref => ref.locator));
}

export function workpadSourceRevision(binding: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify([binding.source_revision, binding.rules_revision, binding.adapter])).digest('hex');
}

const drop = async (host: WorkpadSink, reason: string, extra: Record<string, unknown> = {}): Promise<undefined> => {
  await host.record({ lane: 'workpad', event: 'dropped', reason, ...extra });
  return undefined;
};

/**
 * Bind a carried patch to the call-start state. Any failure — mode off, invalid shape,
 * unverifiable snapshot, unverified evidence name, unavailable store — discards the patch and
 * returns undefined; the delivery that carried it proceeds exactly as if it had not.
 */
export async function bindWorkpadPatch(
  host: WorkpadHost, tool: string, campaign: string, mode: WorkspaceMode, raw: unknown,
): Promise<WorkpadBinding | undefined> {
  if (mode === 'off') return drop(host, 'workspace_off', { tool });
  const validated = validateWorkpadPatch(raw);
  if (!validated.ok) return drop(host, validated.reason, { tool });
  let snapshot: Record<string, unknown>;
  try { snapshot = object(await host.workspaceRead(campaign, [...new Set(validated.patch.upserts.flatMap(entry => [...entry.evidence]))])); }
  catch (error) { return drop(host, 'binding_unavailable', { tool, detail: String(error).slice(0, 160) }); }
  if (snapshot.status !== 'valid') return drop(host, 'binding_unavailable', { tool });
  const binding = object(snapshot.binding);
  const campaignName = binding.campaign, worldline = binding.worldline, loop = binding.loop,
    turn = binding.turn, stateStamp = binding.stateStamp;
  if (campaignName !== campaign || typeof worldline !== 'string' || typeof loop !== 'number' || !Number.isSafeInteger(loop)
    || typeof turn !== 'number' || !Number.isSafeInteger(turn) || typeof stateStamp !== 'string' || !stateStamp) {
    return drop(host, 'binding_unavailable', { tool });
  }
  const scope: WorkpadScope = { campaign: campaignName, worldline, loop,
    ...(typeof binding.scene === 'string' && binding.scene ? {scene: binding.scene} : {}) };
  const universe = evidenceUniverse(snapshot);
  for (const upsert of validated.patch.upserts)
    for (const ref of upsert.evidence)
      if (!universe.has(ref)) return drop(host, 'evidence_unverified', { tool, ref: ref.slice(0, 80) });
  const root = host.root();
  if (!root) return drop(host, 'store_unavailable', { tool });
  let baseRevision = 0;
  try {
    const read = await createWorkpadStore(root).read(scope);
    if (read.status === 'ok') baseRevision = read.view.revision;
  } catch { baseRevision = 0; }
  const bound: WorkpadBinding = {
    tool, scope, turn, stateStamp, baseRevision, patch: validated.patch, bytes: validated.bytes, root,
    sourceRevision: workpadSourceRevision(binding),
  };
  await host.record({ lane: 'workpad', event: 'bound', tool, turn, items: validated.patch.upserts.length,
    removes: validated.patch.removes.length, bytes: validated.bytes });
  return bound;
}

/** Publish after true delivery success, or record why the patch was dropped. Never throws. */
export async function publishWorkpadPatch(host: WorkpadSink, binding: WorkpadBinding | undefined, signal?: AbortSignal): Promise<void> {
  if (!binding) return;
  try {
    if (signal?.aborted) { await host.record({ lane: 'workpad', event: 'dropped', reason: 'cancelled', turn: binding.turn }); return; }
    const result = await createWorkpadStore(binding.root).publish({
      scope: binding.scope, baseRevision: binding.baseRevision, turn: binding.turn,
      stateStamp: binding.stateStamp, sourceRevision: binding.sourceRevision, patch: binding.patch, signal,
    });
    if (result.status === 'published') {
      await host.record({ lane: 'workpad', event: 'published', turn: binding.turn, revision: result.view.revision,
        entries: result.view.entries.length, bytes: JSON.stringify(result.view).length });
    } else await host.record({ lane: 'workpad', event: 'dropped', reason: result.reason, turn: binding.turn });
  } catch (error) {
    host.record({ lane: 'workpad', event: 'dropped', reason: 'store_write_failed', turn: binding.turn,
      detail: String(error).slice(0, 160) });
  }
}
