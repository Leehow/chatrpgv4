/**
 * Contract §178.5: natural-npc 1.5.0 rolls a first impression when the people meet (`trigger: "presence"`); a campaign
 * locked to 1.4.4 or earlier keeps the `contact` check, pending until the Keeper or the clerk resolves it. Every table the
 * owner played before 1.5.0 is such a campaign. These are 1.4.4's own bytes (from 60d5afc55), installed into a test
 * workspace and pinned, so a test of the `contact` path (the clerk's `mod_contact` candidate, admission's contact rule, a
 * check an obligation step serves) runs exactly as such a table does.
 */
import {join} from 'node:path';

export const NATURAL_NPC_1_4_4 = join(import.meta.dirname, 'fixtures/natural-npc-1.4.4');
/** Kernel requests that pin a campaign to natural-npc 1.4.4; send them before `table.open`. */
export const pinContactImpression = () => [['mods.install', {path: NATURAL_NPC_1_4_4}], ['mods.configure', {id: 'natural-npc', version: '1.4.4'}]];
