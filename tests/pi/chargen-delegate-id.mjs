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
  occupation_name: "私家侦探",
  age: 32,
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
assert.equal(calls[0].args.age, 32);
assert.equal(calls[0].args.occupation_name, "私家侦探");
assert.notEqual(calls[0].args.investigator_id, "inv-investigator");
assert.equal(result.investigator_id, calls[0].args.investigator_id);
assert.throws(
  () => parseChargenClerkBrief({ name, occupation_or_concept: "私家侦探", age: 14 }),
  /age must be an integer from 15 to 89/,
);
assert.throws(
  () => parseChargenClerkBrief({
    name,
    occupation_or_concept: "私家侦探",
    occupation_allocations: { "Library Use": 160 },
  }),
  /numeric finance or stats/,
);
const roleplayCalls = [];
await runChargenInProcess({
  campaignId: "camp-alpha",
  brief: parseChargenClerkBrief({
    name,
    occupation_or_concept: "Journalist",
    occupation_label: "记者",
    backstory: { ideology_beliefs: "真相必须见报" },
    equipment: ["速记本"],
    key_connection: { backstory_field: "ideology_beliefs", summary: "真相必须见报" },
  }),
  callTool: async (_op, args) => {
    roleplayCalls.push(args);
    return { ok: true, data: { result: { ok: true } } };
  },
});
assert.equal(roleplayCalls[0].occupation_label, "记者");
assert.equal(roleplayCalls[0].backstory.ideology_beliefs, "真相必须见报");
assert.deepEqual(roleplayCalls[0].equipment, ["速记本"]);
assert.equal(roleplayCalls[0].key_connection.backstory_field, "ideology_beliefs");

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
assert.ok(planned.interest_skill_names.includes("Accounting"));
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

const journalistFocus = ["Persuade", "Psychology", "Library Use"];
const journalistInterests = ["Photography", "Spot Hidden", "Stealth"];
const journalist = planChargenSkillLists(parseChargenClerkBrief({
  name: "沈砚",
  occupation_or_concept: "记者",
  assignment_priority: "DEX APP INT POW EDU CON SIZ STR",
  occupation_skill_names: journalistFocus,
  interest_skill_names: journalistInterests,
}));
assert.deepEqual(journalist.occupation_skill_names.slice(0, 3), journalistFocus);
assert.equal(journalist.interest_skill_names[0], "Art and Craft (Photography)");
assert.ok(journalist.interest_skill_names.includes("Spot Hidden"));
assert.ok(journalist.interest_skill_names.includes("Stealth"));
assert.ok(journalist.interest_skill_names.length >= 6);
assert.equal(journalist.interest_budget, 160);

const singleInterest = planChargenSkillLists(parseChargenClerkBrief({
  name: "沈砚",
  occupation_or_concept: "记者",
  assignment_priority: "INT EDU POW DEX APP SIZ CON STR",
  occupation_skill_names: journalistFocus,
  interest_skill_names: ["Spot Hidden"],
}));
assert.equal(singleInterest.interest_skill_names[0], "Spot Hidden");
assert.ok(singleInterest.interest_skill_names.length >= 5);
assert.equal(singleInterest.interest_budget, 160);

const revised = planChargenSkillLists(parseChargenClerkBrief({
  name: "沈砚",
  occupation_or_concept: "记者",
  assignment_priority: "APP DEX INT EDU POW CON SIZ STR",
  occupation_skill_names: journalistFocus,
  interest_skill_names: ["Stealth", "Listen"],
}));
assert.deepEqual(revised.interest_skill_names.slice(0, 2), ["Stealth", "Listen"]);
assert.ok(revised.interest_skill_names.length >= 5);

const romanAdaptive = planChargenSkillLists(parseChargenClerkBrief({
  name: "马库斯·瓦莱里乌斯",
  occupation_or_concept: "罗马军团文书兼谈判官",
  mode: "era_adaptive",
  assignment_priority: "INT EDU POW APP DEX CON SIZ STR",
  occupation_skill_names: [
    "Persuade", "Law", "History", "Appraise",
    "Language (Own)", "Listen", "Spot Hidden", "Ride",
  ],
  interest_skill_names: ["Natural World", "Navigate", "First Aid", "Occult"],
}));
assert.equal(romanAdaptive.occupation_skill_names.includes("Mechanical Repair"), false);
assert.equal(romanAdaptive.interest_skill_names.includes("Mechanical Repair"), false);
assert.equal(romanAdaptive.interest_skill_names.includes("Accounting"), false);

