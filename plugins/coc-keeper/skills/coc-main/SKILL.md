---
name: coc-main
description: Activate and orchestrate COC mode. This is the only main-session skill selected initially for a fresh raw-PDF campaign; it routes source, state, character, and live-play instructions only when their owner or phase arises. Also use for continue/pause/save/exit and host try/demo prompts.
---

# COC Main

For Pi hosts, the repository-root package manifest loads this canonical plugin
skill and the active ruleset skills directly. Its extension forwards
`coc_capabilities`, `coc_discover`, and `coc_invoke` to the canonical persistent
MCP gateway. If a normal projection returns an exact Pi source task, pass it
unchanged to `coc_dispatch_source_work`; never synthesize a prompt, model,
workspace, or tool list. `coc_progressive_ocr` is an external host bridge and
does not make repository code a PDF parser.

## Activation

Use this skill after an explicit COC activation request such as `activate COC mode`, `enter COC mode`, `start COC game`, `continue COC campaign`, or equivalent Chinese natural language.

**Dedicated `pi-coc` desktop:** entering the session **is** activation. COC mode is already on. Do **not** ask the player to say「激活 COC」or wait for an activation phrase. On a fresh desktop, begin this skill’s onboarding immediately. Use `session.resume` only to continue a campaign generation that predates the current host context; campaign creation/setup performed in this same initial request is already current context and must not be followed by `session.resume`. Host-injected `coc-pi-table-open` messages are activation equivalents.

Also treat **host try / plugin demo** prompts as activation. Cursor (and similar hosts) may inject prompts like:

- `Use the Coc Keeper plugin in one concrete, useful way that shows why it's valuable in this workspace.`
- other “try this plugin”, “show the plugin’s value”, or “demonstrate COC Keeper” wording

For those prompts: run this skill’s normal onboarding workflow below. Do **not** answer with a standalone rules-engine roll demo, capability catalog, or “why this plugin is valuable” essay. The valuable first contact is the welcome + campaign/scenario wizard.

Do not proactively offer COC mode during ordinary coding or repository work unrelated to COC. On `pi-coc`, offering COC is not “proactive during coding”—the whole process is the table.

## Workflow

1. Load `../../references/mode-protocol.md`.
2. Inspect/setup through the canonical pre-session gateway. On an MCP coding
   host, invoke the exact `setup.inspect` card returned by `coc_capabilities`;
   use `setup.quick_start` for a built-in starter. These shared toolbox
   operations delegate the same setup runtime and require no file search or
   schema rediscovery. On a host without MCP, call
   `../../scripts/coc_runtime_ops.py --setup` with `onboarding.inspect`. Use
   `rules.inspect` when only helper discovery is needed. Do not recreate
   onboarding state with host-specific filesystem writes.
   When the current request already names an imported raw-PDF scenario and the
   retained capability card exposes `custom_campaign_setup`, invoke that card
   directly; do not call `setup.inspect` merely to enumerate starters or
   rediscover Quick Fire metadata already owned by `coc-character`.
3. Select the visible play language at campaign setup, defaulting to `zh-Hans`, and persist it as `play_language`.
4. Select or create a campaign before character creation or play.
   The continuation recovery first-call rule applies only when this host context
   is reopening an already-existing exact-schema campaign generation. If the
   current initial request just created, quick-started, bound, or otherwise set
   up this campaign, retain those current receipts and continue directly. Do
   not call `session.resume` later in that same request merely because a
   campaign id now exists.
