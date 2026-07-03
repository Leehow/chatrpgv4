#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_playtest_audit import generate_rulebook_audit
from coc_playtest_report import generate_battle_report, generate_evaluation_report
from coc_language import language_profile


ZH_HANS_BASE_GLOSSARY = {
    "Ada King": "艾达·金",
    "Ada": "艾达·金",
    "Antiquarian": "古物学者",
    "Regular difficulty": "普通难度",
    "pushed roll": "推骰",
    "pushed rolls": "推骰",
    "pushed": "推骰",
    "push": "推骰",
    "难度为 Regular": "普通难度",
    "难度 Regular": "普通难度",
    "Regular": "普通",
    "Damage": "伤害",
    "HP damage": "HP 伤害",
    "DEX roll": "DEX 检定",
    "combined roll": "联合检定",
    "combat round": "战斗轮",
    "in a combat round": "在战斗轮中",
    "in a 战斗轮": "在战斗轮中",
    "DEX order": "DEX 顺序",
    "Conclusion Rewards": "结局奖励",
    "Rewards": "奖励",
    "Final HP": "最终 HP",
    "Final SAN": "最终 SAN",
    "temporary insanity": "临时疯狂",
    "Bout of Madness": "疯狂发作",
    "opposed rolls": "对抗检定",
    "opposed POW": "POW 对抗",
    "hard success": "困难成功",
    "regular success": "普通成功",
    "regular_success": "普通成功",
    "Fighting Maneuver": "战技",
    "coat-assisted": "借助外套",
    "Obscure clue": "隐晦线索",
    "worm-eaten book": "虫蛀书",
    "damage": "伤害",
    "rule decisions": "规则裁定",
    "checklist": "清单",
}

ZH_HANS_HAUNTING_GLOSSARY = {
    **ZH_HANS_BASE_GLOSSARY,
    "The Haunting Module Playthrough": "《鬼屋》模组实录",
    "Keeper Multi-Profile Pressure Test": "守秘人多玩家画像压力测试",
    "The Haunting Opening Pressure Matrix": "《鬼屋》开场压力矩阵",
    "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf": "《克苏鲁的呼唤守秘人规则书》40周年纪念版 PDF",
    "The Haunting": "《鬼屋》",
    "Mr. Knott": "诺特先生",
    "Arty Wilmot": "阿蒂·威尔莫特",
    "Arty": "阿蒂",
    "Walter Corbitt": "沃尔特·科比特",
    "Corbitt's Hiding Place": "科比特的藏身处",
    "Corbitt Attacks": "科比特袭击",
    "Corbitt House": "科比特宅邸",
    "Corbitt": "科比特",
    "The Old Corbitt Place": "科比特老宅",
    "The Boston Globe": "《波士顿环球报》",
    "Hall of Records": "档案馆",
    "Roxbury Sanitarium": "罗克斯伯里疗养院",
    "Chapel of Contemplation": "沉思教堂",
    "chapel": "教堂",
    "The Floating Knife": "浮空匕首",
    "Bed Attack": "床铺袭击",
    "The Haunting does not include a required chase sequence（The Haunting 不包含必需追逐场景）；chase subsystem coverage deferred to separate scenario": "本模组不包含必需追逐场景；追逐子系统覆盖留到独立场景",
    "The Haunting does not include a required chase sequence": "本模组不包含必需追逐场景",
    "The Haunting 不包含必需追逐场景": "本模组不包含必需追逐场景",
    "chase subsystem coverage deferred to separate scenario": "追逐子系统覆盖留到独立场景",
    "Reverend Michael Thomas": "迈克尔·托马斯牧师",
    "Ruth Blake": "露丝·布莱克",
    "Gabriela": "加布里埃拉",
    "Vittorio": "维托里奥",
    "Macario": "马卡里奥",
    "Handout": "线索资料",
    "pushed basement search": "推骰地下室搜索",
    "own-weapon clue": "以其人之物反制的线索",
    "three-Y eye symbol": "三叉眼符号",
    "three-Y symbol": "三叉眼符号",
    "Mythos material": "神话材料",
    "basement door": "地下室门",
    "basement stairs": "地下室楼梯",
    "basement": "地下室",
    "spare bedroom": "备用卧室",
    "morgue": "剪报档案室",
    "dagger": "匕首",
}

ZH_HANS_CHASE_GLOSSARY = {
    **ZH_HANS_BASE_GLOSSARY,
    "Rooftop Chase Drill": "屋顶追逐演练",
    "internal drill based on Keeper Rulebook Chapter 7: Chases": "基于《守秘人规则书》第 7 章：追逐的内部演练",
    "Nathaniel Crowe": "内森尼尔·克劳",
    "Nathaniel": "内森尼尔·克劳",
    "cult ledger": "邪教账本",
    "ledger": "账本",
    "print shop roof": "印刷店屋顶",
    "print-shop roof": "印刷店屋顶",
    "rain gutter": "雨水槽",
    "slick skylight hazard": "湿滑天窗危险点",
    "slick skylight": "湿滑天窗",
    "locked roof door barrier": "上锁屋顶门障碍",
    "locked roof door": "上锁屋顶门",
    "laundry sheets": "晾衣布单",
    "laundry roof": "晾衣屋顶",
    "roof door": "屋顶门",
    "skylight": "天窗",
    "key ring": "钥匙串",
    "two locations": "两个位置",
    "speed roll checks": "速度检定",
    "speed roll setup": "速度检定设置",
    "speed roll": "速度检定",
    "rooftop chase": "屋顶追逐",
    "establish the chase": "建立追逐",
    "建立 chase": "建立追逐",
    "chase conflict": "追逐冲突",
    "chase state": "追逐状态",
    "chase 开始": "追逐开始",
    "chase 成立": "追逐成立",
    "chase 内部": "追逐内部",
    "chase 后": "追逐后",
    "结束 chase": "结束追逐",
    "location chain": "位置链",
    "movement actions": "移动行动",
    "movement action": "移动行动",
    "quarry escapes": "被追者逃脱",
    "quarry": "被追者",
    "pursuer": "追赶者",
    "adjusted MOV": "调整后 MOV",
    "DEX order": "DEX 顺序",
    "extreme success": "极难成功",
    "hard success": "困难成功",
    "regular success": "普通成功",
    "hazard": "危险点",
    "barrier": "障碍",
    "conflict": "冲突",
    "escapes": "逃脱",
    "session ended": "本场结束",
}

CJK_BOUNDARY_SPACE = re.compile(r"(?<=[\u4e00-\u9fff·》」』”）]) (?=[\u4e00-\u9fff《「『“（])")
LOCALIZED_JSON_TEXT_KEYS = {
    "description",
    "difficulty_rationale",
    "failure_consequence",
    "foreshadowed_failure",
    "goal",
    "name",
    "player_safe_summary",
    "push_justification",
    "purpose",
    "role",
    "summary",
    "text",
}
LOCALIZED_ROLL_TEXT_KEYS = (
    "goal",
    "difficulty_rationale",
    "failure_consequence",
    "push_justification",
    "foreshadowed_failure",
)
ZH_HANS_ROLL_TEXT = {
    "gain access to The Boston Globe clipping files from Arty Wilmot": "获得《波士顿环球报》剪报档案的查阅许可",
    "Arty is an obstructive but ordinary editor, so the social skill check is Regular.": "阿蒂·威尔莫特只是普通编辑，不是超自然威胁；这次社交检定按普通难度处理。",
    "Arty refuses access unless Ada escalates with a pushed approach.": "艾达·金会被阿蒂拒绝；除非改变策略并承担推骰风险，否则无法进入剪报档案室。",
    "The pushed roll keeps the same social difficulty after Ada changes pressure.": "艾达·金改变施压方式后，推骰仍保持同一社交难度。",
    "Arty would call strong-armed maintenance men and bar Ada from the files.": "阿蒂会叫来强壮的维护工，并禁止艾达·金继续查档。",
    "Ada shows Mr. Knott's keys and argues that access may prevent another tragedy.": "艾达·金亮出诺特先生的钥匙，并强调查档可能阻止下一场悲剧。",
    "On failure, Arty calls maintenance and Ada loses access to the morgue.": "若失败，阿蒂会叫维护工，艾达·金今天失去进入剪报档案室的机会。",
    "connect Walter Corbitt to an executor and church records": "把沃尔特·科比特与遗嘱执行人和教会记录联系起来",
    "The Hall of Records contains the entry, but it takes focused archive work.": "档案馆里有这条记录，但需要专注翻查档案。",
    "Ada would spend another half day and risk pressure from Mr. Knott.": "艾达·金会多花半天时间，并可能受到诺特先生催促。",
    "find the chapel journal under the ruined cabinet": "在破旧柜子下找到教堂日志",
    "The journal is hidden under debris but can be found with a careful search.": "日志藏在碎屑下，但仔细搜索可以找到。",
    "Ada would miss the explicit basement burial clue.": "艾达·金会错过明确指向地下室埋葬的线索。",
    "notice the Bed Attack before impact": "在床铺撞来前察觉床铺袭击",
    "The bed lurches suddenly, but a watchful investigator can react.": "床突然扑动，但警觉的调查员仍有机会反应。",
    "Ada would have no chance to Dodge before the bed hit.": "艾达·金会来不及在床撞上前闪避。",
    "avoid being thrown through the spare bedroom window by the Bed Attack": "避免被床铺袭击撞穿备用卧室窗户",
    "Bed Attack allows a Dodge after the Spot Hidden success.": "成功察觉床铺袭击后，可以进行 Dodge 来避开撞击。",
    "Ada is thrown through glass and takes 1D6+2 damage.": "艾达·金会被撞穿玻璃，并受到 1D6+2 伤害。",
    "withstand seeing the bed move of its own accord": "承受亲眼看见床自行移动的冲击",
    "The Bed Attack calls for SAN 1/1D4.": "床铺袭击需要进行 SAN 1/1D4 检定。",
    "Ada loses 1D4 SAN.": "艾达·金会失去 1D4 SAN。",
    "descend the moving basement stairs": "沿着会移动的地下室楼梯下去",
    "The rulebook treats the basement stairs as a combined DEX or Climb roll.": "规则书把地下室楼梯处理为 DEX 或 Climb 的联合检定。",
    "Ada must stop or push and risk a fall.": "艾达·金必须停下，或选择推骰并承担摔落风险。",
    "push through the dangerous basement descent": "用推骰方式通过危险的地下室下行",
    "Ada changes tactics by sitting low and bracing on the rail.": "艾达·金改变做法，压低身体并抓住扶手前进。",
    "Ada would fall and lose 1D6 HP.": "艾达·金会摔下楼梯并损失 1D6 HP。",
    "Ada inches down while braced and accepts a fall if it goes wrong.": "艾达·金扶稳身体一阶阶往下挪，并接受失败时摔下去的后果。",
    "On failure, Ada falls down the stairs for 1D6 HP damage.": "若失败，艾达·金会摔下楼梯并受到 1D6 HP 伤害。",
    "find Corbitt's blood-rusted dagger in basement clutter": "在地下室杂物中找到科比特那把血锈匕首",
    "The knife is an Obscure clue hidden among dangerous clutter.": "这把刀是藏在危险杂物中的隐晦线索。",
    "Ada misses the knife unless she risks a more dangerous search.": "艾达·金会错过这把刀，除非冒险进行更危险的搜索。",
    "The pushed search takes more time and exposes Ada to sharp debris.": "推骰搜索会花更多时间，也让艾达·金暴露在尖锐碎片中。",
    "Ada takes 1D4+2 HP damage from the knife.": "艾达·金会被刀伤到，受到 1D4+2 HP 伤害。",
    "Ada removes her gloves and searches by touch despite the risk.": "艾达·金脱下手套，冒险用触摸继续搜索。",
    "On failure, Ada catches her hand on the possessed knife and takes automatic damage.": "若失败，艾达·金会被附魔匕首割伤，并自动受到伤害。",
    "withstand seeing The Floating Knife attack": "承受亲眼看见浮空匕首发动攻击的冲击",
    "The Floating Knife calls for SAN 1/1D4.": "浮空匕首需要进行 SAN 1/1D4 检定。",
    "Ada would lose 1D4 SAN.": "艾达·金会失去 1D4 SAN。",
    "drive The Floating Knife into Ada": "驱使浮空匕首刺向艾达·金",
    "The knife attacks using Corbitt's POW against Ada's Dodge.": "匕首用科比特的 POW 与艾达·金的 Dodge 对抗。",
    "The knife would miss if Corbitt failed.": "如果科比特失败，匕首会刺空。",
    "avoid The Floating Knife": "避开浮空匕首",
    "Ada compares Dodge success level against Corbitt's POW success level.": "艾达·金用 Dodge 的成功等级与科比特 POW 的成功等级比较。",
    "Ada would take 1D4+2 damage if Corbitt achieved the higher success level.": "若科比特取得更高成功等级，艾达·金会受到 1D4+2 伤害。",
    "grab The Floating Knife with a coat-assisted fighting maneuver": "借助外套用战技抓住浮空匕首",
    "Grabbing the knife uses Fighting Maneuver rules against Corbitt's POW.": "抓刀使用战技规则，并与科比特的 POW 对抗。",
    "The knife would remain free and continue attacking.": "匕首会保持自由并继续攻击。",
    "resist Ada grabbing The Floating Knife": "抵抗艾达·金抓住浮空匕首",
    "Corbitt contests the maneuver with POW.": "科比特用 POW 对抗这次战技。",
    "Ada gains hold of the knife.": "艾达·金成功抓住匕首。",
    "withstand seeing Corbitt rise from the pallet": "承受亲眼看见科比特从木板床上坐起的冲击",
    "Corbitt rising calls for SAN 1/1D8.": "科比特起身需要进行 SAN 1/1D8 检定。",
    "Ada loses 1D8 SAN and may suffer temporary insanity.": "艾达·金会失去 1D8 SAN，并可能触发临时疯狂。",
    "determine whether the 5+ SAN loss causes temporary insanity": "判断 5 点以上 SAN 损失是否触发临时疯狂",
    "After losing 5 or more SAN, a successful INT roll means Ada comprehends the horror.": "一次损失 5 点以上 SAN 后，INT 成功表示艾达·金理解了恐怖真相。",
    "On failure, Ada would be shaken but not temporarily insane.": "若失败，艾达·金会受到惊吓，但不会进入临时疯狂。",
    "stab Corbitt with his own dagger": "用科比特自己的匕首刺向他",
    "Ada attacks with the seized dagger before Corbitt's DEX 35 action.": "艾达·金在科比特 DEX 35 行动前，用夺来的匕首攻击。",
    "Corbitt would take his action and continue the combat.": "科比特会获得行动机会，战斗继续。",
    "confirm Nathaniel has the cult ledger before acting": "确认内森尼尔·克劳行动前是否带着邪教账本",
    "The ledger is partly visible under Nathaniel's coat.": "账本只从内森尼尔·克劳的外套下露出一角，需要仔细观察。",
    "Ada cannot confirm the ledger without risking detection.": "艾达·金无法确认账本，除非冒着被发现的风险继续观察。",
    "Ada changes position for a better angle, keeping the same difficulty.": "艾达·金改变位置取得更好角度，因此仍保持同一难度。",
    "Nathaniel would begin the chase at the same location as Ada.": "内森尼尔·克劳会在与艾达·金相同的位置开始追逐。",
    "Ada leans over the skylight for a better look and accepts being noticed.": "艾达·金探身越过天窗多看一眼，并接受被发现的风险。",
    "On failure, Nathaniel sees Ada and starts the chase with no gap.": "若失败，内森尼尔·克劳会看见艾达·金，追逐开始时双方没有距离差。",
    "speed roll to establish Ada's adjusted MOV for the chase": "用速度检定确定艾达·金在本次追逐中的调整后 MOV",
    "On-foot chases use CON as the speed roll.": "步行追逐使用 CON 作为速度检定。",
    "Ada's MOV would drop by 1 for this chase.": "艾达·金的 MOV 会在本次追逐中降低 1。",
    "speed roll to establish Nathaniel's adjusted MOV for the chase": "用速度检定确定内森尼尔·克劳在本次追逐中的调整后 MOV",
    "Nathaniel's MOV would drop by 1 for this chase.": "内森尼尔·克劳的 MOV 会在本次追逐中降低 1。",
    "negotiate the slick skylight hazard": "越过湿滑天窗危险点",
    "The skylight is a Regular foot-chase hazard.": "湿滑天窗是普通难度的步行追逐危险点。",
    "Ada would lose 1D3 movement actions and risk falling glass damage.": "艾达·金会失去 1D3 次移动行动，并冒着被碎玻璃伤到的风险。",
    "avoid Nathaniel's sap during chase conflict": "在追逐冲突中避开内森尼尔·克劳的短棍",
    "Conflict during a chase can be resolved with normal attack and Dodge rolls.": "追逐中的冲突可以用正常攻击和 Dodge 检定解决。",
    "Ada would take damage and lose momentum.": "艾达·金会受到伤害并失去速度优势。",
    "strike Ada with a sap during chase conflict": "在追逐冲突中用短棍打中艾达·金",
    "An attack during a chase costs one movement action.": "追逐中的攻击会消耗一次移动行动。",
    "Ada slips past the attack.": "艾达·金会从攻击旁边闪过去。",
    "pass the locked roof door barrier": "通过上锁屋顶门障碍",
    "The locked roof door is a Regular barrier with the stolen key ring.": "有偷来的钥匙串时，上锁屋顶门是普通难度障碍。",
    "The barrier would stop Ada's movement until another method succeeded.": "障碍会阻止艾达·金移动，直到她用其他方法通过。",
    "hide on the laundry roof after passing the barrier": "通过障碍后躲在晾衣屋顶",
    "Ada has a brief lead and concealment among laundry sheets.": "艾达·金暂时领先，并能借晾衣布单遮蔽自己。",
    "Nathaniel would keep the chase active.": "内森尼尔·克劳会继续保持追逐。",
    "find Ada after she hides": "在艾达·金躲藏后重新找到她",
    "The pursuer searches the laundry roof after losing line of sight.": "追赶者在失去视线后搜索晾衣屋顶。",
    "The quarry escapes.": "被追者逃脱。",
}

