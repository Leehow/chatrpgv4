# First-visible-prose latency: jev-rolls and prose-first — handoff 2026-09-29

## State at handoff

The user asked for this document so another agent can continue ("你先写个交接文档吧，我给别的ai来处理"). Nothing of
this line of work is waiting to be committed. Nothing below is merged unless it says so.

- Shared checkout `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2`, branch `0.9.6a`. Head `60b9dd842` when this was
  written. Other sessions commit here concurrently: check `git status` and `git log` before relying on this line.
- Two prototype branches carry this work. Both are **unmerged**, both flags are **off by default**, and both **failed
  their pre-registered bars** (below):
  - `claude/jev-rolls-prod-20260929` @ `11ea915ca` (worktree `chatrpgv4-wt-jev-rolls-prod`). It already merges `0.9.6a`
    @ `60b9dd842`. Box `test:ext` 4068/4068.
  - `claude/prose-first-ui-20260929` @ `d634a6f70` (worktree `chatrpgv4-wt-prose-first-ui`). It is based on an older
    `0.9.6a`. Box `test:ext` 4039/4039.
- The installed App (`/Applications/PipiCOC.app`, receipt `a1c3d9374`) was packaged by another session from
  `claude/forward-only-reconciliation-20260929`. This work never packaged anything.
- No task process is running. The `pf1d-*` tables were stopped after one turn on purpose.

## Intent

The user's goal is to shorten the time from sending a line to the **first visible prose character**. The metric is from
`agent_start` to the first `coc-mechanics` entry, or with prose-first on, to the first streamed delta that stays on
screen. It is currently a median of 25–30 s with `grok-build/grok-4.5` low, when the provider is healthy.

Two ideas were tested, each approved by the user:
- **jev-rolls (§158).** User's ruling: "设计就有问题，完全可以交给 jev 来选择投什么". Jev picks the roll the declaration
  calls for, and the host rolls it before the Keeper's first step.
- **Prose-first (A, §157).** The Keeper's prose streams as plain text before its writes. The user approved it step by step,
  and ruled that under the flag the draft is shown directly as the story (§157.10).

What the time is actually spent on is measured in memory `turn-latency-budget-20260929`. The Keeper's own output tokens
dominate: about 0.7 s + 2.15 s per 100 tokens, and `apply` arguments are 54% of its visible output. Admission review is
about 10%.

## Already landed on 0.9.6a from this line (earlier 09-29, for orientation)

- Lane thinking fixes:
  - lanes clamp a level the catalogue marks `null`;
  - model corrections merge key by key;
  - post-delivery lanes get a thinking floor (§37.11.1);
  - the continuity audit drops inapplicable sub-reviews (§130.10).
- Lean `apply` arguments, on by default (§154, `PI_COC_LEAN_APPLY=0` turns them off).
- Travel time counted once (§156, `beyond_travel`).

## jev-rolls (§158): no speed gain, stays off

Read the verdict in `docs/kernel-rpc.md` §158.11 on the branch; §158.1–158.10 are the design record.

- **Correctness held.** 60 flag-on turns (v3 `jr3-*`, v4 `jr4-*`):
  - 4 host rolls, each fitting the declaration;
  - 0 duplicates;
  - misses v3 0/0, v4 1/2.
- **Speed failed.**
  - Pre-registered medians: v3 z1 25.8→25.5 s, j2 27.5→30.2 s; v4 z1 30.9→27.1 s, j2 28.6→32.7 s. The bar was −5 s.
  - Paired by the same player line, the host-rolled turns were **+0.9 s** on average.
  - Three of the four host rolls replaced either the compile path's own roll or no roll at all. The slow turns are the
    ones where the Keeper rolls, and those are exactly the stage's misses.
  - An earlier claim that host-rolled turns were 9 s faster was selection bias; it is withdrawn.
