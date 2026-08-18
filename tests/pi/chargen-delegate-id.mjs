import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const clerkUrl = pathToFileURL(
  path.join(repoRoot, "plugins/coc-keeper/pi/lib/chargen-clerk.ts"),
).href;

const {
  allocateInvestigatorId,
  isGenericInvestigatorPlaceholder,
  parseChargenClerkBrief,
  runChargenInProcess,
} = await import(`${clerkUrl}?chargen-id=${Date.now()}`);

assert.equal(isGenericInvestigatorPlaceholder(undefined), true);
assert.equal(isGenericInvestigatorPlaceholder(""), true);
assert.equal(isGenericInvestigatorPlaceholder("inv-investigator"), true);
assert.equal(isGenericInvestigatorPlaceholder("investigator"), true);
assert.equal(isGenericInvestigatorPlaceholder("inv-shen-yan-unique"), false);

const name = "沈砚";
const a = allocateInvestigatorId("the-haunting-qs-msyot41h", name);
const b = allocateInvestigatorId("the-haunting-other-campaign", name);
assert.notEqual(a, "inv-investigator");
assert.notEqual(b, "inv-investigator");
assert.notEqual(a, b);
assert.match(a, /^inv-[A-Za-z0-9._:-]{1,124}$/);

const generic = allocateInvestigatorId(
  "camp-a",
  name,
  "inv-investigator",
);
assert.notEqual(generic, "inv-investigator");
assert.equal(
  allocateInvestigatorId("camp-a", name, "inv-shen-yan-unique"),
  "inv-shen-yan-unique",
);

const calls = [];
const brief = parseChargenClerkBrief({
  name,
  occupation_or_concept: "私家侦探",
  investigator_id: "inv-investigator",
});
const result = await runChargenInProcess({
  campaignId: "camp-alpha",
  brief,
  callTool: async (op, args) => {
    calls.push({ op, args });
    return {
      ok: true,
      data: {
        result: {
          ok: true,
          investigator_id: args.investigator_id,
          writes: ["investigator.create", "party.link"],
        },
      },
    };
  },
});
assert.equal(calls.length, 1);
assert.equal(calls[0].op, "setup.chargen_run");
assert.notEqual(calls[0].args.investigator_id, "inv-investigator");
assert.equal(result.investigator_id, calls[0].args.investigator_id);

const explicitCalls = [];
await runChargenInProcess({
  campaignId: "camp-alpha",
  brief: parseChargenClerkBrief({
    name,
    occupation_or_concept: "私家侦探",
    investigator_id: "inv-explicit-keep",
  }),
  callTool: async (_op, args) => {
    explicitCalls.push(args.investigator_id);
    return { ok: true, data: { result: { ok: true } } };
  },
});
assert.deepEqual(explicitCalls, ["inv-explicit-keep"]);

process.stdout.write(JSON.stringify({
  ok: true,
  allocated: a,
  otherCampaign: b,
}));
