# Daily Life: Resident Guidance

This Mod gives you optional routine guidance for the canonical local clock. It helps you judge how households, services, entertainment venues, workplaces and people usually behave at a given time. It does not make those judgments for you, and it is not a schedule.

## How the advice is selected

When the temporal judge is available, it compares the current scene, the place's purpose, the local clock and any recorded activity against the rows in this Mod's table. The runtime delivers only the rows it selects, as advice for you to weigh. A selected row is a suggestion about plausible behaviour. Matching a row never changes the world, grants access, moves anyone, transfers items or completes an action. If no row is selected, or the judgment is unavailable, use your own judgment from the fiction.

## What to read and reassess

Before portraying a service, street activity or an ordinary NPC reply, read `where.temporal` for the scene's recorded service, crowd and activity, and read `present[].activity` for each person's recorded wakefulness and activity. If a record is absent, stale, past its review boundary, or the place or time has changed since it was written, reassess it from the clock, the place's purpose and the fiction before you portray it. Keep a stale record as a prior, not a fresh observation.

When the fiction makes a material change to a scene or a person, record it with the apply path: use `scene` for service, crowd or activity in a scene, and `npc` with the `activity` variant for wakefulness or activity. Give each record its `basis` and a short reason. Put time and travel effects first in the batch, so the records describe the resulting time. Recording is optional for minor texture; record only supported changes.

For ordinary residential streets at late-night or pre-dawn hours, with no exceptional activity in the fiction, portray street traffic as plausibly reduced and daytime businesses as closed or limited where local context supports it, keeping watchmen, night workers and late arrivals. Do not guarantee an empty street, closed locks or a particular sleeper.

This guidance does not require a historical lookup, a forced player goal or a choice. Use it when it helps the scene.

## What the advice does not establish

Routine expectations are not facts about a particular person. A household that is expected to rest is not proven asleep, and a quiet residential street at night does not show that any given household is asleep; street portrayal and an individual's sleep are separate questions. A closed service does not lock every route into a building. Night does not decide whether a workplace is busy. Use these as starting points and let the authored fiction, the recorded state and the player's actual action decide what happens.

## Protecting what has already happened

Observed and established records outrank routine guesses. Do not let a generic refresh or an inferred routine overwrite a person's awakening, a service state or any other recorded change. When something has actually changed in the fiction, record it through the scene or NPC activity apply path with its basis and a short reason. Stale context stays a prior until you reassess it; do not present it as a fresh observation.

## If the Mod is off

When this Mod is turned off, its advice and row matching stop, but the canonical clock and every recorded temporal fact remain. Recorded observations and established changes stay protected. Use your own judgment from the fiction and the recorded state.

## Safe fallback

If the advice is missing, unclear or inconsistent with the scene, fall back to the Keeper's own judgment. Do not default everyone to being awake or asleep. Do not stop play to resolve a routine question, and do not turn a suggestion into a required goal, a lookup, a wait or an investigation. Keep the player's options open and let their actions shape what happens next.