ZH_HANS_TRANSCRIPT_DETAIL_TEXT = {
    "ask terms and recent incidents": "询问委托条件和近期事件",
    "ask terms and immediate leads": "询问委托条件和近期线索",
    "attack Corbitt with his own weapon": "用科比特自己的武器攻击他",
    "basement_spot_hidden": "地下室 Spot Hidden 检定",
    "bed_attack_dodge": "床铺袭击 Dodge 检定",
    "bed_attack_sanity": "床铺袭击理智检定",
    "bed_attack_spot_hidden": "床铺袭击前的 Spot Hidden 检定",
    "challenge keeper ruling": "质疑 KP 裁定",
    "chase_setup": "建立追逐",
    "check sanitarium clue": "调查疗养院线索",
    "choose first research route": "选择先查公开记录",
    "combined_dex_climb": "DEX 或 Climb 联合检定",
    "conflict": "追逐冲突",
    "continue to basement despite injury": "受伤后继续前往地下室",
    "corbitt_combat_round": "科比特战斗轮",
    "corbitt_sanity": "科比特现身理智检定",
    "cross hazard": "穿过危险点",
    "cut_to_chase": "切入追逐场面",
    "enter the Old Corbitt Place": "进入科比特老宅",
    "floating_knife_combat": "浮空匕首战斗",
    "follow public record trail": "追查公开记录线索",
    "grab the floating knife": "抓住浮空匕首",
    "haunting_scene": "鬼屋场景",
    "hazard_dodge": "危险点 Dodge 检定",
    "investigate Chapel of Contemplation": "调查沉思教堂",
    "library_use_regular": "Library Use 普通难度",
    "location_chain": "位置链说明",
    "movement_actions": "移动行动说明",
    "no_roll_needed": "无需检定",
    "pass barrier and hide": "通过障碍并躲藏",
    "persuade_regular": "Persuade 普通难度",
    "profile_pressure_explanation": "多玩家画像裁定说明",
    "push Arty social access": "推骰争取阿蒂放行",
    "ask pushed-roll ruling": "询问推骰裁定",
    "push basement descent": "推骰通过地下室楼梯",
    "push basement search": "推骰搜索地下室",
    "push failed search": "推骰失败的搜索",
    "push ledger confirmation": "推骰确认账本",
    "push reckless entry": "鲁莽进屋前推骰",
    "pushed_dex_climb": "推骰 DEX 或 Climb",
    "pushed_persuade": "推骰 Persuade",
    "pushed_roll_explanation": "推骰说明",
    "pushed_spot_hidden": "推骰 Spot Hidden",
    "request careful research route": "请求谨慎调查路线",
    "roleplay_no_roll": "角色扮演处理，无需检定",
    "rush into danger": "鲁莽闯入危险",
    "san_roll": "SAN 检定",
    "search basement clutter": "搜索地下室杂物",
    "session_wrap": "收束本轮",
    "spot the stolen ledger": "确认被偷走的账本",
    "spot_hidden_regular": "Spot Hidden 普通难度",
    "use clue to shape plan": "用线索调整计划",
}


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_jsonl(path: Path, events: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8")


def _write_investigator_chronicle(
    investigator_dir: Path,
    history: list[dict[str, Any]],
    development: list[dict[str, Any]],
    inventory: list[dict[str, Any]] | None = None,
) -> None:
    _write_jsonl(investigator_dir / "history.jsonl", history)
    _write_jsonl(investigator_dir / "development.jsonl", development)
    _write_jsonl(investigator_dir / "inventory-history.jsonl", inventory or [])


def _localize_text(text: str, glossary: dict[str, str]) -> str:
    localized = text
    for canonical, replacement in sorted(glossary.items(), key=lambda item: len(item[0]), reverse=True):
        localized = localized.replace(canonical, replacement)
    return CJK_BOUNDARY_SPACE.sub("", localized)


def _localize_value(value: Any, glossary: dict[str, str], key: str | None = None) -> Any:
    if isinstance(value, str):
        return _localize_text(value, glossary) if key in LOCALIZED_JSON_TEXT_KEYS else value
    if isinstance(value, list):
        return [_localize_value(item, glossary, key) for item in value]
    if isinstance(value, dict):
        return {child_key: _localize_value(item, glossary, child_key) for child_key, item in value.items()}
    return value


def _write_jsonl_localized(path: Path, events: list[dict[str, Any]], glossary: dict[str, str]) -> None:
    _write_jsonl(path, [_localize_value(event, glossary) for event in events])


def _write_transcript_jsonl_localized(path: Path, events: list[dict[str, Any]], glossary: dict[str, str]) -> None:
    localized_events: list[dict[str, Any]] = []
    for event in events:
        localized = dict(event)
        if localized.get("role") in {"keeper_under_test", "player_simulator"}:
            for key in ("speaker", "text"):
                if isinstance(localized.get(key), str):
                    localized[key] = _localize_text(localized[key], glossary)
        localized_text = dict(localized.get("localized_text", {}))
        zh_hans = dict(localized_text.get("zh-Hans", {}))
        for key in ("intent", "ruling"):
            value = localized.get(key)
            if not isinstance(value, str):
                continue
            detail = ZH_HANS_TRANSCRIPT_DETAIL_TEXT.get(value)
            if detail is None:
                detail = _localize_text(value, glossary)
            if detail != value:
                zh_hans.setdefault(key, detail)
        if zh_hans:
            localized_text["zh-Hans"] = zh_hans
            localized["localized_text"] = localized_text
        localized_events.append(localized)
    _write_jsonl(path, localized_events)


def _with_play_language(payload: dict[str, Any], glossary: dict[str, str]) -> dict[str, Any]:
    localized = dict(payload)
    localized["play_language"] = "zh-Hans"
    localized["language_profile"] = language_profile("zh-Hans")
    localized["localized_terms"] = {"zh-Hans": glossary}
    return localized


def _with_roll_localization(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for event in events:
        payload = event.get("payload", {})
        if not isinstance(payload, dict):
            continue
        localized_text = dict(payload.get("localized_text", {}))
        zh_hans = dict(localized_text.get("zh-Hans", {}))
        for key in LOCALIZED_ROLL_TEXT_KEYS:
            value = payload.get(key)
            if value in ZH_HANS_ROLL_TEXT:
                zh_hans.setdefault(key, ZH_HANS_ROLL_TEXT[value])
        if zh_hans:
            localized_text["zh-Hans"] = zh_hans
            payload["localized_text"] = localized_text
    return events


def _clear_semantic_eval_artifacts(run_dir: Path) -> None:
    artifacts_dir = run_dir / "artifacts"
    for name in ("semantic-eval-request.json", "semantic-eval-result.json"):
        path = artifacts_dir / name
        if path.exists():
            path.unlink()


def create_rulebook_smoke_run(root: Path, run_id: str = "v1-rulebook-smoke") -> Path:
    run_dir = root / ".coc" / "playtests" / run_id
    _clear_semantic_eval_artifacts(run_dir)
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / run_id
    scenario_dir = campaign_dir / "scenario"
    investigator_id = "ada-king-rulebook"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id

    _write_json(run_dir / "playtest.json", {
        "run_id": run_id,
        "campaign_id": run_id,
        "campaign_title": "The Haunting Rulebook Smoke",
        "scenario": "The Haunting",
        "scenario_id": "the-haunting",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "player_profile": "careful_investigator",
        "subsystems_covered": ["investigation", "sanity"],
        "scores": {
            "immersion": 4,
            "rules_accuracy": 4,
            "state_integrity": 4,
            "spoiler_safety": 4,
            "meta_quality": 4,
            "pacing": 4,
            "recovery": 4,
        },
        "passed_test_cases": [
            "rulebook_conversation_loop",
            "roll_protocol",
            "pushed_roll",
            "clue_flow",
            "sanity_prompt",
            "session_ending",
        ],
        "failed_test_cases": [],
        "recommended_fixes": [],
        "regression_tests": ["Rulebook audit must pass for the rulebook smoke harness."],
    })
    _write_json(campaign_dir / "campaign.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "title": "The Haunting Rulebook Smoke",
        "mode": "keeper",
        "status": "active",
        "era": "1920s",
        "active_scenario_id": "the-haunting",
        "active_scene_id": "knott-hiring",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "active_subsystem": "investigation",
    })
    _write_json(campaign_dir / "party.json", {
        "campaign_id": run_id,
        "investigator_ids": [investigator_id],
        "active_investigator_ids": [investigator_id],
    })
    _write_json(scenario_dir / "scenario.json", {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "module_source": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf",
        "summary": "A landlord hires investigators to learn why tenants keep fleeing the Corbitt House.",
        "player_safe_summary": "Mr. Knott asks Ada King to inspect a supposedly haunted Boston house.",
        "opening_scene": "Mr. Knott meets Ada in his office and asks her to investigate the Corbitt House.",
        "current_phase": "opening_investigation",
    })
    _write_json(scenario_dir / "clues.json", [
        {
            "id": "clue-chapel",
            "summary": "Newspaper research links Walter Corbitt to the Chapel of Contemplation.",
            "route": "Library Use at the clipping files.",
        },
        {
            "id": "clue-lawsuit",
            "summary": "Neighbors sued Walter Corbitt before his death.",
            "route": "Public records or newspaper archives.",
        },
    ])
    _write_json(scenario_dir / "locations.json", [
        {"id": "location-knott-office", "name": "Mr. Knott's office", "purpose": "opening hook"},
        {"id": "location-clipping-files", "name": "Boston Globe clipping files", "purpose": "early research"},
    ])
    _write_json(scenario_dir / "npcs.json", [
        {"id": "npc-knott", "name": "Mr. Knott", "role": "landlord and client"},
    ])
    _write_json(scenario_dir / "timeline.json", [
        {"id": "past-lawsuit", "summary": "Neighbors sued Walter Corbitt over disturbing events."},
        {"id": "past-chapel", "summary": "The Chapel of Contemplation was closed after a police raid."},
    ])
    _write_json(scenario_dir / "handouts.json", [])
    _write_json(scenario_dir / "keeper-secrets.json", [])

    _write_json(investigator_dir / "character.json", {
        "schema_version": 1,
        "id": investigator_id,
        "name": "Ada King",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
        },
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 8,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": {
            "Library Use": 60,
            "Spot Hidden": 55,
            "Psychology": 40,
        },
    })

    _write_jsonl(run_dir / "transcript.jsonl", [
        {
            "turn": 1,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "Mr. Knott says the Corbitt House has a reputation, but he wants facts before losing more tenants.",
        },
        {
            "turn": 2,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "ask terms and recent incidents",
            "text": "I ask Mr. Knott what happened to the last tenants and what he expects me to prove.",
        },
        {
            "turn": 3,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "no_roll_needed",
            "text": "No roll is needed for that. Knott explains the tenants reported bad dreams, illness, and a presence in the house.",
        },
        {
            "turn": 4,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "research public history before entering the house",
            "text": "Before visiting the house, I search newspaper clippings for Walter Corbitt and the address.",
        },
        {
            "turn": 5,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "library_use_regular",
            "text": "That is a Library Use roll at Regular difficulty because the archives are public but poorly indexed.",
        },
        {
            "turn": 6,
            "role": "system",
            "speaker": "system",
            "mode": "roll",
            "text": "Library Use 42 vs 60 -> regular_success.",
        },
        {
            "turn": 7,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "You find a clipping about lawsuits against Walter Corbitt and another about the Chapel of Contemplation.",
        },
        {
            "turn": 8,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "find any hidden symbol before leaving",
            "text": "Before I leave the archive desk, I check the underside and drawer edges for marks or symbols.",
        },
        {
            "turn": 9,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "spot_hidden_regular",
            "text": "Make a Spot Hidden roll at Regular difficulty. The desk is cluttered, but the marks would be visible if you are thorough.",
        },
        {
            "turn": 10,
            "role": "system",
            "speaker": "system",
            "mode": "roll",
            "text": "Spot Hidden 83 vs 55 -> failure.",
        },
        {
            "turn": 11,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "push failed search",
            "text": "I want to push it. I spend ten more minutes checking the desk underside and accept that someone may return.",
        },
        {
            "turn": 12,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "pushed_spot_hidden",
            "text": "That justifies a pushed roll. If you fail, you hear footsteps and lose the chance to search quietly.",
        },
        {
            "turn": 13,
            "role": "system",
            "speaker": "system",
            "mode": "roll",
            "text": "Pushed Spot Hidden 34 vs 55 -> regular_success.",
        },
        {
            "turn": 14,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "You find a faint chapel sigil scratched under the desk, confirming the newspaper clue is worth pursuing.",
        },
        {
            "turn": 15,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "inspect disturbing stain at archive table",
            "text": "The name gives me a chill. I look closer at the brown stain on the archive table.",
        },
        {
            "turn": 16,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "ruling": "san_roll",
            "text": "The stain looks disturbingly fresh and evokes a sudden image of a cellar. Make a SAN roll.",
        },
        {
            "turn": 17,
            "role": "system",
            "speaker": "system",
            "mode": "roll",
            "text": "SAN 31 vs 55 -> success, lose 0 SAN.",
        },
        {
            "turn": 18,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "We end with Ada holding two leads: the Chapel of Contemplation and the Corbitt House itself.",
        },
    ])

    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "actor": investigator_id,
            "payload": {
                "skill": "Library Use",
                "goal": "find an early public clue about Walter Corbitt and the house",
                "target": 60,
                "effective_target": 60,
                "difficulty": "regular",
                "difficulty_rationale": "The clipping files are public but poorly indexed.",
                "roll": 42,
                "outcome": "regular_success",
                "push_eligible": False,
                "failure_consequence": "Ada would lose time and need another route to the Chapel clue.",
                "skill_check_earned": True,
            },
        },
        {
            "type": "roll",
            "actor": investigator_id,
            "payload": {
                "skill": "Spot Hidden",
                "goal": "notice a hidden chapel sigil before leaving the archive desk",
                "target": 55,
                "effective_target": 55,
                "difficulty": "regular",
                "difficulty_rationale": "The desk is cluttered, but the sigil is visible with a careful search.",
                "roll": 83,
                "outcome": "failure",
                "push_eligible": True,
                "failure_consequence": "Ada leaves without confirming the Chapel lead from physical evidence.",
                "skill_check_earned": False,
            },
        },
        {
            "type": "roll",
            "actor": investigator_id,
            "payload": {
                "skill": "Spot Hidden",
                "goal": "notice a hidden chapel sigil before leaving the archive desk",
                "target": 55,
                "effective_target": 55,
                "difficulty": "regular",
                "difficulty_rationale": "The pushed roll keeps the same difficulty after Ada spends more time.",
                "roll": 34,
                "outcome": "regular_success",
                "pushed": True,
                "push_justification": "Ada spends ten more minutes checking the desk underside and accepts that someone may return.",
                "foreshadowed_failure": "If this fails, Ada hears footsteps and loses the chance to search quietly.",
                "failure_consequence": "Ada would be interrupted by footsteps from the hall.",
                "skill_check_earned": True,
            },
        },
        {
            "type": "sanity",
            "actor": investigator_id,
            "payload": {
                "skill": "SAN",
                "goal": "test Ada's reaction to a disturbing omen",
                "target": 55,
                "effective_target": 55,
                "difficulty": "sanity",
                "difficulty_rationale": "SAN rolls use current SAN and no bonus or penalty dice.",
                "roll": 31,
                "outcome": "success",
                "failure_consequence": "Ada would lose 1D3 SAN and freeze for a moment.",
                "san_loss": 0,
            },
        },
    ])
    _write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "type": "scene",
            "actor": "keeper_under_test",
            "payload": {"scene_id": "knott-hiring", "summary": "Mr. Knott hired Ada to investigate the Corbitt House."},
        },
        {
            "type": "decision",
            "actor": investigator_id,
            "payload": {"summary": "Ada chose to research public history before entering the house."},
        },
        {
            "type": "decision",
            "actor": investigator_id,
            "payload": {"summary": "Ada chose to push the failed Spot Hidden roll by spending extra time at the archive desk."},
        },
        {
            "type": "clue",
            "actor": investigator_id,
            "payload": {"clue_id": "clue-chapel", "summary": "Ada found the Chapel of Contemplation lead."},
        },
        {
            "type": "clue",
            "actor": investigator_id,
            "payload": {"clue_id": "clue-chapel-sigil", "summary": "Ada confirmed the Chapel lead by finding a hidden sigil under the archive desk."},
        },
        {
            "type": "sanity",
            "actor": investigator_id,
            "payload": {"summary": "Ada passed the SAN roll and lost no SAN."},
        },
        {
            "type": "session_ending",
            "actor": "keeper_under_test",
            "payload": {"summary": "Session ended with Ada planning to visit the Corbitt House next."},
        },
    ])
    _write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "Ada accepted Mr. Knott's job, researched Walter Corbitt, pushed a careful search to confirm the Chapel lead, and plans to visit the Corbitt House next.",
        },
    ])
    _write_jsonl(run_dir / "player-feedback.jsonl", [
        {
            "category": "kp_clarity",
            "score": 5,
            "text": "KP explained when rolls were needed and what changed in the fiction.",
        },
        {
            "category": "immersion",
            "score": 4,
            "text": "The scene felt like investigation first, not a mechanics checklist.",
        },
    ])
    _write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "rules_accuracy", "text": "Rolls include goals and difficulty rationale."},
        {"severity": "low", "category": "state_integrity", "text": "Clue, decision, sanity, memory, and feedback logs are present."},
    ])

    generate_battle_report(run_dir)
    generate_evaluation_report(run_dir)
    generate_rulebook_audit(run_dir)
    return run_dir


