import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  projectExtensionActivationPath,
  readProjectExtensionActivation,
  setProjectExtensionOverride,
  writeProjectExtensionActivation,
} from "../src/extension-activation-store.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function write(body: unknown): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pipi-activation-"));
  await writeFile(projectExtensionActivationPath(root), `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return root;
}

describe("project extension activation store", () => {
  it("reads an absent file as no explicit toggles at all", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-activation-empty-"));
    expect(await readProjectExtensionActivation(root)).toEqual({ schemaVersion: 3, overrides: {} });
  });

  it("migrates a Coding Profile activation to the coding-workbench override with its overrides intact", async () => {
    // This is pure data migration: "coding-workbench" is only ever an id this
    // store writes into `overrides`. The base no longer installs anything by
    // that id (see extension-architecture-v1.md and extension-activation-store.ts's
    // LEGACY_PROFILE_PACK_IDS comment) — whether the override resolves to an
    // installed extension is for the enablement resolver to decide, not this store.
    const dir = await write({
      schemaVersion: 2,
      profile: "coding",
      overrides: { "web-access-extension": "disabled", "hydra-core": "enabled" },
    });

    expect(await readProjectExtensionActivation(dir)).toEqual({
      schemaVersion: 3,
      overrides: {
        "web-access-extension": "disabled",
        "hydra-core": "enabled",
        "coding-workbench": "enabled",
      },
    });
    expect(JSON.parse(await readFile(projectExtensionActivationPath(dir), "utf8")))
      .toMatchObject({ schemaVersion: 3 });
  });

  it("migrates the base Profile to no pack, keeping the same overrides", async () => {
    const dir = await write({ schemaVersion: 2, profile: "base", overrides: { "memory-extension": "disabled" } });
    expect(await readProjectExtensionActivation(dir)).toEqual({
      schemaVersion: 3,
      overrides: { "memory-extension": "disabled" },
    });
  });

  it("does not let the derived pack toggle overwrite one the user already wrote", async () => {
    const dir = await write({
      schemaVersion: 2,
      profile: "coding",
      overrides: { "coding-workbench": "disabled" },
    });
    expect((await readProjectExtensionActivation(dir)).overrides["coding-workbench"]).toBe("disabled");
  });

  it("migrates a pre-Profile boolean map", async () => {
    const dir = await write({ "git-capability": false, "memory-extension": true });
    expect(await readProjectExtensionActivation(dir)).toEqual({
      schemaVersion: 3,
      overrides: { "git-capability": "disabled", "memory-extension": "enabled" },
    });
  });

  it("never rewrites a file it did not need to change", async () => {
    const dir = await write({ schemaVersion: 3, overrides: { "git-capability": "disabled" } });
    const path = projectExtensionActivationPath(dir);
    const before = await stat(path);
    await new Promise(resolve => setTimeout(resolve, 12));

    await readProjectExtensionActivation(dir);
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  });

  it("refuses a malformed file rather than guessing", async () => {
    const dir = await write({ schemaVersion: 3, overrides: { "git-capability": "sometimes" } });
    await expect(readProjectExtensionActivation(dir)).rejects.toThrow(/overrides are invalid/);
  });

  it("round-trips one explicit toggle", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-activation-toggle-"));
    await writeProjectExtensionActivation(root, { schemaVersion: 3, overrides: { "memory-extension": "enabled" } });
    const next = await setProjectExtensionOverride(root, "git-capability", false);
    expect(next.overrides).toEqual({ "memory-extension": "enabled", "git-capability": "disabled" });
    expect(await readProjectExtensionActivation(root)).toEqual(next);
  });
});
