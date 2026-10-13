# RunDriver-owned streaming final output

Status: implementation in progress; focused acceptance passed, full regression and live acceptance pending.
Date: 2026-10-13.
Tracker label: ready-for-agent.

## Problem Statement

Players wait for the complete final-author artifact before any of its story appears.
The current optional `output` tool starts a tool-enabled Pi author, which reads a task,
writes a draft, checks it and returns a complete artifact. The App can animate that
artifact, but animation is not delivery of text while the author is generating it.
The Keeper also has to select the publishing tool and carry publication parameters
through tool retries. A failed writing or publication attempt must not replay the
already settled game action.

The owner selected the existing RunDriver as the owner of a final expression phase.
Success means actual author text reaches the App incrementally, while the existing
kernel remains authoritative for settlement and the existing publication path remains
authoritative for completed delivery and its disclosure effects. The author receives
only permitted material. Speaker rendering, mechanics cards, persistence, interruption
and the next turn's actor perspectives must work together.

A hollow delivery would rename `output`, animate a completed string, stream the front
Keeper's private reasoning, bypass publication checks, or pass unit tests without
showing that real author deltas reach the App before generation finishes.

## Solution

Use one final-output phase inside the current RunDriver run. The Keeper supplies its
finished fictional material through the existing preparation surface. After the
remaining authorized operations finish, the driver freezes that material, invokes the
existing Pi author and forwards its decoded story deltas through the current host/App
transport. The phase then commits the completed artifact through the existing
publication owner. It does not return to the Keeper for a second story response.

The product no longer advertises a separate `output` tool. Pure out-of-character
replies keep their current direct path. Mixed replies keep their OOC text separate
from the fictional author input and stream.

“Streaming” here means incremental generation throughout the chain. Providers may use
SSE; the local Pi RPC and Electron IPC transports keep their existing framing. This
feature does not add a local HTTP server merely to label the final hop SSE.

## User Stories

1. As a player, I want the story to appear while it is being generated, so that I do not wait for a completed draft to start reading.
2. As a player, I want the final reply to preserve the action I chose and its settled result, so that faster presentation does not change the game.
3. As a player, I want NPC dialogue to retain its speaker and presentation, so that I can follow conversations as text arrives.
4. As a player, I want dice and resource changes to remain dedicated UI elements, so that prose does not become a second arithmetic report.
5. As a player, I want item transfers to show the actual settled ownership and quantity, so that a streamed description does not substitute for an item transaction.
6. As a player, I want secrets excluded before the writing request starts, so that streaming cannot expose backstage information.
7. As a player, I want an interrupted reply to keep the text already shown, so that a reconnect does not silently replace what I read.
8. As a player, I want retry and reconnect to avoid repeated rolls, payments, item transfers and duplicate paragraphs, so that recovery is safe.
9. As a player, I want a saved or reopened session to show the same completed reply, speaker formatting and mechanics, so that live and historical views agree.
10. As a player, I want an unfinished reply to be identified as unfinished, so that I do not mistake it for completed narration.
11. As a player, I want a direct answer to an OOC question without starting a fictional author, so that ordinary conversation stays simple.
12. As a player, I want a mixed rules question and game action to keep their two responses distinct, so that rules commentary does not become NPC speech.
13. As the Keeper, I want to submit permitted events, consequences and speech intentions once, so that I do not copy a checked plan into another publishing tool.
14. As the Keeper, I want to check or revise a material plan without publishing it, so that preparation is not confused with handoff.
15. As the Keeper, I want the host to preserve successful settlement when writing fails, so that I can recover delivery without choosing the action again.
16. As the Keeper, I want prior interrupted text and its status visible on recovery, so that I do not act as though the player saw nothing.
17. As an NPC-state consumer, I want pending speech knowledge activated only by accepted coverage, so that intended or incomplete speech does not grant full knowledge.
18. As an author, I want a complete public packet in the initial request, so that normal writing does not require a read/write/check round trip.
19. As an author, I want canonical speaker, audience and source values resolved by their owners, so that I do not repair copied identifiers.
20. As a host maintainer, I want one driver run and one finalization owner, so that output is not a second agent loop or competing publication path.
21. As a UI maintainer, I want stable delivery identities and ordered events, so that duplicate, late and replayed messages cannot corrupt the transcript.
22. As a tester, I want real provider, host and renderer timestamps, so that I can distinguish first-text latency from completed-turn latency.
23. As a tester, I want the actual model and reasoning setting recorded for every author attempt, so that a requested profile is not mistaken for a verified profile.
24. As a maintainer, I want old saved deliveries to remain readable, so that this change does not require rewriting campaign history.