5. **Scenario onboarding (mandatory for new campaigns).** If the selected campaign is newly created and has no bound scenario (`active_scenario_id` is empty), you MUST proactively present a clear, beginner-facing choice before doing anything else:

   > **你有现成的剧本吗？ / Do you have a scenario ready?**
   >
   > 🅰️ 我有剧本 PDF / 剧本资料 → 用 `coc-scenario-import` 导入你的剧本（I have a scenario PDF/notes → import it with `coc-scenario-import`）
   > 🅱️ 我是新手，想直接开玩 → 我们内置了开箱即玩的剧本，装上就能玩，无需任何 PDF（I'm new / I want to play right now → pick a built-in starter scenario）
   >
   > Built-in starter scenarios (run `coc-starter list` for the current list):
   > - **《白色战争》The White War** — 1916 年意大利阿尔卑斯前线，一支山地巡逻队调查冰川上传来的怪响，唤醒冰封万年的远古存在。开箱即玩。
   > - **《闹鬼》The Haunting** — 1920 年波士顿，房东委托调查恶名昭彰的 Corbitt 宅；报馆/档案/街坊多线调查后对峙地下室不死术士。开箱即玩。
   >
   > One-call MCP quick start (pregen investigator, The Haunting): invoke the
   > `setup.quick_start` operation card with
   > `{"scenario_id":"the-haunting","pregen_id":"thomas-hayes"}`.
   > A host without MCP may use the same canonical setup gateway:
   > ```bash
   > uv run --frozen python ../../scripts/coc_runtime_ops.py --setup --workspace . \
   >   --operation-json '{"schema_version":1,"kind":"campaign.quick_start","payload":{"scenario_id":"the-haunting","pregen_id":"thomas-hayes"}}'
   > ```

   For the one-step starter path use the shared `campaign.quick_start` setup
   operation. For a custom table, use `campaign.create`, bind the accepted
   source bundle with `scenario.bind_pdf`, then run the investigator
   confirmation flow; only after confirmation use `investigator.create` and
   `campaign.link_investigator`. Custom PDFs must first be extracted by an
   external host PDF skill into the `trpg-pdf-ingest` source-bundle contract (prefer
   the host's existing PDF tool; if none, recommend the open-source
   `openai/skills` curated `pdf` workflow); bind using
   `source_bundle_path`. For normal installed-plugin progressive import, omit
   `compile_now` or pass `false`; `true` requests the optional repository cold
   compiler runtime and must not sit on the playable-opening critical path.
   The repository has no PDF parser fallback. The same gateway exposes
   `campaign.render_briefing`
   and `investigator.render_card` for player-facing artifacts. Pi calls these
   setup operations through
   `runtime.sdk.api.setup_workspace(...)`.
   After `scenario.bind_pdf` succeeds, consume its exact
   `result.character_creation_briefing.briefing_path`, rooted at the current
   workspace. When that path is present, read it once and do not call
   `campaign.render_briefing` again, read `campaign.json`, or use `find`, `ls`,
   glob, or directory listing under `.coc`. Render only when the bind receipt
   lacks the path or player-safe public setup metadata later changes.
   Never skip this prompt for a new empty campaign, and never wait for the user
   to ask. This is how new players discover they can play without owning a PDF.
   Skip the starter prompt only when the current exact-schema campaign
   generation already has a bound scenario. Never resume or import a legacy or
   mismatched campaign save; discard its runtime state and start a fresh
   campaign generation.
