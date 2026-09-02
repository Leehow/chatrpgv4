#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VALID_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

// Mirrors pi's EXTENDED_THINKING_LEVELS order used by clampThinkingLevel.
const THINKING_LADDER = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Models that think regardless of what is requested.
 *
 * The checks below judge DECLARED capability: whether the catalog says a level
 * is supported, and whether Pi would silently clamp. They cannot see a model
 * that accepts the disable request and ignores it — and that gap is not
 * theoretical. `zai-coding-cn/glm-5.3-flash` declares no `reasoning` flag, so
 * "off" reads as its only supported level and passes every check here;
 * measured live on 2026-09-02 with thinking "off" in force, it still emitted
 * 43,952 and 50,566 characters of reasoning across two turns.
 *
 * That is expensive in a way that hides: reasoning text and tool arguments
 * share one response output budget, so ~16.8k reasoning tokens against a
 * 16,384 cap truncated `state.journal` mid-argument three times in a row
 * ("the response hit the output token limit"), and the turn never settled.
 * Believing thinking is off is worse than knowing it is on.
 *
 * Keyed by exact `provider/model` and by bare model id, so the same model
 * reached through a second provider is still caught. Vendor statement:
 * GLM-5.3 and GLM-5.3-FLASH are forced-thinking; GLM-5.2 and earlier can be
 * disabled.
 */
const FORCED_THINKING_MODELS = new Map([
  ["glm-5.3-flash", "GLM-5.3-FLASH reasons on every request (vendor-documented; measured 2026-09-02)"],
  ["glm-5.3", "GLM-5.3 reasons on every request (vendor-documented)"],
  ["glm-5.3-highspeed", "GLM-5.3 variants reason on every request (vendor-documented)"],
]);

function forcedThinkingNote(provider, modelId) {
  return (
    FORCED_THINKING_MODELS.get(`${provider}/${modelId}`)
    ?? FORCED_THINKING_MODELS.get(modelId)
  );
}

function fail(message) {
  process.stderr.write(`pi-coc: ${message}\n`);
  process.exit(2);
}

function readJson(path, label, required = true) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    if (!required && error?.code === "ENOENT") {
      return undefined;
    }
    fail(`cannot read ${label} at ${path}: ${error.message}`);
  }
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--help", "-h", "--version", "-v", "--list-models"].includes(arg)) {
      parsed.informational = true;
    } else if (arg === "--provider" && index + 1 < args.length) {
      parsed.provider = args[++index];
    } else if (arg === "--model" && index + 1 < args.length) {
      parsed.model = args[++index];
    } else if (arg === "--thinking" && index + 1 < args.length) {
      parsed.thinking = args[++index];
    }
  }
  return parsed;
}

function splitModelPattern(pattern) {
  if (!pattern) {
    return {};
  }
  let model = pattern;
  let thinking;
  const colon = model.lastIndexOf(":");
  if (colon >= 0 && VALID_THINKING_LEVELS.has(model.slice(colon + 1))) {
    thinking = model.slice(colon + 1);
    model = model.slice(0, colon);
  }
  const slash = model.indexOf("/");
  if (slash >= 0) {
    return {
      provider: model.slice(0, slash),
      model: model.slice(slash + 1),
      thinking,
    };
  }
  return { model, thinking };
}

function findModel(catalog, provider, modelId) {
  const models = catalog?.[provider]?.models;
  return Array.isArray(models)
    ? models.find((model) => model?.id === modelId)
    : undefined;
}

function findConfiguredModel(config, provider, modelId) {
  const models = config?.providers?.[provider]?.models;
  return Array.isArray(models)
    ? models.find((model) => model?.id === modelId)
    : undefined;
}

function findBundledModel(catalog, modelId) {
  if (!catalog || typeof catalog !== "object") return undefined;
  for (const modelsByApi of Object.values(catalog)) {
    const model = modelsByApi?.[modelId];
    if (model?.id === modelId) return model;
  }
  return undefined;
}