## Implementation Decisions

### 1. Extend existing owners

- Keep the current TypeScript kernel, RunDriver, final-output owner, Pi task runtime,
  publication transactions, source registry, speaker projection and App transports.
  Do not create a second engine, provider client, campaign store or task scheduler.
- The product driver schedules the final phase as a policy-origin operation inside
  the same run. The pure driver policy does no I/O. The existing operation/runtime
  boundary invokes the author and publication owners. Prefer existing driver step
  and operation types; a new generic vendor driver primitive is not required by
  this specification.
- Kernel `resolve` and `apply` still own arithmetic and state changes. Streaming has
  no authority to roll, change possessions, execute intentions or reinterpret facts.
- Amend the kernel and Pi host contracts before code changes. Explicitly supersede
  only the optional-tool/explicit-`output` requirements of the existing output
  contract and the corresponding clauses of the event specification. Preserve their
  permission, provenance, actor-cognition and transaction requirements.

### 2. An explicit handoff, without a publishing tool

- Extend the existing `narrate` material-preparation surface with a bounded
  `handoff` flag. Omitted/false retains private check-only behavior. True submits
  the final material plan to the driver; the tool itself neither starts an author
  nor publishes. Its result describes `prepared` and `handoff_requested`, not
  `delivered` or `accepted` publication.
- The normal path is one material submission with handoff requested. There is no
  mandatory preceding check and no additional Keeper inference solely to invoke
  an author or repeat the plan.
- A successful check-only call, prose-only Keeper message, inference ending, timeout,
  empty plan, or arbitrary successful `apply` does not imply handoff. Do not add a
  semantic keyword classifier to infer readiness or whether input is OOC.
- After an explicit handoff, drain preceding operations from that response, check
  their outcomes and the existing mandatory obligations, then freeze the packet.
  A state-changing proposal after the handoff in the same response is refused as
  incorrectly ordered; it is not executed after first text. A refusal or unresolved
  binding before the handoff returns to normal Keeper recovery, without an author.
- The existing `ask` path can hand over its optional fictional preface and the same
  canonical mechanical choice. A pure mechanical choice needs no author. Choice
  IDs/options remain kernel-owned and cannot be invented by the writing model.
  Existing quote/workpad/terminal metadata follows the same validated handoff, not
  a separate copied output call. An embedded `apply` delivery remains preparation
  unless an explicit final handoff follows settlement.
- An already durable pending choice remains durable if its preface fails. Preserve
  the existing ask recovery boundary; neither preface retry nor later turn closure
  may issue the choice or activate the same disclosure twice.
- Remove `output` from the current advertised tool schema and tool guidance together.
  Preserve old transcript readability. If an already-running old session submits
  `output`, a bounded compatibility adapter may translate it into the same driver
  handoff; it cannot retain a second writer or publication implementation.
- Opening narration enters the same phase through the opening owner's explicit
  handoff. The driver does not invent an opening merely because no player action
  exists. New player input or abort revokes an unstarted handoff from an older run.

### 3. Freeze the public packet before the first text delta

- Resolve source aliases, selected excerpts, public event components, required
  materials, canonical speech meanings/speakers/audiences, visible names, presentation
  guidance and publication constraints before dispatching the author.
- Continue to reject private/unclassified whole-source reuse, stale references and
  missing required material. A source name is not a disclosure grant. Hydrate only
  source fields already permitted by the existing registry.
- Preserve the existing distinction between canonical receipts, Keeper proposals
  and expression guidance. Examples do not become world facts. No private capsule,
  event summary, hidden roll, motive, unrelated knowledge or full source body is
  added to the author request to make it more convenient.
- Freeze the resolved packet and its permission/source revisions, input/run identity,
  publication target, model profile and instruction version. These form the cache
  and idempotency binding. Host identifiers are minted by the host, never the model.
- Keep the selected expression references alive through checks, handoff, generation
  and publication. A private check result must not retire the input lifetime. Release
  preparation only on actual terminal completion/abort or replacement by new input.
