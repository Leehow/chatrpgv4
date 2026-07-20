# Grok KP persistent-session degradation investigation

> Correction (2026-07-19): the initial 15-turn run restarted a headless Grok
> process for every exchange. It is invalid for normal long-session acceptance
> and remains recovery-path evidence only. The replacement run keeps one
> interactive Grok process alive in tmux for the whole table session.

Work ID: `grok-kp-100-turn-degradation`
Status: `In Progress`
Last updated: `2026-07-19`

## Product question

Why does a real Grok Keeper sometimes degrade during a long campaign into a
dice executor that rolls once, explains the result in one sentence, and stops
providing enjoyable scene framing, NPC agency, causal development, table wit,
and meaningful player choices?

Success is locating the first sustained degradation window and distinguishing
model-context/compaction effects from tool-discovery load, state retrieval,
prompt drift, finalization pressure, or scenario exhaustion. Merely producing
100 numbered turns or a polished report without real play is invalid.

## Live protocol

- Keeper: one persistent Grok Build / Grok 4.5 high session using the installed
  canonical COC plugin and MCP only.
- Player: one persistent protocol-isolated Codex subagent. It receives only the
  investigator sheet and exact player-visible Keeper output; it never reads
  module files, Keeper logs, source code, or secrets.
- Scenario: `Masks of Nyarlathotep — Prologue: Peru`, investigator 张宝华.
- Every exchange is one genuine player declaration followed by one genuine KP
  reply. No fake Keeper, batch settlement, keyword router, scripted player,
  scene-template bank, or synthetic transcript.
- The KP is not told to optimize turn counts or to exercise tools. The player
  pursues character goals naturally and may make mistakes, retreat, or die.
- Exact delivered player and KP text is retained. Derived observations never
  overwrite the transcript.

## Stop boundary

Stop at the first of:

1. a natural scenario ending, investigator death/retirement, or another real
   terminal play state;
2. 100 completed player/KP exchanges;
3. an unrecoverable plugin, model, authentication, state-integrity, or transport
   blocker that cannot be resolved without changing the product under test.

Do not prolong a terminal story merely to reach 100.

## Observation checkpoints

Review exact evidence after turns 10, 25, 50, 75, and 100, plus the first
suspected degradation window. Check semantically rather than with prose
keywords:

- specific uptake of the player's declared method and details;
- scene framing, sensory/world response, and forward motion;
- NPC initiative, distinct voice, agenda, and multi-NPC capacity;
- fictional causality before and after mechanics;
- meaningful consequences, opportunities, and choices;
- table wit or character-grounded teasing when tone permits;
- secret and player-knowledge boundaries;
- roll density, unnecessary checks, and whether prose collapses to a receipt
  paraphrase;
- repeated reads/discovery, tool-call mix, failures/retries, context/cache
  tokens, latency, and any Grok compaction/resume event.

## Hypotheses

- H1: accumulated conversation context or host compaction drops the Keeper
  constitution and retains only recent mechanical patterns.
- H2: repeated schema/tool retrieval crowds out scene/NPC context.
- H3: finalization obligations dominate the model's attention and prose becomes
  a mechanical wrapper.
- H4: bounded working-set retrieval becomes too thin late in play and starves
  the KP of unresolved threads, NPC motives, or scene texture.
- H5: the player/action distribution or exhausted scenario state creates a
  real run of check-heavy turns rather than model degradation.

## Acceptance ledger

- [ ] Persistent Grok KP and persistent isolated player activated and identity
  confirmed.
- [ ] Fresh writable campaign copy bound to the current plugin/archive contract.
- [ ] Exact transcript and per-turn operational evidence retained.
- [ ] Checkpoints at 10/25/50/75/100 or natural terminal state reviewed.
- [ ] First sustained degradation window located, or absence of degradation
  honestly reported within the observed run.
- [ ] Competing hypotheses tested against exact turn/context/tool evidence.
- [ ] Canonical battle report exported only after the real run terminates.
- [ ] No source changes or fixes mixed into the diagnostic run.
