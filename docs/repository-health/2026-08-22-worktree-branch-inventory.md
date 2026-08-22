# Repository lifecycle inventory — 2026-08-22

Status: point-in-time, read-only inventory

Active implementation track: `pi-coc`

Opposite track: Codex-host, off-limits
Work ID: `pi-coc-system-regressions-20260822`

## Scope and snapshot contract

This report inventories Git/worktree lifecycle state and disk/evidence metadata.
It does not inspect campaign contents, mutate evidence, remove worktrees or
branches, clean files, stash changes, or adopt pre-existing worktrees.

The Git topology snapshot ran from `2026-08-22T08:12:12-0400` through
`2026-08-22T08:12:21-0400`. It is intentionally identified as a time window,
not an atomic transaction: concurrent Pi/Claude/Codex activity changed the
repository during the audit. Between activation and the final topology
snapshot, the registered-worktree count increased from 38 to 41 and the
primary `0.6.1a` HEAD advanced from `79b011d5b227` to `2d8b34e8e9e1`.
Therefore every cleanup proposal below requires a fresh lifecycle audit and
process/dirty-state recheck immediately before action.

Reference objects at the final snapshot:

- Integration: `codex/pi-coc-system-regressions-20260822-integration` at
  `c0d7d70776a7f42dfbf1113485e719932304d394`.
- Main: `main` at `3297356bb603d10f00e5280370bdd05f8f63d6b1`.
- Primary development tip: the primary checkout's `0.6.1a` at
  `2d8b34e8e9e1efdcd5e9cffc60c8a40bce5b6f14`.
- `+A/-B` means the inspected HEAD has A commits not in the named reference
  and lacks B commits present in that reference (`git rev-list
  --left-right --count <reference>...<head>`).
- Dirty `T:U:I:W` means total status rows, untracked rows, index-changed rows,
  and worktree-changed rows from `git status --porcelain=v1 -uall`.

## Executive findings

- 41 registered worktrees: 25 detached, 17 dirty, 0 locked, 0 prunable.
- 31 local branches and 10 remote-tracking refs.
- At the snapshot, `main` was an ancestor of primary `0.6.1a`, which was 469
  commits ahead. This is a live, fast-moving checkout rather than a stable
  cleanup target.
- Four current-task worktrees remained registered; the canonical lifecycle
  audit reported integration/inventory/registry active, weapon terminal, and
  the former static lane already closed. The registry lane was dirty because
  its implementation worker was active.
- The primary checkout had three user-owned doc changes (one tracked
  modification and two untracked documents). They are not cleanup candidates.
- Four prior lifecycle-owned worktrees remained registered. Two were clean and
  ancestral to the current integration ref; two contained 11 and 181 untracked
  rows respectively and must be retained.
- Product-runtime paths under `.pi/worktrees/` include both clean unique commits
  and dirty uncommitted evidence. Path ownership is recognizable, but task
  identity is not proven by the Codex lifecycle manifests; none may be adopted
  or deleted by this task.
- `.gitignore` now protects new root `artifacts/`, `.tmp/`,
  `.playwright-cli/`, `driver.pid`, and `gui-test-screenshots/*.png` entries.
  Existing tracked evidence remains tracked: 26 `artifacts/**` files and 31
  screenshot PNGs. Ignore rules do not untrack them.

## Registered worktrees

Every row had `locked=no` and `prunable=no` in the final porcelain snapshot.
Classifications are ownership/risk labels, not deletion authority. Dirty
product-runtime rows are also historical evidence because their uncommitted
state may be unique.