- Once streaming starts, this run cannot execute another game mutation. Unrelated
  sessions/worldlines are not locked. Read-only or optional background results do not
  mutate the frozen packet or trigger a rewrite. A relevant concurrent state change
  invalidates the attempt explicitly; it never silently replaces already shown text.

### 4. One normal author inference through Pi

- Reuse the existing tool-enabled Pi author and its confined task environment,
  provider resolution, cancellation and budget accounting. Supply the complete
  permitted packet in the initial request. Keep the existing task-local tools
  available under their guard; do not replace this with `runLane`, a bare provider
  completion or a new zero-tool author exception.
- Change the normal author contract from “read task, write file, run checker” to
  returning the current versioned artifact in its assistant content. The artifact
  places the story `text` before the trailing `coverage` declaration. The host
  incrementally decodes only that story field and validates the completed artifact.
  Task/draft/evidence files remain host-written diagnostic artifacts, not mandatory
  model work.
- Normal successful delivery uses one author inference and zero author tool calls.
  This is an observable acceptance target, not permission to hide retries. Record
  all provider attempts and any optional tool use. A bounded pre-text failure may
  retry under the existing budget. Once text has been exposed, no automatic new
  attempt may regenerate its prefix.
- Do not forward arbitrary author messages. Only the selected artifact's decoded
  `text` field is eligible. Reasoning, tool arguments/results, coverage JSON and
  protocol delimiters remain private. A tool proposal or competing message after
  exposure interrupts that attempt rather than starting another writing loop.
- The incremental decoder is a bounded protocol parser, not a semantic classifier.
  It must handle escaped newlines/quotes/backslashes and Unicode split across deltas,
  reject conflicting/duplicate root fields, and enforce the existing artifact size
  limits. It must not extract text with a regular expression or repair invalid JSON
  by guessing. A malformed tail after exposure produces an interrupted artifact.
- Keep deterministic shape, exact-quote coverage, source, speech and publication
  checks. Do not restore a semantic prose reviewer or add a second LLM/Jev round to
  approve every answer. Structural coverage remains declared evidence, not proof
  that the model preserved all meaning.

### 5. Delivery lifecycle and transport

The final-output owner has these externally observable states:

| State | Meaning | Next boundary |
| --- | --- | --- |
| prepared | A current explicit handoff passed permission and readiness checks. | Freeze and start, or revoke before exposure. |
| streaming | The frozen attempt has a durable identity and may expose story deltas. | Generation end, interruption or failure. |
| finalizing | Complete text and coverage passed deterministic validation. | Existing publication transaction succeeds or fails. |
| completed | Canonical publication and its linked disclosure effects committed. | Read/replay only. |
| interrupted | Generation ended without a valid complete artifact. | Preserve prefix; explicit recovery, never success. |
| publication_pending | Complete validated text exists, but publication has not committed. | Retry the same publication without invoking the model. |

- Reuse the existing run/step/operation events for internal scheduling and accounting.
  Add a versioned final-delivery envelope to the existing host stream with `start`,
  `delta`, `end` and `error` events. End carries `completed`, `interrupted` or
  `publication_pending`; provider end alone is not completed delivery.
- Each envelope binds session, campaign, worldline/loop, turn, input revision, run,
  delivery ID, attempt ID and a monotonically increasing sequence. Start includes
  public speaker metadata; delta includes only decoded public text; end includes
  final status and canonical publication identity when available. Error messages
  use the current redaction and player-notice paths, not raw provider payloads.
- Bridge nested-author events to the correct parent session/run. Late events from
  replaced runs and attempts cannot append to the current reply. Do not pretend
  the author is another independent player conversation or replay a synthetic
  Keeper `message_update` without source identity.
- The preparation tool result finishes before author dispatch. Keep the driver run
  active through generation and publication; a tool return, provider end or
  provisional last delta cannot emit a successful run end. Driver and CLI consumers
  receive the same final delivery identity/status as the App.
- The renderer applies deltas once, in sequence, to one stable transcript entry.
  A sequence gap requests replay/resynchronization; it is not concatenated blindly.
  Completion reconciles that same entry rather than appending a second full reply.
