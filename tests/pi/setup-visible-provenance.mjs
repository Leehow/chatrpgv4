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
        phase: "opening_selection",
        campaign_id: fixture.params.campaign,
        next_operation: {
          operation: "progressive.prepare_opening",
          invoke_via: "coc_invoke",
          prefilled_arguments: {},
          missing_arguments: [],
          hard_gate: true,
          authority: "canonical_setup",
        },
        instruction: "fixture exact route",
      },
    },
  },
  "real-visible-bind",
);
const prepareParams = {
  operation: "progressive.prepare_opening",
  campaign: fixture.params.campaign,
  arguments: {},
};
if (gate.openingSetupToolError(
  "coc_invoke",
  prepareParams,
  "real-visible-prepare",
) !== null) {
  throw new Error("fixture prepare route was not admitted");
}
const bootstrapCard = {
  operation: "progressive.opening_bootstrap",
  invoke_via: "coc_invoke",
  prefilled_arguments: {},
  missing_arguments: ["start_location", "opening_pdf_indices"],
  hard_gate: true,
  authority: "canonical_setup",
};
gate.observeOpeningSetupInvocation(
  "progressive.prepare_opening",
  prepareParams,
  {
    ok: true,
    tool: "progressive.prepare_opening",
    data: {
      status: "blocked",
      next_operation: bootstrapCard,
    },
  },
  "real-visible-prepare",
);
const bootstrapParams = {
  operation: "progressive.opening_bootstrap",
  campaign: fixture.params.campaign,
  arguments: {
    start_location: { location_id: "opening", title: "Opening" },
    opening_pdf_indices: [0],
  },
};
if (gate.openingSetupToolError(
  "coc_invoke",
  bootstrapParams,
  "real-visible-bootstrap",
) !== null) {
  throw new Error("fixture bootstrap route was not admitted");
}
const dispatchKey = "canonical-visible-background";
const task = {
  schema_version: 1,
  contract_id: "coc.pi-source-coordinator-task.v1",
  packet: { packet_id: dispatchKey },
};
gate.observeOpeningSetupInvocation(
  "progressive.opening_bootstrap",
  bootstrapParams,
  {
    ok: true,
    tool: "progressive.opening_bootstrap",
    data: {
      status: "queued",
      source_work: {
        background_takeover: {
          next_host_action: {
            action: "invoke_coc_dispatch_source_work",
            task,
          },
        },
      },
    },
  },
  "real-visible-bootstrap",
);
const projectionParams = {
  operation: "progressive.project_opening",
  campaign: fixture.params.campaign,
  arguments: {
    asset_root_id: "fixture",
    source_file_sha256: "a".repeat(64),
    start_location_id: "opening",
    opening_pdf_indices: [0],
  },
};
if (
  !gate.beginOpeningBackground(
    "real-visible-bootstrap",
    bootstrapParams,
    dispatchKey,
    projectionParams,
  )
  || gate.markOpeningBackgroundSubmitted(
    "real-visible-bootstrap",
    bootstrapParams,
    dispatchKey,
  ).status !== "submitted"
) {
  throw new Error("fixture background materialization did not start");
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
