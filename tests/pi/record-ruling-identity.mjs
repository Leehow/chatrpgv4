// `rules.record_ruling` identity declaration.
//
// The operation arrived declaring neither of its identity-bearing fields.
// `ruling_id` is REQUIRED and the operation is a mutation on `kp_surface:
// rules`, so the Keeper is offered it and an undeclared path fails the whole
// envelope closed as `semantic_identity_unavailable` -- the failure mode is a
// call that cannot succeed, not a rejected value.
//
// This pins the grammar rather than the fact that a declaration exists: a
// declaration with the wrong shape passes the boundary inventory and still
// rejects every real call.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const { validateRawModelIdentityPayload, closedIdentityGrammarCatalog } =
  await import(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts")
  );

const accepts = (field, value) => {
  try {
    const result = validateRawModelIdentityPayload({ [field]: value });
    return result === true
      || (result && result.ok !== false && !(Array.isArray(result) && result.length));
  } catch {
    return false;
  }
};

// The example the operation schema itself gives the Keeper must validate. A
// grammar that rejects its own documented example is worse than none.
assert.ok(
  accepts("ruling_id", "ruling:warehouse-pushed-locksmith-noise"),
  "the schema's own ruling_id example must pass its grammar",
);
assert.ok(!accepts("ruling_id", "warehouse-pushed-locksmith-noise"),
  "a ruling id without its namespace is not closed");
assert.ok(!accepts("ruling_id", "ruling:9f2d4c8ab17e4460"),
  "digest material inside the slug must still be refused");

// scope_id is the scene a scene-scoped ruling applies to, copied from a scene
// the host already showed -- the same namespace as scene_id.
assert.ok(accepts("scope_id", "scene:corbitt-house-cellar"));
assert.ok(accepts("scope_id", "corbitt-house-cellar"),
  "an echoed multi-token slug is accepted the way scene_id is");
assert.ok(!accepts("scope_id", "abcd"), "a bare single token is not closed");

const catalog = new Map(
  closedIdentityGrammarCatalog().map((row) => [row.field, row]),
);
assert.equal(catalog.get("ruling_id")?.kind, "composed",
  "the Keeper NAMES a ruling rather than echoing one it was shown");
assert.equal(catalog.get("scope_id")?.kind, "echoed",
  "a scope is a scene the host already showed");

console.log("record-ruling-identity: all assertions passed");

// The refusal message has to name the rule that actually refused. A caller
// holding `register-trial-A-20260902` satisfies "multi-token" and "no colon"
// and is still refused, so a message naming only those two leaves nothing to
// correct. That cost a failed playtest and a wrong diagnosis before the real
// constraint -- lowercase-only -- was found.
{
  const catalog = new Map(
    closedIdentityGrammarCatalog().map((row) => [row.field, row]),
  );
  const campaign = catalog.get("campaign_id");
  if (campaign) {
    assert.ok(
      /lowercase/i.test(campaign.acceptedForm),
      `campaign_id accepted form must name the case rule: ${campaign.acceptedForm}`,
    );
  }
  assert.ok(!accepts("campaign_id", "Register-Trial-Alpha"),
    "capitals are refused");
  assert.ok(accepts("campaign_id", "register-trial-alpha"),
    "the lowercase form is accepted");
}

console.log("record-ruling-identity: grammar message assertions passed");
