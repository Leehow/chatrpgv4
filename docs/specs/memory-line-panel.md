# 记忆线面板：世界线图谱与点击分支（设计）

2026-09-09 设计稿。状态：已批准（含「Y 轴 = 游戏内时钟」修订）。契约 §29 已落笔（`docs/kernel-rpc.md`），桌级分支的决定见 `docs/adr/0004-host-level-branch.md`。

## 一、用户想达成什么

右侧栏加一个「记忆线」tab：把当前战役的整条 git 记忆线（主线 + 所有世界线分支）画成一张沉浸感的图；玩家点击某个历史节点，先弹确认，确认后从那个节点创建一条新世界线并进入（桌子切换到新线，继续玩）。旧线原样保留——证据永不删除。

空心交付警戒：图画出来了但节点数据是假的不算；分支按钮动了但 keeper 不知道换线了不算；只在无会话冷态下能点不算。

## 二、现状（侦察结论，带锚点）

**内核侧（已实现，票 #23 / 契约 §15）：**

- 世界线是战役 sidecar 裸仓库里的真 git 分支 `wl/<name>`（`.coc/repos/<id>.git`，工作树 `.coc/campaigns/<id>/`，`kernel-ts/git.ts:28-42`）。
- 注册表在 `campaign.json`：`active_worldline` + `worldlines: {name, kind: main|if|loop|merge, loop, forked_from: {line,turn,commit}, parents, seed, status, last_turn, last_commit, created_at}`。
- 现有读面：`table.recall {what:"history"}` 只给**当前线**的时间线（缺省近 20 回合，无父哈希）；`{lines: true}` 只给注册表元数据，不开 git 对象（ADR-0001：recall 不读 git）。**没有任何方法一次返回全图。**
- 现有写面：fork/switch/merge 是守秘人 `apply` 效果，回合提交后执行，一回合一条。`fork mode:if from_turn` 能从**当前线**的已提交回合分叉，但不能从别的线的节点、不能从任意 sha、不能脱离回合。**没有宿主级「从历史节点开分支」的方法。**
- §15.9 已有完整迁移机器：seal 脏树 → `createBranch` → `checkout` → 注册表覆盖写回 → 按新线种子重播 rng → 重建检查点（`kernel-ts/worldline/index.ts` forkPlan/transition，`worldline/history.ts` createBranch/checkout）。
- 失败即回滚、回合不回滚；事件 `worldline-forked` 落在落地线上。

**前端侧（Electron/，PipiCOC 界面）：**

- React 18.3，右侧栏 = `ToolPanel`，tab 在 `pipiui-extension.json` 的 `app.ui.panels[]` 注册（slot `toolPanel`，现有 `coc.mods`、`coc.investigator`）。
- 面板文件是**无 import 的纯 ESM**：`createComponent(React)`，`React.createElement`，注入 `<style>`，CSS 变量主题（clay / clay-night）——`pipicoc/panel.js:1-18` 写明了不要 bundler。**任何 npm 图库都装不进来。**
- 数据通道：面板 `api.invoke("coc-keeper", method)` → 宿主 `invokeExtension` → 活会话走 ext-invoke（`pipicoc/sheet.ts` 的 `table.view` 模式），无活会话走宿主受限冷内核（`pi-backend` 的 `callColdKernel`，mods.* 模式，`coc-view.ts:173`）。
- 推送：agent → 面板 `emitToPanel("sheet-changed")` / 面板 `api.subscribeExt`。
- 确认弹窗无共享组件：`ExtensionsPane.tsx:283-334` 的 `ConfirmDialog` 是私有的，照它的模式在面板内自绘。
- 文案是数据：`content/ui/<tag>/<surface>.json`，guard 测试钉住每个语言的 key 集合；错误走 `{code, message}` + `errors.json`。
- 世界线收据已有投影：mechanics `{"kind":"worldline",...}`，mechanics.css 已有 `data-kind="worldline"` 样式。

**现成控件调研（web 侦察）：**

- `@gitgraph/react` 已死（仓库 2024-07 归档，最后发版 2021，类型钉 React 16）——不用。
- Mermaid gitGraph 是文档图 DSL，不可交互；vis-network 是网络图不是 git 泳道；`@xyflow/react` 是给节点编辑器的（58KB gz，pan/zoom 对 300px 侧栏是反模式）——都不合适。
- `react-git-log` / `git-graph-svg` 是唯一「本来就会画 git 图」的活库，但要 bundler，装不进无 import 面板。
- 业界好看的样子（GitLens / GitKraken）= 固定泳道列 + 虚拟化行 + SVG gutter。**结论：自绘 SVG 泳道 + 一个 ~100 行的泳道分配器**，零新依赖，正好是面板约束下唯一干净的路，也是调研的首选推荐。

