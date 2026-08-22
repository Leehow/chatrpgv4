# Pi-Coc system regressions and repository health

Status: **Proposed**

Implementation track: **`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`**

Baseline reviewed: `79b011d5b227` on 2026-08-22

Scope owner: Pi-Coc host, its Web/Electron UI, and the canonical
`plugins/coc-keeper/` product

## 1. User job and success condition

The user is trying to restore trustworthy normal play after a partial feature
deletion exposed drift between the canonical toolbox, Pi policy, Web
projections, Keeper instructions, and tests; remove one existing source of
fabricated player-visible mechanics; make language and filesystem behavior
honest; and stop local evidence/build output from making the repository unsafe
to operate.

Success looks like:

- every live canonical toolbox operation intended for Pi is discoverable and
  executable through the correct Pi domain/typed-tool surface;
- cash grants, queries, and spending work in ordinary Pi-Coc play and produce
  the existing player-visible authoritative cash receipt;
- a delivered handout travels through one complete canonical chain from module
  evidence to state, Pi, server projection, SSE, narration, and the Materials
  panel;
- PDF-extracted player-safe images and source-backed `read_aloud` cards appear
  through that same canonical delivery chain when the live Keeper judges the
  current fiction has reached their structured delivery condition;
- a player-safe map appears only through a delivered `kind: "map"` handout;
  Keeper-only `scene.map` / map-supply assets never leak into the player UI;
- each image, information card, and map is automatically presented at most
  once per table delivery identity and survives refresh; it is presented again
  only after an explicit player request, while an ambiguous possible request
  is clarified semantically by the Keeper instead of guessed by keywords;
- unknown or custom item labels never acquire invented weapon mechanics;
- every narration contract identifies the campaign's actual `play_language`
  and does not claim a deterministic language guard it does not implement;
- static serving cannot escape `web/frontend/dist` through encoded traversal,
  sibling-prefix collisions, absolute paths, or symlinks;
- generated playtest evidence remains on disk but cannot be swept into a commit
  by `git add -A`;
- large-file and worktree debt is reduced through bounded, recoverable phases,
  without deleting playtest evidence or mixing refactors into urgent fixes.

Hollow delivery would be:

- restoring names in one registry while Pi still rejects or hides the tools;
- deleting the frontend handout promise instead of repairing the existing
  product capability;
- replacing the rifle fallback with another label/keyword guessing table;
- returning `language: en-US` around Chinese-only checks and calling that
  localization;
- changing one `startsWith` expression without encoded-path and symlink tests;
- deleting `artifacts/`, `.tmp/`, campaigns, logs, worktrees, or branches to
  make status output look clean;
- splitting large files by line count while preserving the same shallow,
  duplicated interfaces;
- reporting source or unit-test success as real Pi-Coc acceptance.

## 2. Authority, scope, and execution boundary

This document specifies the intended remediation. It does not itself authorize
implementation, destructive repository cleanup, branch/worktree deletion,
push, deployment, packaging, App launch, or removal of evidence.

The selected implementation track is Pi-Coc. Codex-host implementation,
adapters, prompts, launchers, tests, and documentation are off-limits.

Several required files are shared kernel/contract/skill files, including:

- `plugins/coc-keeper/scripts/coc_toolbox.py`
- `plugins/coc-keeper/scripts/coc_operation_policy.py`
- `plugins/coc-keeper/scripts/coc_turn_finalization.py`
- `plugins/coc-keeper/references/mcp-operation-contracts.json`
- `plugins/coc-keeper/skills/**`

Future implementation must name the exact shared files it needs and receive
the repository-required shared-scope authorization before editing them.

Current untracked playtest evidence and unrelated dirty files are user-owned or
concurrent work. They must not be staged, rewritten, cleaned, relocated, or
absorbed by this work.

## 3. Verified baseline and revalidation rule

At baseline `79b011d5b227`, focused probes established:

