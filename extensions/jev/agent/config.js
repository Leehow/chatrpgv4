/** The only Jev credential reader. Persistence and secret delivery belong to the host vault. */
export const EXTENSION_ID = 'jev';
export const API_KEY_KEY = 'ext.jev.apiKey';
export const API_KEY_ENV = 'EXT_JEV_APIKEY';
export const SETTINGS_ENV = 'PIPIUI_EXT_SETTINGS_JEV';
export const PRESELECT_KEY = 'ext.jev.preselectEnabled';
export const PRESELECT_CLI_ENV = 'PI_COC_JEV_PRESELECT';
export const PRESELECT_ALLOWANCE_KEY = 'ext.jev.preselectAllowanceMs';
export const PRESELECT_ALLOWANCE_CLI_ENV = 'PI_COC_JEV_PRESELECT_ALLOWANCE_MS';
/** One per-input optional preparation allowance (contract §124.10); measured, never a player-facing SLA. */
export const PRESELECT_ALLOWANCE_DEFAULT_MS = 12000;
export const PRESELECT_ALLOWANCE_MIN_MS = 2000;
export const PRESELECT_ALLOWANCE_MAX_MS = 30000;

const text = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const managed = env => env.PIPIUI_SPAWN_CONTRACT !== undefined || env.PIPIUI_HOST_PROTOCOL !== undefined;
const mounted = env => env.PIPIUI_MOUNTED_EXTENSIONS?.split(',').map(value => value.trim()).includes(EXTENSION_ID) === true;
const settings = env => {
  try {
    const value = JSON.parse(env[SETTINGS_ENV] ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};

/** @param {Record<string, string | undefined>} env */
export function readJevApiKey(env = process.env) {
  const managedSession = managed(env);
  // A disabled or unmounted extension cannot be revived by an inherited secret.
  if (managedSession && !env.PIPIUI_MOUNTED_EXTENSIONS?.split(',').includes(EXTENSION_ID)) return undefined;
  const key = text(env[API_KEY_ENV]);
  if (managedSession || env[SETTINGS_ENV] !== undefined) return key;
  // Compatibility for source CLI/measurement processes, through this reader only.
  return key ?? text(env.TYPESAFE_API_KEY);
}

/** Optional feature state. Managed sessions obey their mounted settings; only source CLI accepts the explicit override. */
export function readJevPreselectEnabled(env = process.env) {
  if (managed(env)) return mounted(env) && settings(env)[PRESELECT_KEY] === true;
  if (env[PRESELECT_CLI_ENV] === '1') return true;
  if (env[PRESELECT_CLI_ENV] === '0') return false;
  return settings(env)[PRESELECT_KEY] === true;
}

/** Managed sessions obey their mounted settings; only source CLI accepts the explicit development override. */
export function readJevPreselectAllowanceMs(env = process.env) {
  const configured = managed(env) ? settings(env)[PRESELECT_ALLOWANCE_KEY]
    : env[PRESELECT_ALLOWANCE_CLI_ENV] !== undefined ? Number(env[PRESELECT_ALLOWANCE_CLI_ENV]) : settings(env)[PRESELECT_ALLOWANCE_KEY];
  if (typeof configured !== 'number' || !Number.isFinite(configured)) return PRESELECT_ALLOWANCE_DEFAULT_MS;
  return Math.min(PRESELECT_ALLOWANCE_MAX_MS, Math.max(PRESELECT_ALLOWANCE_MIN_MS, Math.round(configured)));
}

/** Safe for status/UI output: never returns the secret or its fragments. */
export function describeJevConfig(env = process.env) {
  return { configured: Boolean(readJevApiKey(env)) };
}

export function describePrescreenConfig(env = process.env) {
  const configured = Boolean(readJevApiKey(env)), enabled = readJevPreselectEnabled(env);
  return {configured, enabled, active: configured && enabled};
}