def create_haunting_module_run(root: Path, run_id: str = "v2-haunting-module") -> Path:
    run_dir = root / ".coc" / "playtests" / run_id
    _clear_semantic_eval_artifacts(run_dir)
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / run_id
    scenario_dir = campaign_dir / "scenario"
    investigator_id = "ada-king-haunting"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id
    corbitt_id = "walter-corbitt"

    _write_json(run_dir / "playtest.json", _with_play_language({
        "run_id": run_id,
        "campaign_id": run_id,
        "campaign_title": "The Haunting Module Playthrough",
        "scenario": "The Haunting",
        "scenario_id": "the-haunting",
        "audit_profile": "haunting_module",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "player_profile": "careful_investigator",
        "module_coverage": [
            "knott_hiring",
            "research_route",
            "chapel_of_contemplation",
            "old_corbitt_place",
            "bed_attack",
            "basement",
            "floating_knife",
            "corbitt_hiding_place",
            "corbitt_confrontation",
            "conclusion_rewards",
        ],
        "subsystems_covered": [
            "investigation",
            "social",
            "pushed_roll",
            "sanity",
            "damage",
            "combat",
            "meta_game",
        ],
        "scores": {
            "immersion": 4,
            "rules_accuracy": 4,
            "state_integrity": 5,
            "spoiler_safety": 4,
            "meta_quality": 4,
            "pacing": 4,
            "module_fidelity": 4,
        },
        "passed_test_cases": [
            "module_opening_contract",
            "research_route_choice",
            "social_pushed_roll",
            "chapel_clue_route",
            "house_exploration",
            "bed_attack_damage_and_sanity",
            "basement_pushed_roll_damage",
            "floating_knife_combat",
            "corbitt_final_combat",
            "final_state_and_rewards",
        ],
        "failed_test_cases": [],
        "recommended_fixes": [
            "Future loop should add a chase-specific scenario because The Haunting does not naturally exercise chase rules.",
        ],
        "regression_tests": ["Haunting module audit must pass for the module-level harness."],
    }, ZH_HANS_HAUNTING_GLOSSARY))
    _write_json(campaign_dir / "campaign.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "title": "The Haunting Module Playthrough",
        "mode": "keeper",
        "status": "complete",
        "era": "1920s",
        "active_scenario_id": "the-haunting",
        "active_scene_id": "conclusion-rewards",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "active_subsystem": "aftermath",
    })
    _write_json(campaign_dir / "party.json", {
        "campaign_id": run_id,
        "investigator_ids": [investigator_id],
        "active_investigator_ids": [investigator_id],
    })
    _write_json(scenario_dir / "scenario.json", {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "module_source": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf",
        "summary": "Investigators trace Walter Corbitt through Boston records, the Chapel of Contemplation, and the Corbitt House basement.",
        "player_safe_summary": "Mr. Knott hires Ada King to inspect a haunted Boston house and learn why tenants keep fleeing it.",
        "opening_scene": "Mr. Knott 在 1920 年的波士顿与 Ada King 会面，交给她钥匙和预付款，并建议她进屋前先做调查。",
        "current_phase": "conclusion_rewards",
    })
    _write_json(scenario_dir / "clues.json", [
        {"id": "handout-1", "summary": "Mr. Knott gives the address, keys, $20 advance, and the research premise.", "route": "opening"},
        {"id": "handout-2", "summary": "Boston Globe files describe violent accidents, illness, suicide, and the Macarios fleeing.", "route": "Arty Wilmot access scene"},
        {"id": "handout-7", "summary": "Hall of Records links Corbitt's will to Reverend Michael Thomas and the Chapel of Contemplation.", "route": "Library Use at Hall of Records"},
        {"id": "chapel-journal", "summary": "The chapel journal says Walter Corbitt was buried in his basement.", "route": "Spot Hidden under the ruined chapel cabinet"},
        {"id": "vittorio-bible", "summary": "Vittorio's phrase hints that Corbitt may be worsted by his own weapon.", "route": "Roxbury Sanitarium interview"},
    ])
    _write_json(scenario_dir / "locations.json", [
        {"id": "location-knott-office", "name": "Mr. Knott's office", "purpose": "opening hook"},
        {"id": "location-boston-globe", "name": "The Boston Globe", "purpose": "social access and Handout 2"},
        {"id": "location-hall-records", "name": "Hall of Records", "purpose": "Chapel lead"},
        {"id": "location-sanitarium", "name": "Roxbury Sanitarium", "purpose": "own-weapon clue"},
        {"id": "location-chapel", "name": "Chapel of Contemplation", "purpose": "burial clue and Mythos tome"},
        {"id": "location-house", "name": "The Old Corbitt Place", "purpose": "haunting exploration"},
        {"id": "location-spare-bedroom", "name": "Spare Bedroom", "purpose": "Bed Attack"},
        {"id": "location-basement", "name": "Basement", "purpose": "The Floating Knife"},
        {"id": "location-hidden-lair", "name": "Corbitt's Hiding Place", "purpose": "final confrontation"},
    ])
    _write_json(scenario_dir / "npcs.json", [
        {"id": "npc-knott", "name": "Mr. Knott", "role": "landlord and client"},
        {"id": "npc-arty", "name": "Arty Wilmot", "role": "Boston Globe editor blocking access to the morgue"},
        {"id": "npc-ruth", "name": "Ruth Blake", "role": "records keeper"},
        {"id": "npc-gabriela", "name": "Gabriela Macario", "role": "survivor at Roxbury Sanitarium"},
        {"id": corbitt_id, "name": "Walter Corbitt", "role": "undead sorcerer antagonist"},
    ])
    _write_json(scenario_dir / "timeline.json", [
        {"id": "past-1835", "summary": "A merchant builds the house and sells it to Walter Corbitt after falling ill."},
        {"id": "past-1852", "summary": "Neighbors sue Corbitt over his strange habits."},
        {"id": "past-1866", "summary": "Corbitt's will asks that he be buried in the basement."},
        {"id": "past-1912", "summary": "Police raid the Chapel of Contemplation."},
        {"id": "past-1918", "summary": "The Macarios flee after illness and madness."},
    ])
    _write_json(scenario_dir / "handouts.json", [
        {"id": "handout-1", "title": "Mr. Knott's job"},
        {"id": "handout-2", "title": "Unpublished Boston Globe story"},
        {"id": "handout-7", "title": "Chapel executor record"},
        {"id": "handout-9", "title": "Chapel symbol"},
    ])
    _write_json(scenario_dir / "keeper-secrets.json", [
        {"id": "secret-corbitt-body", "summary": "Walter Corbitt's body and mind persist in the basement."},
        {"id": "secret-floating-knife", "summary": "Corbitt controls a blood-rusted magic dagger."},
    ])

    _write_json(investigator_dir / "character.json", {
        "schema_version": 1,
        "id": investigator_id,
        "name": "Ada King",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
            "LUCK": 55,
        },
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 8,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": {
            "Charm": 35,
            "Climb": 20,
            "Dodge": 25,
            "Fighting (Brawl)": 40,
            "Library Use": 60,
            "Persuade": 55,
            "Psychology": 40,
            "Spot Hidden": 55,
        },
        "backstory": {
            "description": "艾达·金是一名研究旧宅产权和民俗传闻的古物学者，习惯把钥匙、地契和剪报按地址整理。",
            "ideology_beliefs": ["老房子会留下居住者的记忆，公开记录能让这些记忆开口。"],
            "significant_people": ["莱兰·哈特教授，她已故的导师，教她先查档案再下判断。"],
            "meaningful_locations": ["斯科利广场附近的旧书店，她在那里替客户鉴定遗物。"],
            "treasured_possessions": ["裂柄铜放大镜。"],
            "traits": ["谨慎记笔记", "先询问目击者再进入危险地点"],
        },
    })
    _write_investigator_chronicle(
        investigator_dir,
        [
            {
                "schema_version": 1,
                "type": "scenario_experience",
                "campaign_id": run_id,
                "scenario_id": "the-haunting",
                "summary": "艾达·金在 The Haunting 中幸存，摧毁科比特；最终 HP: 3；最终 SAN: 49。",
                "final_hp": 3,
                "final_san": 49,
                "notable_events": ["逼退阿蒂进入剪报档案室", "从沉思教堂追查到地下室", "用科比特自己的匕首摧毁他"],
                "unresolved_threads": ["沉思教堂残余记录可能指向后续模组"],
            }
        ],
        [
            {
                "schema_version": 1,
                "type": "development_phase_summary",
                "campaign_id": run_id,
                "status": "pending_player_rolls",
                "skill_checks_earned": ["Persuade", "Library Use", "Spot Hidden", "Dodge", "Fighting (Brawl)"],
                "rewards": ["恢复 4 SAN", "诺特先生支付报酬和 30 美元奖金"],
                "permanent_changes": ["记录临时疯狂经历", "保留科比特宅邸幸存经历"],
                "carryover_notes": "下次导入前先结算成长检定，并决定是否把地下室创伤写入伤疤、恐惧或关系条目。",
            }
        ],
    )

    _write_transcript_jsonl_localized(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Mr. Knott 把一枚旧钥匙推到桌面中央，说只要 Ada 能查清 Corbitt House 为什么赶走房客，他每天付 20 美元。"},
        {"turn": 2, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "ask terms and immediate leads", "text": "我先不接钥匙，问 Mr. Knott：Macario 一家到底出了什么事？如果我要查，最好从哪里开始？"},
        {"turn": 3, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "no_roll_needed", "text": "这个问题不需要检定。Mr. Knott 给你 Handout 1、钥匙和地址，并建议你在进屋前先查公共记录。"},
        {"turn": 4, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "choose first research route", "text": "我先去 The Boston Globe，礼貌地要求查看旧剪报档案，不急着进那栋房子。"},
        {"turn": 5, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "persuade_regular", "text": "Arty Wilmot 挡在 morgue 门口，不想让陌生人翻档案。你的目标是说服他放行，做 Persuade，Regular difficulty。"},
        {"turn": 6, "role": "system", "speaker": "system", "mode": "roll", "text": "Persuade 72 vs 55 -> failure."},
        {"turn": 7, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push Arty social access", "text": "我把 Mr. Knott 的钥匙亮出来，压低声音说这可能阻止下一场悲剧；我接受失败时 Arty 会叫维护工把我赶出去。"},
        {"turn": "7a", "role": "player_simulator", "speaker": "Ada King", "mode": "meta", "intent": "ask pushed-roll ruling", "text": "[meta] 我想确认一下：为什么这里可以 pushed roll？失败后果是不是要先说清楚？[/meta]"},
        {"turn": "7b", "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "ruling": "pushed_roll_explanation", "text": "[meta] 可以，因为你不是重掷同一个动作，而是改变策略：亮出钥匙、强调可能阻止悲剧。失败后果会先摆明：阿蒂会叫维护工，你今天失去查档机会。确认后我们回到场景。[/meta]"},
        {"turn": 8, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_persuade", "text": "这构成 pushed Persuade。失败后果是，Arty 会叫来强壮的维护工，你今天彻底失去查档机会。"},
        {"turn": 9, "role": "system", "speaker": "system", "mode": "roll", "text": "Pushed Persuade 38 vs 55 -> regular_success."},
        {"turn": 10, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Arty 终于让开。Ruth Blake 带你进满是灰尘的 morgue，Handout 2 写着事故、疾病、自杀，以及 Macario 一家仓皇逃离。"},
        {"turn": 11, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "follow public record trail", "text": "我把剪报收好，下午去 Hall of Records，查 Walter Corbitt、遗嘱和任何教会记录。"},
        {"turn": 12, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "library_use_regular", "text": "做 Library Use。你的目标是把 Corbitt 和某个机构或遗嘱执行人联系起来，难度为 Regular。"},
        {"turn": 13, "role": "system", "speaker": "system", "mode": "roll", "text": "Library Use 22 vs 60 -> hard_success."},
        {"turn": 14, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Handout 7 把 Corbitt 的遗嘱执行人指向 Reverend Michael Thomas 和 Chapel of Contemplation。"},
        {"turn": 15, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "check sanitarium clue", "text": "在进屋前，我去 Roxbury Sanitarium，尽量温和地询问 Gabriela 和 Vittorio Macario 还记得什么。"},
        {"turn": 16, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "roleplay_no_roll", "text": "这里用角色扮演处理，不需要检定。Gabriela 说屋里有邪恶存在；Vittorio 抱着圣经，反复说恶魔会败在自己的武器下。"},
        {"turn": 17, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "investigate Chapel of Contemplation", "text": "我去废弃的 Chapel of Contemplation，先看三叉眼符号，再搜那只旧柜子附近。"},
        {"turn": 18, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "spot_hidden_regular", "text": "你看见围着眼睛的 three-Y symbol。要在柜子下面找到关键记录，做 Spot Hidden，Regular difficulty。"},
        {"turn": 19, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 28 vs 55 -> regular_success."},
        {"turn": 20, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "日志写着 Walter Corbitt 被埋在自家 basement；那本拉丁文书的边角让你意识到它明显是 Mythos material。"},
        {"turn": 21, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "enter the Old Corbitt Place", "text": "我打开 The Old Corbitt Place，先检查被钉死的门，再沿楼梯上去看 spare bedroom。"},
        {"turn": 22, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "haunting_scene", "text": "房子像是在阴影里向后缩。spare bedroom 里传来木头摩擦声，窗边的床猛地动了，Bed Attack 触发。"},
        {"turn": 23, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bed_attack_spot_hidden", "text": "先做 Spot Hidden，看你能不能在床撞过来之前察觉它的突然移动。"},
        {"turn": 24, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 47 vs 55 -> regular_success."},
        {"turn": 25, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bed_attack_dodge", "text": "你来得及反应，可以做 Dodge。失败的话，床会把你撞穿玻璃，造成 1D6+2 damage。"},
        {"turn": 26, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "伤害 5 HP；HP 12 -> 7。", "text": "Dodge 68 vs 25 -> failure. Damage: 5 HP. HP 12 -> 7."},
        {"turn": 27, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bed_attack_sanity", "text": "亲眼看见床自己动起来，需要 SAN 1/1D4。"},
        {"turn": 28, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "SAN 损失 3；SAN 55 -> 52。", "text": "SAN 74 vs 55 -> failure; SAN loss 3. SAN 55 -> 52."},
        {"turn": 29, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "continue to basement despite injury", "text": "我简单包扎手臂，虽然发抖，还是去 basement door，扶着墙慢慢往下走。"},
        {"turn": 30, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "combined_dex_climb", "text": "楼梯漆黑，而且脚下像活物一样挪动。做 DEX 或 Climb 的 combined roll。"},
        {"turn": 31, "role": "system", "speaker": "system", "mode": "roll", "text": "DEX/Climb 71 vs DEX 50 and Climb 20 -> failure."},
        {"turn": 32, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push basement descent", "text": "我想 push：我坐低身体，双手抓住扶手，一阶一阶挪下去；如果失败，我接受摔下楼梯的后果。"},
        {"turn": 33, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_dex_climb", "text": "接受 pushed roll。失败的话你会摔下去，受到 1D6 HP damage。"},
        {"turn": 34, "role": "system", "speaker": "system", "mode": "roll", "text": "Pushed DEX 44 vs 50 -> regular_success."},
        {"turn": 35, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "search basement clutter", "text": "我在 basement 的杂物里找和 chapel 或 Corbitt 有关的东西，尤其是像仪式用品或武器的物件。"},
        {"turn": 36, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "basement_spot_hidden", "text": "这是 Obscure clue。做 Spot Hidden；如果之后 push 且失败，尖锐碎片或那把刀可能会伤到你。"},
        {"turn": 37, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 88 vs 55 -> failure."},
        {"turn": 38, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push basement search", "text": "我脱下手套，用手摸进碎木和破布下面继续找；我知道失败时可能被割伤。"},
        {"turn": 39, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "伤害 4 HP；HP 7 -> 3。浮空匕首开始震动。", "text": "Pushed Spot Hidden 91 vs 55 -> failure. Damage: 4 HP. HP 7 -> 3. The Floating Knife stirs."},
        {"turn": 40, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "floating_knife_combat", "text": "The Floating Knife 从杂物里升起。combat round 开始；刀用 Corbitt 的 POW 发动攻击，Ada 可以 Dodge。"},
        {"turn": 41, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "SAN 损失 1；SAN 52 -> 51。", "text": "SAN 29 vs 52 -> success; SAN loss 1. SAN 52 -> 51."},
        {"turn": 42, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "outcome_note": "浮空匕首刺空。", "text": "Corbitt POW 34 vs 90 -> hard_success; Ada Dodge 18 vs 25 -> hard_success, so the knife misses."},
        {"turn": 43, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "grab the floating knife", "text": "我把外套甩向刀刃，想隔着布把 The Floating Knife 从半空按住。"},
        {"turn": 44, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "outcome_note": "艾达·金抓住了匕首。", "text": "Fighting Maneuver 12 vs 40 -> hard_success; Corbitt POW 92 vs 90 -> failure. Ada has the knife."},
        {"turn": 45, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "木板后面露出 Corbitt's Hiding Place，墙上刻着 Chapel of Contemplation 的字样。"},
        {"turn": 46, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "corbitt_sanity", "text": "Corbitt Attacks：尸体从木板床上坐起，皮肤像旧纸一样裂开。做 SAN 1/1D8。"},
        {"turn": 47, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "outcome_note": "SAN 损失 6；临时疯狂触发；Bout of Madness 持续 1D10 回合；1D10 掷出 4，所以持续 4 回合。", "text": "SAN 63 vs 51 -> failure; SAN loss 6. INT 35 vs 70 -> success, so temporary insanity occurs; Bout of Madness lasts 1D10 rounds; duration roll 4, so it lasts 4 rounds."},
        {"turn": 48, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "corbitt_combat_round", "text": "combat round 的行动顺序是 Ada DEX 50，然后 Corbitt DEX 35。Ada 尖叫着丢下左轮，但还死死抓着那把 dagger。"},
        {"turn": 49, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "attack Corbitt with his own weapon", "text": "Vittorio 的话突然对上了：用他自己的武器。我不退，拿 Corbitt 的 dagger 刺向他。"},
        {"turn": 50, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "科比特被自己的匕首摧毁。", "text": "Fighting (Brawl) 21 vs 40 -> regular_success. Corbitt is destroyed by his own dagger."},
        {"turn": 51, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Rewards：Corbitt 化成尘土，Mr. Knott 支付报酬和 30 美元奖金，Ada 恢复 4 SAN。Final HP: 3。Final SAN: 49。"},
    ], ZH_HANS_HAUNTING_GLOSSARY)

    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", _with_roll_localization([
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Persuade", "goal": "gain access to The Boston Globe clipping files from Arty Wilmot", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "Arty is an obstructive but ordinary editor, so the social skill check is Regular.", "roll": 72, "outcome": "failure", "push_eligible": True, "failure_consequence": "Arty refuses access unless Ada escalates with a pushed approach.", "skill_check_earned": False, "localized_text": {"zh-Hans": {"goal": "获得《波士顿环球报》剪报档案的查阅许可", "difficulty_rationale": "阿蒂·威尔莫特只是普通编辑，不是超自然威胁；这次社交检定按普通难度处理。", "failure_consequence": "艾达·金会被阿蒂拒绝；除非改变策略并承担推骰风险，否则无法进入剪报档案室。"}}}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Persuade", "goal": "gain access to The Boston Globe clipping files from Arty Wilmot", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The pushed roll keeps the same social difficulty after Ada changes pressure.", "roll": 38, "outcome": "regular_success", "pushed": True, "push_justification": "Ada shows Mr. Knott's keys and argues that access may prevent another tragedy.", "foreshadowed_failure": "On failure, Arty calls maintenance and Ada loses access to the morgue.", "failure_consequence": "Arty would call strong-armed maintenance men and bar Ada from the files.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Library Use", "goal": "connect Walter Corbitt to an executor and church records", "target": 60, "effective_target": 60, "difficulty": "regular", "difficulty_rationale": "The Hall of Records contains the entry, but it takes focused archive work.", "roll": 22, "outcome": "hard_success", "failure_consequence": "Ada would spend another half day and risk pressure from Mr. Knott.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "find the chapel journal under the ruined cabinet", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The journal is hidden under debris but can be found with a careful search.", "roll": 28, "outcome": "regular_success", "failure_consequence": "Ada would miss the explicit basement burial clue.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "notice the Bed Attack before impact", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The bed lurches suddenly, but a watchful investigator can react.", "roll": 47, "outcome": "regular_success", "failure_consequence": "Ada would have no chance to Dodge before the bed hit.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Dodge", "goal": "avoid being thrown through the spare bedroom window by the Bed Attack", "target": 25, "effective_target": 25, "difficulty": "regular", "difficulty_rationale": "Bed Attack allows a Dodge after the Spot Hidden success.", "roll": 68, "outcome": "failure", "failure_consequence": "Ada is thrown through glass and takes 1D6+2 damage.", "skill_check_earned": False}},
        {"type": "sanity", "actor": investigator_id, "payload": {"skill": "SAN", "goal": "withstand seeing the bed move of its own accord", "target": 55, "effective_target": 55, "difficulty": "sanity", "difficulty_rationale": "The Bed Attack calls for SAN 1/1D4.", "roll": 74, "outcome": "failure", "failure_consequence": "Ada loses 1D4 SAN.", "san_loss": 3}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "DEX/Climb", "goal": "descend the moving basement stairs", "target": 50, "effective_target": 50, "difficulty": "combined", "difficulty_rationale": "The rulebook treats the basement stairs as a combined DEX or Climb roll.", "roll": 71, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada must stop or push and risk a fall.", "skill_check_earned": False}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "DEX", "goal": "push through the dangerous basement descent", "target": 50, "effective_target": 50, "difficulty": "regular", "difficulty_rationale": "Ada changes tactics by sitting low and bracing on the rail.", "roll": 44, "outcome": "regular_success", "pushed": True, "push_justification": "Ada inches down while braced and accepts a fall if it goes wrong.", "foreshadowed_failure": "On failure, Ada falls down the stairs for 1D6 HP damage.", "failure_consequence": "Ada would fall and lose 1D6 HP.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "find Corbitt's blood-rusted dagger in basement clutter", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The knife is an Obscure clue hidden among dangerous clutter.", "roll": 88, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada misses the knife unless she risks a more dangerous search.", "skill_check_earned": False}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "find Corbitt's blood-rusted dagger in basement clutter", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The pushed search takes more time and exposes Ada to sharp debris.", "roll": 91, "outcome": "failure", "pushed": True, "push_justification": "Ada removes her gloves and searches by touch despite the risk.", "foreshadowed_failure": "On failure, Ada catches her hand on the possessed knife and takes automatic damage.", "failure_consequence": "Ada takes 1D4+2 HP damage from the knife.", "skill_check_earned": False}},
        {"type": "sanity", "actor": investigator_id, "payload": {"skill": "SAN", "goal": "withstand seeing The Floating Knife attack", "target": 52, "effective_target": 52, "difficulty": "sanity", "difficulty_rationale": "The Floating Knife calls for SAN 1/1D4.", "roll": 29, "outcome": "success", "failure_consequence": "Ada would lose 1D4 SAN.", "san_loss": 1}},
        {"type": "combat", "actor": corbitt_id, "payload": {"skill": "POW", "goal": "drive The Floating Knife into Ada", "target": 90, "effective_target": 90, "difficulty": "opposed", "difficulty_rationale": "The knife attacks using Corbitt's POW against Ada's Dodge.", "roll": 34, "outcome": "hard_success", "failure_consequence": "The knife would miss if Corbitt failed."}},
        {"type": "combat", "actor": investigator_id, "payload": {"skill": "Dodge", "goal": "avoid The Floating Knife", "target": 25, "effective_target": 25, "difficulty": "opposed", "difficulty_rationale": "Ada compares Dodge success level against Corbitt's POW success level.", "roll": 18, "outcome": "hard_success", "failure_consequence": "Ada would take 1D4+2 damage if Corbitt achieved the higher success level.", "skill_check_earned": True}},
        {"type": "combat", "actor": investigator_id, "payload": {"skill": "Fighting (Brawl)", "goal": "grab The Floating Knife with a coat-assisted fighting maneuver", "target": 40, "effective_target": 40, "difficulty": "opposed", "difficulty_rationale": "Grabbing the knife uses Fighting Maneuver rules against Corbitt's POW.", "roll": 12, "outcome": "hard_success", "failure_consequence": "The knife would remain free and continue attacking.", "skill_check_earned": True}},
        {"type": "combat", "actor": corbitt_id, "payload": {"skill": "POW", "goal": "resist Ada grabbing The Floating Knife", "target": 90, "effective_target": 90, "difficulty": "opposed", "difficulty_rationale": "Corbitt contests the maneuver with POW.", "roll": 92, "outcome": "failure", "failure_consequence": "Ada gains hold of the knife."}},
        {"type": "sanity", "actor": investigator_id, "payload": {"skill": "SAN", "goal": "withstand seeing Corbitt rise from the pallet", "target": 51, "effective_target": 51, "difficulty": "sanity", "difficulty_rationale": "Corbitt rising calls for SAN 1/1D8.", "roll": 63, "outcome": "failure", "failure_consequence": "Ada loses 1D8 SAN and may suffer temporary insanity.", "san_loss": 6}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "INT", "goal": "determine whether the 5+ SAN loss causes temporary insanity", "target": 70, "effective_target": 70, "difficulty": "regular", "difficulty_rationale": "After losing 5 or more SAN, a successful INT roll means Ada comprehends the horror.", "roll": 35, "outcome": "regular_success", "failure_consequence": "On failure, Ada would be shaken but not temporarily insane.", "skill_check_earned": False, "temporary_insanity_triggered": True}},
        {"type": "combat", "actor": investigator_id, "payload": {"skill": "Fighting (Brawl)", "goal": "stab Corbitt with his own dagger", "target": 40, "effective_target": 40, "difficulty": "regular", "difficulty_rationale": "Ada attacks with the seized dagger before Corbitt's DEX 35 action.", "roll": 21, "outcome": "regular_success", "failure_consequence": "Corbitt would take his action and continue the combat.", "skill_check_earned": True}},
    ]))

    _write_jsonl_localized(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "knott-hiring", "summary": "Mr. Knott 雇用 Ada，给出 Handout 1、钥匙和 20 美元预付款。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择先去 The Boston Globe 查剪报，而不是直接进入凶宅。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "第一次 Persuade 失败后，Ada 用 Mr. Knott 的钥匙向 Arty Wilmot 施压，并接受被赶出档案室的风险。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "handout-2", "summary": "Ada 在说服 Arty Wilmot 后取得 Handout 2，读到事故、疾病、自杀和 Macario 一家逃离的记录。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择沿着法律记录追查 Hall of Records。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "handout-7", "summary": "Ada 将 Walter Corbitt、Reverend Michael Thomas 和 Chapel of Contemplation 联系起来。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择进屋前先访问 Roxbury Sanitarium，追问 Macario 一家的经历。"}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "roxbury-sanitarium", "summary": "Gabriela 描述屋中的邪恶存在，Vittorio 给出 own-weapon clue。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择先调查 Chapel of Contemplation，再去面对那栋房子。"}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "chapel-of-contemplation", "summary": "Ada 调查 Chapel of Contemplation，看见 three-Y eye symbol。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "chapel-journal", "summary": "Ada 找到日志，确认 Walter Corbitt 被埋在自家 basement。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "确认地下室埋葬线索后，Ada 进入 The Old Corbitt Place。"}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "old-corbitt-place", "summary": "Ada 进入 The Old Corbitt Place，并探索 spare bedroom。"}},
        {"type": "damage", "actor": investigator_id, "payload": {"summary": "Bed Attack 造成 Damage: 5 HP；HP 12 -> 7。"}},
        {"type": "sanity", "actor": investigator_id, "payload": {"summary": "Ada 因 Bed Attack 失败 SAN 1/1D4，失去 3 SAN；SAN 55 -> 52。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Bed Attack 让 Ada 受伤后，她仍选择下地下室。"}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "basement", "summary": "Ada 通过 pushed DEX roll 下到会移动的 basement stairs。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 脱下手套用触摸继续搜索地下室杂物，接受受伤风险。"}},
        {"type": "damage", "actor": investigator_id, "payload": {"summary": "pushed basement search 失败造成 Damage: 4 HP；HP 7 -> 3。"}},
        {"type": "combat", "actor": "keeper_under_test", "payload": {"summary": "The Floating Knife 开始 combat round；Corbitt POW hard success 与 Ada Dodge hard success 打平，所以 Ada 避开攻击。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择用外套抓住 The Floating Knife，而不是逃跑。"}},
        {"type": "combat", "actor": investigator_id, "payload": {"summary": "Ada 用 coat-assisted Fighting Maneuver 抓住 The Floating Knife；Corbitt opposed POW 失败。"}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "corbitt-hiding-place", "summary": "Ada 在地下室木板后发现 Corbitt's Hiding Place。"}},
        {"type": "sanity", "actor": investigator_id, "payload": {"summary": "Corbitt 起身时 Ada 失败 SAN 1/1D8，失去 6 SAN，并因 INT 成功触发 temporary insanity。"}},
        {"type": "bout_of_madness", "actor": investigator_id, "payload": {"summary": "Bout of Madness：艾达·金在临时疯狂中把左轮丢到地下室角落；持续 1D10 回合；1D10 掷出 4，所以持续 4 回合；KP 暂时接管失控行为，只让她尖叫、防御和后退，直到维托里奥的提示让她重新抓住科比特匕首。", "duration_die": "1D10", "duration_roll": 4, "duration_rounds": 4}},
        {"type": "combat", "actor": "keeper_under_test", "payload": {"summary": "Corbitt Attacks in a combat round；DEX order 是 Ada 50 先于 Corbitt 35。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 相信 Vittorio 的提示，用 Corbitt 自己的匕首刺向他。"}},
        {"type": "combat", "actor": investigator_id, "payload": {"summary": "Ada 用 Corbitt 自己的 dagger 刺中他，在 Corbitt 行动前结束战斗。"}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "The Haunting does not include a required chase sequence（The Haunting 不包含必需追逐场景）；chase subsystem coverage deferred to separate scenario。"}},
        {"type": "status", "actor": investigator_id, "payload": {"summary": "Final HP: 3；Final SAN: 49；Rewards: +4 SAN、30 美元奖金，并可选择保留 worm-eaten book。"}},
        {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "Conclusion Rewards：Corbitt 被摧毁，Mr. Knott 支付报酬，后续冒险仍留下阴谋线索。"}},
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl_localized(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "Ada 接下 Mr. Knott 的委托，逼退 Arty Wilmot，追查到 Chapel of Contemplation，确认 Corbitt 的地下室埋葬线索，熬过 Bed Attack 和 The Floating Knife，并用 Corbitt 自己的 dagger 摧毁他。Final HP: 3；Final SAN: 49。",
        },
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl_localized(run_dir / "player-feedback.jsonl", [
        {"category": "kp_clarity", "score": 5, "text": "KP 在重要检定前说明了目标、风险和后果。"},
        {"category": "immersion", "score": 4, "text": "这场更像一连串调查选择和场景推进，而不是机械 checklist。"},
        {"category": "module_fidelity", "score": 4, "text": "这次跑团覆盖了 The Haunting 从 Mr. Knott 到 Rewards 的主要节点。"},
        {"category": "combat_readability", "score": 4, "text": "combat round 顺序、opposed rolls、damage 和 Corbitt 的败亡都能读懂。"},
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "rules_accuracy", "text": "Pushed rolls state changed tactics and foreshadowed consequences."},
        {"severity": "low", "category": "rules_accuracy", "text": "The Floating Knife uses opposed POW versus Dodge and a Fighting Maneuver to grab it."},
        {"severity": "low", "category": "state_integrity", "text": "HP, SAN, clues, scenes, combat, final status, memory, and feedback are recorded."},
        {"severity": "low", "category": "meta_quality", "text": "A meta-mode pushed-roll question pauses narration, explains the ruling, and returns to play."},
        {"severity": "medium", "category": "immersion", "text": "The scripted test compresses a full scenario and should later be replaced by an LLM-vs-KP interactive transcript."},
    ])

    generate_battle_report(run_dir)
    generate_evaluation_report(run_dir)
    generate_rulebook_audit(run_dir)
    return run_dir


def create_chase_drill_run(root: Path, run_id: str = "v3-chase-drill") -> Path:
    run_dir = root / ".coc" / "playtests" / run_id
    _clear_semantic_eval_artifacts(run_dir)
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / run_id
    scenario_dir = campaign_dir / "scenario"
    investigator_id = "ada-king-chase"
    pursuer_id = "nathaniel-crowe"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id

    _write_json(run_dir / "playtest.json", _with_play_language({
        "run_id": run_id,
        "campaign_id": run_id,
        "campaign_title": "Rooftop Chase Drill",
        "scenario": "Rooftop Chase Drill",
        "scenario_id": "rooftop-chase-drill",
        "audit_profile": "chase_drill",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "player_profile": "reckless_investigator",
        "module_coverage": [
            "chase_setup",
            "speed_roll",
            "location_chain",
            "movement_actions",
            "hazard",
            "barrier",
            "conflict",
            "escape_resolution",
        ],
        "subsystems_covered": ["investigation", "pushed_roll", "chase", "hazard", "barrier", "conflict"],
        "scores": {
            "immersion": 4,
            "rules_accuracy": 4,
            "state_integrity": 5,
            "spoiler_safety": 5,
            "meta_quality": 4,
            "pacing": 4,
            "chase_readability": 5,
        },
        "passed_test_cases": [
            "chase_setup",
            "speed_roll_mov_adjustment",
            "location_chain",
            "movement_action_economy",
            "hazard_resolution",
            "barrier_resolution",
            "conflict_during_chase",
            "escape_resolution",
        ],
        "failed_test_cases": [],
        "recommended_fixes": [
            "Future loop should turn this deterministic drill into an LLM-vs-KP chase with multiple player profiles.",
        ],
        "regression_tests": ["Chase drill audit must pass for a report with real chase state."],
    }, ZH_HANS_CHASE_GLOSSARY))
    _write_json(campaign_dir / "campaign.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "title": "Rooftop Chase Drill",
        "mode": "keeper",
        "status": "complete",
        "era": "1920s",
        "active_scenario_id": "rooftop-chase-drill",
        "active_scene_id": "quarry-escapes",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "active_subsystem": "chase",
    })
    _write_json(campaign_dir / "party.json", {
        "campaign_id": run_id,
        "investigator_ids": [investigator_id],
        "active_investigator_ids": [investigator_id],
    })
    _write_json(scenario_dir / "scenario.json", {
        "schema_version": 1,
        "scenario_id": "rooftop-chase-drill",
        "title": "Rooftop Chase Drill",
        "module_source": "internal drill based on Keeper Rulebook Chapter 7: Chases",
        "summary": "Ada steals a cult ledger and flees across rainy Boston rooftops while Nathaniel Crowe pursues her.",
        "player_safe_summary": "Ada must escape a pursuer after finding a stolen cult ledger.",
        "opening_scene": "Ada King 发现 Nathaniel Crowe 带着 ledger 离开印刷店，并跟着他上到屋顶。",
        "current_phase": "quarry_escapes",
    })
    _write_json(scenario_dir / "clues.json", [
        {"id": "ledger-clue", "summary": "The ledger names a warehouse where the cult stores ritual supplies.", "route": "Spot Hidden at the print shop."},
    ])
    _write_json(scenario_dir / "locations.json", [
        {"id": "print-shop-roof", "name": "Print Shop Roof", "purpose": "chase start"},
        {"id": "rain-gutter", "name": "Rain Gutter", "purpose": "opening gap"},
        {"id": "slick-skylight", "name": "Slick Skylight", "purpose": "Regular hazard"},
        {"id": "locked-roof-door", "name": "Locked Roof Door", "purpose": "barrier"},
        {"id": "laundry-roof", "name": "Laundry Roof", "purpose": "escape and hide"},
    ])
    _write_json(scenario_dir / "npcs.json", [
        {"id": pursuer_id, "name": "Nathaniel Crowe", "role": "cult courier and pursuer"},
    ])
    _write_json(scenario_dir / "timeline.json", [
        {"id": "ledger-stolen", "summary": "Nathaniel steals the ledger from the print shop safe."},
        {"id": "roof-chase", "summary": "Ada becomes the quarry when Nathaniel spots her with the ledger."},
    ])
    _write_json(scenario_dir / "handouts.json", [
        {"id": "ledger-handout", "title": "Cult warehouse ledger"},
    ])
    _write_json(scenario_dir / "keeper-secrets.json", [
        {"id": "secret-warehouse", "summary": "The warehouse contains ritual supplies for a later scenario."},
    ])
    _write_json(investigator_dir / "character.json", {
        "schema_version": 1,
        "id": investigator_id,
        "name": "Ada King",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
            "LUCK": 55,
        },
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 8,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": {
            "Climb": 40,
            "Dodge": 35,
            "Fighting (Brawl)": 40,
            "Locksmith": 30,
            "Spot Hidden": 55,
            "Stealth": 45,
        },
        "backstory": {
            "description": "艾达·金追查一批流入黑市的旧账本，因此学会在屋顶和后巷保持距离。",
            "ideology_beliefs": ["线索必须在行动前被核实，但危险临近时也要果断撤离。"],
            "significant_people": ["莱兰·哈特教授，她已故的导师，常提醒她别让好奇心跑在证据前面。"],
            "meaningful_locations": ["印刷店屋顶，她第一次意识到档案线索也会引来追赶者。"],
            "treasured_possessions": ["裂柄铜放大镜。"],
            "traits": ["观察细致", "遇到追逐时会先找遮蔽物和退路"],
        },
    })
    _write_investigator_chronicle(
        investigator_dir,
        [
            {
                "schema_version": 1,
                "type": "scenario_experience",
                "campaign_id": run_id,
                "scenario_id": "rooftop-chase-drill",
                "summary": "艾达·金带着邪教账本逃脱；最终 HP: 12；最终 SAN: 55。",
                "final_hp": 12,
                "final_san": 55,
                "notable_events": ["在印刷店屋顶确认账本", "穿过湿滑天窗危险点", "通过上锁屋顶门并甩开追赶者"],
                "unresolved_threads": ["邪教账本可指向后续仓库调查"],
            }
        ],
        [
            {
                "schema_version": 1,
                "type": "development_phase_summary",
                "campaign_id": run_id,
                "status": "pending_player_rolls",
                "skill_checks_earned": ["Spot Hidden", "Dodge", "Locksmith", "Stealth"],
                "rewards": ["保留邪教账本线索"],
                "permanent_changes": ["记录屋顶追逐经验"],
                "carryover_notes": "账本线索可带入后续模组；结算成长检定后再导入长期角色卡。",
            }
        ],
    )
    _write_json(campaign_dir / "save" / "chase.json", {
        "schema_version": 1,
        "chase_id": "rooftop-chase",
        "status": "resolved",
        "round": 2,
        "participants": [
            {
                "id": investigator_id,
                "name": "Ada King",
                "role": "quarry",
                "base_mov": 8,
                "adjusted_mov": 8,
                "dex": 50,
                "movement_actions": 1,
                "position": "laundry-roof",
            },
            {
                "id": pursuer_id,
                "name": "Nathaniel Crowe",
                "role": "pursuer",
                "base_mov": 8,
                "adjusted_mov": 9,
                "dex": 60,
                "movement_actions": 2,
                "position": "locked-roof-door",
            },
        ],
        "dex_order": [pursuer_id, investigator_id],
        "location_chain": [
            {"id": "print-shop-roof", "label": "start"},
            {"id": "rain-gutter", "label": "clear"},
            {"id": "slick-skylight", "label": "hazard", "difficulty": "regular", "skill": "Dodge"},
            {"id": "locked-roof-door", "label": "barrier", "difficulty": "regular", "skill": "Locksmith"},
            {"id": "laundry-roof", "label": "escape"},
        ],
        "rounds": [
            {
                "round": 1,
                "summary": "Nathaniel has two movement actions and closes from two locations behind to one location behind; Ada spends one action crossing the slick skylight hazard.",
                "localized_text": {
                    "zh-Hans": {
                        "summary": "内森尼尔·克劳有 2 个移动行动，从落后两个位置缩短到落后一个位置；艾达·金花费 1 个行动穿过湿滑天窗危险点。"
                    }
                },
            },
            {
                "round": 2,
                "summary": "Nathaniel spends one movement action to attack in conflict; Ada Dodges, opens the locked roof door barrier, hides on the laundry roof, and the quarry escapes.",
                "localized_text": {
                    "zh-Hans": {
                        "summary": "内森尼尔·克劳花费 1 个移动行动发动追逐冲突；艾达·金 Dodge、打开上锁屋顶门障碍并躲进晾衣屋顶，被追者逃脱。"
                    }
                },
            },
        ],
        "outcome": "quarry escapes",
    })

    _write_transcript_jsonl_localized(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "雨点像针一样打在印刷店屋顶上。Nathaniel Crowe 把 cult ledger 塞在外套里，正朝屋脊另一侧退。"},
        {"turn": 2, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "spot the stolen ledger", "text": "我先不暴露自己，压低身体看他的外套，确认他是不是带着那本 ledger。"},
        {"turn": 3, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "spot_hidden_regular", "text": "做 Spot Hidden。目标是在 Nathaniel 发现你之前确认 ledger，难度 Regular。"},
        {"turn": 4, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 82 vs 55 -> failure."},
        {"turn": 5, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push ledger confirmation", "text": "我想 push：我探身越过 skylight 多看一眼，接受失败时他会直接发现我。"},
        {"turn": 6, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_spot_hidden", "text": "可以 pushed roll。失败的话 Nathaniel 会看见你，chase 开始时双方没有距离差。"},
        {"turn": 7, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "艾达·金看见账本；内森尼尔·克劳听见屋瓦移动。", "text": "Pushed Spot Hidden 33 vs 55 -> regular_success. Ada sees the ledger, but Nathaniel hears the roof tile shift."},
        {"turn": 8, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "chase_setup", "text": "Nathaniel 猛地扑向你。你现在是 quarry，他是 pursuer。我们做 speed roll checks 来建立 chase。"},
        {"turn": 9, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "MOV 保持 8。", "text": "Ada CON speed roll 42 vs 55 -> success; MOV remains 8."},
        {"turn": 10, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "MOV 从 8 升到 9。", "text": "Nathaniel CON speed roll 9 vs 50 -> extreme_success; MOV rises from 8 to 9."},
        {"turn": 11, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "cut_to_chase", "text": "因为 pursuer 的 adjusted MOV 不低于 quarry，chase 成立。我切到追逐场面：Nathaniel 暂时落后你 two locations。"},
        {"turn": 12, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "location_chain", "text": "location chain 是 print-shop roof、rain gutter、slick skylight hazard、locked roof door barrier、laundry roof。DEX order 是 Nathaniel 60，然后 Ada 50。"},
        {"turn": 13, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "movement_actions", "text": "Ada 有 1 movement action。Nathaniel 的 adjusted MOV 比最慢参与者高 1，所以他有 2 movement actions。"},
        {"turn": 14, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "cross hazard", "text": "我抱紧 ledger，冲过湿滑的 skylight，往 roof door 那边跑。"},
        {"turn": 15, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "hazard_dodge", "text": "这是 hazard，用 Dodge，Regular difficulty。chase 内部不使用 pushed rolls。"},
        {"turn": 16, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "艾达·金穿过湿滑天窗危险点。", "text": "Dodge 24 vs 35 -> regular_success. Ada crosses the slick skylight hazard."},
        {"turn": 17, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "conflict", "text": "Nathaniel 花 movement actions 追上来，抡起短棍砸向你。这个 conflict 消耗他一个 movement action。"},
        {"turn": 18, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "outcome_note": "内森尼尔·克劳的短棍攻击落空。", "text": "Ada Dodge 19 vs 35 -> regular_success; Nathaniel Fighting 62 vs 45 -> failure."},
        {"turn": 19, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "pass barrier and hide", "text": "我把偷来的 key ring 插进 locked roof door barrier，挤过去后立刻钻进 laundry sheets 之间躲起来。"},
        {"turn": 20, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 3, "outcome_note": "艾达·金带着账本逃脱。", "text": "Locksmith 21 vs 30 -> regular_success. Stealth 18 vs 45 -> hard_success. Nathaniel Spot Hidden 77 vs 40 -> failure."},
        {"turn": 21, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "quarry escapes。Nathaniel 从 laundry roof 另一头冲过去，没有看见你；Ada 抱着 ledger，听见脚步声渐渐落到楼下。"},
    ], ZH_HANS_CHASE_GLOSSARY)
    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", _with_roll_localization([
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "confirm Nathaniel has the cult ledger before acting", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The ledger is partly visible under Nathaniel's coat.", "roll": 82, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada cannot confirm the ledger without risking detection.", "skill_check_earned": False, "localized_text": {"zh-Hans": {"goal": "确认内森尼尔·克劳行动前是否带着邪教账本", "difficulty_rationale": "账本只从内森尼尔·克劳的外套下露出一角，需要仔细观察。", "failure_consequence": "艾达·金无法确认账本，除非冒着被发现的风险继续观察。"}}}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "confirm Nathaniel has the cult ledger before acting", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "Ada changes position for a better angle, keeping the same difficulty.", "roll": 33, "outcome": "regular_success", "pushed": True, "push_justification": "Ada leans over the skylight for a better look and accepts being noticed.", "foreshadowed_failure": "On failure, Nathaniel sees Ada and starts the chase with no gap.", "failure_consequence": "Nathaniel would begin the chase at the same location as Ada.", "skill_check_earned": True}},
        {"type": "chase", "actor": investigator_id, "payload": {"skill": "CON", "goal": "speed roll to establish Ada's adjusted MOV for the chase", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "On-foot chases use CON as the speed roll.", "roll": 42, "outcome": "success", "failure_consequence": "Ada's MOV would drop by 1 for this chase.", "skill_check_earned": False, "localized_text": {"zh-Hans": {"goal": "用速度检定确定艾达·金在本次追逐中的调整后 MOV", "difficulty_rationale": "步行追逐使用 CON 作为速度检定。", "failure_consequence": "艾达·金的 MOV 会在本次追逐中降低 1。"}}}},
        {"type": "chase", "actor": pursuer_id, "payload": {"skill": "CON", "goal": "speed roll to establish Nathaniel's adjusted MOV for the chase", "target": 50, "effective_target": 50, "difficulty": "regular", "difficulty_rationale": "On-foot chases use CON as the speed roll.", "roll": 9, "outcome": "extreme_success", "failure_consequence": "Nathaniel's MOV would drop by 1 for this chase.", "localized_text": {"zh-Hans": {"goal": "用速度检定确定内森尼尔·克劳在本次追逐中的调整后 MOV", "difficulty_rationale": "步行追逐使用 CON 作为速度检定。", "failure_consequence": "内森尼尔·克劳的 MOV 会在本次追逐中降低 1。"}}}},
        {"type": "chase", "actor": investigator_id, "payload": {"skill": "Dodge", "goal": "negotiate the slick skylight hazard", "target": 35, "effective_target": 35, "difficulty": "regular", "difficulty_rationale": "The skylight is a Regular foot-chase hazard.", "roll": 24, "outcome": "regular_success", "failure_consequence": "Ada would lose 1D3 movement actions and risk falling glass damage.", "skill_check_earned": True, "localized_text": {"zh-Hans": {"goal": "越过湿滑天窗危险点", "difficulty_rationale": "湿滑天窗是普通难度的步行追逐危险点。", "failure_consequence": "艾达·金会失去 1D3 次移动行动，并冒着被碎玻璃伤到的风险。"}}}},
        {"type": "chase", "actor": investigator_id, "payload": {"skill": "Dodge", "goal": "avoid Nathaniel's sap during chase conflict", "target": 35, "effective_target": 35, "difficulty": "regular", "difficulty_rationale": "Conflict during a chase can be resolved with normal attack and Dodge rolls.", "roll": 19, "outcome": "regular_success", "failure_consequence": "Ada would take damage and lose momentum.", "skill_check_earned": True}},
        {"type": "chase", "actor": pursuer_id, "payload": {"skill": "Fighting (Brawl)", "goal": "strike Ada with a sap during chase conflict", "target": 45, "effective_target": 45, "difficulty": "regular", "difficulty_rationale": "An attack during a chase costs one movement action.", "roll": 62, "outcome": "failure", "failure_consequence": "Ada slips past the attack."}},
        {"type": "chase", "actor": investigator_id, "payload": {"skill": "Locksmith", "goal": "pass the locked roof door barrier", "target": 30, "effective_target": 30, "difficulty": "regular", "difficulty_rationale": "The locked roof door is a Regular barrier with the stolen key ring.", "roll": 21, "outcome": "regular_success", "failure_consequence": "The barrier would stop Ada's movement until another method succeeded.", "skill_check_earned": True}},
        {"type": "chase", "actor": investigator_id, "payload": {"skill": "Stealth", "goal": "hide on the laundry roof after passing the barrier", "target": 45, "effective_target": 45, "difficulty": "regular", "difficulty_rationale": "Ada has a brief lead and concealment among laundry sheets.", "roll": 18, "outcome": "hard_success", "failure_consequence": "Nathaniel would keep the chase active.", "skill_check_earned": True}},
        {"type": "chase", "actor": pursuer_id, "payload": {"skill": "Spot Hidden", "goal": "find Ada after she hides", "target": 40, "effective_target": 40, "difficulty": "regular", "difficulty_rationale": "The pursuer searches the laundry roof after losing line of sight.", "roll": 77, "outcome": "failure", "failure_consequence": "The quarry escapes.", "localized_text": {"zh-Hans": {"goal": "在艾达·金躲藏后重新找到她", "difficulty_rationale": "追赶者在失去视线后搜索晾衣屋顶。", "failure_consequence": "被追者逃脱。"}}}},
    ]))
    _write_jsonl_localized(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "print-shop-roof", "summary": "Ada 在 print shop roof 发现 Nathaniel Crowe，确认他带着 cult ledger。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 冒着被发现的风险继续观察，确认 Nathaniel 是否带着 ledger。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "ledger-clue", "summary": "Ada 确认 cult ledger，并在 chase 后保住这条线索。"}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "speed roll setup：Ada CON 成功保持 MOV 8；Nathaniel CON extreme success 让 MOV 8 升到 MOV 9，因此 pursuer 可以 establish the chase。"}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "location chain：print-shop roof -> rain gutter -> slick skylight hazard -> locked roof door barrier -> laundry roof；DEX order 是 Nathaniel 60，然后 Ada 50。"}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "movement actions：Ada 有 1 movement action；Nathaniel 因 adjusted MOV 比最慢者高 1，拥有 2 movement actions。"}},
        {"type": "chase", "actor": investigator_id, "payload": {"summary": "hazard：Ada 的 Dodge 成功，穿过 slick skylight 且没有损失 movement actions。"}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "conflict：Nathaniel 花一个 movement action 用短棍攻击；Ada Dodge 成功，攻击落空。"}},
        {"type": "chase", "actor": investigator_id, "payload": {"summary": "barrier：Ada 用 Locksmith 通过 locked roof door barrier，到达 laundry roof。"}},
        {"type": "chase", "actor": investigator_id, "payload": {"summary": "quarry escapes：Ada 的 Stealth 胜过 Nathaniel 失败的 Spot Hidden，带着 ledger 结束 chase。"}},
        {"type": "status", "actor": investigator_id, "payload": {"summary": "Final chase state：Ada 保持 HP 12、SAN 55、MOV 8，并带走 cult ledger；Nathaniel 落后一处 location。"}},
        {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "quarry escapes 后 session ended，chase state 已保存到 save/chase.json。"}},
    ], ZH_HANS_CHASE_GLOSSARY)
    _write_jsonl_localized(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "Ada 确认 Nathaniel 带着 ledger，随后成为 rooftop chase 的 quarry；她穿过 hazard 和 barrier，躲过 chase conflict，藏进 laundry roof，最终带着线索逃脱。",
        },
    ], ZH_HANS_CHASE_GLOSSARY)
    _write_jsonl_localized(run_dir / "player-feedback.jsonl", [
        {"category": "kp_clarity", "score": 5, "text": "KP 清楚解释了 speed roll、MOV、movement actions、hazard、barrier 和结果。"},
        {"category": "chase_readability", "score": 5, "text": "我能看懂每个人在 location chain 的位置，也知道 quarry 为什么 escapes。"},
        {"category": "immersion", "score": 4, "text": "追逐保持紧张感，同时没有把 rule decisions 藏起来。"},
    ], ZH_HANS_CHASE_GLOSSARY)
    _write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "rules_accuracy", "text": "Chase setup includes speed roll, MOV adjustment, location chain, DEX order, and movement actions."},
        {"severity": "low", "category": "state_integrity", "text": "save/chase.json records participants, location chain, rounds, and outcome."},
        {"severity": "low", "category": "immersion", "text": "The drill is deterministic but reads as a coherent chase scene."},
    ])

    generate_battle_report(run_dir)
    generate_evaluation_report(run_dir)
    generate_rulebook_audit(run_dir)
    return run_dir


