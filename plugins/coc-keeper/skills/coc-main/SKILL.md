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

**Dedicated `pi-coc` desktop:** entering the session **is** activation. COC mode is already on. Do **not** ask the player to say「激活 COC」or wait for an activation phrase. On a fresh desktop, begin this skill’s onboarding immediately; on resume, continue the table (prefer `session.resume` when a campaign is bound). Host-injected `coc-pi-table-open` messages are activation equivalents.

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
   opening gate.

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
   **pre-confirmation opening warm start** after bind and before delivering the
   investigator card that is pending player confirmation. The main KP performs
   only the bounded minimum-skeleton semantics. Character concepts may already
   have been delivered as an intermediate update; even if the player answers
   immediately, finish dispatching this minimum opening request before rolling
   characteristics, creating the investigator, linking it, or rendering its
   card. If the first
   `progressive.prepare_opening` reports `opening_skeleton_missing` with no
   source window, treat its complete `opening_page_candidates` only as bounded
   selection hints—not provenance—and semantically choose the shortest
   sufficient accepted contiguous current-opening window from `pdf_index`,
   `review_state`, `parse_confidence`, and `grep_anchor_preview`. Prefer one
   page only when it contains the complete current player-facing beat—not just
   a heading or the first paragraph. Include authored date/time, all NPCs
   materially present, the complete briefing/commission/pressure, and an
   actionable route when those exist. A sentence, boxed passage, briefing, or
   immediate choice continuing over the page boundary makes the continuation
   page mandatory. Three pages is a
   maximum, never a target: never pad forward or backward merely to fill it.
   Include an adjacent page only when its preview semantically shows that
   necessary current-opening setup crosses the page boundary; exclude previews
   belonging to later travel, overnight beats, encounters, appendices, or
   neighboring scenes. This is advisory live-KP semantic judgment, never
   keyword/filename code or a hard gate. Reinvoke the same operation with those
   `opening_pdf_indices`; while the skeleton is still missing it
   validates the campaign-bound window and returns only its exact hash-bound
   `cached_page_refs[].path` entries. Exact-read only those paths. For the first
   `progressive.publish_skeleton` submission, copy the returned closed
   `prefilled_template`, replace only its location placeholders, and omit every
   optional source-evidenced field except the contract's narrow source-clock
   exception: when these selected pages explicitly author the opening date/time
   or phase, set `start_clock_status=source` and add only `start_clock` plus
   exact `start_clock_source_refs`. When a time/phase is authored without a
   date, preserve `local_datetime=null` and `local_date=null`; use a relative
   calendar, `time_precision=day_phase`, a semantic `day_phase_hint`, and the
   exact source-supported display rather than retaining the era's default date
   or night phase. Then reinvoke `prepare_opening` with the
   selected `start_location_id` and `opening_pdf_indices` and continue through
   its returned cards. Never read a source manifest, use Bash,
   `run_terminal_command`, `find`, `ls`, `rg`, globbing, directory enumeration,
   repository search, speculative page reads, or any unselected/all-module body
   read. Then create the exact contiguous 1–3-page `partial_opening` request.
   The request response is the first dispatch source: consume its returned
   `background_takeover` directly. Only when that response lacks a takeover may
   the KP invoke `progressive.status` exactly once as dispatch acquisition, never
   as a completion poll or discovery round trip.

   Dispatch by the repository-selected `dispatch_mode`. For
   `direct_single_leaf`, execute the returned host-selected
   `next_host_action` before any other host operation. On Codex its exact
   `action=spawn_background_task` task is one context-free background child;
   do not claim in the parent, because that
   small child task atomically claims and compiles its one packet, so no lease
   clock runs during parent reasoning. On a named-submit host the selected
   action instead claims once and immediately spawns every exact returned task.
   Do not choose among alternate host routes because none are returned. Add no
   prefix, suffix, transcript, reconstructed wrapper, or model override. This
   is the normal path for one ready work group and avoids a manager whose only
   job would be to create one leaf. During character confirmation do not wait.
   When that child completes naturally, do not call an output-retrieval tool;
   forward each exact returned `results[i]` once through
   `next_host_action.on_natural_completion.operation`; do not rediscover it.
   If the player has already
   confirmed and the current opening still is not ready, waiting for that
   already-running Tier 1 child is the permitted blocking minimum. For
   `coordinator_fanout`, spawn exactly one
   background coordinator from the exact
   `coordinator_dispatch.codex_task` (Codex) or exact coordinator packet
   (supported custom-agent host); the coordinator is reserved for multiple
   independent groups. Task support alone is insufficient: require the
   separately advertised source-worker or coordinator capability matching the
   selected mode. Retain real task IDs only in volatile host context and do not
   poll or retrieve output from the main KP. The
   same dispatch failure may remain transient once; three observed occurrences
   of the same class are a design issue rather than acceptable model variance.
   This escalation is diagnostic and never gates player input.
   The
   `coc-character` skill does not own this source lifecycle. Never read all
   module pages, neighboring locations, or appendices for this warm start.
   Returned cards remain advisory and never create a player-action or output
   gate; the KP owns source semantics and final table prose.

   On Grok, the child submits directly and retains its compact strict receipt
   for audit. The main KP treats the host completion reminder as
   notification/liveness only: it must not call `get_task_output`,
   `get_command_or_subagent_output`, wait, poll, inspect, retrieve the pack or
   receipt, call `progressive.fulfill_host_work`, or claim success to the
   player. Failed submission stays open or leased for existing recovery; the
   main KP never repairs or retries it. Consume durable availability only
   through a later naturally needed canonical entity/mechanics or
   opening-projection query, never a reassurance query. Other hosts retain the
   exact unchanged-result fallback.
   Unfinished work does not delay character flow. A host without an applicable
   coordinator or direct-child capability must not fake a Task or claim work
   for an imaginary child.

   If neither the request nor the one acquisition status exposes a takeover,
   deliver the pending confirmation card without waiting; a later natural
   `session.resume` or `scene.context` may expose it. Never loop on status.
   A source-task completion notice is liveness only. When the opening is next
   actually needed, distinguish the pre-confirmation nonblocking interval from
   the post-confirmation blocking minimum. If the player has confirmed and the
   one current opening source task is still running, tell the player that the
   opening is finishing, keep the host turn alive, and await its natural
   completion notification within the opening budget. This is the permitted
   residual Tier 1A wait, not a status poll or task-output retrieval. Do not
   call `progressive.prepare_opening` while that known source task is still
   running. After its completion notice, call `progressive.prepare_opening`
   exactly once and execute its exact returned projection card. Do not guess
   `progressive.project_opening` arguments, probe it repeatedly, or declare the
   opening failed merely because the already-running coordinator was not done
   at character confirmation.
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
