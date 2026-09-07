import { describe, expect, it } from "vitest";

import { parseProductPackManifest } from "../src/product-pack-manifest.js";

describe("Product Pack manifest seam", () => {
  it("accepts a pack whose own extension carries the form", () => {
    expect(parseProductPackManifest({
      schemaVersion: 2,
      id: "campaign-workbench",
      name: "Campaign Starter",
      extensions: [
        { id: "campaign-kit", path: "extensions/campaign-kit" },
        { id: "campaign-workbench", path: "extensions/campaign-workbench" },
      ],
    })).toEqual({
      ok: true,
      pack: {
        schemaVersion: 2,
        id: "campaign-workbench",
        name: "Campaign Starter",
        extensions: [
          { id: "campaign-kit", path: "extensions/campaign-kit" },
          { id: "campaign-workbench", path: "extensions/campaign-workbench" },
        ],
      },
    });
  });

  it("refuses a pack that does not ship the extension it names", () => {
    const parsed = parseProductPackManifest({
      schemaVersion: 2,
      id: "campaign-workbench",
      name: "Campaign Starter",
      extensions: [{ id: "campaign-kit", path: "extensions/campaign-kit" }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toContain("extensions must include the pack extension 'campaign-workbench'");
  });

  it("rejects parent-path and duplicate-extension package entries before any install work", () => {
    const parsed = parseProductPackManifest({
      schemaVersion: 2,
      id: "campaign-workbench",
      name: "Campaign Starter",
      extensions: [
        { id: "campaign-workbench", path: "../outside/campaign-workbench" },
        { id: "campaign-kit", path: "extensions/campaign-kit" },
        { id: "campaign-kit", path: "extensions/other" },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual(expect.arrayContaining([
      "extensions[0].path must be a package-relative path",
      "extensions contains duplicate extension 'campaign-kit'",
    ]));
  });
});
