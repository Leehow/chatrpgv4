# EL-16: Offered feature references are readable

## Evidence and intent

Original App turn95 naturally completed in129.295s with one recovered tool error.
The catalogue offered a feature as `owning place / feature`; reading that exact
name reported it unregistered. The Keeper then reused it as an observation place,
which correctly refused `place_observation_point_unresolved`. This is an identity
read/write seam, not a missing fictional window or a reason to weaken admission.

## Contract

Keep places, registered features and descriptive spots distinct. A context or
observation inspection first resolves an actual exact place. If that fails without
ambiguity, an exact qualified feature reference already present in storage can
resolve to its owning place and `at`. Never split an arbitrary slash-delimited
string, infer a feature from prose, create a definition, or convert a write silently.
Explicit at/spot inputs retain their existing shape and validation. A real child
place with the same text wins as a place; ambiguous names remain ambiguous.

Context reads return `reference` with a closed kind (`place`, `feature`, `spot`)
and the canonical spatial point, plus the selected `target_feature` or `target_spot`
when present. Catalogue rows provide the same typed reference and an executable
read pointer. Historical `name`, `place`, `feature`, kind and identity fields stay
readable. The host's identity projection preserves these reference/read fields.
Observation inspection uses the same read resolution and returns the canonical
target under its existing observation.to. These remain Keeper preparation reads.

An observation write mistakenly using a known qualified feature as its place
continues to refuse before execution, but names that feature's canonical point
in correction details. Its corrected ordinary proposal still passes all shape,
access, coverage, admission, relation and atomic transaction checks. No state,
time, route or player knowledge is inferred from the reference.

Writer: the existing location registry and read projection. Reader: the current
place result and demand identity projection. Actor: the Keeper copies the returned
place/at fields into its selected ordinary commands; existing tools settle once.

## Cross-check

[JSON:API resource identity](https://jsonapi.org/format/#document-resource-identifier-objects)
distinguishes type from identity. [OpenUSD SdfPath](https://openusd.org/24.08/api/class_sdf_path.html)
distinguishes scene prim paths from property paths. Both support keeping the
resource's role explicit rather than treating every displayed path as a container.
Their transport and scene schemas differ from this TRPG runtime: retain its
existing names and transaction authority instead of adopting either format.

## Validation

The real-RPC minimal regression reads the catalogue's own offered window and
asserts canonical target identity with no world change. Extend it to explicit
at/spot input, observation history, an exact child-place collision, ambiguity and
atomic write correction. Prove the host projection keeps the actionable fields.
Run focused regression, package the sole canonical App from clean source, and
continue the original session. Component green is not real-play acceptance.