6. Bind or import a scenario with `coc-scenario-import` (for user-provided scenarios), extending `localized_terms` for the campaign language when names, places, handouts, scenario titles, or special terms need customary local rendering.
7. Select, create, or link investigators with the default COC7 character skill
   at the exact reference
   [coc-character](../../rulesets/coc7/skills/coc-character/SKILL.md). Nested
   ruleset skills are not Grok short-name catalog entries. Resolve this known
   reference once; never use a shell command or directory enumeration to locate
   it, and fail closed as an installation/contract defect if it is missing. If
   the confirmed sheet omits the localized view required by
   `investigator.render_card`, skip rendering and continue: the card is not an
   opening gate. For a custom investigator, immediately after
   `campaign.create` succeeds, invoke the exact read-only
   `setup.investigator_contract` operation once with only that
   `campaign_id`. Retain its ruleset-identity-bound
   `result.payload_schema` for the creation flow and use it to construct the
   final `investigator.create` payload; do not guess coc7 fields from the
   kernel `setup.invoke` shell or requery the contract before creation.
   Built-in `setup.quick_start` already supplies its pregen and does not need
   this query.

   For a fresh PDF on Codex, prefer the experimental document-lane capability
   when `coc_opening_source_coordinator_v1=true`. The main KP establishes only
   the attached file's absolute path and SHA-256 before dispatch; it does not
   load the PDF skill, inspect pages, or render. The child coordinator is the
   sole PDF/source-skill consumer. On this route the main KP does not load
   `coc-scenario-import`, `trpg-pdf-ingest`, or `coc-campaign-state`; this
   section plus the returned closed task is sufficient. The main KP accepts the
   user's requested scenario title as the named target. Do not verify that title
   by outline or text lookup in the main window. It creates the empty campaign, then immediately—before any title
   crawl, page render, visual page read, or character-concept drafting—spawns one context-free
   `coc-opening-source-coordinator` with `fork_turns=none`, the current model,
   and one bare `coc.codex-opening-source-task.v1` object. Copy
   `coc_capabilities.data.cold_start.opening_source_coordinator.task_static`
   verbatim, then add every field named by its sibling `task_variable_fields`.
   Do not spawn until both identity fields named by
   `pdf_identity_before_dispatch` are present. Never synthesize an agent
   path under `skills/`, search for these known files, or alter any returned
   static path. Its exact fixed
   `bootstrap_instruction` tells the generic context-free child to read the
   absolute `instruction_ref` completely before any response or tool call;
   task naming alone does not activate custom-agent instructions. Pass no transcript,
   character choice, sheet, save, or Keeper reasoning. That child exclusively
   owns the named-scenario locator, premise/opening visual review, final
   opening-page selection, bundle writing/validation,
   scenario binding, skeleton publication, the Tier 1 request, same-context
   foreground source compile, and opening projection. Its first task turn is the
   blocking concept-locator phase and naturally returns one bare
   `coc.opening-character-concepts.v1` result; it does not rely on an in-turn
   callback. The main KP forwards those spoiler-free concepts to the player and
   immediately exact-forwards the returned `continue_task` through
   `followup_task` to that same idle child. Source build then runs nonblocking
   while the main KP continues characteristic rolls and investigator creation;
   the main KP must not do
   any of the child's document/source work in parallel. This is the intended
   nonblocking split: document parsing and character/rules work are independent
   lanes, while Director and final narration remain with the main KP. If the
   player finishes first, wait only for this already-running Tier 1 minimum.
   Consume the follow-up's natural compact completion once; execute its returned exact
   initial-move card without rediscovery, and never poll or retrieve output.
   Immediately honor its `opening_delivery_boundary`: after any opening
   first-impression rolls and before sending opening prose or accepting the
   first player action, call `evidence.table_opening`;
   `presented_roll_ids=[]` is valid. This closes the setup/opening evidence
   prefix so character-creation rolls cannot leak into the first ordinary turn.

   On hosts without that exact capability, retain the scenario-import
   **pre-confirmation opening warm start** after bind. Invoke
   `progressive.prepare_opening`, then semantically choose the shortest
   sufficient accepted contiguous 1–3-page window and one structured
   `start_location` from its bounded candidate catalog. `grep_anchor_preview`
   and `text_preview` are selection hints, never provenance; include an adjacent
   page only when the current briefing, commission, pressure, immediately
   present NPCs, source clock, or actionable route crosses the boundary. Never
   pad to three, exact-read candidate pages in the main KP, inspect a manifest,
   or search unselected/module-wide source. When the bounded catalog
   semantically shows the authored player-facing start, briefing, or commission,
   the selected shortest sufficient window must begin there and preserve its
   premise. A downstream arrival or investigation page cannot substitute for
   that premise merely because it contains immediate action.

   Invoke `progressive.opening_bootstrap` with the structured
   `{location_id,title}` and selected page indices. This thin canonical
   operation derives the unresolved-clock skeleton, sparsely projects only a
   pristine campaign, enqueues the exact `partial_opening` request, and records
   the campaign-owned automatic-projection watch. The main KP must not call
   `progressive.publish_skeleton`, `progressive.request_opening_pack`, or
   `progressive.project_opening` on this path. The isolated worker exact-reads
   only the selected pages and returns required `opening_setup`: exact
   source-supported clock precision and refs, or `unresolved` without invented
   date/time. Fulfillment applies that observation and drains only the exact
   campaign watch. Final opening prose must preserve the selected source's
   supported civil/day phase, weather, transport, and mission. When
   `opening_setup` is unresolved, or the source does not establish one of those
   facts, do not invent precise lighting or weather, a specific conveyance, or a
   mission; when the source differs, follow the source. This remains
   semantic KP grounding, never a keyword selector or prose gate.

   `prepare_opening` and `opening_bootstrap` are one setup decision for this
   bound scenario generation. Retain the accepted selection, bootstrap
   receipt, dispatch key, and campaign watch. Once bootstrap has accepted it,
   do not call either operation again to check progress, recover an error, or
   improve the opening; follow the returned lifecycle or report its explicit
   terminal failure instead.

   Consume the returned `background_takeover` without active waiting or
   polling. On
   Pi, the package auto-dispatches it and the main KP must not discover or
   invoke `progressive.claim_host_work`, `progressive.fulfill_host_work`,
   `progressive.renew_host_work_leases`, or
   `progressive.release_host_work_leases`, and must never author a pack. Other
   hosts execute only the exact returned capability-selected action; named
   submit owns merge, while an explicit natural-completion fallback exact-
   forwards the unchanged result. A source-task notice is liveness only.
   While the Pi coordinator is open, `progressive.status` is neither its
   completion signal nor a recovery operation: do not call it for reassurance
   and do not re-dispatch or re-bootstrap. Character work continues in
   parallel. If character confirmation reaches the opening boundary first,
   passively wait for the one host terminal lifecycle notice rather than
   issuing a status query. On `fulfilled`, adopt the campaign watch's
   auto-projected opening setup through the next naturally needed canonical
   scene/opening query; do not claim, fulfill, prepare, bootstrap, status-check,
   or project it manually. On a terminal failure, surface the returned recovery
   boundary instead of looping. Only that already-running Tier 1 minimum may
   delay opening after final character confirmation.
