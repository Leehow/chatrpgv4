import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_DISPLAY_NAME, resolveAppIconPath } from "./app-icon.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("resolveAppIconPath", () => {
  it("uses the brand png in a source checkout", () => {
    const icon = resolveAppIconPath({ packaged: false, appDir: desktopRoot });
    assert.equal(icon, path.join(desktopRoot, "buildResources", "icon.png"));
    assert.equal(fs.existsSync(icon), true);
  });

  it("does not override the packaged .app bundle icon", () => {
    assert.equal(
      resolveAppIconPath({ packaged: true, appDir: desktopRoot }),
      null,
    );
  });

  it("returns null when the brand png is missing", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "coc-icon-"));
    assert.equal(resolveAppIconPath({ packaged: false, appDir: empty }), null);
  });
});

describe("APP_DISPLAY_NAME", () => {
  it("is the player-facing product name, not Electron", () => {
    assert.equal(APP_DISPLAY_NAME, "Pi Keeper");
  });
});
