#!/usr/bin/env python3
"""Browser-only smoke checks using local HTML via set_content, no page network calls.
Requires Playwright and Chromium. CHROMIUM_EXECUTABLE can select a local browser.
This does not test a real Jev response, a Pi integration, or cross-file navigation.
"""
import json
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
checks=[]
errors=[]
with sync_playwright() as p:
    executable=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
    browser=p.chromium.launch(headless=True,executable_path=executable)
    page=browser.new_page(viewport={'width':1440,'height':1080},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((root/'card_browser.html').read_text(),wait_until='load')
    assert page.locator('details.card').count()==144
    checks.append('卡库首次渲染144张')
    page.locator('[data-family="LYR"]').click()
    assert page.locator('details.card').count()==12
    checks.append('美感家族筛选返回12张')
    page.locator('#expand').click()
    assert page.locator('details[open]').count()==12
    checks.append('展开当前全部卡片')
    if os.environ.get('SAVE_SCREENSHOTS'): page.screenshot(path=str(root/'tests/cards_desktop.png'),full_page=False)
    page.locator('#reset').click()
    page.locator('#q').fill('PEC-HOR-001')
    # Related-card references can also match, so title/full JSON search is broader than exact-ID filtering.
    assert page.locator('#PEC-HOR-001').count()==1
    checks.append('编号搜索可定位目标卡')
    page.locator('#reset').click()
    page.locator('#channel').select_option('diagnostic_meta')
    assert page.locator('details.card').count()==5
    checks.append('工程诊断家族用途筛选返回5张')
    page.locator('#q').fill('不存在的检索词xyz987')
    assert page.locator('details.card').count()==0
    assert page.locator('.empty').is_visible()
    checks.append('无匹配显示空结果而非默认硬选')
    page.evaluate("location.hash='PEC-HOR-001';openHash()")
    assert page.locator('#PEC-HOR-001').get_attribute('open') is not None
    checks.append('卡号锚点打开并定位卡片')
    page.set_viewport_size({'width':390,'height':844})
    page.locator('#reset').click()
    page.locator('[data-family="HOR"]').click()
    page.locator('.card').first.locator('summary').click()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    if os.environ.get('SAVE_SCREENSHOTS'): page.screenshot(path=str(root/'tests/cards_mobile.png'),full_page=False)
    checks.append('390px移动端无横向溢出')
    page.set_viewport_size({'width':1440,'height':1080})
    page.set_content((root/'design.html').read_text(),wait_until='load')
    assert page.locator('main h1').count()==3
    assert page.locator('nav a').count()>20
    assert page.locator('.document .table-scroll').count()>0
    if os.environ.get('SAVE_SCREENSHOTS'): page.screenshot(path=str(root/'tests/design_desktop.png'),full_page=False)
    checks.append('设计正文、附加演示、任务书与目录渲染正常')
    # Every in-page TOC link targets an actual heading.
    assert page.evaluate("[...document.querySelectorAll('nav a')].every(a=>document.getElementById(a.hash.slice(1)))")
    checks.append('设计页目录锚点全部可定位')
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    checks.append('设计页移动端无横向溢出')
    assert not errors,errors
    checks.append('两页无JavaScript运行错误')
    browser.close()
result={'test_type':'offline_browser_smoke','browser':'Chromium / Playwright set_content (URL navigation restricted by environment)','checks_passed':checks,'errors':errors,'external_model_calls':0}
(root/'tests/browser_check_result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
