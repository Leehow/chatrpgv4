# pi-coc v2

Gameplay Mods are independent versioned packages under `mods/`. The right-sidebar
Mods tab lists installed packages, campaign activation, new-campaign defaults and
explicit upgrades. Natural NPC, Enhanced Items, Guided Creation, Story Thread, Keeper
Pacing, Narration Craft and Narration Audit are included (the last four: contract §30). Local directories
and ZIP packages use the same loader; save locks preserve the package bytes and
accepted game results across application updates. See kernel contract section 26
and `docs/specs/mods-execution.md` for the interface and verification record.

COC Keeper for Pi：一个 Pi 包加一个编译后的 TypeScript 内核子进程。守秘人只见七个动词：`look`、`lookup`、`recall`、`resolve`、`apply`、`ask`、`narrate`。

- 架构规格：GitHub issue #12。切片票：#13 到 #18。
- 扩展与内核之间的契约：`docs/kernel-rpc.md`。改契约先于改代码。系统语言英文、玩家语言由守秘人模型按 `play_language` 产出、机制走 JSON 投影：见 `Agents.md`。
- PDF 准备：[直接阅读与按需构图](docs/specs/visual-pdf-reader.md)，接口见契约 §22；使用原页和统一读者，旧 OCR/资料包管线已退役，最后验证状态见规格；PipiCOC 源码接入另见下文。
- 对 Pi 的依赖与升版流程：`docs/pi-host-contract.md`，不 fork、不打补丁。
- 决策记录：`docs/adr/`。真桌验收方法：`docs/acceptance.md`。

## 布局

```
extensions/   Pi 扩展：kernel（七个工具、回合事务、行动准入、校验车道）、table（状态行）、memory（记忆抽取车道）、
              module（无人值守构建与按需深读，读者是子 pi 进程）、onboarding（建卡进程的 setup 工具）、lanes（共用）、
              deepseek（DeepSeek Extended provider，`openai-responses` + hosted web_search，从 PipiUI 上游移植）
kernel-ts/    TypeScript 内核，编译为 build/kernel/rpc.mjs，默认由统一运行时启动
runtime/      宿主组合：统一捕获部署配置、启动/取消内核与读者、执行只读检查
content/      只读内容：rulesets/coc7、starters/<module>、director/、craft/、ontology/、modules/（契约与可玩性模板）、setup/（七步表、读者提示）
prompts/      守秘人与建卡助手的系统提示
scripts/      构建与打包工具
bin/          pi-coc（游玩 / setup）、pi-coc-setup（驾驭器用）、coc-source 与 coc-read-check（原页访问与视觉草稿检查）
tests/        kernel（默认检查 TS RPC）、extension（扩展接缝）、play（驾驭器、KPI）、固定版本的历史对照入口
```

## 运行

```bash
npm install
uv sync --frozen --dev
npm run build:runtime                 # 生成内核、宿主、读者、准备进程与 Pi 扩展的 JS 入口
bin/pi-coc setup                      # 建卡：选 starter 或资料包，建调查员，交桌
bin/pi-coc --campaign <id>            # 开桌
```

要用 `deepseek-extended` provider：先做一次鉴权（`/login deepseek-extended` 写进 `.pi/coc-agent` 的 auth.json），
或在设置里填 `ext.deepseek.apiKey`。它与 `.pi/coc-agent/models.json` 里保留的 `deepseek` provider 是两家，互不动。

右下角的余额胶囊走 App 自己的账户用量能力（`account-usage-core` 的 DeepSeek 预付费适配器）：
会话模型属于 `deepseek` 或 `deepseek-extended` 时拉 `https://api.deepseek.com/user/balance`，显示 `¥xx.xx`。
它和模型调用用同一份凭据；凭据失效（HTTP 401）时胶囊不显示，不会报错。

## 测试