// Mirrors pi's getSupportedThinkingLevels: a mapped `null` means the level is
// unsupported; a missing ("off"/"minimal"/...) entry means supported; xhigh/max
// must be explicitly mapped.
function supportedThinkingLevels(model) {
  if (!model.reasoning) return ["off"];
  return THINKING_LADDER.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

// Mirrors pi's clampThinkingLevel: walk up the ladder first, then down.
function clampThinkingTarget(model, level) {
  const available = supportedThinkingLevels(model);
  if (available.includes(level)) return level;
  const requestedIndex = THINKING_LADDER.indexOf(level);
  if (requestedIndex === -1) return available[0] ?? "off";
  for (let i = requestedIndex; i < THINKING_LADDER.length; i += 1) {
    if (available.includes(THINKING_LADDER[i])) return THINKING_LADDER[i];
  }
  for (let i = requestedIndex - 1; i >= 0; i -= 1) {
    if (available.includes(THINKING_LADDER[i])) return THINKING_LADDER[i];
  }
  return available[0] ?? "off";
}

const [agentDir, ...userArgs] = process.argv.slice(2);
if (!agentDir) {
  fail("internal thinking preflight requires the Pi agent directory");
}

const parsed = parseArguments(userArgs);
if (parsed.informational) {
  process.exit(0);
}

const settingsPath = join(agentDir, "settings.json");
const settings = readJson(settingsPath, "COC settings");
const modelPattern = splitModelPattern(parsed.model);
const requestedThinking =
  parsed.thinking ?? modelPattern.thinking ?? settings.defaultThinkingLevel;

if (requestedThinking === "none") {
  fail(
    `${settingsPath} uses invalid defaultThinkingLevel "none"; use "off" for a real no-thinking request, ` +
      `or deliberately use "low" with hideThinkingBlock=true (UI hiding is not true thinking-off)`,
  );
}
if (!requestedThinking || !VALID_THINKING_LEVELS.has(requestedThinking)) {
  // An unset or non-standard level cannot be checked here; pi owns it.
  process.exit(0);
}

const provider =
  parsed.provider ?? modelPattern.provider ?? settings.defaultProvider;
const modelId = modelPattern.model ?? settings.defaultModel;

function failIfOff(message) {
  if (requestedThinking === "off") fail(message);
  // For other levels an unresolved model cannot be verified; keep launching.
  process.exit(0);
}

if (!provider || !modelId) {
  failIfOff(
    'thinking "off" was requested, but the exact provider/model could not be resolved; ' +
      "pass --provider <provider> --model <model>",
  );
}
if (/[*?[\]]/.test(modelId)) {
  failIfOff(
    `thinking "off" was requested for non-exact model pattern ${provider}/${modelId}; ` +
      "pass an exact model so support can be verified before launch",
  );
}

const customModels = readJson(
  join(agentDir, "models.json"),
  "custom model configuration",
  false,
);
const modelStore = readJson(
  join(agentDir, "models-store.json"),
  "Pi model catalog",
  false,
);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const bundledCatalog = readJson(
  resolve(
    scriptDir,
    "../../../../runtime/adapters/keeper/node_modules/@earendil-works/pi-ai/dist/providers/data",
    `${provider}.json`,
  ),
  "bundled Pi model catalog",
  false,
);
// A user-written models.json entry shadows the catalog wholesale, but writers
// (e.g. the desktop login materialization) may persist only {id, name} when
// the upstream catalog lacked capability flags. Inherit missing capability
// fields from models-store.json so a stripped entry cannot silently downgrade
// a model to thinking "off"-only and block launch.
function withCatalogCapabilities(configured, catalogEntry) {
  if (!configured || !catalogEntry) return configured ?? catalogEntry;
  const merged = { ...configured };
  for (const key of ["reasoning", "thinkingLevelMap", "compat"]) {
    if (merged[key] === undefined && catalogEntry[key] !== undefined) {
      merged[key] = catalogEntry[key];
    }
  }
  return merged;
}

const configuredModel = findConfiguredModel(customModels, provider, modelId);
const catalogModel = findModel(modelStore, provider, modelId);
const bundledModel = findBundledModel(bundledCatalog, modelId);
const completeCatalogModel = withCatalogCapabilities(catalogModel, bundledModel);
const model = withCatalogCapabilities(configuredModel, completeCatalogModel);
if (!model) {
  failIfOff(
    `thinking "off" was requested for ${provider}/${modelId}, but its model metadata is unavailable; ` +
      "refusing to risk Pi silently selecting a thinking level",
  );
}

// A reasoning model whose provider takes no effort parameter accepts every
// level on the ladder and then ignores it. Measured 2026-09-02 on
// zai-coding-cn: `--thinking low` and the model's own default produced the
// same ~27k characters of reasoning per lane, because Pi's zai format sends
// `thinking: {type: "enabled"}` for ANY non-null effort and only
// `{type: "disabled"}` for off. The existing checks below catch "this level
// is unsupported"; this one catches the quieter failure — the level is
// accepted, transmitted, and has no effect, so an operator who set `low` to
// save quota saved nothing and has no way to see it.
if (
  requestedThinking !== "off"
  && model?.reasoning
  && model?.compat?.supportsReasoningEffort === false
) {
  fail(
    `${provider}/${modelId} takes no reasoning-effort parameter, so --thinking ` +
      `"${requestedThinking}" is accepted and then ignored: the model reasons at its ` +
      "own default and the level buys nothing. Use --thinking off for a real " +
      "reduction (Pi sends the provider's documented disable parameter), or pick a " +
      "model whose catalog declares supportsReasoningEffort",
  );
}

// A model that ignores the disable request cannot honour "off" no matter what
// its catalog declares. Refuse rather than let the request read as a saving.
if (requestedThinking === "off") {
  const forced = forcedThinkingNote(provider, modelId);
  if (forced) {
    fail(
      `${provider}/${modelId} cannot honour --thinking off: ${forced}. The request would be ` +
        "accepted and change nothing, and that reasoning shares the response output budget with " +
        "tool arguments — long tool calls get truncated mid-argument. Choose a model that can " +
        "actually disable thinking (GLM-5.2 and earlier), or run this one knowingly by asking " +
        "for a level it does declare",
    );
  }
}

const available = supportedThinkingLevels(model);
if (!available.includes(requestedThinking)) {
  const clampedLevel = clampThinkingTarget(model, requestedThinking);
  if (requestedThinking === "off") {
    fail(
      `${provider}/${modelId} declares thinking off unsupported; Pi would silently clamp --thinking off ` +
        `to "${clampedLevel}". Choose a model whose catalog supports off, or deliberately use ` +
        "--thinking low with hideThinkingBlock=true; hiding the block is not true thinking-off",
    );
  }
  fail(
    `${provider}/${modelId} does not support thinking "${requestedThinking}"; Pi would silently clamp ` +
      `it to "${clampedLevel}". Pass an exact supported level (${available.join(", ")}) via ` +
      "--thinking, or fix defaultThinkingLevel in settings.json",
  );
}
