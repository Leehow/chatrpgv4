# 规则层收敛目标与逐轮记录 — 2026-09-02 夜

Track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。造景诊断 lane，真 Grok KP，每轮 3 条。

## 目标（可证伪）

每一轮 lane 必须同时满足：

1. 三条 lane 全部 `finalized`（回合走完并交付叙事）。
2. **零宿主责任失败**。宿主责任 = 以下任一：
   - 信封整封坍塌（`semantic_identity_unavailable`）
   - 宿主发送某决策未声明的输入，却把罪名报成 Keeper 的参数错误
   - 拒绝不点名任何 Keeper 能据以行动的事实
   - 两句宿主自己的话互相矛盾（卡片说收，校验器说不收）
   - 发得出却结算不了的卡，或结算得了却从不发的卡
   - 宿主的指引在自己的投影层被删掉
3. 剩余失败只来自模型自己的参数/顺序选择，且每条消息都点明怎么改。

**停止条件**：连续两轮全满足，或判定已无宿主责任缺陷可查。不无限烧额度。

## 逐轮

| 轮次 | 收尾 | 结算 | 宿主责任失败 | 备注 |
| --- | --- | --- | --- | --- |
| r32–r34 | 0/3 | 0–7 | 多 | 回合关不上（结算证明不了状态写入） |
| r35 | 3/3 | 8 | 2 类 | 首次收尾 |
| r36 | 3/3 | 7 | 3 类 | 身份坍塌回归（我自己加的 events 列表） |
| r37 | 3/3 | 9 | 1 类 | next_decisions 递出的牌被拒 |
| r38 | 3/3 | 7 | 2 类 | 消息里的 ref 被清洗；requires 被自己的身份规则删空 |
| r39 | 3/3 | 6 | **0** | 第一轮达标 |
| r40 | 3/3 | 11 | 1 | `chase:move` 完全不可结算（内核绑 `advance`，执行器要 `move:advance`） |
| r41 | 3/3 | 12 | 1 | 首次 `bout-end`；追逐走到链尾/屏障时收据被自己的校验器拒 |
| r42 | 3/3 | **13** | **0** | 首次 `start → move → move`，追逐族可玩 |
| r43 | 3/3 | 6 | 1 | `involuntary_kind` 拒绝不报 enum 成员 |
| r44 | 3/3 | 8 | **0** | enum 修复生效（Keeper 猜 `flee_impulse`，一次拿到全部六项） |
| r45 | 3/3 | 6 | **0** | **连续第二轮达标 → 停止条件满足** |

**结论：连续两轮（r44、r45）满足全部三条，按既定停止条件收工。**
剩余失败全部落在下面「非宿主责任」那一节列举的类别里，无新类别出现。

耗时 228–318 秒对 180 秒预算——**仍未达标**，这是明确未完成的一项。

`rules.context` 调用数 r37→r38 从 12 降到 7：续接授权省下的往返。

## 本轮修的宿主责任项（提交）

- `c4852df0` chase 绑定只给决策声明过的槽位（`chase_id` 只属于 start/end，却发给了 move/hazard/barrier/conflict）
- `52f9f238` `combat:flee` 不再声明全链路无人消费的 `candidate_ref`；顺带把两处手工加的图谱内容补进生成器，并按 132fb7c3 的规矩署名修订
- `5b2a7771` 结算递出的 `next_decisions` 用结算后的事实重算并发授权——递出的牌必须是能结算的牌
- `8210c8d1` settle-ending 金丝雀缩到仍然开着的三个字段
- `2fea8a5a` ref 从消息串移回 details（Pi 会把规范 id 从错误散文里删掉）；`requires` 从「以字段名为键的 map」改成字符串列表（键名是身份字段，值是散文，被 ref 语法判死）
- `58e9da65` 提示词点名 `settle_form` 是参数权威，并说明标识语法表不是字段菜单
- `940ea2ac` `chase:move` 绑定改成执行器接受的 `move:advance`（槽位全 host-locked，Keeper 无从补救）
- `b5598e61` + `6cb309b5` 「没前进的前进」收据（链尾 / 屏障阻挡）获得自己的精确契约；伪造判定改为**证据绑定**（对照重放位置与地点链），比原来「连真货一起拒」更强
- `c2466263` `involuntary_kind` 拒绝列出全部六个成员，并说明如何表达「没有非自愿动作」

## 判定为「非宿主责任」的（附理由）

- `combat:flee → subsystem_transaction_failed`「没有战斗在进行」：`attack` 就走 `combat.resolve`，Keeper 能靠攻击开战；消息已指路。
- `blocked_by_pending_choice`：bout 运行期间不能开新检定（p.157），消息点名 bout-tick / bout-end。
- `bout-tick → decision_not_available`：消息给出 `sanity.bout.pending is False, needs True`。
- `quarry_refs` 里传 `investigator:current-investigator`：句柄用于 `investigator` 参数；chase 的 ref 从宿主发布的候选清单里挑，拒绝信息把候选并排列出。

## 不属于我的失败

`tests/test_pi_package.py` 两个失败（`test_pi_system_instruction_debug_interception`、
`test_pi_auto_dispatch_uses_named_paths_bounded_queues_and_scene_priority`）来自
另一个会话今日 07:45 的 `9d30fa69`（TextGraph 词表生成改了 `claim_types` 排序）。
子测试是 `tool-affordance-extension.mjs::accepted-review hydration ...`，diff 纯粹是
字母序 vs 作者序。未触碰。

## 方法教训（当天累计五次探针失灵）

1. `explain_missing_grant` 第一版凡存在覆盖授权就报「漂移」并给空键列表——编造原因。
2. 投影探针把 `diagnostics` 塞进选项对象而非位置参数，什么都没检查却报「复现不出」。
3. 孤儿 bout 夹具用「删文件」伪造，被执行器正当识破为账本损坏。
4. 手写效果对象用 `kind` 而非 `effect_kind`，代码已正确仍报 mismatch。
5. 断言错误消息含有 ref——**在宿主层通过，Keeper 那边只看到标点**（Pi 清洗规范 id）。

共同点：**测在了错的那一层，或用自己编的对象代替产品产出。** 对策已固化为习惯：
探针结论必须与另一条独立路径并排比对；夹具走产品 API；测试驱动真实投影器；
断言要在模型实际看到的那一层。
