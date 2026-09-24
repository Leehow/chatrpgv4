# Narration Craft

## 1.6.0
- Enables reference_mode=jev by default for new locks; explicit off and existing immutable campaign settings stay respected. Missing credentials still fall back normally.
- Ships with coherent base craft guidance: answer the player's contribution instead of replaying it, with clear speaker transitions and scene-appropriate detail rather than compulsory gestures.
- Issued editorial guidance survives ordinary settlement within the same exchange, while scene, participant, source, package and input changes still invalidate it. First adoption retains the full freshness check and each input still permits only one selection.

## 1.5.0
- Declares a frozen English craft catalog and a bounded twelve-card candidate pool through context.craft-reference.v1.
- Adds reference_mode off/jev, default off. Host reference preparation is optional and adds no writing tool or audit gate.
- Keeps ordinary positive guidance and density settings. Existing locks require explicit upgrade.

## 1.4.0
- Uses positive guidance for the current exchange, established NPC motives, natural syntax and compatible incidental invention in both full and brief instructions.
- Keeps selected-goal handoffs, authority boundaries, density_guide and existing default enablement. Existing campaigns upgrade explicitly; base Keeper/style assets are unchanged.
- Adds no reference selector, provider call or literary audit. Dynamic references remain a separate later capability.

## 1.3.1
- Re-issues the selected-goal handoff under a fresh number. 1.3.0 was already taken by the unmerged delivery-typography branch (2026-09-12), whose bytes are frozen in existing campaign homes; reusing it made `mods.list` fail with "Conflicting bytes for narration-craft 1.3.0". No text changes from the 1.3.0 below.

## 1.3.0
- Replaces the mandatory new-event and multiple-options handoff with the player's selected-goal boundary: complete routine selected action, then return at goal completion or the next unselected consequential choice.
- Allows quiet answers, refusals, silence and natural closure without forcing a person to act, a Director offer, or a trailing question.

## 1.2.2
- Adopts the §101 runtime-file allowlist; the engineering changelog is no longer frozen into campaign homes.

## 1.2.1
- The brief names the say token (contract §40): every line anyone speaks aloud sits inside `{{say:Name}}…{{/say}}`, so the frontend can draw it in its speaker's colour. Nothing else changes; the per-turn brief ceiling of §30.7 is 5000 bytes since §40.6.

## 1.2.0
- States the turn floor as craft (docs/specs/turn-floor.md): uptake, the world's answer, a voice, the handoff; the routine-turn warning returns as craft, not as a budget; a one-word input gets a full turn; `director.offer` is named as what can move when nothing landed; the handoff is the spotlight rule — stop only when the player has enough to judge and more than one real thing to do, never at a midpoint with nothing to decide. Two live tables (medians 167 and 37 characters, 11 of 12 turns closed by the host with no tool call) showed that 1.1.0's retirement of the ladder had also retired the only floor language.
- Adds `density_guide` (`off` | `on`, default `off`): with `on`, the brief carries the play language's expected density per beat as an expectation the kernel never counts. No `*_chars` ceilings and no paragraph caps return.

## 1.1.0
- Retires the length ladder and its settings: `settings` and `settings_schema` are now empty. The character ceilings never bound anything — twenty measured deliveries ran 52–430 characters against ceilings of 600–1500 (contract §30.8) — and 1.0.2 had already dropped the paragraph caps beside them.
- Drops the rule that a concrete handle must be in reach before stopping, the required trailing question, and the instruction to give a cost its own block of prose. Action uptake and keep-the-fact move to the base layer, which owns the definition of a playable turn.
- Owns, instead, what is craft: selecting material from the live exchange and the `present[]` dossier, NPC voice, crisis ordering, the scene-opening perception offered rather than required, the beat words with their humour knobs, and the world-assertion cost ladder.
- Friendly help, companionship, a joke and a quiet scene are complete outcomes; plain telling is allowed; one detail may serve several purposes; hidden truth stays hidden by reference to law 3 rather than restated (contract §30.12).

## 1.0.2
- Drops the paragraph caps (the `*_paragraphs` settings). Twenty measured deliveries ran 1–9 paragraphs against caps of 3–8, exceeding them in eight of eleven while never approaching the character ceiling (contract §30.8). This entry was missing when 1.0.2 shipped in commit `317a5991`, which bumped `mod.json` alone.

## 1.0.1
- Adds `brief.md`, the per-turn reminder form of the instructions (contract §30.7); the first turn of a process still carries the full text.

## 1.0.0
- First release: beat-keyed length budget as settings, action uptake, world-assertion cost, crisis order, handles before stopping, beat vocabulary and NPC voice openings.
