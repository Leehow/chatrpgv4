# EL-06: Descriptive local positions and faithful observation viewpoints

Status: implementation follow-up to the approved location system and Pro review.
Normative owner: kernel RPC section 242. Scope remains Enhanced Locations with
the TS kernel and host support it requires. Original-session inputs 67 and 68
are preserved failing acceptance evidence, not fixtures to rewrite.

## Intent and failure

The player should be able to stand on a compatible sidewalk or in an ordinary
corner without first registering that position as an interactive fixture.
Input 68 selected a sidewalk; recovery repeatedly proposed the known entrance
path and was correctly refused. Existing at means an exact registered feature.
Changing that meaning implicitly would blur feature state and spatial identity.

## Contract

- Keep at as an exact registered feature reference. Add optional spot, a bounded
  local spatial description, to place move and observation target points.
  A command/point cannot contain both. A descriptive spot creates no feature,
  child place, passage, item, NPC, obstacle state or discovered clue.
- Keep place identity mandatory. New places still need minimal compatible
  additions, and cross-place journeys still use canonical route/time handling.
  A spot cannot cross a known barrier or authorize entry by itself. through and
  feature mutations retain their existing validation and consent.
- The Keeper writes the selected spot through place move. Its real receipt and
  Mod position persist place/spot/relation. Readers project all three; canonical
  position proof, ordered consent positions and final route coverage use the
  same representation. Known features are references, not an exhaustive list of
  legal positions. Unknown at still fails; callers must explicitly choose spot.
- SpatialPoint accepts spot and relation alongside legacy at. Observation
  origin retains the actual position, including its relation. Public observation
  projection preserves those fields. Point identity and directed relation
  matching distinguish descriptive spots and relevant relation values.
- Observing a descriptive target is perception only. Registered target_feature
  data is supplied only for at; spot supplies its descriptor, never fabricated
  feature state. Existing observation chronology and event assessment remain.
- Interactive feature creation/promotion remains an explicit ordinary additions
  operation. A descriptive spot can later be referred to when authoring layout;
  it is never silently converted to an unlocked/purchasable/passable fixture.

## Version and compatibility

Enhanced Locations 1.2.0 requires locations.position.v2. The kernel advertises
that capability and rejects new spot writes from a provider lacking it. The
Mod storage schema remains 1: spot is an optional position/point field and no
old records are rewritten. at-only state keeps its meaning. New readers can
read both. Disabling the Mod retains readable places and allows ordinary exit
through the existing movement owner. No Python, generic world patch or new
transaction engine is introduced.

## Three ends and validation

Writer: stageLocation and stageLocationObservation through existing apply
transactions. Readers: locationView, currentObservationPoint, observation routes,
publicObservation, consent positions, route coverage and the sole author input.
Actor: Keeper chooses/observes the selected local position, receives the real
receipt, then narrates its supported perspective. Evidence is that final delivery
and receipt pair; declarations alone are insufficient.

Lock down: unregistered spot without feature creation; exact at refusal;
at/spot conflict rollback; persisted spot after restart; observation clocks and
origin relation; no cross-view access borrowing; fixed barrier refusal; native
schema/compiler/admission/coverage field parity. Keep .60/.40 gates and numeric
time rules unchanged. Use original App/backend via ego browser for real sidewalk,
corner, return and wait/view acceptance, with no scripted player or hard cutoff.

## External comparison

[Fate movement](https://fate-srd.com/fate-core/movement) uses coarse zones and
actual opposition/obstacles rather than requiring every local detail to be a
discrete location. [Evennia exit traversal](https://www.evennia.com/docs/latest/Components/Exits.html)
keeps source, destination and traversal hooks explicit. These confirm separating
descriptive local precision from real crossing checks; neither supplies our
consent rules, time arithmetic, source truth or exact storage design. This is a
bounded extension to existing positions, not a wholesale coordinate simulation.

## Remaining follow-ups

Independent event identity/knowledge and partial activity delivery remain separate
review directions. A read-only output-schema factoring probe found 75,303 to
26,319 bytes with sampled validation parity. JSON Schema and xAI document
noncircular defs/ref support, while an Anthropic managed-tool surface asks for
inlining. Do not assume universal provider support or claim latency improvement
before actual wire and original-session verification. That probe is not installed.

Request-only follow-up: original69/70 successfully deliver70.866s/68.735s with
zero tool errors and canonical descriptive viewpoints. Original71 delivers147.039s
after a justified missing-post-wait-observation refusal; it fails the120s gate.
Keep that record and full checks. The Grok4.5 Responses declaration now shares
identical repeated schemas through local nonrecursive refs. Independent expansion
reproduces all inline JSON structure across arrived/unarrived and current/empty
bindings; mutation checks preserve acceptance. Existing reference scopes skip
sharing, Messages and unverified models stay inline. No provider or latency
claim follows from static equivalence alone. Enhanced Locations1.2.1 clarifies
the resulting observation after listening across a wait, before moving onward.
Sources: [JSON Schema](https://json-schema.org/understanding-json-schema/structuring)
and [xAI schema support](https://docs.x.ai/developers/model-capabilities/text/structured-outputs).