- Use the existing RPC/IPC stream. Where an existing HTTP/SSE adapter is involved,
  preserve these identities through its event framing and reconnect cursor. Local
  acceptance does not require an unrelated web-server implementation.
- Generation must not wait for full-artifact parsing, file polling, transcript
  reload, typewriter playback or Git completion to expose its first valid text.
  Bounded syntax/Unicode buffering is allowed; whole paragraphs are not a default
  transport buffer. Persistence backpressure may delay emission to retain recovery
  guarantees and must be measured.

### 6. Partial text, durable publication and recovery

- Retain the current canonical turn/publication store. Extend its existing delivery
  evidence with an attempt journal and status; do not introduce another campaign
  truth store. Persist each exposed prefix before emitting the corresponding delta.
  Small ordered batches are allowed, but never emit text that recovery cannot retain.
- Store provider-generated text, decoded/exposed text, frozen packet binding and
  coverage separately. The canonical completed artifact must equal the decoded
  accumulated text, with only protocol/speaker markup rendering differences. No
  post-stream model rewrite or silent normalization may change the words.
- The App's delivery stream is provisional until the existing publication owner
  commits. On success, accepted coverage activates pending speech/knowledge and
  relationships exactly once through that owner. Earlier `apply`/`resolve` receipts
  are never replayed. Ordinary mechanics already committed remain committed even
  if writing fails.
- On generation failure or cancellation after exposure, preserve the prefix as
  `interrupted` in public history. It is not an accepted full artifact and does not
  activate the intended statement's complete knowledge or promise effects. Mark
  linked material exposure as partial/uncertain in delivery evidence, distinct from
  both “never shown” and accepted coverage. Do not label the shown prefix secret
  again or erase it from the Keeper's recovery context.
- Recovery/next input presents the interrupted prefix and status to the existing
  Keeper context. Any clarification or newly completed disclosure goes through the
  normal semantic event/publication path. The host must not guess full propositions
  from text fragments or automatically promote pending NPC knowledge. This is the
  explicit partial-delivery limit; a streaming preview cannot be made unseen.
- A renderer reconnect replays the durable prefix and subsequent sequence, without
  invoking a model. A host restart with an incomplete generation exposes its saved
  interrupted state; it does not claim the provider can resume a dead connection.
  There is no automatic regeneration after exposure. A later explicit continuation
  is separately identified and cannot overwrite the original prefix or repeat game
  settlement.
- If the full artifact is valid but Git/publication fails, keep
  `publication_pending`. Retry the exact same artifact and idempotency identity
  using existing recovery. On restart, resolve committed-but-unacknowledged delivery
  from durable state and do not emit duplicate text or disclosures.
- New input is serialized against finalization. An abort invalidates old emission
  rights immediately; the existing publication recovery decides any in-flight commit
  before a later game action proceeds. A disconnect alone is not an abort command.

### 7. Speaker formatting and special UI

- Preserve the current `{{say:Name}}...{{/say}}` author convention and canonical
  speaker mapping. Incremental rendering buffers incomplete marker syntax, applies
  the current speaker identity/color as content arrives, and never exposes raw
  marker fragments or a hidden canonical name. Do not infer speakers from prose.
- Reuse the App's existing stream reducer, transcript presentation and mechanics
  components. Render a stable completed prefix plus a bounded incomplete tail;
  completion uses the normal full renderer. A final layout change may improve
  formatting but cannot replace words or duplicate paragraphs.
- Existing dice, damage, resource, item, choice, quote, handout and map projections
  stay separate JSON channels produced by their current owners. Their event order
  and stable card IDs remain bound to the same turn. Do not rebuild cards from the
  writer's text, create a second transfer, or reveal hidden mechanics to aid prose.
- Replayed mechanics/presentation events update the same cards. The completed
  `coc-mechanics`/speech record must reconcile with the live entry rather than
  display its prose again. The legacy completed-string typewriter may remain for
  old history, but must not retype or delay this live stream.
- User-facing status/error wording uses the existing open-language presentation
  mechanism; this feature adds no language table or language-detection heuristic.

### 8. Cancellation, budgets and latency evidence

- Reuse the run signal and final-author provider budget. Revoke/abort propagates
  through child generation, streaming, scheduled retries and publication recovery.
  No additional unbounded output budget or post-run `continue()` loop is allowed.
