# SAN 族从「不可玩」到「一个回合走完」— 2026-09-02

Track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。诊断跑 r26–r35（造景 lane，真 Grok KP，
每轮 3 条）。本文只记当天量到的事实。

## 结果

r35 三条 lane 全部 `finalized=true` / `exact_delivery=true`，205–219 秒。
在此之前 r32–r34 连续四轮**一条都没收尾**。

| | r32 | r33 | r34 | r35 |
| --- | --- | --- | --- | --- |
| 收尾 | 0/3 | 0/3 | 0/3 | **3/3** |
| 成功结算 | 0 | 3 | 7 | 8 |
| bout-tick 结算 | 0 | 0 | 4 | 4 |
| chase start | 0 | 0 | 0 | 1 |
| 耗时 | 356–430s | 544–617s | 420–901s | 205–219s |

耗时回落不是变快：前四轮的 500–900 秒里大半花在 `turn.finalize` 被拒后反复重试、
翻 schema、再试。**收尾修好之前，时长测的是打转，不是干活。** 对 180 秒预算仍差
25–39 秒。

## 七层，每层只有修好上一层才暴露

1. **读场景作废手里的牌**（`3d888f3c`）card grant 只活在 RulesRuntime 实例里，
   `scene.context` 会重建实例。`rules.context → scene.context → rules.settle`
   这个最普通的顺序把刚发的牌销毁。7 条 lane 里出现 8 次。
2. **报错只说 `(undeclared)`**（`0146df7b`）未声明身份字段整封坍塌，但不说是哪个
   字段。sanity 族整轮不可见，只能靠翻宿主内部 evidence 反推。现在错误报出字段名
   （名字是 schema，值仍然扣留）。
3. **bout 由不能推进它的引擎开启**（`35f7aa45`）`decision:coc7:sanity:check` 调
   `rules.sanity_check`（建议表面，不持久化），而 bout-tick/bout-end 调
   `sanity.execute`，其 host-locked 槽位全部来自子系统待决选择。bout 开了就永远
   推不动，而 p.157 阻断后续 SAN 检定 → 整族卡死。
4. **跳过检定时伪造掷骰**（`07e94a46`）bout 期间 `SanitySession` 返回
   `sanity_check_skipped`（不掷骰），执行器却拿 `roll=0` 送进百分位投影 →
   `roll must be between 1 and 100`。加上两层遮蔽：事务包装把任何回滚异常重贴成
   `subsystem_transaction_failed`（在 toolbox 里属**瞬时可重试**），以及
   `SubsystemExecutorError` 继承 `ValueError` 被通用捕获压成 `invalid_request`。
5. **旧存档孤儿 bout 死锁**（`43b5bce2`）旧接线开的 bout 写在 sanity.json、执行器
   不知道。第 4 层的拒绝指向 bout-tick，而那个选择不存在 → 两条错误互相咬死。
   按会话自己的 `end_bout` 关闭并留收据；**不接管**——伪造 origin command 和私有
   上下文正是 `_migrate_schema_v2` 明文拒绝的事。
6. **待决选择的回应命令永远匹配不上**（`ca557d54`）执行器从规范状态重建期望批次
   逐字节比对，其 `command_id` 是 `resume:<摘要>:confirm`、payload 带派生的
   decision_id 与 request_index——手工拼命令不可能知道。改由宿主用
   `plan_from_pending_choice_response` 生成；这些槽位本就 host-locked，规范状态
   才是权威，等值校验不受削弱。
7. **结算证明不了自己的状态写入**（`968253e7`）`_rules_settle_writer_domains`
   要求信封同时拿出收据、规范事件、资源当前值且互相吻合，`conditions` 对不上会
   连带作废其他所有域。sanity 结算三样全缺。**这个洞比第 3 层更早**——同一个探针
   在 `35f7aa45^` 上失败方式完全相同；它一直没发作，是因为之前 lane 里 SAN 检定
   全都因别的原因失败。

另外修的：`96df3faf`（硬门关着时报出是哪个事实，而不是让 Keeper 去刷新一张不会
出现的牌）、`03a6d996`（宿主自己注入的 `san_before` 被当成 Keeper 的参数错误；
一次只报一个多余键；`declared_slots` 对全 host-locked 的决策读起来像待填清单）。

## 还剩的（r35）

- `grant_binding_drifted` ×2 — 无独立 state-revision 提供者时，绑定退化为**整个
  事实集**的摘要，任何地方的事实一动就作废所有授权。开始一场追逐会作废一张 sanity
  卡。代价是一次多余往返，不是卡死；收窄绑定有正确性风险，**留给用户拍板**。
- `sanity_bout_choice_unavailable` ×2、`invalid_semantic_input` ×2、
  `chase_candidate_invalid` ×1 等 — 已知项，无新类别。

## 方法上的教训（当天踩到四次）

**探针会骗人，而且骗法各不相同。** 当天四次：`explain_missing_grant` 第一版凡是
存在覆盖授权就报「绑定漂移」并给空的漂移键列表（编造原因）；投影探针把
`diagnostics` 塞进选项对象而非位置参数，**从头到尾什么都没检查**却报「本地复现不
出来」；孤儿 bout 夹具用「删掉 subsystem-state.json」伪造，被执行器正当地识破为
账本损坏；手写的效果对象用 `kind` 而非 `effect_kind`，在代码已经正确之后仍报
`mismatch`。

对策：探针的结论必须与另一条独立路径并排比对（`latest_grant_covering` 说 FOUND
就不能报漂移）；夹具走产品自己的 API 造状态；测试驱动真实投影器，不用自己编的
对象。**一个会编造原因的探针比没有探针更糟。**

**归因要用 worktree 验，不要用直觉。** 第 7 层我第一反应是自己改形状造成的回归，
开 worktree 到 `35f7aa45^` 跑同一个探针才确认它更早存在。
