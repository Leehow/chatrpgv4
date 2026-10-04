import assert from "node:assert/strict";
import test from "node:test";
import { installTypedEndpoint, typedAdmissionRequest } from "./typed-admission-endpoint.mjs";

const body = (...keys) => ({ questions: Object.fromEntries(keys.map((key) => [key, {}])) });

test("the typed admission mock recognizes both issued admission designs", () => {
  const families = ["role", "choice", "result", "span", "target", "gate", "order", "missing", "basis", "verdict"];
  for (const family of families) assert.equal(typedAdmissionRequest(body(`${family}_0`, `${family}_12`)), true, family);
  assert.equal(typedAdmissionRequest(body("role_0", "choice_0", "missing_1", "basis_1")), true);
});

test("the admission grammar rejects other endpoint families, empty and mixed requests", () => {
  for (const key of ["profile_0", "tier", "family", "time_cost", "severity", "cut", "role", "role_-1", "role_1.2", "role_1x", "unknown_0"]) {
    assert.equal(typedAdmissionRequest(body(key)), false, key);
    assert.equal(typedAdmissionRequest(body("verdict_0", key)), false, `mixed ${key}`);
  }
  for (const value of [null, {}, body()]) assert.equal(typedAdmissionRequest(value), false);
});

test("unrelated Jev requests are declined before admission answers or counters", async (t) => {
  const requests = installTypedEndpoint(t, [{ verdict: "authorized", confidence: 1 }]);
  for (const request of [body("profile_0"), body("tier", "family"), body("time_cost", "severity"), body("cut"), body("role_0", "profile_0"), body()]) {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", body: JSON.stringify(request) });
    assert.equal(response.status, 503);
    assert.equal(requests.length, 0);
  }
});