- Use the selected test profile for the Keeper and author, and verify actual model
  and reasoning after any model switch. Production model defaults do not change.
  Profile verification needed by this feature belongs in its tests; a general
  provider/profile refactor does not.
- Record handoff received, packet frozen, author request dispatched, provider first
  text, host first public delta, renderer first paint, last delta and canonical
  publication complete. Separate preparation, provider wait, decoding/persistence,
  transport/render and publication durations.
- Record author request/tool counts, all failed attempts, required-material omissions,
  snapshot invalidations, replayed sequences and recovery outcomes. Distinguish
  receipt settlement time from presentation completion.
- Do not promise that a complete turn will take less than 60 seconds. Prove removal
  of the full-draft wait and normal file/check model turns. Any latency comparison
  must identify models, actual reasoning, input/material sizes and failures; a small
  live sample is not a universal speedup claim.

### 9. Writers, readers and actions

| Information | Writer | Reader | Action |
| --- | --- | --- | --- |
| Ready material and terminal metadata | Keeper through the existing preparation surface | Driver handoff operation | Freeze only an explicitly ready, valid plan. |
| Permission/source binding | Existing output/source/public projection owner | Author adapter and publication owner | Admit public input and reject stale reuse. |
| Public deltas and sequence | Existing final-output owner from actual Pi author events | App reducer and replay reader | Append once to the correct entry. |
| Durable exposed prefix/status | Existing delivery evidence owner | Recovery, transcript, Keeper next-input projection | Preserve what was shown without granting complete pending speech. |
| Accepted coverage and disclosures | Existing canonical publication owner | Event/cognition/relationship readers | Activate exactly once at the current durable boundary. |
| Mechanics and choice state | Existing kernel/presentation owners | Existing special UI | Render settled values and accept only canonical choices. |
| Lifecycle/timing evidence | Driver, author adapter and renderer | Existing test/report consumers | Verify real streaming, accounting and recovery. |

## Testing Decisions

### Highest acceptance seam

Extend the already confirmed seam: **real Pi hooks and RunDriver → actual TypeScript
kernel → actual author request/deltas → existing host transport and App reducer →
canonical save/restart → next-turn perspective/recall**. Add canonical App observation
to prove that its first text is painted before author completion. Preserve real
driver gameplay as a separate acceptance layer.

The owner already confirmed the persistence/perspective/real-driver portion. The
streaming/App extension was presented in this task for optional confirmation; absent
a correction, it is the specified default, not a claim that those tests have run.
Deterministic provider/author substitutes are integration tests, never gameplay.

Use the existing real-host output tests, actual kernel RPC process support, driver
tests, App stream reducer and speaker/mechanics tests. Test externally observable
behavior. Add isolated parser/reducer cases only for protocol boundary invariants;
do not build a second Keeper harness or assertions that merely mirror implementation.

| Case | Required observation |
| --- | --- |
| Normal final phase | One explicit handoff; no advertised output tool; preparation tool return precedes author dispatch; one successful author inference with zero required tool calls; one canonical completed reply/run end. |
| Check versus handoff | Repeated check-only plans launch no author, retain current expression references and publish nothing. The final handoff consumes the intended plan. |
| Failed preceding operation | No first text; Keeper recovery sees the refusal; successful earlier receipts remain single. |
| Actual streaming | Controlled provider pauses after a valid partial text field. The App/reducer already has that text while the provider is still blocked. Releasing later chunks appends to the same entry. |
| Every author input channel | Private sentinel material in all supported inputs is absent from the actual request, durable public prefix and UI events; required/private/stale failures happen before exposure. |
| Artifact framing | Fragment every boundary of JSON escapes, Unicode, text field, coverage tail and speaker markers; visible text matches the final decoded artifact with no JSON/marker leakage. |
| Speech and disclosure | Same accepted coverage and directed recipients as the existing event contract; omitted optional material does not activate; no new semantic approval call. |
| Special UI | Real roll and real item transfer have correct receipt-derived cards and ownership; choices/quotes/handouts/maps keep their current projection where exercised; no duplicate cards on completion/replay. |
| Duplicate, gap and stale events | Replay produces one paragraph; a gap resynchronizes; a prior run/session/attempt cannot append after replacement. |
| Cancellation before first text | No public prefix and no disclosure; settled game effects are retained. |
| Cancellation after first text | Exact exposed prefix survives; state is interrupted; uncompleted speech knowledge stays pending; next Keeper context sees the interrupted text/status. |
| Restart/reconnect | Reconnect replays without model work. A crashed incomplete author remains interrupted. Completed-but-unacknowledged publication resolves without another roll, author or knowledge activation. |
| Publication failure | Full validated text remains publication_pending; retry publishes those same bytes once and activates disclosure once. |
| Pending mechanical choice | A failed preface preserves an already durable choice. Recovery does not duplicate its controls, settlement or disclosures. |
| Source changes | Relevant change before exposure rejects; after exposure interrupts without rewrite. Unrelated background read completion does not invalidate the frozen packet. |
| OOC and mixed inputs | Pure OOC launches no author; mixed direct response and fiction stay distinct, once each; no OOC text enters the artifact. |
| Existing saves | Old output-tool and completed-artifact history remains readable with the same final words, speakers and mechanics. |
| Model/budget/latency | Actual model and effort match the chosen profile; counters include failures; first paint predates final artifact completion; no second Keeper prose generation or artificial typewriter wait. |