## 三、设计决定

### D1（契约）：新增宿主向方法，不进守秘人七动词

写进 `docs/kernel-rpc.md` 新一节（编号实现时定，预计 §29）。两个方法，宿主向（如同 `table.view`，守秘人工具表永远见不到）：

**`table.graph {campaign, max_nodes?}`** — 只读，冷进程可调（不开桌、不掷骰、不写），活进程也可调：

```
{ campaign, active: "<线名>",
  lines: [{name, kind, loop, status, last_turn, last_commit,
           forked_from: {line, turn, commit} | null,
           parents: [{line, turn, commit}]}],            // merge 线才有
  nodes: [{sha, turn: int|null,                          // 按提交信息 `turn <n>:` 前缀认
           clock: int, when: {y, mo, d, hh, mm},          // 游戏内时钟（分钟）+ 内核日历投影，面板不做时钟算术
           kind: "setup"|"turn"|"worldline"|"merge",     // 闭合集：>1 父=merge；turn 前缀=turn；首回合前=setup；其余（seal/落地/loop reset）=worldline
           title, at, parents: [sha], tip_of: [线名]}],
  truncated: bool }                                      // max_nodes 缺省 500、上限 1000
```

ADR-0001 的「recall 不读 git」约束管的是守秘人读面；这个宿主方法读 git（parents 只能从 git 来）是它存在的意义，契约里明说这条例外只给宿主方法。节点分类按提交信息前缀与父数，是机械规则不是语义判断。seal/落地这类非回合提交照样发（它们是分叉点的证据），前端默认渲染成弱化的刻度点。`clock` 取该提交关闭时的游戏内时钟：回合节点读该线 `turns/NNNN.json` 的世界快照，其余节点取落地回合的时钟；git 读取必须批量（`cat-file --batch` 级），每节点一次 `git show` 不合格。

**`table.branch {campaign, commit, name?, label?}`** — 写，桌级动作：

- 校验：`commit` 存在且可从某条 `wl/*` 到达；桌子空闲（无进行中的回合，进行中报 `operation_in_progress`）；`name` 合语法且不撞（缺省内核铸 `if-<forkturn>-<序>`）；另一活进程持锁时报 `operation_in_progress`。
- 执行复用 §15.9 迁移机器：必要时 seal 当前线 → 在 `commit` 上建 `wl/<name>` → 注册表加 `{kind:"if", forked_from:{line,turn,commit}, seed, status:active}`，原活动线转 `dormant` → 检出 → 注册表覆盖写回 → 按新线种子重播 rng → 从分叉点的回合记录重建检查点。失败即回滚，遥测一行。
- 事件 `worldline-forked` 落在**新线**上（turn 取新线下一回合），与 §15.9 一致。
- 幂等：同 `(campaign, commit, name)` 重放返回同一结果，不重复建线。
- 结果：`{ok, line: {name, kind, loop:0, forked_from}, active, branched_from: {line, turn, commit}}`。

**与法则二的关系（写进契约，配一条短 ADR）：**「世界改变只经 `apply`」管的是守秘人模型；`table.branch` 是人类玩家在桌外的操作，与建战役、开桌同级。它不改「发生过的任何事」——旧线的每个提交原样保留，新线从历史节点继续。

**换线通知（守秘人必须知道）：** 分支成功后，下一次 `player_input` 的胶囊带一次性 `branched: {from_line, from_turn, name}` 节（内核置旗、读后清），`worldlines` 节照常反映新线；宿主同时在会话里追加一条 `coc-mechanics` 展示条目（`{"kind":"worldline","operation":"fork",...}`，复用现有渲染与样式），玩家也在聊天流里看到分水岭。

### D2：会话上下文不回滚（推荐，已定进设计）

分支只动世界与桌态，不回滚守秘人会话的聊天上下文；聊天流里旧线的叙述留在分水岭条目之上。理由：(a) 证据永不删除是永久法；(b) 本产品世界线语义本来就承认跨线记忆（§15.5「调查员记得上一圈，这是设计」）；(c) 守秘人的上下文是可丢弃缓存，真相在胶囊；(d) 连 Pi 会话一起回滚需要 PipiUI 会话树级改动，是另一个量级。若真桌证明「守秘人记得被放弃的未来」破坏体验，再单开切片做会话分叉。

