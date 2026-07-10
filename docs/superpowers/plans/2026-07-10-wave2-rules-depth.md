# Wave 2: 规则引擎补洞 · 细化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Keeper Rulebook 中"典籍阅读、成长结算、推骰门闩、疯狂治疗、施法后果、信徒流程、Fair Warning、Idea Roll 代价"八个规则引擎深洞，使 LLM KP 的裁定不再依赖散文即兴。

**Architecture:** 沿用现有引擎模式——每个子系统一个 `coc_*.py` 脚本（sibling-import、确定性 RNG、snapshot/load 持久化、事件记录），数据从 `references/rules-json/*.json` 读取，导演/应用层只消费结构化信号。新增两个引擎文件（`coc_tomes.py`、`coc_development.py`），其余是对既有文件的扩展。

**Tech Stack:** Python 3.11（`tmp/.venv311`）、pytest、rules-json 数据表。

## Global Constraints

- 测试命令：`PYTHONDONTWRITEBYTECODE=1 tmp/.venv311/bin/python -m pytest <files> -q -p no:cacheprovider`（仓库根目录）。
- Semantic Matcher Constitution（AGENTS.md）：运行时禁止关键词/散文扫描，只消费结构化字段。
- 单轨法：所有行为落在 `plugins/coc-keeper/`；技能文档改动跑 `tests/test_plugin_metadata.py`。
- 提交纪律：只 `git add` 本任务明确列出的文件；TDD（失败测试→实现→通过→提交）。
- 原子写盘：新引擎的持久化一律用 `coc_fileio.write_json_atomic`（R1-X 已建）。

## 并行批次（按文件域切分，防冲突）

| 批次 | 任务 | 文件域 |
|---|---|---|
| B1（并行×3） | W2-1 典籍 / W2-4 治疗 / W2-5 施法 | coc_tomes.py（新）/ coc_healing.py+treatment.json / coc_magic.py |
| B2（并行×2） | W2-3 推骰门闩 / W2-6 信徒接线 | coc_director_apply.py+coc_narrative_enrichment.py / coc_mythos.py+coc_tomes.py+coc_story_director.py |
| B3（并行×2） | W2-2 成长结算 / W2-8 Idea Roll 代价 | coc_development.py（新）+coc_director_apply.py / coc_story_director.py |
| B4 | W2-7 Fair Warning | coc_story_director.py+coc_director_apply.py |
| B5 | W2-9 全量验证+打勾 | 蓝图文档 |

---

### Task W2-1: 典籍阅读引擎（Ch11 p.217-226）

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_tomes.py`
- Modify: `plugins/coc-keeper/skills/coc-mythos-reference/SKILL.md`（新增 "## Tome Reading" 节：感官描写、"书之人格"、情节关键典籍失败不卡死）
- Test: `tests/test_tomes.py`（新）

**数据：** `references/rules-json/tomes.json` 已备：`{tomes: {name: {full_study_weeks, sanity_cost, cthulhu_mythos_initial, cthulhu_mythos_full, mythos_rating}}}`。

**Interfaces（Produces）:**
```python
class TomeSession:
    def __init__(self, investigator_id, tome_name, *, rng, campaign_dir=None,
                 language_skill=0, read_language_ok=False, plot_critical=False)
    def read(self, phase: str) -> dict   # phase in {"skim","initial","full","research"}
    def snapshot(self) -> dict
    @classmethod
    def load(cls, campaign_dir, investigator_id) -> "TomeSession"