| Exact path | Branch/state | HEAD | Dirty T:U:I:W | vs integration | vs main | vs `0.6.1a` | Classification |
|---|---|---:|---:|---:|---:|---:|---|
| `/Users/haoli/leehow/code/chatrpgv4` | `0.6.1a` | `2d8b34e8e9` | 3:2:0:1 | +9/-5 | +469/-0 | +0/-0 | user-owned primary |
| `/Users/haoli/leehow/code/chatrpgv4-e2e-34b3fa9d` | `codex/pi-coc-finalization-e2e-34b3fa9d` | `34b3fa9d40` | 0:0:0:0 | +0/-31 | +434/-0 | +0/-35 | prior lifecycle; historical evidence |
| `/Users/haoli/leehow/code/chatrpgv4-e2e-494cba0f` | `codex/pi-coc-finalization-e2e-494cba0f` | `494cba0f2b` | 11:11:0:0 | +0/-30 | +435/-0 | +0/-34 | prior lifecycle; dirty historical evidence |
| `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-contracts-20260822` | `codex/pi-coc-contracts-20260822` | `096b14c3bd` | 181:181:0:0 | +0/-12 | +453/-0 | +0/-16 | prior lifecycle; dirty historical evidence |
| `/Users/haoli/leehow/code/chatrpgv4-wt-system-fixes-20260822` | `codex/pi-coc-system-fixes-20260822` | `fa85db274e` | 0:0:0:0 | +0/-27 | +438/-0 | +0/-31 | prior lifecycle; historical evidence |
| `/Users/haoli/leehow/code/chatrpgv4-wt-system-regressions-integration` | `codex/pi-coc-system-regressions-20260822-integration` | `c0d7d70776` | 0:0:0:0 | +0/-0 | +465/-0 | +5/-9 | current task |
| `/Users/haoli/leehow/code/chatrpgv4-wt-system-regressions-inventory` | `codex/pi-coc-system-regressions-20260822-inventory` | `c0d7d70776` | 0:0:0:0 | +0/-0 | +465/-0 | +5/-9 | current task |
| `/Users/haoli/leehow/code/chatrpgv4-wt-system-regressions-registry` | `codex/pi-coc-system-regressions-20260822-registry` | `fda9505741` | 10:0:0:10 | +1/-5 | +461/-0 | +1/-9 | current task; active worker |
| `/Users/haoli/leehow/code/chatrpgv4-wt-system-regressions-weapon` | `codex/pi-coc-system-regressions-20260822-weapon` | `a65791affc` | 0:0:0:0 | +2/-5 | +462/-0 | +2/-9 | current task; terminal lane, not yet integrated at snapshot |
| `/Users/haoli/leehow/code/chatrpgv4/.claude/worktrees/upbeat-tu-4e3d84` | detached | `3297356bb6` | 0:0:0:0 | +0/-465 | +0/-0 | +0/-469 | Claude runtime; owner identity unproven |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/bug-fix` | `pipiui/bug-fix` | `2fbe83fd97` | 0:0:0:0 | +1/-5 | +461/-0 | +0/-8 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/campaign-sort-impl` | detached | `836eced3c5` | 4:0:0:4 | +0/-54 | +411/-0 | +0/-58 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/clues-query-reg` | `pipiui/clues-query-reg` | `7bffa6cdda` | 0:0:0:0 | +8/-5 | +468/-0 | +0/-1 | product runtime; concurrent lane |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/finance-combine` | detached | `705c18c7ce` | 39:5:0:34 | +0/-61 | +404/-0 | +0/-65 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/finance-integration` | detached | `553de867ed` | 31:4:0:27 | +0/-65 | +400/-0 | +0/-69 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/finance-prices-v2` | detached | `553de867ed` | 8:0:8:0 | +0/-65 | +400/-0 | +0/-69 | product runtime; dirty staged evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/finance-runtime` | detached | `9b5c42e9c7` | 16:3:0:13 | +0/-69 | +396/-0 | +0/-73 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/integrate` | detached | `353709b2f9` | 0:0:0:0 | +0/-32 | +433/-0 | +0/-36 | product runtime; processes observed during scan |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/ir` | `pipiui/ir` | `c0c204b864` | 0:0:0:0 | +1/-5 | +461/-0 | +0/-8 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/kp-websearch` | detached | `c41c77ef75` | 3:1:0:2 | +0/-81 | +384/-0 | +0/-85 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/lang-core` | detached | `0ce282d59c` | 0:0:0:0 | +1/-65 | +401/-0 | +1/-69 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/lang-integrate` | detached | `8fb4d2a96c` | 16:1:0:15 | +3/-65 | +403/-0 | +3/-69 | product runtime; dirty unique evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/lang-render` | detached | `626e299a71` | 0:0:0:0 | +1/-65 | +401/-0 | +1/-69 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/logo` | detached | `a628123367` | 1:0:0:1 | +0/-53 | +412/-0 | +0/-57 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/native-search` | detached | `c41c77ef75` | 6:4:0:2 | +0/-81 | +384/-0 | +0/-85 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/ocr-token` | detached | `22c84566e1` | 0:0:0:0 | +1/-69 | +397/-0 | +1/-73 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/pdf-bundle-x` | detached | `a0fb41374e` | 5:2:0:3 | +0/-62 | +403/-0 | +0/-66 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/pi-reg` | `pipiui/pi-reg` | `d1ed4486c4` | 0:0:0:0 | +1/-5 | +461/-0 | +0/-8 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/portrait-image-api` | detached | `82feec249b` | 0:0:0:0 | +1/-62 | +404/-0 | +1/-66 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/portrait-integrate` | detached | `5305283dd1` | 0:0:0:0 | +8/-60 | +413/-0 | +8/-64 | product runtime; unique commits |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/portrait-prompt` | detached | `44fca47d1b` | 0:0:0:0 | +1/-62 | +404/-0 | +1/-66 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/portrait-state` | detached | `9bd017c9a4` | 0:0:0:0 | +1/-62 | +404/-0 | +1/-66 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/portrait-ui` | detached | `f85627eac1` | 0:0:0:0 | +7/-61 | +411/-0 | +7/-65 | product runtime; unique commits |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/search-keys` | detached | `c41c77ef75` | 3:2:0:1 | +0/-81 | +384/-0 | +0/-85 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/search-providers` | detached | `cebdc0518e` | 0:0:0:0 | +1/-69 | +397/-0 | +1/-73 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/serve` | `pipiui/serve` | `2d8b34e8e9` | 0:0:0:0 | +9/-5 | +469/-0 | +0/-0 | product runtime; concurrent lane |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/settings-shell` | detached | `c41c77ef75` | 3:1:0:2 | +0/-81 | +384/-0 | +0/-85 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/vision-settings` | detached | `c41c77ef75` | 12:2:0:10 | +0/-81 | +384/-0 | +0/-85 | product runtime; dirty evidence |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/vision-switch` | detached | `e291eda88c` | 0:0:0:0 | +1/-71 | +395/-0 | +1/-75 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/web-webcards` | `pipiui/web-webcards` | `48fa6bb0e6` | 0:0:0:0 | +1/-5 | +461/-0 | +0/-8 | product runtime; unique commit |
| `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/worktree` | `pipiui/worktree` | `79b011d5b2` | 0:0:0:0 | +0/-5 | +460/-0 | +0/-9 | product runtime; ancestor, ownership unproven |

