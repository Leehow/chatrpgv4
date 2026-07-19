---
name: coc-keeper
description: >-
  Thin Cursor entry for COC Keeper. Use after the user explicitly activates COC
  mode (e.g. "Activate COC mode", "进入 COC 模式"), or when a Cursor try/demo
  prompt asks to use the plugin in a concrete/useful way or show why it is
  valuable. Routes to coc-main onboarding — not a rules-engine demo. Canonical
  skills live under plugins/coc-keeper/skills/. Portraits use host-native
  image tools when available; Cursor has none, so skip portraits. Cursor must
  keep AI-coding / Codex KP craft parity: director and narration advisory
  layers are part of play, not optional host-only extras.
---

# COC Keeper (Cursor thin entry)

This file is a **host adapter only**. All keeper behavior lives in the single
canonical plugin tree:

```text
plugins/coc-keeper/skills/
```

Do not create a parallel skill copy under `.cursor/skills/` or elsewhere.

## Passive activation

COC mode is passive. Load keeper skills only after explicit user activation, or
after a host try / plugin demo prompt (Cursor’s “use the plugin in one
concrete, useful way…” / “show why it’s valuable”). See
`plugins/coc-keeper/references/AGENTS-coc-mode-template.md`.

For try/demo prompts: open `coc-main` onboarding (welcome + campaign/scenario
wizard). Do not answer with a standalone rules-engine roll demo or a plugin
capability brochure.

## Skill routing (hard load order)

After activation, **read these files before the first in-game play turn**
(same tree Codex uses; do not improvise a thinner Cursor path):

1. `plugins/coc-keeper/skills/coc-main/SKILL.md`
2. `plugins/coc-keeper/references/mode-protocol.md`
3. `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` (full file)
4. `plugins/coc-keeper/skills/coc-story-director/SKILL.md` (full file)

Then route as needed to `coc-campaign-state`, `coc-character`,
`coc-scenario-import`, `coc-meta`, `coc-combat`, `coc-chase`, `coc-sanity`,
`coc-magic`, `coc-development`, `coc-playtest`, `coc-export-battle-report`,
and other skills under `plugins/coc-keeper/skills/`.

Runtime scripts and rules JSON also stay under `plugins/coc-keeper/`
(`scripts/`, `references/`). Prefer the installed plugin copy under
`~/.cursor/plugins/local/coc-keeper/` when that tree is what Cursor loaded;
it must stay byte-synced with the repo via
`plugins/coc-keeper/scripts/install-cursor-plugin.sh`.

## Host topology (Cursor play)

On Cursor, **this main chat session is the Keeper**. Load the canonical skills
above and call `coc_toolbox.py` directly from this session.

Do **not** nest another Keeper for ordinary play:

- Do not drive turns through `runtime.sdk.api.send` / a cold-start Pi keeper.
- Do not spawn a subagent (or second host) to act as KP while this session
  only relays.
- A collaboration / Task subagent may act as the **player only** (player-safe
  narration in, player action out). It must not receive module secrets or tool
  envelopes.

Pi/headless remains a separate host surface for the same plugin; it is not the
turn engine underneath Cursor KP.

Acceptance / “测完” / player-experience claims on Cursor follow the repository
`Playtest Experience Constitution` in `AGENTS.md` and
`plugins/coc-keeper/skills/coc-playtest/SKILL.md`: same skill path as a player
loading the plugin, no schedule-driven thinning, no rules/state shell as
acceptance play. `battle-report` `COMPLETE` alone does not certify experience
parity.

## Cursor / Codex KP craft parity

Cursor is not a rules-engine facade. A path that mainly calls `scene.*` /
`state.*` / `rules.*` and wraps the results in prose is **not** an acceptable
COC KP session on Cursor.

