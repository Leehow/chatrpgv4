# PipiCOC mods execution

## Intent and acceptance

The user approved the Mod system design on 2026-09-08. Preserve gameplay as independently versioned mods behind a stable game interface, expose a right-sidebar Mods tab, and ship Natural NPC and Enhanced Items. A manifest or parameter card without observable NPC behavior, executable mechanics, ownership transfer and save continuity is not acceptance.

Success requires: install/list/configure/upgrade and saved version locks; old max(APP, Credit Rating) first-impression behavior with pair reuse and Keeper realization; tool-enabled Pi generation from context and presets; definition/instance separation with NPC use, transfer and player use; public inventory projections; migration/restart/worldline behavior; kernel/extension/UI checks and a real Grok table driven one natural player utterance at a time by this main session.

## Ownership

- Source base: `0.9.0a` at `8e3b87d1cc5f55fe10544c45745e3b3f1bf0fc1e`.
- Owned integration branch: `codex/pipicoc-mods`, worktree `/Users/haoli/leehow/code/chatrpgv4-wt-mods`.
- Lifecycle task: `pipicoc-mods`; final audit/classification required.
- Original checkout has concurrent onboarding and transcript changes. Do not edit/stage them. No push, branch deletion outside lifecycle authority, existing-campaign changes, or evidence deletion.
- Scope: contract, mods packages/runtime/adapters, minimum core definition/instance/mechanics support, panel, tests and acceptance evidence. No marketplace service, core rewrite, PDF pipeline changes, or copying the old runtime.

## Steps

- [x] Contract and package/runtime: version/capability checks, install, per-save activation, pending safe-boundary changes, migrations.
- [x] Natural NPC: import behavior/data/assertions from old first-impression implementation, use current resolve/receipts and current NPC context.
- [x] Enhanced Items implementation: tool-enabled generation and pre-delivery semantic check, deterministic definition acceptance, instance ownership, executable weapon/spell/item effects, inventory. Real Agent acceptance remains below.
- [x] Host and UI: canonical launcher loads Mods extension, panel uses host bridge, no extra Keeper tools.
- [ ] Verify: focused checks then required suites; real table; UI exercise; integrated diff review.
- [ ] Integrate without absorbing concurrent work; lifecycle closeout/audit.

## Decisions

- Follow `docs/kernel-rpc.md` section 26. The public game contract uses JSON values and semantic names; the adapter owns current paths, Pi hooks and kernel objects.
- Self-authored first-version packages contribute declarative rule definitions, content and Agent tasks. Mod-specific rule values belong to the package; arithmetic, world writes and identities belong to the kernel.
- Reuse the existing tool-enabled Pi reader process runner through an adapter. No bare provider completion or zero-tool content generation.
- Accepted generation outputs and first-impression outcomes are stored, not regenerated on replay.
- External precedents verified during design: Factorio mod structure/data lifecycle and VS Code contribution points. Adopt explicit lifecycle/versioning and contributions; unlike deterministic game scripts, model outputs must be captured before commit.

## Validation and remaining work

Implemented package loader/install/version locks, safe-boundary configuration and namespace migrations;
declarative initial NPC checks; object definitions/instances/ownership; tool-enabled host creator and
combined pre-delivery audits; dynamic weapon combat, consumable effects and NPC spell effects;
right-sidebar panel and inventory detail. Remaining: legacy first-impression import, richer lifecycle/
worldline/learning tests, source review, integration and actual Agent/UI/play acceptance.

Validation so far:
- Mod kernel interface: 12 passed (before the most recent restart and worldline additions).
- Existing extension suite: 119 passed; new adapter/launcher checks: 5 passed.
- Panel/investigator UI: 14 passed. Browser build passed.
- Full kernel/play run: 1114 passed, 1 skipped, 1 failed in 257.38 seconds. The sole failure pinned the
  old 22-event enumeration; updated its explicit closed set to the 24 contracted events. Recheck due.
- Logs: `/tmp/pipicoc-mods-kernel-tests.log`, `/tmp/pipicoc-mods-web-build.log`.
- No live model run or real UI interaction yet. All fixture tests remain non-acceptance evidence.

Latest milestone:
- Fast-forwarded the owned checkout to concurrent UI commits through `7c098746`; their changes are preserved.
- Full kernel/play checks: **1120 passed, 1 skipped**, 275.39 seconds; no failures.
- Extension suite: **122 passed**. Latest focused kernel checks after optional physical traits: **23 passed**.
- App/Mods/investigator UI checks: **236 passed**. Cold management/Mod UI checks: **8 passed**.
- Electron baseline gate: **matches 197 known failures, no new failures** (not an all-green upstream suite).
- Browser build passed. Actual browser found and repaired onboarding hiding the right pane and Mod management requiring a live Keeper.
- Actual browser now lists both mods before a campaign exists. New-campaign default was toggled off, refreshed and verified, then restored. A local 1.0.1 verification package was installed in the isolated UI home; both versions appeared and 1.0.0 was selected again.
- Screenshot: `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/output/playwright/mods-20260908/mods-manager.png`.
- Isolated UI server: port 5177, source worktree, `PI_COC_UI_ROOT=.pi/mods-ui`; Playwright session `pipicoc-mods`. Close only these owned processes at final cleanup.
- Next: commit/integrate this implementation, install UI assets in the main 0.9 checkout, then run genuine Grok setup/play through tests/play/driver.py. No real campaign has been created yet. Keep all future play evidence in the main checkout, not this disposable worktree.
