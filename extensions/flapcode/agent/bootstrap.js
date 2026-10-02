/**
 * Late subscription-snapshot bootstrap.
 *
 * The snapshot needs the relay API key, and the extension's own resolution path
 * (`EXT_FLAPCODE_APIKEY` from the secret vault, or the settings snapshot) only
 * carries one when the user typed the key into the Flapcode settings section.
 * A user who signs in through the app's provider login instead stores it in
 * pi's credential store (`auth.json`), which this process cannot read: the
 * old load-time `if (!apiKey) return;` then silently skipped the fetch, so
 * `flapcode-account.json` was never written and the quota pill never showed
 * subscription plan and expiration.
 *
 * The key that is always reachable is the one pi resolved for the request, via
 * `ctx.modelRegistry`. So the bootstrap also runs lazily from the first
 * Flapcode provider request — the earliest moment such a context exists, and
 * free for users who never select a Flapcode model. It runs at most once per
 * process, and a resolution that yields no key leaves it armed for the next
 * request rather than latching off.
 *
 * There is deliberately no gateway discovery here. The relay is pinned to
 * `codex.takemoon.com` (see models.ts); the old `flapcode.com/api/cli/config`
 * lookup that used to re-point it is a stale control plane that now answers
 * 409 "Codex account expired" for accounts that are in fact live and serving, so
 * letting it steer the base URL could only move a working provider off it.
 */
import { fetchFlapcodeAccount, writeFlapcodeAccountSnapshot } from "./accounts.js";
export function createFlapcodeBootstrap(options = {}) {
    const now = options.now ?? Date.now;
    let started = false;
    let resolving = false;
    const run = (apiKey) => {
        const key = apiKey?.trim();
        if (started || !key)
            return;
        started = true;
        // Subscription surface for the quota pill (plan name + expiry); the relay
        // headers only carry the Codex plan type, not the flapcode subscription plan and expiration.
        void fetchFlapcodeAccount(key).then((info) => {
            if (info)
                writeFlapcodeAccountSnapshot(info, now());
        });
    };
    return {
        run,
        runWith(resolveApiKey) {
            if (started || resolving)
                return;
            resolving = true;
            void Promise.resolve()
                .then(resolveApiKey)
                .then(run)
                .catch(() => undefined)
                .finally(() => {
                resolving = false;
            });
        },
    };
}
