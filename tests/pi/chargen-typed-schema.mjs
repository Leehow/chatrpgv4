import { pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const clerkUrl = pathToFileURL(
  path.join(repoRoot, "plugins/coc-keeper/pi/lib/chargen-clerk.ts"),
).href;

const {
  CHARGEN_BACKSTORY_KEYS,
  CHARGEN_KEY_CONNECTION_FIELDS,
} = await import(`${clerkUrl}?schema=${Date.now()}`);

const backstoryProperties = Object.fromEntries(
  CHARGEN_BACKSTORY_KEYS.map((key) => [key, { type: "string" }]),
);

process.stdout.write(JSON.stringify({
  additionalProperties: false,
  backstory: {
    additionalProperties: false,
    properties: backstoryProperties,
  },
  key_connection: {
    additionalProperties: false,
    required: ["backstory_field", "summary"],
    properties: {
      backstory_field: {
        type: "string",
        enum: [...CHARGEN_KEY_CONNECTION_FIELDS],
      },
      summary: { type: "string" },
    },
  },
  age: { minimum: 15, maximum: 89 },
  clerk_backstory_keys: [...CHARGEN_BACKSTORY_KEYS],
  clerk_key_fields: [...CHARGEN_KEY_CONNECTION_FIELDS],
  properties: [
    "name",
    "occupation_or_concept",
    "age",
    "assignment_priority",
    "occupation_skill_names",
    "interest_skill_names",
    "investigator_id",
    "occupation_label",
    "backstory",
    "equipment",
    "key_connection",
  ],
}));
