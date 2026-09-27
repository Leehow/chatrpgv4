Status: ready (filed 2026-09-27 from the Masks PDF re-run; batch 19; P2)
Stage: SL-103 (setup: the handoff command is the host's, never the guide's words; a refused guidance draft is retried without waiting for the player)
Spec: docs/kernel-rpc.md §14.4 (step seven, the handoff), §14.19 / §98 addendum 9 (SL-98), SL-100's `player_reason`; `extensions/onboarding/index.ts` (`finish`, `handoff_command` in the step result ~973, guidance failure and retry)

# SL-103: the guide reads out the handoff command; a guidance refusal waits for the player's next line

## Evidence (Masks re-run, `masks2-2238-20260927T023845Z`)
1. **Handoff command.** The confirm step's result carries `handoff_command: "bin/pi-coc --campaign masks2-2238"`, and the guide appended it verbatim to the player-facing reply.
   - The host already shows the handoff itself: `ctx.ui.notify` in the CLI, and the App switches to play on `coc-session mode:'play'`.
   - A CLI command in the guide's prose is noise in the App and duplicates the host's line in the terminal.
2. **Guidance retry.** `create-campaign` returned `guidance_failed / preparation_failed` ("Character guidance needs revision"): the guidance reviewer refused the first draft. The `player_reason` said it would be tried again "with your next message". The player had to send a line ("好的，再试一次吧") before setup continued, which is dead time for a retry the host could start at once.

## Ruling
1. The handoff command stays machine-facing. The step result tells the guide the host has shown the handoff (like SL-98's `opening_shown`), and does not hand it a command to repeat.
2. A guidance draft refused by its reviewer is retried by the host right away, bounded (e.g. once), before the step answers. The player is asked to wait only if that retry also fails.

## Tests
- The confirm result carries no bare command for the guide.
- A reviewer-refused guidance is retried once in the same step and succeeds.
- A second refusal falls back to the SL-100 reason.

Mutation-killable.

## Comments