### Execution and real gameplay

- Run focused native TS/extension/UI tests first, then the required complete suites
  on the available LAN test box using the existing runner. Preserve source provenance,
  exit codes, reports and failures. No frozen Python oracle edits or retired Python
  product path are involved.
- Real gameplay uses the canonical RPC play driver, with this main session as the
  sole player and one natural utterance at a time. Use Codex Relay GPT-6 Luna/high
  throughout; only observed upstream concurrency saturation permits the documented
  Grok 4.5/low fallback. Keep the failed Luna evidence and verify the actual author.
- Play a coherent episode with NPC dialogue and natural action consequences. Exercise
  a roll and an actual possession transfer through valid player choices, then verify
  save/restart and next-turn knowledge/intent behavior. Do not stop just because a
  fixed number of turns was reached or inject fake settlements to obtain coverage.
- Inspect the canonical App while real output is arriving. Capture timestamped delta
  and renderer evidence, speaker formatting, roll/transfer cards, live-to-final
  reconciliation and reload. Driver logs alone do not establish GUI acceptance.
  Deterministic fault injection establishes recovery cases separately from gameplay.
- App build/package/launch work follows the current canonical-path/signing policy at
  execution time and leaves no second bundle or staging residue. Preserve all test
  evidence. Compilation and packaging are not substitutes for the above acceptance.

## Out of Scope

- General Jev/LLM replacement, admission retuning, global concurrency optimization,
  different provider defaults, new retrieval/discovery architecture or model training.
- Fixing independent item-registration, source-content or scenario-continuity issues;
  report a real blocker separately rather than expanding this implementation silently.
- New game rules, automatic NPC action execution, memory-store replacement, generic
  event sourcing, new semantic review lanes or a second publication transaction.
- A standalone HTTP/SSE service, new browser product, dependency upgrade, general
  Markdown/math renderer rewrite, or removal of legacy saved transcripts.
- Token-level semantic truth validation or automatic continuation of a dead provider
  stream. This feature preserves partial evidence; it cannot undo words a player saw.
- Product implementation, tests, gameplay, packaging, deployment, push or a remote
  issue as part of this specification-only task.

## Further Notes

### Current-source audit and implementation navigation

This is a baseline inventory, not a list of files already changed by this task.
Paths belong here for navigation; the implementation decisions above are defined by
owner/interface behavior rather than particular line numbers.

