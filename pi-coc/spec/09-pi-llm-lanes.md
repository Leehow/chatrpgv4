# 09 — Pi and LLM lanes

**LLM-001.** Pi is integrated through `PiSessionFactory`; domain code never treats Pi chat history as world history.

**LLM-002.** Director, Narrator, and Verifier have separate contracts, context views, tools, schemas, receipts, and failure policies.

**LLM-003.** Director receives Keeper-authorized context and read-only domain tools, returns `TurnPlan`, and cannot commit state.

**LLM-004.** Narrator receives only `NarrativeFrame` plus presentation contract and has no graph, rules, filesystem, network, or mutation tools.

**LLM-005.** Verifier audits claimed facts, visibility, actor knowledge, and style; it rejects or performs bounded repair.

Use Pi's programmatic session API with a custom resource loader and explicit tool list. Propose Pi Core changes only after the adapter is proven insufficient.
