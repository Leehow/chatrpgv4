# Storylet Schema Addendum: Cognitive Functions

Storylets remain presentation devices. They may change delivery, emphasis,
pressure, cost, or framing, but must never invent a culprit, faction, god,
motive, or final truth.

## Optional cognitive fields

```json
{
  "epistemic_functions": ["confirm", "complicate"],
  "question_layers": ["fact", "motive"],
  "requires_reveal_contract": false
}
```

`epistemic_functions` accepts only `confirm`, `expand`, `complicate`,
`reframe`, and `payoff`.

`question_layers` accepts only `fact`, `identity`, `method`, `motive`,
`causal`, `structure`, `world`, and `personal`.

A storylet tagged with `reframe` must set
`requires_reveal_contract: true`. At runtime it is eligible only when a
matching resolved effect carries a non-empty `reveal_contract_id`. `HOLD` and
`NONE` contracts never summon cognitive storylets. Legacy storylets without
these fields retain their existing behavior.
