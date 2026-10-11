/** §221.9 (Keeper Rulebook p.168): the Keeper award's scale, read from the rules data; nobody types an expression. */
import { RpcError } from '../errors.js';
import { array, row, string, type Row } from '../read/values.js';
import type { RuleTables } from '../rules/tables.js';
import { rollExpression } from '../resolve/arithmetic.js';

export interface AwardRung { expression: string | null; label: string; printed: boolean }

/** The rungs of `reward.json`'s `keeper_award.scale`, in the data's order; a `null` expression is "reduce or remove". */
export async function keeperAwardScale(tables: Pick<RuleTables, 'load'>): Promise<AwardRung[]> {
    const rows = array(row(row(await tables.load('reward')).keeper_award).scale).map(row);
    if (!rows.length) throw new RpcError('invalid_params', 'reward.json keeper_award.scale is empty');
    return rows.map((entry: Row, index) => {
        const expression = entry.expression === null || entry.expression === undefined ? null : string(entry.expression);
        if (expression !== null) {
            try { rollExpression(expression, { randint: () => 1 } as any); }
            catch { throw new RpcError('invalid_params', `reward.json keeper_award.scale[${index}].expression ${JSON.stringify(expression)} is not a dice expression`); }
        }
        const label = string(entry.label);
        if (!label.trim()) throw new RpcError('invalid_params', `reward.json keeper_award.scale[${index}] needs a label`);
        return { expression, label, printed: entry.printed === true };
    });
}
