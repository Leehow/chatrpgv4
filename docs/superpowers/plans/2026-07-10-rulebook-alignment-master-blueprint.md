# CoC Keeper 规则书对齐 · 主蓝图（Master Blueprint）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 LLM KP 像人类 KP 一样主持一场有趣的 CoC 跑团：先修正与规则书直接相反/写错的实现，再补齐"好玩/恐怖体验"最缺的主持技艺与规则引擎，最后收编遗留工程项（N 系列）。

**Architecture:** 单轨插件 `plugins/coc-keeper/`（AGENTS.md 单轨法）。规则数值走 `references/rules-json/` + `scripts/coc_rules.py` 加载器；运行时结算走 `scripts/coc_*.py` 会话引擎；KP 技艺走 `skills/*/SKILL.md` 指令层；语义判定一律结构化字段/语义路由（Semantic Matcher Constitution，禁止关键词扫描）。

**Tech Stack:** Python 3.10+（无第三方运行时依赖），pytest（用 Python 3.11 venv 跑，见 Global Constraints）。

**审计来源（证据链）：**
- 规则书章节提取稿：`tmp/pdfs/rulebook-review/ch05..ch14 + rules-summaries`（40th Anniversary，页码均为书内页码）
- 四份对照审计（2026-07-10 会话）：Ch10 主持技艺、Ch5 游戏系统、Ch6/7 战斗追逐、Ch8/9/11/14 理智魔法神话
- 遗留盘点：`docs/superpowers/specs/2026-07-10-next-phase-optimization-audit.md`（N1–N8）

## Global Constraints

- 单轨法：不得复制第二套插件树；共享行为只在 `plugins/coc-keeper/`。
- Semantic Matcher Constitution：运行时不得对自由文本做关键词/子串扫描来判定语义；需要语义判定时走结构化字段或语义路由并记录 reason。
- 测试命令统一：`PYTHONDONTWRITEBYTECODE=1 tmp/.venv311/bin/python -m pytest <files> -q -p no:cacheprovider`（venv 不存在时先 `python3.11 -m venv tmp/.venv311 && tmp/.venv311/bin/pip install pytest pypdf`；venv 位于 tmp/ 下不入库）。
- 插件收尾必跑：`PYTHONDONTWRITEBYTECODE=1 tmp/.venv311/bin/python -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider`。
- 所有新事件/字段带 `rule_ref`（如 `core.combat.dying`）与规则书页码注释。
- 兼容既有存档：新增字段读档时给默认值；不做破坏性 schema 改名（迁移钩子属 N6，见 Wave 4）。
- 战报证据标准（AGENTS.md）：本蓝图产出的验证一律称"单测/formatter 验证"，不冒充战报。

---

## 波次总览（勾选跟踪，防止做一半忘掉）

| 波次 | 内容 | 状态 |
|---|---|---|
| **Wave 0** | 与规则书**直接相反/写错**的 7 处修正（本文档含完整 TDD 任务） | ☑ 2026-07-10 |
| **Wave 1** | 好玩优先项：幸运消费、背景个人化恐怖、幻觉/Reality Check、恐惧症压迫、惊吓技法、SAN 演出协议、怪物演出契约、收尾仪式（本文档含完整任务） | ☑ 2026-07-10 |
| **Wave 2** | 规则引擎补洞：典籍阅读引擎、成长阶段结算、推骰门闩进 apply、治疗/asylum/self-help 重做、施法推骰后果表、信徒流程接线（任务级定义，波次启动时按本文档展开细化计划） | ☑ 2026-07-10 |
| **Wave 3** | 动作场面：追逐 Part2–5 重写、自动武器/多发/瞄准、环境伤害引擎、prone/投掷修正（任务级定义） | ☑ 2026-07-10 |
| **Wave 4** | 遗留 N 系列：N5 真 LLM 对战、N6 存档工程化、N1 多宿主、N2/N7 内容+快速开玩、N3 叙述闭环、N4 缓存、N8 清理（任务级定义） | ☑ 2026-07-10 |
| **Backlog** | Contacts / Training / Aging / CR 消费 / 组合检定 API / 物理极限 / Spot Rules 可选规则 | ☐ |

> 每个波次完成后：在上表打勾、跑全量测试、更新本文件的"波次日志"。**禁止跳过日志直接开下一波**——这是防遗忘机制。

## 波次日志

- 2026-07-10：蓝图创建。Wave 0 未开始。
- 2026-07-10：**Wave 0 完成**（W0-1…W0-7 全部落地，提交 `ba07c3d`…`3310a8f`）。全量 1193 passed。
- 2026-07-10：**Wave 1 完成**。W1-1/W1-2 由主线实现（`3a02536`、`e77ebf9`）；W1-3/W1-4/W1-5/W1-6 由 subagent 实现并经协调者审核（`784ba45`、`f63dea1`、`cf5a6e9`、`2a3c0a0`）。W1-5 的 subagent 在提交前连接中断，成品经审核后由协调者代为提交（`cf5a6e9`）。全量 1243 passed（含 `test_plugin_metadata` 40 条）。另补交 P0 阶段遗留改动（`8e33921`、`942fd60`）。下一波：Wave 2 规则引擎补洞，启动时先按本文档展开细化计划。
- 2026-07-10：**Wave 2 完成**（细化计划 `2026-07-10-wave2-rules-depth.md`）。任务→提交：W2-1 `b9d56d1`、W2-4 `6ebc360`、W2-5 `8fdc98d`、W2-3 `a22994e`（推骰门闩）+ `053e3e3`（pushed_fail_pending→PRESSURE）、W2-6 `19ba6c8`、W2-2 `07eb661`、W2-8 `e7fefce`、W2-7 `9d5f27e`、W2-9 收尾提交（本条）。全量 1333 passed（含 `test_plugin_metadata`）。下一波：Wave 3 动作场面。
- 2026-07-10：**Wave 3 + Wave 4 完成**（全部由 grok-4.5 subagent 实现、协调者审核）。Wave 3：W3-3 环境伤害 `coc_hazards.py`（`d40a1a5`）、W3-2 火器深度（`36129da`）、W3-4 近战补丁（`8791d8d`）、W3-1 追逐重写（`9c12f19`）。Wave 4：N5 live-match harness（`f8408a2` 等）+ 真 pi-coding-agent 玩家桥（`e79912f`）、N6 存档工程化（原子写/文件锁/迁移钩子）、N8 清理、N3 叙述质量闭环、N4 缓存、N2+N7 The Haunting 内容包与 `quick_start`、N1 多宿主安装（`f8d71ac`）；另落地 move 目标结构化匹配（`16b434a`）与场景转移死锁修复。全量 **1540 passed**；Haunting 6 回合验收：visited 3 幕、4 线索。剩余：Backlog（Contacts/Training/Aging/CR 等）与真 LLM live match 首跑。

---

# Wave 0：与规则书直接相反/写错的修正（详细计划）

违规清单（全部有规则书原文与代码行号证据）：

| # | 问题 | 规则书 | 代码现状 |
|---|---|---|---|
| W0-1 | 濒死者被**拒绝** First Aid/Medicine，而规则是**只有** First Aid 能稳定濒死者 | p.120–121 | `coc_healing.py:158-161,203-206` |
| W0-2 | 重伤无 prone/CON 昏迷；单击伤害>HP上限不即死；HP=0 不设 unconscious | p.120 | `coc_combat.py:1219-1247` |
| W0-3 | 重伤恢复 CON 检定按**天**掷，规则是按**周**，且缺休养/医疗奖励骰、fumble 后遗症 | p.121 | `coc_healing.py:237-286` |
| W0-4 | 不定性疯狂阈值用 `san_max // 5`，规则是**当日起始 current SAN** 的 1/5 | p.156 | `coc_sanity.py:238-240` |
| W0-5 | bout 期间应**免 SAN 损失**且 KP 接管，但引擎无 bout_active、导演还发"再掷 SAN 恢复控制"；底层疯狂期任何 SAN 损失应再触发 bout，未实现 | p.156–158 | `coc_sanity.py`（无状态）、`coc_story_director.py:1199-1208,1769-1781`、`coc_rule_signals.py:399-403` |
| W0-6 | development.json 漏"或 >95 必升"、含规则书没有的推骰排除、缺花幸运排除；luck.json 禁项缺 SAN/Luck/推骰互斥/大成败不可买 | p.94(成长), p.99(幸运) | `references/rules-json/development.json`, `luck.json` |
| W0-7 | `SanitySession.load` 不恢复 phobia/mania/awfulness_caps/conditions/bouts —— 重开会话即失忆 | （存档正确性） | `coc_sanity.py:663-699` |

