// A terminal startup-resume blocker must repeat what the canonical layer said.
//
// Found by playing: `session.resume` refused with
//   state_corrupt: linked investigator beru-shaman-wannabe creation state is invalid
// and the Keeper received `{"error":{"code":"state_corrupt"}}` plus the advice
// "Relaunch pi-coc with the corrected --campaign <campaign_id>". The campaign
// selection was correct; a linked investigator sheet was missing one canonical
// skill. Three turns settled empty with nothing anyone could act on.
//
// This asserts the two halves of the fix on the extension source: the gate
// carries the canonical detail, and the blocker stops recommending a different
// campaign for a failure that is not about campaign selection.
import assert from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../../plugins/coc-keeper/pi/extensions/index.ts", import.meta.url),
  "utf8",
);

const gateType = source.slice(
  source.indexOf("type StartupResumeGate = {"),
  source.indexOf("};", source.indexOf("type StartupResumeGate = {")),
);
assert.match(gateType, /failureDetail: string \| null;/,
  "the startup gate discards the canonical message again");

// The classifier must lift the message off the canonical error, not only the code.
const classifier = source.slice(
  source.indexOf("failureClass: canonicalFailureClass(error?.code)") - 400,
  source.indexOf("failureClass: canonicalFailureClass(error?.code)") + 400,
);
assert.match(classifier, /failureDetail: typeof error\?\.message === "string"/,
  "the canonical message is dropped at classification");

// The blocker text must quote it, and must not send the operator after the
// command line when the cause is known.
const blockerStart = source.indexOf("const detail = gate.failureDetail;");
assert.ok(blockerStart > 0, "the blocker no longer consults the detail");
const blocker = source.slice(blockerStart, blockerStart + 900);
assert.match(blocker, /The canonical layer reports: \$\{detail\}/,
  "the blocker does not repeat what the canonical layer said");
assert.match(blocker, /campaign selection is\s*"?\s*\+?\s*"?\s*not in question/,
  "the blocker still implies the campaign selection is at fault");
assert.ok(
  !blocker.slice(0, blocker.indexOf("return (", blocker.indexOf("return ("))).includes(
    "corrected --campaign",
  ),
  "the known-cause branch still recommends relaunching with another campaign",
);

console.log(JSON.stringify({ ok: true, module: "startup-blocker-names-the-cause" }));
