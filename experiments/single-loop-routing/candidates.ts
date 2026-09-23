/**
 * Host-issued step candidates. The builder moved into the product at SL-02 (`runtime/jev/candidates.ts`, contract
 * §135.2); the prototype imports it from there so the replay and the product cannot drift.
 */
export * from '../../runtime/jev/candidates.ts';
