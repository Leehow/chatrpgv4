Status: landed（2026-09-26，由我直接修；工单 20 的实机探针 T3 发现）
Spec: docs/specs/npc-acts-first.md（D10；第八节）
Contract: docs/kernel-rpc.md §143.22

# 23 — 掏出来的东西按「同一类」对上规则书；几把相近的枪分走概率，不能让枪变成开不了火的物件

## 证据

工单 20 的实机探针（gate-a，T3，dangerous/escalates）：生成器说诺特掏出「藏在旧账本下的短管左轮手枪」。第一批问题过闸选了
`weapon_table` 这一部分，第二批在这部分里没有任何一条记录单独过闸，于是铸成了桌上物件——没有数值，攻击用不了它。用户的 D10
原话是「npc 从裤裆里掏出一把手枪把主角毙了也不是不可能」，一把规则上开不了火的枪正好不是这个意思。T6 的「.32 左轮」对上了书里
的 `.32 or 7.65mm Revolver`，两次都绑成了威逼。

## 裁定（我按代码能裁的分叉自己定，写进契约）

1. **问题按「同一类」问，不按「就是它」问。** 以前问「哪条记录就是那个东西」，书名里没有的细节（短管、藏在账本下）都把答案推向
   `none`。现在问「哪条记录是同一类东西、规则就是它的」；牌子、尺寸、藏在哪里，不会让它变成另一样东西。部分问题同理。
2. **「是不是书里的东西」过闸后，取领先的那条。** 东西已经存在（骰子许可、生成器点名），记录只是给它规则。一条记录自己过闸照旧；
   没过时，若领先的是记录、且记录们的概率之和（`none` 之外）过闸，就取领先那条，绑定行 `answers.produce` 记 `cleared_by: "kind"`
   与 `on_records`。`none` 领先、或记录合计不过闸，仍是桌上物件。
3. 第二批的遥测行加前五名分布（`answer.top`），以后能直接读出是不是近亲分票。

## 落地

- `runtime/jev/npc-act-step.ts`：`produceQuestion` 与 `produce_part` 的措辞；`interpretNpcAct` 的 `pickRecord`；stage produce 行的 `top`。
- `tests/extension/single-loop-npc-act.test.mjs`：新用例「§143.22 which record, once it is a record at all」；一条既有断言改了 `none` 的措辞。
- 变异（副本还原）：关掉按类别取值 → 近亲用例失败。
- 本机单文件：`single-loop-npc-act` 27/27（build 重取后）、`npc-act-generation` 54/54。
- **未真桌验证**：D10 桌上看诺特掏出东西时，读 bind 行的 `produced` 与 `cleared_by`。
