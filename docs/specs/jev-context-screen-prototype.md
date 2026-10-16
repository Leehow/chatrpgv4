# Jev context screening prototype

Status: experiment only; no production rollout or gameplay acceptance.
Owner request: design and prototype the proposed context screening, 2026-10-15.

## Question

Can typed screening reduce the material a single Keeper reads while retaining the
capabilities actually used and independently annotated relevant NPC evidence?
Does Jev 1.14 or complete long-context packing improve that tradeoff?

## Boundary and ownership

Read immutable recorded Pi events, never reopen or mutate a campaign. The host
enumerates canonical capability cards, whole Mod instructions and individual NPC
evidence records. Jev selects only issued aliases. The host projects unchanged
source bytes; the same KP remains the causal judge and author. This prototype
does not execute tools, publish prose, grant knowledge or authorize player actions.

Producer: recorded canonical tools, capsule and actor views. Reader: the isolated
screening request. Actor: the experimental projection builder, which selects
unchanged records and reports retained bytes and missing evidence. There is no
production consumer until a separately approved integration passes real play.

## Projection

- Keep all tool names and purpose cards visible through the existing fixed
  capability envelope; attach selected exact capability detail. Keep canonical
  validation untouched. Missing detail requires the existing expansion path.
- Keep the current module, style, actor identity, current state, cognition,
  relationships, recent speech and active intentions. Screen complete Mod bodies,
  historical terminal intentions and promise records. Preserve actors separately.
- Report the structural-only baseline separately: ledger memory-reference lists
  are an index rather than readable evidence, and already projected current actor
  state is not another semantic selection saving. Omitted historical material
  remains explicitly omitted and recoverable through ordinary recall.
- Candidate relevance includes prerequisites, contrary evidence, corrections and
  consequences of the chosen act, not merely lexical similarity to player text.
- Selection is not source support, disclosure permission or a rules verdict.
- A failed or missing answer retains that candidate. A candidate is omitted only
  when every requested Noul is below 0.25. No post-result threshold tuning.

## Experimental arms

1. Full recorded view, no API call.
2. Structural projection only, no API call.
3. Same typed questions and compact shared context, Jev 1.13, ordinary packing.
4. Identical semantics, Jev 1.14, ordinary packing.
5. Jev 1.14, identical complete candidates, demand-driven long-context packing.

Whole candidate records live in their own question instruction, rather than all
being broadcast in shared state. Independent questions share one current-turn
context. The long arm changes packing, never truncates or invents candidate text.
Its header is enabled only when the larger proposed group fails ordinary packing.
Per-request UTF-8 byte bounds remain conservative token upper bounds.

Freeze the six recorded cases (turns 1, 3, 5, 8, 10, 12 of the retained road run),
source hashes, observed tool-use lower bound, manual NPC anchors, prompts and
threshold before requests. Historical tool use is a coverage lower bound, not
proof that each call was necessary. Negative/contradictory boundary probes are
reported separately from recorded cases and never called live gameplay.

Report exact serialized projection bytes, actual Jev tokens/model/latency,
estimated listed-price cost, missing observed capabilities, manual anchor recall,
unavailable answers and conservative fallback. Byte savings are not Grok token,
quota, quality or latency savings. Calls spent screening must be counted. No
automatic deployment follows a favorable experiment.

Use the existing decision adapter and canonical credential reader. Maximum actual
input allowance is five million tokens (listed cost USD 0.21), no automatic retry,
no new dependencies, and no generative LLM. Preserve original and failed evidence.

## External comparison

- https://docs.typesafe.ai/models#long-context: ordinary 64k/32k limits;
  explicit 262k long-context option, same price per token, slower/less accurate.
- https://docs.typesafe.ai/cookbooks/skill_suggestion: progressively read complete
  capability descriptions and permit no match. Its suggestion keeps the original
  roster; it does not prove safe schema removal in this product.
- https://docs.typesafe.ai/cookbooks/classifying_rag_passages: separate useful
  evidence from premise conflicts. The prototype retains related contradictory
  material instead of allowing relevance filtering to erase it.

The sources support bounded selection, not automatic authority or an assertion
that filling the longest window improves accuracy.

## Experiment decision

The six-case replay is retained in
`.coc/experiments/jev-context-screen-20261015/report.md`. Long packing reduced
screening calls and repeated input; it did not fix missing capability detail.
Keep every canonical tool definition in the first integration slice and evaluate
only optional material selection. Its post-hoc byte ablation still saves 19.47%.
This is a recommendation, not a production default change or acceptance result.