| Finding | Baseline signal |
| --- | --- |
| Pi operation drift | canonical toolbox 123 operations; Pi policy 120; missing `state.cash_grant`, `state.cash_query`, `state.cash_spend` |
| Pi cash rejection | all three operations return `unknown_operation` through `evaluateExecuteAcl` and are absent from the `coc_state` enum |
| Handout split | `node --test web/server-node/test/handout-projections.test.mjs` fails at import; frontend Materials/SSE code remains |
| Weapon fabrication | unknown labels such as 铁锹, crowbar, and a rusty pipe project `2D6+4`, `Firearms (rifle)`, range `110`, source `fallback` |
| Language mismatch | an `en-US` campaign receives a `zh-Hans` narration style contract |
| Static path escape | encoded `..%2f` can resolve to a sibling `dist-foo` path that passes the prefix check |
| Ignore drift | `artifacts/`, `.playwright-cli/`, `driver.pid`, and GUI screenshots are unignored; `.tmp/` is protected only by local `.git/info/exclude` |
| Repository topology | 30 worktrees, 46 local branches, large retained evidence/build directories, and two exceptionally large composition files |

The repository changed concurrently during diagnosis. Therefore every
implementation lane must rerun the focused baseline probe for its workstream
from its own exact starting commit. An already-green item becomes
`already_resolved` and is verified, not reimplemented.

Whole-suite pytest runs must not overlap in one checkout. A lane either waits
for the existing run to terminate or uses an isolated task-owned worktree and
independent temporary roots.

## 4. Product and module design

The repair deepens existing modules and seams. It must not add a second toolbox,
second handout engine, second inventory model, host-specific COC plugin, or
parallel Keeper runtime.

### 4.1 Canonical operation contract module

The canonical operation interface is the registered `coc_toolbox.TOOLS`
surface plus its structured operation policy. The MCP archive and Pi surfaces
are projections of that interface, not independently edited registries.

Required invariant:

```text
canonical live operations
  == MCP archive operations
  == Pi OPERATION_POLICY operations
  == union of Pi domain-surface operation enums
  == union of generated typed operations
```

Intentional host-private, source-worker, audit, or `kp_surface: none`
operations remain in the canonical/archive sets but are excluded only by
explicit structured policy, never by an accidental missing key.

The implementation may keep `operation-policy.ts` as a checked-in generated
artifact or derive the Pi projection from the committed MCP archive at load
time. Either choice must satisfy:

- one canonical source of operation names and policy;
- deterministic generation/loading;
- a stale-artifact check;
- exact full-set comparison in both directions;
- no hand-maintained second allowlist for ordinary live operations.

The interface is deep because callers learn one operation contract while
policy, typed-tool naming, domain grouping, role filtering, and schema
projection remain implementation details.

### 4.2 Handout delivery module

Handout delivery remains an existing product capability and is restored
end-to-end. The external Keeper interface stays small:

- `clues.query` discovers keeper-side handout candidates without leaking
  undelivered content;
- `state.deliver_handout` performs the idempotent authoritative delivery write;
- `state.record_clue` may atomically deliver its explicitly linked handout;
- player projections expose delivered, player-visible cards only.

The implementation owns:

- module/opening card materialization;
- source and asset-root confinement;
- delivery idempotency and evidence;
- player/keeper secrecy projection;
- Web state projection;
- asset URL authorization;
- initial session replay;
- per-session SSE delivery without duplication;
- Materials panel and inline narration rendering.

The frontend must not invent delivery state. The server must not infer delivery
from an available asset. `delivered_handout_ids` in canonical campaign state is
the authority.

Restoration must update the toolbox, operation archive, Pi policy/typed tools,
skills, references, Web projections/server routes/SSE, frontend types and
handlers, and tests as one vertical slice.

### 4.3 Weapon mechanics projection module

The player projection may display mechanics only from authoritative structured
data:

1. explicit complete mechanics already attached to the inventory/sheet row;
2. an exact stable `weapon_id` found in the active ruleset catalog;
3. an exact stable `weapon_id` found in a source-bound module preset.

Labels are display text. They are not a weapon classifier and must not select
damage, skill, ammo, range, class, or catalog identity.

Remove:

- `_CLASS_ALIASES` semantic classification;
- unknown-to-rifle defaulting;
- bidirectional substring matching as mechanics authority;
- the Carcano/卡卡诺 module-specific exception in generic runtime;
- all same-name fabricated fields.

For a row without authoritative mechanics, preserve the label and stable item
identity, leave unknown mechanical fields absent, and publish:

```json
{
  "params_source": "unresolved",
  "mechanics_available": false
}
```

For a resolved row:

```json
{
  "params_source": "explicit | ruleset_catalog | module_preset",
  "mechanics_available": true
}
```

These fields exist only if the player-facing UI consumes them. The Materials /
Items panel renders unresolved mechanics as a neutral localized
“mechanics unavailable” state; it never substitutes zeros, a generic weapon,
or a hidden tooltip that still leaves fabricated primary fields visible.

Known name-only content must be repaired at its ingress by storing the stable
`weapon_id`. The projection is not allowed to recover missing semantics from
prose.

### 4.4 Player-language narration contract

`narration.brief` passes `_campaign_play_language(ctx)` to
`player_facing_style_contract`.

The returned contract always reports the exact requested language. Its
deterministic coverage is explicit:

- `zh-Hans`: current Chinese surface checks may run as non-authoritative smoke
  alarms;
- other languages: no Chinese pattern is applied and the contract declares
  `deterministic_guard: unavailable`;
- every language retains language-neutral semantic responsibilities such as
  player agency, authoritative number preservation, repetition control, and
  observable-world narration.

Do not create English, Japanese, or other keyword lists merely to make a test
green. Prose meaning remains the live Keeper's semantic responsibility.

### 4.5 Static-file confinement module

Static serving accepts a URL-derived path only when the final filesystem target
is a readable file inside the canonical real path of `DIST_DIR`.

Required algorithm:

1. decode the URL exactly once using the existing router contract;
2. resolve the lexical candidate under the resolved distribution root;
3. compute `path.relative(root, candidate)`;
4. reject an absolute relative result, `..`, or any result beginning with
   `.. + path.sep`;
5. for an existing candidate, resolve both root and candidate with
   `fs.realpathSync` and repeat the containment check to reject symlink escape;
6. apply the SPA fallback only after the requested path has passed confinement;
7. keep API routes outside the static fallback.

Node documents `path.relative(from, to)` as the relative path between resolved
locations, which provides a path-segment-aware test instead of string-prefix
comparison. MITRE classifies failure to keep an externally influenced path
under its restricted parent as CWE-22.

References:

- https://nodejs.org/api/path.html#pathrelativefrom-to
- https://cwe.mitre.org/data/definitions/22.html

### 4.6 Repository hygiene and evidence retention

Shared generated paths belong in the committed root `.gitignore`, not only a
developer's `.git/info/exclude`. Git's official documentation distinguishes
version-controlled project-wide patterns from repository-local personal
excludes:

- https://git-scm.com/docs/gitignore

Add exact root-scoped patterns for:

```gitignore
/artifacts/
/.tmp/
/.playwright-cli/
/driver.pid
/gui-test-screenshots/*.png
```

Before applying a pattern, inventory tracked files beneath that path. Existing
tracked fixtures remain tracked; this work does not use `git rm`.

Ignoring evidence is not deleting evidence. Campaigns, logs, transcripts,
reports, module assets, and current artifacts remain physically intact.

Add a staging guard suitable for local/CI use that fails when a proposed index
contains:

- files under the ignored evidence roots;
- a single unexpectedly large new blob;
- generated App/build payloads outside the documented package process.

The guard reports exact paths and sizes. It does not modify the index.

### 4.7 Large-file deepening program

