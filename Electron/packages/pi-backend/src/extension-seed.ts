import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EXTENSION_MANIFEST_FILENAME } from "./extension-manifest.js";
import { resolveActiveExtensionObject } from "./extension-update-engine.js";
import type { ExtensionUpdateComponent } from "./extension-update-components.js";
import type { SpawnRegisteredExtension } from "./spawn-assembly.js";

/**
 * Recovery-seed wiring for the shared-architecture extension wave.
 *
 * The bundled copies of these extensions ship read-only inside the App
 * (`Contents/Resources/pipiui-runtime/extensions/<id>` — signature-protected)
 * and act as the recovery seed of the update-engine fallback chain
 * (active slot → previous slot → seed). Shared-store installs always win;
 * every write goes to the App-profile store, never into the seed tree.
 */
/**
 * Whether the bundled seed of `extensionId` opts into the recovery-seed chain.
 *
 * This was an id list here in the host. It is now a manifest property
 * (`update.seedManaged`) read from the seed tree, so adding a seed-managed
 * package is a line in that package's own manifest instead of an edit to a
 * host table nothing checks. An unreadable or non-declaring seed is not
 * seed-managed: the fallback chain fails closed onto the bundled mount.
 */
export async function isSeedManagedExtension(seedRoot: string | undefined, extensionId: string): Promise<boolean> {
  if (!seedRoot) return false;
  try {
    const manifest = JSON.parse(
      await readFile(join(seedRoot, extensionId, EXTENSION_MANIFEST_FILENAME), "utf8"),
    ) as { update?: { seedManaged?: unknown } };
    return manifest.update?.seedManaged === true;
  } catch {
    return false;
  }
}

export type SeedResolution = {
  extensionId: string;
  objectDir: string;
  slot: "active" | "previous" | "seed";
  /** Manifest version of the resolved object (absent when unreadable). */
  version?: string;
  /** Manifest `agent.extension` entry of the resolved object (absent when unreadable/undeclared). */
  agentEntry?: string;
};

/**
 * Resolve one seed-managed extension through the update-engine fallback chain.
 * `undefined` when the id is not seed-managed or neither store slot nor seed
 * carries a readable package. Reads only — never writes to either tree.
 */
export async function resolveSeedExtension(input: {
  storeRoot: string;
  seedRoot?: string;
  extensionId: string;
}): Promise<SeedResolution | undefined> {
  if (!(await isSeedManagedExtension(input.seedRoot, input.extensionId))) return undefined;
  const resolved = await resolveActiveExtensionObject({
    storeRoot: input.storeRoot,
    extensionId: input.extensionId,
    seedRoot: input.seedRoot,
  });
  if (!resolved) return undefined;
  const out: SeedResolution = {
    extensionId: input.extensionId,
    objectDir: resolved.objectDir,
    slot: resolved.slot,
  };
  try {
    const manifest = JSON.parse(await readFile(join(resolved.objectDir, EXTENSION_MANIFEST_FILENAME), "utf8")) as {
      version?: unknown;
      agent?: { extension?: unknown };
    };
    if (typeof manifest.version === "string" && manifest.version) out.version = manifest.version;
    if (typeof manifest.agent?.extension === "string" && manifest.agent.extension) {
      out.agentEntry = manifest.agent.extension;
    }
  } catch {
    /* identity fields stay absent; callers keep the bundled mount */
  }
  return out;
}

/**
 * Prefer shared-store installs for seed-managed agent-half mounts: a store
 * object (active or previous slot) with a declared agent entry overrides the
 * bundled seed path. Seed-slot resolutions and unresolved ids keep the
 * bundled path unchanged.
 */