- **The misses are in the existing compile/ordinary-binder path, not in the stage:**
  1. *Consent coupled to route.* When the compile settled that the declaration is rolled (§135.30.3), Jev answers the
     binder's `consent` as `unselected` whenever it also answers `route: no_roll`. `interpretOrdinaryRoute`
     (`runtime/jev/ordinary-resolve-domain.ts`) then reads that as `needs_player`. Examples: "我去市政档案厅，查产权",
     "我站到楼梯口听一会儿".
  2. *Multi-act declarations.* In "先听听动静，再开手电筒看看", the profile splits Listen/Spot Hidden 0.5, and nothing may
     roll both.
- **Upper bound for any roll pre-decision.** On the flag-off tables the Keeper rolled ordinary checks on 4 of 30 turns.
  Saving one Keeper round on every one of them is worth about 3 s per turn on average and nothing at the median.
- **Worth keeping if the stage is ever revived** (v4, on the branch):
  - a route that calls no roll does not wait for the profile;
  - every stage request's lease ends by `jev_rolls.deadline_ms` (3 s), capped by the decision budget left (before this,
    a hung Jev could stall the turn 15 s);
  - no Jev, no stage.

  Two test stubs (`scene-obligation-candidates`, `single-loop-prescreen-budget`) now answer the stage's families as
  decisions.

## Prose-first step 1c (§157.12): fails the bar, and exposes a UX defect

Read `docs/kernel-rpc.md` §157.9–157.12 on the branch.

- **What the branch keeps (flag on only).** Shown prose is not withdrawn for bookkeeping the kernel already lets through
  on a second delivery.
  - The host re-sends at once on §143.11's reasons: `markup_in_prose`, `intent_result_owed`, `purpose_repeated`.
  - A shown reply's time reading rides unrefusable, so §145.3 delivers it with a `time_unrecorded` warning.
  - *Trade-off the user has not ruled on:* the first refusal was the round trip that made the Keeper record the owed
    result or the skipped time. Under the flag that now arrives as the next capsule's warning.
- **Measured** (`pf1c-*`, provider slow in that window):
  - withdrawn turns 2 and 2 (bar at most 1), mostly a refused `apply` spoiling a held draft;
  - first prose against the concurrent control: z1 −22.0 s, j2 −0.7 s (bar −8 s on each script).
  - Step 1b before it: about −10–12 s median, withdrawals 4 and 2.
- **Tried and reverted: the "lead-in".** Step 1c kept text written beside a roll on screen and prefixed it to the
  delivery; step 1d widened it to short text beside reads.
  - Reading every such text on four prose-first tables showed **10 of 10 were the Keeper's notes to itself**, not story.
    Examples: "Listen failed. Now Spot Hidden for looking with flashlight.", "需要图书馆使用检定来查档。".
  - Two of those notes were delivered to the player as story. Reverted in `81908f10c` and `971551a5a`.
- **The open UX defect.**
  - Under the flag the App draws every streamed text as the story from its first delta (§157.10). So these notes flash on
    the player's screen, about 1 turn in 6, before the host drops them. Most of 1b's "resolve_beside" withdrawals were
    this.
  - Telling a note from story is a semantic judgement: never a regex, list or length classifier (see CLAUDE.md).
  - The user's 09-26 ruling still stands: side text is folded and viewable in one click, never withheld (memory
    `keeper-side-text-folds-not-hides`).

## Decisions owed by the user: ask before acting on any of these

1. jev-rolls: should consent `unselected` stop vetoing a roll the compile already settled? Should the host roll both
   skills of a two-act perception line? Or drop the stage for good (the upper bound is about 3 s mean)?