Line count is only a locator for possible ownership and locality problems. It
is not a limit, quality rule, or reason to split a file. A coherent module may
legitimately exceed 400 lines; a much smaller file may still mix unrelated
responsibilities. No broad split is part of the urgent regression lane.

After functional repair and acceptance, run two separate behavior-preserving
deepening efforts:

A split is justified when the current file contains two or more logic units
with distinct:

- reasons to change;
- authoritative state or lifecycle ownership;
- dependency clusters;
- invariants and error modes;
- test surfaces;
- likely implementation owners.

### 4.8 Source-backed visual, read-aloud, and map presentation

PDF extraction remains external to the repository and must produce the
versioned source-bundle evidence contract. Repository code consumes only
validated page Markdown, bounded assets, hashes, review evidence, and deep
entity packs. It must not add a PDF parser or reopen source pages during a live
turn.

Player presentation uses one canonical card contract:

- `kind: "document"` for source-backed textual or image-bearing documents;
- `kind: "read_aloud"` for verbatim player-facing passages;
- `kind: "map"` for player-safe maps whose `image_ref` is confined to the
  campaign handout root or its bound module-assets root.

`delivered_handout_ids` remains delivery authority. Asset availability,
`clue_refs`, `maps_ref`, a Keeper-only `scene.map` result, or a PDF image alone
must never make a player card visible. The initial delivery may be linked
atomically to an earned clue or explicitly written through
`state.deliver_handout` before narration.

Automatic presentation is exactly once per table delivery identity. Session
hydration restores the Materials card without creating another inline event.
An explicit player request may present the already delivered card again without
creating a second delivery or state mutation. Whether a free-form player line
is such a request is Keeper semantic judgment; code must not classify it by
keywords, regexes, or phrase lists. When the request is genuinely ambiguous,
the Keeper asks which card/image/map the player wants to see before replaying
anything.

The new seams should let independent agents own disjoint behavior without
editing the same composition file for ordinary changes. Each extracted module
must expose a small interface, hide its internal sequencing/state, and be
testable through the same interface used by production callers.

Do not split merely to reduce line count, create one-function pass-through
files, scatter shared mutable state, or move code while leaving every feature
change dependent on edits to the original hotspot.

#### `coc_toolbox.py`

Keep its external CLI, `TOOLS` registry, envelope, and lock/dispatch behavior
stable. Move cohesive implementations behind deep domain modules only where
the deletion test proves leverage. Candidate domains are operation contract
projection, narration contracts, finance state, handout delivery, and
source/module projection.

Tests call the same public operation interface as real hosts. They must not
import newly private helpers merely to preserve line-level coverage.

#### `pi/extensions/index.ts`

Keep one Pi extension entrypoint as a composition root. Move independently
testable behavior behind existing or justified interfaces: session lifecycle,
tool registration, RPC/event routing, setup/play handoff, and host capability
wiring.

Do not create files that only re-export one function or mirror the old
entrypoint's global state. A proposed module is accepted only when deleting it
would force behavior and invariants back into multiple callers.

The goals are logical locality, testability, and lower multi-agent edit
contention. There is no numeric file-size acceptance target. The unqualified
`113 / 284` snapshot may help rank inspection candidates, but it is not an
acceptance criterion.

### 4.8 Worktree, branch, and disk lifecycle

Repository topology cleanup is a separate operational phase.

1. Inventory every registered worktree with path, branch/detached state, HEAD,
   dirt, running processes, lock/prunable state, and ancestry.
2. Classify each as user-owned, current-task-owned, product-runtime-owned,
   historical evidence, or identity-unproven.
3. Use the canonical Codex worktree lifecycle only for worktrees created by the
   remediation task.
4. Never adopt or delete pre-existing worktrees/branches to satisfy a count.
5. Present exact deletion/archive candidates for explicit user authorization.
6. Archive recoverably before any authorized removal.
7. Do not delete `.pi`, `.tmp`, `artifacts`, campaign state, module assets,
   logs, or reports merely to recover disk.

