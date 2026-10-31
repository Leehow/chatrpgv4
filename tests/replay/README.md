# Fixed-checkpoint replay (R1)

Paired A/B on the same starting state instead of whole tables: a C0 checkpoint is cut just before one player line,
restored into an isolated copy per run, and played by the real host and kernel with all of the owner's PipiCOC
plugins. Nothing here decides for the Keeper; the driver only carries the line in.

| File | Does |
| --- | --- |
| `checkpoint.ts` | `export` a C0 (historic: sidecar commit awaiting line N, later objects pruned; `--live`: a workspace at rest), `verify` it |
| `capture-preload.mjs` | loaded into every Node process of a run; records each provider request as it leaves fetch (after all payload hooks) and its response; with a tape, answers from it instead |
| `restore-check.ts` | layer 1: restore twice, compare files and the kernel's read methods, canary isolation |
| `run.ts` | one arm, one repetition, one line; refuses unless the daemon loaded all nine plugins |
| `compare.ts` | outcome (dice, receipts, mechanics, prose digest), state digests, capture summary, pairwise comparison |
| `select-cases.ts` | stratified selection by book × action class (from tool structure only) and export |
| `batch.ts` | layer 1, each arm live, tape replay of one arm (layer 2), pairing, one row per case |

Layout: `.coc/eval/checkpoints/<batch>/<case>/{manifest.json,input.json,home/}`, `.coc/eval/runs/<run_id>/{result.json,capture/,workspace/}`,
`.coc/eval/reports/<batch>/`. The player's line lives in `input.json`, outside the seed home.

## What is normalised, and only this

- State comparison drops wall-clock fields (`compare.ts` `VOLATILE`) everywhere, and in turn records also execution
  identity (`EXECUTION_IDENTITY`: sidecar commit hash, attempt/delivery ids, digests over them, `run-<uuid>` ids).
  Game time, entity ids, reference scope, document text and action order are never dropped.
- Tape matching (`TAPE_NORMALIZATION`): the run root path, `prompt_cache_key`, lane `<cwd>` scratch paths and
  `run-<uuid>` ids. Anything else that differs is a divergence: recorded with the nearest recording and refused
  with a 400, never forced.
- Tape answers keep the recorded latency (`PI_COC_REPLAY_TAPE_TIMING=0` drops it). Without it the host's race
  between background preparation and the Keeper's first request resolves differently and the context changes.

## Known limits of a historic (grade B) checkpoint

- Background writes made after turn N−1 was committed (memory extraction, NPC journal and ledger, first sight) land
  in the next commit mixed with turn N, so they are absent.
- Stores outside git are kept only if last written at or before the C0 commit; later files are listed as gaps.
  `source-reading.sqlite` keeps revisions without times and is taken at its end-of-run revision.
- The source run's kernel seed was not recorded, so its dice cannot be reproduced; replays use
  `COC_KERNEL_SEED=<checkpoint>/r<rep>`, the same for every arm.
- Wall clock is not frozen.
