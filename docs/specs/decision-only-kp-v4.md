# Decision-only Keeper and sole prose author

Status: implemented through `edb705a0e` on `0.9.8a` and installed in the
canonical signed App,2026-10-19. The bounded MiniMax and actual-App results,
including partial answers and the unrelated full-suite failure, are recorded in
[the acceptance report](../acceptance/decision-only-kp-v4-20261019.md).
Design probes remain separate from production-path and live-test evidence.

The owner forbids the Keeper from drafting complete dialogue or event materials.
The intended chain is prepared material -> compact semantic decision -> existing
kernel settlement -> one prose author with direct SSE. No new judgment model,
whole-response review, prompt-reminder patch or second prose draft is proposed.

## Confirmed cause

The inspected baseline failed through shared write authority over decisions,
prose and occurrences:

- `runtime/turn-packet-prototype.ts` embeds the storage-oriented `TurnEvent` in
  model output. Its response only offers `actor/act/points/stance`; it cannot
  declare an addressee, emotional state or directed relationship.
- `shared/turn-event.ts` permits `summary` (1,200 characters), each material's
  `text` (4,000), speech, knowledge statements and relationship statements. Its
  speech contract explicitly asks for exact future words reused verbatim.
- `extensions/kernel/lean-apply.ts` still exposes the mixed `apply {effects,event}`
  path. Changing output alone leaves another writing entrance.
- `turnPacketSystemPrompt` replaces only Public response. Inherited event and
  prospective-speech obligations remain. The model is given contradictory jobs.
- The host then invokes `writeIsolatedExpression`, producing prose a second time.
  Tests of field names and maximum lengths did not establish that points were
  semantic parameters rather than complete short dialogue.

The retained current-contract red probe accepts complete speech through both
native output and raw apply, and accepts complete short dialogue in points. It
rejects the requested audience/state/relationship fields. This is a reproducible
interface defect; no inference about hidden model intentions is necessary.

## The replacement interface

Use one optional-field packet: `version`, `commands`, `interactions`, `reveal`.
Empty unchanged categories are omitted. Keep the existing public tool name
`output`; there is no need to add a ninth verb called decide.

```json
{
  "version": 4,
  "interactions": [{
    "actor": "npc_1",
    "to": ["investigator_1"],
    "act": "answer",
    "content": [
      {"fact_ref": "clinic_hours"},
      {"source_ref": "source_clinic_hours"}
    ]
  }]
}
```

`act + selected content` expresses what the person intends to communicate.
`to` expresses the actual recipient, which may be another NPC. Neither requires
a ready-made sentence. Prior personality, current emotional state and directed
relationships come from canonical host projections. A changed state/relationship
uses its canonical command once; do not add shadow state in response.stance.

Existing fact references preserve their evidence class: a report, belief, plan
or intention does not become world truth because the field is called fact_ref.
Existing source references select exact prepared fragments, including revision,
range, scope and disclosure eligibility. A source document ID is insufficient.
Jev selects candidates when necessary; the host retrieves the actual source
bytes. Neither component invents event prose, and routine ready material incurs
no mandatory fresh Jev request.

New content uses registered closed constructors, with concrete typed parameters.
For example, `service_at(provider, items, when, fulfillment)` or
`planned_visit(actor, to, when)` expresses content without writing the dialogue.
These are **illustrative constructors**, not an already implemented complete
ontology. Do not add statement(text), free predicate labels or arbitrary args
that recreate a text box under another name. Reuse existing module and kernel
field semantics; add a constructor only for a demonstrated unsupported semantic
operation. No model generates a fresh schema each turn.

The implemented constructors are service_at, planned_visit, whereabouts,
knowledge_status, directions and input_requirements. Directions was added after a live stationary
directions question produced an empty answer plan. Substantive speech acts now
require nonempty selected content; greetings, acknowledgments and refusals may
omit it. This validates the presence of communication meaning, not its relevance.
Directions are communication only and never imply movement.

