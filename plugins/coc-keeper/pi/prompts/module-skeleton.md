# 把这本书读成一副骨架

你拿到的是一本书的**结构页**(目录、导读)和**每一节的首页**。你的任务不是深读——
是给出这本书的**骨架**:它分成哪几节、节与节的先后顺序、主要的地点/势力/NPC 名册、
以及玩家最可能从哪里开始玩。

这副骨架决定一件实事:哪些节会被立刻深读(开场所在的节),哪些挂着等玩家走近了再读。
所以入口判断是这副骨架最重要的产出——判错了,玩家开局那十分钟就要等一节现抽。

## 只回一个 JSON 对象

回复是单个 GraphShard JSON 对象,没有 markdown 围栏,没有前后说明。契约词汇与
「深读」完全相同(见下),差别只在粒度:骨架写**粗**节点。

## 骨架写什么

- **一个 `module` 节点**:这本书自己。
- **每个分节一个 `section` 节点**:`node_id` 用方案给的 `section_id`,`name` 用书自己的
  标题。用 `contains` 从 module 连过去。
- **脊线**:节与节的顺序。书明说了游玩顺序用 `play-precedes`;只有出版/目录顺序用
  `print-precedes`;互不隶属的支线合集用 `independent-from`。不要把目录顺序说成因果。
- **名册**:结构页或节首页里出现的主要地点(`location`)、势力(`faction`)、NPC(`npc`)
  ——粗粒度的名字级节点,用 `part-of` / `located-in` 挂到它们所属的 section 上。
  没出现的不要编,名册之外还有什么是深读的事。
- **入口**:一个(或并列几个)`scene` 节点,书的文字明确说或强烈暗示玩家从这里开始。
  **每个入口场景的 `properties` 里必须写 `"is_entrance": true`。** 这是全书唯一
  说明「从哪开局」的地方——没有这个标记,装配出来的图不知道该激活哪个场景,KP
  开不了局。书里确实没有明说入口,就把最可能的候选标上并在 `summary` 里写明是推断
  (「导入」「序幕」「调查员受命……」)。`evidence_span_ids` 必须引到说这话的那几行。

## 三条红线(与深读相同)

1. 每个节点挂在它真正出自的 span 上;引错页和编造,机器分不出来,都会被打回。
2. 不知道就不写。名册宁缺毋滥;没有明说入口,就把你最有可能的候选标出来,在
   `summary` 里写明这是推断。
3. 名字用书自己的话。

## GraphShard 契约(逐字段照此,不多不少)

信封:`contract_id` 填 `coc.module-graph-shard.v3`,`schema_version` 填 `3`。
顶层键恰好是这两个加:`module_id`、`section_id`、`source_language`、`aspects`、
`evidence_span_ids`、`node_refs`、`coverage`、`nodes`、`claims`。
**不要写 `relations`** —— 机器从你的 claims 逐条投影出来。

- `module_id` / `section_id` / `aspects`:照抄 packet 里的同名字段(骨架的
  `section_id` 是 `skeleton`)。
- `source_language`:BCP 47 标签(如 `zh-Hans`、`en`);你写的所有散文保持该语言。
- 节点键恰好为:`node_id`、`node_kind`、`name`、`visibility`、`aliases`、`summary`、
  `evidence_span_ids`、`properties`。`node_id` 以 `node_kind` 加连字符开头
  (`section-peru-lima`),全小写 kebab-case;名字放 `name` / `aliases`,不进 id。
- 声明(claim)键:`claim_id`、`subject_id`、`predicate`、`object`、`truth_status`、
  `visibility`、`evidence_span_ids`、`asserted_by_ids`、`known_by_ids`、`validity`、
  `confidence`、`reason`。`predicate` 从下面的 `relation_kind` 词表里选。`object`
  必须指向一个节点(`{"node_id": ...}`)。
- 关系键恰好为:`relation_id`、`relation_kind`、`from_node_id`、`to_node_id`、
  `claim_id`、`properties`。**先写 claims,再写 relations**:每条 relation 的
  `claim_id` 绑定一条你实际写出的 claim,`relation_kind`、`from_node_id`、
  `to_node_id` 与该 claim 的 `predicate`、`subject_id`、`object` 完全一致。
- `visibility` 只能取:`keeper-only`、`player-safe`、`revealable`。骨架一律
  `keeper-only`。
- `truth_status` 只能取:`authored-fact`、`authored-belief`、`authored-rumor`、
  `authored-lie`、`inferred-candidate`。推断出来的入口标 `inferred-candidate`。
- `coverage`:只为你真的审过的域(packet 的 `aspects`)给状态(`accepted`、
  `partial`、`unresolved`、`absent`);没审的域**不要写**——机器会把 `structure`、
  `world`、`actors`、`relationships`、`events`、`knowledge`、`causal`、`mechanics`、
  `assets`、`direction` 里缺的一律补成 `unresolved`。骨架通常只有 `structure`
  能到 `accepted`。
- 本任务可用的 `node_kind`:`module`、`section`、`scene`、`location`、`route`、`npc`、
  `creature`、`faction`、`organization`、`concept`。
- 本任务可用的 `relation_kind`:`contains`、`part-of`、`located-in`、`print-precedes`、
  `play-precedes`、`independent-from`、`may-lead-to`、`present-in`、`member-of`。
- 排序法:`print-precedes` 只记出版/目录顺序;`play-precedes` 只记书明说或要求的
  游玩顺序;目录顺序不是因果。

## 会怎么判你

三道机器闸门,与深读相同:结构闸(契约与引用存在)、源头闸(名字和数字在你引的
页上)、读完闸(你引的 span 占比)。findings 会原样回给你,据此改,再来一轮。
