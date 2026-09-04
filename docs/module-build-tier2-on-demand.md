# Tier 2:按需深化(On-Demand Deepening)设计方案

> 状态:方案,未实施。实施需要显式授权(共享 runtime 邻域,轨道法)。
> 上游:Spec「骨架优先的模组构建 v1」的 Tier 2 部分。Tier 0/1 已落地。

## 问题

Tier 0+1 让开场可玩:骨架 shard + 开场节深读。但一本 669 页的书,玩家离开
开场节后走到哪里,哪里就需要已经被深读过的图。提前全量读是小时级的前置
成本(正是被否掉的方案);不读则 KP 在新章节没有图谱可依。需要一条「玩
到哪里,图长到哪里」的通道。

## 已有的、不重复建的机制

盘点(全部为现存机制,本方案只做接线):

- `progressive.on_enter_scene`:runtime 在进场景时的既有挂钩点。
- `progressive.claim_host_work` / `progressive.fulfill_host_work`:
  host-work 的认领/交还契约,队列工作者(`coc_module_queue_worker`)
  已在跑的后台形状。
- `coc_module_section_packs.build_extraction_request` /
  `validate_section_pack`:按节抽取的请求与校验契约。
- `coc_module_graph` 的 merge/projection:shard 合入图、投出
  `skeleton.json`(带 `parse_state`)——已读/未读在投影里是一等状态。
- 新抽取循环(`coc_module_build` 的 plan/skeleton/extract + 三闸):
  按节产出 GraphShard 的读者,窄化、回执、洞处理均已落地。

## 设计

### 数据流

```
骨架 shard(开局已有)
   │  节节点带 pdf_index 范围与 parse 状态
   ▼
玩家移动 / on_enter_scene
   │  目标场景所属节 = 骨架里的 section 节点
   ▼
该节已深读? ──是──→ 正常游玩
   │否
   ▼
enqueue host-work(host 执行深读:pi-coc-build --only-section <sid>)
   │  完成 → merge shard → 投影 parse_state=body_parsed
   ▼
图在本节就绪,游玩继续
```

### 预暖(read-ahead)

进场景时不止看当前节:骨架脊线(play-precedes)的**下一节**同时入队。
队列按「当前节 > 脊线下一节 > 其余未读节」排序。玩家在节内的平均停留
远大于一节的深读时间(分钟级),所以多数移动命中已读。

### 失败与诚实标注

- 深读 `not_accepted`:该节在投影中保持未读并携带最近 findings;KP 得到
  的是「这节没读完」的明确状态,不是半检查的图。是否继续游玩是 KP 的
  语义判断,通道不替它决定。
- 传输失败(坏窗口超过重试覆盖):job 留在队列里可重试,不回退成静默
  跳过。

### 与 setup 的衔接(另立任务,不在本方案实施)

`pi-coc-setup` 选完模组后:plan → skeleton → `--opening-only` 深读 →
`ready_for_table`。开场节就绪即交接,不必等全书。

## 形态决策(已定:A 的方向、C 的第一步)

侦察(`progressive-recon`,.pi/findings)确认:`on_enter_scene` 已在节内容缺失时
enqueue `extract_section`,claim/fulfill/写回/parse_state 翻转是闭环——**「玩家
走近就深读」的触发器不需要新建**。真正的问题是 GraphShard 与 section-pack 两态
并存。决定:图为正典(A),过渡走桥接(C)——`coc_module_shard_pack.py` 把
accepted shard 确定性编译成 pack(标题/受众/绑定由 request 锁定,正文渲染自已过
闸节点,溢出显式标注),经 lane 自己的 `validate_section_pack` 验收后落库。
pack 从此是图的投影,不是第二次读书。

## 明确不做(本方案)

- 不改 `progressive.*` 任何既有操作的语义;挂钩只读骨架/投影状态并按
  既有契约 enqueue。
- 不在本方案实现 on_enter_scene 的接线代码;实施前需轨道法下的显式
  授权(共享 runtime 邻域)。
- 不做跨节关系补全:深读节内关系完整,跨节边由 merge 时的既有规则
  处理;不发明新合并语义。

## 待定问题(实施前需回答)

1. 骨架的 section 节点与 plan 的 pdf_index 范围,以哪个为 enqueue 的权威
   粒度?(倾向:plan 范围,骨架节点挂到节 id 上。)
2. 预暖并发上限与坏窗口期的退避(重试已覆盖 ~12 分钟;更长怎么办)。
3. `skeleton.json` 的 `parse_state` 词表是否需要第三个值(如
   `parse_failed`),还是复用现有两态 + findings 附件。