Canonical App validation also demonstrated a missing generic procedural meaning:
the clerk could not express which input details a search needs, and selected
directions instead. input_requirements(topic,fields) now represents that claim
with closed information-role names, not a free-text answer or arbitrary slots.
It neither starts work nor overrides actual mechanical requirements. This uses
the established distinction between requested parameters and task execution in
[Rasa collect steps](https://rasa.com/docs/reference/primitives/flows/)
and [Dialogflow form parameters](https://docs.cloud.google.com/dialogflow/cx/docs/concept/parameter).
Those systems normally collect values to execute a task; here the constructor
only supplies NPC communication meaning to the author and runs no extra stage.
The red regression rejects the required answer under the preceding schema;
the narrow addition retains one KP decision and one author.

A new claim is not a state write. Mentioning a proposed visit does not move its
subject; offering takeaway does not place an order or debit a purse. Establishing
world facts or commitments still requires the corresponding authorized command.
The author can invent wording and small expressive gestures, not consequential
facts. Schema validity alone cannot prove relevance, truth or semantic fidelity.

## Scope the prototype honestly

[Pro review schema](decision-only-kp-v4/pro-review.schema.json) preserves the
consultant's exact JSON. Its `urn:kp:kernel-command:v4` is an **unimplemented
placeholder**, not an existing registered kernel union. It cannot be installed
as-is. Broad string refs in that review also need typed, scoped binding.

[Prepared executable example](decision-only-kp-v4/prepared-example.schema.json)
resolves every reference and narrows supplied aliases. It binds only the actual
existing move/scene signatures, plus the two illustrative constructors. It is a
small design probe, not a replacement for the full production capability set.
[Examples](decision-only-kp-v4/examples.json) cover movement, source selection,
NPC-to-NPC communication, a future-visit claim and an offer without a purchase.

Before production rollout, assemble the command union from actual registered
canonical signatures, preserving every supported mechanical variant, rule
range, authorization, failure, idempotency and reconciliation owner. Do not hide
all old tools while silently dropping checks, transactions, documents, combat,
NPC state or directed relationship capability. Rule-bearing input stays explicit;
host-owned reason strings, IDs, defaults and audit fields do not burden the KP.

Source and fact references must be validated for their *role*, not only syntax
or membership in a combined alias table. Speaker knowledge and recipient
eligibility remain authoritative. Remote channels and overhearers require actual
channel/presence evidence, not a model-supplied claim of consent.

## Ownership and execution

| Producer | Reader | Actor and effect |
| --- | --- | --- |
| Existing canonical state | Host character projection | Author receives public identity, state, relationships and compatible voice |
| Existing source/Jev candidate selection | Typed fragment binding | Host gives author selected eligible bytes; no KP copying |
| KP command proposal | Canonical command adapter | Existing kernel performs admission, rules, RNG and transactions |
| Actual kernel outcomes | Author context assembler | Author depicts changed/unchanged/refused results without inventing success |
| KP interactions and new content parameters | Host binding and one author | Author alone chooses complete narration and dialogue |
| Actual delivered text with delivery/channel evidence | Existing background memory | Records only supported occurrences; never upgrades the entire plan to heard |

Bind all inputs before performing writes. Unknown fields, stale refs and failed
bindings reject atomically; never strip illegal fields and commit the remainder.
Apply authorization at the canonical model-origin dispatcher, including aliases,
legacy adapters and gateway calls. Internal host settlement retains its existing
authority. Hiding the raw mixed tool alone does not enforce this separation.

Ordinary dialogue: one KP packet, no model-side apply, one author. Known movement:
one KP packet, existing settlement, one author. Only genuinely new information
requiring another open semantic decision justifies another KP inference. An
acknowledgment, receipt copy, default fill or publication retry does not.

The author receives once: original player input; settled public scene and clock;
actual results; projected public cast and directed relationships; selected,
hydrated materials; relevant actual recent dialogue. It does not receive whole
private dossiers or a second collection of pending unselected replies. Current
state wins over stale historical location/name descriptions.

Preserve the current direct author transport: one tool-free task with one request,
forward visible provider deltas immediately, retain the same text, use existing
speech attribution. Do not buffer the full story and simulate streaming. Do not
remove the current failure/publication guards or change kernel semantics.
For native packets, an atomic attempt known not to have committed is a failure
result, not a permanent veto over independent later results. Project only its
closed tool/status/reason metadata alongside canonical settled results; keep
the refusal ledger. Unknown execution, partial settlement or incomplete held
coverage still veto author startup. The free-form Keeper guard is unchanged.
This follows task-local error handling in [AWS Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
and [Azure Durable Task](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-error-handling):
catch a failed activity explicitly rather than fail every later activity. Their
workflow runtimes do not solve prose fidelity; our kernel receipts remain the
only authority for actual changes, and the author receives no failed proposal
text. This is an execution-state distinction, not a prompt correction.

## Memory and working-material continuity

Before publication, communication is pending. Author completion alone does not
prove that each planned proposition was spoken or heard. Existing background
memory consumes the actual delivered fragments and publication-time audience
and channel evidence. Omitted or interrupted content stays omitted/partial.
Private offscreen communication needs its actual communication evidence.

The next turn reads committed state and the delivered raw tail not yet covered
by memory; it does not wait for background extraction. Late summaries cannot
overwrite newer state. Reuse a material only while its world/source, actor scope
and disclosure binding remain applicable. A scope or source change retires the
binding, not the immutable evidence. Do not equate cache hits with avoided reads.

## Prompt artifacts

[Keeper instruction](decision-only-kp-v4/keeper-prompt.md) and
[author instruction](decision-only-kp-v4/author-prompt.md) describe the separated
jobs. They are not installed. Replace contradictory old capability instructions
when the matching interface is wired; do not append another reminder to them.

The Pro text said no tags. That cannot be copied literally: the current host
uses private framing and speech attribution. Preserve that transport contract;
players still receive ordinary story text. The Pro's external command reference
also needs real binding rather than an invented capability declaration.

## Evidence and next acceptance

The probe `pro-schema-probe.mjs` in the retained prose-contract experiment uses
current TypeBox validation and explicit alias-role binding. Result: **5 accepted
examples, 17 rejected inputs**, zero model requests. Rejections include old event,
summary, material text, knowledge statements, points/intent/stance, generic
statement constructors, unissued references, ref role confusion, silent content,
wrong audience and model-supplied success/duration. Capacity admission used an
empty synthetic workspace, a 1 MiB output bound and 140,009,476 KiB free space.

This proves the proposed *shape*, not production enforcement, source privacy,
meaningfulness, full mechanic coverage or speed. The earlier exploratory probe
with separate response state/relationship fields is superseded by the single
canonical projection design; its evidence remains retained.

Production acceptance must cross the real dispatcher: old writes rejected before
any effect; NPC-to-NPC retains recipients; genuine actions settle exactly once;
rejected operations cannot be narrated as successful; hidden or stale material
cannot enter the author; unspoken content cannot become heard; browser paints
new text before generation completes. Then use real consecutive MiniMax
M3.1 Flash Preview/medium turns, one natural player input at a time. Measure the
whole intent, actual state, first text, total wait, primary/author/Jev calls and
retrieval/tool rounds, including retries. Do not substitute this schema probe.

## External cross-check and consultation

[Rasa NLG](https://legacy-docs-oss.rasa.com/docs/rasa/nlg/) separates dialogue
policy response/action selection from surface text generation using arguments.
[Policy-Driven Neural Response Generation](https://arxiv.org/abs/2005.12529)
separates knowledge/dialogue-act planning from realization. Both support the
ownership split; neither proves that free text named intent cannot contain full
dialogue, nor guarantees lower latency in this system. Their fixed response or
knowledge inventories differ from open improvisational TRPG content.

[GPT Pro consultation](https://chatgpt.com/c/6ad460a9-c1b4-832b-af25-1455cda204e4)
reviewed supplied source excerpts and timings, not the live repository. The
first response suffered an interrupted long delivery. A concise follow-up
completed and supplied the preserved schema and two prompt drafts. Pro agrees
that the mixed contract is the root error and maxLength is not a semantic guard.
Its advice was checked against actual code; it is not implementation or live
acceptance evidence. The review itself changed no production behavior; the
subsequently approved implementation is the working-tree change above.

## Implementation validation in progress

runtime/decision-content.ts owns the bounded catalog (256 active fragments,
32 KiB approximate payload budget), stable aliases and current reference scope.
Current source selections are explicitly player-eligible material, not arbitrary
private module spans. Existing actor knowledge retains speaker attribution.
Only selected contents are hydrated for the author. Omitted material remains
omitted; this is not a completeness claim for all source operations.

The native dispatcher refuses old prose/event parameters before writes, including
gateway calls carrying a policy origin. Only the private host compilation token
can submit the machine-generated relationship event. Character projection reads
the canonical evidence-array shape, and created-person aliases bind nested claim
entity positions without rewriting original source text. Actual delivery, not
selected communication, remains the memory input.

The first live MiniMax pair is retained as failed-intent evidence: confirmation
completed in13.5s; a stationary directions question took16.7s but did not answer
the question. Each used one KP packet and one author, without retrieval. The
empty answer exposed the missing content requirement and directions constructor.
It is not counted as a successful speed comparison. A fresh build and consecutive
live test are required after the fix.

Live run kp-decision-v4-b-20261019 tested committed c27b789a5. Confirmation took
20.044s (including one upstream500 retry), and stationary directions27.633s.
The latter still failed the intent: Marathon Cafe was advertised in prepared
movement but absent from the communication entity set; after refusal the KP
submitted an acknowledgment without directions. The follow-up joins visible
place and prepared-operation targets into the one reference set and binds its
role-specific selections into the provider schema as well as local execution.
The schema no longer advertises an arbitrary string waypoint as a reference.
This adds no judgment, silently discarded argument or automatic world action.
The interrupted c27 full-suite invocation is retained; it is not a completed run.

Live C (8b78104bf, MiniMax3.1/medium) completed four consecutive player intents:
confirmation16.139s, stationary directions23.322s, movement/greeting25.067s,
and NPC inquiry22.414s. Total86.942s, five KP requests, four author requests,
four output submissions and no foreground retrieval. The extra KP request was
a provider thinking-only completion, not a tool refusal. Only the movement
changed scene/clock; the paid service was not charged again and the spare film
remained player-owned. The final inquiry selected an existing exact NPC report.
All four new background jobs finished; four inherited pending jobs remain.

The same-start historical v3 sample took133.823s with seven KP requests and six
tool submissions. The observed difference is35.0%, not a controlled causal or
statistical result. Dynamic reference enums also changed the tool prefix: most
C requests reported only128 cache-read tokens. Catalog reuse is not proof of
provider cache reuse. Recorded foreground admission contains one Jev call on
the move; the experimental HTTP observer missed it, so total HTTP counts are
unknown rather than zero.

Browser inputs85/86 on8b verified visible incremental author text, but86 exposed
a typed-reference defect: a whereabouts destination accepted investigator_1.
The source role producer now separates people and places; both the provider
schema and host binding require people for subjects and places for destinations
and waypoints. The reproduction failed before the fix and passes after it.
This preserves the existing constructors, exact material and transaction paths;
it adds neither semantic name classification nor a judgment model. A fresh
runtime/live validation is still required for this follow-up.
