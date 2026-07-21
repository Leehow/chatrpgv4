# COC tiered background orchestration and first-contact readiness

Work ID: `coc-tiered-background-orchestration`
Status: `In Progress`
Last updated: `2026-07-21`

## Product question

Can a fresh source-authored campaign reach an actionable opening within three
minutes, then keep likely source facts, NPC mechanics, and first-contact
material warm enough that the live Keeper can concentrate on causality,
portrayal, and final table prose instead of supervising parsing tasks?

Success is a real plugin-native run in which the main KP delegates bounded
source lifecycle work, current dependencies block only their exact consumer,
and a Harris/Clayton/Jane-style multi-NPC contact does not trigger late source
parsing or persona construction. A hollow result would be a new generic
orchestration engine, a daemon that merely stays alive, a pre-scripted Keeper,
or component tests with no normal host path consuming the feature.

## Decisions fixed by the 2026-07-21 review

1. The opening SLO is **three minutes**, not one minute. Its exact endpoints
   are defined below; an early status or input prompt is not an actionable
   opening. Queue time alone is not the metric.
2. Orchestration is separated by authority domain:
   - source/document work owns page evidence, packs, source ranges, and host
     worker lifecycle;
   - deterministic rules/state tools own mechanics and mutations;
   - Director/NPC methods return bounded advice;
   - the main KP alone owns player understanding, fictional causality, scene
     framing, NPC portrayal, pacing, adoption decisions, and final prose.
3. A task is not inherently blocking. Every L1 work item carries an exact
   structured dependency reference. Only the matching consumer may pause that
   one settlement. Other play continues.
4. “Persistent background parsing” means durable work state plus reliable
   wake-up after enqueue, scope discovery, cache availability, lease expiry,
   or process loss. It does not require an immortal process.
5. The first hierarchy is deliberately narrow: one source coordinator may
   claim existing durable packets and fan them out to existing source-pack
   leaves. Its first executable adapter is Grok `leaf_direct_submit`; Codex
   exact-forward and Pi remain unproved and unavailable in this slice. It does
   not select player actions, read campaign transcripts, compile packs itself,
   or become a second KP.
6. Rules orchestration is initially a compact deterministic readiness
   projection, not another LLM agent. Director remains optional, advisory, and
   nonblocking. This preserves domain separation without adding three new
   schedulers.
7. NPC persona/stat preparation and the CoC first-impression roll are separate:
   authored or seed-stable persona and mechanics may be prepared early, but
   `npc.reaction` remains bound to the actual investigator, NPC, conduct, and
   context at first substantive contact.

## Runtime shape

```text
                         durable module-assets / queue / leases
                                      ^
                                      |
Main KP -- compact cards --> source coordinator --> source-pack leaves
   |                                  (one manager, bounded fan-out)
   |
   +--> rules readiness card --> deterministic rules/state operations
   |
   +--> director readiness/advice --> optional suggestions
   |
   +--> final semantic choice, causality, portrayal and player prose
```

The coordinator reuses `progressive.claim_host_work`; it does not replace the
repository queue, invent another work graph, or aggregate child prose back into
the KP context. On direct-submit hosts, leaves write through the existing
strict source-result boundary. On non-direct hosts the capability remains
explicitly host-gated until an equivalent durable result path is proven.

## Three work levels

| Level | Meaning | Typical scope | Execution and dependency |
|---|---|---|---|
| L1 `current_dependency` | Minimum evidence/mechanics needed now | selected opening pages; exact NPC/item mechanics required by the current settlement | Start immediately. Only the named consumer may wait; unrelated play continues. |
| L2 `near_term` | Likely in the next turn or few turns | present/mentioned NPCs, current-scene clues and handouts, depth-1 locations, likely conflict mechanics, first-contact readiness | Background, high priority, never a general output gate. |
| L3 `bounded_warm` | Plausible within the current chapter/region | declared appendix windows, remaining roster locator/mechanics work, bounded special-rule evidence, local NPC relationship edges | Background after L1/L2. Never an unbounded full-PDF crawl. |

`deadline_class` remains the transport urgency signal. The existing request
adds only a closed `work_level` and, for L1, a nullable structured
`dependency_ref` naming its exact consumer operation and subject/settlement.
The request kind, target, and purpose remain the source of other consumer
identity; no duplicate execution-mode or free-form consumer field is added.
Source hash, exact scope, and stale/supersede rules remain explicit.

