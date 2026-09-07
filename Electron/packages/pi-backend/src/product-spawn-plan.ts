import { createHash } from "node:crypto";

import type { SpawnRegisteredExtension } from "./spawn-assembly.js";

/**
 * A product pack selects extensions, and nothing else.
 *
 * This module used to translate a Product Profile into two parallel worlds: a
 * `SpawnFeatures` bitfield and a `SpawnPaths` record, joined to extension ids
 * by two hand-maintained owner tables, with the shipping Coding profile
 * bypassing the whole thing. Every one of those tables was a second place to
 * remember that an extension exists.
 *
 * There is now one place: `extension-enablement.ts` decides which manifest ids
 * are active, the loader turns those ids into agent-half mounts, and the
 * assembler mounts what it is given. All that is left here is the snapshot the
 * session header records so a Conversation can tell that its form changed under
 * it.
 */

export type ProductSpawnPlanInput = {
  /** Active pack extension id, or `base` when the project runs no pack. */
  packId: string;
  registeredExtensions: readonly SpawnRegisteredExtension[];
};

export type ProductSpawnPlan = {
  registeredExtensions: SpawnRegisteredExtension[];
};

/**
 * The spawn plan for one resolved form.
 *
 * `registeredExtensions` already carries the resolved enable overlay (the
 * loader applied it in `spawnPackages`), so this is a defensive copy rather
 * than a second filter — a second filter is exactly the drift this collapse
 * removed.
 */
export function resolveProductSpawnPlan(input: ProductSpawnPlanInput): ProductSpawnPlan {
  return { registeredExtensions: input.registeredExtensions.map(item => ({ ...item })) };
}

/**
 * Identity of the extension set a Conversation was started with. Only enabled
 * ids and versions participate: a host upgrade that leaves the same packages
 * enabled must not invalidate a running Conversation.
 */
export function productSpawnFingerprint(packId: string, plan: ProductSpawnPlan): string {
  const snapshot = {
    profileId: packId,
    extensions: plan.registeredExtensions
      .filter(item => item.enabled)
      .map(item => ({ id: item.id, version: item.version ?? "unknown" }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}
