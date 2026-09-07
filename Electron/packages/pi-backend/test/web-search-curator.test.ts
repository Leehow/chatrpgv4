import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostBridge } from "../src/bridge.js";
import {
  curatorUrlFromGlimpseHtml,
  curatorUrlFromOpenCommand,
  isWebSearchCuratorUrl,
  openCuratorInBuiltinBrowser,
  wrapExecForCurator,
} from "../../../packs/webview-browser-extension/agent/web-search-curator.mjs";

const extensionsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../packs");

describe("isWebSearchCuratorUrl", () => {
  it("accepts the local curator URL pi-web-access actually opens", () => {
    expect(isWebSearchCuratorUrl("http://localhost:43123/?session=abc123")).toBe(true);
    expect(isWebSearchCuratorUrl("http://127.0.0.1:9/?session=tok")).toBe(true);
  });

  it("rejects ordinary open targets so auth and Finder hand-offs stay on the system", () => {
    expect(isWebSearchCuratorUrl("https://github.com/login")).toBe(false);
    expect(isWebSearchCuratorUrl("http://localhost:43123/")).toBe(false);
    expect(isWebSearchCuratorUrl(".")).toBe(false);
    expect(isWebSearchCuratorUrl("/tmp/notes.md")).toBe(false);
  });
});

describe("curatorUrlFromOpenCommand", () => {
  it("reads the URL from macOS open, Linux xdg-open, and Windows start", () => {
    expect(curatorUrlFromOpenCommand("open", ["http://localhost:8/?session=a"])).toBe("http://localhost:8/?session=a");
    expect(curatorUrlFromOpenCommand("xdg-open", ["http://127.0.0.1:8/?session=a"])).toBe("http://127.0.0.1:8/?session=a");
    expect(curatorUrlFromOpenCommand("cmd", ["/c", "start", "", "http://localhost:8/?session=a"])).toBe("http://localhost:8/?session=a");
  });

  it("leaves every other exec invocation untouched", () => {
    expect(curatorUrlFromOpenCommand("git", ["status"])).toBeUndefined();
    expect(curatorUrlFromOpenCommand("open", ["https://github.com/login"])).toBeUndefined();
    expect(curatorUrlFromOpenCommand("open", ["."])).toBeUndefined();
  });
});

describe("openCuratorInBuiltinBrowser", () => {
  it("posts navigate to the real host bridge the Pi child uses", async () => {
    const navigated: string[] = [];
    const bridge = new HostBridge({
      onAgentEvent() {},
      async onBrowserAction(event) {
        if (event.action === "navigate") {
          navigated.push(String(event.url));
          return { ok: true, url: event.url };
        }
        return { ok: false, error: `unexpected ${String(event.action)}` };
      },
    });
    try {
      const port = await bridge.listen();
      const capability = bridge.register("session-1");
      await openCuratorInBuiltinBrowser("http://localhost:43123/?session=abc123", {
        PIPIUI_BRIDGE_PORT: String(port),
        PIPIUI_SESSION_CAPABILITY: capability,
      });
      expect(navigated).toEqual(["http://localhost:43123/?session=abc123"]);
    } finally {
      await bridge.close();
    }
  });
});

describe("wrapExecForCurator", () => {
  it("routes curator opens to the built-in browser and leaves other execs alone", async () => {
    const exec = vi.fn(async () => ({ code: 1, stdout: "", stderr: "no" }));
    const open = vi.fn(async () => undefined);
    const wrapped = wrapExecForCurator(exec, open);
    await expect(wrapped("open", ["http://localhost:8/?session=a"])).resolves.toEqual({ code: 0, stdout: "", stderr: "" });
    expect(open).toHaveBeenCalledWith("http://localhost:8/?session=a");
    expect(exec).not.toHaveBeenCalled();
    await expect(wrapped("git", ["status"])).resolves.toEqual({ code: 1, stdout: "", stderr: "no" });
    expect(exec).toHaveBeenCalledWith("git", ["status"], undefined);
  });
});

describe("curatorUrlFromGlimpseHtml", () => {
  it("reads the JSON-stringified replace target Glimpse uses", () => {
    const url = "http://localhost:43123/?session=abc123";
    const html = `<script>window.location.replace(${JSON.stringify(url)});</script>`;
    expect(curatorUrlFromGlimpseHtml(html)).toBe(url);
  });

  it("ignores unrelated HTML", () => {
    expect(curatorUrlFromGlimpseHtml("<p>hello</p>")).toBeUndefined();
  });
});
