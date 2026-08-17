import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMainWindowOptions } from "./main-window-options.mjs";

describe("buildMainWindowOptions", () => {
  it("darwin hides the title bar and places traffic lights in the 56px header", () => {
    const opts = buildMainWindowOptions({ platform: "darwin" });
    assert.equal(opts.titleBarStyle, "hiddenInset");
    assert.deepEqual(opts.trafficLightPosition, { x: 16, y: 20 });
    assert.equal(opts.title, "Pi Keeper");
    assert.equal(opts.backgroundColor, "#f5f1e8");
    assert.equal(opts.width, 1440);
    assert.equal(opts.height, 920);
    assert.equal(opts.minWidth, 1024);
    assert.equal(opts.minHeight, 700);
    assert.equal(opts.icon, undefined);
  });

  it("passes through a brand icon when provided", () => {
    const opts = buildMainWindowOptions({ platform: "darwin", icon: "/tmp/icon.png" });
    assert.equal(opts.icon, "/tmp/icon.png");
  });

  it("non-darwin keeps default chrome", () => {
    const opts = buildMainWindowOptions({ platform: "linux" });
    assert.equal(opts.titleBarStyle, undefined);
    assert.equal(opts.trafficLightPosition, undefined);
    assert.equal(opts.title, "Pi Keeper");
    assert.equal(opts.backgroundColor, "#f5f1e8");
  });
});
