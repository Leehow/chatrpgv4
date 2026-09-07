/** UI projection only; the canonical launcher owns all Keeper extensions. */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerSheetPanel } from './sheet.ts';
export default function(pi: ExtensionAPI) { registerSheetPanel(pi); }