def create_multi_profile_pressure_run(root: Path, run_id: str = "v4-multi-profile-pressure") -> Path:
    run_dir = root / ".coc" / "playtests" / run_id
    _clear_semantic_eval_artifacts(run_dir)
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / run_id
    scenario_dir = campaign_dir / "scenario"
    investigator_id = "ada-king-pressure"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id
    player_profiles = ["careful_investigator", "reckless_investigator", "skeptical_rules_lawyer"]
    player_profile_labels = {
        "zh-Hans": {
            "careful_investigator": "谨慎调查员",
            "reckless_investigator": "鲁莽调查员",
            "skeptical_rules_lawyer": "规则质疑玩家",
        }
    }

    _write_json(run_dir / "playtest.json", _with_play_language({
        "run_id": run_id,
        "campaign_id": run_id,
        "campaign_title": "Keeper Multi-Profile Pressure Test",
        "scenario": "The Haunting Opening Pressure Matrix",
        "scenario_id": "haunting-opening-pressure",
        "module_source": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf",
        "audit_profile": "multi_profile_pressure",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "player_profile": "multi_profile_matrix",
        "player_profiles_tested": player_profiles,
        "player_profile_labels": player_profile_labels,
        "module_coverage": ["opening_hook", "research_choice", "reckless_entry", "rules_challenge", "session_wrap"],
        "subsystems_covered": ["investigation", "social", "pushed_roll", "meta_game"],
        "scores": {
            "immersion": 4,
            "rules_accuracy": 4,
            "state_integrity": 4,
            "spoiler_safety": 5,
            "meta_quality": 5,
            "pacing": 4,
            "virtual_player_pressure": 5,
        },
        "passed_test_cases": [
            "multi_profile_turns",
            "careful_research_route",
            "reckless_risk_route",
            "skeptical_meta_challenge",
            "pushed_roll_stakes",
            "profile_specific_feedback",
        ],
        "failed_test_cases": [],
        "recommended_fixes": [],
        "regression_tests": ["Multi-profile pressure run must preserve distinct virtual player labels in battle reports."],
    }, ZH_HANS_HAUNTING_GLOSSARY))
    _write_json(campaign_dir / "campaign.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "title": "Keeper Multi-Profile Pressure Test",
        "mode": "keeper",
        "status": "complete",
        "era": "1920s",
        "active_scenario_id": "haunting-opening-pressure",
        "active_scene_id": "opening-pressure-wrap",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "active_subsystem": "meta_game",
        "player_profiles_tested": player_profiles,
    })
    _write_json(campaign_dir / "party.json", {
        "campaign_id": run_id,
        "investigator_ids": [investigator_id],
        "active_investigator_ids": [investigator_id],
    })
    _write_json(scenario_dir / "scenario.json", {
        "schema_version": 1,
        "scenario_id": "haunting-opening-pressure",
        "title": "The Haunting Opening Pressure Matrix",
        "module_source": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf",
        "summary": "Three virtual player profiles pressure-test the Keeper's opening handling for The Haunting.",
        "player_safe_summary": "Mr. Knott hires Ada King to inspect the Corbitt House, while different player styles ask for research, risk, and rule clarity.",
        "opening_scene": "诺特先生将科比特宅邸的钥匙放在桌上，等待艾达·金决定先调查还是直接进屋。",
        "current_phase": "opening_pressure",
    })
    _write_json(scenario_dir / "clues.json", [
        {"id": "handout-1", "summary": "Mr. Knott gives the address, keys, $20 advance, and the research premise.", "route": "opening"},
        {"id": "deed-note", "summary": "City records point toward Walter Corbitt and the Chapel of Contemplation.", "route": "careful research route"},
    ])
    _write_json(scenario_dir / "locations.json", [
        {"id": "knott-office", "name": "Mr. Knott's office", "purpose": "opening hook"},
        {"id": "records-room", "name": "Hall of Records", "purpose": "careful research pressure"},
        {"id": "corbitt-house-front", "name": "The Old Corbitt Place", "purpose": "reckless entry pressure"},
    ])
    _write_json(scenario_dir / "npcs.json", [
        {"id": "npc-knott", "name": "Mr. Knott", "role": "landlord and client"},
        {"id": "npc-clerk", "name": "records clerk", "role": "ordinary obstacle to public records"},
    ])
    _write_json(scenario_dir / "timeline.json", [
        {"id": "opening-hire", "summary": "Mr. Knott hires Ada to investigate the Corbitt House."},
        {"id": "pressure-branch", "summary": "Careful, reckless, and skeptical player profiles test different Keeper responses."},
    ])
    _write_json(scenario_dir / "handouts.json", [
        {"id": "handout-1", "title": "Mr. Knott's job"},
        {"id": "deed-note", "title": "Records lead"},
    ])
    _write_json(scenario_dir / "keeper-secrets.json", [
        {"id": "secret-corbitt-body", "summary": "Walter Corbitt's body persists in the basement."},
    ])
    _write_json(investigator_dir / "character.json", {
        "schema_version": 1,
        "id": investigator_id,
        "name": "Ada King",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
            "LUCK": 55,
        },
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 8,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": {
            "Library Use": 60,
            "Locksmith": 30,
            "Persuade": 55,
            "Spot Hidden": 55,
        },
        "backstory": {
            "description": "艾达·金是一名被多次委托调查旧宅纠纷的古物学者，擅长把传言拆成可查证的线索。",
            "ideology_beliefs": ["公开记录比传闻可靠，但传闻常常指向被隐藏的入口。"],
            "significant_people": ["莱兰·哈特教授，她已故的导师，留下了一套严谨的调查笔记法。"],
            "meaningful_locations": ["波士顿档案馆阅览室，她在那里学会从房契边注寻找异常。"],
            "treasured_possessions": ["裂柄铜放大镜。"],
            "traits": ["谨慎记笔记", "愿意听完同伴的鲁莽想法再提出风险"],
        },
    })
    _write_investigator_chronicle(
        investigator_dir,
        [
            {
                "schema_version": 1,
                "type": "scenario_experience",
                "campaign_id": run_id,
                "scenario_id": "the-haunting-opening-pressure",
                "summary": "艾达·金经历了三种玩家风格压测，确认公开记录、鲁莽进屋和规则质疑都能进入同一故事。",
                "final_hp": 12,
                "final_san": 55,
                "notable_events": ["谨慎路线找到科比特与沉思教堂线索", "鲁莽路线通过推骰发现新划痕", "meta 质疑获得独立规则解释"],
                "unresolved_threads": ["后续故事入口保留为沉思教堂记录"],
            }
        ],
        [
            {
                "schema_version": 1,
                "type": "development_phase_summary",
                "campaign_id": run_id,
                "status": "pending_player_rolls",
                "skill_checks_earned": ["Library Use", "Spot Hidden"],
                "rewards": ["保留三种玩家画像的 KP 裁定记录"],
                "permanent_changes": ["记录科比特宅邸开局调查路线"],
                "carryover_notes": "后续故事入口保留为沉思教堂记录；导入正式战役前由玩家选择采用哪条路线为正史。",
            }
        ],
    )
    _write_transcript_jsonl_localized(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "诺特先生把钥匙和预付款放在桌上，说明科比特宅邸又把房客吓跑了。"},
        {"turn": 2, "role": "player_simulator", "speaker": "Careful Player", "player_profile": "careful_investigator", "mode": "play", "intent": "request careful research route", "text": "我先查房契和旧报纸，不急着进屋；我想知道公开记录里有没有科比特或教堂线索。"},
        {"turn": 3, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "library_use_regular", "text": "可以。这个路线用 Library Use，普通难度；成功会给你进屋前的线索，失败则会多花半天。"},
        {"turn": 4, "role": "system", "speaker": "system", "mode": "roll", "text": "Library Use 29 vs 60 -> hard_success."},
        {"turn": 5, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "你在档案馆找到房契旁注：沃尔特·科比特与沉思教堂有联系。"},
        {"turn": 6, "role": "player_simulator", "speaker": "Reckless Player", "player_profile": "reckless_investigator", "mode": "play", "intent": "rush into danger", "text": "我直接去二楼，拿钥匙开门进去，不等其他调查。"},
        {"turn": 7, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "spot_hidden_regular", "text": "可以直接行动，但这会让你少拿一部分准备信息。先做 Spot Hidden，普通难度，看你是否注意到门框内侧的新划痕。"},
        {"turn": 8, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 84 vs 55 -> failure."},
        {"turn": 9, "role": "player_simulator", "speaker": "Reckless Player", "player_profile": "reckless_investigator", "mode": "play", "intent": "push reckless entry", "text": "我推骰：把手电贴近门缝，再冒险伸手摸门闩；如果失败，我接受惊动屋内东西的后果。"},
        {"turn": 10, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_spot_hidden", "text": "这是有效推骰，因为你改变了方法并承担更大风险。失败后果是屋内的动静会先一步锁定你。"},
        {"turn": 11, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "你看见门闩边缘有新划痕，没有触发额外危险。", "text": "Pushed Spot Hidden 22 vs 55 -> hard_success."},
        {"turn": 12, "role": "player_simulator", "speaker": "Skeptical Player", "player_profile": "skeptical_rules_lawyer", "mode": "meta", "intent": "challenge keeper ruling", "text": "[meta] 我想质疑一下：谨慎玩家查资料、鲁莽玩家直接进屋，为什么 KP 给的是不同检定和风险？[/meta]"},
        {"turn": 13, "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "ruling": "profile_pressure_explanation", "text": "[meta] 规则裁定：检定不是惩罚玩家风格，而是根据行动方式和风险来定。谨慎路线用 Library Use 获取线索；鲁莽路线也允许，但信息少、后果更近。推骰前我必须先说明失败代价。[/meta]"},
        {"turn": 14, "role": "player_simulator", "speaker": "Careful Player", "player_profile": "careful_investigator", "mode": "play", "intent": "use clue to shape plan", "text": "那我把档案线索告诉大家，建议先找沉思教堂的记录，再决定是否进地下室。"},
        {"turn": 15, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "session_wrap", "text": "本轮压测到这里结束：KP 保留三个玩家画像的选择、风险和规则质疑，并把后续入口记录到战役记忆。"},
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", _with_roll_localization([
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Library Use", "goal": "research deed and newspaper records before entering the house", "target": 60, "effective_target": 60, "difficulty": "regular", "difficulty_rationale": "Public records can reveal a useful lead with focused archive work.", "roll": 29, "outcome": "hard_success", "failure_consequence": "Ada would spend half a day and enter the house with fewer leads.", "skill_check_earned": True, "localized_text": {"zh-Hans": {"goal": "进屋前查房契和旧报纸记录", "difficulty_rationale": "公开记录能通过专注查档找到有用线索。", "failure_consequence": "艾达·金会多花半天，并带着更少线索进屋。"}}}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "notice fresh marks before reckless entry", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The marks are visible only if the investigator slows down at the door.", "roll": 84, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada misses the warning and risks entering without preparation.", "skill_check_earned": False, "localized_text": {"zh-Hans": {"goal": "鲁莽进屋前注意到新划痕", "difficulty_rationale": "只有在门口稍作停顿才能看到这些痕迹。", "failure_consequence": "艾达·金会错过警告，冒着准备不足的风险进屋。"}}}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "push the door inspection by checking the latch by touch", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The pushed approach changes method by touching the latch and accepting immediate risk.", "roll": 22, "outcome": "hard_success", "pushed": True, "push_justification": "Ada moves the flashlight close and reaches into the door gap by touch.", "foreshadowed_failure": "On failure, the house notices Ada first.", "failure_consequence": "Ada would trigger a noise inside the house before she could warn the others.", "skill_check_earned": True, "localized_text": {"zh-Hans": {"goal": "用触摸门闩的方式推骰检查门口", "difficulty_rationale": "推骰方法改变为触摸门闩，并接受即时风险。", "push_justification": "艾达·金把手电贴近门缝，伸手摸向门闩。", "foreshadowed_failure": "若失败，屋内的东西会先注意到艾达·金。", "failure_consequence": "艾达·金会在警告同伴前先触发屋内动静。"}}}},
    ]))
    _write_jsonl_localized(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "knott-office", "summary": "诺特先生给出钥匙、预付款和科比特宅邸的委托。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "谨慎玩家选择先查房契和旧报纸，避免无准备进屋。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "deed-note", "summary": "艾达·金发现沃尔特·科比特与沉思教堂有关。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "鲁莽玩家选择直接进二楼，并在失败后接受更危险的推骰。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "规则质疑玩家用 meta 模式要求 KP 解释不同玩家风格对应的检定和风险。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "fresh-scratches", "summary": "推骰成功后，艾达·金看见门闩边缘的新划痕。"}},
        {"type": "status", "actor": investigator_id, "payload": {"summary": "三个玩家画像都保留了有效选择；KP 已说明不同路线的收益、风险和失败后果。"}},
        {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "多玩家画像压测结束，后续入口记录为先追查沉思教堂，再决定是否进入科比特宅邸深处。"}},
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl_localized(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "三个玩家画像压测同一 KP：谨慎玩家先查公开记录，鲁莽玩家直接进屋并推骰，规则质疑玩家要求解释裁定。KP 分别给出风险、失败后果和后续路线。",
        },
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl_localized(run_dir / "player-feedback.jsonl", [
        {"player_profile": "careful_investigator", "category": "kp_clarity", "score": 5, "text": "KP 允许我先调查，并说明成功和失败会怎样改变进屋准备。"},
        {"player_profile": "reckless_investigator", "category": "agency", "score": 4, "text": "KP 没有阻止我冒险，但把更近的风险说清楚了。"},
        {"player_profile": "skeptical_rules_lawyer", "category": "meta_quality", "score": 5, "text": "KP 清楚解释了为什么不同做法对应不同检定和失败后果。"},
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "rules_accuracy", "text": "Different player styles receive rulings based on fictional positioning and stated risk."},
        {"severity": "low", "category": "meta_quality", "text": "The skeptical profile challenges a ruling in meta mode and receives a separated explanation."},
        {"severity": "low", "category": "immersion", "text": "The run remains a compact pressure test rather than a full module session, but it exercises multiple virtual player styles."},
    ])

    generate_battle_report(run_dir)
    generate_evaluation_report(run_dir)
    generate_rulebook_audit(run_dir)
    return run_dir


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--run-id", default="v1-rulebook-smoke")
    parser.add_argument(
        "--profile",
        choices=["rulebook-smoke", "haunting-module", "chase-drill", "multi-profile-pressure"],
        default="rulebook-smoke",
    )
    args = parser.parse_args()
    if args.profile == "chase-drill":
        run_dir = create_chase_drill_run(Path(args.root), args.run_id)
    elif args.profile == "multi-profile-pressure":
        run_dir = create_multi_profile_pressure_run(Path(args.root), args.run_id)
    elif args.profile == "haunting-module":
        run_dir = create_haunting_module_run(Path(args.root), args.run_id)
    else:
        run_dir = create_rulebook_smoke_run(Path(args.root), args.run_id)
    print(run_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