```

**规则要点（read 的行为契约）：**
- 语言前置：非母语典籍需 `language_skill >= 1` 或 `read_language_ok`，否则返回 `{"blocked": "language_gate"}`；`plot_critical=True` 时不阻断，改附 `{"keeper_note": "skip_failure_gate"}`（p.211-212）。
- `skim`：数小时，只给氛围+目录级摘要，无 CM/SAN。
- `initial`：`cthulhu_mythos_initial` 增益 + `sanity_cost` SAN 损失事件（结构化返回 `san_loss_expr`，由调用方接 SanitySession；本引擎不直接扣 SAN）+ 耗时 `full_study_weeks // 4`（最少 1 周）。
- `full`：前置 initial 已完成；`cthulhu_mythos_full` 增益 + Mythos Rating 记录 + 耗时 `full_study_weeks` 周 + 法术摘要揭示标志 `spells_glimpsed: True`；同一典籍重复 full 耗时翻倍且无新增 CM。
- `research`：已 full 后查询，用 `mythos_rating` 做百分骰目标（返回 roll contract，不代掷）。
- 非信徒延迟 SAN：`read(...)` 返回 `believer_gate: {"can_defer_san": True}` 当 investigator-state `believer` 非 True（与 W2-6 联动，读字段不存在时默认可延迟）。
- 持久化 `save/tomes.json`：`{investigator_id, tome_name, phases_completed, cm_gained, weeks_spent}`；用 `coc_fileio.write_json_atomic`。

**TDD 步骤：**
- [ ] 失败测试：语言门（blocked / plot_critical 放行）、initial 的 CM+SAN 表达式+周数、full 前置与翻倍、research roll contract、snapshot/load 往返。
- [ ] 实现 → 通过 → 技能文档 → `pytest tests/test_tomes.py tests/test_plugin_metadata.py`
- [ ] Commit: `feat(tomes): tome reading engine with study phases (p.217-226)`

### Task W2-4: 治疗/asylum/self-help 重做（p.164-168）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_healing.py`（`PsychotherapySession`，L509 起）
- Modify: `plugins/coc-keeper/references/rules-json/treatment.json`（补月度表与机构品质档）
- Test: `tests/test_healing.py`

**规则要点：**
- private care 月度结算：1D100 → 01-95 `+1D3` SAN，96-100 `-1D6` SAN（p.164）；`treatment.json.psychoanalysis` 补 `monthly_roll: {success_range: [1,95], gain: "1D3", setback_loss: "1D6"}`。
- asylum 机构品质档：`asylum_confinement` 补 `quality_tiers: {good: {monthly_bonus_die: true}, poor: {monthly_penalty_die: true}}`；杜绝"1 次 Psychoanalysis 直接回满"。
- 治愈不定性两步：先月度 `+1D3` 累计，任一月度成功后才允许 SAN 检定治愈 indefinite（`cure_indefinite_check()`：1D100 <= current SAN → 清 `indefinite_insane`）。
- self-help：绑定 backstory `key_connection`（结构化字段名，取 investigator-state `personal_horror_hooks` 或 character backstory 键）；失败 → 返回 `backstory_amend_required: {mode: "corrupt_existing", backstory_field: ...}`（复用 W1-2 结构）。

**TDD 步骤：**
- [ ] 失败测试：月度 01-95/96-100 两档、asylum 品质骰、两步治愈门、self-help 失败改写背景。
- [ ] 实现 → 通过 → `pytest tests/test_healing.py tests/test_rules.py`
- [ ] Commit: `feat(sanity): monthly treatment tiers, two-step indefinite cure, self-help hooks (p.164-168)`

### Task W2-5: 施法与魔法后果（p.177-179）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_magic.py`（`cast_spell` L140、`learn_spell` L271）
- Modify: `plugins/coc-keeper/references/rules-json/spells.json`（如缺副作用表则补 `push_side_effects: {minor: [...8 entries], major: [...8 entries]}`）
- Test: `tests/test_magic.py`（文件名以现有为准，先 `ls tests/ | rg magic`）

**规则要点：**
- 推骰失败：MP **与 SAN** 各 ×1D6 损失 + 1D8 副作用表两档（弱法 minor / 强法 major，按 spell 数据的档位字段；无档位字段则以 `mp_cost >= 10` 为强法）——返回结构化 `side_effect: {roll, tier, description}`。
- POW 消耗结算：法术数据带 POW 成本时从 `caster_state["pow"]` 结算并入返回。
- 施法被打断：`cast_spell(..., interrupted=True)` → 法术失败、MP 已耗、返回 `{"interrupted": True}`，无副作用表。
- `learn_spell(source="entity")`：实体亲授，SAN 成本下限字段 `from_entity_min_sanity_cost`（spells 数据无此字段时默认 `"1D6"`），返回 `san_cost_expr`。

