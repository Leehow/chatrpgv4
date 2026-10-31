import { createHash, randomUUID } from "node:crypto";

/**
 * The id of a new entity a Mod records in campaign state (a place, a feature, a perceptual relation, a situation).
 *
 * Random in play. Under a locked kernel seed (`COC_KERNEL_SEED`: replay evaluation and tests) it is a digest of the
 * seed and where the entity is made -- the turn, the call and what is named -- so the same call on the same starting
 * state names it the same way, and replaying a turn compares entity identity instead of masking it. An id the state
 * already holds is never reissued.
 */
export function entityId(kernel: { readonly entitySeed?: string | null }, prefix: string, where: readonly unknown[], taken: (id: string) => boolean = () => false): string {
  if (!kernel.entitySeed) return `${prefix}-${randomUUID()}`;
  for (let n = 0; ; n++) {
    const hex = createHash("sha256").update(JSON.stringify([kernel.entitySeed, prefix, ...where, n])).digest("hex");
    const id = `${prefix}-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    if (!taken(id)) return id;
  }
}
