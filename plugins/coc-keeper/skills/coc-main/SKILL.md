---
name: coc-main
description: Activate and orchestrate COC mode. Use for activate/enter/continue/pause/save/exit Call of Cthulhu play, and for host try/demo prompts that ask to use COC Keeper in a concrete/useful way or show why the plugin is valuable. Prefer this over rules-engine demos for first contact.
---

# COC Main

## Activation

Use this skill after an explicit COC activation request such as `activate COC mode`, `enter COC mode`, `start COC game`, `continue COC campaign`, or equivalent Chinese natural language.

Also treat **host try / plugin demo** prompts as activation. Cursor (and similar hosts) may inject prompts like:

- `Use the Coc Keeper plugin in one concrete, useful way that shows why it's valuable in this workspace.`
- other “try this plugin”, “show the plugin’s value”, or “demonstrate COC Keeper” wording

For those prompts: run this skill’s normal onboarding workflow below. Do **not** answer with a standalone rules-engine roll demo, capability catalog, or “why this plugin is valuable” essay. The valuable first contact is the welcome + campaign/scenario wizard.

Do not proactively offer COC mode during ordinary coding or repository work unrelated to COC.

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
   it, and fail closed as an installation/contract defect if it is missing.

   For a fresh source-bundle campaign, use the scenario-import
   **pre-confirmation opening warm start** after bind and before delivering the
   investigator card that is pending player confirmation. The main KP performs
   only the bounded minimum-skeleton semantics. If the first
   `progressive.prepare_opening` reports `opening_skeleton_missing` with no
   source window, treat its complete `opening_page_candidates` only as bounded
   selection hints—not provenance—and semantically choose the shortest
   sufficient accepted contiguous current-opening window from `pdf_index`,
   `review_state`, `parse_confidence`, and `grep_anchor_preview`. Prefer one
   page whenever it alone establishes the playable opening. Three pages is a
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
   optional source-evidenced field. Then reinvoke `prepare_opening` with the
   selected `start_location_id` and `opening_pdf_indices` and continue through
   its returned cards. Never read a source manifest, use Bash,
   `run_terminal_command`, `find`, `ls`, `rg`, globbing, directory enumeration,
   repository search, speculative page reads, or any unselected/all-module body
   read. Then create the exact contiguous
   1–3-page `partial_opening` request. When capabilities advertise the
   experimental `coc_source_coordinator_v1=true` /
   `manager_exact_forward` adapter, spawn exactly one custom
   `coc-source-coordinator` with `background=true`; its entire prompt is the
   exact `background_takeover.coordinator_dispatch.packet`. Do not construct,
   fill, wait for, poll, or retrieve that packet/task. The manager claims once,
   runs exact leaves, and forwards valid result rows through canonical
   fulfillment. Its failure classes are audit evidence: one occurrence may be
   transient, while three observed occurrences of the same class are a design
   issue. None of this gates player input, narration, or unrelated play.
   Task support alone is insufficient; never infer nested MCP access from a
   host brand, model name, or successful generic child task.
   Otherwise make one host-work claim only when the separately advertised
   source-worker capability is available. A claimed packet must launch a real
   `coc-source-pack-worker` with
   `background=true`; on Grok, use the focused unqualified user-agent projection
   of the installed definition because 0.2.106 suppresses MCPs on plugin
   subagents. Keep its narrow read plus named-submit profile without overriding
   it to read-only. Retain its real task ID
   only in the host session and return the character confirmation text
   immediately without waiting. The
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
