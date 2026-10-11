# Pushed Roll Mod: one declaration, one risk draw, one final attempt

Status: **Source implemented on 2026-10-11; local regression/type checks passed.
LAN focused retry is waiting for the shared box. No live play or installed-App acceptance.**
Binding contract: [kernel RPC §228](../kernel-rpc.md#228-pushed-roll-mod-one-declaration-one-risk-draw-one-final-attempt-2026-10-11).

## Intent and scope

The player hears the failed action's outcome, voluntarily declares a push, and gets
one final attempt without a method questionnaire or a second risk confirmation.
A weighted table supplies a serious failure direction; the Keeper realizes it in
the current situation and continues play. An ineligible declaration is stopped
and explained to the player, without a roll or an additional fictional cost.

Success means this exchange works across delivered turns, consequences change the
actual situation, and forbidden pushes cannot pass through another route. A table
file alone, an ignored refusal, automatic retries, or prose about a consequence
with no required state receipts are hollow delivery.

This is an explicitly requested house rule. It replaces §223.1's requirement to
describe extra effort with a declaration that accepts further effort and risk.
It does not make every failed roll pushable, guarantee success, or impose a
failure penalty after a successful push.

The user approved implementation and subsequently authorized packaging and tests.
Execution and acceptance evidence are recorded below. No new stress resource, risk
editor, confirmation UI, Director subsystem, review lane or generic plugin
framework is part of this design.

## Player exchange

1. The first failed action is narrated normally. No automatic push menu or prompt.
2. The player declares a push in their own language. A bare declaration suffices
   when the investigator and unfinished goal are unambiguous. A request for rules,
   quotation, hypothetical, negation or another person's push is not consent.
   Existing model judgment reads meaning; no keyword/regex trigger is added.
3. Check eligibility before any risk draw or second check. An invalid declaration
   returns the explanation below and ends this attempt. Do not convert it to an
   ordinary retry, skip the guard, select an older convenient failure, or report
   automatic success/no-roll as a substitute.
4. For an eligible declaration, draw one D100 from the Mod table and run the final
   check through existing canonical settlement. These belong to the same atomic
   operation. There is no player-facing preparation/confirmation stage.
5. On success, achieve the original goal. On failure, realize the drawn consequence
   now, apply its actual state changes, and narrate the resulting situation. A
   failed push may achieve the goal at that cost; this is Keeper judgment, not a
   separate random table entry.

The declaration accepts more effort at the same goal. The Keeper can describe
that execution but cannot manufacture a new voluntary bribe, purchase, destination,
disclosure or unrelated investigator action. Existing costs of the chosen action,
including genuinely elapsed time, still apply; drawing a risk incurs no cost.
The Keeper may state an apparent danger within the same delivery, but cannot
insert an obligatory question before resolving. A later rules question is answered
normally; it is not permission to reveal hidden source truth.

## Eligibility and source binding

Every allowed push requires the player's own settled, ordinarily failed skill or
characteristic action check; the same goal must remain achievable. Use the actual
executor, not the beneficiary: the healer owns a treatment check, not the patient.

| Source or situation | Allowed? | Binding decision |
| --- | --- | --- |
| Ordinary noncombat skill check, including investigative and social checks | Yes | Same actor and still-relevant failed action |
| Ordinary characteristic check such as STR or DEX | Yes | Same actor and still-relevant failed action |
| Noncombat combined check | Yes | One reroll, same targets and comparison mode; every component must be eligible |
| A check against a fixed skill-derived difficulty | Yes | It remains an ordinary check, even if an NPC supplied the difficulty |
| An actual opposed roll with both sides rolling | No | Do not turn losing the contest into an ordinary failed check |
| Luck roll, including group Luck | No | Luck is not a pushable characteristic action check |
| Sanity check | No | SAN has its own settlement |
| Combat roll or combat skill (including Dodge, Artillery, Fighting and Firearms specializations) | No | A new attack on a later round is not a push |
| A roll made as part of an active chase | No | Retry opportunities belong to chase actions |
| Damage, SAN-loss or any other amount die | No | It determines a quantity, not an action's success |
| Critical, regular/hard/extreme success or a fumble | No | Only an ordinary failure qualifies; a fumble stands |
| Already pushed source, or source already continued by a push | No | The second attempt is final, even if it fails |
| Source already altered using Luck, or declaration choosing both push and Luck | No | These alternatives are mutually exclusive |
| A request to spend Luck on the pushed check | No | Luck cannot change a pushed result |
| Development, automatic recovery, dying-CON or Idea roll | No | These are subsystem procedures, not ordinary retryable player actions |
| No source check, another actor's check, ambiguous source or an obsolete goal | No | Do not create, substitute or revive a source |

**Special procedures are not generic skill-name exceptions.** First Aid and
Medicine are not globally banned skills. An ordinary diagnosis check can qualify;
a treatment action must use its existing medical executor and obey wound, timing,
patient and treatment limits. Repeated attempts to stabilize a dying investigator
can be ordinary repeats under the book rather than pushes. Spell learning and
first casting likewise retain their own eligibility, costs and printed pushed
failure rules. Do not reroute these procedures into an ordinary check, apply a
generic second healing/casting result, or stack a random penalty onto a mandatory
book consequence. The random table supplies only a consequence the procedure
leaves to the Keeper. Preserve the owning subsystem's actual receipts.

The present ordinary continuation reader omits `healing_check`, and Medicine's
current treatment executor does not expose a pushed operation. These are known
binding gaps, not evidence that the book forbids pushing those skills. This slice
does not authorize rewriting healing or magic. A procedure with no executable
binding is stopped with `procedure_unavailable`, explained honestly, and recorded
as an implementation limit; it cannot be claimed as an accepted supported case.

Binding survives delivery of the first failure: a turn boundary or restart alone
does not invalidate it. Use the most recent relevant actual action check of the
declaring investigator, including prohibited check kinds when evaluating a bare
declaration; do not search backward through eligible-only receipts after a SAN,
combat, successful or fumbled check to find something to push. Existing dice-only
bookkeeping receipts are not candidate action checks. Explicitly referring to an
older check still requires that its original attempt remains the current unfinished
action. No arbitrary turn-count expiry, receipt-ID echo, or full-history search is
introduced. If one source cannot be bound, explain that limitation without a
mandatory follow-up question.

Structural exclusions come from canonical receipt kind, source skill metadata,
outcome, continuation linkage and session context, not from player words. Relevance
and declaration meaning use existing model judgment and current public context.
An unavailable judgment cannot authorize a roll and must be distinguished from
a definite rule prohibition. Revalidate the issued source immediately before
settlement; an intervening change cannot silently retarget it.

## Ineligible declaration: block and explain

The existing `turn_state` refusal carries `code_detail: rule_decision_not_applicable` with a closed
`details.reason`, the source's semantic kind if known, and an English explanation
directive. Suggested reason vocabulary:

`mod_disabled`, `no_source`, `source_ambiguous`, `wrong_actor`, `goal_obsolete`,
`not_failure`, `fumble`, `already_pushed`, `luck_used`, `push_luck_conflict`,
`luck_roll`, `sanity_roll`, `combat_roll`, `chase_roll`, `amount_roll`,
`opposed_roll`, `procedure_roll`, `procedure_unavailable`, `judgment_unavailable`.

The Keeper reads that result and gives one brief, accurate explanation in
`play_language`. Example meanings: combat checks cannot be pushed; SAN cannot be
rerolled this way; this attempt was already pushed; there is no matching failed
action; the treatment retry is not yet supported. Explain any ordinary available
route only when the present situation actually offers it. No lecture, fixed menu,
required confirmation or invented alternative action follows.

The refusal is visible even if the host withholds the push candidate: an explicit
push declaration cannot disappear as an ordinary `no_roll`. A declined operation
consumes no dice, no Luck, no retry entitlement and no risk draw; it inflicts no
new injury, time loss, NPC penalty or other fictional punishment. Previously
settled consequences remain. Host failures are explained as limitations, never as
fictional misfortune or as a false claim about the rulebook.

## Risk table v1: one D100

This is an original CoC adaptation of the referenced design principles, not a
translation of another game's table. Weights are design proposals, not measured
balance claims. All entries require a serious, consequential change tied to the
attempt. High risk is not permission to impose arbitrary death or unrelated harm.

| D100 | Weight | Key | Keeper instruction |
| --- | ---: | --- | --- |
| 01-15 | 15% | `threat_advantage` | Give a danger already connected to this action a concrete advantage: it gains access, reaches its objective, blocks a safe route or closes in. Show what changed. |
| 16-30 | 15% | `exposure` | Let the extra effort expose the investigator's presence, identity, purpose or interference to an existing connected observer or danger able to exploit it. Record what was exposed, who received it and their concrete response in the existing effect's why or causal note. Show the perceptible cause and response without disclosing hidden identities; a private clock increment or generic ominous atmosphere alone is insufficient. Do not add an independent lost route, damaged tool or injury. |
| 31-42 | 12% | `opportunity_lost` | Close the current safe route or opportunity. Continuing the goal now requires dealing with a changed obstacle, rather than another identical check. |
| 43-54 | 12% | `collateral` | Let the attempt damage or compromise a relevant person, place, evidence or relationship. Establish who or what was affected and the actionable consequence. |
| 55-64 | 10% | `means_lost` | Remove or impair an important tool, resource or source of support actually involved in this action. Record its real loss or reduced usability. |
| 65-74 | 10% | `dangerous_delay` | Let the extra effort consume enough time for an established danger or opportunity to change materially. Time passing alone is insufficient. |
| 75-82 | 8% | `physical_harm` | Make the action's actual physical danger strike the appropriate participant. Use existing injury/damage rules and grounded severity; no unexplained injury. |
| 83-90 | 8% | `horror_contact` | Bring the investigator into direct contact with a disturbing truth or threat connected to the attempt. Use a SAN check only when a real revealed stimulus warrants one. |
| 91-96 | 6% | `endanger_other` | Put a relevant present or established ally, dependent or innocent in concrete danger through this attempt. When none exists, put the investigator in that danger. |
| 97-100 | 4% | `compound` | Combine a substantial immediate loss with a concrete advantage for an existing connected danger. Both must arise from one coherent event and both must be realized. |

The final row is one instruction, not recursive rerolling or two independent
tables. No severity die, pressure counter or accumulating modifier is added.

Draw once after eligibility, before the final check; success retains the draw as
unused evidence. A failed check activates it. These risks are Keeper-only until
their perceptible consequences occur; do not put a hidden danger or undiscovered
truth on the player's dice card. A declared method or source-stated consequence
that is already committed takes precedence; the random direction cannot erase it.

**Fit rule.** Realize the row through the current action, people, objects and
connected dangers. Compatible improvisation is allowed, but it cannot overwrite
authored truth, expose unrelated secrets or retroactively choose a different
player action. If a row is materially impossible (no physical danger, no relevant
means, no danger affected by time), realize the fixed fallback `threat_advantage`
if applicable, otherwise `opportunity_lost`. Keep the rolled key immutable. Record
the effective key and a short fit reason with the existing consequence apply/note,
after the Keeper receives the settled result; no pre-roll fit model is added.
Never reroll for a preferable result. Even the fallback must cause a concrete
change. Difficulty choosing prose is not impossibility.

Numeric harm, resource loss, elapsed time and skill success remain canonical
arithmetic. The table has no arbitrary HP/SAN tariffs. Existing rules, stated
amounts and supported severity bands determine quantities. SAN loss requires its
own proper check; a horror row is not direct permission to subtract SAN.

## Mod ownership and minimal integration

The package `mods/pushed-roll/` owns the table, applicability policy, refusal
explanation instructions and Keeper instructions. Planned files are `mod.json`,
`agent.md` and `rules.json`. It uses the existing loader, digest/version locks,
instruction contributions, safe activation boundaries and Mod manager. The table
is data and the instructions have one English source; player prose is generated
in `play_language`.

The loader provides **one narrow capability**, `checks.pushed-roll.v1`, and an optional
`contributes.pushed_roll: "rules.json"` file reference. Its fixed shape declares
this policy's source restrictions, single-attempt limit, Luck conflict, table
ranges, keys/instructions and fallback order. This is a purpose-specific data
contribution, not arbitrary executable plugins or a general workflow language.
Only one effective provider is allowed; the existing ordered-provider mechanism
selects it. Required capability absent means incompatible, never instructions-only
pretend support. Validate full nonoverlapping coverage of integers 1 through 100,
unique keys, weights matching range widths, and known fallback keys.

The host adapter reads the active contribution to recognize a declaration, issue
or refuse the source-bound attempt and carry the risk direction to the Keeper.
The existing core settles the check, owns random numbers and durable receipts,
enforces atomicity/replay and applies world effects. Thin settlement/source-link
bindings may remain; no global risk table, automatic semantic trigger, generic
NPC push penalty or Director debt detector remains in the base product. Existing
check arithmetic, improvement rules and specialized procedure arithmetic stay.
Replace the current global push candidate with this active contribution; disabling
the Mod removes new pushes and gives `mod_disabled` on a declaration. It does not
erase past receipts or cancel consequences already committed by a settled push.

The push keeps the original actor, goal, skill/characteristic, targets, difficulty
and dice modifiers. This slice does not add a modifier/difficulty override path.
A materially changed action requiring different arithmetic is a new ordinary
action, not a silent modification of this continuation. The final check retains
the existing source-receipt relation and one-continuation guard.

The canonical operation stores the risk draw and check result in its existing
transaction, with host-owned provenance on the pushed receipt: Mod id/version/
digest, table version, D100 result, rolled row key, and whether the risk was
activated. Model text does not supply those identities or random values. Before
commit failure leaves no committed risk/check receipts or world changes; existing
ephemeral RNG behavior is retained, without a new RNG rewind/persistence system.
After commit retry/reconnect
reuses its draw and check. The Keeper's later realization, including a fallback
key and its reason if needed, is recorded through existing `apply`/causal notes;
it does not rewrite the settled receipt. The existing turn's ordered receipt chain
and causal notes provide its trace, never an opaque receipt id copied by the model.
No second risk ledger, campaign counter
or bespoke save file is introduced. When a consequence must arrive later, use the
existing causal note/memory path. No new completion classifier or pre-delivery
audit.

New campaigns use the built-in Mod enabled by default. Existing campaigns retain
their pinned package set and require explicit activation/upgrade at the normal
safe boundary. Historical receipts remain readable and immutable; a legacy global
push path is not kept as a second production implementation. Rollout must report
which existing campaigns are not opted in. No settings or evidence are rewritten
merely by installing the package.

## Three ends

| Producer | Reader | Actor |
| --- | --- | --- |
| Player's real declaration and canonical source receipt | Existing semantic selection/admission plus contribution policy | Host admits one bound attempt or returns the explicit refusal |
| Canonical risk draw and final check, committed together | Existing result projection with Mod risk instruction | Keeper realizes the activated direction; successful check leaves it unused |
| Canonical refusal reason | Keeper result context | Keeper delivers the localized explanation and stops the invalid attempt |
| Keeper consequence realized through existing `apply`/causal note | Ordinary world/capsule/history projections | Subsequent play responds to actual changed state, rather than another flat failure |

## Acceptance for a future implementation

Focused deterministic checks must establish:

- Every boundary 1-100 maps to exactly one table row; weights total 100; fallback
  retains the original roll; the compound row never recursively draws.
- Bare explicit declaration after a delivered failure binds the right actor and
  goal; a question, quotation, refusal or hypothetical does not trigger it.
- Each excluded row in the eligibility matrix refuses before RNG/state mutation,
  including a mixed combat combined check and a forbidden latest check with an
  older eligible failure. No route or ordinary-check fallback bypasses the gate.
- Source is already continued, concurrent source changes and repeated call IDs
  cannot create a third attempt, a fresh risk draw or a Luck-adjusted pushed roll.
- Success incurs no failed-push penalty; failure exposes the active risk to the
  Keeper but no hidden source material to player mechanics.
- Invalid declaration reaches player delivery with the correct explanation;
  unavailable judgment/procedure is distinct from a definite rule prohibition.
- Medical/magic calls retain their existing owners and limits. A missing binding
  is honestly unsupported, not silently remapped or included in passed coverage.
- Disablement removes new automatic candidates and refuses declarations; existing
  receipts, committed consequences, package locks and save evidence remain intact.

Real acceptance uses `tests/play/driver.py`, the specified Grok Build 4.7 fast/low
Keeper and the main session as sole player, one natural input per delivered turn.
No scripted player, forced dice, fake Keeper or constructed fixture is live play.
Observe a push declared after the first outcome is delivered, no confirmation
round, a failure that materially changes the situation, and an ineligible push
that is explained without new punishment. A successful push is observed if it
occurs naturally; unobserved outcomes remain deterministic-only evidence, not
claimed live coverage. Live acceptance waits for implementation and authorization
of its resource boundary; no evidence directories may be deleted.

## Sources and design decisions

The 1.0.4 consequence clarification follows [Dungeon World's GM principles](https://www.dungeonworldsrd.com/gamemastering/):
consequences follow the fiction and are shown as fictional events, not announced
table entries. Blades permits multiple consequences; this Mod deliberately keeps
one primary consequence outside `compound` to preserve its simpler risk table.
Several effects may represent that same response. Neither precedent requires
another player confirmation or a new program flow here.

- CoC 7e Keeper Rulebook pp.84-86, 89, 90-91, 99, chase rules and p.196, checked
  against the local library text. [Official system summary](https://callofcthulhuwiki.chaosium.com/rules/game-system.html)
  confirms justified retries and optional foreshadowing. This design deliberately
  simplifies the declaration step; it does not claim to reproduce RAW unchanged.
- [Ironsworn official Playkit, PDF p.7](https://drive.google.com/uc?export=download&id=1Ol8MlqHp_ASnDLWZCkyB-RIdI29bkqk_):
  confirms weighted narrative consequences and context interpretation. Adopt the
  direction-based table; replace its reroll/compound recursion with a fixed fit
  fallback and one compound instruction. Probabilities above are our own.
- [Blades in the Dark: Consequences and Harm](https://bladesinthedark.com/consequences-harm):
  confirms that consequence type, severity and achieved effect are distinct.
  Adopt that separation; do not import resistance, clocks or its action system.
- [Year Zero Engine SRD pp.9-10](https://freeleaguepublishing.com/wp-content/uploads/2023/11/YZE-Standard-Reference-Document.pdf):
  confirms automatic push costs and a graded panic table. Its accumulated stress
  and costs even on a successful push differ from this CoC design and are omitted.

### Implementation record

**1.0.4 consequence clarification (2026-10-11).** The retained Mechanical Repair
failure drew `exposure`, but its delivered prose emphasized a jammed retreat window
while the private receipt linked noise to a threat-clock increment. This proves
state settlement, not clear realization of the chosen risk. The Mod now constrains
the consequence to its effective row, separates one consequence from independent
stacked penalties, and asks for its observable cause and response. `exposure` also
carries the same guidance in its authoritative roll instruction. Ordinary failed
goals and actual time costs remain valid; multiple writes for one linked response
are allowed. No new adjudicator, state field, row weight, exclusion or player
question is added. Existing play evidence, penalties and campaign locks are kept.
The older packaged/live evidence below remains evidence for 1.0.3, not 1.0.4.
Validation: Node 24 ran `pushed-roll-mod.test.mjs` and
`mod-package-boundary.test.mjs`, 18 passed and zero failed. These existing checks
exercise the actual shipped contribution, D100 coverage, source binding, refusal
and RPC settlement/projection; they do not prove the revised Keeper's fictional
realization.

**1.0.4 packaged acceptance (2026-10-11).** The canonical stable-signed
`/Applications/PipiCOC.app` was rebuilt, restarted and checked against all 30,258
runtime files and 21 links; the Mod panel shows 1.0.4 and staging is empty. Model
defaults and the restored App session were changed by explicit user instruction
to `grok-build/grok-4.5`, `low`; driver state confirms that exact model and effort.
The isolated starter/pregen campaign uses the packaged launcher and the real
Keeper, with the main session as player. No live dice were forced. Turn 5's ordinary
Mechanical Repair failure (82 against 10) was followed by the bare declaration
in turn 6. The final roll failed (12 against 10), drew `exposure` (29), and realized
the connected haunting's response as moving bedsprings and a spreading stain.
The threat clock advanced 2 to 3 and remained 3 after the player's exit in turn 9.
No new independent item loss, injury or blocked route was added by this push;
earlier fumble damage remains. The fumble refusal (turn 4) and repeat-push refusal
(turn 8) create no receipts, dice or time cost. All nine turns delivered; four tool
calls were rejected and then handled by the Keeper (missing object recipient,
wrong-scene clue, an unchosen descent, and an embedded narration gate). They are
recorded rather than counted as a clean execution. The main action/risk sequence
passed; this is scoped acceptance, not a full-suite or whole-campaign claim.
Evidence: `.coc/playtests/pushed-roll-104-g45-ready-live-20261011/`, with the
structured audit in `.coc/diagnostics/pushed-roll-1-0-4-e2e-20261011/acceptance-1-0-4.json`.

2026-10-11: specification and contract amendment only. No runtime/package changes,
test runs, migration, live acceptance, commit or push are claimed.

2026-10-11 implementation: `mods/pushed-roll/` supplies the policy, weighted table
and English instruction. `kernel-ts/mods/pushed-roll-policy.ts` validates the data
and source exclusions; `pushed-roll.ts` selects the active provider and draws from
canonical RNG. Existing settlement stores risk/check together and projection
exposes Keeper guidance without its package digest or a player risk card. The
ordinary catalog retains blocked declarations for explanatory refusal, including
when a session is active or the Mod is disabled. Existing Jev selection recognizes
the declaration independently of prerequisites; its same-goal binding fails closed
without another player question. NPC push tariffs and the Director's consequence
detector are retired; the historical signal remains false for reader compatibility.

Local Node 24 checks: `pushed-roll-mod` plus `rulebook-rolls`, 20 passed;
`check-selection`, `director-recovery` and `system-language`, 79 passed. Kernel
TypeScript `--noEmit` passed. These are deterministic source/RPC evidence, not
natural Keeper adoption or installed-App evidence. LAN focused selection is 374
extension files, Python and loop. The first LAN batch was interrupted after other
clients started several heavy suites on the same 16-thread box; 20-second kernel
timeouts appeared. Its completed per-file logs and incomplete Python log are
retained, not counted as a passed gate. The current-source retry waits for idle.
Later scope checks distinguish a chase subtype from an ordinary check and do not
ban noncombat skills merely because a fight exists. Actual narrate mechanics,
rather than an absent resolve field, verify that the risk stays off player cards.

The same five `time-once` failures reproduce against the clean pre-feature HEAD
`5b8fdb26c`; this is baseline attribution, not a green time suite. Evidence is under
`.coc/diagnostics/pushed-roll-20261011/`, including the comparison JSON and logs.
The baseline used its own kernel/host source and reused local Pi/native artifacts.
Its clean terminal worktree is classified `retained:lsof_probe_unavailable` at
`/Users/haoli/.codex/worktrees/pushed-roll-baseline-20261011`, branch
`codex/pushed-roll-baseline-20261011`: two canonical cleanup probes could not fully
inspect process cwd because the unrelated WebDAV mount `/Volumes/10.3.2.75` could
not be statted. No force cleanup or mount change was made. Retry canonical closeout
only when occupancy verification is available; the final audit still reports it.

Medical/magic binding limits above remain; no new procedure executor is claimed.
Existing campaign locks and play evidence were not migrated or rewritten. No
commit or push was made at that source checkpoint. Subsequent packaging and live
tests are recorded below. Concurrent document
knowledge changes in the shared checkout belong to another task and were preserved.

2026-10-11 package/test follow-up: the canonical `/Applications/PipiCOC.app` was
built offline with cached, checksum-verified Node/Git/Electron resources and signed
with `PipiUI Dev`. Its back-link and LaunchServices/Spotlight point to that sole
bundle. The runtime inventory verifies 30,258 files and 21 links. Temporary App
staging was removed on the initial cache failure and every successful run. Other
local npm cache entries supplied the missing locked Pi tarballs; no Internet
download or dependency upgrade was needed.

Real Grok 4.7 Fast/low play found declaration/goal-binding seams. Version 1.0.3
defines a bare rule name as the latest failed-action continuation, independent
of eligibility. Matching the declared rule and its same goal uses the existing
applicability gate; obsolete/ambiguous adjudication retains its stricter gate.
Ordinary failure and an earlier no-roll do not consume a push or close the goal.
No additional call, player confirmation, language keyword classifier or gate
change for other rule families was introduced. A retained-input Jev diagnostic
is classified as question evidence, never gameplay.

The instruction remains within the existing 65,536-byte full-Mod budget. The
package-boundary guard recognizes `pushed_roll`; derived-content fixtures install
the same Mod explicitly, and recorded fixture seeds account for the risk draw.
Director cases intentionally affected by retiring push debt now assert current
TS behavior directly. The frozen Python oracle and its source/output remain
unchanged; unaffected historical arithmetic/scoring comparisons remain.

Focused evidence: 93 Node checks passed after the declaration/binding changes;
59 related kernel cases passed on leehow-pc, and 113 TS read/Director checks passed
there. Kernel `--noEmit` passed. The broad LAN checkpoint ran 376 extension files
and 2,142 Python cases, plus 12 loop cases. Its original failures and the subsequent
focused repairs remain in `.coc/diagnostics/pushed-roll-20261011/`. The broad gate
is not green: time-cost-fit, time-band-momentary and time-once remain outside this
feature repair. Five time-once failures already have pre-feature baseline proof;
the other time failures have not been attributed by an exact baseline replay.

Packaged deterministic RPC probes cover no-source refusal, one bare push, the
original arithmetic, D100 risk, committed replay, third-attempt refusal and
hidden public risk. They are contract evidence. Actual Keeper records are retained
under `.coc/playtests/pushed-roll-package-*-20261011/` and the isolated live home;
the first run lacked Jev credentials and cannot validate the full selection path.
The later runs use the App vault secret only in the child environment. Their early
missed pushes are failure evidence, not successful acceptance. Final live status
is recorded at completion below.

Final scoped acceptance: `pushed-roll-package-dispatch-live-20261011` ran the
canonical packaged launcher with Grok 4.7 Fast/low and a single natural player.
A failed Locksmith check was pushed using only the rule declaration and succeeded
without another question or failed-push penalty. A repeated declaration was
refused without another roll or time charge. A later Mechanical Repair failure
was pushed the same way and failed: the canonical exposure draw activated,
`apply threat` advanced the existing haunt clock from 3 to 4 and `apply flag`
committed `spare-window-jammed=true`. The next turn retained the lost window exit
and the investigator used the stairs. Public mechanics expose the check, not its
Keeper risk; the actual `coc-clerk` message carries the instruction and fallback.
These are real outcome/consequence records, not fixture or turn-count substitutes.

The real tool gateway initially rejected `push_context` despite its kernel binding.
The optional closed enum and obsolete push description are now corrected in
`extensions/kernel/tools.ts`, with an actual `validateToolArguments` regression.
Subsystem-owned catalogs now retain forbidden push declarations for refusal
only; eligible pushes and ordinary checks cannot bypass that owner. The final
combined Node/schema/language run passed 101 cases. Related LAN checks passed
59 kernel cases and 113 TS read/Director cases. Broad time failures above remain.
The final package inventory, signing, canonical registry paths, Mod-panel defaults,
raw play records and scope proof are retained in the diagnostics directory.

Existing user sessions and defaults were preserved. Their historical `grok-4.7`
selection is absent from the current App catalog and requires an explicit model
selection; the acceptance process used the available `grok-4.7-build-fast`. New
campaigns enable this Mod by default. An older campaign requires activation in
the Mod panel. Medical/magic procedure limitations remain as specified above.

Final installed snapshot: the signed package receipt is dated
`2026-10-11T10:25:54.740Z`, with the same 30,258-file/21-link verification.
`pushed-roll-package-release-live-20261011` reopened the retained campaign through
that package and refused another declaration without a new roll or time charge.
The final hash check confirms all feature sources unchanged during assembly;
concurrent NPC source and unrelated test edits are recorded separately and are
not included in this feature's acceptance claim. The baseline worktree remains
retained for the unavailable occupancy probe; its final audit still reports that
retention. `acceptance.json`, `package-release-verification.json` and
`app-hygiene-final.json` are the closeout evidence. No commit or push was made.
