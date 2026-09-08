/** UI projection only; the canonical launcher owns all Keeper extensions. */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerSheetPanel } from './sheet.ts';
import { registerModsPanel } from './mods.ts';
export default function(pi: ExtensionAPI) { registerSheetPanel(pi); registerModsPanel(pi); }
