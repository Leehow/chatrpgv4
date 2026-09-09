/** Thin application bindings for the shared healing and clock functions. */
import { clone, string } from '../read/values.js';
import { required } from '../write/store.js';
import { rollDamage, stageDamage, stageRecovery, stageDayBoundary } from '../healing/resources.js';
import type { ApplyResources } from './index.js';
export const applyResources: ApplyResources = {
    async damage(context, effect) {
        const rolled = rollDamage(required(effect, 'dice')!, context.kernel.rng);
        const staged = await stageDamage(await context.settlement(effect.subject), rolled, effect);
        return { receipts: staged.receipts, event: { type: staged.event[0], data: staged.event[1] } };
    },
    async recovery(context, minutes) {
        if (minutes < 60)
            return { receipts: [], events: [], recovered: [] };
        const party = await context.campaign.party();
        if (!party.length)
            return { receipts: [], events: [], recovered: [] };
        const result = await stageRecovery(await context.settlement(string(party[0].id)), minutes);
        return { ...result, events: result.events.map(([type, data, receipt]) => ({ type, data, receipt })) };
    },
    async dayBoundary(context, clockBefore) {
        const party = await context.campaign.party();
        return stageDayBoundary({ graph: context.graph, world: context.world, party: () => [...party],
            readSave: async (name) => clone(await context.campaign.readSave(name)),
            writeSave: (name, value) => context.campaign.writeSave(name, value) }, clockBefore);
    }
};
