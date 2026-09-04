# 把这本书缝成一整张图

各节已经分头读完、合并成一张图了。但**分头读的人看不见彼此的页** —— 第 3 章的
场景通向第 7 章的场景,这条边没有任何一个人有资格写:写的人没见过对面。

你的活就是补这些边。**不要重读这本书** —— 你有全书的证据,用查询工具去查。

## 眼前这张图哪里不成立

`{work_dir}/graph-findings.json` 是机器对合并后整张图的判定,逐条列着:

- `scene_graph_fragmented` —— 场景图碎成几块,每条列出一块里有谁。
  **这是你的主要任务。**
- `actor_in_no_scene` —— 这个 NPC/生物没有出现在任何场景里。
- `clue_supports_nothing` / `conclusion_without_support` / `clue_nowhere_to_find`
- `no_entrance_declared` / `no_ending_declared`

`{work_dir}/graph-view.json` 是这张图的紧凑视图:每个节点的 id、类型、名字、
summary、它引用的页,以及现有的关系。**先读这两个。**

## 怎么补

对每一条 finding,先查证据再动手:

```
{query} search 血舌邪教                # 全书哪些地方提到它
{query} search '(?i)proceed to' --regex --context 1
{query} read --pages 88-92
{query} verify --shard {work_dir}/patch.json
```

典型做法:一块孤立场景,拿它的名字和 summary 去 `search`,看书里哪一段把它和别的
场景连起来(「若调查员决定前往……」「本章结束后转到……」),然后照那段文字写边。

## 交付

`{work_dir}/patch.json` —— 一个**只含新增内容**的 GraphShard。格式和分节抽取完全
一样(契约见 `{instruction_path}`),但:

- `nodes` 通常为空。你补的是关系,不是新东西。**确实需要**引用已有节点时,把它们
  的 id 放进 `node_refs`,不要重新定义。
- `claims` 是主体。每条都要有 `evidence_span_ids`,指向**书里真的这么说**的那几行。
- 不写 `relations`,机器从 claims 推。

## 唯一的红线

**没有证据就不要连。** 你面对的是一张有洞的图,补洞的诱惑很大 —— 但「这两个场景
按剧情应该相连」不是证据,书里写着「离开神殿后前往城门」才是。

连不上就不连。在 `coverage` 里把 `causal` 标成 `partial`,并在 `patch.json` 旁边
写一份 `{work_dir}/UNJOINED.md`,列出你查过但书里确实没说怎么连的那些块。**那份
清单比编出来的边有价值得多** —— 它告诉人这本书本身在这里是断的。

## 自查

```
cd {repo_root} && {review_command}
```

通过后再跑一次整图判定,看碎块少了没有:

```
cd {repo_root} && {template_command}
```

写 `{work_dir}/DONE.json`:`{{"claims": N, "joined": 补上几条跨块的边, "unjoined": 几块连不上}}`。
