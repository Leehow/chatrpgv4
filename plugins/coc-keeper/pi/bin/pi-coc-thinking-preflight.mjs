#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
const model =
  findConfiguredModel(customModels, provider, modelId) ??
  findModel(modelStore, provider, modelId);
if (!model) {
  failIfOff(
    `thinking "off" was requested for ${provider}/${modelId}, but its model metadata is unavailable; ` +
      "refusing to risk Pi silently selecting a thinking level",
  );
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
