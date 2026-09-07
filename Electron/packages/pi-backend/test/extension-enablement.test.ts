import { describe, expect, it } from "vitest";

import {
  activePackLayout,
  enablementBlockers,
  formatEnablementIssues,
  resolveExtensionEnablement,
  type InstalledExtension,
} from "../src/extension-enablement.js";

const CODING_LAYOUT = { primarySidebar: "coding.sessions", activity: ["coding.sessions"] };

/** A base with three capability extensions plus a Coding pack over them. */
function installed(overrides: Partial<Record<string, Partial<InstalledExtension>>> = {}): InstalledExtension[] {
  const base: InstalledExtension[] = [
    { id: "git-capability", version: "1.0.0", defaultEnabled: true },
    { id: "memory-extension", version: "0.1.0", defaultEnabled: true },
    { id: "skill-loader-extension", version: "1.0.0", defaultEnabled: true },
    { id: "workbench-panels", version: "1.0.0", defaultEnabled: false },
    {
      id: "demo-workbench",
      version: "1.0.0",
      defaultEnabled: false,
      layout: CODING_LAYOUT,
      dependencies: {
        required: [
          { id: "workbench-panels", version: "^1.0.0" },
          { id: "git-capability", version: "^1.0.0" },
        ],
      },
    },
  ];
  return base.map(item => ({ ...item, ...overrides[item.id] }));
}

describe("additive extension enablement", () => {
  it("enables every default-enabled package when no pack is on", () => {
    const resolved = resolveExtensionEnablement({ installed: installed() });
    expect(resolved.enabledIds).toEqual(["git-capability", "memory-extension", "skill-loader-extension"]);
    expect(resolved.packIds).toEqual([]);
    expect(activePackLayout(resolved, installed())).toBeUndefined();
    expect(resolved.issues).toEqual([]);
  });

  it("enables a package the manifest never mentions, because discovery said it is on", () => {
    // The regression a whitelist caused: a Profile authored before this project
    // existed could never name what the project installed into its own home.
    const resolved = resolveExtensionEnablement({
      installed: [...installed(), { id: "hydra-core", version: "3.1.0", defaultEnabled: true }],
    });
    expect(resolved.enabled["hydra-core"]).toBe(true);
    expect(resolved.reasons["hydra-core"]).toBe("default");
  });

  it("pulls a pack's required closure in, and releases it when the pack goes back off", () => {
    const on = resolveExtensionEnablement({
      installed: installed(),
      projectOverrides: { "demo-workbench": true },
    });
    expect(on.enabledIds).toContain("workbench-panels");
    expect(on.reasons["workbench-panels"]).toBe("dependency");
    expect(on.packIds).toEqual(["demo-workbench"]);
    expect(activePackLayout(on, installed())).toEqual({ id: "demo-workbench", layout: CODING_LAYOUT });

    const off = resolveExtensionEnablement({
      installed: installed(),
      projectOverrides: { "demo-workbench": false },
    });
    // Released: nothing else requires it and the user never enabled it.
    expect(off.enabled["workbench-panels"]).toBe(false);
    // Kept: it is a base capability, not part of the form.
    expect(off.enabled["git-capability"]).toBe(true);
  });

  it("keeps a dependency the user enabled explicitly after its pack is disabled", () => {
    const resolved = resolveExtensionEnablement({
      installed: installed(),
      projectOverrides: { "demo-workbench": false, "workbench-panels": true },
    });
    expect(resolved.enabled["workbench-panels"]).toBe(true);
    expect(resolved.reasons["workbench-panels"]).toBe("explicit");
  });

  it("lets an explicit disable survive a pack that requires the extension", () => {
    const resolved = resolveExtensionEnablement({
      installed: installed(),
      projectOverrides: { "demo-workbench": true, "git-capability": false },
    });
    expect(resolved.enabled["git-capability"]).toBe(false);
    // The pack stays on; the gap is reported instead of failing the whole thing closed.
    expect(resolved.enabled["demo-workbench"]).toBe(true);
    expect(formatEnablementIssues(resolved.issues)).toContain("git-capability");
  });

  it("lets a project toggle outrank an App toggle, and an App disable outrank a default", () => {
    const projectWins = resolveExtensionEnablement({
      installed: installed(),
      appOverrides: { "memory-extension": false },
      projectOverrides: { "memory-extension": true },
    });
    expect(projectWins.enabled["memory-extension"]).toBe(true);

    const appDisable = resolveExtensionEnablement({
      installed: installed(),
      appOverrides: { "memory-extension": false },
    });
    expect(appDisable.enabled["memory-extension"]).toBe(false);
  });

  it("turns on the product's defaultPack without an explicit toggle, and lets the user turn it off", () => {
    const enabled = resolveExtensionEnablement({ installed: installed(), defaultPackId: "demo-workbench" });
    expect(enabled.packIds).toEqual(["demo-workbench"]);
    expect(enabled.reasons["demo-workbench"]).toBe("default-pack");

    const disabled = resolveExtensionEnablement({
      installed: installed(),
      defaultPackId: "demo-workbench",
      projectOverrides: { "demo-workbench": false },
    });
    expect(disabled.packIds).toEqual([]);
  });

  it("reports a conflict between two enabled packages, naming both", () => {
    const withConflict = [
      ...installed(),
      {
        id: "rival-workbench",
        version: "1.0.0",
        defaultEnabled: false,
        layout: { primarySidebar: "rival.sessions" },
        dependencies: { conflicts: ["demo-workbench"] },
      },
    ];
    const before = resolveExtensionEnablement({
      installed: withConflict,
      projectOverrides: { "demo-workbench": true },
    });
    const after = resolveExtensionEnablement({
      installed: withConflict,
      projectOverrides: { "demo-workbench": true, "rival-workbench": true },
    });
    const blockers = enablementBlockers(before, after);
    expect(blockers).toEqual([{ code: "conflict", id: "rival-workbench", conflictsWith: "demo-workbench" }]);
    expect(formatEnablementIssues(blockers)).toBe("rival-workbench conflicts with demo-workbench");
  });

  it("blocks a pack whose required package is missing or version-mismatched", () => {
    const stale = installed({ "git-capability": { version: "0.4.0" } })
      .filter(item => item.id !== "workbench-panels");
    const blockers = enablementBlockers(
      resolveExtensionEnablement({ installed: stale }),
      resolveExtensionEnablement({ installed: stale, projectOverrides: { "demo-workbench": true } }),
    );
    expect(blockers.map(issue => issue.code).sort()).toEqual(["missing", "version_mismatch"]);
    expect(formatEnablementIssues(blockers)).toContain("workbench-panels");
    expect(formatEnablementIssues(blockers)).toContain("0.4.0");
  });

  it("terminates on a dependency cycle instead of recursing", () => {
    const cyclic: InstalledExtension[] = [
      { id: "alpha", version: "1.0.0", defaultEnabled: true, dependencies: { required: [{ id: "beta", version: "^1.0.0" }] } },
      { id: "beta", version: "1.0.0", defaultEnabled: false, dependencies: { required: [{ id: "alpha", version: "^1.0.0" }] } },
    ];
    expect(resolveExtensionEnablement({ installed: cyclic }).enabledIds).toEqual(["alpha", "beta"]);
  });
});
