# pi-coc v2

COC Keeper for Pi：一个 Pi 包加一个 Python 内核子进程。守秘人只见七个动词：`look`、`lookup`、`recall`、`resolve`、`apply`、`ask`、`narrate`。

- 架构规格：GitHub issue #12。切片票：#13 到 #18。
- 扩展与内核之间的契约：`docs/kernel-rpc.md`。改契约先于改代码。系统语言英文、玩家语言由守秘人模型按 `play_language` 产出、机制走 JSON 投影：见 `Agents.md`。
- PDF 准备：[直接阅读与按需构图](docs/specs/visual-pdf-reader.md)，接口见契约 §22；使用原页和统一读者，旧 OCR/资料包管线已退役，最后验证状态见规格；PipiCOC 源码接入另见下文。
- 对 Pi 的依赖与升版流程：`docs/pi-host-contract.md`，不 fork、不打补丁。
- 决策记录：`docs/adr/`。真桌验收方法：`docs/acceptance.md`。

## 布局

```
extensions/   Pi 扩展：kernel（七个工具、回合事务、校验车道）、table（状态行）、memory（记忆抽取车道）、
              module（无人值守构建与按需深读，读者是子 pi 进程）、onboarding（建卡进程的 setup 工具）、lanes（共用）
kernel/coc/   Python 内核包，入口 `python -m coc.rpc`；rules/（十族规则引擎与 RuleGraph 运行时）、modules/（模组存储与车道）
content/      只读内容：rulesets/coc7、starters/<module>、director/、craft/、ontology/、modules/（契约与可玩性模板）、setup/（七步表、读者提示）
prompts/      守秘人与建卡助手的系统提示
scripts/      starter 投影器（IR → 模组图）
bin/          pi-coc（游玩 / setup）、pi-coc-setup（驾驭器用）、coc-source 与 coc-read-check（原页访问与视觉草稿检查）
tests/        kernel（内核接缝）、extension（扩展接缝）、play（驾驭器、KPI、资料包工具）
```

## 运行

```bash
npm install
uv sync --frozen --dev
bin/pi-coc setup                      # 建卡：选 starter 或资料包，建调查员，交桌
bin/pi-coc --campaign <id>            # 开桌
```

## 测试

```bash
uv run --frozen python -m pytest tests/kernel tests/play -q
npm run test:ext
```

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
当前支持源码运行和依赖本仓库运行时的本地 App；前端验收与 PDF 阅读验收分别记录。

本地打包：`node pipicoc/package.mjs`，生成 `build/PipiCOC.app`，以 `PipiUI Dev` 签名。
这个本地包通过运行时描述文件指向当前仓库及 Node/uv；移动或删除仓库会使它无法启动。
Web 端：`PI_COC_MODE=setup npm --prefix Electron run dev:browser`，打开 `http://localhost:5173`。
Web 端的“添加项目”使用页面内路径输入；人物面板与骰子组件通过宿主受限接口读取，支持 Codex 内置浏览器。
