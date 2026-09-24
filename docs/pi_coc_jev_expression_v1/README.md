# Pi CoC × Jev：表达计划与正反例诊断包

**版本 1.0.0 · 2026-09-23**

144 张原创结构化卡片；每张有一组同上下文正反例与一个防误判边界例，共 **432 段示例**。配套完整设计、离线卡片浏览器、JSONL、JSON Schema、TypeScript 接口和可运行的 Python 请求编译器。

**这是一套可交给编码 Agent 的设计与种子资产，不是已经接入 Pi 的产品，不是经实测认证的 Jev 中文表达模型。** 本包没有访问当前 GitHub 源码、执行真实 Jev 调用或测量端到端提速。

## 从这里开始

| 入口 | 内容 |
|---|---|
| [完整设计（HTML）](design.html) | 主设计、当前文本诊断演示、编码 Agent 任务书；可离线阅读 |
| [144 张卡片浏览器](card_browser.html) | 搜索、12 家族筛选、问题级别/用途筛选、正反并列与合法边界例 |
| [主设计（Markdown）](docs/01_design.md) | 可放入仓库 docs/ 的完整工程规格 |
| [卡库全文（Markdown）](cards/cards.md) | 144 张卡全部正文，方便审阅或交给其他 Agent |
| [机器可读完整卡](cards/cards.jsonl) | 主键、版本、上下文、正反例、边界、诊断与修复协议 |
| [当前文本修复演示](docs/02_walkthrough.md) | 抓痕/床底声响场景；明确标为编写的期望流程，不是模型实测 |
| [实施任务书](docs/03_agent_handoff.md) | 从真实 Pi 入口映射到前置选择、影子诊断、有限修复 |
| [本次验证报告](verification_report.md) | 已执行的结构/协议/UI检查与明确未执行的效果验证 |

单独打开 HTML 文件即可使用其主体内容，卡片浏览器不需要 API key，也没有外部脚本、字体、追踪或模型请求。文件之间的相对链接应在解压完整包后使用。

## 架构中的职责

**规则/世界/权限拥有者提供事实胶囊 → Jev 选择表达方法 → 宿主展开卡片 → LLM 成文。**

对当前稿件的诊断：Jev 按每张候选卡独立判断 `VIOLATION / CLEAN / NOT_APPLICABLE / INSUFFICIENT_CONTEXT`，从预切分原文中选择证据，并可选择已有正例。宿主提取真实原句、保留版本与上下文绑定。**Jev 不生成现场改写；LLM 根据修复合同改写。**

默认不在每轮正文后再强制评分与重写。不合适时保持当前声线/原稿；信息不足允许弃权。完整性问题与美学偏好分开处理，修辞不能修改事实、秘密、状态与玩家授权。

## 卡片覆盖

FCT 事实与认识边界、AGY 玩家自主性与授权、CLR 中文清晰度与句法、SEN 感官与现场表现、HOR 恐怖与悬念、LYR 美感与意象、DIA 对白、VOI 人物声线、PAC 节奏与交棒、MEM 记忆与连续性、RUL 规则结果的文字实现、OUT 输出与诊断边界。

每类 12 张。OUT-008～012 是工程诊断卡，**不作为玩家旁白示例**。每张卡的反例不是关键词禁令：同一句“你感到害怕”在无授权与玩家已自述情绪时可能有不同判定。

所有卡均标记 `human_review=pending`、`calibration_status=unvalidated`、`auto_repair=false`。本包例子为原创合成种子，不抽取商业模组正文。

## 运行参考工具

需要 Python 3.10 或更新版本。请求编译与 HTTP 传输只使用标准库。

```bash
cd pi_coc_jev_expression_v1
python runtime/reference.py
```

这条命令只编译随包虚构场景，生成 `examples/compiled.request.json` 与 `examples/compiled.binding.json`。**默认不会联网，不会生成真正的模型诊断。**

使用自己的稿件时，输入结构参照 `examples/current_draft.json`：

```bash
python runtime/reference.py \
  --input /path/to/your_draft.json \
  --cards PEC-FCT-001,PEC-AGY-001,PEC-AGY-003 \
  --output-prefix /path/to/private-output/review
```

选择哪些卡应由完整性契约、场景/任务范围与语义候选召回共同决定。此参考工具要求明确传入 ID；**没有实现向量召回、完整 Pi 生命周期、生产发布或自动 LLM 改写**。

### 显式启用远程调用

先确认输入可以发送到 TypeSafe，并在后端提供实际密钥。调用可能产生费用；本包不作服务端数据保留政策保证。

```bash
# 通过你的密钥管理方式设置 TYPESAFE_API_KEY；不要写进文件、HTML 或仓库。
python runtime/reference.py \
  --input /path/to/your_draft.json \
  --cards PEC-FCT-001,PEC-AGY-001,PEC-AGY-003 \
  --output-prefix /path/to/private-output/review \
  --live
```

工具会保存 provider 答卷、未经校准的诊断报告及待审修复任务，但**不会执行修复、修改世界状态或发布正文**。`--no-localization` 可关闭原文片段选择；超长文本须按设计正确分窗。`--include-teaching-examples` 才会加入卡片教学对照，不能再用同源种子集成绩声称独立泛化效果。

原文偏移单位是 **Unicode code point、左闭右开**。JavaScript 原生字符串索引是另一种表示，接入时必须显式转换，不能直接混用。

## 本地验证与重建

```bash
# 离线核心测试；完整 Schema 检查需要 jsonschema。
python -m unittest discover -s tests -v

# 可选：TypeScript 接口检查，需要本地 tsc。
tsc --noEmit --strict --target ES2022 --lib ES2022,DOM runtime/contracts.ts

# 修改源卡之后重新构建资产；只用标准库。
python tools/build.py
python tools/make_schema.py

# 重建 HTML 需要 mistune、beautifulsoup4。
python tools/build_html.py

# 可选浏览器检查：需要 Playwright 和本地 Chromium。
python tools/check_browser.py
```

`requirements-dev.txt` 记录本次环境实际使用的 Python 开发依赖版本。未安装 jsonschema 时 Schema 用例会明确 SKIP，不等于验证通过。浏览器检查用 `set_content` 加载本地 HTML；本次环境禁止 URL 导航，因此没有把跨文件导航或 file:// 打开宣称为已测。

## 目录与单一来源

```text
cards/author_cards.py          原创卡定义；修改此处后重建
cards/cards.jsonl             144 张完整卡
cards/examples.jsonl          432 段带上下文的示例
cards/selection_index.jsonl   前置选择摘要
cards/diagnostic_index.jsonl  诊断摘要
cards/manifest.json           数量、版本、文件摘要及未校准状态
schema/card.schema.json       JSON Schema
runtime/reference.py         Python 请求/应答/证据/修复任务编译器
runtime/contracts.ts         建议接入接口，不是已实现的生产类
prompts/                     旁白与有限修复提示模板
tests/seed_cases.jsonl        432 条开放种子期望标签，非模型通过记录
tests/test_reference.py       确定性本地契约测试
tools/                       资产/视图构建与浏览器检查
docs/                        设计、演示、实施任务书
```

实际集成前，编码 Agent 应先读 `docs/03_agent_handoff.md`，固定目标提交，核查规则与状态权威、公开投影、真实 prompt 接线、取消/恢复与发布路径。不要仅因文件已存在就把功能标为已上线。