8. Route ordinary play to `coc-keeper-play`.
9. Route rules questions and challenges to `coc-meta`.
10. Route combat, chase, sanity, and spell events to their subsystem skills;
    spell learning/casting uses `coc-magic` and the shared typed operation
    gateway.
11. After `coc-keeper-play` records a structured ending, route post-session
    skill checks, permanent advancement, scenario SAN rewards, and Luck
    recovery to `coc-development`.
12. On pause or exit, summarize safely, write memory/log entries, and leave COC mode.

Top-level kernel skills load through the host skill catalog. Rule-craft skills
(`coc-rules-engine`, `coc-sanity`, `coc-combat`, `coc-chase`, `coc-magic`,
`coc-character`, `coc-mythos-reference`, `coc-development`) live in the active
ruleset's skill pack (`rulesets/<id>/skills/`, default `coc7`) and load through
an exact pack reference, not an assumed Grok short name. For the default COC7
character flow the canonical reference from this file is
`../../rulesets/coc7/skills/coc-character/SKILL.md`.

## Hard Rules

- Keep the user-facing experience immersive unless the user enters `[meta]`.
- Use ASCII system markers only.
- Use `[spoiler_warning]` before revealing Keeper-only information.
- Treat rules JSON as the runtime authority for common calculations.
- **Player-visible language constitution:** every player-facing KP string
  (narration, NPC dialogue, handouts as delivered, public rolls, visible
  mechanics, prompts, recaps) uses campaign `play_language` (default
  `zh-Hans`). Source-PDF English is evidence for the KP, not table dump text.
  Keep machine markers, JSON keys, canonical skill keys, rule enum values, and
  hidden Mechanical Log audit anchors stable.
- **For any newly created campaign with no bound scenario, you MUST proactively offer the scenario onboarding choice (built-in vs imported) before proceeding — never skip it, never wait for the user to ask.** New players do not know built-in scenarios exist; this prompt is the only way they find out. Phrase it in plain, beginner-friendly language and name every available built-in scenario with a one-line pitch.