2. Prose-first: how to keep the Keeper's notes off the story? Options:
   - show streamed text as story only after a structural point (for example the delivery floor's length), which costs a
     little first-character time;
   - prompt the Keeper never to write text beside rolls and reads;
   - have Jev judge a finished text before it is kept.
3. Prose-first: accept the bookkeeping trade-off above (re-send and unrefusable time under the flag)?
4. Whether either branch should be merged at all, even flag-off.

## Asked earlier and never answered: not authorized

- Shorten the synchronous source-lookup wait from 8 s to about 3 s (`extensions/kernel/source-answers.ts`). The data says
  some answers arrive in 2–3 s. The user was told "你点头就做" and never nodded.
- Cut the zero-information parts of `apply` arguments (`why` everywhere, `object.definition` repeating the name, the
  opening's item-by-item registration of starting gear). This changes the tool schema and prompt, so it needs the user's
  approval first. It is the largest remaining lever.
- Prose-first "step 2": less thinking before the prose. It touches the model's thinking level; never switch or reconfigure
  models without the user's explicit go-ahead in the current turn.

## How to measure: the kit is in `experiments/first-prose-latency/`

- `run-ab.sh <worktree> <prefix> KEY=VALUE` runs four concurrent tables:
  - `<prefix>-{off,on}-{z1,j2}`, where the "on" arm gets `--env KEY=VALUE`;
  - the same 15 fixed lines per script (`player-lines-*.txt`);
  - Keeper `grok-build/grok-4.5` low, `--pregen thomas-hayes`.

  This is an A/B instrument only. Acceptance is live play, one natural line per turn after reading the prose:
  `play-turn.sh`. Never script the Keeper (CLAUDE.md, Agents.md).
- Analysis: `rolls_by_window.py` and `prose_first_by_window.py`, each run on `<worktree>/.coc/playtests/<run>/events.jsonl`.
- `preregistered.md` holds every bar written before its table, and each verdict.

**Pitfalls, each hit on 09-29:**
- **Rebuild first.** Live tables load `build/extensions/kernel/index.mjs`, not the sources. Rebuild with
  `~/.claude/skills/leehow-pc-tests/scripts/remote-test.sh build-fetch <worktree>` after every change. Heavy suites run on
  leehow-pc only (`run <worktree> ext`); the Mac runs single files.
- **Concurrent control.** Provider speed swings by the hour: on the same lines the flag-off z1 median was 58.5 s in one window
  and 30.9 s in another. Always run the control concurrently, and never compare across windows.
- **Align by window.** Attribute every row to the agent window it was appended in. A row's `turn` field is the kernel
  turn, not the agent index; keying by it shifted rows by one line and produced wrong per-turn claims.
- **Pair by line.** Estimate an effect by pairing the same player line across arms. Comparing "host-rolled turns" with
  "Keeper-rolled turns" across lines is selection bias.
- **Read the text first.** When a change decides what text reaches the player, read the delivered text before counting
  outcomes. The lead-in "2 of 2 delivered" was two notes delivered as story.
- **Mutations.** Revert them by copying the file back, never `git checkout --`.
- **Jev key.** `EXT_JEV_APIKEY` comes from the App vault (`experiments/single-loop-routing/vault.mjs`) into the process
  environment only.
- **grok-build token.** It renews only in the `auth.json` of the most recent driver run (memory
  `grok-build-token-lives-in-the-last-driver-run`).

## Worktrees and evidence (keep; delete only when the user asks)

| worktree | branch / head | what it holds |
| --- | --- | --- |
| `chatrpgv4-wt-jev-rolls-prod` | `claude/jev-rolls-prod-20260929` @ `11ea915ca` | jev-rolls v4 on current `0.9.6a`, §158.11 |
| `chatrpgv4-wt-jev-rolls` | `claude/jev-rolls-20260929` @ `6b8c8442c` | superseded by the above; tables `jr-*`…`jr4-*` in `.coc/playtests/` |
| `chatrpgv4-wt-prose-first-ui` | `claude/prose-first-ui-20260929` @ `d634a6f70` | prose-first 1b + 1c (App draft UI included); tables `g2-a-*`, `g3-a-*`, `pf1c-*`, `pf1d-*` (one turn) |
| `chatrpgv4-wt-prose-first` | `claude/prose-first-20260929` @ `f1cdbe719` | prose-first step 1 only (merged into the above) |
| `chatrpgv4-wt-admission-lat` | detached `beafa3019` | admission-latency measurement tables |

## Suggested first move

Put decisions 1–4 to the user as one short question: the verdicts above, and one line of trade-off per option. Build
nothing on either branch until they answer. If the user wants speed now rather than these two lines, the measured lever is
the Keeper's `apply` output ("Asked earlier and never answered", second item), which needs their approval.
