# Mod original-task delivery audit — 2026-10-05

## Outcome and ownership

The original §179/§183 implementation, integration, regression gate and installed-package instruction-supply checks are complete. No remaining Mod implementation defect was found in this takeover audit. The installed package is still `0eabe8f4150ac04b48d23c0d1d0f004595f896a5` / Pi 1.0.0. Natural Keeper acceptance in index mode remains unmeasured; retained local fake-provider evidence does not close it. Final-App natural notes/asker behavior has not been rerun either.

This is the independent successor to Claude **“KP需求分析与笔记内容问题”**, original session `c5f100a2-996d-43f2-a797-bce8949530cf`. It covers the original investigator-record/asker-purpose work (§179) and Mod instruction refactor (§183), including their tests and delivery evidence. It does not take over NPC first-impression, names, creature rules, literary writing, PDF reading/library publication, or packaging implementation.

Independent successor task: `01a109bd-09b1-7179-b709-5a066795b021`. Parent `01a104b9-96e3-7401-b529-ee16ec848014` explicitly confirmed ownership and permission to create this workspace on 2026-10-05. Coordinator `01a107ca-085d-761e-9493-55ebd03db00c` retains the shared LAN, natural-player and integration queue; it determines the unique App replacement owner.

| Workspace | Branch / head | Observed status and use |
| --- | --- | --- |
| Original Mod: `/Users/haoli/leehow/code/chatrpgv4-wt-mod-index` | `claude/mod-index-20261004` / `7b83acc22088bc6b3ea60c042d1ca1099f8caa4a` | Clean; retained, read only |
| Original purpose: `/Users/haoli/leehow/code/chatrpgv4-wt-player-purpose` | `claude/player-purpose-20261004` / `dafbbd0f02944dc2f483719377d0605214c0fead` | Existing untracked `.venv` retained; replay evidence read only |
| Shared main: `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2` | latest `0.9.6a` / `b674373942910bfe0661ebebb3053681a44b71cd` | Three existing WIP paths retained; not edited |
| Independent owner: `/Users/haoli/Documents/Codex/2026-10-04/task-8/mod-delivery-owned` | `codex/mod-delivery-owned-20261005`, based on exact `b67437394` | Documentation only; created through lifecycle CLI, creation `3b7efa37-5651-46c9-a71c-069644fd9bbf` |

The original Mod head is an ancestor of both the installed package source and the independent branch base. The newer shared source does not change the identity of the currently installed App. Its separate coordinator-run LAN gate is not claimed here.

## Original requested scope

The original JSONL was read directly at `/Users/haoli/.claude/projects/-Users-haoli-leehow-code-chatrpgv4-wt-pi-coc-v2/c5f100a2-996d-43f2-a797-bce8949530cf.jsonl`.

The user's original examples were notes that showed only the act of reading, and a food/lodging question answered with a shop name without a usable location or appearance. The user approved A+B on `0.9.6a`, then assigned consulting carried/known things to the base and understanding an asker's intended answer to natural-npc. The final implementation is `own` plus the base instruction to show particulars, and natural-npc's “What the asker is after”. Narration Craft was not the owner of those rules.

The subsequent Mod request was a skill-like index, Jev selecting relevant aspects, a careful package inventory, prototype measurement and tuning. After the request probe disproved the original “brief too small” premise, the user selected option **c**: whole instructions within 64 KiB, index overflow, retire the unused brief immediately. The user then explicitly approved merging (“合合”).

The original final reply at `2026-10-04T17:46:01.694Z` identified two uncompleted actions: App replacement, and a real Keeper index replay. It also explicitly stated that the latter had not been requested in that original exchange. App replacement has since been performed by the unique package owner. The live index replay remains a declared evidence limit; this audit does not invent another feature or silently change its scope to an unlimited playtest.

The optional setup “C layer” for fixing an open hook's case details was outside the approved A+B implementation. `lookup kind=mod`, Mod import/export and a shadow transition were not built under option c and are not missing deliverables of this task.

## Completed evidence

### §179: original notes and asker-purpose behavior

Retained evidence: `/Users/haoli/leehow/code/chatrpgv4-wt-player-purpose/.coc/playtests/player-purpose-20261004/{preregistration.md,results.md,out/}`, with the individual `pp-*-20261004` driver runs beside it. Contract: `docs/kernel-rpc.md` §179.

This was a sandbox replay of `game-8e41c325` turns 3–6 from its turn-2 commit, using the original player lines and `grok-build/grok-4.5` low. Baseline notes were 0/2. Final D-arm notes were 3/4 with contents, and the way/food/lodging answers 4/4. D2 delivered the word `narrate`, recorded as a failure from the separate then-open delivery defect; it is not removed from the denominator. The report also records the limits of unblinded later scoring, improvised detail, and the deleted C sandbox homes. Preserved C prose and driver runs do not recreate deleted state.

This historical replay demonstrates improvement on its exact source and locks. It does not prove final-App natural behavior after every later integration.

