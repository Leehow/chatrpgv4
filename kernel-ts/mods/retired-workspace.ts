/** Read-only compatibility for the workspace policy that now belongs to the host (§19.2). */
import {row, clone, type Row} from '../read/values.js';

export const RETIRED_WORKSPACE_MOD = 'keeper-context';

/** Old locks stay on disk as evidence; only their scalar host preferences are inherited. */
export function legacyWorkspaceSettings(world: Row): Row | undefined {
    const lock = row(row(row(world.mods).active)[RETIRED_WORKSPACE_MOD]);
    if (!Object.keys(lock).length) return undefined;
    return {...clone(row(lock.settings)), ...(lock.enabled === true ? {} : {mode: 'off'})};
}