**TDD 步骤：**
- [ ] 失败测试：推骰失败双损+副作用两档、interrupted、entity 亲授 SAN 下限。
- [ ] 实现 → 通过 → Commit: `feat(magic): pushed-cast consequences, interruption, entity-taught spells (p.177-179)`

### Task W2-3: 推骰门闩进 apply 层（p.83-85, p.163）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`
- Modify: `plugins/coc-keeper/scripts/coc_narrative_enrichment.py`（`_atom_roll_contract` ~L540）
- Test: `tests/test_director_apply.py`、`tests/test_narrative_enrichment.py`

**规则要点：**
- `_atom_roll_contract` 按 roll kind 自动置 `push_eligible=False`：kind ∈ {sanity, luck, opposed, damage, combat}（读该函数现有字段确定 kind 来源；无 kind 则保持默认 True）。
- apply 层四阶段门：rules_results 中 `pushed: True` 的结果必须携带 `push_gate: {method_changed: True, consequence_announced: True, player_confirmed: True}`，否则拒绝按推骰结算（回退为普通失败并记 `push_gate_violation` 事件）。
- 推骰失败 → pacing-state 写 `pushed_fail_pending: True`（director 已有消费者则对齐字段名；无则新增并在 `_base_score` PRESSURE 分支 +0.1，同任务内接线）。
- underlying 期推骰失败：若 investigator-state `temporary_insane/indefinite_insane` 且非 bout —— 事件附 `delusion_consequence_allowed: True`（叙事层可用妄想作后果，p.163；只加标志不生成内容）。

**TDD 步骤：**
- [ ] 失败测试：四类 kind 的 push_eligible=False、门闩缺字段拒绝、pushed_fail_pending 写入、underlying 标志。
- [ ] 实现 → 通过 → Commit: `feat(rules): push-roll gate in apply layer, auto push-ineligible kinds (p.83-85)`

### Task W2-6: 信徒流程接线（p.167, p.179, p.212）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_mythos.py`（`become_believer` L175 / `become_believer_persisted` L242）
- Modify: `plugins/coc-keeper/scripts/coc_tomes.py`（读典籍"选择不信"分支——B1 完成后才可动此文件）
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`（believer → `tone: mythos_bleak` 注入 narrative_directives）
- Test: `tests/test_mythos.py`（以现有文件名为准）、`tests/test_story_director.py`、`tests/test_tomes.py`

**规则要点：**
- investigator-state 增 `believer: bool`（`become_believer_persisted` 落盘；load 路径读回）。
- `coc_tomes.read` 的 initial/full 返回 `believer_gate`：`choose_disbelief=True` 参数 → SAN 损失减半但 `cm_gained` 减半（向下取整，最少 1）。
- 首次神话目击强制转化：`become_believer(first_hand=True)` 已有 `is_first` 逻辑则对齐；director 在 `build_director_context` 读 `believer`，为 True 时 `narrative_directives["tone"]` 追加 `"mythos_bleak"`（Ch10 p.212 世界色调切换）。

**TDD 步骤：**
- [ ] 失败测试：believer 持久化往返、choose_disbelief 减半、director tone 注入（believer=False 不注入）。
- [ ] 实现 → 通过 → Commit: `feat(mythos): believer flag wiring, disbelief choice, bleak tone shift (p.167, p.212)`

### Task W2-2: 成长阶段结算引擎（p.94-95）

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_development.py`
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`（掷骰落地点自动记 tick）
- Test: `tests/test_development.py`（新）、`tests/test_director_apply.py`

**Interfaces（Produces）:**
```python
def record_skill_tick(campaign_dir, investigator_id, skill, roll_result) -> dict | None
    # W0-6 排除规则：花幸运(improvement_tick_eligible=False)/奖励骰-only/对抗负方/
    # Cthulhu Mythos/Credit Rating（development_rule().tick.never_tick_skills）→ 返回 None
    # 合格 → 追加 .coc/investigators/<id>/development.jsonl {"skill", "ts", "roll"}
