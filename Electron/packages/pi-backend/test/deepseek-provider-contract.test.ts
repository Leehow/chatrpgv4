import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contributedProviderModulePath,
  loadContributedAuthProvider,
} from "../src/extension-auth-providers.js";
import { parseExtensionAuthContribution } from "../src/extension-provider-contract.js";

/**
 * The DeepSeek Extended package is consumed by the app through the same generic
 * machinery as any other `auth.provider` extension: the manifest is validated
 * by the provider contract, and `agent/provider.js` is imported by the host to
 * register the provider into the app ModelRuntime (model picker + login).
 *
 * This pins the package the app actually ships in `extensions/deepseek`, not a
 * fixture: a manifest or entry-path change that would silently stop the provider
 * from appearing fails here.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PACKAGE_DIR = join(REPO, "extensions", "deepseek");
const MODEL_IDS = [
  "deepseek-v4-flash-vision-exp",
  "deepseek-v4-flash",
  "deepseek-v4.1-flash-expires-on-0910",
];

describe("DeepSeek Extended package through the app provider machinery", () => {
  it("passes the provider contract validator and declares itself enabled", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "pipiui-extension.json"), "utf8")) as {
      auth?: unknown;
      defaultEnabled?: unknown;
    };
    const validation = parseExtensionAuthContribution(manifest.auth);
    expect(validation?.ok).toBe(true);
    if (!validation || !validation.ok) throw new Error("auth.provider contribution must validate");
    expect(validation.contribution.provider.id).toBe("deepseek-extended");
    expect(validation.contribution.provider.name).toBe("DeepSeek Extended");
    expect(validation.contribution.provider.api).toBe("openai-responses");
    expect(validation.contribution.provider.models.map((model) => model.id)).toEqual(MODEL_IDS);
    // App-origin extensions default to disabled, and a disabled extension's
    // provider never reaches the picker.
    expect(manifest.defaultEnabled).toBe(true);
  });

  it("resolves agent/provider.js and loads createAuthProvider", async () => {
    expect(contributedProviderModulePath(PACKAGE_DIR)).toBe(join(PACKAGE_DIR, "agent", "provider.js"));
    const loaded = await loadContributedAuthProvider(PACKAGE_DIR);
    expect(loaded?.id).toBe("deepseek-extended");
    const config = loaded?.config as { api?: string; models?: Array<{ id: string }> } | undefined;
    expect(config?.api).toBe("openai-responses");
    expect(config?.models?.map((model) => model.id)).toEqual(MODEL_IDS);
  });
});