const fluentReporter = planChargenSkillLists(parseChargenClerkBrief({
  name: "林晚舟",
  occupation_name: "Photojournalist",
  assignment_priority: "DEX INT APP EDU POW CON STR SIZ",
  occupation_skill_names: [
    "Art and Craft (Photography)", "Language (English)", "Language (Spanish)",
    "Spot Hidden", "Listen", "Psychology", "Persuade", "Fast Talk", "Library Use",
  ],
  interest_skill_names: [
    "Dodge", "First Aid", "Stealth", "Navigate", "History", "Charm", "Drive Auto",
  ],
  professional_language_names: ["Language (English)"],
}));

function projectRoundRobinFinal(skillIds, budget, bases, floor = {}) {
  const allocations = Object.fromEntries(skillIds.map((skillId) => [skillId, 0]));
  let remaining = budget;
  for (const [skillId, need] of Object.entries(floor)) {
    if (!(skillId in allocations)) continue;
    const take = Math.min(Math.max(0, need), 75 - (bases[skillId] ?? 0), remaining);
    allocations[skillId] += take;
    remaining -= take;
  }
  while (remaining > 0) {
    let progressed = false;
    for (const skillId of skillIds) {
      if (remaining <= 0) break;
      if ((bases[skillId] ?? 0) + allocations[skillId] >= 75) continue;
      allocations[skillId] += 1;
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  return Object.fromEntries(
    skillIds.map((skillId) => [skillId, (bases[skillId] ?? 0) + allocations[skillId]]),
  );
}

assert.equal(fluentReporter.occupation_skill_names[0], "Language (English)");
assert.equal(fluentReporter.interest_skill_names[0], "Dodge");
assert.equal(fluentReporter.interest_skill_names.includes("Language (English)"), false);
assert.equal(fluentReporter.interest_budget, 140);
assert.ok(fluentReporter.interest_skill_names.length >= 4);
const fluentOccupationSkills = [...fluentReporter.occupation_skill_names, "Credit Rating"];
const fluentOccupationValues = projectRoundRobinFinal(
  fluentOccupationSkills,
  fluentReporter.occupation_budget,
  {
    "Language (English)": 1,
    "Language (Spanish)": 1,
    "Art and Craft (Photography)": 5,
    "Spot Hidden": 25,
    "Listen": 20,
    "Psychology": 10,
    "Persuade": 10,
    "Fast Talk": 5,
    "Library Use": 20,
    "Credit Rating": 0,
  },
  { "Language (English)": 49 },
);
assert.ok(
  fluentOccupationValues["Language (English)"] >= 50,
  `professional English must reach 50, got ${fluentOccupationValues["Language (English)"]}`,
);
const fluentCalls = [];
await runChargenInProcess({
  campaignId: "masks-lima",
  brief: parseChargenClerkBrief({
    name: "周启明",
    occupation_or_concept: "Photojournalist / travel writer",
    assignment_priority: "DEX INT APP EDU POW CON STR SIZ",
    occupation_skill_names: [
      "Art and Craft (Photography)", "Language (English)", "Language (Spanish)",
      "Spot Hidden", "Listen", "Psychology", "Persuade", "Fast Talk", "Library Use",
    ],
    interest_skill_names: ["Dodge", "First Aid", "Stealth", "Navigate", "History"],
    professional_language_names: ["Language (English)"],
  }),
  callTool: async (_op, args) => {
    fluentCalls.push(args);
    return { ok: true, data: { result: { ok: true } } };
  },
});
assert.equal(fluentCalls.length, 1);
assert.equal(
  fluentCalls[0].occupation_skill_names[0],
  "Professional: Language (English)",
);

process.stdout.write(JSON.stringify({
  ok: true,
  allocated: a,
  otherCampaign: b,
  focusPreserved: true,
  delegateOnly: true,
  occupationCount: nanZhouCalls[0].args.occupation_skill_names.length,
  journalistInterestCount: journalist.interest_skill_names.length,
  singleInterestCount: singleInterest.interest_skill_names.length,
}));
