# Pi-Coc legacy-surface retirement audit — 2026-09-01

Track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`. Base:
`claude/pi-coc-family-projectors-20260831` @ `be066654`.

Scope: the retirement stage the ten-family RuleGraph cutover left undone.
Every operation below is `kp_surface: "none"` in the canonical policy
(`plugins/coc-keeper/scripts/coc_operation_policy.py`). Enumeration:

```bash
uv run --frozen python -c "
import sys; sys.path.insert(0,'plugins/coc-keeper/scripts')
import coc_toolbox, coc_operation_policy as pol
for op in sorted(coc_toolbox.TOOLS):
    p = pol.policy_for_operation(op)
    if p['kp_surface'] == 'none':
        print(op, pol.model_invocation_tool(op))"
```

45 operations have `kp_surface: "none"`; 36 have
`model_invocation_tool(op) is None` (no model-facing invocation at all);
the other 9 are the `coc_invoke` compatibility set.

## Classification

Classes:

- **(a)** load-bearing internal adapter — the graph or host dispatch still
  calls it (spec R3 retains legacy implementations as `rules.settle`
  executors; deleting them breaks the graph).
- **(b)** host-lifecycle machinery — never a Keeper rule-family operation.
- **(c)** pure Keeper-surface remnant with no remaining caller — none found
  at the operation level; the remnants that remained were *references* on
  the Pi model surface (see "Remnant references" below).

`RC:` = `plugins/coc-keeper/scripts/coc_operation_rules_core.py`,
`K:` = `plugins/coc-keeper/scripts/coc_operation_kernel.py`.

| Operation | Family | Class | Pinning caller (evidence) |
| --- | --- | --- | --- |
| `rules.first_aid` | healing | a | `_tool_rules_settle` adapters map `"first_aid"` (RC:1313); graph settle executes it for `decision:coc7:healing:first-aid-*`; shadow comparator K:8066; must-pass adapter tests `tests/test_rules_runtime.py` |
| `rules.medicine` | healing | a | adapters map `"medicine"` (RC:1314); same consumers |
| `rules.dying_check` | healing | a | adapters map `"dying_check"` (RC:1315) |
| `rules.weekly_recovery` | healing | a | adapters map `"weekly_recovery"` (RC:1316) |
| `rules.roll` | core-check | a | adapters map `"check"` → `_tool_rules_roll` (RC:1317); listed in `MCP_LISTED_HOTSET` (`coc_mcp_contract_archive.py:36`, served by `mcp/server.py:1051` on direct-MCP hosts); receipt identity for push/first-impression chains |
| `rules.opposed` | core-check | a | adapters map `"opposed"` (RC:1318) |
| `rules.check` | core-check | a | §11.1 retained cross-ruleset low-level primitive (spec directive; R5 policy override keeps it host-internal) |
| `rules.push` | push-luck | a | adapters map `"push_policy"` → `_tool_rules_push` (RC:1319); push receipt identity throughout K (e.g. K:3453, K:5261-5485) |
| `rules.luck_spend` | push-luck | a | adapters map `"luck_spend"` (RC:1320) |
| `rules.social_adjudicate` | social | a | **registry-name dispatch** `_registered_adapter("rules.social_adjudicate")` (RC:1297) — the registration itself is the settle executor lookup |
| `rules.psychology_observe` | psychology | a | `_registered_adapter(...)` (RC:1298) |
| `combat.resolve` | combat | a | `_registered_adapter(...)` (RC:1299); `host_capability_index` `typed_operation` (`rulesets/coc7/rule_graph_adapter.py:552`) |
| `combat.end` | combat | a | `_registered_adapter(...)` (RC:1300) |
| `combat.context` | combat | a | `dispatch_rules_context` invokes `_tool_combat_context` for family=combat canonical context (K:7277) |
| `rules.sanity_check` | sanity | a | `_registered_adapter(...)` (RC:1301); graph capability `rules.sanity_check` |
| `sanity.execute` | sanity | a | `_registered_adapter(...)` (RC:1302); adapter for six sanity session capabilities |
| `sanity.context` | sanity | a | capability key mapped to `sanity_execute` (RC:1330); `_tool_sanity_context` in `dispatch_rules_context` (K:7288) |
| `magic.cast` | magic | a | `_registered_adapter(...)` (RC:1303) |
| `magic.learn` | magic | a | `_registered_adapter(...)` (RC:1304) |
| `state.end_session` | development | a | `_registered_adapter(...)` (RC:1305); ending phase inference host-side (`pi/lib/domain-tools.ts:795`) |
| `development.settle` | development | a | `_registered_adapter(...)` (RC:1306) |
| `chase.execute` | chase | a | `_registered_adapter(...)` (RC:1307), bound to all six `chase_*` capability keys |
| `chase.context` | chase | a* | no Python-internal invocation found; retained as the canonical chase context surface for direct-MCP hosts (non-Pi discovery serves every descriptor, `mcp/server.py:250-254`) and named in `rule-graph-manifest.json` `resolver_capability_dependencies`. Family already pinned by `chase.execute`. |
| `rules.resource_delta` | (cross-family) | a | §11/§11.1 retained low-level state-effect primitive; exceptional-effect mechanics kind `resource_delta` (`coc_exceptional_effects.py:27`) |
| `progressive.claim_host_work` | — | b | source-worker lease loop, `pi/lib/runtime.ts:894` |
| `progressive.fulfill_host_work` | — | b | `pi/lib/runtime.ts:966,3201` |
| `progressive.renew_host_work_leases` | — | b | `pi/lib/runtime.ts:2899` |
| `progressive.release_host_work_leases` | — | b | `pi/lib/runtime.ts:2684` |
| `progressive.publish_skeleton` | — | b | source-worker lifecycle (`SOURCE_WORKER_LIFECYCLE_OPERATIONS`) |
| `progressive.status` | — | b (compat) | host status probe; `pi/extensions/index.ts:14008`, `coordinator.ts:1726` |
| `progressive.project_opening` | — | b (compat) | host opening projection |
| `progressive.register_source_bundle` | — | b (compat) | host source registration |
| `progressive.request_opening_pack` | — | b (compat) | host opening pack request |
| `progressive.request_locator_pass` | — | b (compat) | host locator pass |
| `progressive.retry_full_parse` | — | b (compat) | host parse retry |
| `session.begin` | — | b (compat) | host session bootstrap (`coc_operation_setup_session.py`) |
| `session.continuation_detail` | — | b (compat) | continuation cards advertise it via `coc_invoke` (`coc_mcp_wire.py:2544`) |
| `session.delivery_ack` | — | b (compat) | delivery acknowledgement loop (`pi/extensions/index.ts:8040`) |
| `state.recover_pending_narration_draft` | — | b | host recovery machinery |
| `steward.deliver` | — | b | steward subagent write path (`coc_operation_steward.py:247`) |
| `steward.domain_put` | — | b | steward subagents by design (`pi/agents/steward-*.md`, `pi/extensions/index.ts:8536`) |
| `steward.mark_consumed` | — | b | steward machinery |
| `steward.notebook_pay` | — | b | steward machinery |
| `steward.notebook_put` | — | b | steward machinery |
| `steward.scene_bundle_put` | — | b | steward scene subagent (`pi/agents/steward-scene.md`) |

## Family lifecycle outcome — all ten stay `hidden`

`removed` per `docs/ruleset-contract.md` means "the obsolete
descriptor/adapter has been deleted", and spec §14.4 progresses a family
`hidden → removed` only "where the internal Adapter no longer earns its
keep". Every family's legacy adapters ARE the graph's settle executors
(spec R3: the graph does not reimplement mechanics), so no family's adapter
is deletable, and seven of ten families additionally dispatch those
executors **through the operation registry by name**
(`_registered_adapter`, RC:1297-1307), which makes the registration itself
load-bearing:

| Family | Stays `hidden` because |
| --- | --- |
| healing | four adapters are direct settle executors (RC:1313-1316) |
| core-check | `check`/`opposed` settle executors; `rules.check` §11.1-retained; `rules.roll` in the MCP hotset |
| push-luck | `push_policy`/`luck_spend` settle executors |
| social | registration-dispatched executor (RC:1297) |
| psychology | registration-dispatched executor (RC:1298) |
| combat | registration-dispatched executors (RC:1299-1300) + context handler (K:7277) |
| sanity | registration-dispatched executors (RC:1301-1302, 1330) + context handler (K:7288) |
| magic | registration-dispatched executors (RC:1303-1304) |
| development | registration-dispatched executors (RC:1305-1306) |
| chase | registration-dispatched executor (RC:1307) |

Two additional structural blockers apply to *descriptor* deletion even
where the settle dispatch is a direct function reference:

1. **Cross-track surface.** The MCP transport hides operations from
   discovery only for `COC_HOST=pi` (`mcp/server.py:250-254`,
   `_PI_KEEPER_PRIVATE_LIFECYCLE_OPERATIONS`); on every other host the full
   descriptor archive is still served and directly invocable. Deleting a
   descriptor therefore changes the Codex-host Keeper surface — off-limits
   under the pi-coc track lock without explicit authorization.
2. **Must-pass adapter contracts.** The retained internal adapters are
   exercised through the registry by name across
   `tests/test_rules_runtime.py` (must-pass), `tests/test_toolbox*.py` and
   the shadow/parity suites. Spec §14.4 moves such tests to the
   RulesRuntime interface *when the adapter is deleted* — these adapters
   are not deleted, so the tests remain their contract.

The three ownership sources already agree at `hidden` for all ten families
(package `manifest.json` `rule_families`, graph `legacy_surface_lifecycle`
/ `family_runtime_ownership`, graph-manifest
`family_promotion_eligibility`); no lifecycle edit is performed, and the
production graph artifact is untouched.

## Remnant references on the Pi model surface (the defect source)

The half-retired state's live defects all shared one shape: a model-facing
Pi surface naming an operation the execute ACL then refuses
(`host_private_operation` / `policy_forbidden`). The remaining static
instances found by exact-token scan of `pi/lib`, `pi/prompts`,
`pi/extensions`, `pi/agents`:

1. `pi/lib/domain-tools.ts` `DOMAIN_TOOL_DESCRIPTIONS.coc_subsystem` —
   model-visible tool description says "Player attacks and shots require
   combat.resolve; never substitute rules.roll" — both host-private.
2. `pi/lib/mechanical-output-gate.ts`
   `MECHANICAL_OUTPUT_GATE_INSTRUCTION` — gate refusal instruction tells
   the Keeper to roll via "rules.roll / rules.opposed / sanity.execute"
   — all three host-private.
3. `pi/lib/tool-working-set.ts` `SHADOW_HEALING_LEGACY_OPERATIONS` — dead
   export (zero importers) naming the four healing legacy operations.
4. `pi/prompts/host-system-play.md` — combat block instructs
   `combat.resolve` via `coc_subsystem` and `rules.roll`/`rules.opposed`
   for Firearms (lines ~331-352); ending flow instructs a direct
   `state.end_session` call (~383-388); `rules.push` decision-id example
   (~198); `combat.resolve` consumer mention (~302); first-contact
   `rules.roll` (~376).
5. `pi/prompts/host-system.md` — first-contact `rules.roll` mention (~93).
6. `pi/prompts/host-system-setup.md` — `rules.push` decision-id example
   (~83).

Everything else the scan hit is host-internal machinery that legitimately
consumes operation names as data (settle-route processing and identity
tables in `tool-contract-projection.ts`, typed-binding lifecycle in
`extensions/index.ts`, receipt keys, phase-inference evidence probes) —
those names survive retirement because canonical receipts carry them.

Plan of record: fix items 1-6, then add a derived drift guard
(`tests/pi/host-private-model-surface.mjs`) that fails when any
`kp_surface:"none"` operation outside the `coc_invoke` compatibility set is
referenced from the Pi model-facing surfaces, with both sides derived from
the generated policy and the real artifacts (no hand-listed allowlist).
The MCP `listed_hotset` (`rules.roll`, `rules.sanity_check`) is a direct-MCP
host surface and is deliberately left alone under the track lock; noted
here for the Codex-track owner.