## Branch inventory

The checked-out path is omitted as `—` when no registered worktree had that
branch attached. The same relationship notation is used as above.

| Local branch | HEAD | Checked out at | vs integration | vs main | vs `0.6.1a` | Upstream | Classification |
|---|---:|---|---:|---:|---:|---|---|
| `0.4.0a` | `9c06064f46` | — | +0/-453 | +12/-0 | +0/-457 | `origin/0.4.0a` | user release history |
| `0.4.1a` | `98293a6589` | — | +0/-451 | +14/-0 | +0/-455 | — | user release history |
| `0.4.2a` | `98293a6589` | — | +0/-451 | +14/-0 | +0/-455 | — | user release history; duplicate object with `0.4.1a` |
| `0.4.3a` | `486f0f9f37` | — | +51/-436 | +80/-0 | +51/-440 | — | user release history; divergent |
| `0.4.4a` | `9afb7827c8` | — | +0/-388 | +77/-0 | +0/-392 | `origin/0.4.4a` | user release history |
| `0.5.0a` | `a093b51fb6` | — | +0/-256 | +209/-0 | +0/-260 | `origin/0.5.0a` | user release history |
| `0.5.1a` | `f2126eb5b9` | — | +0/-223 | +242/-0 | +0/-227 | — | user release history |
| `0.5.2a` | `10659ab0f4` | — | +0/-200 | +265/-0 | +0/-204 | — | user release history |
| `0.5.3a` | `01eec8304f` | — | +0/-199 | +266/-0 | +0/-203 | — | user release history |
| `0.5.4a` | `955a7fba02` | — | +0/-185 | +280/-0 | +0/-189 | — | user release history |
| `0.5.5a` | `57c9aadfed` | — | +0/-164 | +301/-0 | +0/-168 | `origin/0.5.5a` | user release history |
| `0.6.0a` | `4c24340ddc` | — | +0/-93 | +372/-0 | +0/-97 | — | user release history |
| `0.6.1a` | `2d8b34e8e9` | `/Users/haoli/leehow/code/chatrpgv4` | +9/-5 | +469/-0 | +0/-0 | `origin/0.6.1a` | user primary/release history |
| `0.6.2a` | `3fc4bab8f2` | — | +1/-7 | +459/-0 | +1/-11 | — | user release history; divergent |
| `claude/upbeat-tu-4e3d84` | `3297356bb6` | — | +0/-465 | +0/-0 | +0/-469 | — | Claude runtime history; owner unproven |
| `codex/pi-coc-contracts-20260822` | `096b14c3bd` | `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-contracts-20260822` | +0/-12 | +453/-0 | +0/-16 | — | prior lifecycle evidence |
| `codex/pi-coc-finalization-e2e-34b3fa9d` | `34b3fa9d40` | `/Users/haoli/leehow/code/chatrpgv4-e2e-34b3fa9d` | +0/-31 | +434/-0 | +0/-35 | — | prior lifecycle evidence |
| `codex/pi-coc-finalization-e2e-494cba0f` | `494cba0f2b` | `/Users/haoli/leehow/code/chatrpgv4-e2e-494cba0f` | +0/-30 | +435/-0 | +0/-34 | — | prior lifecycle evidence |
| `codex/pi-coc-system-fixes-20260822` | `fa85db274e` | `/Users/haoli/leehow/code/chatrpgv4-wt-system-fixes-20260822` | +0/-27 | +438/-0 | +0/-31 | — | prior lifecycle evidence |
| `codex/pi-coc-system-regressions-20260822-integration` | `c0d7d70776` | `/Users/haoli/leehow/code/chatrpgv4-wt-system-regressions-integration` | +0/-0 | +465/-0 | +5/-9 | — | current task |
| `codex/pi-coc-system-regressions-20260822-inventory` | `c0d7d70776` | `/Users/haoli/leehow/code/chatrpgv4-wt-system-regressions-inventory` | +0/-0 | +465/-0 | +5/-9 | — | current task |
| `codex/pi-coc-system-regressions-20260822-registry` | `fda9505741` | `/Users/haoli/leehow/code/chatrpgv4-wt-system-regressions-registry` | +1/-5 | +461/-0 | +1/-9 | — | current task |
| `codex/pi-coc-system-regressions-20260822-weapon` | `a65791affc` | `/Users/haoli/leehow/code/chatrpgv4-wt-system-regressions-weapon` | +2/-5 | +462/-0 | +2/-9 | — | current task |
| `main` | `3297356bb6` | — | +0/-465 | +0/-0 | +0/-469 | `origin/main` | user default history |
| `pipiui/bug-fix` | `2fbe83fd97` | `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/bug-fix` | +1/-5 | +461/-0 | +0/-8 | — | product runtime |
| `pipiui/clues-query-reg` | `7bffa6cdda` | `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/clues-query-reg` | +8/-5 | +468/-0 | +0/-1 | — | product runtime |
| `pipiui/ir` | `c0c204b864` | `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/ir` | +1/-5 | +461/-0 | +0/-8 | — | product runtime |
| `pipiui/pi-reg` | `d1ed4486c4` | `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/pi-reg` | +1/-5 | +461/-0 | +0/-8 | — | product runtime |
| `pipiui/serve` | `2d8b34e8e9` | `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/serve` | +9/-5 | +469/-0 | +0/-0 | — | product runtime |
| `pipiui/web-webcards` | `48fa6bb0e6` | `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/web-webcards` | +1/-5 | +461/-0 | +0/-8 | — | product runtime |
| `pipiui/worktree` | `79b011d5b2` | `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/worktree` | +0/-5 | +460/-0 | +0/-9 | — | product runtime |