| Existing owner/evidence | Finding and consequence |
| --- | --- |
| [Product RunDriver](../../runtime/jev/hybrid-engine.ts) and [driver ports](../../vendor/pi/packages/agent/src/run-driver.ts) | Already own one run, policy-origin operations, abort and terminal delivery evidence. Put scheduling here, not in a new post-run loop. |
| [Final-output owner](../../extensions/kernel/final-output.ts) | Resolves permitted input and source revisions, then collects a file-based Pi artifact. Refactor this owner into prepare/stream/finalize responsibilities, retaining its provenance rules. |
| [Keeper surfaces](../../extensions/kernel/tools.ts) and [extension/publication bridge](../../extensions/kernel/index.ts) | Currently advertise output separately; narrate is check-only. Handoff must be explicit and cannot mistake checked:true for committed publication. |
| [Host runtime](../../runtime/host.ts), [task adapter](../../runtime/tasks.ts), [Pi reader adapter](../../extensions/module/reader.ts) | Already provide confined Pi tasks, event callbacks and provider budgets. Supply the initial packet and consume events here rather than invoking a provider directly. |
| [Artifact validator](../../runtime/final-output-artifact.ts) | Checks shape and declared exact-quote spans, not semantics. Reuse for completed text after incremental decoding. |
| [Canonical publication](../../kernel-ts/write/index.ts) and [event cognition](../../kernel-ts/turn-events.ts) | Completed coverage and speech activate pending components at durable boundaries. Partial exposure needs an explicit status, not a fabricated accepted artifact. |
| [Table context lifetime](../../extensions/table/context-runtime.ts) | Preparation and expression reference lifecycle must survive private checks and end on real publication/abort. An existing installed-App investigation recorded premature cleanup after check-only narrate. |
| [App backend](../../Electron/packages/pi-backend/src/index.ts), [transcript](../../Electron/packages/ui/src/Transcript.tsx), [mechanics/speech UI](../../pipicoc/mechanics.js) | Ordinary Pi text deltas already flow to the App; final-author deltas are not currently bridged as their own parent delivery. Existing completed-text animation is not streaming evidence. |
| [Prior output specification](final-output-materials.md), [material handoff](keeper-output-material-handoff.md), [event/perspective specification](turn-events-and-perspectives.md) | Preserve public-only input, OOC separation, source identity and actor knowledge. This decision replaces the optional separate tool as final scheduling owner. |
| [Pi host contract](../pi-host-contract.md), [kernel RPC contract](../kernel-rpc.md), [ADR 0006](../adr/0006-pi-native-single-loop.md) | Current product uses vendored Pi 1.0 with its reviewed driver patches. Historical no-driver/no-patch clauses are not the current runtime boundary. |

The recent full-E2E run is supporting diagnosis, not a benchmark or acceptance of
this feature: its six completed player turns took approximately 87–174 seconds;
successful final authors took approximately 15–34 seconds and normally used four
model responses for task read/write/check/final. Eight of 28 gameplay tool calls
were refused or failed and later recovered. The run ended at the owner's request;
it did not cover an ending, an actual roll/transfer UI flow or installed-App streaming.
Raw evidence is retained under the full-E2E playtest and its isolated campaign home.

### External cross-check