Disk usage is reported by category with a dated snapshot. Storage reduction is
successful only when the retained evidence set and recovery path are explicit.

## 5. Workstreams and dependency order

### R0 — Freeze and baseline

- wait for or isolate from every running whole-suite test;
- record exact branch/HEAD/status/worktree topology;
- run the focused probes from section 3;
- identify ownership of overlapping files;
- stop on a dirty ownership conflict.

### R1 — Restore canonical cash operations

- restore all three operations to the Pi policy/domain/typed surfaces;
- keep canonical toolbox arithmetic and finalization projection unchanged;
- add full operation-set parity;
- verify grant, query, spend, and player-visible cash receipt.

R1 is first because it is a live regression, has a narrow deterministic fix,
and requires no product decision.

### R2 — Restore handout delivery vertically

- restore the canonical operation and delivery state;
- restore candidate and player projections;
- restore asset authorization route and SSE/session replay;
- retain the existing frontend Materials and inline-card UI;
- align all skills/references/tests;
- verify secrecy, idempotency, refresh, and duplicate suppression.

R2 follows R1 and must be one accepted vertical slice. Partial backend-only or
frontend-only delivery is invalid.

### R3 — Eliminate fabricated weapon mechanics

- remove heuristic/default resolution;
- repair stable IDs at known ingress paths;
- expose and render unresolved state;
- verify known exact IDs and true unknown labels.

### R4 — Correct language truthfulness

- pass campaign language;
- declare deterministic guard coverage honestly;
- add non-Chinese tests without new keyword matchers.

### R5 — Confine static files

- introduce one reusable path-containment helper at the static-serving seam;
- cover encoded traversal, sibling prefix, absolute paths, and symlinks;
- retain SPA behavior for legitimate in-root paths.

### R6 — Commit-safe repository hygiene

- add project-wide ignore patterns;
- add a read-only staging guard;
- prove evidence remains present and untracked.

### R7 — Deepen hotspots

- run only after R1–R6 are green;
- use separate scoped commits/worktrees for Python and TypeScript;
- map logic units and dependency/state ownership before proposing file moves;
- choose seams that give concurrent agents disjoint ordinary edit surfaces;
- preserve interfaces and observable behavior.

### R8 — Inventory and propose lifecycle cleanup

- produce the non-destructive inventory and candidate list;
- execute no deletion without a later exact authorization.

## 6. Acceptance ledger

| ID | Requirement | Evidence |
| --- | --- | --- |
| A1 | Toolbox, archive, Pi policy, domain enums, and typed tools have exact policy-consistent operation coverage | deterministic full-set test plus archive check |
| A2 | `state.cash_grant/query/spend` execute through Pi in `live_turn` | Pi ACL/typed-tool integration test |
| A3 | Cash change appears once from authoritative finalization evidence | projection test and real Pi-Coc turn |
| A4 | `state.deliver_handout` is discoverable, idempotent, and secrecy-safe | toolbox/Pi tests |
| A5 | Delivered card survives refresh and appears in Materials and inline narration once | server/SSE/browser test |
| A6 | Undelivered or `player_visible:false` card body/asset is unreachable | negative projection and HTTP tests |
| A7 | True unknown labels have no damage, firearm skill, ammo, or range | projection regression test |
| A8 | Known stable weapon IDs preserve exact catalog/module mechanics | ruleset/module tests |
| A9 | UI visibly distinguishes unresolved mechanics | browser/component test |
| A10 | `en-US` and `ja-JP` campaigns receive matching contract language | toolbox tests |
| A11 | Non-Chinese contracts do not claim Chinese deterministic coverage | contract assertion |
| A12 | Encoded traversal, sibling prefix, absolute, and symlink escapes return 403 | Node HTTP tests |
| A13 | Valid in-root assets and SPA fallback still work | Node HTTP tests |
| A14 | Evidence/scratch paths are ignored in a fresh clone-equivalent check | `git check-ignore -v` |
| A15 | Existing evidence remains physically present and no tracked file is removed | before/after inventory |
| A16 | Hotspot refactors preserve canonical interfaces and behavior while giving distinct logic units disjoint ownership/edit surfaces; no line-count threshold is used | module ownership map, focused/full tests, and independent-lane edit review |
| A17 | Worktree/branch inventory is complete and no unowned target is deleted | signed inventory report |