Remote-tracking refs at the same snapshot:

| Remote-tracking ref | HEAD | Local-peer relationship |
|---|---:|---|
| `origin/0.4.0a` | `9c06064f46` | local +0/-0 |
| `origin/0.4.4a` | `2bf7cf33a7` | local +7/-0 |
| `origin/0.5.0a` | `ee3027d2a0` | local +11/-0 |
| `origin/0.5.5a` | `48d26b5542` | local +19/-0 |
| `origin/0.6.1a` | `4cd379e93b` | local +11/-0 at the final primary snapshot |
| `origin/0.6.2a` | `3fc4bab8f2` | local +0/-0 |
| `origin/HEAD` | `3297356bb6` | symbolic target `origin/main` |
| `origin/codex/coc-codex-coordinator` | `d8772ceccb` | no local peer |
| `origin/codex/progressive-source-pi-grok-fixes` | `bf7f66cb5a` | no local peer |
| `origin/main` | `3297356bb6` | local +0/-0 |

## Current-task lifecycle audit

The canonical command was:

```text
/Users/haoli/.codex/scripts/codex-worktree-lifecycle audit \
  --repo /Users/haoli/leehow/code/chatrpgv4 \
  --task-id pi-coc-system-regressions-20260822
```

It returned `result=audit_pending`, `pending_count=4`:

| Lane | Manifest state/outcome | Dirty | Classification/action |
|---|---|---:|---|
| integration | active/active | no | current task; retain |
| registry | active/dirty | yes | current task worker; retain |
| weapon | terminal/terminal | no | current task; close only after accepted integration contains its commit |
| static | closed/closed | n/a | lifecycle already proved path/ref absent |
| inventory | active/active | no at audit time | current task; this report will make it dirty until committed |

No pre-existing worktree was adopted into this manifest.

## Process/cwd observations

Only process basename, PID, and cwd were read; command arguments were not
captured. At `2026-08-22T08:12:33-0400`, exact occupied cwd groups were:

- `/Users/haoli/leehow/code/chatrpgv4`: PIDs
  `1899:zsh`, `1904:disclaimer`, `1905:claude`, `7067:node`,
  `7073:node_repl`, `7326:node`, `9251:bash`, `9287:node`, `9296:uv`,
  `9301:Python`, `13905:node`, `13907:node_repl`, `14001:node`,
  `15920:bash`, `15956:node`, `15959:uv`, `15964:Python`, `16280:bash`,
  `16316:node`, `16319:uv`, `16324:Python`, `22397:node`,
  `22398:node_repl`, `22430:node`, `28813:bash`, `28815:node`,
  `28825:uv`, `28826:Python`, `30148:git`, `30154:git`,
  `31355:disclaimer`, `31356:claude`, `31365:zsh`, `44279:bash`,
  `44315:node`, `44326:uv`, `44331:Python`, `70579:node_repl`,
  `70580:node`, `70619:node`, `85891:node_repl`, `85892:node`,
  `85918:node`, `87815:node`, `87820:uv`, `87821:Python`, `93699:node`,
  `97762:node`.