```bash
uv run --frozen python -m pytest tests/kernel tests/play -q
npm run test:ext
npm run check:kernel                  # TS 内核严格类型检查
npm run test:electron        # 复制进来的 PipiUI 套件，比对已记录的失败基线
```

`Electron/` 是整包复制进来的（§23），它自带的上游套件在本检出里本来就是红的：packs、workflow
文件与内置运行时是故意不带的，产品身份换成了 PipiCOC，PipiCOC 的接线又改掉了几处上游用例仍按
旧样子断言的接缝。这些不逐条修，但也不能就这么红着——一片红里看不出真回归。所以失败按用例记在
`Electron/scripts/vitest-suite-baseline.json`，`npm run test:electron` 只在出现差异时失败：
基线之外的新失败是回归；基线里已经不再失败的条目说明基线过期，同样失败，用
`node Electron/scripts/suite-baseline.mjs --record` 重记。这张表是用来缩短的，不许手写一条进去把红的糊绿。
这套上游用例本身有时序抖动（jsdom 量到零高度、侧栏行还没画出来、临时目录清理竞争），所以两道闸：
失败的用例先重试两次；比对出差异之后，**只把差异涉及的文件单独串行再跑一遍**，还差的才报出来。
真坏的用例在没人跟它抢资源的时候照样坏，所以这两道都藏不住确定性的失败。仍然翻来翻去的，按名字
写进同一文件的 `flaky`，两个方向都不查——每条都要写明为什么钉不住（目前是空的）。

真桌验收走 `tests/play/driver.py`，grok 当守秘人，Claude 当玩家，一回合一回；方法见 `docs/acceptance.md`。

## PipiCOC 界面

`Electron/` 是本分支持有的 PipiCOC 界面源码，启动的是本仓库的
`bin/pi-coc`，不再依赖 writepaper 检出或内置的另一套 Pi。

```bash
npm ci
npm ci --prefix Electron
pipicoc/dev setup                  # 建卡
pipicoc/dev --campaign <战役名>     # 关闭建卡窗口后，用同一界面开桌
```

模型与鉴权沿用 `.pi/coc-agent`，战役与模组默认沿用本仓库 `.coc`。
`PI_COC_HOME` 可显式选择存档根目录。不要在两个窗口同时打开同一战役。
源码运行与独立 App 组包共用编译入口；前端验收与 PDF 阅读验收分别记录。

本地打包：`node pipicoc/package.mjs`，直接装成 `/Applications/PipiCOC.app`（盘上唯一一份，`PIPICOC_APP_BUNDLE` 可改），以 `PipiUI Dev` 签名；收据与回指链接留在 `~/leehow/code/pipicoc-build/`。
此配方组装独立 TypeScript 运行时：受管 Node、Git、Pi、原生模块和只读内容都随包提供；运行时描述只保存包内相对路径。Pi 配置、凭据、会话和运行目录位于 App 自有 userData，战役仍保存在用户选择的 COC home。源码模式也只运行 TypeScript，`PI_COC_RUNTIME=python` 会明确报错。

Python 旧内核已从当前树移除。兼容测试通过 `tests/python-oracle.json` 固定的 Git 历史版本，在忽略且只读的 `.cache/python-oracle/` 中取得对照；这里不是开发目录。测试检出必须包含该历史提交，浅克隆需补齐历史。新增规则和修复只写 `kernel-ts/`。Python 测试控制器和原生扩展构建工具仍使用锁定的 uv 环境，不随 App 分发。

安装包与完整行为验收状态见 `docs/specs/runtime-consolidation-tickets.md`；本地开发签名不代表已完成公开分发的签名与公证。
Web 端：先运行 `pipicoc/install` 安装 `.pi/` 中的面板资产，再运行 `PI_COC_MODE=setup npm --prefix Electron run dev:browser`，打开 `http://localhost:5173`。
Web 端的“添加项目”使用页面内路径输入；人物面板与骰子组件通过宿主受限接口读取，支持 Codex 内置浏览器。
