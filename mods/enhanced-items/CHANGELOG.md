# 1.2.1

Shortens the later-turn reminder so Mod instructions stay under the runtime budget.
Campaign state and accepted usages are unchanged; live campaigns pinned to 1.2.0
keep that package until explicitly upgraded.

# 1.2.0

Requires objects.usages.v1. Existing held physical instances can acquire separate,
validated melee, thrown or firearm usages without replacing their definitions or
resetting ownership, condition or remaining resources. Usage preparation uses a
tool-enabled creator and waits for acceptance in the current action; an accepted
matching job is reused without running the creator. The same object-preparation
batch may stage define/object before usage for an immediate scene pickup or
adoption, while unrelated world changes stay in separate applies. Definitions default to item,
legacy weapon/spell definitions remain supported, and define/adopt-only background
bookkeeping is unchanged. Existing campaign records are not rewritten on upgrade.

# 1.1.9

Treat equipment without instances as assessment candidates, not registration obligations; require a concrete mechanical basis for missing-object findings.

# 1.1.8

Follow the active audit submission protocol and preserve existing ownership when a draft describes an unperformed transfer.

An adopted object is named for the object. A sheet's equipment row is a line, not a
name -- "a .45 automatic and two spare magazines", "a gold single-shot pistol (one
bullet only), plain leather holster" -- and a live sheet headed both weapons with the
whole line. What the line says besides the object belongs in the description. adopt
still matches the row exactly; only the name is shorter. The same paragraph now says
to name the definition in every placing object call, which a live table got wrong
four times in two sessions. Definitions and instances are unchanged on upgrade.

# 1.1.7

The creator and the auditor work without a shell. Their prompts no longer send the
child to a checker command, because the host runs that same gate and its findings
already drive the repair round. Three children on record spent 19 of 24, 24 of 28
and 10 of 15 tool calls reading the packaged app, the build output and their own
event log, and one never wrote its definition at all. Nothing is checked less;
only the wandering is gone. Definitions and instances are unchanged on upgrade.

# 1.1.6

Adds `brief.md`, the per-turn form of the instructions (contract §30.7): the first turn a process opens for a campaign still carries the full text, later turns carry this reminder. Behaviour is unchanged; the capsule is smaller.

# 1.1.5

Initial gear registration is asked for as one apply carrying only definitions and
adoptions. That batch is bookkeeping -- adoption enriches gear already carried,
names no giver, moves nothing and advances no time -- so the host registers it
without the player waiting on generated parameters, and completes it at the top
of the next turn. Mixed batches, which belong to the moment being narrated, are
unchanged. Definitions and instances are unchanged when a campaign upgrades.

# 1.1.4

The creator's result shape names traits, and says that traits and document are
fields of the definition rather than parameters. Sixteen of thirty-six drafts on
record nested traits inside parameters and were rejected; eleven answered that
refusal by deleting the measurements instead of moving them. Definitions and
instances are unchanged when a campaign upgrades.

# 1.1.3

Player-visible physical traits, each trait's name, unit and string value, are
written in the campaign play_language, as the description already is; structural
keys stay English. The host projects the kernel's condition words and the traits
of older definitions for reading, so no sheet shows them in English.

# 1.1.2

Generated readable writing follows the campaign play_language in both creator
definitions and Keeper instance writes. The host supplies cached reading versions
for older and authored documents while retaining exact acquisition originals and
the player's own edits.
Requires ui.documents.language.v1; older hosts report an incompatible upgrade.

# 1.1.1

The shipped editor contribution uses the additive top-level ui field. Older live
kernel processes can enumerate the package as incompatible without rejecting the
entire catalog during a source update. Version 1.1.0 packages remain supported.

# 1.1.0

Readable/writable carriers have persistent document text and an acquisition
snapshot. The paper editor can save and reset without altering scenario truth.
Existing carriers are enriched in place. Named rule, materializer and document
editor contributions can be superseded by later Mods in the saved load order.

# 1.0.3

Initial and legacy inventory participate in opening/turn context and narration
audits even when not mentioned in prose. Mechanically meaningful gear is adopted
in place through the existing apply transaction, preserving ownership, quantity
and recorded physical state. Existing weapon profiles are retained. Requires
objects.adopt.v1. Older save locks must explicitly upgrade before using this policy.

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
