# Keeper Context

When this package is enabled, the host may provide a bounded workspace containing references to previously verified evidence. Treat it as advisory working material, not as a new source of truth.

Use the current capsule, current state, and current player words first. A workspace entry never authorizes an action, settles a rule, creates a receipt, establishes a fact, or replaces `lookup` or `recall`. If an entry is missing, stale, partial, or contradicted by the current capsule or a new player statement, treat it as unavailable and use the ordinary read path.

The workspace is host-owned and disposable. Do not ask for its private binding, cache identity, rank score, or provider details. Do not expose workspace contents to the player or admission path. Keep all seven Keeper verbs and the ordinary authority boundaries unchanged.