---

### Task W0-1: 濒死急救链（First Aid 稳定化 → 每小时 CON → Medicine 清除 dying）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_healing.py`（`first_aid` L144-190、`medicine` L195-232、`_heal` L125-139、新增 `dying_con_roll`/`stabilized_con_roll`）
- Test: `tests/test_healing.py`

**Interfaces:**
- Produces: `HealingSession.first_aid(...)` 在濒死未稳定时执行稳定化（成功 → `current_hp=1`、conditions 增加 `stabilized`、事件 `first_aid_stabilize`）；`HealingSession.medicine(...)` 在 `stabilized` 时清除 `dying`+`stabilized` 并 +1D3；新增 `dying_con_roll() -> dict`（每轮末 CON，失败 → conditions 加 `dead`）与 `stabilized_con_roll() -> dict`（每小时 CON，失败 → 掉回濒死起点：`current_hp=0`、移除 `stabilized`）。
- Consumes: `coc_roll.percentile_check`、`coc_roll.roll_expression`。

规则依据（p.120–121）：dying = HP 0 + Major Wound，立即昏迷；每轮末 CON，失败即死；**只有 First Aid** 能稳定（给 1 点临时 HP），Medicine **不能**用于稳定；稳定后每小时 CON，失败则失去临时 HP 回到濒死起点；稳定后用 Medicine 成功 → 取消 dying 勾 + 1D3 HP。

- [x] **Step 1: 写失败测试**（替换 `test_first_aid_skipped_when_dying`）

```python
def _dying_session():
    sess = coc_healing.HealingSession("harvey", hp_max=12, con_value=60,
                                      rng=random.Random(7),
                                      current_hp=0,
                                      conditions=["major_wound", "dying"])
    return sess

def test_first_aid_stabilizes_dying_character():
    sess = _dying_session()
    ev = sess.first_aid(99, skill_roll_result={"outcome": "regular"})
    assert ev["event_type"] == "first_aid_stabilize"
    assert sess.current_hp == 1
    assert "stabilized" in sess.conditions
    assert "dying" in sess.conditions  # dying 勾要等 Medicine 才清（p.121）

def test_first_aid_on_stabilized_dying_does_not_heal_further():
    sess = _dying_session()
    sess.first_aid(99, skill_roll_result={"outcome": "regular"})
    ev = sess.first_aid(99, skill_roll_result={"outcome": "regular"})
    assert ev["event_type"] == "healing_skipped"
    assert sess.current_hp == 1

def test_medicine_cannot_stabilize_dying():
    sess = _dying_session()
    ev = sess.medicine(99, skill_roll_result={"outcome": "regular"})
    assert ev["event_type"] == "healing_skipped"
    assert "First Aid" in ev["reason"]

def test_medicine_clears_dying_after_stabilization():
    sess = _dying_session()
    sess.first_aid(99, skill_roll_result={"outcome": "regular"})
    ev = sess.medicine(99, skill_roll_result={"outcome": "regular"})
    assert ev["event_type"] == "medicine"
    assert "dying" not in sess.conditions
    assert "stabilized" not in sess.conditions
    assert sess.current_hp >= 2  # 1 临时 + 1D3

def test_dying_con_roll_failure_kills():
    sess = _dying_session()
    sess._rng = random.Random(0)
    for _ in range(30):
        ev = sess.dying_con_roll()
        if ev["outcome"] in ("failure", "fumble"):
            assert "dead" in sess.conditions
            break
    else:
        raise AssertionError("expected at least one failed CON roll in 30 tries")

def test_stabilized_con_roll_failure_reverts_to_dying():
    sess = _dying_session()
    sess.first_aid(99, skill_roll_result={"outcome": "regular"})
    ev = sess.stabilized_con_roll(roll_result={"outcome": "failure"})
    assert sess.current_hp == 0
    assert "stabilized" not in sess.conditions
    assert "dying" in sess.conditions
```

- [x] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 tmp/.venv311/bin/python -m pytest tests/test_healing.py -q -p no:cacheprovider`
Expected: 新增测试 FAIL（`first_aid` 返回 healing_skipped、`dying_con_roll` 不存在）。

- [x] **Step 3: 实现**

`first_aid` 开头的濒死分支改为（`pushed` 语义保留）：

```python
        if self.is_dying and "stabilized" not in self.conditions:
            # p.121: only First Aid can stabilize a dying character —
            # success grants 1 temporary HP; the dying tick stays until Medicine.
            res = skill_roll_result or coc_roll.percentile_check(
                skill_value, difficulty=difficulty, rng=self._rng)
            success = res.get("outcome") in ("regular", "hard", "extreme", "critical")
            if success:
                self.current_hp = 1
                self.conditions.append("stabilized")
            return self._event("first_aid_stabilize" if success else "first_aid", {
                "skill": "First Aid", "difficulty": difficulty,
                "outcome": res.get("outcome"), "pushed": pushed,
                "stabilized": success,
                "hp_after": self.current_hp,
                "rule_ref": "core.combat.dying_stabilize",
                "summary": (f"{self.investigator_id} First Aid on dying -> "
                            f"{res.get('outcome')}: "
                            + ("stabilized at 1 temporary HP." if success
                               else "failed to stabilize.")),
            })
        if self.is_dying:
            return self._event("healing_skipped", {
                "reason": "dying but already stabilized; use Medicine to clear dying (p.121)",
                "summary": f"{self.investigator_id} already stabilized; Medicine next.",
            })
```

`medicine` 开头的濒死分支改为：

```python
        if self.is_dying and "stabilized" not in self.conditions:
            return self._event("healing_skipped", {
                "reason": "Medicine cannot stabilize a dying character; First Aid first (p.121)",
                "summary": f"{self.investigator_id} needs First Aid stabilization first.",
            })
        clearing_dying = self.is_dying and "stabilized" in self.conditions
```

成功分支里（`if success and not self._medicine_used_today:`）在掷 1D3 之前先清状态，使 `_heal` 不再被 `is_dying` 挡住：

```python
            if clearing_dying:
                self.conditions.remove("dying")
                self.conditions.remove("stabilized")
```

新增两个方法（放在 `weekly_recovery` 前）：

```python
    def dying_con_roll(self, roll_result: dict | None = None) -> dict[str, Any]:
        """p.121: dying investigator makes a CON roll at the end of each round;
        failure = immediate death."""
        res = roll_result or coc_roll.percentile_check(self.con_value, rng=self._rng)
        died = res.get("outcome") in ("failure", "fumble")
        if died and "dead" not in self.conditions:
            self.conditions.append("dead")
        return self._event("dying_con_roll", {
            "outcome": res.get("outcome"), "died": died,
            "rule_ref": "core.combat.dying_con_clock",
            "summary": (f"{self.investigator_id} dying CON roll -> {res.get('outcome')}"
                        + (": dies." if died else ": holds on.")),
        })

    def stabilized_con_roll(self, roll_result: dict | None = None) -> dict[str, Any]:
        """p.121: stabilized (1 temporary HP) investigator makes a CON roll each
        hour; failure = lose the temporary HP and revert to the start of the
        dying process."""
        res = roll_result or coc_roll.percentile_check(self.con_value, rng=self._rng)
        deteriorated = res.get("outcome") in ("failure", "fumble")
        if deteriorated:
            self.current_hp = 0
            if "stabilized" in self.conditions:
                self.conditions.remove("stabilized")
        return self._event("stabilized_con_roll", {
            "outcome": res.get("outcome"), "deteriorated": deteriorated,
            "rule_ref": "core.combat.dying_stabilized_clock",
            "summary": (f"{self.investigator_id} hourly CON roll -> {res.get('outcome')}"
                        + (": condition deteriorates, back to dying." if deteriorated
                           else ": stable.")),
        })
```

同时更新模块 docstring 中错误的一句 `Dying/unconscious investigators cannot heal until stabilized` 为规则书语义。

- [x] **Step 4: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 tmp/.venv311/bin/python -m pytest tests/test_healing.py -q -p no:cacheprovider`
Expected: PASS（含既有用例）。

- [x] **Step 5: Commit** `fix(healing): dying stabilization chain per rulebook p.121`

---

