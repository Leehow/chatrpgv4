Status: landed @ 7c9317f21（2026-09-26；真桌 B2 T10 发现；B 桌 T3–T10 的 `unclear` 同源）
Spec: docs/specs/npc-acts-first.md（D4；第九节「B2 桌」）
Contract: §143.23（新）；修 §135.30 的 compile state 与 §143.21 的收尾句

# 24 — 说话对象：compile 看得到上一回合谁在跟调查员说话；没点名时由生成器自己判这句话是不是说给他的

## 证据（真桌 `npc-acts-b2`）

- T10：玩家对亚瑟说「行行行，我不带走。那你先把我那五块钱还给我。」钱在亚瑟那儿（上一回合他说「钱先放着」），compile 的 addressee 却是 `unclear` 0.83。亚瑟和露丝都在对话中（工单 21 的 `engaged`），两人都拿到原话（§143.21 对 engaged 给 `addressed: true`），露丝生成「阿蒂，这人问我讨五块钱」——把冲亚瑟的话当成对她说的。T8 她也在复述亚瑟的立场。
- 根因：compile 的 state（`runtime/jev/route-compile.ts`）只有 `player_input`、`now {scene, clock, present}`、`done_this_turn`、`materials`。看不到上一回合谁在跟调查员说话，「你」「他」这种指人的词只能判 `unclear`。B 桌 T3 0.52、T4 0.86、T6 0.43、T10 0.27 都是 `unclear`。

## Scope

1. **compile 读上一回合的交谈（结构，不读散文）。** state 加 `last_exchange`：最新已提交回合（调查员仍在那个场景时）的玩家原话，与那回合交付里说话记号归属的台词 `[{who: 显示名, line}]`（记录的 `speech`，§40.3/§128），按条数与字数封顶。addressee 的问题说明加一句：指人的词（你、他、这位）按 `last_exchange` 里刚才谁在跟调查员说话来读。宿主从内核读（已有的 committed record；需要的话给 capsule 或一个只读方法加字段），不在宿主解析正文。
2. **没点名时让生成器判。** 扫描传给 `npc.situation` 的读法从布尔扩成能表达「没点名说给谁」：点名他 → 原话照旧；compile 点名别人 → 不给（§143.21 修正后）；没点名任何人（`unclear`/`none`/不过闸）而他被作用或在对话中 → 收尾句写成「<调查员> declared (to no one by name): "..."」。`content/setup/npc-act.md` 加一句：没点名的话可能是说给在场别人的，是说给你的才回应它。形状（新字段或三态）由你定，写进契约。
3. 契约 §143.23；§135.30 与 §143.21 各加带日期的注。

## Not in scope

- 身份重复（另一条线已修）；时钟（KP 跳时间不落账，另开）。

## Acceptance

- ext：compile 批的 state 带 `last_exchange`，内容来自上一回合记录的 `speech`（夹具：上一回合亚瑟说了一句、露丝说了一句）；没有上一回合或调查员已离开那个场景时不带。
- loop：两人在对话中、addressee `unclear` → 两人的包收尾句都是「to no one by name」形式；点名其中一人 → 只他有原话。
- 变异：去掉 `last_exchange` → 第一条逮住；收尾句退回无条件原话 → 第二条逮住。
- 真桌 B3 看：「你」类的话 addressee 是否过闸、在场旁人是否还接错话。

## 落地记录（2026-09-26）

- `table.status` 加 `last_exchange {turn, player_text, speech:[{who,line}]}|null`：最新已提交回合，调查员还在那个场景时才给；只取结构（原话与说话记号归属的台词），末 6 条、每条 200 字、原话 400 字封顶；读不到 turns 目录给 null。放在 `table.status` 而不是胶囊上，KP 的上下文与预算不动；代价是 `table.status` 多读一次 turns 目录。
- compile 的 state 带 `last_exchange`，addressee 说明加一句「指人的词按 last_exchange 读」。
- `npc.situation` 新输入 `named_no_one`：compile 没点名任何人时，收尾句写成「declared (to no one by name): "..."」；`addressed:false` 仍优先，`declared_before_move` 仍给到场句。车道说明加一段：没点名的话可能是说给别人的。
- 测试：`test_last_exchange.py` 6、`test_npc_situation.py` 14、`single-loop-npc-act` 相关用例；两处既有断言改成「to no one by name」的形式。变异两处各被逮住。未真桌验证（B3）。
