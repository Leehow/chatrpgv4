/** Shared extraction guidance; semantic participants are selected by the model, never inferred by code. */
export const MEMORY_ATTRIBUTION_POLICY = 'heard-participants-v1';
export const MEMORY_ATTRIBUTION_INSTRUCTION =
    'Check this delivered exchange for new conditional undertakings and concrete changes in directed cooperation before answering. ' +
    'A future undertaking addressed to another actor is a promise when tied to a condition or promised result, even without a clock deadline; ' +
    'do not replace it with only player_assertion. A tentative plan or speculation is not a pledge. ' +
    'For each promise, subject is the named promisor, entities name the actual recipient and relevant topic, and knowers explicitly name ' +
    'the speaker and every supplied actor shown hearing or receiving that pledge. In particular, retain the NPC listener of an investigator\'s promise in knowers. ' +
    'A delivered reply accepting or discussing the pledge can establish that listener heard it. Presence alone does not establish hearing; ' +
    'an absent intended recipient, a private thought or an undelivered message does not grant that person knowledge. ' +
    'A promise needs at least one supported knower; omit an unsupported pledge rather than invent participants. ' +
    'Relationship subject is the actor whose expressed view or cooperation changed; entities contains the other person alone. ' +
    'Preserve the concrete shared deed or explicit position supporting that direction. If only one actor\'s change is supported, record only that direction. ' +
    'Do not swap subject and target, invent reciprocal feelings, infer lasting trust from courtesy, or turn a promise into fulfillment. ' +
    'A later specific change can be new even when prior already contains a general preference or earlier pledge. ' +
    'Use actual supplied investigator/NPC names for personal undertakings and positions, rather than replacing the named speaker with player.';
