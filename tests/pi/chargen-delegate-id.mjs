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
  planChargenSkillLists,
  resolveAssignmentPriority,
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

const focus = ["Library Use", "History", "Spot Hidden"];
const support = [
  "Photography", "Appraise", "Psychology", "Listen", "Dodge", "Fast Talk",
  "Accounting",
];
const planned = planChargenSkillLists(parseChargenClerkBrief({
  name: "顾南舟",
  occupation_or_concept: "旧书商",
  assignment_priority: "INT EDU POW DEX CON APP SIZ STR",
  occupation_skill_names: focus,
  interest_skill_names: support,
}));
assert.deepEqual(planned.occupation_skill_names.slice(0, 3), focus);
assert.ok(planned.occupation_skill_names.length > 3);
assert.deepEqual(resolveAssignmentPriority("INT/EDU/POW/DEX/CON/APP/SIZ/STR"), [
  "INT", "EDU", "POW", "DEX", "CON", "APP", "SIZ", "STR",
]);
assert.deepEqual(resolveAssignmentPriority(undefined)[0], "INT");
assert.ok(planned.interest_skill_names.includes("Art and Craft (Photography)"));
assert.ok(planned.occupation_skill_names.includes("Accounting"));
assert.equal(planned.occupation_skill_names.includes("Occult"), false);
assert.equal(planned.interest_skill_names.includes("Occult"), false);
for (const skill of focus) {
  assert.ok(planned.occupation_skill_names.includes(skill));
}

const nanZhouCalls = [];
const nanZhou = await runChargenInProcess({
  campaignId: "the-haunting-qs-msyp17l9",
  brief: parseChargenClerkBrief({
    name: "顾南舟",
    occupation_or_concept: "旧书商",
    assignment_priority: "INT,EDU,POW,DEX,CON,APP,SIZ,STR",
    occupation_skill_names: focus,
    interest_skill_names: support,
  }),
  callTool: async (op, args) => {
    nanZhouCalls.push({ op, args });
    return {
      ok: true,
      data: {
        result: {
          ok: true,
          investigator_id: args.investigator_id,
          occupation_skill_names: args.occupation_skill_names,
        },
      },
    };
  },
});
assert.equal(nanZhouCalls.length, 1);
assert.equal(nanZhouCalls[0].op, "setup.chargen_run");
assert.notEqual(nanZhouCalls[0].args.investigator_id, "inv-investigator");
assert.deepEqual(
  nanZhouCalls[0].args.occupation_skill_names.slice(0, 3),
  focus,
);
assert.ok(nanZhouCalls[0].args.occupation_skill_names.length > 3);
assert.deepEqual(nanZhouCalls[0].args.assignment_priority.slice(0, 2), ["INT", "EDU"]);
assert.ok(nanZhouCalls[0].args.interest_skill_names.includes("Art and Craft (Photography)"));
assert.equal(nanZhouCalls.some((row) => row.op === "setup.complete"), false);
assert.equal(nanZhou.investigator_id, nanZhouCalls[0].args.investigator_id);

process.stdout.write(JSON.stringify({
  ok: true,
  allocated: a,
  otherCampaign: b,
  focusPreserved: true,
  delegateOnly: true,
  occupationCount: nanZhouCalls[0].args.occupation_skill_names.length,
}));
