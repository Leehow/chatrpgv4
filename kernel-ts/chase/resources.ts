/** Chase participant synchronization reuses the single wound/sheet implementation. */
import type { SettleContext } from '../resolve/context.js';
import { damageConditions, mirrorInvestigator } from '../healing/resources.js';
import { entries, number, type Row } from '../read/values.js';
export async function syncChaseParticipants(context: SettleContext, participants: Row): Promise<void> {
    for (const [id, participant] of entries(participants)) {
        const sheet = context.sheetById(id);
        if (!sheet)
            continue;
        const after = Math.trunc(number(participant.hp || 0));
        const loss = Math.max(0, Math.trunc(number(sheet.current_hp || 0)) - after);
        const conditions = loss ? damageConditions(context, sheet, after, loss) : null;
        await mirrorInvestigator(context, id, {
            currentHp: after,
            conditions
        });
    }
}
