import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authEventBrowserUrl, isHttpsUrl } from "./auth-event-url.mjs";

describe("authEventBrowserUrl", () => {
  it("returns url for auth_url", () => {
    assert.equal(
      authEventBrowserUrl({ type: "auth_url", url: "https://example.com/oauth" }),
      "https://example.com/oauth",
    );
  });

  it("returns verificationUri for device_code (same as TUI /login)", () => {
    assert.equal(
      authEventBrowserUrl({
        type: "device_code",
        userCode: "ABCD",
        verificationUri: "https://auth.x.ai/oauth2/device",
      }),
      "https://auth.x.ai/oauth2/device",
    );
  });

  it("returns null for other events", () => {
    assert.equal(authEventBrowserUrl({ type: "progress", message: "…" }), null);
    assert.equal(authEventBrowserUrl(null), null);
  });
});

describe("isHttpsUrl", () => {
  it("accepts https only", () => {
    assert.equal(isHttpsUrl("https://auth.x.ai/oauth2/device"), true);
    assert.equal(isHttpsUrl("http://evil.example"), false);
    assert.equal(isHttpsUrl("not-a-url"), false);
  });
});
