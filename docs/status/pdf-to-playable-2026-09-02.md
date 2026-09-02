# PDF → playable: what a third-party module actually hits

Written 2026-09-02 after driving two modules through the product's own Keeper
surface with a live KP, one player turn at a time.

## The headline

At the start of the session, **no PDF module could become a campaign through
the product at all.** Not slowly, not partially: `campaign.create` was refused
by a message instructing the Keeper to call `campaign.create`. The Keeper tried
thirteen times across two sessions, then fell back to `setup.quick_start` with
the built-in starter and told the player the requested module was ready. The
campaign held *The Haunting* under the title of the module the player asked
for.

That is fixed. A raw third-party PDF now reaches a bound campaign:

    PDF ──(coc-pdf-pipeline, outside the table)──> source bundle
        ──(campaign.create + scenario.bind_pdf, in the table)──> campaign
        ──> [BLOCKED: opening_source_review_required]

## Where it stops now

`too-many-1920` (《他们也没想太多》, 20 pages) is bound and titled correctly,
with the bind skeleton written (clues, handouts, npcs, locations, timeline).
It cannot advance past `opening_source_review_required`.

The gate publishes `allowed_actions` naming four operations the Keeper may
call. **Nothing consults that list.** Admission is decided by
`exactOpeningSetupRouteInvocation(state.route, params)`, which matches
`route.next_operation` — and in this phase `next_operation` is `null`. So every
action the card advertises is refused, including the ones the card itself
tells the Keeper to use. The card also declares `invoke_via: "coc_invoke"` for
each, a transport the Keeper's own instructions tell it not to use.

The real forward path is the `coc-opening-source-coordinator` lane, not a
Keeper operation. Asked to dispatch it, the Keeper produced an empty settle.

Why it cannot: dispatching requires copying
`coc_capabilities.data.cold_start.opening_source_coordinator.task_static`
verbatim, and **the Keeper never called `coc_capabilities` in either
campaign** — not refused, simply never done. So the one card that blocks the
table points at a field from a different call the Keeper may never make.

The refusal now carries the dispatch instead of pointing at another call.

**And underneath that, the tool was not there.** The Keeper's working set in
this phase is:

    coc_chargen_delegate, coc_discover, coc_evidence_table_opening,
    coc_progressive_opening_bootstrap, coc_progressive_prepare_opening,
    coc_rules_cash_assets, coc_rules_roll_dice, coc_session_resume,
    coc_setup_inspect, coc_setup_phase, coc_source_assets, read

No `subagent`. No `coc_capabilities`. The host asks for a dispatch the
surface cannot make. `resolvedWorkingSetHostTools` does ask for `subagent`
and `subagent_wait`, but it intersects with `pi.getAllTools()`, and
`subagent` is not a Pi builtin -- it is a shipped example extension
(`examples/extensions/subagent`) that this agent home never enabled, while
the launcher runs with `--no-builtin-tools`.

Enabling it in `.pi/coc-agent/settings.json` is an environment change, made
here so the path could be exercised at all. Whether the launcher should
provision it (rather than every workspace enabling it by hand) is a product
question -- `pi-coc` already mirrors the bundled steward agents into
`.pi/agents`, so provisioning the extension that reads them belongs beside
that.

This is the recurring family of the whole session: **two projections of one
fact, and the one the Keeper is shown is not the one the host consults.**

## Two more things a raw PDF hits before that

- `scenario.bind_pdf` does not read a PDF. It binds an already-built bundle,
  and its rejection said what a bundle must *be* without saying how to get
  one — so the Keeper invented "I'm building the bundle now" and waited on
  nothing. The message now names the producer and says plainly that no
  in-table operation turns a PDF into a bundle.
- A bundle must live inside the workspace. `.coc/module-library/<id>` works.

## Defects found by playing, not by testing

Each of these was invisible to the suites and fatal at the table.

| What happened at the table | Root cause |
|---|---|
| Any Sanity check costing SAN made the turn undeliverable | The rules.settle envelope was shaped for the healing family and published one hardcoded resource; a Sanity settlement could not evidence its own SAN write |
| A turn stuck that way stayed stuck forever | An unprovable host-projected delta failed the turn closed, and nothing can abandon or repair a pending turn |
| The first turn with people in the scene died | Obligation ids are echoed handles ending in a digest; the result-side scan judged them as authored slugs and collapsed `turn.output_context` |
| …and then the Keeper spun 20-30 discovery calls | With no output context nothing bound finalize; the stage's filter then left only operations that cannot advance a turn |
| Binding a module returned nothing readable | `setup.invoke` declared 2 identity fields; a bind returns 10 |
| Adopting source facts worked or failed by machine | An absolute briefing path in `state_refs`; the identity grammar refuses entropy, so it passed under `/Users/x/code/repo` and collapsed under a mkdtemp root |

## Still open

- The source-review gate above.
- `amaranthine-loop` reaches `review_ready` with neither `narration.review`
  nor `turn.finalize` bound, so the only tool offered is the producer, and
  calling it does not bind them. **Root cause found:**
  `buildReviewedCoverageBindingFacts(data)` throws
  `binding_context_invalid: coverage binding requires one complete canonical
  output context` because the output context carries no `mechanics_summary`
  — the wire projection keeps only `mechanics_bundle_sha256`, so
  `_compact_output_context` sets `mechanics_summary` to null, and the binding
  builder requires an object. The throw was swallowed by a bare `catch`,
  which is why this took three hours instead of one look; that catch now
  records `coc-coverage-binding-unavailable` with the reason and the
  consequence.

  Which side gives is a call for whoever owns the bundle projection: either
  the wire view keeps a mechanics summary even when the bundle is stripped,
  or the builder accepts an absent summary as "this turn had no mechanics".
  The second is the tempting one and the dangerous one — absent-means-empty
  is exactly the inference this codebase has been burned by. Not decided
  here.
- The loop acceptance (clock → fork → rewind → re-apply ageing) is untested:
  play never got past the turn above.
