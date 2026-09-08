# 1.0.2

Existing-object state changes use explicit same-owner updates with a causal reason.
The pre-delivery auditor now verifies described damage, ownership and spent uses
against instance state. Requires objects.state.v2. Transfers still preserve state.

# 1.0.1

Weapon profiles can leave non-applicable range/malfunction fields null. The creator
explicitly preserves the preset's damage-bonus rule and writes the player description
in the campaign language. Requires weapons.profile.v2. Existing definitions and
instances are unchanged when a campaign upgrades.

# 1.0.0

Context-grounded generated definitions, persistent instances, transfers, typed
effects, physical traits and a pre-delivery semantic audit.
