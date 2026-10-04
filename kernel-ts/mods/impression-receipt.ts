/**
 * Contract §178.4: a first impression's receipt recognised -- a `roll` of a Mod check whose result is an `impression`,
 * whether the kernel rolled it on meeting or the Keeper resolved it. It observes a meeting: it is no interaction with the
 * person (the NPC ledger's fold) and no act against them (their act options). A leaf, so every reader of turn receipts
 * can import it.
 */
import {isJsonObject} from '../json.js';
import {row} from '../read/values.js';

export const isImpressionRoll = (receipt: unknown): boolean => {
    const value = row(receipt);
    return value.kind === 'roll' && value.roll_kind === 'mod_check' && isJsonObject(value.impression);
};