### D3（前端）：自绘 SVG 泳道，零新依赖

- 注册：`pipiui-extension.json` `app.ui.panels[]` 加 `{slot:"toolPanel", id:"coc.timeline", entry:"pipicoc/timeline.js", icon:...}`；默认 tab 仍是 `coc.investigator` 不动。
- `pipicoc/timeline.js`：无 import 纯 ESM `createComponent(React)`，注入 `<style>`，全部文案走 `ui.words.timeline`（新增 `content/ui/<tag>/timeline.json`，zh-Hans「记忆线」/ en "Timeline"，guard 测试钉 key 集合）。
- 渲染：**Y 轴是游戏内时间轴**（用户 2026-09-09 批准时定死）。每条世界线一条纵向泳道（main 最亮，if 冷色、loop 带圈标、merged 淡入合并点；色板走 CSS 变量+闭合调色板）；泳道分配器 ~100 行（main 占 0 道，其余线在分叉点申领最近空闲道，到 tip 释放）。节点的纵向位置由 `clock` 决定——**同一游戏时刻的节点跨线对齐到同一高度**；行间距离按游戏时间差给，大跳段（睡觉、旅程这类几小时的空白）压缩成带断点标记（//）的窄带，不让长空白吃掉整屏。左缘一条时间标尺，按节点的 `when` 投影标「{y}年{mo}月{d}日 {hh}:{mm}」（文案走 ui words 的 `at` 模式，面板不做日历算术）。回合提交=实心圆、setup=环、merge=合并结、worldline 提交=弱化刻度；fork 边是二次贝塞尔从父节点弯进新道。图高按内容撑开，节点 500 封顶（契约 `max_nodes`），超出显示截断提示。
- 沉浸感（GitLens 规格）：hover 节点 `drop-shadow` 发光 + 提示卡（第 N 回合、提交标题、时间）；当前线 tip 一个「你在这里」标记；点击节点弹面板内确认卡（仿 `ConfirmDialog` 模式自绘）：「从第 N 回合创建新记忆线？当前进度保留在 <线名>。」+ 可选命名输入 + 确认/取消。
- 数据：`api.invoke("coc-keeper","timeline.graph")` → 活会话 ext-invoke / 冷态 `callColdKernel` 两路，与 sheet 同型；分支走 `api.invoke("coc-keeper","timeline.branch")`。刷新：挂载 + `emitToPanel("timeline-changed")`（回合提交后与分支成功后推）+ 手动刷新钮。
- 面板只认 `coc-session` 绑定的战役；未绑定显示空态，不猜。

### D4：测试与验收

- 内核 seam（pytest，`tests/kernel`）：`table.graph` 形状/分类/截断/多线；`table.branch` 开心路径、幂等重放、回合进行中拒绝、未知 commit 拒绝、锁占用拒绝、注册表/种子/检查点正确、旧线一个提交不少。
- 扩展（`npm run test:ext`）：invoke 接线、ui words、换线条目投影。
- `npm run check:kernel`；`npm run test:electron` 对基线（只许不动基线）。
- 系统语言 guard：面板代码全英文，中文只进 `content/ui/zh-Hans/`。
- 界面验收：web dev 模式（`dev:browser`）+ 内置浏览器，明暗两主题各过一遍点击→确认→分支→图刷新→分水岭条目→下一回合落在新线。
- 真桌验收按 `docs/acceptance.md` 另跑（本切片 UI 为主，真桌可并入下次战役）。

## 四、切片（ tracer bullets ）

1. `contract` — 契约新节 + 短 ADR 落笔。
2. `kernel-graph` — `table.graph` 实现 + seam 测试。（依赖 1）
3. `kernel-branch` — `table.branch` 实现（复用 §15.9 迁移机器）+ 胶囊 `branched` 节 + seam 测试。（依赖 1）
4. `pack-bridge` — pipicoc 两路 invoke、ui words surface、coc-mechanics 分水岭条目。（依赖 3）
5. `ui-panel` — `timeline.js` 面板 + 注册 + 确认卡 + SVG 泳道（可先对契约造的假数据开发）。（依赖 1；接真数据依赖 4）
6. `acceptance` — 浏览器界面验收 + 全部测试套件。（依赖 2、4、5）

## 五、范围外

- 点击切到已有线（宿主级 switch）、线的删除/改名、merge 的 UI。
- 守秘人工具表加图读面（守秘人仍只有七动词 + `recall history {lines:true}`）。
- 会话上下文回滚（见 D2）。
- 图的分页/增量加载（`truncated` 提示先顶着）。