Use the same toolbox Codex uses:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py list
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py <tool> --root <workspace> --campaign <id> --json '<args>'
```

### When advisory layers must be consulted

Follow `coc-keeper-play`. In particular, on Cursor you must actually call the
tools (not merely know they exist) at these natural moments:

1. **Scene entry, repeated failed approaches, or stalled momentum** →
   `director.advise` with structured semantic `intent_evidence`. Offer its
   `candidate_plan` to `storylets.suggest` when a callback / atmospheric beat
   would help. Consult `npc.advise`, `personal_horror.query`, `threat.query`,
   or `epistemic.query` when that dimension is relevant.
2. **After rules/state for a complex beat are settled** → follow the player-
   visible prose pipeline below (not a one-shot `narration.brief` dump).
3. **Whenever you consulted advisory output** →
   `evidence.record_adoption` (`adopted` / `modified` / `ignored`) so audit
   can tell “available” from “influenced play.”

Advisory tools never block play and never replace your judgment. Skipping one
call because the fiction already has clear momentum is fine. Skipping the
entire director/narration layer for convenience is not.

### Always-active player-action uptake

**One-line rule (every ordinary reply):** 先用叙事演完玩家刚承诺的那一步（方法 /
对象 / 谨慎 / 关键台词），再给骰点、线索或目的地；直接跳结果 = 不合格回复。

**串联行动：** 玩家一条消息里写了多步时，按顺序拆成原子步骤逐条结算；门槛
NPC / 检定 / 场景解锁不得因「后面还写了去图书馆」而被跳过。中段失败或被拒
则截断后续步骤。拆解与截断是**内部工艺**；桌上只演虚构因果与感官结果，
禁止把 `【串联】` /「本回合不结算」/「执行备选」/原子清单/CRPG 选项单念给
玩家。截断后须在虚构里点明「后面那几步为什么还没发生」；大失败、拼了仍
失败、或长计划被第一道门噎住时，允许像现实 KP 一样短暂调侃（玩家通常
爱听），再给后果与软提示绕路——别冷酷吞字，也别 OOC 训斥。复杂节拍走
`narration.brief` → 起草 → `narration.review` → 只发最终散文。详见
canonical `coc-keeper-play` 的 Compound player declarations 与 Table Wit。

**检定流程：** KP 先从玩家言行（及 `actions.list`）判定候选技能 → 调用
`rules.skill_describe` 拉取描述（Ch.4 全技能已入库）→ 再选定并 `rules.roll`。
玩家不点名技能。威胁 → 恐吓；示好/勾引 → 魅力；长时间讲理 → 说服；快速哄骗
→ 话术。`【明骰】` 后先写清桌上变化，再给线索——禁止「参数过了就发奖励」。

Follow the Core Keeper Response Contract in canonical
`coc-keeper-play/SKILL.md` on every ordinary in-game reply. When the player
commits to an in-fiction action or speech, enact it from the investigator's
in-world viewpoint before or while revealing the settled outcome. Preserve the
method, target, precautions, constraints, and meaningful spoken words without
echoing the whole message or inventing extra investigator choices. Do not jump
from a command straight to a check result, destination, or clue as if the
declared method never occurred.

This responsibility applies whether or not `narration.brief` or
`narration.review` is useful on that turn. Those tools can reinforce and review
the prose for complex beats, but they do not enable the behavior and they are
not a fixed player-visible prose pipeline. Meta questions, pure planning,
hypotheticals, and deferred actions are not forced into fiction; classify that
distinction semantically, never with phrase matching. Never paste an envelope,
tool JSON, clue-ID list, or roll payload into player-visible prose.

When an advisory tool is consulted, record its disposition with
`evidence.record_adoption`. A semantic `narration.review` may recommend a
rewrite but never blocks delivery.

Forbidden player-facing voices (also listed in `style_contract.avoid`):
`log_style_summary`, `ai_summary_voice`, translationese, abstract
psychological explanation, restating `scene.context` / roll results /
clue lists as if they were finished table prose, and **chain-settlement
audit voice** (`【串联】`, “本回合不结算”, “执行备选”, atom/deferred labels,
or if/then option dumps of the unplayed remainder).

Anti-repetition compresses already-established clues, explanations, and
sensory facts. It does **not** treat the current turn's `action_uptake` as
semantic repetition to be skipped.

Transcript rows and any later battle-report KP text must be this final prose.
Do not backfill the transcript with a post-hoc summary after the fact, and
do not invent missing action uptake in the exporter.

### Four hard rules

1. Dice and HP/SAN/skill arithmetic are authoritative (`rules.*`); never
   invent, adjust, or recompute them in prose.
2. State writes are transactional via tools (`state.*` with `decision_id`);
   never hand-edit a live save.
3. Module truth is read-only; reveal secrets only through play.
4. Every played turn is finalized from settled evidence. After all rule and
   state writes, call `state.journal`, then `turn.output_context`; draft
   causal fiction for every returned obligation, call `turn.finalize`, and
   send exactly its `rendered_text` with no prepend, append, or rewrite.

That hash-bound receipt is the sole source for four player-output categories:
public checks; player-visible state deltas; first-contact and other context
effects; and observable concealed consequences (without disclosing concealed
numbers). All deterministic public values come from the receipt, exactly once.
On an investigator's first substantive meeting with each stable NPC, call the
canonical public `npc.reaction` once for that pair and bind a semantic causal
realization through `state.record_npc_engagement`. The D100, APP, Credit
Rating, chosen maximum, and achieved level appear exactly once. One journal may
contain 0..N independently bound NPCs, interleaved speakers, and NPC-to-NPC
dialogue; never collapse their receipts or effects. Critical/fumble first
impressions each require their own source-bound exceptional effect. Use
localized `npc_display_name` in table text and retain raw IDs only for audit.
Later live trust/fear/suspicion remains `state.npc_update` state. A meaningful
settled action may earn an NPC/skill-scoped one-shot bonus through the existing
exceptional-effect contract, linked to that NPC update; mismatched NPC/skill
rolls do not consume it. No keyword rule awards relationship changes.
When an investigator completes a full sleep in a safe place, call
`state.advance_time` for the actual elapsed minutes and then
`state.mark_safe_rest(rest_kind="full_sleep")`. Clock advancement or prose
mentioning sleep never resets Director rest continuity by itself.

Close every settled check causally, following canonical `coc-keeper-play`
**Causal Realization at the Final Boundary** rather than merely saying it
succeeded or failed. For an abstract declaration, safely complete concrete
words or behavior that fit the investigator and situation; for a specific
declaration, preserve it and show why the NPC or world responds to it. Higher
success surplus improves finesse, speed, discretion, durability, or quality
within the settled goal rather than automatically expanding that goal. A
critical, fumble, or failed pushed roll needs both a meaningful exceptional
beat and an applied, source-bound `state.exceptional_effect`; prose alone
cannot close it. The effect must expose a real benefit/cost, causal link, and
explicit duration/consumption boundary. Plain elapsed time or a conveniently
named flag does not count. One-shot bonus/penalty dice are exact-scope effects:
the next matching `rules.roll` must carry the die and be consumed before
journaling. Active bounded conditions, restrictions, scene events, and
modifiers are returned by
`scene.context.continuity.active_exceptional_effects`. Related checks may share
one fictional beat, but every returned obligation must be closed.

This is only the settled-output completeness boundary. It does not make
`director.advise`, Storylets, NPC advice, `narration.brief`, or
`narration.review` mandatory for a turn; it creates neither a fixed turn
pipeline nor a general prose-quality gate, and it never reruns settled
mechanics or reveals concealed evidence.

## Acceptance routing

Deterministic contract tests may run on Cursor, but whole-product acceptance is
Codex-only: the main Codex opens this canonical plugin as KP and a collaboration
subagent created with `fork_turns: "none"` acts as the player. Only player-safe
content crosses that boundary, and every run starts in a fresh exact-schema
workspace. Follow root `AGENTS.md` and
`plugins/coc-keeper/skills/coc-playtest/SKILL.md`; do not create a Cursor-
specific player, test harness, or evaluation skill.

Only `coc-export-battle-report` may produce the final readable
`artifacts/battle-report.md` and completeness evidence. Never rewrite generated
facts or reconstruct missing dice by hand. Deterministic fixture evidence is
not gameplay evidence.

A Cursor smoke play may still export a battle report for local inspection; if
director/narration advisory were never called, or if KP text is still
`log_style_summary` / tool restatement, say that limitation plainly — do not
present the run as craft-parity or prose-parity evidence.

## Platform gating

Investigator portraits use **host-native** image tools
(`HOST_NATIVE_IMAGEGEN` in
`plugins/coc-keeper/skills/coc-character/SKILL.md`). Cursor has no built-in
image tool, so **skip portrait generation** and continue character creation.
Do not call Codex `imagegen` from Cursor. Grok Build uses its own `image_gen`.

No other craft layer may be silently dropped on Cursor.

## Plugin install alternative

When installing COC Keeper as a Cursor plugin (not just using this repo), the
manifest at `plugins/coc-keeper/.cursor-plugin/plugin.json` points
`"skills": "./skills/"` at the same canonical tree. After repo plugin changes:

```bash
bash plugins/coc-keeper/scripts/install-cursor-plugin.sh
```

Then reload the Cursor window so the local plugin matches the repo.