## Host-work lifecycle invariants

Host work has these disjoint operational classes:

- `runnable`: non-empty exact cached page scope and `dispatch_state=ready`;
- `leased`: a live or recoverable host ownership lease;
- `awaiting_scope`: advisory debt with an unknown/empty page scope, a reason,
  and a concrete wake condition;
- `awaiting_cache`: exact scope exists but required cached pages are absent;
- `stale`: terminal audit evidence that target/source/scope was superseded or
  invalidated; it is not open work;
- `fulfilled`: every result in the packet has passed strict fulfillment.

Required invariants:

- `stranded_ready_count` is always zero;
- `open_host_work_count = runnable + leased + awaiting_scope + awaiting_cache`;
  stale/superseded and fulfilled counts are reported separately;
- claim considers only runnable rows;
- discovering an exact scope atomically wakes/replaces the matching
  `awaiting_scope` row and closes the stale representation;
- source hash change, scope expansion, roster expansion, or invalid evidence
  reopens affected readiness, never silently preserves top-level complete;
- all classification and claim decisions use one normalization path under the
  existing host-work lock; no second lifecycle ledger is added;
- locator top-level `complete` means full declared scope and full declared
  roster have terminal `located` or `not_authored` evidence. A completed row
  or a validator pass over a partial declaration cannot promote it.

## First-contact readiness contract

For each NPC likely to enter the current or next few scenes, the KP receives a
compact readiness row:

```text
npc_id
identity_ready
localized_name_ready
agenda_ready
persona_ready
mechanics_requirement: not_needed | ready | source_pending | kp_selection
pending_source_dependency
requested_pair_first_impression
next_operation_cards[]
```

Rules:

- Authored NPC truth wins. Generic persona generation must not overwrite an
  authored identity, agenda, or voice.
- Campaign-local/improvised NPCs may use the existing seed-stable persona tag
  generator and existing actor-profile archetypes. The candidate is cheap and
  deterministic; persistence still goes through canonical state/mechanics
  operations with a decision identity.
- Until an idempotent canonical accept/freeze operation persists an improvised
  persona in `npc-state.json`, that candidate is explicitly advisory and the
  system does not claim persistent improvised-persona prewarm.
- An improvised actor profile is frozen once accepted. Later authored conflict
  becomes continuity evidence, not a silent reroll.
- Readiness may identify missing first-impression pairs and provide incomplete
  operation cards, but it must not roll them early. Actual conduct/context and
  a fresh decision identity are supplied at first substantive contact.
- The hot projection carries only the explicitly requested investigator/NPC
  pair, never a party-by-roster Cartesian product. NPC combat mechanics are not
  a first-contact gate; only an exact mechanics consumer may wait on them.
- The normal scene/NPC projection is the canonical consumer. A separate test
  harness is not integration.

## Source coordinator contract

The source coordinator is a host-side lifecycle manager with one level of
bounded fan-out.

It may, on a host that explicitly advertises the coordinator/nested path:

- consume a compact takeover packet containing source identity, counts, claim
  operation, host adapter facts, and the current dependency identity;
- call the existing claim operation with a bounded executor id;
- spawn at most the host-declared maximum source-pack leaves from the exact
  returned packets;
- in `leaf_direct_submit` mode, rely on child durable submit and never retrieve
  child output;
- in a future `manager_exact_forward` mode, retrieve each child result once and
  forward it unchanged through the existing strict fulfillment operation;
- return only a compact liveness/dispatch summary.

It may not:

- see player transcript or broad campaign state;
- choose opening fiction, player intent, checks, stakes, NPC response, or
  final prose;
- widen page scope, parse pages itself, repair child output, or write campaign
  state;
- replace repository queue grouping, leasing, validation, or fulfillment;
- wait for L2/L3 results before allowing the KP to answer.

Maximum nesting depth is two (`KP -> source coordinator -> source-pack leaf`).
Leaves remain unable to spawn. The first implementation targets Grok
`leaf_direct_submit` only and stays `experimental/host-specific` until a real
claim -> manager -> leaf -> durable fulfillment run proves it. Unsupported
hosts do not claim work and must not pretend work was dispatched.