- `/Users/haoli/leehow/code/chatrpgv4-wt-system-regressions-inventory`:
  `30125:zsh` (this worker's command shell).

Earlier in the same scan, processes were also observed with cwd under
`.pi/worktrees/integrate`, `.pi/worktrees/clues-query-reg`, and the current
registry lane. Their disappearance by the final process snapshot is further
evidence that process occupancy is volatile and must be re-probed before any
lifecycle action.

## Disk and evidence/ignore snapshot

Disk figures are `du -sh` point estimates; contents were not opened:

| Path/category | Size | Disposition |
|---|---:|---|
| `/Users/haoli/leehow/code/chatrpgv4` total | 11G | active primary; retain |
| primary `.git` | 883M | shared Git object/worktree metadata |
| primary `.pi` | 4.5G | product-runtime state/worktrees; retain |
| primary `.tmp` | 1.9G | 84,503 files; ignored; potential evidence, retain |
| primary `desktop` | 1.9G | product/build tree; not evaluated for deletion |
| primary `artifacts` | 20M | 34 files; evidence; retain |
| primary `gui-test-screenshots` | 22M | 31 PNGs; evidence; retain |
| `/Users/haoli/leehow/code/chatrpgv4-untracked-archive-20260822-01` | 1.2G | explicit historical archive; retain |
| `/Users/haoli/leehow/code/chatrpgv4_bak` | 953M | user backup/identity unproven; retain |
| current integration worktree | 210M | current task |
| current registry worktree | 355M | current task |
| current weapon worktree | 75M | current task |
| current inventory worktree | 64M before this report | current task |
| prior system-fixes worktree | 574M | prior lifecycle; candidate below |
| prior contracts worktree | 106M | dirty evidence; retain |
| prior E2E worktrees | 81M and 83M | one clean, one dirty |

The volume holding the repository reported 926Gi total, 676Gi used, 227Gi
available (75% used).

At this report's integration base, `.gitignore:17-22` ignores new root
`artifacts/`, `.tmp/`, `.playwright-cli/`, `driver.pid`, and screenshot PNGs.
All five `git check-ignore -v --no-index` probes matched those exact rules.
The paths still exist on disk: `driver.pid` was present, and evidence counts
above were nonzero. This is expected: ignore means “do not stage new files,”
not “delete evidence.” Also, 26 existing `artifacts/**` files and 31 screenshot
PNGs were already tracked and remain tracked.

Adjacent unregistered directories observed by name/metadata only:

| Exact path | Size/state | Classification |
|---|---|---|
| `/Users/haoli/leehow/code/chatrpgv4-e2e-system-fixes-20260822` | 2.3M; not registered; Git metadata unreadable | identity-unproven failed/stale worktree residue |
| `/Users/haoli/leehow/code/chatrpgv4-e2e-system-fixes-e057133c` | 4.2M; not registered; Git metadata unreadable | identity-unproven failed/stale worktree residue |
| `/Users/haoli/leehow/code/chatrpgv4-worktrees` | 0B, empty at snapshot | identity-unproven empty directory |
| `/Users/haoli/leehow/code/chatrpgv4-untracked-archive-20260822-01` | 1.2G | historical evidence archive |
| `/Users/haoli/leehow/code/chatrpgv4_bak` | 953M | user backup/identity unproven |

## Exact candidates and retention gates

No action was executed. “Candidate” means the read-only snapshot found enough
evidence to request owner-authorized closeout; it does not authorize deletion.

### Lifecycle closeout candidates after a fresh recheck

1. Task `pi-coc-finalization-e2e-34b3fa9d`:
   `/Users/haoli/leehow/code/chatrpgv4-e2e-34b3fa9d` and branch
   `codex/pi-coc-finalization-e2e-34b3fa9d`. Its manifest state is terminal,
   the worktree was clean and unoccupied in the final process snapshot, and
   its HEAD was an ancestor of the current integration ref (`+0/-31`). Use
   only that task's canonical lifecycle `closeout`, with a freshly accepted
   integration ref and verification gate.
2. Task `pi-coc-remaining-system-fixes-20260822`:
   `/Users/haoli/leehow/code/chatrpgv4-wt-system-fixes-20260822` and branch
   `codex/pi-coc-system-fixes-20260822`. Its manifest state is terminal, the
   worktree was clean and unoccupied, and its HEAD was ancestral to current
   integration (`+0/-27`). Apply the same exact lifecycle gate.

### Archive/review candidates requiring ownership confirmation

- `/Users/haoli/leehow/code/chatrpgv4-e2e-system-fixes-20260822` and
  `/Users/haoli/leehow/code/chatrpgv4-e2e-system-fixes-e057133c`: Git identity
  was unreadable and neither path was registered. Archive recoverably first;
  do not delete until provenance is established.
- `/Users/haoli/leehow/code/chatrpgv4-worktrees`: empty 0B directory; a narrow
  deletion candidate only after user confirmation that no external process
  expects the path.
- `/Users/haoli/leehow/code/chatrpgv4/.claude/worktrees/upbeat-tu-4e3d84` and
  branch `claude/upbeat-tu-4e3d84`: clean and based at `main`, but no current
  lifecycle manifest proves ownership. Confirm the Claude runtime/session is
  retired before any archive/removal.
- `/Users/haoli/leehow/code/chatrpgv4/.pi/worktrees/worktree` and branch
  `pipiui/worktree`: clean and ancestral to integration at the snapshot, but
  Pi runtime ownership is outside this task. Confirm the owning Pi session is
  terminal and preserve any session evidence before removal.
- Branches `0.4.1a` and `0.4.2a` point to the same object
  `98293a6589bb`. This is a release-history deduplication question, not a safe
  automatic branch deletion; require explicit release-policy/user approval.

### Mandatory retention

- The user-owned primary checkout and all three current doc changes.
- Current-task lanes until the lead integrates, validates, sets them terminal,
  and canonical closeout succeeds.
- Prior E2E `494cba0f` (11 untracked rows) and contracts worktree (181
  untracked rows).
- Every dirty `.pi/worktrees/*` row in the exhaustive table.
- Every clean `.pi` row with commits unique relative to integration (`+A` where
  A > 0), unless its product-runtime owner first archives/accepts that history.
- Any path with a live cwd, including the primary checkout; recheck because
  process occupancy changed during this scan.
- `chatrpgv4-untracked-archive-20260822-01`, `chatrpgv4_bak`, `.tmp`,
  artifacts, screenshots, campaign/runtime evidence, and all identity-unproven
  paths until their owner and recovery path are explicit.

## Validation commands

The inventory was cross-checked with:

```text
git worktree list --porcelain
git for-each-ref refs/heads refs/remotes
git status --porcelain=v1 -uall                  # once per registered worktree
git rev-list --left-right --count REF...HEAD     # integration/main/0.6.1a
lsof -n -a -d cwd -Fpcn                         # args not captured
du -sh <metadata-only paths>
git check-ignore -v --no-index <five probes>
git ls-files 'artifacts/**' '.tmp/**' 'gui-test-screenshots/*.png'
/Users/haoli/.codex/scripts/codex-worktree-lifecycle audit \
  --repo /Users/haoli/leehow/code/chatrpgv4 \
  --task-id pi-coc-system-regressions-20260822
```

Count reconciliation at the final topology snapshot passed: 41 porcelain
`worktree` records, 31 `refs/heads` records, and 10 `refs/remotes` records are
all represented above. Because the repository is concurrent, these counts are
historical evidence for the named time window, not a promise of current state.
