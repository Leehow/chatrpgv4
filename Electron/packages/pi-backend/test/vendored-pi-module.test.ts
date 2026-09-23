import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPiCodingAgent, piModuleSpecifier } from "../src/index.js";

/**
 * ADR-0006: a COC host hands pi-backend the vendored Pi's package entry (`piModule`), and the backend's
 * in-process `SessionManager` / `ModelRuntime` come from that copy -- the one the Keeper child runs --
 * never from the backend's own stock dependency.
 */
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const vendored = join(repo, "build/node_modules/@earendil-works/pi-coding-agent/dist/index.js");

describe("pi-backend loads the Pi it is given", () => {
  it("imports the configured module by file URL, and the stock package only without one", () => {
    expect(piModuleSpecifier(vendored)).toBe(pathToFileURL(vendored).href);
    expect(piModuleSpecifier(undefined)).toBe("@earendil-works/pi-coding-agent");
  });

  it.skipIf(!existsSync(vendored))("the vendored module is the one loaded, once, with the session classes the backend uses", async () => {
    const first = await loadPiCodingAgent(vendored);
    const again = await loadPiCodingAgent(vendored);
    const direct = await import(pathToFileURL(vendored).href);
    expect(again).toBe(first);
    expect(first.SessionManager).toBe(direct.SessionManager);
    expect(typeof first.ModelRuntime?.create).toBe("function");
    const stock = await loadPiCodingAgent(undefined);
    expect(stock.SessionManager).not.toBe(first.SessionManager);
  });
});
