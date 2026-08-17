# COC Keeper Web UI（pi-coc 的可视化）

浏览器 / Electron 是 **pi-coc 交互宿主的 UI**，不是第二条 Keeper 壳。
回合通道是 `pi-coc --mode rpc`：建卡、开局、steward、实况回合都走同一套
pi-coc 宿主。侧栏战役管理和右侧只读投影仍读磁盘。

## 新战役

三种开局：

1. **预置剧本**：`campaign.quick_start`（官方 starter + pregen）。
2. **已解析剧本**：从 `.coc/module-library/<id>/` 安装已编译七文件剧本到新战役
   （`coc_module_registry.install_to_campaign`）。**跨战役复用**，不重解析 PDF。
3. **PDF 源包**：
   - 源包位置：`.coc/source-bundles/<id>/`（须含 `manifest.json`）。
   - 拖拽/上传 PDF → `POST /api/uploads/pdf`：只做 SHA-256 登记与去重，**不解析**。
   - 桌面壳原生入口（应用菜单 / 首跑向导「选择 PDF…」）→
     `POST /api/uploads/pdf/from-path`：同一登记逻辑的本地路径传输
     （Electron 壳给不出浏览器 File 对象），随后走完全相同的 ingest 链。
   - 开局：`campaign.create` → `scenario.bind_pdf` → `campaign.link_investigator`。
   - era 未建立（未过 `setup.adopt_source_facts`）时，内核 era gate 拒建卡/入队；
     两桥此时以**未入队的 setup draft** 开会话并 seed 占位状态（刻意容错，非 bug），
     供会话内完成开局评审与 adopt；era 建立后正常建卡流自动重链。

**新建调查员**（PDF / 已解析剧本模式）：侧栏调查员下拉第一项「＋ 新建调查员…」，
点「开局」后先建战役（不预建卡），然后由 **pi-coc 宿主按 coc-character**
引导创建（与 TUI 同一套：`setup.investigator_contract` →
`investigator.create` + `link_investigator`）。不再注入建卡 kickoff，也不再
挂 `web-char-setup-draft` 占位卡。

## 启动

```bash
# 1. 构建前端（只需在源码变化后重新执行；单一构建同时产出主界面
#    index.html 与桌面配置向导 wizard.html，Electron 壳直接 link 后者）
cd web/frontend && npm install && npm run build && cd ../..

# 2. 启动服务器（默认 workspace 为仓库根，端口 8765；Node 桥）
node web/server-node/server.mjs --workspace . --port 8765

# 3. 打开 http://127.0.0.1:8765
```

前端联调可用 `cd web/frontend && npm run dev`（Vite 把 `/api` 代理到
127.0.0.1:8765）。

旧版 Python 桥仍保留为参考实现：`uv run --frozen python web/server/app.py
--workspace . --port 8765`。两端 API 契约一致，可互换。

## 架构

- `web/server-node/server.mjs` — Node HTTP + SSE 桥（零依赖，Node ≥22）。
  产品回合走 `web/server-node/pi-coc-rpc.mjs`（每战役一个
  `pi-coc --mode rpc` 子进程）。sidecar 只做战役管理与只读投影。
- `web/server-node/pi-coc-rpc.mjs` — Pi RPC JSONL 客户端。玩家输入是
  `prompt`；开桌回合用 `attach` 接上宿主自己的 auto-open。传输层**不**
  再要求 `turn.finalize` 收据。
- `web/server-node/sidecar.mjs` — stdio 换行 JSON-RPC 客户端，长驻一个
  `runtime/sdk/rpc_server.py` 进程，供 bootstrap / 战役管理 /
  `project_campaign_state` / 角色卡投影使用。
- `runtime/sdk/rpc_server.py` — 薄壳 sidecar：战役管理与只读投影。
  `send` 仍在，但 web UI 不再调用它作为回合通道。
- `runtime/sdk/web_views.py` — 只能由 canonical Python 插件完成的投影
  （角色卡、module-library、引擎 transcript 回退、无 session 的
  public state）。
- `web/server/app.py` — 旧版 Python 桥，**不是**产品回合通道。
- `POST /api/sessions/<sid>/turns` — SSE：`status` → `tool`* / `delta`* →
  `turn` / `error` / `notice`；`{ attach: true }` 接开桌流。回合由全局锁串行。
  pi 侧 `stopReason=error` 的结算会映射为 `error` 帧；回合结束但没有任何
  玩家可见文本时发 `notice` 帧（透明提示，不拦截回合）。

## 剧透边界

流式转发的是 pi-coc 宿主自己的助手文本与 thinking（与 TUI 同一条事件流）。
thinking 在界面上标为 KP 侧笔记，可能含模组秘密，不是对玩家发布的叙述。
工具活动只暴露工具名。传输层不再用 `turn.finalize` 当闸门；结算仍由
pi-coc 宿主按 `coc-keeper-play` 自己决定。

## 模型选择