### §183: design, refactor and regression gate

`docs/specs/mod-section-index.md` preserves the design, tuning and held-out measurements, corrected premise, final option c and remaining live-replay limit. `experiments/mod-section-index/` retains the prototype and measurements. Contract §183 owns sections, topics, gates, byte budget, delivery and telemetry.

The original merged Mod head had ext 4540/4540 and loop 299/299. Its pytest result was 2083 pass and two known `test_jev_resolve` failures. Those old failures are not waived in the final gate: the exact installed common head subsequently passed ext 4687/4687, loop 306/306, and pytest 2085 pass / 2 skipped, all exit 0.

Authoritative retained raw logs and exact-head summaries: `/Users/haoli/leehow/code/chatrpgv4-handoff/logs/0eabe8f41/`. Electron exit 0 means parity with 194 historical failure identifiers, not 194 passing behaviors. Its original JSON and full audit remain at that log directory and `/Users/haoli/Documents/Codex/2026-10-04/task-2/electron-baseline-audit.{md,json}`; no baseline was changed by this task.

### Installed 0eabe package: identity and Mod supply

Primary records: `/Users/haoli/leehow/code/chatrpgv4-handoff/final-package-gate-20261004.md`, `logs/0eabe8f41/verify.txt`, and `/Users/haoli/Documents/Codex/2026-10-04/task-2/installed-identity-0eabe8f41.json`.

The live receipt still names exact `0eabe8f4150ac04b48d23c0d1d0f004595f896a5`, created `2026-10-04T22:14:23.078Z`; its SHA-256 still matches the retained identity report. Pi 1.0.0, runtime inventory, signature, registration and one canonical App were validated by the package owner/coordinator. This task did not rerun signing or replace the App.

This takeover re-read the installed `prompts/keeper.md`, natural-npc 1.5.0 `agent.md` / `sections.json` / `mod.json`, and product topic list; their bytes match the exact package worktree. The base instruction still names particulars, `own` and `recall transcript`. Natural-npc still carries the asker-purpose rule. The six original sectioned packages have their section declarations and no retired `brief.md`.

Recomputed directly from retained `acceptance/kernel/183-*.jsonl`:

| Boundary | Observed result |
| --- | --- |
| Default budget | Eight full instruction rows, 55,075 B within 65,536 B; no topic catalogue needed |
| Budget 1 | Seven indexed rows, zh-optimize full; 15 topics |
| Budget 40,000 | Greedy whole rows; natural-npc and story-thread indexed |
| `mods.sections` | Seven requested texts are verbatim in the installed package `agent.md` |
| Unknown section key | `invalid_params`, with `nope@1.0.0#9` in error details |

Recomputed from the retained actual host provider payloads (`acceptance/host/run-{default,budget1,3turns}/provider-requests.jsonl`): instructions agree with the kernel's selected form; `own` is present; the sent capsule omits instruction/topic catalogues; indexed briefs contain resident text without section lists. Three indexed Keeper payloads end in the section message, 15,880 / 15,299 / 15,299 B, all under 16 KiB. The two omitted sections are explicitly named. Default/three-turn whole payloads have no section tail. Runtime env records identify the installed App's node/resource root, and the retained netguard markers show no external attempt.

These host runs used a local fake provider and unavailable/late Jev fallback. They establish the installed host's supply/wire boundaries. They do not establish real Jev selection, natural Keeper adoption or literary quality, and no new fake run was started during takeover.

Read-only audit program and machine-readable evidence: `/Users/haoli/Documents/Codex/2026-10-04/task-8/audit-mod-delivery.py` and `mod-delivery-evidence-audit.json`. It reports 30 static checks, all passed, with evidence hashes and preserved-worktree observations. It never starts a model, kernel, build, test suite or App.

## Remaining acceptance and queue

| Item | Status / next dependency |
| --- | --- |
| Original Mod implementation/integration and regression responsibilities | Complete; no duplicate refactor or production candidate required |
| Installed 0eabe instruction-supply seams | Complete within the recorded deterministic/local-fake scope |
| Natural index-mode Keeper replay | Open/unmeasured. If retained as a final delivery gate, coordinator must schedule it against the accepted installed package and original model/budget through the standard driver. Forced low budget, real topic selection and actual prose must be evidenced; fake fallback cannot close it. |
| Final-App natural notes/asker-purpose behavior | Historical replay passed with stated limits; final-App rerun unperformed. It can be observed on an authorized natural-player queue without assigning a new full-project task to the literary owner. |
| PDF reading lane / new package | Other original owner. No new table that can start shared reading while the coordinator holds the cost/package gate. Await unique package signal, then rebind affected evidence rather than repeat unrelated passed work. |

No new paid budget was assumed. No new player sentence, model request, LAN suite, build or package was started. No source or WIP of another owner was changed. No external push or branch deletion occurred. This independent session and the original worktrees/evidence are retained.