## Domain readiness presented to the KP

The KP should see one compact orchestration projection rather than raw queues:

```text
source_ready: ready | degraded
rules_ready: ready | needs_source | needs_kp_selection
director_ready: ready | optional | unavailable
current_blockers[]
decision_requests[]
background_progress:
  L1: {runnable, leased, awaiting_scope, awaiting_cache}
  L2: {runnable, leased, awaiting_scope, awaiting_cache}
  L3: {runnable, leased, awaiting_scope, awaiting_cache}
```

This is a projection, not a mandatory turn pipeline. Only the exact operation
whose `dependency_ref` matches may report a blocked dependency; a general
scene projection never becomes globally blocked because an old L1 row exists.
The KP may ignore late advice and does not call every domain every turn.

## Implementation slices and acceptance

| Slice | Status | Acceptance |
|---|---|---|
| A. Correct host-work state classes and counters | In Progress | Empty/unknown scope cannot be `ready`; claim skips no runnable work; stranded ready is zero; awakening/superseding is atomic under the existing host-work lock. |
| B. Durable L1/L2/L3 projection and wake policy | In Progress | Existing requests add one `work_level` plus exact L1 `dependency_ref`; detached worker restart/idle exit loses no work; L1 is not a global gate. |
| C. First-contact readiness vertical | In Progress | Normal NPC query first exposes requested-pair readiness and an unrolled impression card; authored truth is the fast path. Improvised persona persistence remains `Partial` until canonical accept/freeze exists. |
| D. Source coordinator manager-to-leaf vertical | Not Done | Grok-only experimental agent/closed packet/distinct capability is discoverable; main KP hands off one claim/fan-out; leaves remain least-privilege; unsupported hosts do not claim. |
| E. Bounded appendix consumers | Deferred/Partial | Existing roster/mechanics locator warming belongs to B. At most one typed `combat_damage_multiplier` current-region vertical may proceed; generic special-rule packs and NPC graph are deferred until a normal rules/Director consumer exists. |
| F. Real plugin-native replay | Not Done | Fresh campaign reaches actionable opening within 180 s and replays the multi-NPC first-contact path without late parse/persona construction. Exact reaction rolls still occur at contact. |

## Validation order

1. Focused host-work lifecycle and queue tests.
2. Focused NPC readiness/persona/mechanics/reaction tests.
3. Plugin metadata and MCP contract tests.
4. Required plugin metadata gate:

   ```bash
   PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
     tests/test_plugin_metadata.py -q -p no:cacheprovider
   ```

5. Install the plugin through its canonical installer and run one
   window-equivalent session. The main session is the live KP and a human or
   protocol-isolated Agent supplies one natural player reply at a time. No
   settle script, batch player, fake KP, or alternate harness is acceptance.

Use `t0` when the host receives the exact final investigator-confirmation
message, `t_open` when it delivers the first complete actionable opening, and
`t_input` when the same task/window visibly accepts the next natural player
reply. Acceptance is `max(t_open, t_input) - t0 <= 180 s`; a character status
or early input prompt does not count. Record source dispatch, durable
fulfillment, and first substantive multi-NPC contact separately. Component
tests support but do not establish the SLO or KP quality.

## Explicit non-goals

- No immortal parser daemon and no unbounded whole-PDF background crawl.
- No generic nested-agent framework.
- No rules LLM with authority over deterministic operations.
- No Director gate and no mandatory adviser call.
- No pre-rolled first impressions.
- No second persona/event library parallel to the existing seed-stable tags
  and actor archetypes.
- No new appendix pack type until its canonical rules or Director consumer is
  implemented in the same slice.
- No claim of Codex/Grok/Pi parity from metadata tests alone.

## Risks and stop conditions

- If a new coordinator duplicates queue/lease state, stop and remove it.
- If first-contact preparation must mutate canonical NPC facts without an
  explicit KP decision, keep it advisory rather than weakening authority.
- If appendix support requires a broad scenario-IR redesign, implement one
  bounded current-region vertical or defer it explicitly; do not silently
  expand the program.
- If the clean integration branch encounters concurrent edits in the same
  files, stop that lane rather than stashing or overwriting another worker.
- If real host nested spawning or MCP inheritance cannot be proven, keep the
  coordinator experimental and report the exact missing adapter evidence.