export async function applySeedMountOverrides(input: {
  storeRoot: string;
  seedRoot?: string;
  extensions: readonly SpawnRegisteredExtension[];
}): Promise<SpawnRegisteredExtension[]> {
  const out: SpawnRegisteredExtension[] = [];
  for (const pkg of input.extensions) {
    if (!pkg.extensionPath || !(await isSeedManagedExtension(input.seedRoot, pkg.id))) {
      out.push(pkg);
      continue;
    }
    const resolved = await resolveSeedExtension({
      storeRoot: input.storeRoot,
      seedRoot: input.seedRoot,
      extensionId: pkg.id,
    });
    if (!resolved || resolved.slot === "seed" || !resolved.agentEntry) {
      out.push(pkg);
      continue;
    }
    out.push({ ...pkg, extensionPath: join(resolved.objectDir, resolved.agentEntry) });
  }
  return out;
}

/** Minimal shape the version priority applies to (loader list items). */
export type SeedVersionSource = {
  id: string;
  version: string;
  updateComponents?: readonly ExtensionUpdateComponent[];
};

/**
 * Version priority for update-center discovery: a store-installed version
 * (active or previous slot) supersedes the bundled declaration — both on the
 * item and on the package-as-component entry (`component.id === item.id`,
 * the convention that makes a component transactional). Seed-slot and
 * unreadable resolutions leave the item untouched.
 */
export function withSeedVersionPriority<T extends SeedVersionSource>(item: T, resolved: SeedResolution | undefined): T {
  if (!resolved || resolved.slot === "seed" || !resolved.version) return item;
  const out: T = { ...item, version: resolved.version };
  if (item.updateComponents?.length) {
    out.updateComponents = item.updateComponents.map(component =>
      component.id === item.id ? { ...component, version: resolved.version! } : component,
    );
  }
  return out;
}

export type TransactionalComponentSelection =
  | { ok: true; component: ExtensionUpdateComponent }
  | { ok: false; code: "not_found" | "unsupported_source"; error: string };

/**
 * Pick the component a one-click update transaction may run. First version:
 * `githubReleases` sources whose component id equals the extension id — the
 * released artifact is the extension package itself. Upstream-artifact
 * components (a third-party binary an extension wraps) and npm/pypi discovery
 * stay metadata-only and are rejected with `unsupported_source`.
 */
export function selectTransactionalUpdateComponent(input: {
  extensionId: string;
  components?: readonly ExtensionUpdateComponent[];
  componentId?: string;
}): TransactionalComponentSelection {
  if (!input.components?.length) {
    return { ok: false, code: "unsupported_source", error: `extension ${input.extensionId} declares no updateComponents` };
  }
  const component = input.componentId
    ? input.components.find(entry => entry.id === input.componentId)
    : input.components.find(entry => entry.id === input.extensionId);
  if (!component) {
    if (input.componentId) {
      return { ok: false, code: "not_found", error: `extension ${input.extensionId} declares no update component '${input.componentId}'` };
    }
    return { ok: false, code: "unsupported_source", error: `extension ${input.extensionId} declares no transactional package component (component id equal to the extension id)` };
  }
  if (component.source.type !== "githubReleases") {
    return { ok: false, code: "unsupported_source", error: `component '${component.id}' source '${component.source.type}' supports discovery only; first version updates official githubReleases packages only` };
  }
  if (component.id !== input.extensionId) {
    return { ok: false, code: "unsupported_source", error: `component '${component.id}' releases an upstream artifact, not the '${input.extensionId}' extension package; it cannot run the package update transaction` };
  }
  return { ok: true, component };
}

/**
 * Official ed25519 verification key for extension update transactions, pinned
 * out-of-band by the host (`PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY`, base64 SPKI
 * DER). Absent/unset → `undefined` and the engine refuses every artifact
 * (fail closed); the recovery seed keeps the App functional.
 */
export function extensionUpdateSigningKey(): import("node:crypto").KeyObject | undefined {
  const raw = process.env.PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY?.trim();
  if (!raw) return undefined;
  try {
    return createPublicKey({ key: Buffer.from(raw, "base64"), format: "der", type: "spki" });
  } catch {
    throw new Error("PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY is not a base64 SPKI DER ed25519 public key");
  }
}
