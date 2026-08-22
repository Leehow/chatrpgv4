import "./_lib/preload-embedded-pi.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const fixturePath = path.resolve(process.argv[3]);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const {
  OpeningTerminalContinuationGate,
  canonicalSetupVisibleOutput,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);

const output = await canonicalSetupVisibleOutput(
  fixture.workspace,
  fixture.params,
  fixture.envelope,
);
if (!output) throw new Error("real canonical briefing provenance was rejected");
const briefingPath = fixture.envelope.data.result.briefing_path;
const expected = await readFile(
  path.join(fixture.workspace, briefingPath),
  "utf8",
);
if (
  output.text !== expected
  || output.textSha256 !== fixture.expected_text_sha256
  || output.publicSetupSha256
    !== fixture.envelope.data.result.public_setup_sha256
) {
  throw new Error("canonical briefing bytes or hashes drifted");
}

const malformed = structuredClone(fixture.envelope);
malformed.data.result.public_setup_sha256 = "not-a-digest";
if (await canonicalSetupVisibleOutput(
  fixture.workspace,
  fixture.params,
  malformed,
) !== null) {
  throw new Error("malformed setup digest authorized visible output");
}

const gate = new OpeningTerminalContinuationGate();
gate.markAgentStart();
const bindParams = {
  operation: "setup.invoke",
  campaign: fixture.params.campaign,
  arguments: {
    kind: "scenario.bind_pdf",
    payload: {
      campaign_id: fixture.params.campaign,
      scenario_id: "fixture",
      title: "Fixture",
      source_bundle_path: "/fixture/source-bundle",
    },
  },
};
if (gate.openingSetupToolError(
  "coc_invoke",
  bindParams,
  "real-visible-bind",
) !== null) {
  throw new Error("fixture bind route was not admitted");
}
gate.observeOpeningSetupInvocation(
  "setup.invoke",
  bindParams,
  {
    ok: true,
    tool: "setup.invoke",
    data: {
      schema_version: 1,
      status: "PASS",
      kind: "scenario.bind_pdf",
      result: { campaign_id: fixture.params.campaign },
      opening_gate: {
        schema_version: 1,
        status: "blocked",
        hard_gate: true,
        activation_allowed: false,
        phase: "opening_source_review_required",
        campaign_id: fixture.params.campaign,
        next_operation: null,
        instruction: "fixture exact route",
      },
    },
  },
  "real-visible-bind",
);
const sourceRef = { source_id: "fixture-source", pdf_index: 0 };
const sourceFact = (value) => ({
  status: "source",
  value,
  source_refs: [sourceRef],
});
const reviewedRoute = gate.observeOpeningSourceReviewTransport({
  schema_version: 1,
  contract_id: "coc.pi-opening-source-review-transport-result.v1",
  status: "reviewed",
  campaign_id: fixture.params.campaign,
  scenario_id: "fixture",
  opening_review_generation: 1,
  failure_class: null,
  facts: {
    schema_version: 1,
    contract_id: "coc.opening-fast-facts.v1",
    era: sourceFact("1920s"),
    place: sourceFact("Fixture place"),
    investigator_hook: sourceFact("Fixture hook"),
    investigator_constraints: sourceFact("Fixture constraints"),
    player_safe_summary: sourceFact("Fixture player-safe summary"),
    content_flags: sourceFact(["mystery"]),
  },
});
if (reviewedRoute?.phase !== "opening_character_setup_required") {
  throw new Error("fixture source review did not reach the canonical character route");
}
if (gate.openingSetupToolError(
  "coc_invoke",
  fixture.params,
  "real-visible-briefing",
) !== null) {
  throw new Error("real canonical briefing was not admitted");
}
const observed = gate.observeOpeningSetupInvocation(
  "setup.invoke",
  fixture.params,
  fixture.envelope,
  "real-visible-briefing",
  output,
);
const conversationalSummary = (
  "这份玩家安全资料建议从旧档案与人际牵连切入。"
  + "你想让调查员从事什么职业？"
);
const decision = gate.acceptVisibleAssistantFinal(
  conversationalSummary,
);
if (
  observed.accepted !== true
  || decision !== true
  || conversationalSummary === expected
) {
  throw new Error("canonical briefing did not authorize conversational KP prose");
}

process.stdout.write(JSON.stringify({
  ok: true,
  sourceKind: output.sourceKind,
  publicSetupSha256: output.publicSetupSha256,
  textSha256: output.textSha256,
}));
