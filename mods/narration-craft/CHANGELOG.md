# Narration Craft

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
