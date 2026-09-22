import { describePrescreenConfig } from './config.js';
export { readJevApiKey, readJevPreselectEnabled, describeJevConfig, describePrescreenConfig } from './config.js';

export function formatJevStatus(env = process.env) {
  const value = describePrescreenConfig(env), yes = flag => flag ? 'yes' : 'no';
  return `Jev: configured=${yes(value.configured)}; preselection enabled=${yes(value.enabled)}; active=${yes(value.active)}`;
}

/** The mounted entry lets the host deliver the vault secret; no Keeper tool is added. */
export default function jevExtension(pi) {
  pi.registerCommand('jev:status', {
    description: 'Show Jev credential and context preselection status',
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatJevStatus(), 'info');
    },
  });
}
