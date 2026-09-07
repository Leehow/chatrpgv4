import { describe, expect, it } from "vitest";

import { productSpawnFingerprint, resolveProductSpawnPlan } from "../src/product-spawn-plan.js";
import { assemblePiSpawn } from "../src/spawn-assembly.js";

/**
 * A product pack selects extension ids, and the mount set follows.
 *
 * The old plan translated a profile into a feature bitfield and a path record
 * through two owner tables, with the shipping Coding profile bypassing both.
 * Now the enable overlay the resolver produced is already carried by
 * `registeredExtensions`, so the only observable is which agent halves reach
 * the child's `-e` list — and that is asserted through the assembler.
 */
describe("product pack Pi spawn plan", () => {
  const kernel = {
    "secret-vault": "/runtime/kernel/secret-vault.ts",
    "update-center": "/runtime/kernel/update-center.ts",
    "runtime-info": "/runtime/kernel/runtime-info.ts",
  } as const;

  function mounts(args: readonly string[]): string[] {
    const out: string[] = [];
    for (let index = 0; index < args.length; index += 1) if (args[index] === "-e") out.push(args[index + 1]!);
    return out;
  }

  it("keeps the base Profile usable with its Skill Loader but without Coding mounts", () => {
    const resolved = resolveProductSpawnPlan({
      profileId: "base",
      registeredExtensions: [
        { id: "skill-loader-extension", enabled: true, extensionPath: "/runtime/skill-loader/agent/index.ts", skillRoots: ["/runtime/skills"] },
        { id: "file-tools", enabled: false, extensionPath: "/runtime/coding/agent/index.ts" },
        { id: "agent-orchestration", enabled: false, extensionPath: "/runtime/subagent/agent/index.ts" },
      ],
    });
    const spawn = assemblePiSpawn({
      cwd: "/workspace",
      resourceMode: "explicit",
      bridgePort: 1234,
      sessionCapability: "session-capability",
      kernel,
      ...resolved,
    });

    expect(spawn.args).toEqual(expect.arrayContaining(["--no-extensions", "--no-skills"]));
    expect(mounts(spawn.args)).toEqual([
      kernel["secret-vault"],
      "/runtime/skill-loader/agent/index.ts",
      kernel["update-center"],
      kernel["runtime-info"],
    ]);
    expect(spawn.env.PIPIUI_SKILL_ROOTS).toBe("/runtime/skills");
    expect(spawn.env.PIPIUI_MOUNTED_EXTENSIONS).toBe("skill-loader-extension");
  });

  it("mounts only the active extensions of a non-Coding Profile", () => {
    const resolved = resolveProductSpawnPlan({
      profileId: "trpg",
      registeredExtensions: [
        { id: "file-tools", enabled: false, extensionPath: "/runtime/coding.js" },
        { id: "webview-browser-extension", enabled: true, extensionPath: "/runtime/webview.js" },
      ],
    });
    const spawn = assemblePiSpawn({ cwd: "/workspace", kernel, ...resolved });
    expect(mounts(spawn.args)).toEqual([
      kernel["secret-vault"],
      "/runtime/webview.js",
      kernel["update-center"],
      kernel["runtime-info"],
    ]);
    expect(spawn.env.PIPIUI_MOUNTED_EXTENSIONS).toBe("webview-browser-extension");
  });

  it("copies the plan rather than aliasing the loader's snapshot", () => {
    const registeredExtensions = [{ id: "a-extension", enabled: true, extensionPath: "/pkg/a.js" }];
    const resolved = resolveProductSpawnPlan({ profileId: "base", registeredExtensions });
    resolved.registeredExtensions[0]!.enabled = false;
    expect(registeredExtensions[0]!.enabled).toBe(true);
  });

  it("fingerprints only the enabled extension set, so an unrelated host upgrade keeps a Conversation valid", () => {
    const enabled = [
      { id: "b-extension", enabled: true, version: "1.0.0", extensionPath: "/pkg/b.js" },
      { id: "a-extension", enabled: true, version: "2.0.0", extensionPath: "/pkg/a.js" },
      { id: "c-extension", enabled: false, version: "3.0.0", extensionPath: "/pkg/c.js" },
    ];
    const first = productSpawnFingerprint("coding", resolveProductSpawnPlan({ profileId: "coding", registeredExtensions: enabled }));
    // Same enabled set, different mount paths and ordering: identical fingerprint.
    const reordered = [enabled[1]!, { ...enabled[0]!, extensionPath: "/other/b.js" }, enabled[2]!];
    const second = productSpawnFingerprint("coding", resolveProductSpawnPlan({ profileId: "coding", registeredExtensions: reordered }));
    expect(second).toBe(first);
    // Enabling one more package changes it.
    const third = productSpawnFingerprint("coding", resolveProductSpawnPlan({
      profileId: "coding",
      registeredExtensions: enabled.map(item => ({ ...item, enabled: true })),
    }));
    expect(third).not.toBe(first);
    // So does switching profile.
    expect(productSpawnFingerprint("base", resolveProductSpawnPlan({ profileId: "base", registeredExtensions: enabled }))).not.toBe(first);
  });
});
