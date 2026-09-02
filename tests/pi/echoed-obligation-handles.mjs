#!/usr/bin/env node
// An obligation id is minted by the host and copied back verbatim; its tail is
// a content digest precisely so it cannot be authored. The result-side scan
// judged it as an authored slug, which is the same as refusing it -- and
// refusing it collapsed turn.output_context on every turn with an NPC in the
// scene, which in turn left the stage with no operation that could advance.
// Seen live on 2026-09-02 in campaign amaranthine-loop.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const { isEchoedHandle } = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts")
  ).href
);
const { OBLIGATION_ID_PREFIXES } = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/obligation-grammar.ts")
  ).href
).catch(async () => await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/text-vocabulary.generated.ts")
  ).href
));

const namespaces = new Set(OBLIGATION_ID_PREFIXES);
assert.ok(namespaces.size > 0, "obligation namespaces must be declared");

// The exact shapes the host mints, copied from campaign amaranthine-loop.
for (const value of [
  "roll:npc-first-impression-roll-v2:1abb9188898dd78b8561360bcb11f1df72f8c327",
  "first-impression:npc-first-impression-v2:db665e734257c72258ba78444a55230d56550c6c",
]) {
  assert.equal(
    isEchoedHandle(value, namespaces), true,
    `${value} is a handle the host minted and the Keeper must copy back`,
  );
}

// The namespace is what is verified, and nothing else gets in on the strength
// of an opaque tail.
assert.equal(isEchoedHandle("route:something", namespaces), false);
assert.equal(isEchoedHandle("roll:", namespaces), false, "empty remainder");
assert.equal(isEchoedHandle("", namespaces), false);
assert.equal(isEchoedHandle(null, namespaces), false);
assert.equal(isEchoedHandle(42, namespaces), false);
assert.equal(
  isEchoedHandle("roll:a b", namespaces), false,
  "whitespace could carry a second value beside the handle",
);
assert.equal(
  isEchoedHandle("roll:<script>", namespaces), false,
  "markup never rides in on a handle",
);
assert.equal(
  isEchoedHandle(`roll:${"a".repeat(600)}`, namespaces), false,
  "an unbounded tail is not a handle",
);

// The INPUT side must accept the same handle it presented. The Keeper copied
// six of these byte for byte out of `required_obligation_ids` and every
// finalize came back `opaque_identity_grammar` -- the mirror of the result
// side, on the way in.
const projectionModule = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts")
  ).href
);
const { rejectOpaqueModelIdentity } = projectionModule;
assert.equal(
  rejectOpaqueModelIdentity({
    coverage: [{
      obligation_id:
        "roll:npc-first-impression-roll-v2:1abb9188898dd78b8561360bcb11f1df72f8c327",
    }],
  }),
  null,
  "the host's own presented handle must survive its own input grammar",
);
assert.notEqual(
  rejectOpaqueModelIdentity({
    coverage: [{ obligation_id: "1abb9188898dd78b8561360bcb11f1df72f8c327" }],
  }),
  null,
  "a bare digest with no namespace is still not a handle",
);
assert.notEqual(
  rejectOpaqueModelIdentity({
    coverage: [{ obligation_id: "route:npc-first-impression-v2:" + "a".repeat(40) }],
  }),
  null,
  "an undeclared namespace does not become a handle by having a digest",
);

// The loosening is exactly this wide: an echoed field whose value is meant to
// be readable keeps the strict rule, so a digest cannot ride in on it.
assert.notEqual(
  rejectOpaqueModelIdentity({
    scene: { scene_id: "scene:" + "a".repeat(40) },
  }),
  null,
  "scene_id is meaning-bearing on both sides and must not accept a digest",
);

console.log(JSON.stringify({ ok: true, module: "echoed-obligation-handles" }));
