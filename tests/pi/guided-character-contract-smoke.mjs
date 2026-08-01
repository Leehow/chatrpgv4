import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const piRoot = path.join(repoRoot, "plugins", "coc-keeper", "pi");
const nodeModules = path.join(piRoot, "node_modules");
let linkedNodeModules = false;
try {
  try {
    await lstat(nodeModules);
  } catch {
    const scope = path.join(nodeModules, "@earendil-works");
    await mkdir(scope, { recursive: true });
    const writeStub = async (name, source) => {
      const packageRoot = path.join(scope, name);
      await mkdir(packageRoot, { recursive: true });
      await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
        name: `@earendil-works/${name}`,
        type: "module",
        exports: "./index.js",
      }));
      await writeFile(path.join(packageRoot, "index.js"), source);
    };
    await writeStub("pi-coding-agent", `export const keyHint = (_key, fallback) => fallback;
`);
    await writeStub("pi-tui", `export class Text { constructor() {} setText() {} }
export const truncateToWidth = (value) => String(value);
`);
    linkedNodeModules = true;
  }
  const {
    OpeningTerminalContinuationGate,
    projectPiGuidedCharacterContract,
  } = await import(
    `${pathToFileURL(path.join(piRoot, "extensions", "index.ts")).href}?guided-contract-smoke=1`,
  );
  const contract = (status, supported, fallback = undefined) => ({
    ok: true,
    tool: "setup.investigator_contract",
    data: {
      result: {
        guided_quick_fire_campaign_era: {
          status,
          supported,
          required_sheet_era: supported ? "1920s" : "medieval",
          supported_eras: ["1920s"],
          ...(fallback === undefined ? {} : { fallback }),
        },
        payload_schema: {
          $defs: {
            quick_fire_creation: {
              properties: { input_mode: { const: "guided_quick_fire" } },
            },
            kp_guided_era_adaptive_creation: {
              properties: {
                input_mode: { const: "kp_guided_era_adaptive" },
              },
            },
            complete_sheet: { type: "object" },
            complete_sheet_creation: { type: "object" },
          },
          oneOf: [
            { properties: { creation: { $ref: "#/$defs/quick_fire_creation" } } },
            {
              properties: {
                creation: { $ref: "#/$defs/kp_guided_era_adaptive_creation" },
              },
            },
            { properties: { creation: { $ref: "#/$defs/complete_sheet_creation" } } },
          ],
        },
      },
    },
  });
  const adaptive = projectPiGuidedCharacterContract(contract(
    "kp_guided_era_adaptive_available",
    false,
    {
      status: "available",
      available: true,
      route: "kp_guided_era_adaptive",
      input_mode: "kp_guided_era_adaptive",
    },
  ), "medieval-opening");
  const adaptiveResult = adaptive?.data?.result;
  if (adaptiveResult?.applicable_input_mode !== "kp_guided_era_adaptive") {
    throw new Error(`adaptive mode was not forwarded: ${JSON.stringify(adaptive)}`);
  }
  if (adaptiveResult.character_creation_route?.route !== "kp_guided_era_adaptive") {
    throw new Error(`adaptive route was not forwarded: ${JSON.stringify(adaptive)}`);
  }
  const adaptiveSchema = adaptiveResult.payload_schema;
  if (
    adaptiveSchema.oneOf?.length !== 1
    || adaptiveSchema.oneOf[0]?.properties?.creation?.$ref
      !== "#/$defs/kp_guided_era_adaptive_creation"
    || "complete_sheet" in adaptiveSchema.$defs
    || "complete_sheet_creation" in adaptiveSchema.$defs
  ) throw new Error(`adaptive projection was not fail-closed: ${JSON.stringify(adaptive)}`);

  const standard = projectPiGuidedCharacterContract(
    contract("standard_quick_fire_available", true),
    "1920s-opening",
  );
  const standardResult = standard?.data?.result;
  if (
    standardResult?.applicable_input_mode !== "guided_quick_fire"
    || standardResult.payload_schema?.oneOf?.[0]?.properties?.creation?.$ref
      !== "#/$defs/quick_fire_creation"
  ) throw new Error(`standard Quick Fire projection changed: ${JSON.stringify(standard)}`);

  const unavailable = projectPiGuidedCharacterContract(
    contract("kp_guided_era_adaptive_available", false, {
      status: "unavailable",
      available: false,
    }),
    "medieval-opening",
  );
  if (unavailable?.error?.code !== "guided_character_creation_route_unavailable") {
    throw new Error(`unavailable fallback did not fail closed: ${JSON.stringify(unavailable)}`);
  }

  const hydrateCharacterSetup = (campaignId, details) => {
    const gate = new OpeningTerminalContinuationGate();
    const resumeParams = {
      operation: "session.resume",
      campaign: campaignId,
      arguments: {},
    };
    const invocationId = `guided-contract-smoke-resume:${campaignId}`;
    const admission = gate.openingSetupToolError(
      "coc_invoke",
      resumeParams,
      invocationId,
    );
    if (admission !== null) {
      throw new Error(
        `character-setup resume was not admitted for ${campaignId}: ${admission}`,
      );
    }
    const hydrated = gate.observeOpeningSetupInvocation(
      "session.resume",
      resumeParams,
      {
        ok: false,
        tool: "session.resume",
        error: {
          code: "opening_setup_incomplete",
          details,
        },
      },
      invocationId,
    );
    if (hydrated?.accepted !== true) {
      throw new Error(
        `character-setup gate did not hydrate for ${campaignId}: ${
          JSON.stringify(hydrated)
        }`,
      );
    }
    return gate;
  };

  const cashSemanticParams = (campaignId, assets = ["cloak", "borrowed horse"]) => ({
    operation: "state.cash_semantic",
    campaign: campaignId,
    arguments: {
      record_id: `cash-${campaignId}-001`,
      basis: "kp_era_adaptation",
      reason: "era has no authoritative cash table",
      decision_id: `cash-sem-${campaignId}-001`,
      cash_description: "a few silver pennies",
      assets,
    },
  });

  const adaptiveCampaignId = "guided-smoke-adaptive-cash";
  const adaptiveGate = hydrateCharacterSetup(adaptiveCampaignId, {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_character_setup_required",
    campaign_id: adaptiveCampaignId,
    character_setup_policy: "kp_guided_era_adaptive",
    character_setup_input_mode: "kp_guided_era_adaptive",
    next_operation: null,
    instruction: (
      "complete the retained KP-guided era-adaptive investigator creation "
      + "and exact campaign link before opening play"
    ),
  });
  const adaptiveCashError = adaptiveGate.openingSetupToolError(
    "coc_invoke",
    cashSemanticParams(adaptiveCampaignId),
    "guided-smoke-adaptive-cash-ok",
  );
  if (adaptiveCashError !== null) {
    throw new Error(
      "adaptive opening hard gate blocked state.cash_semantic: "
      + adaptiveCashError,
    );
  }
  // Playtest shape: assets arrived as a free-text string. Extension must still
  // dispatch; toolbox owns array/enum validation.
  const adaptiveLooseCashError = adaptiveGate.openingSetupToolError(
    "coc_invoke",
    cashSemanticParams(adaptiveCampaignId, "cloak; borrowed horse"),
    "guided-smoke-adaptive-cash-loose",
  );
  if (adaptiveLooseCashError !== null) {
    throw new Error(
      "adaptive opening hard gate blocked loose state.cash_semantic: "
      + adaptiveLooseCashError,
    );
  }
  const adaptiveBlockedPlay = adaptiveGate.openingSetupToolError(
    "coc_invoke",
    {
      operation: "scene.context",
      campaign: adaptiveCampaignId,
      arguments: {},
    },
    "guided-smoke-adaptive-scene-blocked",
  );
  if (
    typeof adaptiveBlockedPlay !== "string"
    || !adaptiveBlockedPlay.includes(
      "is unavailable while the Pi opening setup hard gate is active"
    )
  ) {
    throw new Error(
      "adaptive hard gate failed to keep play tools blocked: "
      + String(adaptiveBlockedPlay),
    );
  }

  const quickFireCampaignId = "guided-smoke-quick-fire-cash";
  const quickFireGate = hydrateCharacterSetup(quickFireCampaignId, {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_character_setup_required",
    campaign_id: quickFireCampaignId,
    character_setup_policy: "guided_quick_fire",
    next_operation: null,
    instruction: (
      "complete the retained guided Quick Fire investigator creation and "
      + "exact campaign link before opening play"
    ),
  });
  const quickFireCashError = quickFireGate.openingSetupToolError(
    "coc_invoke",
    cashSemanticParams(quickFireCampaignId),
    "guided-smoke-quick-fire-cash-blocked",
  );
  if (
    typeof quickFireCashError !== "string"
    || !quickFireCashError.includes(
      "state.cash_semantic is unavailable while the Pi opening setup hard gate is active"
    )
  ) {
    throw new Error(
      "Quick Fire opening hard gate must keep state.cash_semantic blocked: "
      + String(quickFireCashError),
    );
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    adaptiveInputMode: adaptiveResult.applicable_input_mode,
    standardInputMode: standardResult.applicable_input_mode,
    unavailableCode: unavailable.error.code,
    adaptiveCashSemanticAdmitted: adaptiveCashError === null,
    adaptiveLooseCashSemanticAdmitted: adaptiveLooseCashError === null,
    quickFireCashSemanticBlocked: true,
  }));
} finally {
  if (linkedNodeModules) await rm(nodeModules, { recursive: true, force: true });
}