- [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
  documents ordered event framing, event IDs and reconnect behavior. It supports
  stable stream identities, not a guarantee of exactly-once game publication or a
  reason to replace local IPC with HTTP.
- [Vercel AI SDK stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
  separates message/block start, delta and end, with stable IDs and structured data
  alongside text. This supports explicit lifecycle and separate mechanics. Its
  wire format and SDK are not adopted as dependencies.
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc) supports
  main-to-renderer messaging through constrained preload APIs. It confirms that
  incremental local delivery can reuse IPC; it does not solve our source permissions,
  transcript reconciliation or durable publication.

The comparison favors an explicit delivery lifecycle over unlabelled text forwarding,
and incremental use of the current transports over another service. None of these
sources proves semantic fidelity, end-to-end latency or NPC cognition correctness;
those remain project-specific acceptance obligations.

### Publication and scope record

The established project tracker for this workflow is repository Markdown under
`docs/specs`, with `ready-for-agent` as the specification label. Publish only this
document in a local commit. Preserve the already dirty mainline contract, source
and test files; no remote issue or push is required. At drafting, the active/latest
branch is 0.9.7a at 2f7303c33, with unrelated local changes and remote divergence.
This status describes specification readiness, not implemented or tested behavior.

### Implementation progress (2026-10-13)

The owner approved implementation with “可以”. Work proceeds on current mainline,
starting at a45b22c5f. Existing uncommitted image-item, context and native-test changes
are preserved; a before-image of relevant sources is retained under
.tmp/run-driver-streaming-output/baseline. Contract amendments are sections 236 and
the corresponding Pi host note. The implementation uses the confirmed host/driver,
public-delivery and App seams. Focused acceptance is recorded below; incomplete
full-suite and live runs are not counted as passed.

Ready sequence: (1) real-host handoff and incremental author delivery, (2) durable
recovery and next-input context, (3) App stream/speaker/mechanics reconciliation,
(4) focused and complete regression checks, (5) code review and real driver/App
acceptance, (6) scoped commit. This is the task's durable execution plan.

Implementation checkpoint:
- The handoff now returns before the same RunDriver schedules final expression. Its
  current tool surface excludes output; legacy-engine compatibility remains inside
  the same final-output owner. The control-flow inventory names both mutually
  exclusive author protocol sites, never two authors in one attempt.
- The author receives public input initially; JSON text decoding emits real deltas,
  retaining the exact prefix in the existing attempt directory before emission.
  Canonical publication still validates completed coverage. A failed Git commit
  retries the cached artifact; persistent failure keeps the publication slot, and
  recovery commits it before a new player input. No author runs for this recovery.
- The App receives versioned final-delivery events, renders incremental speaker
  spans, replaces the same entry with its canonical mechanics card, and reconstructs
  an interrupted prefix on reload. The next Keeper request sees interrupted exposure
  separately from accepted knowledge. Existing secret redaction also covers the new
  transport.
- Current focused evidence: parser protocol cases; real Pi/TS handoff, interruption,
  next-request recovery and failed-publication cases; App reducer/speech/cold-history
  checks. Fast suite: 130 passed. Kernel, host-API and backend typechecking passed.
  Broad UI/standalone runtime typechecking still reports existing unrelated source
  and test diagnostics; no full-suite or GUI success is claimed from these checks.
- Full LAN validation, actual-author driver play, canonical App acceptance, final
  code review and scoped commit remain. Initial source and task-only differences
  are retained under .tmp/run-driver-streaming-output/ for ownership isolation.

Acceptance checkpoint (2026-10-13, still in progress):
- The latest focused kernel/author/stream group passed 31 tests. Electron completed
  its baseline check on retry: 194 existing failures, no new regression. The first
  Electron run ended with an unrelated asynchronous lease-file teardown error and
  is retained as a failed run.
- Live Luna attempts returned explicit upstream concurrency saturation (the first
  also exposed a stale compiled low-effort hook). Those attempts remain separate
  evidence. The subsequent driver and App acceptance use the permitted Grok 4.5/low
  fallback; actual author telemetry confirms one request per successful artifact.
- Driver evidence is under .coc/playtests/run-driver-streaming-20261013T112743*,
  with isolated campaign state under that base run's home. A canonical-speech
  mismatch initially passed preparation but failed before authoring. The check now
  validates the same speech binding before accepting a handoff; its regression
  tests cover changed meaning, speaker and audience. Settled keys/cash survived the
  failure and a restarted real driver continued the conversation without replaying
  those effects. Later successful author durations include 9.6 seconds; these are
  author durations, not whole-turn latency promises.
- The canonical App was installed with the stable PipiUI Dev signature. Its first
  observed stream painted 23 ms after the host's first public delta and 12.5 seconds
  before canonical completion. That run exposed repeated speech borders at chunk
  boundaries, so it is timing evidence only. The renderer now extends one speech
  span across chunks; its red/green test and 16 passing renderer/backend checks are
  retained. A fresh package and visual recheck are required before GUI completion.
- The first LAN all-suite snapshot predates the final fixture migrations and live
  repairs. Its failures remain evidence, not a passing final gate. A complete run
  of the final source, current-package GUI checks, final review and scoped commit
  are still required. Task-only commit candidates preserve concurrent changes;
  no other owner's files or unrelated source changes are to be absorbed.

### Owner-requested visible-delivery repairs (2026-10-13)

The first App inspection did not satisfy the user's experience: mounted offscreen
text was incorrectly counted as visible first paint. The observed DeepSeek run
spent about 17 seconds in hidden host work before an 18-second Keeper inference,
then hit one invalid NPC task completion and two material-selection refusals.
The owner explicitly requested repairing all three seams, retaining DeepSeek as
the fast lane and reusing the existing kernel/output owners. Section 236.1 is the
binding correction: truthful closed progress events, immediate non-mechanical NPC
response binding, source-only canonical speech selection, public-only selection
inventory, final-phase step collapse, and viewport-intersection-based evidence.
Acceptance must show multiple visibly different partial paragraphs on screen
before canonical completion, plus preserved speaker/mechanics/reload behavior.