## 7. Validation plan

### V0 — Red-capable focused probes

Run and retain exact output for:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py list
node --test web/server-node/test/handout-projections.test.mjs
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/test_weapon_display_projection.py -q -p no:cacheprovider
```

Add direct scripts/tests for Pi ACL full-set parity, non-Chinese
`narration.brief`, encoded traversal, and ignore status.

### V1 — Deterministic repair suites

At minimum:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
  tests/test_operation_policy.py \
  tests/test_pi_package.py \
  tests/test_handout_deliver.py \
  tests/test_weapon_display_projection.py \
  tests/test_narration_style.py \
  tests/test_toolbox.py \
  -q -p no:cacheprovider

node --test web/server-node/test/*.test.mjs
```

Run the repository's operation archive `check` command and the Pi
domain/typed-tool Node suites discovered from current package scripts.

### V2 — Product contract gate

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
  tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Run the complete Python and Node suites once, serially, from the accepted
integration commit. A concurrent or pre-integration run is diagnostic only.

### V3 — Real Pi-Coc acceptance

Use a fresh campaign and the canonical `pi-coc --mode rpc` flow with the
configured/verified Keeper model. Cover naturally:

- a cash grant, query, and spend with visible authoritative receipt;
- a discovered and delivered handout, browser refresh, Materials lookup, and
  inline-card deduplication;
- a known stable-ID weapon and a true unknown custom item;
- a non-`zh-Hans` campaign narration brief and player-visible turn;
- preserved campaign state, logs, transcript, tool calls, and report evidence.

Do not script a canned player or claim acceptance from direct toolbox calls.

### V4 — Canonical Web/Electron UI

Because R2 and R3 change player-visible UI data, build with the project-defined
non-indexed paths and stable signing rules, then verify the exact canonical App
or canonical Web host. Source, Node tests, package validation, and live UI are
reported as separate gates.

## 8. Commit and integration shape

Use small scoped commits in this order:

1. operation parity and cash;
2. handout vertical restoration;
3. weapon authority and unresolved UI;
4. language contract;
5. static confinement;
6. ignore/staging hygiene;
7. Python hotspot deepening;
8. TypeScript hotspot deepening;
9. authorized lifecycle actions, if any.

Do not combine R1/R2 with hotspot refactors. Do not stage with `git add -A`.
Every commit stages exact files, records its focused validation, and preserves
unrelated dirt.

## 9. Stop and escalation conditions

Stop before implementation or integration when:

- the current file owner or concurrent writer is unknown;
- the exact Pi-Coc/shared-scope authorization is missing;
- restoring handouts requires changing the opposite Codex track;
- a proposed weapon resolution still derives mechanics from display prose;
- a non-Chinese guard proposal adds keyword semantics;
- static confinement cannot prove behavior for symlinks or encoded separators;
- a test needs existing evidence/campaign deletion;
- worktree/branch cleanup lacks exact current-turn authorization;
- full validation is ambiguous because concurrent suites share a checkout;
- implementation expands into migration, deployment, push, or unrelated
  architecture work.

## 10. Done definition

The remediation is done only when A1–A17 are classified `Done` with the named
evidence, every current-task worktree is lifecycle-classified, full validation
runs from the accepted integration commit, and real Pi-Coc/Web acceptance
proves the repaired player workflows.

A spec, green component tests, an ignored directory, a smaller file, or a clean
`git status` is never sufficient by itself.
