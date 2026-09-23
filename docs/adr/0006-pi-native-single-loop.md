# 0006. Pi is consumed from a vendored source snapshot and patched for the single loop

- Status: **Proposed** (2026-09-23, SL-00 of `docs/specs/pi-native-single-loop.md`)
- Track: pi-coc, Pi-native single loop
- Supersedes: the consequence of [ADR-0002](0002-pi-agent-loop-graph-replan.md) ("对 Pi 不 fork、不打补丁") and the
  "we do not fork or patch Pi" clause of `docs/pi-host-contract.md` (the opening paragraph and the 2026-09-22 Pi 0.87
  compatibility decisions under §7), for the single-loop engine.

## Context

The owner's decision (spec, 2026-09-23) is to change Pi's execution loop instead of wrapping it: one RunDriver per
player input picks each step — Jev decision, LLM inference, host operation, scope, wait, finish — and an LLM request
is no longer the mandatory entry of every iteration. That cannot be done through Pi's public surface in 0.87.0
(SL-00 inventory §8):

- `runLoop` (agent-core `agent-loop.ts` 162–320) calls `streamAssistantResponse` on every inner iteration; the
  0.86/0.87 hooks `prepareRequest`, `prepareNextTurn` and `finishTurn` can change context, model and thinking or buy
  one more context-only request, but none can run a non-model step in place of the request.
- `AgentSession._runAgentPrompt` (coding-agent `agent-session.ts` 1468–1490) still re-enters the loop with
  `agent.continue()` after `_handlePostAgentRun` (retry, overflow compaction, queued messages) and, new in 0.87, after
  the `agent_before_settle` boundary. A driver in agent-core alone would be restarted by the session layer.
- `SessionManager` is canonical for request context (`_installAgentRequestProjection` 608–633), and `AgentEvent`
  has no run or step identity; the events the host, UI and play driver consume (inventory §6) are model-message events.

Two facts decide how the source is held:

- The npm packages publish `dist` only (`files: ["dist", …]`), but every `dist/*.js` ships a source map whose
  `sourcesContent` embeds the complete TypeScript source. The published build is therefore checkable against a
  source tree byte for byte.
- The upstream repository is reachable and tagged: `github.com/earendil-works/pi`, `v0.87.0` →
  `16787ad5b2dc748047f314ca1bfe7708f30f54f3` (lightweight tag, `git ls-remote`, 2026-09-23). License MIT.

## Decision

1. **One build authority: `vendor/pi/`**, a reviewable source snapshot of `earendil-works/pi` at `v0.87.0`
   (`16787ad5…`), holding the packages the product loads (`packages/agent`, `packages/coding-agent`, `packages/ai` and
   the workspace pieces their build needs), with `UPSTREAM.md` (repository, tag, commit, date, license, the list of
   vendored paths) and the upstream `LICENSE`.
2. **Patches live beside it as an ordered series** (`vendor/pi/patches/NNNN-*.patch`, `git format-patch` form), each
   with the SL stage that owns it. The vendored tree in the repository is upstream plus the series applied; a
   script re-derives it from the tag and the series and fails if the result differs from what is committed.
3. **Admission check before any patch lands:** the unpatched snapshot must reproduce the published 0.87.0 — every
   `sourcesContent` in the installed `dist/*.js.map` of `pi-agent-core`, `pi-ai` and `pi-coding-agent` equals the
   vendored `src/` file it names. A snapshot that fails this is not 0.87.0.
4. **One copy loaded.** The root production dependency, `pipicoc/runtime-dependencies.json`, the packaged runtime and
   `Electron/packages/pi-backend` (which loads `SessionManager` and `ModelRuntime` in-process) all resolve to the
   package built from `vendor/pi/`. A test asserts that exactly one `pi-agent-core` and one `pi-coding-agent`
   resolve from every entry that loads Pi (Keeper launch, reader children, pi-backend). Stock and patched never load
   together; `node_modules` is never edited by hand.
5. **The startup record names the engine**: Pi base tag and commit, patch-series digest, loop protocol version
   (spec, user story 35).
6. Nothing is vendored in SL-00. SL-01 performs the first import under this ADR.

## Alternatives rejected

- **A controlled fork at a fixed commit** (a repository of our own, consumed as a git dependency or a republished
  package). It gives native git rebase, but it puts the review surface in a second repository, needs hosting,
  credentials and a publish or install-time build for every change, and lets the product commit and the Pi commit
  drift apart. The vendored series keeps the patch in the same commit as the product change that needs it, and the
  re-derivation script (decision 2) recovers the rebase workflow with `git am` against a fresh upstream checkout.
- **Recovering the source from the npm source maps** instead of the tag. The maps carry the sources but not the build
  configuration, tests or workspace metadata needed to rebuild; they serve as the admission check (decision 3), not
  as the snapshot.
- **Patching `node_modules` (`patch-package`) on the published `dist`.** Patches compiled JS that cannot be reviewed
  as source, and edits `node_modules`, which the design (§12.1) rules out.
- **Staying unpatched and routing inside today's hooks** (the "stage one" the spec lists as out of scope): the owner
  set it aside; a hook cannot run a step instead of the request, and the session layer's `continue()` sites stay.

## Consequences

- ADR-0002's consequence "对 Pi 不 fork、不打补丁；依赖以文档契约表达" and the host contract's "我们不 fork Pi，也不打补丁" /
  "Do not fork or patch Pi" no longer hold for the single-loop engine. The host contract keeps describing the
  interfaces we depend on; its statements about `_runAgentPrompt`, `agent_settled` and event shapes become statements
  about the patched build once SL-01 lands.
- **Upgrade procedure** replaces "change a version number, then walk host contract §7": import the new upstream tag
  into `vendor/pi/`, pass the admission check against that version's published `dist`, **rebase the patch series**
  (`git am` against the new tag; conflicts resolved in the patches, not in the vendored tree), rebuild, then the
  existing §7 checks (extension suite, driver tests, real Keeper/setup/reader smoke) plus the single-loop architecture
  assertions and the paired measurement of `docs/specs/pi-native-single-loop-tickets/baseline-SL-00.md` §7.
  `v0.87.1` already exists upstream; it is not taken until the series is rebased onto it this way.
- The repository grows by the vendored packages' source; builds need the upstream toolchain for those packages. The
  packaging step builds Pi from `vendor/pi/` once per product build.
- `PI_COC_LOOP_ENGINE=legacy` runs the patched build with the legacy policy, never a stock copy beside it
  (decision 4); the control arm of a paired measurement is a build of the base commit, not a second Pi in one install.
- Upstream requests in host contract §6 remain worth filing; each one accepted upstream is a patch removed from the
  series.