### Task W0-2: 重伤即时效果 + 单击超上限即死 + HP=0 昏迷

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_combat.py`（`_update_conditions` L1219-1247、`add_participant` L180-217 增加 `con` 参数）
- Test: `tests/test_combat_state.py`

**Interfaces:**
- Produces: participant 增加 `"con"` 字段（默认 50）；`_update_conditions` 产出 conditions：`prone`、`unconscious`、`dying`、`dead`；新事件记录 `major_wound_effects`（含 CON 检定结果）追加到 `self.damage_chain` 之外的事件流（沿用现有事件机制，若无独立事件流则追加到 damage_chain 记录里，键 `"major_wound_con"`）。
- Consumes: `coc_roll.percentile_check`。

规则依据（p.120）：受重伤 → 立即 prone + CON 检定否则昏迷；HP=0 → 昏迷；HP=0 且有重伤 → dying；单次伤害 > HP 上限 → 死亡不可避免。

- [x] **Step 1: 写失败测试**

```python
def test_major_wound_causes_prone_and_con_check():
    sess = _session_with_two()  # 沿用文件内既有 fixture 风格
    p = sess.participants["victim"]
    p["con"] = 1   # 几乎必失败 → 必昏迷
    _hit(sess, "victim", damage=p["hp_max"] // 2)  # 单击达半上限
    assert "major_wound" in p["conditions"]
    assert "prone" in p["conditions"]
    assert "unconscious" in p["conditions"]

def test_overkill_single_hit_is_instant_death():
    sess = _session_with_two()
    p = sess.participants["victim"]
    _hit(sess, "victim", damage=p["hp_max"] + 1)
    assert "dead" in p["conditions"]

def test_zero_hp_regular_damage_is_unconscious_not_dying():
    sess = _session_with_two()
    p = sess.participants["victim"]
    # 多次小伤堆到 0，无单击达半上限
    while p["hp_current"] > 0:
        _hit(sess, "victim", damage=1)
    assert "unconscious" in p["conditions"]
    assert "dying" not in p["conditions"]
```

（`_hit` 为测试内小助手：用现有 `apply_damage`/`damage_only` 路径落一次伤害后触发 `_update_conditions`；按 test_combat_state.py 现有工具函数命名对齐。）

- [x] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 tmp/.venv311/bin/python -m pytest tests/test_combat_state.py -q -p no:cacheprovider`

- [x] **Step 3: 实现**

`add_participant` 增加参数 `con: int = 50`，写入 `"con": con`（快照/加载路径同步）。`_update_conditions` 重写：

```python
    def _update_conditions(self, target_id: str | None) -> None:
        if target_id is None or target_id not in self.participants:
            return
        p = self.participants[target_id]
        half_max = p["hp_max"] // 2
        worst_single = 0
        for d in self.damage_chain:
            if "target_actor_id" not in d or d["target_actor_id"] != target_id:
                continue
            if d.get("rulebook_exception"):
                continue
            landed = -d["hp_delta"]
            if landed > worst_single:
                worst_single = landed
        # p.120: damage greater than max HP in one attack -> inevitable death.
        if worst_single > p["hp_max"]:
            for cond in ("dead",):
                if cond not in p["conditions"]:
                    p["conditions"].append(cond)
            return
        newly_major = (worst_single >= half_max and worst_single > 0
                       and "major_wound" not in p["conditions"])
        if worst_single >= half_max and worst_single > 0:
            if "major_wound" not in p["conditions"]:
                p["conditions"].append("major_wound")
        if newly_major:
            # p.120: immediately falls prone; CON roll to avoid unconsciousness.
            if "prone" not in p["conditions"]:
                p["conditions"].append("prone")
            con_res = coc_roll.percentile_check(int(p.get("con", 50)), rng=self._rng)
            if con_res.get("outcome") in ("failure", "fumble"):
                if "unconscious" not in p["conditions"]:
                    p["conditions"].append("unconscious")
            self.damage_chain.append({
                "major_wound_con": con_res.get("outcome"),
                "actor_id": target_id,
                "rule_ref": "core.combat.major_wound_effects",
            })
        if p["hp_current"] == 0:
            # p.120: zero HP -> unconscious; dying only with a major wound.
            if "unconscious" not in p["conditions"]:
                p["conditions"].append("unconscious")
            if "major_wound" in p["conditions"] and "dying" not in p["conditions"]:
                p["conditions"].append("dying")
```

（`self._rng` 若 CombatSession 无该属性，则沿用会话现有 RNG 字段名；实现时以实际字段为准，保持确定性测试可注入。）

- [x] **Step 4: 跑测试确认通过**（同上命令）
- [x] **Step 5: Commit** `fix(combat): major-wound prone/CON, overkill death, 0hp unconscious (p.120)`

---

### Task W0-3: 重伤恢复改周节奏 + 休养/医疗奖励骰 + fumble 后遗症

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_healing.py`（`weekly_recovery` L237-286、`handle_time_trigger` L347-384）
- Test: `tests/test_healing.py`

**Interfaces:**
- Produces: `weekly_recovery(days_of_rest)` 保留（**无重伤**时 1 HP/天不变）；重伤路径改为新方法 `major_wound_recovery_roll(*, complete_rest=False, medical_care_success: bool | None = None, poor_environment=False, medicine_fumbled=False, roll_result=None) -> dict`，每**周**调用一次：CON 失败 0 / 成功 1D3 / 极难 2D3；`complete_rest`、`medical_care_success=True` 各 +1 奖励骰；`poor_environment` 或 `medicine_fumbled` +1 惩罚骰；极难成功或 HP≥半上限 → 清 `major_wound`；CON fumble → 事件 `lasting_injury`（`keeper_note` 指示 KP 选择永久后遗症并写入 backstory Wounds & Scars，p.121）。
- Consumes: `coc_roll.percentile_check(target, bonus=, penalty=)`。

- [x] **Step 1: 写失败测试**

```python
def test_major_wound_recovery_is_weekly_con_roll():
    sess = coc_healing.HealingSession("h", hp_max=15, con_value=99,
                                      rng=random.Random(3), current_hp=4,
                                      conditions=["major_wound"])
    ev = sess.major_wound_recovery_roll(roll_result={"outcome": "regular"})
    assert ev["event_type"] == "major_wound_recovery"
    assert 1 <= ev["hp_gained"] <= 3

def test_weekly_recovery_days_no_longer_rolls_con_per_day():
    sess = coc_healing.HealingSession("h", hp_max=15, con_value=99,
                                      rng=random.Random(3), current_hp=4,
                                      conditions=["major_wound"])
    ev = sess.weekly_recovery(3)
    # 有重伤时自然恢复不再按天掷 CON；只提示走周检定
    assert ev["hp_gained"] == 0
    assert ev.get("major_wound_recovery_required") is True

def test_recovery_bonus_dice_from_rest_and_care():
    sess = coc_healing.HealingSession("h", hp_max=15, con_value=50,
                                      rng=random.Random(3), current_hp=4,
                                      conditions=["major_wound"])
    ev = sess.major_wound_recovery_roll(complete_rest=True, medical_care_success=True)
    assert ev["bonus_dice"] == 2 and ev["penalty_dice"] == 0

def test_recovery_extreme_success_clears_major_wound():
    sess = coc_healing.HealingSession("h", hp_max=15, con_value=99,
                                      rng=random.Random(3), current_hp=4,
                                      conditions=["major_wound"])
    sess.major_wound_recovery_roll(roll_result={"outcome": "extreme"})
    assert "major_wound" not in sess.conditions

def test_recovery_fumble_emits_lasting_injury():
    sess = coc_healing.HealingSession("h", hp_max=15, con_value=10,
                                      rng=random.Random(3), current_hp=4,
                                      conditions=["major_wound"])
    ev = sess.major_wound_recovery_roll(roll_result={"outcome": "fumble"})
    assert any(e["event_type"] == "lasting_injury" for e in sess.events)
```

- [x] **Step 2: 跑测试确认失败**（`pytest tests/test_healing.py`）
- [x] **Step 3: 实现**

```python
    def major_wound_recovery_roll(self, *, complete_rest: bool = False,
                                  medical_care_success: bool | None = None,
                                  poor_environment: bool = False,
                                  medicine_fumbled: bool = False,
                                  roll_result: dict | None = None) -> dict[str, Any]:
        """p.121: weekly CON roll while the Major Wound box is ticked."""
        bonus = int(bool(complete_rest)) + int(bool(medical_care_success))
        penalty = int(bool(poor_environment) or bool(medicine_fumbled))
        res = roll_result or coc_roll.percentile_check(
            self.con_value, bonus=bonus, penalty=penalty, rng=self._rng)
        outcome = res.get("outcome")
        hp_before = self.current_hp
        gained = 0
        if outcome == "extreme":
            gained = self._heal(int(coc_roll.roll_expression("2D3", rng=self._rng)["total"]))
            if "major_wound" in self.conditions:
                self.conditions.remove("major_wound")
        elif outcome in ("regular", "hard", "critical"):
            gained = self._heal(int(coc_roll.roll_expression("1D3", rng=self._rng)["total"]))
        elif outcome == "fumble":
            self._event("lasting_injury", {
                "rule_ref": "core.combat.major_wound_recovery_fumble",
                "keeper_note": ("Pick a lasting injury/complication tied to the wound "
                                "(permanent limp, lost fingers, scarred face ...) and "
                                "record it in the backstory under Wounds & Scars (p.121)."),
                "summary": f"{self.investigator_id} recovery fumble: lasting injury.",
            })
        # 半血也清重伤（p.121 second path）由 _heal 现有逻辑处理
        return self._event("major_wound_recovery", {
            "outcome": outcome, "bonus_dice": bonus, "penalty_dice": penalty,
            "hp_before": hp_before, "hp_gained": gained, "hp_after": self.current_hp,
            "rule_ref": "core.combat.major_wound_recovery",
            "summary": (f"{self.investigator_id} weekly recovery CON ({outcome}): "
                        f"+{gained} HP."),
        })
```

`weekly_recovery(days_of_rest)`：删除逐日 CON 循环；有重伤时 `hp_gained=0` 并返回 `"major_wound_recovery_required": True`（`summary` 说明需走周检定）；无重伤路径不变。`handle_time_trigger`：`had_major_wound` 时改为每累计 7 天 rest 调一次 `major_wound_recovery_roll(complete_rest=True)`（简化：`weeks = days // 7`），不足一周只重置日常护理并返回 0。

- [x] **Step 4: 跑测试确认通过**；同时跑 `tests/test_sanity_time_integration.py tests/test_final_subsystems.py` 防回归。
- [x] **Step 5: Commit** `fix(healing): weekly major-wound recovery with rest/care dice (p.121)`

---

### Task W0-4: 不定性疯狂阈值改用当日起始 current SAN

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_sanity.py`（`__init__`、`sanity_check` L238-240、`end_day` L561-586、`snapshot`/`load`）
- Test: `tests/test_sanity_session.py`

**Interfaces:**
- Produces: `SanitySession.day_start_san: int`（构造时 = 初始 `san_current`；`end_day()` 重置为当前值；随 snapshot/load 持久化）；阈值判断改为 `self.daily_san_lost >= max(1, self.day_start_san // 5)`。

规则依据（p.156）："On losing a fifth or more of **current** Sanity points in one game day"。

- [x] **Step 1: 写失败测试**

```python
def test_indefinite_insanity_threshold_uses_day_start_current_san():
    # san_max=99 但当日起始 SAN=25：丢 5 点（>=25//5）就应触发不定性疯狂
    sess = coc_sanity.SanitySession("h", san_max=99, int_value=50,
                                    rng=random.Random(1))
    sess.san_current = 25
    sess.end_day()          # 锚定 day_start_san=25
    sess.daily_san_lost = 0
    sess.sanity_check("shock", san_loss_success=5, san_loss_fail_expr="5",
                      involuntary_kind="freeze")
    assert sess.indefinite_insane is True

def test_day_start_san_survives_save_load(tmp_path):
    sess = coc_sanity.SanitySession("h", san_max=99, int_value=50,
                                    rng=random.Random(1), campaign_dir=tmp_path)
    sess.san_current = 40
    sess.end_day()
    sess.save(tmp_path)
    loaded = coc_sanity.SanitySession.load(tmp_path, "h")
    assert loaded.day_start_san == 40
```

- [x] **Step 2: 跑测试确认失败**（`pytest tests/test_sanity_session.py`）
- [x] **Step 3: 实现**：`__init__` 里 `self.day_start_san = self.san_current`；`sanity_check` 阈值行替换为 `if self.daily_san_lost >= max(1, self.day_start_san // 5) and not self.indefinite_insane:`；`end_day()` 开头加 `self.day_start_san = self.san_current`；`snapshot()` 增加 `"day_start_san"`；`load()` 增加 `sess.day_start_san = int(snap.get("day_start_san", sess.san_current))`。若既有用例依赖 `san_max // 5`（如满值 99 的场景两者相同），无需改动。
- [x] **Step 4: 跑测试确认通过**
- [x] **Step 5: Commit** `fix(sanity): indefinite-insanity threshold uses day-start current SAN (p.156)`

---

### Task W0-5: bout 状态机 —— 发作期免 SAN、KP 接管、底层疯狂再触发；导演不再"掷 SAN 恢复控制"

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_sanity.py`（bout 状态字段 + `sanity_check` 保护 + 底层疯狂再触发）
- Modify: `plugins/coc-keeper/scripts/coc_rule_signals.py`（`read_sanity_engine_state` L399-403 的 bout_active 判定）
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`（SUBSYSTEM sanity 分支 L1769-1781 改发 `bout_playout`；Layer-3 override L1206-1208 的 temp_insane 分支删除——underlying 期玩家保有控制权）
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`（`rules_requests` 处理循环容忍/透传 `bout_playout` 指令，不掷骰）
- Test: `tests/test_sanity_session.py`、`tests/test_rule_signals.py`、`tests/test_story_director.py`

**Interfaces:**
- Produces:
  - `SanitySession.bout_active: bool`、`bout_rounds_remaining: int`（real_time 模式 = 1D10 轮；summary 模式发作即结束，`bout_active` 保持 False，事件里直接给"醒来场景"提示）。
  - `SanitySession.tick_bout_round() -> dict`（递减轮数；到 0 → `end_bout()`）。`end_bout()` 清 `bout_active` 并发事件 `bout_ended`（进入 underlying insanity）。
  - `sanity_check(...)` 在 `bout_active` 时直接返回 `sanity_check_skipped` 事件（p.156-157：发作期不再损失 SAN）。
  - `sanity_check(...)` 在 underlying 期（`temporary_insane or indefinite_insane`，且非 bout）任何 `lost >= 1` 后触发新 bout（p.158）。
  - 快照/加载持久化 `bout_active`/`bout_rounds_remaining`。
  - `read_sanity_engine_state`：`bout_active` 只来自显式字段（不再由 `temporary_insane` 推出）。
  - director SUBSYSTEM sanity 分支产出：
    ```python
    {"kind": "bout_playout", "reason": "bout of madness in progress",
     "keeper_controls_investigator": True,
     "rule_ref": "core.sanity.bout_of_madness",
     "narrative_directives": {"mode": "real_time",
                              "instruction": "Keeper dictates the investigator's actions this round; no SAN roll; bout ends when rounds run out or scene resolves."}}
    ```
    （无 `roll_contract`，apply 层视为叙事指令直接透传给 narration，不掷骰。）
- Consumes: W0-4 的 `day_start_san`（同文件先后关系：先做 W0-4）。

- [x] **Step 1: 写失败测试**

```python
# tests/test_sanity_session.py
def test_no_san_loss_during_active_bout():
    sess = _fresh_session()
    sess.bout_active = True
    ev = sess.sanity_check("horror", 1, "1D6", involuntary_kind="freeze")
    assert ev["type"] == "sanity_check_skipped"
    assert sess.san_current == sess.san_max

def test_underlying_insanity_any_loss_triggers_new_bout():
    sess = _fresh_session()
    sess.temporary_insane = True          # underlying 期
    before = len(sess.bouts_of_madness)
    sess.sanity_check("aftershock", 1, "1", involuntary_kind="freeze")
    assert len(sess.bouts_of_madness) == before + 1

def test_realtime_bout_sets_active_and_ticks_down():
    sess = _fresh_session()
    sess.sanity_check("ghoul", 5, "5", involuntary_kind="freeze", alone=False)
    if sess.bout_active:                   # INT 成功才发作；用固定种子保证
        rounds = sess.bout_rounds_remaining
        assert rounds >= 1
        for _ in range(rounds):
            sess.tick_bout_round()
        assert sess.bout_active is False

# tests/test_rule_signals.py
def test_bout_active_not_inferred_from_temporary_insane(tmp_path):
    inv = tmp_path / "save" / "investigator-state"; inv.mkdir(parents=True)
    (inv / "h.json").write_text(json.dumps({"temporary_insane": True}))
    sig = coc_rule_signals.read_sanity_engine_state(tmp_path, "h")
    assert sig["bout_active"] is False
    assert sig["temporary_insane"] is True

# tests/test_story_director.py
def test_bout_subsystem_emits_playout_directive_not_san_roll():
    ctx = _ctx_with_signals(bout_active=True)
    requests = coc_story_director._build_rules_requests("SUBSYSTEM", ctx)
    kinds = [r["kind"] for r in requests]
    assert "bout_playout" in kinds
    assert "sanity_check" not in kinds
```

（`_fresh_session`/`_ctx_with_signals` 沿用各测试文件既有 fixture；`test_realtime_bout_...` 用能让 INT 成功的固定种子。）

- [x] **Step 2: 跑测试确认失败**
- [x] **Step 3: 实现**（按 Interfaces 描述逐条落；`_trigger_temporary_insanity` 里 real_time 分支设 `self.bout_active = True; self.bout_rounds_remaining = bout["duration_rounds"]`；`sanity_check` 开头加 bout 保护、结尾加 underlying 再触发——注意再触发分支要放在"lost >= 5 → temporary check"之前短路，避免双触发：underlying 期直接 `_trigger_new_bout()`（提炼 `_trigger_temporary_insanity` 中 bout 生成部分为 `_start_bout(source, alone, override)`，temporary 触发与 underlying 再触发共用）。director 的 L1206-1208 `temp_insane` override 删除；L1199 `bout_active` override 保留。apply 层在遍历 `rules_requests` 时对 `kind == "bout_playout"` 不走掷骰路径，原样并入 narration directives——先读 `coc_director_apply.py` L495-670 的请求分发结构再接线。）
- [x] **Step 4: 跑测试确认通过** + 跑 `tests/test_director_apply.py tests/test_playtest_driver.py` 防回归（playtest 驱动器可能依赖旧的 bout→sanity_check 行为，按新语义更新其断言）。
- [x] **Step 5: Commit** `fix(sanity): bout state machine — SAN immunity, KP takeover, underlying retrigger (p.156-158)`

---

### Task W0-6: development.json / luck.json 与规则书对齐

**Files:**
- Modify: `plugins/coc-keeper/references/rules-json/development.json`
- Modify: `plugins/coc-keeper/references/rules-json/luck.json`
- Modify: `plugins/coc-keeper/scripts/coc_rules.py`（`development_rule` L695-712、`luck_rule` L670-693 透传新字段）
- Test: `tests/test_rules.py`

**Interfaces:**
- Produces:
  - `development.json.improvement_roll.check = "1D100 > current_skill or 1D100 > 95"`，新增 `"always_improves_above": 95`；`tick.excluded_outcomes` 移除 `pushed_roll_that_would_not_otherwise_tick`、加入 `"success_obtained_by_spending_luck"`（p.99）；`tick` 新增 `"never_tick_skills": ["Cthulhu Mythos", "Credit Rating"]`（p.94）；`improvement_roll.constraints` 移除 `skill_at_or_above_cap_via_san_reward_may_not_improve`，新增 `"skills_may_exceed_100"`（p.94）。`cap_for_san_reward` 键保留但语义改为 `san_reward_threshold`（新增同义键，旧键保留一版以兼容读者）。
  - `luck.json.spend.constraints` 补全为：不可用于 Luck 检定、伤害骰、SAN 检定、SAN 损失量骰（p.99）；失败后推骰 XOR 花幸运、推骰结果不可花幸运；大成功/大失败/卡壳不可买掉；花幸运的成功不获成长勾；只能改自己的骰。`recovery.applies_when` 改 `"after_each_session"`（p.99 "After each session of play"）。
  - `coc_rules.development_rule()` 返回值增加 `always_improves_above` 与 `never_tick_skills`；`luck_rule()` 返回值增加 `spend.constraints` 列表透传。
- Consumes: 无。

- [x] **Step 1: 写失败测试**

```python
def test_development_rule_carries_over_95_auto_improve():
    rule = coc_rules.development_rule()
    assert rule["improvement_roll"]["always_improves_above"] == 95
    assert "Cthulhu Mythos" in rule["tick"]["never_tick_skills"]
    assert "pushed_roll_that_would_not_otherwise_tick" not in rule["tick"]["excluded_outcomes"]
    assert "success_obtained_by_spending_luck" in rule["tick"]["excluded_outcomes"]

def test_luck_rule_exposes_spend_constraints():
    rule = coc_rules.luck_rule()
    cons = rule["spend"]["constraints"]
    assert "luck_may_not_be_spent_on_sanity_rolls" in cons
    assert "push_or_spend_luck_but_not_both" in cons
    assert "criticals_fumbles_malfunctions_cannot_be_bought_off" in cons
    assert rule["recovery"]["applies_when"] == "after_each_session"
```

- [x] **Step 2: 跑测试确认失败**（`pytest tests/test_rules.py`）
- [x] **Step 3: 实现**（JSON 全字段落好 source_note 页码：成长 p.94-95、幸运 p.99；loader 透传）。luck.json constraints 目标值：

```json
"constraints": [
  "luck_may_be_spent_after_roll",
  "luck_may_push_total_below_target_to_succeed",
  "luck_may_not_be_spent_on_luck_rolls",
  "luck_may_not_be_spent_on_damage_rolls",
  "luck_may_not_be_spent_on_sanity_rolls",
  "luck_may_not_be_spent_on_sanity_loss_amount_rolls",
  "push_or_spend_luck_but_not_both",
  "luck_may_not_alter_a_pushed_roll",
  "criticals_fumbles_malfunctions_cannot_be_bought_off",
  "no_improvement_check_if_luck_spent",
  "only_own_rolls"
]
```

- [x] **Step 4: 跑测试确认通过** + `pytest tests/test_subsystems3.py`（`sanity_reward_rule` 读者）防回归。
- [x] **Step 5: Commit** `fix(rules-json): align development & luck tables with rulebook p.94-99`

---

### Task W0-7: SanitySession.load 恢复完整状态

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_sanity.py`（`load` L663-699）
- Test: `tests/test_sanity_session.py`

**Interfaces:**
- Produces: `load` 恢复 `awfulness_caps`、`phobia`、`mania`、`conditions`、`bouts_of_madness`、`involuntary_actions`、（W0-5 引入的）`bout_active`/`bout_rounds_remaining`、（W0-4 引入的）`day_start_san`。

- [x] **Step 1: 写失败测试**

```python
def test_load_restores_phobia_mania_awfulness_and_conditions(tmp_path):
    sess = coc_sanity.SanitySession("h", san_max=60, int_value=50,
                                    rng=random.Random(9), campaign_dir=tmp_path)
    sess.phobia = "Arachnophobia"
    sess.mania = "Ablutomania"
    sess.conditions = ["phobia:Arachnophobia", "mania:Ablutomania"]
    sess.awfulness_caps = {"ghoul": 7}
    sess.save(tmp_path)
    loaded = coc_sanity.SanitySession.load(tmp_path, "h")
    assert loaded.phobia == "Arachnophobia"
    assert loaded.mania == "Ablutomania"
    assert loaded.awfulness_caps == {"ghoul": 7}
    assert "phobia:Arachnophobia" in loaded.conditions
```

- [x] **Step 2: 跑测试确认失败**
- [x] **Step 3: 实现**：`load` 里补：

```python
        sess.awfulness_caps = dict(snap.get("awfulness_caps") or {})
        sess.phobia = snap.get("phobia")
        sess.mania = snap.get("mania")
        sess.conditions = list(snap.get("conditions") or [])
        sess.bouts_of_madness = list(snap.get("bouts_of_madness") or [])
        sess.involuntary_actions = list(snap.get("involuntary_actions") or [])
        sess.bout_active = bool(snap.get("bout_active", False))
        sess.bout_rounds_remaining = int(snap.get("bout_rounds_remaining", 0))
        sess.day_start_san = int(snap.get("day_start_san", sess.san_current))
```

- [x] **Step 4: 跑测试确认通过**
- [x] **Step 5: Commit** `fix(sanity): SanitySession.load restores full persisted state`

---

### Task W0-8: Wave 0 全量验证

- [x] Run: `PYTHONDONTWRITEBYTECODE=1 tmp/.venv311/bin/python -m pytest tests/ -q -p no:cacheprovider`
Expected: 全绿（基线 1162 个用例 + 本波新增）。
- [x] Run: `PYTHONDONTWRITEBYTECODE=1 tmp/.venv311/bin/python -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider`
- [x] 在本文件"波次总览"给 Wave 0 打勾，写波次日志。
- [x] Commit: `chore(blueprint): wave 0 complete`

---

# Wave 1：好玩优先项（详细计划）

目标：补上四份审计一致指认的三大体验空洞——"这是**我的**调查员的恐怖"、"吓人靠日常失序而非怪物"、"疯狂/幸运有桌面仪式感"。以技能层指令 + 少量结构化字段为主，运行时改动集中在幸运消费与 reality check。

### Task W1-1: 幸运消费运行时（spend_luck + 推骰互斥 + 会话恢复）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_roll.py`
- Modify: `plugins/coc-keeper/scripts/coc_state.py`（investigator-state 增 `current_luck` 合并写；`pacing-state.json.luck_spent_last` 更新）
- Modify: `plugins/coc-keeper/skills/coc-rules-engine/SKILL.md`、`plugins/coc-keeper/skills/coc-keeper-play/SKILL.md`
- Test: `tests/test_roll.py`

**Interfaces:**
- Produces:
  ```python
  def spend_luck(result: dict, points: int, current_luck: int,
                 *, roll_kind: str = "skill") -> dict
  ```
  返回新 result（`roll` 减 points 后按 `coc_rules.success_level` 重算 `outcome`），并带 `luck_spent`、`luck_remaining`、`improvement_tick_eligible: False`、`rule_ref: "core.optional.spending_luck"`。校验（violation 时 raise ValueError，reason 带 constraint 名）：`roll_kind in {"luck","damage","sanity","sanity_loss"}` 禁止；`result.get("pushed")` 禁止；`result["outcome"] in ("critical","fumble")` 禁止（大成败仍生效）；`points > current_luck` 禁止。
  ```python
  def recover_luck(current_luck: int, rng=None) -> dict   # 1D100 > current -> +1D10, cap 99（p.99）
  ```
- Consumes: W0-6 的 `luck_rule()` constraints。

- [x] Step 1: 失败测试（成功改判、禁项逐条 ValueError、cap 99、tick 不可得、recover 边界）——测试代码写进 `tests/test_roll.py`，每条 constraint 一个用例。
- [x] Step 2: 确认失败 → Step 3: 实现 → Step 4: 通过。
- [x] Step 5: 技能层接线：`coc-rules-engine/SKILL.md` 增加"失败后二选一：推骰 XOR 花幸运"工作流（KP 必须先预告失败恶果再让玩家选）；`coc-keeper-play/SKILL.md` 的 Action Prompt Shape 节加"生死关头提示可花幸运，并报出当前 Luck 与将剩余值"。
- [x] Step 6: `coc_state`：结算后把 `current_luck` 合并进 `save/investigator-state/<id>.json`、`pacing-state.luck_spent_last` 置位（director 已消费该信号）。
- [x] Step 7: 全量相关测试 + Commit `feat(rules): luck spend runtime with push-XOR-luck gating (p.99)`

### Task W1-2: 背景个人化恐怖（织入钩 + 发作腐蚀背景）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_sanity.py`（bout 结束时产出结构化 `backstory_amend_suggestion`）
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`（CHARACTER/PAYOFF 消费 `personal_horror_hooks`）
- Modify: `plugins/coc-keeper/scripts/coc_state.py`（investigator-state 增 `personal_horror_hooks[]`、`backstory_corruptions[]` 读写）
- Modify: `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md`、`plugins/coc-keeper/skills/coc-character/SKILL.md`
- Test: `tests/test_sanity_session.py`、`tests/test_story_director.py`

**要点：**
- 结构化字段（不做文本扫描）：`personal_horror_hooks: [{hook_id, backstory_field, summary, woven: bool}]`；`backstory_field` 枚举 = 规则书 p.157 的九类（personal_description / ideology_beliefs / significant_people / meaningful_locations / treasured_possessions / traits / injuries_scars / phobias_manias / encounters）。
- bout 结束事件附 `backstory_amend_suggestion: {mode: "corrupt_existing"|"add_irrational", backstory_field, keeper_note}`（p.157：优先腐蚀既有条目、与剧情绑定）；由 KP（LLM）在叙事层与玩家协商采纳，运行时只记账。
- Table VII/VIII 的 5/6 号结果（Significant Person / Ideology）已要求读背景——skill 层明确指示 KP 此时必须引用具体 backstory 条目。
- director：`build_director_context` 读 hooks；CHARACTER 动作的 narrative_directives 优先未织入的 hook；PAYOFF 可回收已织入 hook 做回声。
- skill 层：开场协议加"读角色卡 → 选 1–2 条背景做织入问题（3–5 问）"；`coc-character` 建卡末尾生成初始 hooks。

- [x] TDD 步骤同型（先测 hooks 读写与 bout 建议事件，再测 director 消费），Commit `feat(horror): personal backstory hooks + bout backstory corruption (p.157, p.193-194)`

### Task W1-3: 幻觉与 Reality Check

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_sanity.py`
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`（underlying 期允许 DEEPEN/PRESSURE 注入妄想指令）
- Modify: `plugins/coc-keeper/skills/coc-sanity/SKILL.md`（扩写：删掉"V1 不做长期效果"段）
- Test: `tests/test_sanity_session.py`

**Interfaces:**
- Produces:
  - `SanitySession.plant_delusion(description: str, *, backstory_field: str | None = None) -> dict`：underlying 期（`is_insane` 且非 bout）才允许；记录 `active_delusion = {description, backstory_field, resistant: False}`；非 underlying 期 raise。
  - `SanitySession.reality_check(roll_result=None) -> dict`（p.162-163）：SAN 检定；成功 → 清除 `active_delusion`、置 `delusion_resistant = True`（直到下次 SAN 损失，`sanity_check` 内损失>0 时复位）；失败 → `-1 SAN` 且立即触发新 bout（复用 W0-5 `_start_bout`），妄想不清除。
  - director：`rule_signals` 增 `delusion_active`；underlying 期 DEEPEN 的 narrative_directives 可带 `delusion_seed`（引用 backstory hook，Constitution 合规：引用的是结构化 hook 而非扫描散文）。
- skill 层：coc-sanity SKILL 增加 Reality Check 工作流（玩家喊"我怀疑这是幻觉"→ 走 reality_check；KP 不主动揭穿；成功后 KP 必须如实描述真实场景）。

- [x] TDD 同型；Commit `feat(sanity): delusions + reality check with bout retrigger (p.162-163)`

### Task W1-4: 恐惧症/躁狂结构化压迫（清除子串匹配宪法债）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_sanity.py`（`penalty_die_for_exposure` L479-497 重写）
- Modify: `plugins/coc-keeper/references/rules-json/phobias.json`、`manias.json`（每条目加 `trigger_tags: [..]` 结构化标签）
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`（scene/danger 的 `threat_tags` 与 phobia `trigger_tags` 交集 → 注入惩罚骰信号）
- Test: `tests/test_phobia_mania.py`

**要点：**
- 违宪点：`phobia_source.lower() in self.phobia.lower()` 是子串扫描。重写为：`penalty_die_for_exposure(*, exposure_tags: set[str])`，与会话记录的 `phobia_tags`/`mania_tags`（获得时从 JSON 表取）求交集；无标签则返回 0 并在返回值带 `"reason": "no_structured_exposure_evidence"`。
- 100 条 phobia/mania 的 `trigger_tags` 由一次性脚本从 trigger 描述半自动生成 + 人工校对（生成过程可用文本，运行时只用标签——Constitution 允许编译期处理）。
- mania 未满足时的持续惩罚：`mania_unindulged: bool` 状态 + `indulge_mania()`；Psychoanalysis 成功 → `suppressed_until_next_san_loss = True`（p.162）。
- director：danger/scene 数据已有 tags 结构的沿用；没有的加 `threat_tags` 可选字段（scenario schema 文档同步）。

- [x] TDD 同型；Commit `fix(sanity): structured phobia/mania exposure tags, drop substring matching`

### Task W1-5: 惊吓技法 + Mythos 展示阶梯 + 怪物演出契约

**Files:**
- Modify: `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md`（新增 "## Horror Craft" 节）
- Modify: `plugins/coc-keeper/skills/coc-mythos-reference/SKILL.md`（新增怪物演出契约节）
- Modify: `plugins/coc-keeper/references/rules-json/monsters.json`（每个怪物加 `presentation` 块）
- Modify: `plugins/coc-keeper/references/rules-json/storylet-library.json`（新增 trope：`mundane_expectation_break`、`cognitive_dissonance` 各 ≥3 条 storylet）
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`（`horror_stage ∈ {ordinary, wrongness}` 时 PRESSURE/DEEPEN 提升上述 trope 权重；威胁临场时注入 `mythos_presentation` 指令）
- Test: `tests/test_story_director.py`、`tests/test_scenario.py`（monsters schema 校验）

**要点（全部来自 Ch10 p.207-211 + Ch14 p.280-282）：**
- Horror Craft 硬规则（skill 层，KP 必须遵守）：
  1. 恐惧优先来自**日常预期被颠覆**（妻子刚出门又从楼上走下来），点名怪物永远放最后；
  2. 展示阶梯：气味/触感/痕迹 → 感官细节 → 物证 → （可选）命名；在 `horror_stage` 达 revelation 前禁止直接说出怪物名；
  3. 失败 Spot ≠ "什么都没有"；不代玩家下结论（"没有生命迹象"≠"死了"）；
  4. 问题叠问题：解开一层必须掀开更深一层。
- `monsters.json.presentation`: `{never_name_until: "revelation", sensory_signature: [...], death_residue: "...", combat_goal: "kill|capture|flee|ritual", retreat_below_hp_fraction: 0.3}`（智慧种族不轻易拼命，p.281；0 HP 神祇 = 驱散非死亡）。
- director 消费 `presentation`：威胁进场时 narrative_directives 附 `sensory_signature` 采样与 `never_name_until` 约束。

- [x] TDD：schema 校验测试 + director 权重测试 + storylet 库 lint；Commit `feat(horror): scare craft rules, mythos presentation ladder, monster contracts (p.207-211, p.280-282)`

### Task W1-6: SAN 失败桌面演出协议 + 收尾仪式（Ending / Epilogue / 奖励）

**Files:**
- Modify: `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md`（"## Failed SAN Table Protocol" 与 "## Ending a Story" 两节）
- Modify: `plugins/coc-keeper/skills/coc-sanity/SKILL.md`（bout 实时/总结两种演出的执行细则，与 W0-5 引擎对齐）
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`（终局场景 PAYOFF 时发 `session_ending` 事件——playtest 已有该事件类型，live 侧补齐）
- Test: `tests/test_director_apply.py`

**要点：**
- SAN 失败协议：先演 involuntary（引擎已给 kind）→ 若触发 bout：real_time 模式 KP 逐轮宣告强制行动（引擎 `tick_bout_round`），summary 模式直接快进描述"醒来时的场景"（Table VIII 结果已含）→ bout 结束交还控制并提示 underlying 脆弱状态。underlying 期日常行为可完全正常（p.158），禁止全程疯演。
- Ending 协议（p.212-213）：识别终局 → 逐人一段短 epilogue（KP 邀玩家共写）→ 结算 SAN 奖励（scenario endings 数据 + keeper award）→ 提示成长阶段（Wave 2 落引擎前先用手工流程）→ 幸运恢复（W1-1 `recover_luck`）。cliffhanger 也是合法收尾。
- 调查员死亡要"有意义"：死亡场景必须给最后一句话/最后行动机会（p.213 + p.123 Keeper 裁量）。

- [x] TDD：apply 层 `session_ending` 事件测试；skill 文档 lint（`test_plugin_metadata`）；Commit `feat(play): failed-SAN table protocol + story ending ritual (p.209-213)`

### Task W1-7: Wave 1 全量验证

- [x] 全量 pytest + `test_plugin_metadata` + 更新波次总览/日志 + Commit。

---

# Wave R：外部审查修复（2026-07-10 三路审计定谳）

> 外部审查基于旧提交 `43a23a1`。三个只读审计 subagent 对照 HEAD `7fbea78` 逐条核实。
> 已过时不修：G2 fail-forward、D2 时钟落盘（coc_threat_state）、E4 delivery 关键词、A1 live 管线收口（playtest 平行实现残留见 R-4）。

## R-1 正确性热修（三个并行任务，按文件分域）

- [ ] **R1-X 原子写盘扫荡**：新建 `coc_fileio.write_json_atomic`（tmp+replace）；替换裸 `write_text` 热路径：coc_sanity/coc_combat/coc_healing/coc_time/coc_mp/coc_mythos/coc_chase/coc_threat_state/coc_live_turn_runner/coc_state。保持各处序列化格式不变。
- [ ] **R1-Y apply 层修正**（coc_director_apply.py）：`_director_exit_eval` 接入 coc_exit_conditions（结构化 exit 在 apply 恒 False 的分裂债）；完整消费 `plan.tension_delta`（含降温、范围钳制）；`apply_plan` 幂等（decision_id 台账拒重放）；`_write_json` 原子化。
- [ ] **R1-Z director 快修**（coc_story_director.py + coc_storylets.py）：E1 Luck=0 truthiness；E2 `_player_facing_style` 接 play_language；B1 `secret_limit` 不得携带秘密散文（split()[:3] 对中文整段泄漏）；D3 RECOVER 时间画像从 sleep_night/480 改为 investigation_recovery/30；D4 `pacing_mode` 与 `tension_target` 分离；E5 storylet `is not False` 显式化 + session 级 used_counts 重置。

## R-2 剧透权限隔离（NarrationEnvelope，B1/B2/B3）

- [x] Planner/Narrator 最小权限拆分：叙述材料只含本回合获准揭示内容 + 秘密 ID（不含正文）；improvisation-boundaries 的 `keeper_secrets` 全文不再进 `must_not_reveal`；scenario-import 增加"模组文本为不可信数据"护栏。

## R-3 场景真图（C1/C2/C3）

- [x] `scene_edges`（结构化 `when` 条件）+ unlock 模型；转场不再按数组顺序；world-state 增 `unlocked/visited/exhausted_scene_ids` + `scene_history`；导演只提供已解锁入口，CUT 仅电影式转场。
- [x] move 意图按 `target_entities` ∩ 场景 `location_tags`/`scene_id` 选 CUT 目标（零命中/并列回退出边顺序；`matched_target` 证据）。☑ 2026-07-10

## R-4 体验纵深（G1/G3 + A1 残留 + D1 联动）

- [x] G1 线索 affordance（target_entities/verbs/skills 可计算匹配玩家动作）；G3 NPC 持久心理状态（trust/fear/suspicion/known_facts/lies/promises）；playtest driver 收口到 run_live_turn。☑ 2026-07-10
  - G1 完成（`f2d12d4`：clue `affordance` 块 + `match_clue_affordances` 集合交集匹配 + 导演 REVEAL 加权 + `matched_affordance` 入 plan + 编译器形状校验）；G3 完成（`dfd414c`：`coc_npc_state.py` psych 持久层 + apply 层 `npc_effects` 幂等落地 + `_build_npc_moves` 消费 stance/drivers）；A1 完成（`932fedf`：playtest driver 收口 `run_live_turn`，删平行管线 192 行，`simulation_method` 保持非 live 标注）。

## R-5 PDF 编译器硬化（F1-F4）+ CI

- [x] 编译器补校验：ID 唯一、引用完整性、可达性/死节点、多路线独立、start/finale、leads_to 目标、source_refs 锚点存在性；`origin: source|inferred|improvised` + confidence；依赖 doctor；GitHub Actions CI。
- [x] 可选 `location_tags` 形状校验（非空字符串列表 → `invalid_location_tags` warning）。☑ 2026-07-10

---

# Wave 2：规则引擎补洞（任务级定义，启动时展开细化计划）

> 启动本波时：以本节为 spec，按 writing-plans 流程写 `2026-XX-XX-wave2-rules-depth.md` 细化计划（bite-sized TDD），完成后回本文件打勾。

- [x] **W2-1 典籍阅读引擎**：新建 `plugins/coc-keeper/scripts/coc_tomes.py`。`TomeSession.read(phase="skim|initial|full|research")`：语言/Read Language 前置、initial → CMI + SAN、full → CMF/MR、耗时（周）、法术摘要揭示、research 用 Mythos Rating、重复 full 时间翻倍、非信徒可延迟 SAN（与 believer 流程联动）。数据已备（`tomes.json` CMI/CMF/MR）。技能层：书的感官描写与"书之人格"指导（Ch11 p.224-226）。KP 策略：情节关键典籍失败不卡死（p.211-212 → `plot_critical: skip_failure_gate` 字段）。
- [x] **W2-2 成长阶段结算引擎**：新建 `coc_development.py`。`run_development_phase(campaign_dir, investigator_id)`：读 `development.jsonl` ticks → 逐技能 1D100 > skill 或 >95 → +1D10 写回 character.json → 技能达 90 → `gain_san(2D6)` → 幸运恢复（W1-1）→ awfulness_caps 各 -1（恐怖回潮，p.169）→ 清 ticks。成功检定自动记 tick：在 live turn 落骰点处（`coc_director_apply` 掷骰结果落地点）按 W0-6 规则（排除花幸运/奖励骰-only/对抗负方/Mythos/CR）写 `skill_check_earned`。
- [x] **W2-3 推骰门闩进 apply 层**：`coc_director_apply` 强制四阶段（改方法→KP 预告→确认→更糟后果）；`coc_narrative_enrichment._atom_roll_contract` L540 按 roll kind 自动置 `push_eligible=False`（SAN/Luck/对抗/伤害/战斗内）；推骰失败挂 `pushed_fail_pending` 驱动 PRESSURE；underlying 期推骰失败可用妄想作后果（W1-3 联动，p.163）。
- [x] **W2-4 治疗/asylum/self-help 重做**：对齐 p.164-168 —— private care 月度 01-95/96-100 档、asylum 机构品质档（不再"1 次 Psychoanalysis 直接回满"）、"先 +1D3 再 SAN 检定治愈不定性"两步、self-help 绑 backstory key connection、失败改写背景条目；`treatment.json` 补月度表。
- [x] **W2-5 施法与魔法后果**：`coc_magic.cast_spell` 推骰失败 → MP **与 SAN** ×1D6 + 1D8 副作用表（弱法/强法两档，p.178-179）+ POW 消耗结算 + 施法被打断规则；`learn_spell` 支持 `source="entity"`（`from_entity_min_sanity_cost`）。
- [x] **W2-6 信徒流程接线**：investigator-state 增 `believer: bool`；读典籍分支"选择不信"；首次神话目击强制 `become_believer(first_hand)` + 世界色调切换（`tone: mythos_bleak` 注入，Ch10 p.212）。
- [x] **W2-7 Fair Warning 结构化**：致命场景强制累计 3 次 diegetic 警告（气味/疯子嘲讽/环境声）才允许致命结果；`lethal_chances_used` 由 apply 层在警告落地时递增（现在只有读者没有写者）；director Layer-3 加显式拦截分支（替换 coc_story_director.py:1190-1196 的"结构性依赖"注释）。
- [x] **W2-8 Idea Roll 失败代价结构化**：idea_roll 成败都推进但失败"以最糟方式获得信息"（p.199）——结果附 `failure_delivery: "worst_possible_way"` 指令。
- [x] **W2-9 全量验证 + 打勾写日志**

# Wave 3：动作场面（任务级定义）

- [x] **W3-1 追逐重写（最大项）**：`coc_chase.py` 按 Part 1-5 重构 —— `cut_to_the_chase()`（默认落后 2 格入场 + location chain 生成）；hazard 真机制（谨慎买奖励骰/失败伤害+1D3 移动动作债务仍前进）；barrier HP/砸开（Build×1D10）/车撞毁→残骸变 hazard；Part 4 conflict 同格近战委托 `CombatSession`、车战 Drive Auto 对抗、车伤 Build×1D10、`vehicle_collision` 接入会话；可选规则里优先 Pedal to the Metal（加速换惩罚骰）、乘客动作、边跑开火、Choosing a Route、Sudden Hazards（交替 Luck）。`chase.json` 载具 MOV 对齐 Table V（经济车 13 等）。`coc-chase/SKILL.md` 从 21 行重写为 Part1-5 工作流。
- [x] **W3-2 火器深度**：瞄准（+1 奖励骰）、手枪多发（每发-1 惩罚级）、装填耗轮、全自动 volley（技能/10 一组）、压制射击；`weapons.json` 的 `uses_per_round` 接入引擎。
- [x] **W3-3 环境伤害引擎**：`apply_other_damage(severity)`（Table III p.124 档位）、窒息状态机（每轮 CON→伤害→0HP 死且忽略重伤规则）、`apply_poison(id)`（`poisons.json` 接入，Extreme CON 减半）；环境伤 `bypass_armor`。
- [x] **W3-4 近战补丁**：投掷武器路径（可 Dodge、半 DB）、prone 攻防修正（近战+1奖励/远程-1惩罚）、maneuver 命名统一（代码 `VALID_MANEUVER_GOALS` vs SKILL.md 141-148 的 grapple/break_free 不一致）、防御方 maneuver 反制。
- [x] **W3-5 全量验证 + 打勾写日志**

# Wave 4：遗留工程项（N 系列，任务级定义）

> 事实与验收标准见 `docs/superpowers/specs/2026-07-10-next-phase-optimization-audit.md`，此处只登记防遗忘。

- [x] **N5 真 LLM 玩家 vs KP harness**（审计标尺）：`runtime/adapters/player/` + `coc_live_match.py`；玩家 LLM 只看 `build_public_state` 等 player-safe 字段；`live=False` 的 `simulation_method` 永不算 gameplay 证据；仅 `--live` 可标 `live_llm_player_vs_kp`。**Live player bridge 已落地**：`run_player_turn.mjs` 为真实 pi-coding-agent 桥（与 KP `run_turn.mjs` 同骨架；AI coding tool LLM 扮调查员；`coc_player_action` 单工具；散文无工具时降级为可用 `player_text`）。
- [x] **N6 存档工程化**：apply 热路径统一 `write_json_atomic`（coc_director_apply.py:177 等非原子点）、轻量文件锁、schema_version 迁移钩子。
- [x] **N1 多宿主安装**：`.claude-plugin/` manifest + Cursor 入口薄适配层指向同一 skills 树（单轨法）；立绘保持 `CODEX_ONLY_IMAGEGEN` 门控。
- [x] **N2+N7 内容与快速开玩**：The Haunting 叙事包（story-graph/clue-graph/npc-agendas）或第二短 starter；预生成调查员 + 一句话开玩入口。
- [x] **N3 叙述质量闭环**：`guard_player_visible_text` 进 live 必查回路 + `narration-audit.jsonl`。
- [x] **N4 缓存**：storylet 库/规则表/结构权重模块级缓存 + mtime 失效。
- [x] **N8 清理**：`storylet-scheduler.jsonl` 只写不读、`fork_timeline` stub、`npc-role-keywords.json` 更名（实为 enum→template 映射，名字易误导后人抄成关键词扫描）。
- [x] **全量验证 + 打勾写日志**

# Backlog（暂不排期，防遗忘登记）

- Contacts 子系统（难度 → KP 暗骰推骰 → 敌对线人，p.97-98）
- Training / 游玩中 Aging（战役时间轴触发，p.98-99）
- Credit Rating 日消费/超支/就业复盘（p.95-97 + 成长阶段 CR 复盘）
- 组合检定 `combined_percentile_check` / 对抗统一 `resolve_opposed` 公共 API、`difficulty_from_opponent` 推广到社交
- 物理人类极限 / 多人合力（p.88-89）
- 战斗 Spot Rules：Knock-out blows、Luck 撑清醒、命中部位、DEX 先攻掷等（p.123-129 可选规则）
- 理智可选规则：Insane Insight、Multiple Sanity rolls、Spontaneous Mythos 施法、POW 增长
- playtest 三巨头（1.3 万行）拆分重构
- 多人桌支持（当前单玩家假设）
- 编译校验 schema 演进（R-5 遗留）：多路线独立需 `alternate_route` 身份（现用去重 clue_id 近似）；`source_refs` 锚点校验依赖调用方传 `source_segments`，无则跳过
- 场景边自动编译（R-3 遗留）：编译器暂不强制为旧模组生成 `scene_edges`，新剧本按 compile-protocol 要求产出
- 模组身份 schema 细化（Masks 实测暴露）：`module_identity` 需区分 `module_edition` vs `rules_edition`（MoN 5th ed 书 / CoC 7e 规则）；`source_refs.page` 统一用印刷页而非 PDF index（差约 −2）；巨册分章注册的兄弟章发现/聚合视图；Product Identity 散文不入 git 的存储边界文档化

---

## Self-Review 记录

- Spec 覆盖：四份审计的 P0/P1 项均已映射（Ch10 #1→W1-2、#2/#3→W1-5、#4→W1-6+W0-5、#5→W1-6、Ch5 #1→W1-1+W0-6、#2→W2-2、#3→W2-3、Ch6/7 #1-3→W0-1/2/3、#4-10→W3-1/2、Ch8/9 #1→W1-3、#2→W0-5、#3→W1-4、#4→W2-1、#5→W0-5、#6→W2-5、#7→W1-5、#8→W2-4、#10→W2-2(-1 回潮)+W0-7、#12→W0-4）；旧 N1-N8 全部登记 Wave 4/Backlog（N4 属体验批次但排 Wave 4 统一做）。
- 类型一致性：`stabilized`/`dying`/`dead`/`prone`/`unconscious` conditions 命名跨 W0-1/W0-2/healing-combat 一致；`bout_active`/`bout_rounds_remaining` 跨 W0-5/W0-7/W1-6 一致；`day_start_san` 跨 W0-4/W0-7 一致。
- 占位符检查：Wave 0/1 全部任务有具体文件、接口签名与测试；Wave 2-4 明确标注"启动时展开细化计划"并给出验收要点，不属于隐性 TBD。