def run_development_phase(campaign_dir, investigator_id, *, rng=None) -> dict
```

**run_development_phase 流程（全部结构化落盘，原子写）：**
1. 读 `development.jsonl` 去重技能列表；
2. 逐技能 1D100 > 当前值 或 >95 → `+1D10` 写回 character.json；
3. 任一技能升后 >=90（`san_reward_threshold`）→ `gain_san_expr: "2D6"`（返回给调用方接 SanitySession，不直接扣）；
4. 幸运恢复：`coc_roll.recover_luck` + `coc_state.apply_luck_recovery`（W1-1 已备）；
5. awfulness_caps 各 -1（恐怖回潮 p.169：读 sanity snapshot，逐 creature_type 减 1 下限 0，写回）；
6. 清空 development.jsonl（截断为空文件）；
7. 返回 `{skills_checked, skills_improved, san_reward_expr, luck_recovery, awfulness_decay}`。

**apply 接线：** 在 rules_results 掷骰结果落地处（找 `skill_check_earned` 已有写点对齐 payload 形状——playtest 侧已消费该字段）调 `record_skill_tick`。

**TDD 步骤：**
- [ ] 失败测试：排除规则逐条（幸运/Mythos/CR/对抗负方）、>95 必升、+1D10 写回、90 阈值 SAN 奖励、awfulness 回潮、清 ticks、apply 自动记 tick。
- [ ] 实现 → 通过 → Commit: `feat(development): investigator development phase engine + auto ticks (p.94-95)`

### Task W2-8: Idea Roll 失败代价结构化（p.199）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`（`_idea_roll_plan` L975）
- Test: `tests/test_story_director.py`

**要点：** idea_roll 成败都推进（现状确认），失败时 plan 附 `failure_delivery: "worst_possible_way"` + `directive`（叙事层以最糟方式交付信息：代价/暴露/警觉）。只加结构化字段。

- [ ] 失败测试 → 实现 → Commit: `feat(director): idea roll failure delivers info the worst way (p.199)`

### Task W2-7: Fair Warning 结构化（p.209）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`（Layer-3，~L1228 注释处显式拦截）
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`（警告落地时 `lethal_chances_used` 递增——当前只有读者无写者）
- Test: `tests/test_story_director.py`、`tests/test_director_apply.py`

**要点：**
- 场景/威胁的致命后果（结构化证据：pressure_move 或 danger 带 `lethal: true` 字段——先查 schema 现状，无则加可选字段）在 `lethal_chances_used < 3` 时被 Layer-3 显式降级为 fair-warning 指令：`narrative_directives["fair_warning"] = {warning_number: n+1, remaining: 3-n-1}`；
- apply 层落地 fair_warning 事件时 `pacing-state.lethal_chances_used += 1`（幂等：同 decision_id 不重复计）；
- `>= 3` 后放行致命结果（`death_allowed` 已有读者）。

- [ ] 失败测试 → 实现 → Commit: `feat(pacing): structured fair-warning ladder before lethal outcomes (p.209)`

### Task W2-9: 全量验证 + 收尾

- [ ] `pytest tests/ -q` 全绿 + `test_plugin_metadata`
- [ ] 回主蓝图 Wave 2 打勾、写波次日志
- [ ] Commit: `chore(blueprint): wave 2 complete`

## Self-Review

- 覆盖：主蓝图 W2-1…W2-9 全部映射；W2-4 的 treatment.json 现有 `psychoanalysis/asylum_confinement/asylum_release/self_help` 四键与 PsychotherapySession 对齐。
- 类型一致：`believer` 字段跨 W2-1/W2-6；tick 排除规则复用 W0-6 `development_rule()`；SAN 变更一律返回表达式由调用方接 SanitySession（W2-1/W2-2/W2-4/W2-5 一致，不双扣）。
- 冲突域：B1 三任务零共享文件；W2-6 依赖 W2-1 的 coc_tomes.py（跨批次串行）；apply 层在 B2(W2-3)→B3(W2-2)→B4(W2-7) 间串行。
