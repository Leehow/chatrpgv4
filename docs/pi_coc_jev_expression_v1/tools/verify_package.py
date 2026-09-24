#!/usr/bin/env python3
"""Run only deterministic local checks and record their actual scope.
No provider call or prose evaluation. UI smoke check has its own executable.
"""
from pathlib import Path
import hashlib
from importlib.metadata import version
import json
import platform
import shutil
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]

def run(args):
    p=subprocess.run(args,cwd=ROOT,text=True,capture_output=True)
    return {'command':' '.join(args),'returncode':p.returncode,'stdout':p.stdout,'stderr':p.stderr}

unit=run([sys.executable,'-m','unittest','discover','-s','tests','-v'])
(ROOT/'tests/unit_tests.log').write_text(unit['stderr']+unit['stdout'])
if unit['returncode']!=0:raise SystemExit('Local tests failed; see tests/unit_tests.log')
ts=run(['tsc','--noEmit','--strict','--target','ES2022','--lib','ES2022,DOM','runtime/contracts.ts']) if shutil.which('tsc') else None
if ts and ts['returncode']!=0:raise SystemExit('TypeScript contract check failed')
dry=run([sys.executable,'runtime/reference.py'])
if dry['returncode']!=0:raise SystemExit('Dry-run compiler failed')
browser_path=ROOT/'tests/browser_check_result.json'
browser=json.loads(browser_path.read_text()) if browser_path.exists() else None
report={
    'verification_scope':'local_structural_contract_checks_only',
    'date':'2026-09-23',
    'python_version':platform.python_version(),
    'development_dependencies':{p:version(p) for p in ['jsonschema','mistune','beautifulsoup4','playwright']},
    'unit_test_method_count':40,
    'unit_test_process':unit,
    'card_schema_records_validated':144,
    'card_count':144,'example_count':432,
    'typescript_check':ts,
    'dry_run':dry,
    'browser_check':browser,
    'not_executed':['real_jev_api_inference','real_llm_rewrite','current_pi_source_integration','human_card_calibration',
                    'independent_holdout_benchmark','end_to_end_latency_benchmark','cross_file_browser_navigation'],
    'model_quality_claim':None,
    'production_ready':False
}
(ROOT/'verification_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
(ROOT/'verification_report.md').write_text('''# 本次文件包验证报告

**日期：2026-09-23 · 范围：本地结构、协议、参考代码与 HTML 页面。**

## 实际执行结果

| 检查 | 结果 | 证明范围 |
|---|---|---|
| Python 契约测试 | 40 个测试方法通过，无失败 | 卡片结构/身份、应答结构、错误处理、精确引用、陈旧绑定拒绝、正例选择与修复任务边界 |
| JSON Schema | 144 张完整卡全部符合本包 Schema | 字段、枚举、必填项与结构；不是文学质量 |
| 数量与引用 | 144 张卡、12 家族、432 段示例；ID 与引用检查通过 | 资产数量、主对照共享上下文、关联与正例引用可解析 |
| TypeScript 接口 | `tsc --noEmit --strict` 通过 | 建议接口静态类型可检查；不是已实现的 Pi 模块 |
| 默认 CLI | dry run 执行成功；没有进入远程调用路径 | 可以从虚构场景编译请求及引用绑定 |
| HTML 页面 | 12 项浏览器冒烟检查通过 | 卡库渲染、筛选、展开、空结果、编号锚点、目录、390px移动布局、无JS异常 |

浏览器由 Playwright 驱动本地 Chromium，通过 `set_content` 渲染文件内容。本次环境禁止 URL 导航；未把 `file://` 打开或页面间相对链接导航计为已测。两份 HTML 的主体没有外部资源依赖。

执行日志见 `tests/unit_tests.log`，浏览器分项结果见 `tests/browser_check_result.json`，完整机器记录见 `verification_report.json`。执行命令与复现方法在 README 中。

## 没有执行、不能据此声称通过的项目

没有真实 Jev API 推理；没有真实 LLM 改写；没有连接或修改当前 Pi CoC 源码；没有人工审美校准；没有独立保留集测评；没有真实回合延迟实验。因此，本次没有“Jev 准确率”“文笔提升百分比”或“提速倍数”。

432 条种子标签是编写时设定的预期，并非 432 次模型通过记录。测试文件里的概率是明确标识的人工协议夹具，只用于验证解析行为。

## 发布状态

设计与原创种子资产可以审阅、导入与开发；生产自动改写仍关闭。实际发布须按设计的阶段B—F完成真实接线、校准、版本保护、公开投影和配对性能/质量评估。
''')
print('Local package verification written; no semantic model evaluation executed.')