顶栏下拉来自 `$PI_AGENT_DIR/models.json`。未设置时与桌面壳同一目录：
`<userData>/pi-agent`（macOS 为 `~/Library/Application Support/coc-keeper-desktop/pi-agent`），
不读取终端 `~/.pi/agent`。每个回合通过 Pi RPC `set_model` /
`set_thinking_level` 切到当前选择。

## 战役管理（重命名 / 删除 / 回收站）

侧栏每个战役卡片悬停可见「重命名 / 删除」操作：

- **重命名**：`POST /api/campaigns/rename` → sidecar `campaign_rename`，
  原子改写 `campaign.json` 的 `title`（identity 仍以 `campaign_id` 为键）。
- **删除**：`POST /api/campaigns/trash` → sidecar `campaign_trash`，把整个
  `.coc/campaigns/<id>/` 目录移入 `.coc/trash/campaigns/<key>/` 并登记
  `.coc/trash/meta/<key>.json`（`deleted_at` / `purge_at`）。**不是立即销毁**：
  运行证据在回收站保持原样，24 小时内可恢复（遵守 playtest-evidence 法则）。
  回合进行中返回 409；该战役的活跃会话会先被关闭再移动。
- **回收站**：`GET /api/trash` 列出可恢复条目（列出前顺带惰性清除过期项）；
  `POST /api/trash/restore` 按 `trash_key` 恢复（原 id 被新战役占用时报冲突，
  双方数据都保留）。过期清除由 sidecar `campaign_trash_purge` 完成：服务器
  启动时、每 15 分钟、以及每次列回收站时执行。

语义实现集中在 `runtime/sdk/campaign_admin.py`（文件级工作区管理，无任何
规则/状态/叙事语义）；Node 桥只做 HTTP 路由与会话关闭。

## 战役兼容性

运行时遵循清洁重开策略：只接受 `schema_version == 2` 且带 `ruleset_id`
的战役。旧版（v1）战役在左侧列表灰显为「旧版存档」且不可加入，不做任何
迁移；想玩同一剧本请从「＋ 新战役」重新开局。

## 界面语言

叙述层的语言规则来自 canonical `coc_language.language_profile`：每个 keeper
回合的系统提示词都会携带 output_instruction、name_policy（外文人名按
目标语言习惯音译）、term_policy（术语用 localized_terms）三条，由
`runtime/engine/session.py` 随回合请求注入，runner 原样拼入系统提示词。

右侧面板的角色名、属性、技能、武器、物品标签全部来自 canonical 中文渲染层：
优先读角色卡自带的 `player_facing_sheet_zh`（缺省时由
`coc_starter.ensure_pregen_player_facing_sheet` 为官方预生成角色现场构建，
含预生成角色的中文装备列表），再回退到 `coc_language` 的术语表；均与
keeper 自己的角色卡渲染一致。物品优先用 `player_facing_sheet_zh.equipment`；
仅当该层缺失时才回退到 machine sheet 的源语言字符串。

物品面板显示的是**战役进行中的实时背包**：`display_character` 带
`campaign_id` 时合并战役本地 runtime inventory
（`save/investigator-state/<id>.json`，经 `coc_inventory.effective_items` /
`effective_weapons`），剧情中 `state.item_grant` 授予 / `state.item_remove`
移除的物品在回合结算后立即反映，不再等 development 结算写回角色库。
条目以结构化 `inventory_items` 下发（`item_id` / `label` / `kind` /
`quantity` / `consumable` / `note` / `source`），旧版纯标签 `equipment`
列表跟随同一合并结果。消耗品（`consumable: true`）在面板上有「使用」按钮：
`POST /api/sessions/<sid>/items/use` → sidecar `item_use` → canonical
`state.item_use` 工具（幂等 `decision_id`、事务写），数量减一，归零即从
背包消失；回合进行中该端点返回 409。语义全部在插件 toolbox，桥只做传输。

时间 / 场景 / 张力同属展示层：
- 时间：有 `local_datetime` 时渲染为沉静的中文两行（`一九二〇年十月十二日` +
  `上午 · 十时整`），不再直接展示 ISO 数字串；
- 场景：读战役 `story-graph.json` 的 `display_name` /
  `destination_identity.localized_names`，不把机器 `scene_id` 甩给玩家；
- 张力：封闭枚举 `low|medium|high|climax` → `平缓|升高|紧绷|高潮`；
- 线索：按 `discovered_clue_ids` 从 `clue-graph.json` 投影
  `localized_text.<lang>.player_safe_summary`（缺省回退英文
  `player_safe_summary`），侧栏列出内容而不只报条数。

## CLI / Web 双端互通

战役状态与日志（`save/*.json`、`logs/events.jsonl`、
`logs/turn-finalizations.jsonl`）是 canonical 磁盘事实。web/Electron 与
`pi-coc` TUI 是同一宿主的两种表面：两端写同一批战役工件，因此可以
**交替**游玩——TUI 玩的回合，web 打开同一战役（或点顶栏「⟳ 刷新」）
即可看到并继续。

限制：同一时刻只能一端在跑回合（并发写同一战役不安全）；`setup` 阶段
的战役还没有调查员绑定，web 会拒绝并说明；web 不监听文件变化，CLI 的
进度靠手动/聚焦刷新拉取。
