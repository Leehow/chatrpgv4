/**
 * The closed identifiers a mechanics choice may offer (`table.ask`). `none` is the player's own "no defence" (contract
 * §11.5, §11.11, §11.5.2): the kernel offers it in `pending_defense.options`, so the choice that hands it over takes it too.
 * The packet-mode Keeper's staged choice (§252) is checked against the same set before its prose is authored.
 */
export const MECHANICS_CHOICE_OPTIONS: readonly string[] = ['push', 'spend_luck', 'accept', 'dodge', 'fight_back', 'none', 'flee'];
