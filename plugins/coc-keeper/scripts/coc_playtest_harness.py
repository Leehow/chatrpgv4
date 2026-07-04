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
from coc_playtest_report import (
    _display_transcript_speaker,
    _display_transcript_text,
    _event_roll_count,
    _format_roll_recap,
    _format_roll_transcript_text,
    _localized_actor_names,
    generate_battle_report,
    generate_evaluation_report,
)
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
    "Regular": "普通",
    "Damage": "伤害",
    "HP damage": "HP 伤害",
    "HP Damage": "HP 伤害",
    "damage_applied": "造成伤害",
    "DEX roll": "DEX 检定",
    "combined roll": "联合检定",
    "combat round": "战斗轮",
    "in a combat round": "在战斗轮中",
    "DEX order": "DEX 顺序",
    "Conclusion Rewards": "结局奖励",
    "opening_investigation": "开场调查",
    "conclusion_rewards": "结局奖励",
    "opening_pressure": "开场分歧",
    "Rewards": "奖励",
    "reward": "奖励",
    "SAN Reward": "SAN 奖励",
    "sanity_reward": "奖励",
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
    "Appraise": "估价",
    "Art/Craft (Antiques)": "艺术/手艺（古董修复）",
    "History": "历史",
    "Other Language (Latin)": "其他语言（拉丁语）",
    "Persuade": "说服",
    "Library Use": "图书馆使用",
    "Spot Hidden": "侦查",
    "Dodge": "闪避",
    "Fighting (Brawl)": "格斗（斗殴）",
    "Firearms (Handgun)": "射击（手枪）",
    "First Aid": "急救",
    "Listen": "聆听",
    "Locksmith": "锁匠",
    "Occult": "神秘学",
    "Stealth": "潜行",
    "Charm": "魅惑",
    "Climb": "攀爬",
    "Psychology": "心理学",
    "Credit Rating": "信用评级",
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
    "Three Roads into the Corbitt House": "科比特宅邸的三条路",
    "The Haunting Opening Crossroads": "《鬼屋》开场分歧",
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
    "Magic points": "魔法值",
    "magic points": "魔法值",
    "Flesh Ward": "血肉护盾",
    "The Old Corbitt Place": "科比特老宅",
    "The Boston Globe": "《波士顿环球报》",
    "Hall of Records": "档案馆",
    "Roxbury Sanitarium": "罗克斯伯里疗养院",
    "Chapel of Contemplation": "沉思教堂",
    "chapel": "教堂",
    "The Floating Knife": "浮空匕首",
    "Bed Attack": "床铺袭击",
    "The Haunting does not include a required chase sequence; chase subsystem coverage deferred to separate scenario": "本模组不包含必需追逐场景；追逐子系统覆盖留到独立场景",
    "The Haunting does not include a required chase sequence": "本模组不包含必需追逐场景",
    "chase subsystem coverage deferred to separate scenario": "追逐子系统覆盖留到独立场景",
    "Reverend Michael Thomas": "迈克尔·托马斯牧师",
    "Ruth Blake": "露丝·布莱克",
    "Gabriela Macario": "加布里埃拉·马卡里奥",
    "Vittorio Macario": "维托里奥·马卡里奥",
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
    "The Ledger on the Rooftops": "屋顶上的账本",
    "Keeper Rulebook Chapter 7 chase scene": "《守秘人规则书》第 7 章追逐场景",
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
    "speed roll checks to establish the chase": "速度检定来建立追逐",
    "speed roll checks": "速度检定",
    "speed roll setup": "速度检定设置",
    "speed roll": "速度检定",
    "rooftop chase": "屋顶追逐",
    "establish the chase": "建立追逐",
    "chase starts": "追逐开始",
    "chase is established": "追逐成立",
    "inside the chase": "追逐内部",
    "after the chase": "追逐后",
    "end the chase": "结束追逐",
    "chase conflict": "追逐冲突",
    "chase state": "追逐状态",
    "location chain": "位置链",
    "movement actions": "移动行动",
    "movement action": "移动行动",
    "after quarry escapes": "被追者逃脱后",
    "quarry escapes": "被追者逃脱",
    "quarry_escapes": "被追者逃脱",
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
CJK_SENTENCE_PERIOD = re.compile(r"(?<=[\u4e00-\u9fff·》」』”）])\.(?=\s|$)")
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
    "The pursuer searches around the locked roof door after losing line of sight.": "追赶者在上锁屋顶门一带失去视线后搜索。",
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
    "challenge chase push boundary": "质疑追逐推骰边界",
    "challenge keeper ruling": "质疑 KP 裁定",
    "chase_rules_explanation": "追逐规则说明",
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
    "request keeper-only spoiler": "请求守秘人剧透",
    "spoiler_warning": "剧透警告",
    "limited_spoiler_reveal": "有限剧透揭示",
    "spoiler_boundary_probe": "试探剧透边界",
    "spoiler_safe_chase_answer": "剧透安全回应",
    "spot the stolen ledger": "确认被偷走的账本",
    "spot_hidden_regular": "Spot Hidden 普通难度",
    "use clue to shape plan": "用线索调整计划",
}


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_jsonl(path: Path, events: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.parent.name == "logs" and path.name in {"rolls.jsonl", "events.jsonl"}:
        events = _with_rule_refs(events)
    path.write_text("\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8")


def _unique_rule_refs(refs: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for ref in refs:
        if ref in seen:
            continue
        seen.add(ref)
        ordered.append(ref)
    return ordered


def _rule_refs_for_roll(event: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    refs = ["core.percentile_check", "core.success_level"]
    difficulty = payload.get("difficulty")
    if difficulty in {"regular", "hard", "extreme"}:
        refs.append(f"core.difficulty.{difficulty}")
    elif difficulty == "combined":
        refs.append("core.combined_roll")
    elif difficulty == "opposed":
        refs.append("core.opposed_roll")
    elif difficulty == "sanity":
        refs.append("core.sanity.loss")

    if payload.get("pushed") is True or payload.get("push_eligible") is True or isinstance(payload.get("pushed_roll_protocol"), dict):
        refs.append("core.pushed_roll")
    if event.get("type") == "combat":
        refs.append("core.combat.attack_or_maneuver")
    if event.get("type") == "chase":
        refs.append("core.chase.movement_actions")
    if event.get("type") == "sanity" or payload.get("skill") == "SAN":
        refs.append("core.sanity.loss")
    if payload.get("temporary_insanity_triggered") is True:
        refs.append("core.sanity.temporary_insanity_threshold")
    damage_interaction = payload.get("damage_interaction")
    if isinstance(damage_interaction, dict) and damage_interaction.get("rulebook_exception") == "own_dagger_ignores_spells":
        refs.append("module.haunting.corbitt_own_dagger")
    return _unique_rule_refs(refs)


def _rule_refs_for_state_event(event: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    reason = payload.get("reason")
    if reason == "flesh_ward":
        refs.append("module.haunting.corbitt_flesh_ward")
    elif reason == "floating_knife_attack":
        refs.append("module.haunting.corbitt_floating_knife_mp")
    elif reason == "animate_body":
        refs.append("module.haunting.corbitt_animate_body")

    if event.get("type") == "bout_of_madness":
        refs.extend([
            "core.sanity.temporary_insanity_threshold",
            "core.sanity.bout_summary",
            "module.haunting.corbitt_summary_bout",
        ])
    if event.get("type") == "chase":
        refs.append("core.chase.movement_actions")
    if payload.get("rulebook_exception") == "own_dagger_ignores_spells":
        refs.append("module.haunting.corbitt_own_dagger")
    return _unique_rule_refs(refs)


def _with_rule_refs(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for event in events:
        updated = dict(event)
        payload = updated.get("payload")
        if isinstance(payload, dict):
            payload = dict(payload)
            existing_refs = payload.get("rule_refs", [])
            refs = list(existing_refs) if isinstance(existing_refs, list) else []
            if updated.get("type") in {"roll", "sanity", "combat", "chase"} and "roll" in payload:
                refs.extend(_rule_refs_for_roll(updated, payload))
            refs.extend(_rule_refs_for_state_event(updated, payload))
            if refs:
                payload["rule_refs"] = _unique_rule_refs([
                    ref for ref in refs if isinstance(ref, str)
                ])
            updated["payload"] = payload
        enriched.append(updated)
    return enriched


def _evidence(
    *,
    transcript_turns: list[Any] | None = None,
    log_paths: list[str] | None = None,
    state_files: list[str] | None = None,
    artifact_paths: list[str] | None = None,
) -> dict[str, list[Any] | list[str]]:
    evidence: dict[str, list[Any] | list[str]] = {}
    if transcript_turns:
        evidence["transcript_turns"] = transcript_turns
    if log_paths:
        evidence["log_paths"] = log_paths
    if state_files:
        evidence["state_files"] = state_files
    if artifact_paths:
        evidence["artifact_paths"] = artifact_paths
    return evidence


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _unique_strings(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _campaign_relative_path(campaign_dir: Path, path: Path) -> str:
    return path.relative_to(campaign_dir).as_posix()


def _last_payload(events: list[dict[str, Any]], event_type: str, actor_id: str | None = None) -> dict[str, Any]:
    for event in reversed(events):
        if event.get("type") != event_type:
            continue
        if actor_id is not None and event.get("actor") != actor_id:
            continue
        payload = event.get("payload")
        if isinstance(payload, dict):
            return payload
    return {}


def _event_payload(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload")
    return payload if isinstance(payload, dict) else {}


def _indexed_ids(rows: list[Any]) -> set[str]:
    return {
        row["id"]
        for row in rows
        if isinstance(row, dict)
        and isinstance(row.get("id"), str)
        and row["id"]
    }


def _write_campaign_save_and_indexes(campaign_dir: Path) -> None:
    campaign = _read_json(campaign_dir / "campaign.json", {})
    party = _read_json(campaign_dir / "party.json", {})
    scenario = _read_json(campaign_dir / "scenario" / "scenario.json", {})
    locations = _read_json(campaign_dir / "scenario" / "locations.json", [])
    npcs = _read_json(campaign_dir / "scenario" / "npcs.json", [])
    clues = _read_json(campaign_dir / "scenario" / "clues.json", [])
    handouts = _read_json(campaign_dir / "scenario" / "handouts.json", [])
    timeline = _read_json(campaign_dir / "scenario" / "timeline.json", [])
    events = _read_jsonl(campaign_dir / "logs" / "events.jsonl")
    rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")
    audit_events = _read_jsonl(campaign_dir / "logs" / "audit.jsonl")
    memory = _read_jsonl(campaign_dir / "memory" / "session-summaries.jsonl")

    campaign_id = str(campaign.get("campaign_id") or campaign_dir.name)
    scenario_id = str(scenario.get("scenario_id") or campaign.get("active_scenario_id") or "")
    investigator_ids = party.get("investigator_ids", [])
    if not isinstance(investigator_ids, list):
        investigator_ids = []

    active_scene_id = campaign.get("active_scene_id") or scenario.get("current_phase") or ""
    active_scene_event = next(
        (
            event
            for event in reversed(events)
            if _event_payload(event).get("scene_id") == active_scene_id
        ),
        None,
    )
    if active_scene_event is None:
        active_scene_event = next(
            (event for event in reversed(events) if event.get("type") in {"scene", "session_ending"}),
            events[-1] if events else {},
        )
    active_scene_payload = _event_payload(active_scene_event)

    discovered_clue_ids = _unique_strings([
        _event_payload(event).get("clue_id")
        for event in events
        if event.get("type") == "clue"
    ])
    decision_rows = [
        {
            key: value
            for key, value in {
                "decision_id": _event_payload(event).get("decision_id"),
                "decision_kind": _event_payload(event).get("decision_kind"),
                "source_turn": _event_payload(event).get("source_turn"),
                "summary": _event_payload(event).get("summary"),
            }.items()
            if value is not None
        }
        for event in events
        if event.get("type") == "decision"
    ]
    status_payload = _last_payload(events, "status")
    memory_refs = ["memory/session-summaries.jsonl"] if memory else []

    _write_json(campaign_dir / "save" / "world-state.json", {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "status": campaign.get("status"),
        "active_scene_id": active_scene_id,
        "active_subsystem": campaign.get("active_subsystem"),
        "current_phase": scenario.get("current_phase"),
        "discovered_clue_ids": discovered_clue_ids,
        "major_decisions": decision_rows,
        "current_status": status_payload,
        "memory_refs": memory_refs,
        "log_refs": ["logs/events.jsonl", "logs/rolls.jsonl"],
        "investigator_state_refs": [
            f"save/investigator-state/{investigator_id}.json"
            for investigator_id in investigator_ids
            if isinstance(investigator_id, str)
        ],
        "updated_from_logs": {
            "events": len(events),
            "rolls": len(rolls),
            "memory": len(memory),
        },
    })
    _write_json(campaign_dir / "save" / "active-scene.json", {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "scene_id": active_scene_id,
        "source_event_type": active_scene_event.get("type"),
        "source_scene_id": active_scene_payload.get("scene_id"),
        "summary": active_scene_payload.get("summary") or scenario.get("opening_scene") or scenario.get("summary"),
        "pending_choices": scenario.get("current_phase"),
    })
    _write_json(campaign_dir / "save" / "flags.json", {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "clues_found": {clue_id: True for clue_id in discovered_clue_ids},
        "decisions": decision_rows,
        "spoiler_reveals": [
            event
            for event in audit_events
            if event.get("type") == "spoiler_reveal"
        ],
    })

    investigators_root = campaign_dir.parents[1] / "investigators"
    for investigator_id in investigator_ids:
        if not isinstance(investigator_id, str):
            continue
        character = _read_json(investigators_root / investigator_id / "character.json", {})
        derived = character.get("derived", {}) if isinstance(character.get("derived"), dict) else {}
        character_skills = character.get("skills", {}) if isinstance(character.get("skills"), dict) else {}
        investigator_status = _last_payload(events, "status", investigator_id) or status_payload
        skill_checks = _unique_strings([
            _event_payload(row).get("skill")
            for row in rolls
            if row.get("actor") == investigator_id
            and _event_payload(row).get("skill_check_earned") is True
            and _event_payload(row).get("skill") in character_skills
        ])
        _write_json(campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json", {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "investigator_id": investigator_id,
            "character_ref": f"sandbox/.coc/investigators/{investigator_id}/character.json",
            "current_hp": int(investigator_status.get("final_hp", derived.get("HP", 0))),
            "current_san": int(investigator_status.get("final_san", derived.get("SAN", 0))),
            "current_mp": int(investigator_status.get("final_mp", derived.get("MP", 0))),
            "conditions": investigator_status.get("unresolved_conditions", []),
            "skill_checks_earned": skill_checks,
            "last_status_summary": investigator_status.get("summary"),
        })

    scenario_files = [
        _campaign_relative_path(campaign_dir, path)
        for path in sorted((campaign_dir / "scenario").glob("*.json"))
    ]
    _write_json(campaign_dir / "index" / "source-map.json", {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "scenario_files": scenario_files,
        "source_refs": [
            {
                "kind": "module_source",
                "path": scenario.get("module_source"),
                "scenario_id": scenario_id,
            }
        ] if scenario.get("module_source") else [],
        "log_refs": ["logs/events.jsonl", "logs/rolls.jsonl"],
        "memory_refs": memory_refs,
    })
    scene_rows = []
    for location in locations if isinstance(locations, list) else []:
        if isinstance(location, dict):
            scene_rows.append({
                "id": location.get("id"),
                "name": location.get("name"),
                "purpose": location.get("purpose"),
                "source_file": "scenario/locations.json",
            })
    for entry in timeline if isinstance(timeline, list) else []:
        if isinstance(entry, dict):
            scene_rows.append({
                "id": entry.get("id"),
                "summary": entry.get("summary"),
                "source_file": "scenario/timeline.json",
            })
    if active_scene_id and active_scene_id not in _indexed_ids(scene_rows):
        scene_rows.append({
            "id": active_scene_id,
            "summary": active_scene_payload.get("summary") or scenario.get("current_phase"),
            "source_file": "logs/events.jsonl",
            "source_event_type": active_scene_event.get("type"),
        })
    _write_json(campaign_dir / "index" / "scene-index.json", {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "active_scene_id": active_scene_id,
        "scenes": scene_rows,
    })
    _write_json(campaign_dir / "index" / "npc-index.json", {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "npcs": npcs if isinstance(npcs, list) else [],
    })
    clue_rows = list(clues) if isinstance(clues, list) else []
    handout_rows = list(handouts) if isinstance(handouts, list) else []
    indexed_clue_ids = _indexed_ids([*clue_rows, *handout_rows])
    for clue_id in discovered_clue_ids:
        if clue_id in indexed_clue_ids:
            continue
        clue_event = next(
            (
                event
                for event in events
                if event.get("type") == "clue"
                and _event_payload(event).get("clue_id") == clue_id
            ),
            {},
        )
        clue_payload = _event_payload(clue_event)
        clue_rows.append({
            "id": clue_id,
            "summary": clue_payload.get("summary"),
            "route": "logs/events.jsonl",
            "source_event_type": clue_event.get("type"),
        })
        indexed_clue_ids.add(clue_id)
    _write_json(campaign_dir / "index" / "clue-index.json", {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "clues": clue_rows,
        "handouts": handout_rows,
        "discovered_clue_ids": discovered_clue_ids,
    })

    by_ref: dict[str, list[dict[str, Any]]] = {}
    for log_name, rows in (("logs/rolls.jsonl", rolls), ("logs/events.jsonl", events)):
        for row_index, row in enumerate(rows, start=1):
            refs = _event_payload(row).get("rule_refs", [])
            if not isinstance(refs, list):
                continue
            for ref in refs:
                if isinstance(ref, str):
                    by_ref.setdefault(ref, []).append({
                        "log": log_name,
                        "row": row_index,
                        "type": row.get("type"),
                    })
    _write_json(campaign_dir / "index" / "rule-ref-index.json", {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "rule_refs": sorted(by_ref),
        "by_ref": by_ref,
    })

    combat_rows = [event for event in events if event.get("type") == "combat"]
    combat_roll_rows = [row for row in rolls if row.get("type") == "combat"]
    if combat_rows or combat_roll_rows:
        npc_by_id = {
            npc.get("id"): npc
            for npc in npcs
            if isinstance(npc, dict) and isinstance(npc.get("id"), str)
        } if isinstance(npcs, list) else {}
        combat_actor_ids = _unique_strings(
            [row.get("actor") for row in [*combat_rows, *combat_roll_rows]]
        )
        combatants: list[dict[str, Any]] = []
        dex_values: dict[str, int] = {}
        for actor_id in combat_actor_ids:
            if actor_id == "keeper_under_test":
                continue
            if actor_id in investigator_ids:
                character = _read_json(investigators_root / actor_id / "character.json", {})
                characteristics = character.get("characteristics", {}) if isinstance(character.get("characteristics"), dict) else {}
                dex = characteristics.get("DEX")
                if isinstance(dex, int):
                    dex_values[actor_id] = dex
                combatants.append({
                    "id": actor_id,
                    "name": character.get("name", actor_id),
                    "role": "investigator",
                    "dex": dex,
                })
            elif actor_id in npc_by_id:
                combatants.append({
                    "id": actor_id,
                    "name": npc_by_id[actor_id].get("name", actor_id),
                    "role": npc_by_id[actor_id].get("role", "npc"),
                    "dex": npc_by_id[actor_id].get("DEX"),
                })
            else:
                combatants.append({"id": actor_id, "name": actor_id, "role": "npc", "dex": None})
        dex_order = [
            actor_id
            for actor_id, _dex in sorted(
                dex_values.items(),
                key=lambda item: item[1],
                reverse=True,
            )
        ]
        dex_order.extend([actor_id for actor_id in combat_actor_ids if actor_id not in dex_order and actor_id != "keeper_under_test"])
        _write_json(campaign_dir / "save" / "combat.json", {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "scenario_id": scenario_id,
            "combat_id": f"{campaign_id}-combat",
            "status": "resolved",
            "combatants": combatants,
            "dex_order": dex_order,
            "rounds": [
                {
                    "round": 1,
                    "events": [
                        _event_payload(event).get("summary")
                        for event in combat_rows
                        if _event_payload(event).get("summary")
                    ],
                    "roll_count": len(combat_roll_rows),
                }
            ],
            "outcome": _event_payload(combat_rows[-1]).get("summary") if combat_rows else None,
        })


def _select_campaign_dir(run_dir: Path) -> Path | None:
    metadata = _read_json(run_dir / "playtest.json", {})
    campaign_id = metadata.get("campaign_id") or metadata.get("run_id")
    if campaign_id:
        candidate = run_dir / "sandbox" / ".coc" / "campaigns" / str(campaign_id)
        if candidate.exists():
            return candidate
    campaigns_root = run_dir / "sandbox" / ".coc" / "campaigns"
    if not campaigns_root.exists():
        return None
    campaign_dirs = sorted(path for path in campaigns_root.iterdir() if path.is_dir())
    return campaign_dirs[0] if campaign_dirs else None


def _public_character_states(run_dir: Path, campaign_dir: Path | None) -> list[dict[str, Any]]:
    if campaign_dir is None:
        return []
    party = _read_json(campaign_dir / "party.json", {})
    investigator_ids = party.get("investigator_ids", [])
    states: list[dict[str, Any]] = []
    for investigator_id in investigator_ids if isinstance(investigator_ids, list) else []:
        character = _read_json(
            run_dir / "sandbox" / ".coc" / "investigators" / str(investigator_id) / "character.json",
            {},
        )
        if not character:
            continue
        states.append({
            "investigator_id": str(investigator_id),
            "name": character.get("name"),
            "occupation": character.get("occupation"),
            "era": character.get("era"),
            "characteristics": character.get("characteristics", {}),
            "derived": character.get("derived", {}),
            "skills": character.get("skills", {}),
            "backstory": character.get("backstory", {}),
        })
    return states


def _keeper_secret_ids(campaign_dir: Path | None) -> list[str]:
    if campaign_dir is None:
        return []
    secrets = _read_json(campaign_dir / "scenario" / "keeper-secrets.json", [])
    if not isinstance(secrets, list):
        return []
    return [str(secret["id"]) for secret in secrets if isinstance(secret, dict) and secret.get("id")]


def _metadata_localized_terms(metadata: dict[str, Any]) -> dict[str, str]:
    play_language = str(metadata.get("play_language") or "")
    localized_terms = metadata.get("localized_terms", {})
    if not isinstance(localized_terms, dict):
        return {}
    terms = localized_terms.get(play_language, {})
    if not isinstance(terms, dict):
        return {}
    return {
        str(canonical): str(display)
        for canonical, display in terms.items()
        if str(canonical) and str(display)
    }


def _player_view_glossary(metadata: dict[str, Any]) -> dict[str, str]:
    glossary = _metadata_localized_terms(metadata)
    profile = metadata.get("language_profile", {})
    if not isinstance(profile, dict):
        return glossary
    for label_group in ("outcome_labels", "difficulty_labels"):
        labels = profile.get(label_group, {})
        if not isinstance(labels, dict):
            continue
        glossary.update({
            str(canonical): str(display)
            for canonical, display in labels.items()
            if str(canonical) and str(display)
        })
    return glossary


def _player_view_event(
    event: dict[str, Any],
    glossary: dict[str, str],
    language_profile: dict[str, Any],
    profile_labels: dict[str, str],
    play_language: str,
    rendered_text: str | None = None,
) -> dict[str, Any]:
    visible = dict(event)
    if rendered_text is not None:
        visible["text"] = _display_transcript_text(rendered_text)
    elif isinstance(visible.get("text"), str):
        visible["text"] = _display_transcript_text(_localize_text(visible["text"], glossary))
    localized_text = visible.get("localized_text", {})
    if isinstance(localized_text, dict) and isinstance(localized_text.get(play_language), dict):
        visible["localized_text"] = {
            **localized_text,
            play_language: _localize_public_value(localized_text[play_language], glossary),
        }
    if isinstance(visible.get("speaker"), str):
        visible["speaker"] = _display_transcript_speaker(
            visible,
            profile_labels,
            language_profile,
            glossary,
        )
    localized_text = visible.get("localized_text", {})
    language_text = localized_text.get(play_language, {}) if isinstance(localized_text, dict) else {}
    for key in ("intent", "ruling"):
        if not isinstance(visible.get(key), str) or not visible[key]:
            continue
        display = language_text.get(key) if isinstance(language_text, dict) else None
        if display in (None, "", [], {}):
            display = visible[key]
        visible[f"{key}_display"] = _localize_text(str(display), glossary)
    player_profile = visible.get("player_profile")
    if isinstance(player_profile, str) and player_profile in profile_labels:
        visible["player_profile_display"] = profile_labels[player_profile]
    spoiler_protocol = visible.get("spoiler_protocol")
    if isinstance(spoiler_protocol, dict):
        visible["spoiler_protocol"] = {
            key: value
            for key, value in spoiler_protocol.items()
            if key != "keeper_secret_id"
        }
    return {**visible, "view": "player", "type": "transcript_turn"}


def _transcript_event_with_display_fields(
    event: dict[str, Any],
    glossary: dict[str, str],
    language_profile: dict[str, Any],
    profile_labels: dict[str, str],
    play_language: str,
    rendered_text: str | None = None,
) -> dict[str, Any]:
    visible = dict(event)
    if isinstance(visible.get("speaker"), str):
        visible["speaker_display"] = _display_transcript_speaker(
            visible,
            profile_labels,
            language_profile,
            glossary,
        )
    if rendered_text is not None:
        visible["text_display"] = rendered_text
    elif isinstance(visible.get("text"), str):
        visible["text_display"] = _display_transcript_text(_localize_text(visible["text"], glossary))

    localized_text = visible.get("localized_text", {})
    language_text = localized_text.get(play_language, {}) if isinstance(localized_text, dict) else {}
    for key in ("intent", "ruling"):
        if not isinstance(visible.get(key), str) or not visible[key]:
            continue
        display = language_text.get(key) if isinstance(language_text, dict) else None
        if display in (None, "", [], {}):
            display = visible[key]
        visible[f"{key}_display"] = _localize_text(str(display), glossary)

    player_profile = visible.get("player_profile")
    if isinstance(player_profile, str) and player_profile in profile_labels:
        visible["player_profile_display"] = profile_labels[player_profile]
    return visible


def _transcript_events_with_display_fields(
    transcript: list[dict[str, Any]],
    roll_recaps: list[str],
    glossary: dict[str, str],
    language_profile: dict[str, Any],
    profile_labels: dict[str, str],
    play_language: str,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    roll_cursor = 0
    for event in transcript:
        rendered_text = None
        if event.get("mode") == "roll":
            roll_count = _event_roll_count(event, len(roll_recaps) - roll_cursor)
            recaps = roll_recaps[roll_cursor: roll_cursor + roll_count]
            rendered_text = _format_roll_transcript_text(event, recaps, glossary)
            roll_cursor += roll_count
        events.append(_transcript_event_with_display_fields(
            event,
            glossary,
            language_profile,
            profile_labels,
            play_language,
            rendered_text,
        ))
    return events


def _player_view_transcript_events(
    transcript: list[dict[str, Any]],
    roll_recaps: list[str],
    glossary: dict[str, str],
    language_profile: dict[str, Any],
    profile_labels: dict[str, str],
    play_language: str,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    roll_cursor = 0
    for event in transcript:
        rendered_text = None
        if event.get("mode") == "roll":
            roll_count = _event_roll_count(event, len(roll_recaps) - roll_cursor)
            recaps = roll_recaps[roll_cursor: roll_cursor + roll_count]
            rendered_text = _format_roll_transcript_text(event, recaps, glossary)
            roll_cursor += roll_count
        events.append(_player_view_event(event, glossary, language_profile, profile_labels, play_language, rendered_text))
    return events


def _localize_public_value(value: Any, glossary: dict[str, str]) -> Any:
    if isinstance(value, str):
        return _localize_text(value, glossary)
    if isinstance(value, list):
        return [_localize_public_value(item, glossary) for item in value]
    if isinstance(value, dict):
        return {key: _localize_public_value(item, glossary) for key, item in value.items()}
    return value


def _public_character_label(language_profile: dict[str, Any], canonical: str) -> str:
    labels = language_profile.get("character_dossier_labels", {})
    if isinstance(labels, dict) and canonical in labels:
        return str(labels[canonical])
    return canonical


def _localize_public_derived_values(
    derived: dict[str, Any],
    glossary: dict[str, str],
    language_profile: dict[str, Any],
) -> dict[str, Any]:
    return {
        _public_character_label(language_profile, str(key)): _localize_public_value(value, glossary)
        for key, value in derived.items()
    }


def _localize_public_character_state(
    character: dict[str, Any],
    glossary: dict[str, str],
    language_profile: dict[str, Any],
) -> dict[str, Any]:
    visible = dict(character)
    for field in ("name", "occupation", "era"):
        if isinstance(visible.get(field), str):
            visible[field] = _localize_text(visible[field], glossary)

    skills = visible.get("skills", {})
    if isinstance(skills, dict):
        visible["skills"] = {
            _localize_text(str(skill), glossary): value
            for skill, value in skills.items()
        }

    derived = visible.get("derived", {})
    if isinstance(derived, dict):
        visible["derived"] = _localize_public_derived_values(derived, glossary, language_profile)
    else:
        visible["derived"] = _localize_public_value(derived, glossary)
    visible["backstory"] = _localize_public_value(visible.get("backstory", {}), glossary)
    return visible


def _localize_public_scenario_state(scenario: dict[str, Any], glossary: dict[str, str]) -> dict[str, Any]:
    return {
        "title": _localize_public_value(scenario.get("title"), glossary),
        "player_safe_summary": _localize_public_value(scenario.get("player_safe_summary"), glossary),
        "opening_scene": _localize_public_value(scenario.get("opening_scene"), glossary),
        "current_phase": _localize_public_value(scenario.get("current_phase"), glossary),
    }


def _write_view_streams(run_dir: Path) -> None:
    campaign_dir = _select_campaign_dir(run_dir)
    metadata = _read_json(run_dir / "playtest.json", {})
    scenario = _read_json(campaign_dir / "scenario" / "scenario.json", {}) if campaign_dir else {}
    transcript = _read_jsonl(run_dir / "transcript.jsonl")
    player_glossary = _player_view_glossary(metadata)
    public_characters = _public_character_states(run_dir, campaign_dir)
    language_profile = metadata.get("language_profile", {})
    if not isinstance(language_profile, dict):
        language_profile = {}
    play_language = str(metadata.get("play_language") or "en-US")
    profile_labels = {}
    player_profile_labels = metadata.get("player_profile_labels", {})
    if isinstance(player_profile_labels, dict):
        labels = player_profile_labels.get(play_language, {})
        if isinstance(labels, dict):
            profile_labels = {str(key): str(value) for key, value in labels.items()}
    actor_names = _localized_actor_names(public_characters, player_glossary)
    roll_events = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl") if campaign_dir else []
    roll_recaps = [
        _format_roll_recap(event, actor_names, player_glossary, play_language, language_profile)
        for event in roll_events
    ]
    transcript = _transcript_events_with_display_fields(
        transcript,
        roll_recaps,
        player_glossary,
        language_profile,
        profile_labels,
        play_language,
    )
    _write_jsonl(run_dir / "transcript.jsonl", transcript)
    public_state = {
        "view": "player",
        "type": "public_character_state",
        "campaign_id": metadata.get("campaign_id"),
        "scenario": _localize_public_scenario_state(scenario, player_glossary),
        "investigators": [
            _localize_public_character_state(character, player_glossary, language_profile)
            for character in public_characters
        ],
    }
    keeper_context = {
        "view": "keeper",
        "type": "keeper_context",
        "campaign_id": metadata.get("campaign_id"),
        "scenario_id": scenario.get("scenario_id"),
        "keeper_secret_ids": _keeper_secret_ids(campaign_dir),
    }
    player_events = [public_state] + _player_view_transcript_events(
        transcript,
        roll_recaps,
        player_glossary,
        language_profile,
        profile_labels,
        play_language,
    )
    keeper_events = [keeper_context] + [
        {**event, "view": "keeper", "type": "transcript_turn"}
        for event in transcript
    ]
    _write_jsonl(run_dir / "player-view.jsonl", player_events)
    _write_jsonl(run_dir / "keeper-view.jsonl", keeper_events)


def _pushed_roll_transcript_protocol(
    roll_id: str,
    stage: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    protocol = {"roll_id": roll_id, "stage": stage}
    if extra:
        protocol.update(extra)
    return protocol


def _pushed_roll_payload_protocol(roll_id: str) -> dict[str, Any]:
    return {
        "roll_id": roll_id,
        "failure_consequence_source": "keeper",
        "keeper_foreshadowed_failure": True,
        "player_confirmation_recorded": True,
    }


def _spoiler_transcript_protocol(
    spoiler_id: str,
    stage: str,
    keeper_secret_id: str,
    scope: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    protocol = {
        "spoiler_id": spoiler_id,
        "stage": stage,
        "keeper_secret_id": keeper_secret_id,
        "scope": scope,
    }
    if extra:
        protocol.update(extra)
    return protocol


def _write_investigator_chronicle(
    investigator_dir: Path,
    history: list[dict[str, Any]],
    development: list[dict[str, Any]],
    inventory: list[dict[str, Any]] | None = None,
) -> None:
    _write_jsonl(investigator_dir / "history.jsonl", history)
    _write_jsonl(investigator_dir / "development.jsonl", development)
    _write_jsonl(investigator_dir / "inventory-history.jsonl", inventory or [])


ADA_KING_OCCUPATION_SKILL_POINTS = 300
ADA_KING_PERSONAL_INTEREST_POINTS = 140


def _ada_king_base_skill_entries() -> dict[str, dict[str, int]]:
    return {
        "Credit Rating": {"base": 0, "occupation_points": 40, "personal_interest_points": 0, "final": 40},
        "Appraise": {"base": 5, "occupation_points": 35, "personal_interest_points": 0, "final": 40},
        "Art/Craft (Antiques)": {"base": 5, "occupation_points": 35, "personal_interest_points": 0, "final": 40},
        "History": {"base": 5, "occupation_points": 45, "personal_interest_points": 0, "final": 50},
        "Library Use": {"base": 20, "occupation_points": 40, "personal_interest_points": 0, "final": 60},
        "Other Language (Latin)": {"base": 1, "occupation_points": 29, "personal_interest_points": 0, "final": 30},
        "Persuade": {"base": 10, "occupation_points": 35, "personal_interest_points": 10, "final": 55},
        "Spot Hidden": {"base": 25, "occupation_points": 30, "personal_interest_points": 0, "final": 55},
        "Psychology": {"base": 10, "occupation_points": 11, "personal_interest_points": 19, "final": 40},
        "Charm": {"base": 15, "occupation_points": 0, "personal_interest_points": 20, "final": 35},
        "Climb": {"base": 20, "occupation_points": 0, "personal_interest_points": 0, "final": 20},
        "Dodge": {"base": 25, "occupation_points": 0, "personal_interest_points": 0, "final": 25},
        "Fighting (Brawl)": {"base": 25, "occupation_points": 0, "personal_interest_points": 15, "final": 40},
        "Firearms (Handgun)": {"base": 20, "occupation_points": 0, "personal_interest_points": 20, "final": 40},
        "First Aid": {"base": 30, "occupation_points": 0, "personal_interest_points": 10, "final": 40},
        "Listen": {"base": 20, "occupation_points": 0, "personal_interest_points": 20, "final": 40},
        "Stealth": {"base": 20, "occupation_points": 0, "personal_interest_points": 20, "final": 40},
        "Occult": {"base": 5, "occupation_points": 0, "personal_interest_points": 6, "final": 11},
    }


def _skill_allocation_record(skills: dict[str, dict[str, int]]) -> dict[str, Any]:
    skills_with_thresholds: dict[str, dict[str, int]] = {}
    for skill, entry in skills.items():
        final = entry["final"]
        thresholds = _half_fifth(final)
        skills_with_thresholds[skill] = {
            **entry,
            "half": thresholds["half"],
            "fifth": thresholds["fifth"],
        }
    occupation_spent = sum(entry["occupation_points"] for entry in skills_with_thresholds.values())
    personal_spent = sum(entry["personal_interest_points"] for entry in skills_with_thresholds.values())
    return {
        "occupation_points_spent": occupation_spent,
        "personal_interest_points_spent": personal_spent,
        "unallocated_occupation_points": ADA_KING_OCCUPATION_SKILL_POINTS - occupation_spent,
        "unallocated_personal_interest_points": ADA_KING_PERSONAL_INTEREST_POINTS - personal_spent,
        "skills": skills_with_thresholds,
    }


def _ada_king_default_skill_allocation() -> dict[str, Any]:
    return _skill_allocation_record(_ada_king_base_skill_entries())


def _ada_king_chase_skill_allocation() -> dict[str, Any]:
    skills = _ada_king_base_skill_entries()
    skills.update({
        "Charm": {"base": 15, "occupation_points": 0, "personal_interest_points": 0, "final": 15},
        "Climb": {"base": 20, "occupation_points": 0, "personal_interest_points": 20, "final": 40},
        "Dodge": {"base": 25, "occupation_points": 0, "personal_interest_points": 10, "final": 35},
        "Firearms (Handgun)": {"base": 20, "occupation_points": 0, "personal_interest_points": 0, "final": 20},
        "First Aid": {"base": 30, "occupation_points": 0, "personal_interest_points": 0, "final": 30},
        "Listen": {"base": 20, "occupation_points": 0, "personal_interest_points": 12, "final": 32},
        "Locksmith": {"base": 1, "occupation_points": 0, "personal_interest_points": 29, "final": 30},
        "Occult": {"base": 5, "occupation_points": 0, "personal_interest_points": 0, "final": 5},
        "Stealth": {"base": 20, "occupation_points": 0, "personal_interest_points": 25, "final": 45},
    })
    return _skill_allocation_record(skills)


def _skill_finals(skill_allocation: dict[str, Any]) -> dict[str, int]:
    return {skill: entry["final"] for skill, entry in skill_allocation["skills"].items()}


def _ada_king_default_character_skills() -> dict[str, int]:
    return _skill_finals(_ada_king_default_skill_allocation())


def _ada_king_chase_character_skills() -> dict[str, int]:
    return _skill_finals(_ada_king_chase_skill_allocation())


def _half_fifth(value: int) -> dict[str, int]:
    return {"full": value, "half": value // 2, "fifth": value // 5}


def _creation_characteristic(formula: str, roll_total: int, final: int) -> dict[str, Any]:
    thresholds = _half_fifth(final)
    return {
        "formula": formula,
        "roll_total": roll_total,
        "final": final,
        "half": thresholds["half"],
        "fifth": thresholds["fifth"],
    }


def _characteristic_thresholds(characteristics: dict[str, int]) -> dict[str, dict[str, int]]:
    return {
        key: _half_fifth(value)
        for key, value in characteristics.items()
        if isinstance(value, int)
    }


def _skill_thresholds(skills: dict[str, int]) -> dict[str, dict[str, int]]:
    return {
        key: _half_fifth(value)
        for key, value in skills.items()
        if isinstance(value, int)
    }


def _ada_king_creation_record(
    equipment: list[str] | None = None,
    skill_allocation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "method": "standard_rulebook_chapter_3",
        "rulebook_source": "Call of Cthulhu Keeper Rulebook Chapter 3",
        "rulebook_steps": [
            "generate_characteristics",
            "choose_age",
            "apply_age_adjustments",
            "determine_occupation",
            "allocate_skill_points",
            "create_backstory",
            "equip_investigator",
        ],
        "characteristics": {
            "STR": _creation_characteristic("3D6 × 5", 12, 60),
            "CON": _creation_characteristic("3D6 × 5", 11, 55),
            "SIZ": _creation_characteristic("2D6+6 × 5", 13, 65),
            "DEX": _creation_characteristic("3D6 × 5", 10, 50),
            "APP": _creation_characteristic("3D6 × 5", 9, 45),
            "INT": _creation_characteristic("2D6+6 × 5", 14, 70),
            "POW": _creation_characteristic("3D6 × 5", 11, 55),
            "EDU": _creation_characteristic("2D6+6 × 5", 15, 75),
            "LUCK": _creation_characteristic("3D6 × 5", 11, 55),
        },
        "age": {
            "years": 32,
            "range": "20-39",
            "edu_improvement_checks_required": 1,
            "edu_improvement_checks": [
                {
                    "roll": 42,
                    "target": 75,
                    "improved": False,
                    "improvement_die": "1D10",
                    "improvement_roll": None,
                    "edu_before": 75,
                    "edu_after": 75,
                },
            ],
            "characteristic_reductions": [],
            "app_reduction": 0,
            "mov_penalty": 0,
        },
        "derived": {
            "HP": {"formula": "(CON + SIZ) / 10", "value": 12},
            "MP": {"formula": "POW / 5", "value": 11},
            "SAN": {"formula": "POW", "value": 55},
            "MOV": {"formula": "both STR and DEX lower than SIZ -> MOV 7", "value": 7},
            "damage_bonus": {"formula": "STR + SIZ = 125", "value": "0"},
            "build": {"formula": "STR + SIZ = 125", "value": 0},
        },
        "occupation": {
            "name": "Antiquarian",
            "skill_point_formula": "EDU × 4",
            "skill_points_available": 300,
            "credit_rating_range": "30-70",
            "occupation_skills": [
                "Appraise",
                "Art/Craft",
                "History",
                "Library Use",
                "Other Language",
                "Persuade",
                "Spot Hidden",
                "Psychology",
            ],
        },
        "personal_interest": {
            "skill_point_formula": "INT × 2",
            "skill_points_available": 140,
        },
        "finances": {
            "credit_rating": 40,
            "living_standard": "Average",
        },
        "skill_allocation": skill_allocation or _ada_king_default_skill_allocation(),
        "backstory": {
            "description": "艾达·金是一名研究旧宅产权和民俗传闻的古物学者。",
            "ideology_beliefs": "老房子会留下居住者的记忆，公开记录能让这些记忆开口。",
            "significant_people": "莱兰·哈特教授",
            "meaningful_locations": "斯科利广场附近的旧书店",
            "treasured_possessions": "裂柄铜放大镜",
            "traits": ["谨慎记笔记", "先询问目击者再进入危险地点"],
        },
        "equipment": equipment or ["裂柄铜放大镜", "笔记本", "钢笔", "左轮"],
        "notes": [
            "创建流程按规则书第 3 章记录，战役结束后的物品变化另写入 inventory-history.jsonl。",
        ],
    }


def _localize_text(text: str, glossary: dict[str, str]) -> str:
    localized = text
    for canonical, replacement in sorted(glossary.items(), key=lambda item: len(item[0]), reverse=True):
        localized = localized.replace(canonical, replacement)
    localized = CJK_BOUNDARY_SPACE.sub("", localized)
    return CJK_SENTENCE_PERIOD.sub("。", localized)


def _localize_value(value: Any, glossary: dict[str, str], key: str | None = None) -> Any:
    if isinstance(value, str):
        return _localize_text(value, glossary) if key in LOCALIZED_JSON_TEXT_KEYS else value
    if isinstance(value, list):
        return [_localize_value(item, glossary, key) for item in value]
    if isinstance(value, dict):
        return {child_key: _localize_value(item, glossary, child_key) for child_key, item in value.items()}
    return value


def _write_jsonl_localized(
    path: Path,
    events: list[dict[str, Any]],
    glossary: dict[str, str],
    profile_labels: dict[str, str] | None = None,
) -> None:
    localized_events = [_localize_value(event, glossary) for event in events]
    if profile_labels:
        for event in localized_events:
            player_profile = event.get("player_profile")
            if isinstance(player_profile, str) and player_profile in profile_labels:
                event["player_profile_display"] = profile_labels[player_profile]
    _write_jsonl(path, localized_events)


def _write_transcript_jsonl_localized(path: Path, events: list[dict[str, Any]], glossary: dict[str, str]) -> None:
    localized_events: list[dict[str, Any]] = []
    for event in events:
        localized = dict(event)
        if localized.get("role") in {"keeper_under_test", "player_simulator"}:
            for key in ("text",):
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
        "regression_tests": [],
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
        "player_safe_summary": "诺特先生请艾达·金调查一栋据说闹鬼的波士顿旧宅。",
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
        "characteristic_thresholds": _characteristic_thresholds({
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
        }),
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 7,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": {
            "Library Use": 60,
            "Spot Hidden": 55,
            "Psychology": 40,
        },
        "skill_thresholds": _skill_thresholds({
            "Library Use": 60,
            "Spot Hidden": 55,
            "Psychology": 40,
        }),
    })
    _write_json(investigator_dir / "creation.json", _ada_king_creation_record())

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
        {
            "severity": "low",
            "category": "rules_accuracy",
            "text": "Rolls include goals and difficulty rationale.",
            "evidence": _evidence(
                transcript_turns=[5, 6, 8, "8a", 9, 12],
                log_paths=[f"sandbox/.coc/campaigns/{run_id}/logs/rolls.jsonl"],
            ),
        },
        {
            "severity": "low",
            "category": "state_integrity",
            "text": "Clue, decision, sanity, memory, and feedback logs are present.",
            "evidence": _evidence(
                transcript_turns=[1, 4, 8, 12, 13],
                log_paths=[f"sandbox/.coc/campaigns/{run_id}/logs/events.jsonl", f"sandbox/.coc/campaigns/{run_id}/memory/session-summaries.jsonl"],
                artifact_paths=["player-feedback.jsonl", "artifacts/battle-report.md"],
            ),
        },
    ])

    _write_campaign_save_and_indexes(campaign_dir)
    _write_view_streams(run_dir)
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
        "simulation_method": "transcript_driven_virtual_table",
        "simulation_interaction_model": {
            "keeper_role": "keeper_under_test",
            "player_role": "player_simulator",
            "evaluator_role": "evaluator",
            "view_boundary": "player-view and keeper-view streams",
        },
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
        "future_enhancements": [],
        "regression_tests": [],
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
        "player_safe_summary": "诺特先生雇用艾达·金调查一栋闹鬼的波士顿旧宅，并查明房客不断逃离的原因。",
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
        {"id": "npc-vittorio", "name": "Vittorio Macario", "role": "survivor at Roxbury Sanitarium"},
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
        {
            "id": "handout-1",
            "label": "Handout 1",
            "title": "Mr. Knott's job",
            "summary": "The address, key, $20 advance, and the premise that Ada should research public records before entering the house.",
            "localized_text": {"zh-Hans": {"label": "线索资料 1", "title": "诺特先生的委托", "summary": "钥匙、地址、20 美元预付款，以及先查公共记录的委托前提"}},
        },
        {
            "id": "handout-2",
            "label": "Handout 2",
            "title": "Unpublished Boston Globe story",
            "summary": "Newspaper records of accidents, illness, suicide, and the Macario family fleeing the house.",
            "localized_text": {"zh-Hans": {"label": "线索资料 2", "title": "未刊登的《波士顿环球报》报道", "summary": "事故、疾病、自杀和马卡里奥一家逃离的剪报记录"}},
        },
        {
            "id": "handout-7",
            "label": "Handout 7",
            "title": "Chapel executor record",
            "summary": "The will executor points toward Reverend Michael Thomas and the Chapel of Contemplation.",
            "localized_text": {"zh-Hans": {"label": "线索资料 7", "title": "教堂遗嘱执行人记录", "summary": "遗嘱执行人指向迈克尔·托马斯牧师和沉思教堂"}},
        },
        {
            "id": "handout-9",
            "label": "Handout 9",
            "title": "Chapel symbol",
            "summary": "The Chapel sign shows a three-Y eye symbol that connects the cult records to Corbitt.",
            "localized_text": {"zh-Hans": {"label": "线索资料 9", "title": "教堂符号", "summary": "沉思教堂标志上的三叉眼符号把教团记录与科比特联系起来"}},
        },
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
        "characteristic_thresholds": _characteristic_thresholds({
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
            "LUCK": 55,
        }),
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 7,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": _ada_king_default_character_skills(),
        "skill_thresholds": _skill_thresholds(_ada_king_default_character_skills()),
        "backstory": {
            "description": "艾达·金是一名研究旧宅产权和民俗传闻的古物学者，习惯把钥匙、地契和剪报按地址整理。",
            "ideology_beliefs": ["老房子会留下居住者的记忆，公开记录能让这些记忆开口。"],
            "significant_people": ["莱兰·哈特教授，她已故的导师，教她先查档案再下判断。"],
            "meaningful_locations": ["斯科利广场附近的旧书店，她在那里替客户鉴定遗物。"],
            "treasured_possessions": ["裂柄铜放大镜。"],
            "traits": ["谨慎记笔记", "先询问目击者再进入危险地点"],
        },
    })
    _write_json(investigator_dir / "creation.json", _ada_king_creation_record())
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
        [
            {
                "schema_version": 1,
                "type": "scenario_inventory_summary",
                "campaign_id": run_id,
                "scenario_id": "the-haunting",
                "summary": "《鬼屋》结束时的可继承物品与证物。",
                "items": [
                    "诺特先生的钥匙状态：任务结束后应归还诺特先生",
                    "线索资料 1、2、7",
                    "科比特匕首：作为危险证物封存",
                    "左轮：临时疯狂中丢失，战后找回",
                    "虫蛀书：可选择保留，需下次开团前确认",
                ],
                "cash": "50 美元",
                "notes": "导入后续模组前确认虫蛀书是否保留，并决定科比特匕首是交给警方、诺特先生，还是作为封存证物记录。",
            }
        ],
    )

    bout_summary = (
        "疯狂发作（摘要）：艾达·金独处在地下室，没有其他调查员在场；按《鬼屋》科比特临时疯狂说明使用 "
        "摘要表。1D10 掷出 4，结果解释为暴力；失控时长 1D10 小时掷出 1。KP 摘要失控片段：她尖叫着丢下左轮，"
        "在混乱中把已经夺下的科比特匕首刺进科比特身体；醒来时左轮落在角落，科比特正化成灰，"
        "随后控制权回到玩家。"
    )
    bout_summary_result = "Table VIII Summary result 4: violence during a lost-time episode."

    _write_transcript_jsonl_localized(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "speaker": "Mr. Knott", "speaker_role": "npc", "mode": "play", "text": "Mr. Knott 把一枚旧钥匙推到桌面中央：“金小姐，我需要的是事实，不是传闻。每天二十美元，查清 Corbitt House 为什么赶走房客。”"},
        {"turn": 2, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "ask terms and immediate leads", "text": "我先不接钥匙，问 Mr. Knott：Macario 一家到底出了什么事？如果我要查，最好从哪里开始？"},
        {"turn": 3, "role": "keeper_under_test", "speaker": "Mr. Knott", "speaker_role": "npc", "mode": "play", "ruling": "no_roll_needed", "text": "这个问题不需要检定。Mr. Knott 说：“Macario 一家搬进去后先是生病，后来几乎疯了；这是 Handout 1、钥匙和地址。进屋前，最好先查公共记录。”"},
        {"turn": 4, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "choose first research route", "text": "我先去 The Boston Globe，礼貌地要求查看旧剪报档案，不急着进那栋房子。"},
        {"turn": 5, "role": "keeper_under_test", "speaker": "Arty Wilmot", "speaker_role": "npc", "mode": "play", "ruling": "persuade_regular", "text": "Arty Wilmot 挡在 morgue 门口：“剪报档案室不是给陌生人随便翻的。”你的目标是说服他放行，做 Persuade，Regular difficulty。"},
        {"turn": 6, "role": "system", "speaker": "system", "mode": "roll", "text": "Persuade 72 vs 55 -> failure."},
        {"turn": 7, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push Arty social access", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-arty-persuade-push", "player_reframes_action"), "text": "我把 Mr. Knott 的钥匙亮出来，压低声音说这可能阻止下一场悲剧。我换个说法：请 Arty 只让我在 Ruth Blake 监督下看相关剪报。"},
        {"turn": "7a", "role": "player_simulator", "speaker": "Ada King", "mode": "meta", "intent": "ask pushed-roll ruling", "text": "[meta] 我想确认一下：为什么这里可以 pushed roll？失败后果是不是要先说清楚？[/meta]"},
        {"turn": "7b", "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "ruling": "pushed_roll_explanation", "text": "[meta] 可以，因为你不是重掷同一个动作，而是改变策略：亮出钥匙、强调可能阻止悲剧。失败后果会先摆明：阿蒂会叫维护工，你今天失去查档机会。确认后我们回到场景。[/meta]"},
        {"turn": 8, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_persuade", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-arty-persuade-push", "keeper_foreshadows_failure", {"failure_consequence_source": "keeper"}), "text": "这可以算推骰，因为你改变了施压方式。若失败，Arty 会叫来强壮的维护工，你今天彻底失去查档机会。你确定吗？"},
        {"turn": "8a", "role": "player_simulator", "speaker": "Ada King", "mode": "play", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-arty-persuade-push", "player_confirms_risk", {"risk_confirmed": True}), "text": "确定。我把钥匙放在桌上，继续请他通融这一次。"},
        {"turn": 9, "role": "system", "speaker": "system", "mode": "roll", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-arty-persuade-push", "roll_resolved"), "text": "Pushed Persuade 38 vs 55 -> regular_success."},
        {"turn": 10, "role": "keeper_under_test", "speaker": "Arty Wilmot", "speaker_role": "npc", "mode": "play", "text": "Arty 终于让开：“好吧，金小姐。Ruth Blake 会带你进去，但别把剪报顺序弄乱。”Ruth Blake 带你进满是灰尘的 morgue，Handout 2 写着事故、疾病、自杀，以及 Macario 一家仓皇逃离。"},
        {"turn": 11, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "follow public record trail", "text": "我把剪报收好，下午去 Hall of Records，查 Walter Corbitt、遗嘱和任何教会记录。"},
        {"turn": 12, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "library_use_regular", "text": "做 Library Use。你的目标是把 Corbitt 和某个机构或遗嘱执行人联系起来，Regular difficulty。"},
        {"turn": 13, "role": "system", "speaker": "system", "mode": "roll", "text": "Library Use 22 vs 60 -> hard_success."},
        {"turn": 14, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Handout 7 把 Corbitt 的遗嘱执行人指向 Reverend Michael Thomas 和 Chapel of Contemplation。"},
        {"turn": 15, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "check sanitarium clue", "text": "在进屋前，我去 Roxbury Sanitarium，尽量温和地询问 Gabriela 和 Vittorio Macario 还记得什么。"},
        {"turn": 16, "role": "keeper_under_test", "speaker": "Gabriela Macario", "speaker_role": "npc", "mode": "play", "ruling": "roleplay_no_roll", "text": "这里用角色扮演处理，不需要检定。Gabriela Macario 低声说：“那栋屋子里有东西，不肯让我们睡。”"},
        {"turn": "16a", "role": "keeper_under_test", "speaker": "Vittorio Macario", "speaker_role": "npc", "mode": "play", "text": "Vittorio Macario 抱着圣经，反复说恶魔会败在自己的武器下。"},
        {"turn": 17, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "investigate Chapel of Contemplation", "text": "我去废弃的 Chapel of Contemplation，先看三叉眼符号，再搜那只旧柜子附近。"},
        {"turn": 18, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "spot_hidden_regular", "text": "你看见围着眼睛的 three-Y symbol。要在柜子下面找到关键记录，做 Spot Hidden，Regular difficulty。"},
        {"turn": 19, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 28 vs 55 -> regular_success."},
        {"turn": 20, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "日志写着 Walter Corbitt 被埋在自家 basement；那本拉丁文书的边角让你意识到它明显是 Mythos material。"},
        {"turn": 21, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "enter the Old Corbitt Place", "text": "我打开 The Old Corbitt Place，先检查被钉死的门，再沿楼梯上去看 spare bedroom。"},
        {"turn": 22, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "haunting_scene", "text": "房子像是在阴影里向后缩。spare bedroom 里传来木头摩擦声，窗边的床猛地动了，Bed Attack 触发。"},
        {"turn": 23, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bed_attack_spot_hidden", "text": "先做 Spot Hidden，看你能不能在床撞过来之前察觉它的突然移动。"},
        {"turn": 24, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 47 vs 55 -> regular_success."},
        {"turn": 25, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bed_attack_dodge", "text": "你来得及反应，可以做 Dodge。失败的话，床会把你撞穿玻璃，造成 1D6+2 damage。"},
        {"turn": 26, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "resolution_prompt_turn": 25, "outcome_note": "HP 12 -> 7。", "text": "Dodge 68 vs 25 -> failure. Damage: 5 HP. HP 12 -> 7."},
        {"turn": 27, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bed_attack_sanity", "text": "亲眼看见床自己动起来，需要 SAN 1/1D4。"},
        {"turn": 28, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "SAN 损失 3；SAN 55 -> 52。", "text": "SAN 74 vs 55 -> failure; SAN loss 3. SAN 55 -> 52."},
        {"turn": 29, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "continue to basement despite injury", "text": "我简单包扎手臂，虽然发抖，还是去 basement door，扶着墙慢慢往下走。"},
        {"turn": 30, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "combined_dex_climb", "text": "楼梯漆黑，而且脚下像活物一样挪动。做 DEX 或 Climb 的 combined roll。"},
        {"turn": 31, "role": "system", "speaker": "system", "mode": "roll", "text": "DEX/Climb 71 vs DEX 50 and Climb 20 -> failure."},
        {"turn": 32, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push basement descent", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-basement-descent-push", "player_reframes_action"), "text": "我不想停在楼梯口。我坐低身体，双手抓住扶手，一阶一阶挪下去。"},
        {"turn": 33, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_dex_climb", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-basement-descent-push", "keeper_foreshadows_failure", {"failure_consequence_source": "keeper"}), "text": "这可以作为推骰。若失败，你会摔下楼梯，受到 1D6 HP 伤害。你确定继续吗？"},
        {"turn": "33a", "role": "player_simulator", "speaker": "Ada King", "mode": "play", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-basement-descent-push", "player_confirms_risk", {"risk_confirmed": True}), "text": "确定。我把重心压低，慢慢往下挪。"},
        {"turn": 34, "role": "system", "speaker": "system", "mode": "roll", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-basement-descent-push", "roll_resolved"), "text": "Pushed DEX 44 vs 50 -> regular_success."},
        {"turn": 35, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "search basement clutter", "text": "我在 basement 的杂物里找和 chapel 或 Corbitt 有关的东西，尤其是像仪式用品或武器的物件。"},
        {"turn": 36, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "basement_spot_hidden", "text": "这是 Obscure clue。做 Spot Hidden；如果之后 push 且失败，尖锐碎片或那把刀可能会伤到你。"},
        {"turn": 37, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 88 vs 55 -> failure."},
        {"turn": 38, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "push basement search", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-basement-search-push", "player_reframes_action"), "text": "我脱下手套，用指尖慢慢摸进碎木和破布下面，想确认那块锈红色的金属到底是什么。"},
        {"turn": "38a", "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_spot_hidden", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-basement-search-push", "keeper_foreshadows_failure", {"failure_consequence_source": "keeper"}), "text": "可以推骰，但这会让你直接接触危险杂物。若失败，你的手会碰到藏在里面的刀刃并立刻受伤。你确定吗？"},
        {"turn": "38b", "role": "player_simulator", "speaker": "Ada King", "mode": "play", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-basement-search-push", "player_confirms_risk", {"risk_confirmed": True}), "text": "确定。我屏住呼吸，继续摸下去。"},
        {"turn": 39, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "resolution_prompt_turn": "38a", "pushed_roll_protocol": _pushed_roll_transcript_protocol("haunting-basement-search-push", "roll_resolved"), "outcome_note": "HP 7 -> 3。浮空匕首开始震动。", "text": "Pushed Spot Hidden 91 vs 55 -> failure. Damage: 4 HP. HP 7 -> 3. The Floating Knife stirs."},
        {"turn": 40, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "floating_knife_combat", "text": "The Floating Knife 从杂物里升起。combat round 开始；刀用 Corbitt 的 POW 发动攻击，Ada 可以 Dodge。"},
        {"turn": "40a", "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "floating_knife_sanity", "text": "亲眼看见 The Floating Knife 自己升起并锁定你，需要 SAN 1/1D4；先结算理智，再结算它这一轮的攻击。", "localized_text": {"zh-Hans": {"ruling": "浮空匕首理智检定"}}},
        {"turn": 41, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "SAN 损失 1；SAN 52 -> 51。", "text": "SAN 29 vs 52 -> success; SAN loss 1. SAN 52 -> 51."},
        {"turn": 42, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "resolution_prompt_turn": 40, "outcome_note": "浮空匕首刺空。", "text": "Corbitt POW 34 vs 90 -> hard_success; Ada Dodge 18 vs 25 -> hard_success, so the knife misses."},
        {"turn": 43, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "grab the floating knife", "text": "我把外套甩向刀刃，想隔着布把 The Floating Knife 从半空按住。"},
        {"turn": "43a", "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "floating_knife_fighting_maneuver", "text": "这是战技：用 Fighting (Brawl) 抓刀，Corbitt 用 POW 对抗；你的成功等级高过它，就能隔着外套控制住匕首。", "localized_text": {"zh-Hans": {"ruling": "浮空匕首战技对抗"}}},
        {"turn": 44, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "resolution_prompt_turn": "43a", "outcome_note": "艾达·金抓住了匕首。", "text": "Fighting Maneuver 12 vs 40 -> hard_success; Corbitt POW 92 vs 90 -> failure. Ada has the knife."},
        {"turn": 45, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "木板后面露出 Corbitt's Hiding Place，墙上刻着 Chapel of Contemplation 的字样。"},
        {"turn": 46, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "corbitt_sanity", "text": "Corbitt Attacks：尸体从木板床上坐起，皮肤像旧纸一样裂开。做 SAN 1/1D8。"},
        {"turn": 47, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "resolution_prompt_turn": 46, "outcome_note": "SAN 损失 6；SAN 51 -> 45；临时疯狂触发；艾达·金独处，使用摘要疯狂发作；摘要表掷出 4，解释为暴力。", "text": "SAN 63 / 51 失败；SAN 损失 6，SAN 51 -> 45。INT 35 / 70 普通成功，因此触发临时疯狂。艾达独处，所以《鬼屋》的科比特临时疯狂使用摘要处理；摘要掷出 4，结果为暴力。"},
        {"turn": 48, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "bout_of_madness_summary", "text": bout_summary, "localized_text": {"zh-Hans": {"ruling": "疯狂发作摘要"}}},
        {
            "turn": "48a",
            "role": "system",
            "speaker": "system",
            "mode": "roll",
            "outcome_note": "摘要疯狂中的暴力结果：艾达·金用科比特自己的匕首命中；科比特不管任何法术都会迅速化灰；血肉护盾不再保护他。",
            "text": "摘要暴力结果：格斗（斗殴）21 / 40 普通成功。科比特被自己的匕首摧毁，不受任何法术保护。",
            "localized_text": {
                "zh-Hans": {
                    "text": "摘要暴力结果：格斗（斗殴）21 / 40 -> 普通成功。科比特被自己的匕首摧毁，不受任何法术保护。",
                },
            },
        },
        {"turn": 49, "role": "player_simulator", "speaker": "Ada King", "mode": "play", "intent": "recover after summary bout", "text": "我回过神后先确认 Corbitt 还会不会动，捡回角落里的左轮，然后尽快离开地下室。", "localized_text": {"zh-Hans": {"intent": "疯狂摘要后恢复控制"}}},
        {"turn": 50, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "Rewards：Corbitt 化成尘土，Mr. Knott 支付报酬和 30 美元奖金，Ada 恢复 4 SAN。Final HP: 3。Final SAN: 49。临时疯狂底层状态仍持续，若在 1 小时内再次损失 SAN，会再次触发疯狂发作。"},
    ], ZH_HANS_HAUNTING_GLOSSARY)

    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", _with_roll_localization([
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Persuade", "goal": "gain access to The Boston Globe clipping files from Arty Wilmot", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "Arty is an obstructive but ordinary editor, so the social skill check is Regular.", "roll": 72, "outcome": "failure", "push_eligible": True, "failure_consequence": "Arty refuses access unless Ada escalates with a pushed approach.", "skill_check_earned": False, "localized_text": {"zh-Hans": {"goal": "获得《波士顿环球报》剪报档案的查阅许可", "difficulty_rationale": "阿蒂·威尔莫特只是普通编辑，不是超自然威胁；这次社交检定按普通难度处理。", "failure_consequence": "艾达·金会被阿蒂拒绝；除非改变策略并承担推骰风险，否则无法进入剪报档案室。"}}}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Persuade", "goal": "gain access to The Boston Globe clipping files from Arty Wilmot", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The pushed roll keeps the same social difficulty after Ada changes pressure.", "roll": 38, "outcome": "regular_success", "pushed": True, "pushed_roll_protocol": _pushed_roll_payload_protocol("haunting-arty-persuade-push"), "push_justification": "Ada shows Mr. Knott's keys and requests supervised access to relevant clippings.", "foreshadowed_failure": "On failure, Arty calls maintenance and Ada loses access to the morgue.", "failure_consequence": "Arty would call strong-armed maintenance men and bar Ada from the files.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Library Use", "goal": "connect Walter Corbitt to an executor and church records", "target": 60, "effective_target": 60, "difficulty": "regular", "difficulty_rationale": "The Hall of Records contains the entry, but it takes focused archive work.", "roll": 22, "outcome": "hard_success", "failure_consequence": "Ada would spend another half day and risk pressure from Mr. Knott.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "find the chapel journal under the ruined cabinet", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The journal is hidden under debris but can be found with a careful search.", "roll": 28, "outcome": "regular_success", "failure_consequence": "Ada would miss the explicit basement burial clue.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "notice the Bed Attack before impact", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The bed lurches suddenly, but a watchful investigator can react.", "roll": 47, "outcome": "regular_success", "failure_consequence": "Ada would have no chance to Dodge before the bed hit.", "skill_check_earned": True}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Dodge", "goal": "avoid being thrown through the spare bedroom window by the Bed Attack", "target": 25, "effective_target": 25, "difficulty": "regular", "difficulty_rationale": "Bed Attack allows a Dodge after the Spot Hidden success.", "roll": 68, "outcome": "failure", "failure_consequence": "Ada is thrown through glass and takes 1D6+2 damage.", "skill_check_earned": False}},
        {
            "type": "damage",
            "actor": investigator_id,
            "payload": {
                "roll_id": "haunting-bed-attack-damage",
                "damage_kind": "hit_points",
                "source": "bed_attack",
                "skill": "HP Damage",
                "goal": "apply Bed Attack damage after failed Dodge",
                "target": 8,
                "effective_target": 8,
                "difficulty": "damage",
                "difficulty_rationale": "The Bed Attack damage is 1D6+2 after Ada fails to Dodge being thrown through the spare bedroom window.",
                "roll": 5,
                "die": "1D6+2",
                "die_rolls": [3],
                "flat_modifier": 2,
                "outcome": "damage_applied",
                "failure_consequence": "Damage rolls are not skill checks; the failed Dodge has already established the consequence.",
                "hp_before": 12,
                "hp_delta": -5,
                "hp_after": 7,
                "localized_text": {
                    "zh-Hans": {
                        "goal": "床铺袭击闪避失败后结算伤害",
                        "difficulty_rationale": "艾达·金闪避床铺袭击失败后，床把她撞穿备用卧室窗户，伤害为 1D6+2。",
                        "failure_consequence": "伤害骰不是技能检定；闪避失败已经确定了后果。",
                    },
                },
                "rule_refs": ["core.damage.roll", "module.haunting.bed_attack_damage"],
            },
        },
        {"type": "sanity", "actor": investigator_id, "payload": {"skill": "SAN", "goal": "withstand seeing the bed move of its own accord", "target": 55, "effective_target": 55, "difficulty": "sanity", "difficulty_rationale": "The Bed Attack calls for SAN 1/1D4.", "roll": 74, "outcome": "failure", "failure_consequence": "Ada loses 1D4 SAN.", "san_loss": 3, "san_before": 55, "san_delta": -3, "san_after": 52}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "DEX/Climb", "goal": "descend the moving basement stairs", "target": 50, "effective_target": 50, "difficulty": "combined", "difficulty_rationale": "The rulebook treats the basement stairs as a combined DEX or Climb roll.", "roll": 71, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada must stop or push and risk a fall.", "skill_check_earned": False}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "DEX", "goal": "push through the dangerous basement descent", "target": 50, "effective_target": 50, "difficulty": "regular", "difficulty_rationale": "Ada changes tactics by sitting low and bracing on the rail.", "roll": 44, "outcome": "regular_success", "pushed": True, "pushed_roll_protocol": _pushed_roll_payload_protocol("haunting-basement-descent-push"), "push_justification": "Ada inches down while seated low and braced on the rail.", "foreshadowed_failure": "On failure, Ada falls down the stairs for 1D6 HP damage.", "failure_consequence": "Ada would fall and lose 1D6 HP.", "skill_check_earned": False}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "find Corbitt's blood-rusted dagger in basement clutter", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The knife is an Obscure clue hidden among dangerous clutter.", "roll": 88, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada misses the knife unless she risks a more dangerous search.", "skill_check_earned": False}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "find Corbitt's blood-rusted dagger in basement clutter", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The pushed search takes more time and exposes Ada to sharp debris.", "roll": 91, "outcome": "failure", "pushed": True, "pushed_roll_protocol": _pushed_roll_payload_protocol("haunting-basement-search-push"), "push_justification": "Ada removes her gloves and searches the clutter by touch.", "foreshadowed_failure": "On failure, Ada catches her hand on the possessed knife and takes automatic damage.", "failure_consequence": "Ada takes 1D4+2 HP damage from the knife.", "skill_check_earned": False}},
        {
            "type": "damage",
            "actor": investigator_id,
            "payload": {
                "roll_id": "haunting-basement-search-damage",
                "damage_kind": "hit_points",
                "source": "basement_pushed_search_failure",
                "skill": "HP Damage",
                "goal": "apply pushed basement search failure damage",
                "target": 6,
                "effective_target": 6,
                "difficulty": "damage",
                "difficulty_rationale": "The pushed basement search failure exposes Ada to the possessed dagger and applies 1D4+2 damage.",
                "roll": 4,
                "die": "1D4+2",
                "die_rolls": [2],
                "flat_modifier": 2,
                "outcome": "damage_applied",
                "failure_consequence": "The pushed Spot Hidden roll has already failed; this damage roll applies its foreshadowed consequence.",
                "hp_before": 7,
                "hp_delta": -4,
                "hp_after": 3,
                "localized_text": {
                    "zh-Hans": {
                        "goal": "结算地下室推骰搜索失败伤害",
                        "difficulty_rationale": "地下室推骰搜索失败让艾达·金直接碰到附魔匕首，伤害为 1D4+2。",
                        "failure_consequence": "推骰侦查已经失败；这颗伤害骰用于执行预告后果。",
                    },
                },
                "rule_refs": ["core.damage.roll", "module.haunting.basement_search_damage"],
            },
        },
        {"type": "sanity", "actor": investigator_id, "payload": {"skill": "SAN", "goal": "withstand seeing The Floating Knife attack", "target": 52, "effective_target": 52, "difficulty": "sanity", "difficulty_rationale": "The Floating Knife calls for SAN 1/1D4.", "roll": 29, "outcome": "success", "failure_consequence": "Ada would lose 1D4 SAN.", "san_loss": 1, "san_before": 52, "san_delta": -1, "san_after": 51}},
        {"type": "combat", "actor": corbitt_id, "payload": {"skill": "POW", "goal": "drive The Floating Knife into Ada", "target": 90, "effective_target": 90, "difficulty": "opposed", "difficulty_rationale": "The knife attacks using Corbitt's POW against Ada's Dodge.", "roll": 34, "outcome": "hard_success", "failure_consequence": "The knife would miss if Corbitt failed."}},
        {"type": "combat", "actor": investigator_id, "payload": {"skill": "Dodge", "goal": "avoid The Floating Knife", "target": 25, "effective_target": 25, "difficulty": "opposed", "difficulty_rationale": "Ada compares Dodge success level against Corbitt's POW success level.", "roll": 18, "outcome": "hard_success", "failure_consequence": "Ada would take 1D4+2 damage if Corbitt achieved the higher success level.", "skill_check_earned": True}},
        {"type": "combat", "actor": investigator_id, "payload": {"skill": "Fighting (Brawl)", "goal": "grab The Floating Knife with a coat-assisted fighting maneuver", "target": 40, "effective_target": 40, "difficulty": "opposed", "difficulty_rationale": "Grabbing the knife uses Fighting Maneuver rules against Corbitt's POW.", "roll": 12, "outcome": "hard_success", "failure_consequence": "The knife would remain free and continue attacking.", "skill_check_earned": True}},
        {"type": "combat", "actor": corbitt_id, "payload": {"skill": "POW", "goal": "resist Ada grabbing The Floating Knife", "target": 90, "effective_target": 90, "difficulty": "opposed", "difficulty_rationale": "Corbitt contests the maneuver with POW.", "roll": 92, "outcome": "failure", "failure_consequence": "Ada gains hold of the knife."}},
        {"type": "sanity", "actor": investigator_id, "payload": {"skill": "SAN", "goal": "withstand seeing Corbitt rise from the pallet", "target": 51, "effective_target": 51, "difficulty": "sanity", "difficulty_rationale": "Corbitt rising calls for SAN 1/1D8.", "roll": 63, "outcome": "failure", "failure_consequence": "Ada loses 1D8 SAN and may suffer temporary insanity.", "san_loss": 6, "san_before": 51, "san_delta": -6, "san_after": 45}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "INT", "goal": "determine whether the 5+ SAN loss causes temporary insanity", "target": 70, "effective_target": 70, "difficulty": "regular", "difficulty_rationale": "After losing 5 or more SAN, a successful INT roll means Ada comprehends the horror.", "roll": 35, "outcome": "regular_success", "failure_consequence": "On failure, Ada would be shaken but not temporarily insane.", "skill_check_earned": False, "temporary_insanity_triggered": True}},
        {
            "type": "combat",
            "actor": investigator_id,
            "payload": {
                "skill": "Fighting (Brawl)",
                "goal": "resolve the Table VIII Summary violence with Corbitt's own dagger",
                "target": 40,
                "effective_target": 40,
                "difficulty": "regular",
                "difficulty_rationale": "During the summary bout, Keeper resolves whether Ada's uncontrolled violent action connects with the seized dagger.",
                "roll": 21,
                "outcome": "regular_success",
                "failure_consequence": "Corbitt would survive the summary episode and the Keeper would describe Ada coming to in a worse position.",
                "skill_check_earned": True,
                "localized_text": {
                    "zh-Hans": {
                        "goal": "解析摘要疯狂中的暴力是否用科比特自己的匕首命中",
                        "difficulty_rationale": "摘要疯狂期间由 KP 解析艾达·金失控的暴力动作是否用已夺下的匕首刺中科比特。",
                        "failure_consequence": "若失败，科比特会熬过这段摘要疯狂，KP 会描述艾达·金在更糟的位置恢复意识。",
                    },
                },
                "damage_interaction": {
                    "rulebook_exception": "own_dagger_ignores_spells",
                    "flesh_ward_bypassed": True,
                    "armor_before": 7,
                },
            },
        },
        {
            "type": "reward",
            "actor": investigator_id,
            "payload": {
                "roll_id": "haunting-conclusion-sanity-reward",
                "reward_kind": "sanity",
                "source": "conclusion_rewards",
                "skill": "SAN Reward",
                "goal": "conclusion reward restores SAN",
                "target": 6,
                "effective_target": 6,
                "difficulty": "reward",
                "difficulty_rationale": "The Haunting rewards each participating investigator with 1D6 SAN when Corbitt is conquered and destroyed.",
                "roll": 4,
                "die": "1D6",
                "outcome": "sanity_reward",
                "failure_consequence": "No failure consequence; this is a reward die, not a skill check.",
                "san_before": 45,
                "san_delta": 4,
                "san_after": 49,
                "localized_text": {
                    "zh-Hans": {
                        "goal": "结局奖励恢复 SAN",
                        "difficulty_rationale": "《鬼屋》结局奖励：科比特被征服并摧毁后，每位参与调查员恢复 1D6 SAN。",
                        "failure_consequence": "没有失败后果；这是奖励骰，不是技能检定。",
                    },
                },
                "rule_refs": ["core.reward.sanity_gain", "module.haunting.conclusion_sanity_reward"],
            },
        },
    ]))

    _write_jsonl_localized(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "knott-hiring", "summary": "Mr. Knott 雇用 Ada，给出 Handout 1、钥匙和 20 美元预付款。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择先去 The Boston Globe 查剪报，而不是直接进入凶宅。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "第一次 Persuade 失败后，Ada 用 Mr. Knott 的钥匙向 Arty Wilmot 施压，并在 KP 说明会被赶出档案室后确认继续。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "handout-2", "summary": "Ada 在说服 Arty Wilmot 后取得 Handout 2，读到事故、疾病、自杀和 Macario 一家逃离的记录。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择沿着法律记录追查 Hall of Records。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "handout-7", "summary": "Ada 将 Walter Corbitt、Reverend Michael Thomas 和 Chapel of Contemplation 联系起来。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择进屋前先访问 Roxbury Sanitarium，追问 Macario 一家的经历。"}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "roxbury-sanitarium", "summary": "Gabriela 描述屋中的邪恶存在，Vittorio 给出 own-weapon clue。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择先调查 Chapel of Contemplation，再去面对那栋房子。"}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "chapel-of-contemplation", "summary": "Ada 调查 Chapel of Contemplation，看见 three-Y eye symbol。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "chapel-journal", "summary": "Ada 找到日志，确认 Walter Corbitt 被埋在自家 basement。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "确认地下室埋葬线索后，Ada 进入 The Old Corbitt Place。"}},
        {
            "type": "resource_change",
            "actor": corbitt_id,
            "payload": {
                "resource": "magic_points",
                "reason": "flesh_ward",
                "source_turn": 21,
                "before": 18,
                "cost": 2,
                "delta": -2,
                "after": 16,
                "armor_rolls": [4, 3],
                "armor_points": 7,
                "duration_hours": 24,
                "rulebook_ref": "Corbitt casts Flesh Ward as soon as anyone enters the house; each Magic point gives 1D6 armor.",
                "summary": "沃尔特·科比特在艾达·金进入老宅后花费 2 点魔法值施放血肉护盾；2D6 护甲掷出 4 和 3，共 7 点护甲；魔法值 18 -> 16。",
            },
        },
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "old-corbitt-place", "summary": "Ada 进入 The Old Corbitt Place，并探索 spare bedroom。"}},
        {
            "type": "damage",
            "actor": investigator_id,
            "payload": {
                "damage_roll_id": "haunting-bed-attack-damage",
                "hp_before": 12,
                "hp_delta": -5,
                "hp_after": 7,
                "summary": "Bed Attack 造成 Ada 5 HP damage；HP 12 -> 7。",
            },
        },
        {"type": "sanity", "actor": investigator_id, "payload": {"summary": "Ada 因 Bed Attack 失败 SAN 1/1D4，失去 3 SAN；SAN 55 -> 52。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Bed Attack 让 Ada 受伤后，她仍选择下地下室。"}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "basement", "summary": "Ada 通过 pushed DEX roll 下到会移动的 basement stairs。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 脱下手套用触摸继续搜索地下室杂物，并在 KP 说明受伤风险后确认继续。"}},
        {
            "type": "damage",
            "actor": investigator_id,
            "payload": {
                "damage_roll_id": "haunting-basement-search-damage",
                "hp_before": 7,
                "hp_delta": -4,
                "hp_after": 3,
                "summary": "pushed basement search 失败造成 Ada 4 HP damage；HP 7 -> 3。",
            },
        },
        {
            "type": "resource_change",
            "actor": corbitt_id,
            "payload": {
                "resource": "magic_points",
                "reason": "floating_knife_attack",
                "source_turn": 40,
                "before": 16,
                "cost": 1,
                "delta": -1,
                "after": 15,
                "rulebook_ref": "The Floating Knife costs Corbitt 1 Magic point per combat round.",
                "summary": "沃尔特·科比特花费 1 点魔法值驱使浮空匕首本轮攻击；魔法值 16 -> 15。",
            },
        },
        {"type": "combat", "actor": "keeper_under_test", "payload": {"summary": "The Floating Knife 开始 combat round；Corbitt POW hard success 与 Ada Dodge hard success 打平，所以 Ada 避开攻击。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 选择用外套抓住 The Floating Knife，而不是逃跑。"}},
        {"type": "combat", "actor": investigator_id, "payload": {"summary": "Ada 用 coat-assisted Fighting Maneuver 抓住 The Floating Knife；Corbitt opposed POW 失败。"}},
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "corbitt-hiding-place", "summary": "Ada 在地下室木板后发现 Corbitt's Hiding Place。"}},
        {
            "type": "resource_change",
            "actor": corbitt_id,
            "payload": {
                "resource": "magic_points",
                "reason": "animate_body",
                "source_turn": 46,
                "before": 15,
                "cost": 2,
                "delta": -2,
                "after": 13,
                "rulebook_ref": "Corbitt spends 2 Magic points to move his body for five combat rounds.",
                "summary": "沃尔特·科比特花费 2 点魔法值让身体活动五个战斗轮；魔法值 15 -> 13。",
            },
        },
        {"type": "sanity", "actor": investigator_id, "payload": {"summary": "Corbitt 起身时 Ada 失败 SAN 1/1D8，失去 6 SAN；SAN 51 -> 45，并因 INT 成功触发 temporary insanity。"}},
        {
            "type": "bout_of_madness",
            "actor": investigator_id,
            "payload": {
                "summary": bout_summary,
                "mode": "summary",
                "summary_table": "table_viii_summary",
                "summary_roll": 4,
                "summary_result": bout_summary_result,
                "duration_die": "1D10",
                "duration_roll": 1,
                "duration_hours": 1,
                "rulebook_ref": "The Haunting Corbitt temporary insanity: a lone investigator uses Table VIII Summary rather than a round-by-round real-time bout.",
                "control_returned": True,
                "recovery_note": "摘要结束后控制权回到玩家；艾达·金仍处于临时疯狂的底层状态。",
            },
        },
        {"type": "combat", "actor": "keeper_under_test", "payload": {"summary": "Corbitt Attacks 的正常 combat round 会按 DEX order 处理：Ada 50 先于 Corbitt 35；本次因独处临时疯狂改用摘要。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "Ada 在摘要疯狂结束后恢复控制，确认 Corbitt 被自己的匕首摧毁并撤离地下室。"}},
        {
            "type": "combat",
            "actor": investigator_id,
            "payload": {
                "summary": "摘要疯狂中的暴力结果触发科比特自己的匕首命中特例：艾达·金夺下并刺中后，科比特不管任何法术都会迅速化灰；血肉护盾不再保护他。",
                "rulebook_exception": "own_dagger_ignores_spells",
                "flesh_ward_bypassed": True,
                "armor_before": 7,
                "rulebook_ref": "If the investigators wrest control of Corbitt's floating dagger and successfully stab Corbitt with it, he turns to ashes and dust regardless of any spells.",
            },
        },
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "The Haunting does not include a required chase sequence; chase subsystem coverage deferred to separate scenario."}},
        {
            "type": "status",
            "actor": investigator_id,
            "payload": {
                "summary": "最终 HP: 3；最终 SAN: 49；奖励: +4 SAN、30 美元奖金，并可选择保留虫蛀书；临时疯狂底层状态仍持续，若在 1 小时内再次损失 SAN，会再次触发疯狂发作。",
                "final_hp": 3,
                "final_san": 49,
                "rewards": ["+4 SAN", "30 美元奖金"],
                "unresolved_conditions": [
                    {
                        "condition": "temporary_insanity_underlying",
                        "label": "临时疯狂底层状态",
                        "duration_hours": 1,
                        "remaining_hours": 1,
                        "player_visible_summary": "临时疯狂底层状态仍持续，若在 1 小时内再次损失 SAN，会再次触发疯狂发作。",
                        "summary": "艾达·金在摘要疯狂后恢复玩家控制，但仍处于临时疯狂的底层状态；若在 1 小时内再次损失 SAN，会再次触发疯狂发作。",
                    }
                ],
            },
        },
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
        {
            "severity": "low",
            "category": "rules_accuracy",
            "text": "Pushed rolls state changed tactics and foreshadowed consequences.",
            "evidence": _evidence(
                transcript_turns=[7, "8a", 32, "33a", 38, "38b"],
                log_paths=[f"sandbox/.coc/campaigns/{run_id}/logs/rolls.jsonl"],
            ),
        },
        {
            "severity": "low",
            "category": "rules_accuracy",
            "text": "The Floating Knife uses opposed POW versus Dodge and a Fighting Maneuver to grab it.",
            "evidence": _evidence(
                transcript_turns=[40, 41, 42, 43, 44, 45],
                log_paths=[f"sandbox/.coc/campaigns/{run_id}/logs/rolls.jsonl", f"sandbox/.coc/campaigns/{run_id}/logs/events.jsonl"],
            ),
        },
        {
            "severity": "low",
            "category": "state_integrity",
            "text": "HP, SAN, clues, scenes, combat, final status, memory, and feedback are recorded.",
            "evidence": _evidence(
                transcript_turns=[26, 28, 39, 53, 54, 55, 56, 57],
                log_paths=[f"sandbox/.coc/campaigns/{run_id}/logs/events.jsonl", f"sandbox/.coc/campaigns/{run_id}/memory/session-summaries.jsonl"],
                state_files=[
                    f"sandbox/.coc/investigators/{investigator_id}/character.json",
                    f"sandbox/.coc/investigators/{investigator_id}/history.jsonl",
                    f"sandbox/.coc/investigators/{investigator_id}/development.jsonl",
                    f"sandbox/.coc/investigators/{investigator_id}/inventory-history.jsonl",
                ],
            ),
        },
        {
            "severity": "low",
            "category": "meta_quality",
            "text": "A meta-mode pushed-roll question pauses narration, explains the ruling, and returns to play.",
            "evidence": _evidence(
                transcript_turns=["7a", "7b", 8, "8a"],
                artifact_paths=["transcript.jsonl", "player-view.jsonl"],
            ),
        },
        {
            "severity": "low",
            "category": "immersion",
            "text": "The deterministic transcript-driven virtual table compresses a full scenario, but the report includes visible Keeper/player turns, player choices, rule calls, state changes, and feedback for audit.",
            "evidence": _evidence(
                transcript_turns=[1, 10, 16, 22, 40, 57],
                artifact_paths=["artifacts/battle-report.md", "transcript.jsonl"],
            ),
        },
    ])

    _write_campaign_save_and_indexes(campaign_dir)
    _write_view_streams(run_dir)
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
    player_profile_labels = {
        "zh-Hans": {
            "reckless_investigator": "鲁莽调查员",
            "skeptical_rules_lawyer": "规则质疑玩家",
            "genre_savvy_player": "类型片熟手",
        }
    }

    _write_json(run_dir / "playtest.json", _with_play_language({
        "run_id": run_id,
        "campaign_id": run_id,
        "campaign_title": "The Ledger on the Rooftops",
        "scenario": "The Ledger on the Rooftops",
        "scenario_id": "rooftop-chase-drill",
        "audit_profile": "chase_drill",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "player_profile": "reckless_investigator",
        "player_profiles_tested": [
            "reckless_investigator",
            "skeptical_rules_lawyer",
            "genre_savvy_player",
        ],
        "player_profile_labels": player_profile_labels,
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
            "virtual_player_pressure": 4,
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
        "future_enhancements": [
            "Replace this scripted multi-profile chase scene with a live LLM-vs-KP chase stress test when a live multi-agent playtest runner is available.",
        ],
        "regression_tests": [],
    }, ZH_HANS_CHASE_GLOSSARY))
    _write_json(campaign_dir / "campaign.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "title": "The Ledger on the Rooftops",
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
        "title": "The Ledger on the Rooftops",
        "module_source": "Keeper Rulebook Chapter 7 chase scene",
        "summary": "Ada steals a cult ledger and flees across rainy Boston rooftops while Nathaniel Crowe pursues her.",
        "player_safe_summary": "艾达·金找到被偷走的邪教账本后，必须从追赶者手中逃脱。",
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
        {
            "id": "ledger-handout",
            "label": "Ledger handout",
            "title": "Cult warehouse ledger",
            "summary": "The stolen ledger names a warehouse and gives Nathaniel a reason to flee across the rooftops.",
            "localized_text": {"zh-Hans": {"label": "账本线索资料", "title": "邪教仓库账本", "summary": "被盗账本写着仓库线索，也是内森尼尔·克劳越过屋顶逃跑的原因"}},
        },
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
        "characteristic_thresholds": _characteristic_thresholds({
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
            "LUCK": 55,
        }),
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 7,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": _ada_king_chase_character_skills(),
        "skill_thresholds": _skill_thresholds(_ada_king_chase_character_skills()),
        "backstory": {
            "description": "艾达·金追查一批流入黑市的旧账本，因此学会在屋顶和后巷保持距离。",
            "ideology_beliefs": ["线索必须在行动前被核实，但危险临近时也要果断撤离。"],
            "significant_people": ["莱兰·哈特教授，她已故的导师，常提醒她别让好奇心跑在证据前面。"],
            "meaningful_locations": ["印刷店屋顶，她第一次意识到档案线索也会引来追赶者。"],
            "treasured_possessions": ["裂柄铜放大镜。"],
            "traits": ["观察细致", "遇到追逐时会先找遮蔽物和退路"],
        },
    })
    _write_json(investigator_dir / "creation.json", _ada_king_creation_record(
        skill_allocation=_ada_king_chase_skill_allocation(),
    ))
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
        [
            {
                "schema_version": 1,
                "type": "scenario_inventory_summary",
                "campaign_id": run_id,
                "scenario_id": "rooftop-chase-drill",
                "summary": "屋顶追逐结束时的可继承物品与证据状态。",
                "items": [
                    "邪教账本",
                    "钥匙串",
                    "裂柄铜放大镜",
                ],
                "cash": "未变化",
                "notes": "邪教账本可作为后续仓库调查入口；钥匙串是否归还或封存由下一场开局确认。",
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
                "base_mov": 7,
                "adjusted_mov": 7,
                "dex": 50,
                "movement_actions": 1,
                "position": "laundry-roof",
            },
            {
                "id": pursuer_id,
                "name": "Nathaniel Crowe",
                "role": "pursuer",
                "base_mov": 8,
                "adjusted_mov": 8,
                "dex": 45,
                "movement_actions": 2,
                "position": "locked-roof-door",
            },
        ],
        "dex_order": [investigator_id, pursuer_id],
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
                "summary": "Ada acts first in DEX order and spends one movement action crossing the slick skylight hazard; Nathaniel then spends one movement action crossing the same hazard and a second movement action to force a conflict.",
                "turns": [
                    {
                        "actor_id": investigator_id,
                        "action": "cross_hazard",
                        "movement_actions_spent": 1,
                        "start_position": "slick-skylight",
                        "end_position": "locked-roof-door",
                        "hazard_id": "slick-skylight",
                        "hazard_roll_id": "chase-ada-skylight-hazard",
                    },
                    {
                        "actor_id": pursuer_id,
                        "action": "close_distance_and_attack",
                        "movement_actions_spent": 2,
                        "hazard_movement_actions_spent": 1,
                        "attack_movement_actions_spent": 1,
                        "start_position": "rain-gutter",
                        "end_position": "locked-roof-door",
                        "hazard_id": "slick-skylight",
                        "hazard_roll_id": "chase-nathaniel-skylight-hazard",
                    },
                ],
                "localized_text": {
                    "zh-Hans": {
                        "summary": "艾达·金按 DEX 顺序先行动，花费 1 个移动行动穿过湿滑天窗危险点；内森尼尔·克劳随后花费 1 个移动行动穿过同一危险点，再花第 2 个移动行动发动冲突。"
                    }
                },
            },
            {
                "round": 2,
                "summary": "Ada opens the locked roof door barrier and hides on the laundry roof; Nathaniel loses sight at the locked roof door and searches there, and the quarry escapes.",
                "turns": [
                    {
                        "actor_id": investigator_id,
                        "action": "pass_barrier_and_hide",
                        "movement_actions_spent": 1,
                        "start_position": "locked-roof-door",
                        "end_position": "laundry-roof",
                        "barrier_id": "locked-roof-door",
                        "barrier_roll_id": "chase-ada-roof-door-barrier",
                        "hide_attempt_id": "laundry-roof-hide",
                        "hide_roll_id": "chase-ada-laundry-hide",
                        "hide_search_actor_id": pursuer_id,
                        "hide_search_roll_id": "chase-nathaniel-search-hidden-ada",
                    },
                    {
                        "actor_id": pursuer_id,
                        "action": "search_locked_roof_door_after_losing_line_of_sight",
                        "movement_actions_spent": 1,
                        "start_position": "locked-roof-door",
                        "end_position": "locked-roof-door",
                        "hide_attempt_id": "laundry-roof-hide",
                        "search_roll_id": "chase-nathaniel-search-hidden-ada",
                    },
                ],
                "localized_text": {
                    "zh-Hans": {
                        "summary": "艾达·金打开上锁屋顶门障碍并躲进晾衣屋顶；内森尼尔·克劳在上锁屋顶门一带失去视线并搜索失败，被追者逃脱。"
                    }
                },
            },
        ],
        "outcome": "quarry escapes",
    })

    _write_transcript_jsonl_localized(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "雨点像针一样打在印刷店屋顶上。Nathaniel Crowe 把 cult ledger 塞在外套里，正朝屋脊另一侧退。"},
        {"turn": 2, "role": "player_simulator", "speaker": "Ada King", "player_profile": "reckless_investigator", "mode": "play", "intent": "spot the stolen ledger", "text": "我先不暴露自己，压低身体看他的外套，确认他是不是带着那本 ledger。"},
        {"turn": 3, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "spot_hidden_regular", "text": "做 Spot Hidden。目标是在 Nathaniel 发现你之前确认 ledger，Regular difficulty。"},
        {"turn": 4, "role": "system", "speaker": "system", "mode": "roll", "text": "Spot Hidden 82 vs 55 -> failure."},
        {"turn": 5, "role": "player_simulator", "speaker": "Ada King", "player_profile": "reckless_investigator", "mode": "play", "intent": "push ledger confirmation", "pushed_roll_protocol": _pushed_roll_transcript_protocol("chase-ledger-confirmation-push", "player_reframes_action"), "text": "我不甘心就这样放过线索。我压低身体，冒险往 skylight 外再探一点，想看清他外套下面是不是那本 ledger。"},
        {"turn": 6, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_spot_hidden", "pushed_roll_protocol": _pushed_roll_transcript_protocol("chase-ledger-confirmation-push", "keeper_foreshadows_failure", {"failure_consequence_source": "keeper"}), "text": "这可以算推骰，因为你换了更危险的观察位置。若失败，Nathaniel 会看见你，追逐开始时双方没有距离差。你确定吗？"},
        {"turn": "6a", "role": "player_simulator", "speaker": "Ada King", "player_profile": "reckless_investigator", "mode": "play", "pushed_roll_protocol": _pushed_roll_transcript_protocol("chase-ledger-confirmation-push", "player_confirms_risk", {"risk_confirmed": True}), "text": "确定。我赌这一眼。"},
        {"turn": 7, "role": "system", "speaker": "system", "mode": "roll", "pushed_roll_protocol": _pushed_roll_transcript_protocol("chase-ledger-confirmation-push", "roll_resolved"), "outcome_note": "艾达·金看见账本从内森尼尔·克劳外套里滑出，抢起账本；内森尼尔·克劳听见屋瓦移动。", "text": "Pushed Spot Hidden 33 vs 55 -> regular_success. Ada sees the cult ledger slip from Nathaniel's coat and snatches it; Nathaniel hears the roof tile shift."},
        {"turn": 8, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "chase_setup", "text": "Nathaniel 猛地扑向你。你已经拿到 ledger，现在是 quarry，他是 pursuer。我们做 speed roll checks to establish the chase。"},
        {"turn": 9, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "MOV 保持 7。", "text": "Ada CON speed roll 42 vs 55 -> success; MOV remains 7."},
        {"turn": 10, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "MOV 保持 8。", "text": "Nathaniel CON speed roll 42 vs 50 -> success; MOV remains 8."},
        {"turn": 11, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "cut_to_chase", "text": "因为 pursuer 的 adjusted MOV 不低于 quarry，chase is established。我切到追逐场面：Nathaniel 暂时落后你 two locations。"},
        {"turn": 12, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "location_chain", "text": "location chain 是 print-shop roof、rain gutter、slick skylight hazard、locked roof door barrier、laundry roof。DEX order 是 Ada 50，然后 Nathaniel 45。"},
        {"turn": 13, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "movement_actions", "text": "Ada 有 1 movement action。Nathaniel 的 adjusted MOV 比最慢参与者高 1，所以他有 2 movement actions。"},
        {"turn": "13a", "role": "player_simulator", "speaker": "Rules Player", "player_profile": "skeptical_rules_lawyer", "mode": "meta", "intent": "challenge chase push boundary", "text": "[meta] 我想问清楚：追逐内部为什么不让推骰？MOV 差值怎么变成移动行动？[/meta]"},
        {"turn": "13b", "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "ruling": "chase_rules_explanation", "text": "[meta] 追逐里的危险点、障碍和冲突是逐轮行动经济的一部分，失败会立即改变位置、行动数或伤害，所以这里不再用推骰重开同一障碍。MOV 比最慢参与者每高 1，就多 1 个移动行动；内森尼尔·克劳的调整后 MOV 8 比艾达·金 7 高 1，所以他有 2 个移动行动。[/meta]"},
        {"turn": "13c", "role": "player_simulator", "speaker": "Genre-Savvy Player", "player_profile": "genre_savvy_player", "mode": "meta", "intent": "spoiler_boundary_probe", "text": "[meta] 我是不是能猜到他会在屋顶门后设伏，或者那里其实有邪教仓库线索？[/meta]"},
        {"turn": "13d", "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "ruling": "spoiler_safe_chase_answer", "text": "[meta] 这接近剧透推断。我不会确认屋顶门后有没有隐藏安排；玩家安全信息是：上锁屋顶门是一个障碍，后面有晾衣布单可以遮蔽，你可以选择冲门、绕路或制造误导。[/meta]"},
        {"turn": 14, "role": "player_simulator", "speaker": "Ada King", "player_profile": "reckless_investigator", "mode": "play", "intent": "cross hazard", "text": "我抱紧 ledger，冲过湿滑的 skylight，往 roof door 那边跑。"},
        {"turn": 15, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "hazard_dodge", "text": "这是 hazard，用 Dodge，Regular difficulty。inside the chase 不使用 pushed rolls。"},
        {"turn": 16, "role": "system", "speaker": "system", "mode": "roll", "outcome_note": "艾达·金穿过湿滑天窗危险点。", "text": "Dodge 24 vs 35 -> regular_success. Ada crosses the slick skylight hazard."},
        {"turn": "16a", "role": "system", "speaker": "system", "mode": "roll", "resolution_prompt_turn": 15, "outcome_note": "内森尼尔·克劳穿过湿滑天窗危险点，追到上锁屋顶门。", "text": "Nathaniel Dodge 27 vs 30 -> regular_success. Nathaniel crosses the slick skylight hazard and reaches the locked roof door."},
        {"turn": 17, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "conflict", "text": "Nathaniel 用第二个 movement action 抡起短棍砸向你。这个 conflict 消耗他一个 movement action。"},
        {"turn": 18, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 2, "resolution_prompt_turn": 17, "outcome_note": "内森尼尔·克劳的短棍攻击落空。", "text": "Ada Dodge 19 vs 35 -> regular_success; Nathaniel Fighting 62 vs 45 -> failure."},
        {"turn": 19, "role": "player_simulator", "speaker": "Ada King", "player_profile": "reckless_investigator", "mode": "play", "intent": "pass barrier and hide", "text": "我把偷来的 key ring 插进 locked roof door barrier，挤过去后立刻钻进 laundry sheets 之间躲起来。"},
        {"turn": "19a", "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "barrier_hide_resolution", "text": "先用 Locksmith 处理 locked roof door barrier；通过后你可以立刻用 Stealth 躲进 laundry sheets，Nathaniel 用 Spot Hidden 搜你。若你藏住而他没找到，quarry escapes。", "localized_text": {"zh-Hans": {"ruling": "障碍后躲藏结算"}}},
        {"turn": 20, "role": "system", "speaker": "system", "mode": "roll", "roll_count": 3, "resolution_prompt_turn": "19a", "outcome_note": "艾达·金带着账本逃脱。", "text": "Locksmith 21 vs 30 -> regular_success. Stealth 18 vs 45 -> hard_success. Nathaniel Spot Hidden 77 vs 40 -> failure."},
        {"turn": 21, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "text": "quarry escapes。Nathaniel 在 locked roof door 一带失去视线，只能隔着 laundry sheets 乱搜，没有看见你；Ada 抱着 ledger，听见脚步声渐渐落到楼下。"},
    ], ZH_HANS_CHASE_GLOSSARY)
    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", _with_roll_localization([
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "confirm Nathaniel has the cult ledger before acting", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The ledger is partly visible under Nathaniel's coat.", "roll": 82, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada cannot confirm the ledger without risking detection.", "skill_check_earned": False, "localized_text": {"zh-Hans": {"goal": "确认内森尼尔·克劳行动前是否带着邪教账本", "difficulty_rationale": "账本只从内森尼尔·克劳的外套下露出一角，需要仔细观察。", "failure_consequence": "艾达·金无法确认账本，除非冒着被发现的风险继续观察。"}}}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "confirm Nathaniel has the cult ledger before acting", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "Ada changes position for a better angle, keeping the same difficulty.", "roll": 33, "outcome": "regular_success", "pushed": True, "pushed_roll_protocol": _pushed_roll_payload_protocol("chase-ledger-confirmation-push"), "push_justification": "Ada leans over the skylight for a better look.", "foreshadowed_failure": "On failure, Nathaniel sees Ada and starts the chase with no gap.", "failure_consequence": "Nathaniel would begin the chase at the same location as Ada.", "skill_check_earned": True}},
        {"type": "chase", "actor": investigator_id, "payload": {"skill": "CON", "goal": "speed roll to establish Ada's adjusted MOV for the chase", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "On-foot chases use CON as the speed roll.", "roll": 42, "outcome": "success", "failure_consequence": "Ada's MOV would drop by 1 for this chase.", "skill_check_earned": False, "localized_text": {"zh-Hans": {"goal": "用速度检定确定艾达·金在本次追逐中的调整后 MOV", "difficulty_rationale": "步行追逐使用 CON 作为速度检定。", "failure_consequence": "艾达·金的 MOV 会在本次追逐中降低 1。"}}}},
        {"type": "chase", "actor": pursuer_id, "payload": {"skill": "CON", "goal": "speed roll to establish Nathaniel's adjusted MOV for the chase", "target": 50, "effective_target": 50, "difficulty": "regular", "difficulty_rationale": "On-foot chases use CON as the speed roll.", "roll": 42, "outcome": "success", "failure_consequence": "Nathaniel's MOV would drop by 1 for this chase.", "localized_text": {"zh-Hans": {"goal": "用速度检定确定内森尼尔·克劳在本次追逐中的调整后 MOV", "difficulty_rationale": "步行追逐使用 CON 作为速度检定。", "failure_consequence": "内森尼尔·克劳的 MOV 会在本次追逐中降低 1。"}}}},
        {"type": "chase", "actor": investigator_id, "payload": {"roll_id": "chase-ada-skylight-hazard", "chase_hazard_id": "slick-skylight", "skill": "Dodge", "goal": "negotiate the slick skylight hazard", "target": 35, "effective_target": 35, "difficulty": "regular", "difficulty_rationale": "The skylight is a Regular foot-chase hazard.", "roll": 24, "outcome": "regular_success", "failure_consequence": "Ada would lose 1D3 movement actions and risk falling glass damage.", "skill_check_earned": True, "localized_text": {"zh-Hans": {"goal": "越过湿滑天窗危险点", "difficulty_rationale": "湿滑天窗是普通难度的步行追逐危险点。", "failure_consequence": "艾达·金会失去 1D3 次移动行动，并冒着被碎玻璃伤到的风险。"}}}},
        {"type": "chase", "actor": pursuer_id, "payload": {"roll_id": "chase-nathaniel-skylight-hazard", "chase_hazard_id": "slick-skylight", "skill": "Dodge", "goal": "negotiate the slick skylight hazard while closing in", "target": 30, "effective_target": 30, "difficulty": "regular", "difficulty_rationale": "Nathaniel must cross the same Regular foot-chase hazard before spending his second movement action to attack.", "roll": 27, "outcome": "regular_success", "failure_consequence": "Nathaniel would lose 1D3 movement actions and fail to reach Ada this round.", "localized_text": {"zh-Hans": {"goal": "追赶时越过湿滑天窗危险点", "difficulty_rationale": "内森尼尔·克劳必须先穿过同一个普通难度步行追逐危险点，才能用第二个移动行动攻击。", "failure_consequence": "内森尼尔·克劳会失去 1D3 次移动行动，本轮无法追到艾达·金身边。"}}}},
        {"type": "chase", "actor": investigator_id, "payload": {"skill": "Dodge", "goal": "avoid Nathaniel's sap during chase conflict", "target": 35, "effective_target": 35, "difficulty": "regular", "difficulty_rationale": "Conflict during a chase can be resolved with normal attack and Dodge rolls.", "roll": 19, "outcome": "regular_success", "failure_consequence": "Ada would take damage and lose momentum.", "skill_check_earned": True}},
        {"type": "chase", "actor": pursuer_id, "payload": {"skill": "Fighting (Brawl)", "goal": "strike Ada with a sap during chase conflict", "target": 45, "effective_target": 45, "difficulty": "regular", "difficulty_rationale": "An attack during a chase costs one movement action.", "roll": 62, "outcome": "failure", "failure_consequence": "Ada slips past the attack."}},
        {"type": "chase", "actor": investigator_id, "payload": {"roll_id": "chase-ada-roof-door-barrier", "chase_barrier_id": "locked-roof-door", "skill": "Locksmith", "goal": "pass the locked roof door barrier", "target": 30, "effective_target": 30, "difficulty": "regular", "difficulty_rationale": "The locked roof door is a Regular barrier with the stolen key ring.", "roll": 21, "outcome": "regular_success", "failure_consequence": "The barrier would stop Ada's movement until another method succeeded.", "skill_check_earned": True}},
        {"type": "chase", "actor": investigator_id, "payload": {"roll_id": "chase-ada-laundry-hide", "chase_hide_attempt_id": "laundry-roof-hide", "skill": "Stealth", "goal": "hide on the laundry roof after passing the barrier", "target": 45, "effective_target": 45, "difficulty": "regular", "difficulty_rationale": "Ada has a brief lead and concealment among laundry sheets.", "roll": 18, "outcome": "hard_success", "failure_consequence": "Nathaniel would keep the chase active.", "skill_check_earned": True}},
        {"type": "chase", "actor": pursuer_id, "payload": {"roll_id": "chase-nathaniel-search-hidden-ada", "chase_hide_attempt_id": "laundry-roof-hide", "skill": "Spot Hidden", "goal": "find Ada after she hides", "target": 40, "effective_target": 40, "difficulty": "regular", "difficulty_rationale": "The pursuer searches around the locked roof door after losing line of sight.", "roll": 77, "outcome": "failure", "failure_consequence": "The quarry escapes.", "localized_text": {"zh-Hans": {"goal": "在艾达·金躲藏后重新找到她", "difficulty_rationale": "追赶者在上锁屋顶门一带失去视线后搜索。", "failure_consequence": "被追者逃脱。"}}}},
    ]))
    _write_jsonl_localized(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "print-shop-roof", "summary": "Ada 在 print shop roof 发现 Nathaniel Crowe，确认他带着 cult ledger。"}},
        {
            "type": "decision",
            "actor": investigator_id,
            "payload": {
                "decision_id": "chase-confirm-ledger-push",
                "decision_kind": "pushed_confirmation",
                "source_turn": "6a",
                "summary": "Ada 冒着被发现的风险继续观察，确认 Nathaniel 是否带着 ledger。",
            },
        },
        {
            "type": "decision",
            "actor": investigator_id,
            "payload": {
                "decision_id": "chase-take-ledger",
                "decision_kind": "objective_take",
                "source_turn": 7,
                "summary": "Ada 看见 cult ledger 滑出后抢起账本，接受自己成为 quarry。",
            },
        },
        {
            "type": "decision",
            "actor": investigator_id,
            "payload": {
                "decision_id": "chase-cross-skylight",
                "decision_kind": "hazard_choice",
                "source_turn": 14,
                "summary": "Ada 抱紧 ledger，选择穿过 slick skylight hazard 冲向 roof door。",
            },
        },
        {
            "type": "decision",
            "actor": investigator_id,
            "payload": {
                "decision_id": "chase-open-door-hide",
                "decision_kind": "barrier_hide",
                "source_turn": 19,
                "summary": "Ada 用 key ring 通过 locked roof door barrier，并立刻躲进 laundry sheets 之间。",
            },
        },
        {
            "type": "item_transfer",
            "actor": investigator_id,
            "payload": {
                "item_id": "cult-ledger",
                "item_name": "cult ledger",
                "from_actor": pursuer_id,
                "to_actor": investigator_id,
                "source_turn": 7,
                "chase_id": "rooftop-chase",
                "summary": "Ada 看见 cult ledger 从 Nathaniel Crowe 外套里滑出，抢起账本后成为 quarry。",
                "localized_text": {
                    "zh-Hans": {
                        "summary": "艾达·金看见邪教账本从内森尼尔·克劳外套里滑出，抢起账本后成为被追者。"
                    }
                },
            },
        },
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "ledger-clue", "summary": "Ada 确认 cult ledger，并在 after the chase 保住这条线索。"}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "speed roll setup：Ada CON 成功保持 MOV 7；Nathaniel CON 成功保持 MOV 8，因此 pursuer 可以 establish the chase。"}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "location chain：print-shop roof -> rain gutter -> slick skylight hazard -> locked roof door barrier -> laundry roof；DEX order 是 Ada 50，然后 Nathaniel 45。"}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "movement actions：Ada 有 1 movement action；Nathaniel 因 adjusted MOV 比最慢者高 1，拥有 2 movement actions。"}},
        {"type": "chase", "actor": investigator_id, "payload": {"summary": "hazard：Ada 的 Dodge 成功，穿过 slick skylight 且没有损失 movement actions。"}},
        {"type": "chase", "actor": pursuer_id, "payload": {"summary": "hazard：Nathaniel 也通过 Dodge 穿过 slick skylight hazard，逼近到 locked roof door。"}},
        {"type": "chase", "actor": "keeper_under_test", "payload": {"summary": "conflict：Nathaniel 花一个 movement action 用短棍攻击；Ada Dodge 成功，攻击落空。"}},
        {"type": "chase", "actor": investigator_id, "payload": {"summary": "barrier：Ada 用 Locksmith 通过 locked roof door barrier，到达 laundry roof。"}},
        {"type": "chase", "actor": investigator_id, "payload": {"summary": "quarry escapes：Ada 的 Stealth 胜过 Nathaniel 失败的 Spot Hidden，带着 ledger end the chase。"}},
        {"type": "status", "actor": investigator_id, "payload": {"summary": "最终追逐状态：Ada 保持 HP 12、SAN 55、MOV 7，并带走 cult ledger；Nathaniel 落后一处位置。"}},
        {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "after quarry escapes，本场结束；Ada 带着 cult ledger 脱离屋顶，Nathaniel 失去她的踪迹。"}},
    ], ZH_HANS_CHASE_GLOSSARY)
    _write_jsonl_localized(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "Ada 确认 Nathaniel 带着 ledger，随后成为 rooftop chase 的 quarry；她穿过 hazard 和 barrier，躲过 chase conflict，藏进 laundry roof，最终带着线索逃脱。",
        },
    ], ZH_HANS_CHASE_GLOSSARY)
    _write_jsonl_localized(run_dir / "player-feedback.jsonl", [
        {"player_profile": "reckless_investigator", "category": "kp_clarity", "score": 5, "text": "KP 清楚解释了 speed roll、MOV、movement actions、hazard、barrier 和结果。"},
        {"player_profile": "reckless_investigator", "category": "chase_readability", "score": 5, "text": "我能看懂每个人在 location chain 的位置，也知道 quarry 为什么 escapes。"},
        {"player_profile": "reckless_investigator", "category": "immersion", "score": 4, "text": "追逐保持紧张感，同时没有把 rule decisions 藏起来。"},
        {"player_profile": "skeptical_rules_lawyer", "category": "meta_quality", "score": 5, "text": "KP 把 MOV、movement actions 和追逐内不能推骰的边界解释清楚。"},
        {"player_profile": "genre_savvy_player", "category": "spoiler_safety", "score": 5, "text": "KP 没有直接确认我的剧透猜测，只给了玩家安全的障碍和遮蔽信息。"},
    ], ZH_HANS_CHASE_GLOSSARY, player_profile_labels["zh-Hans"])
    _write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {
            "severity": "low",
            "category": "rules_accuracy",
            "text": "Chase setup includes speed roll, MOV adjustment, location chain, DEX order, and movement actions.",
            "evidence": _evidence(
                transcript_turns=[8, 9, 10, 11, 12, 13],
                log_paths=[f"sandbox/.coc/campaigns/{run_id}/logs/rolls.jsonl", f"sandbox/.coc/campaigns/{run_id}/logs/events.jsonl"],
                state_files=[f"sandbox/.coc/campaigns/{run_id}/save/chase.json"],
            ),
        },
        {
            "severity": "low",
            "category": "state_integrity",
            "text": "save/chase.json records participants, location chain, rounds, and outcome.",
            "evidence": _evidence(
                transcript_turns=[16, 18, 20, 21, 22],
                log_paths=[f"sandbox/.coc/campaigns/{run_id}/logs/events.jsonl"],
                state_files=[f"sandbox/.coc/campaigns/{run_id}/save/chase.json"],
                artifact_paths=["artifacts/battle-report.md"],
            ),
        },
        {
            "severity": "low",
            "category": "meta_quality",
            "text": "A skeptical rules profile challenges chase pushed-roll and movement-action boundaries in meta mode.",
            "evidence": _evidence(
                transcript_turns=["13a", "13b"],
                artifact_paths=["transcript.jsonl", "player-view.jsonl"],
            ),
        },
        {
            "severity": "low",
            "category": "spoiler_safety",
            "text": "A genre-savvy profile probes a possible hidden setup and receives a player-safe boundary answer.",
            "evidence": _evidence(
                transcript_turns=["13c", "13d"],
                state_files=[f"sandbox/.coc/campaigns/{run_id}/keeper-secrets.json"],
                artifact_paths=["player-view.jsonl", "keeper-view.jsonl"],
            ),
        },
        {
            "severity": "low",
            "category": "immersion",
            "text": "The scripted multi-profile chase scene reads as a coherent table sequence with pressure.",
            "evidence": _evidence(
                transcript_turns=[1, 5, 8, 14, 17, 22],
                artifact_paths=["artifacts/battle-report.md", "transcript.jsonl"],
            ),
        },
    ])

    _write_campaign_save_and_indexes(campaign_dir)
    _write_view_streams(run_dir)
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
        "campaign_title": "Three Roads into the Corbitt House",
        "scenario": "The Haunting Opening Crossroads",
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
            "spoiler_warning_confirmed_reveal",
            "profile_specific_feedback",
        ],
        "failed_test_cases": [],
        "recommended_fixes": [],
        "regression_tests": [],
    }, ZH_HANS_HAUNTING_GLOSSARY))
    _write_json(campaign_dir / "campaign.json", {
        "schema_version": 1,
        "campaign_id": run_id,
        "title": "Three Roads into the Corbitt House",
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
        "title": "The Haunting Opening Crossroads",
        "module_source": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf",
        "summary": "Three distinct investigation styles branch from Mr. Knott's opening offer in The Haunting.",
        "player_safe_summary": "诺特先生雇用艾达·金调查科比特宅邸，不同玩家风格会分别要求调查路线、风险选择和规则说明。",
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
        {
            "id": "handout-1",
            "label": "Handout 1",
            "title": "Mr. Knott's job",
            "summary": "Mr. Knott's key, address, advance, and warning that research should come before entering the house.",
            "localized_text": {"zh-Hans": {"label": "线索资料 1", "title": "诺特先生的委托", "summary": "诺特先生给出的钥匙、地址、预付款，以及进屋前先查资料的提醒"}},
        },
        {
            "id": "deed-note",
            "label": "Records lead",
            "title": "Records lead",
            "summary": "City records point from Walter Corbitt's deed trail toward the Chapel of Contemplation.",
            "localized_text": {"zh-Hans": {"label": "档案线索", "title": "房契旁注", "summary": "城市档案把沃尔特·科比特的房契线索指向沉思教堂"}},
        },
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
        "characteristic_thresholds": _characteristic_thresholds({
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
            "LUCK": 55,
        }),
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 7,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": _ada_king_default_character_skills(),
        "skill_thresholds": _skill_thresholds(_ada_king_default_character_skills()),
        "backstory": {
            "description": "艾达·金是一名被多次委托调查旧宅纠纷的古物学者，擅长把传言拆成可查证的线索。",
            "ideology_beliefs": ["公开记录比传闻可靠，但传闻常常指向被隐藏的入口。"],
            "significant_people": ["莱兰·哈特教授，她已故的导师，留下了一套严谨的调查笔记法。"],
            "meaningful_locations": ["波士顿档案馆阅览室，她在那里学会从房契边注寻找异常。"],
            "treasured_possessions": ["裂柄铜放大镜。"],
            "traits": ["谨慎记笔记", "愿意听完同伴的鲁莽想法再提出风险"],
        },
    })
    _write_json(investigator_dir / "creation.json", _ada_king_creation_record())
    _write_investigator_chronicle(
        investigator_dir,
        [
            {
                "schema_version": 1,
                "type": "scenario_experience",
                "campaign_id": run_id,
                "scenario_id": "the-haunting-opening-pressure",
                "summary": "艾达·金经历了三种调查风格的开局分支，确认公开记录、鲁莽进屋和规则质疑都能进入同一故事。",
                "final_hp": 12,
                "final_san": 55,
                "notable_events": ["谨慎路线找到科比特与沉思教堂线索", "鲁莽路线通过推骰发现新划痕", "规则质疑获得独立规则解释"],
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
        [
            {
                "schema_version": 1,
                "type": "scenario_inventory_summary",
                "campaign_id": run_id,
                "scenario_id": "the-haunting-opening-pressure",
                "summary": "多调查风格开局结束时的可继承物品、线索和路线选择。",
                "items": [
                    "诺特先生的钥匙",
                    "沉思教堂记录线索",
                    "门闩新划痕线索",
                    "裂柄铜放大镜",
                ],
                "cash": "20 美元预付款暂记",
                "notes": "导入正式战役前由玩家选择谨慎调查路线、鲁莽进屋路线或合并为正史；诺特先生钥匙应在委托结束后归还。",
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
        {"turn": 9, "role": "player_simulator", "speaker": "Reckless Player", "player_profile": "reckless_investigator", "mode": "play", "intent": "push reckless entry", "pushed_roll_protocol": _pushed_roll_transcript_protocol("pressure-reckless-entry-push", "player_reframes_action"), "text": "我把手电贴近门缝，不只看门框，还冒险伸手去摸门闩，想知道里面是不是刚有人动过。"},
        {"turn": 10, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "pushed_spot_hidden", "pushed_roll_protocol": _pushed_roll_transcript_protocol("pressure-reckless-entry-push", "keeper_foreshadows_failure", {"failure_consequence_source": "keeper"}), "text": "这是有效推骰，因为你改变了方法并靠得更近。若失败，屋内的动静会先一步锁定你。你确定吗？"},
        {"turn": "10a", "role": "player_simulator", "speaker": "Reckless Player", "player_profile": "reckless_investigator", "mode": "play", "pushed_roll_protocol": _pushed_roll_transcript_protocol("pressure-reckless-entry-push", "player_confirms_risk", {"risk_confirmed": True}), "text": "确定。我就赌门缝里这一点线索。"},
        {"turn": 11, "role": "system", "speaker": "system", "mode": "roll", "pushed_roll_protocol": _pushed_roll_transcript_protocol("pressure-reckless-entry-push", "roll_resolved"), "outcome_note": "你看见门闩边缘有新划痕，没有触发额外危险。", "text": "Pushed Spot Hidden 22 vs 55 -> hard_success."},
        {"turn": 12, "role": "player_simulator", "speaker": "Skeptical Player", "player_profile": "skeptical_rules_lawyer", "mode": "meta", "intent": "challenge keeper ruling", "text": "[meta] 我想质疑一下：谨慎玩家查资料、鲁莽玩家直接进屋，为什么 KP 给的是不同检定和风险？[/meta]"},
        {"turn": 13, "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "ruling": "profile_pressure_explanation", "text": "[meta] 规则裁定：检定不是惩罚玩家风格，而是根据行动方式和风险来定。谨慎路线用 Library Use 获取线索；鲁莽路线也允许，但信息少、后果更近。推骰前我必须先说明失败代价。[/meta]"},
        {"turn": "13a", "role": "player_simulator", "speaker": "Skeptical Player", "player_profile": "skeptical_rules_lawyer", "mode": "meta", "intent": "request keeper-only spoiler", "text": "[meta] 如果我现在明确想知道地下室到底藏着什么，能不能直接剧透告诉我？[/meta]"},
        {"turn": "13b", "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "ruling": "spoiler_warning", "spoiler_protocol": _spoiler_transcript_protocol("pressure-corbitt-basement-reveal", "warning_issued", "secret-corbitt-body", "corbitt_basement_presence", {"requires_confirmation": True}), "text": "[spoiler_warning] 这会揭示《鬼屋》的守秘人信息：地下室核心秘密的一部分。确认后我只回答你请求的范围，不展开攻击触发或完整真相。你确认要看吗？[/spoiler_warning]"},
        {"turn": "13c", "role": "player_simulator", "speaker": "Skeptical Player", "player_profile": "skeptical_rules_lawyer", "mode": "meta", "spoiler_protocol": _spoiler_transcript_protocol("pressure-corbitt-basement-reveal", "player_confirmed", "secret-corbitt-body", "corbitt_basement_presence", {"confirmed": True}), "text": "[meta] 确认。我接受这段剧透；只回答地下室这一点，不要展开后面的触发。[/meta]"},
        {"turn": "13d", "role": "keeper_under_test", "speaker": "KP", "mode": "meta", "ruling": "limited_spoiler_reveal", "spoiler_protocol": _spoiler_transcript_protocol("pressure-corbitt-basement-reveal", "limited_reveal", "secret-corbitt-body", "corbitt_basement_presence", {"confirmed": True}), "text": "[meta] 有限剧透：科比特的遗体仍在地下室。到此为止，我不会额外说明它如何行动、如何触发攻击，或完整结局。[/meta]"},
        {"turn": 14, "role": "player_simulator", "speaker": "Careful Player", "player_profile": "careful_investigator", "mode": "play", "intent": "use clue to shape plan", "text": "那我把档案线索告诉大家，建议先找沉思教堂的记录，再决定是否进地下室。"},
        {"turn": 15, "role": "keeper_under_test", "speaker": "KP", "mode": "play", "ruling": "session_wrap", "text": "这一幕先收在这里：三个调查方向都留下了后续入口。你们可以先追查沉思教堂，再决定是否深入科比特宅邸。"},
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl(campaign_dir / "logs" / "rolls.jsonl", _with_roll_localization([
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Library Use", "goal": "research deed and newspaper records before entering the house", "target": 60, "effective_target": 60, "difficulty": "regular", "difficulty_rationale": "Public records can reveal a useful lead with focused archive work.", "roll": 29, "outcome": "hard_success", "failure_consequence": "Ada would spend half a day and enter the house with fewer leads.", "skill_check_earned": True, "localized_text": {"zh-Hans": {"goal": "进屋前查房契和旧报纸记录", "difficulty_rationale": "公开记录能通过专注查档找到有用线索。", "failure_consequence": "艾达·金会多花半天，并带着更少线索进屋。"}}}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "notice fresh marks before reckless entry", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The marks are visible only if the investigator slows down at the door.", "roll": 84, "outcome": "failure", "push_eligible": True, "failure_consequence": "Ada misses the warning and risks entering without preparation.", "skill_check_earned": False, "localized_text": {"zh-Hans": {"goal": "鲁莽进屋前注意到新划痕", "difficulty_rationale": "只有在门口稍作停顿才能看到这些痕迹。", "failure_consequence": "艾达·金会错过警告，冒着准备不足的风险进屋。"}}}},
        {"type": "roll", "actor": investigator_id, "payload": {"skill": "Spot Hidden", "goal": "push the door inspection by checking the latch by touch", "target": 55, "effective_target": 55, "difficulty": "regular", "difficulty_rationale": "The pushed approach changes method by touching the latch at close range.", "roll": 22, "outcome": "hard_success", "pushed": True, "pushed_roll_protocol": _pushed_roll_payload_protocol("pressure-reckless-entry-push"), "push_justification": "Ada moves the flashlight close and reaches into the door gap by touch.", "foreshadowed_failure": "On failure, the house notices Ada first.", "failure_consequence": "Ada would trigger a noise inside the house before she could warn the others.", "skill_check_earned": True, "localized_text": {"zh-Hans": {"goal": "用触摸门闩的方式推骰检查门口", "difficulty_rationale": "推骰方法改变为近距离触摸门闩。", "push_justification": "艾达·金把手电贴近门缝，伸手摸向门闩。", "foreshadowed_failure": "若失败，屋内的东西会先注意到艾达·金。", "failure_consequence": "艾达·金会在警告同伴前先触发屋内动静。"}}}},
    ]))
    _write_jsonl_localized(campaign_dir / "logs" / "events.jsonl", [
        {"type": "scene", "actor": "keeper_under_test", "payload": {"scene_id": "knott-office", "summary": "诺特先生给出钥匙、预付款和科比特宅邸的委托。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "谨慎玩家选择先查房契和旧报纸，避免无准备进屋。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "deed-note", "summary": "艾达·金发现沃尔特·科比特与沉思教堂有关。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "鲁莽玩家选择直接进二楼，并在 KP 说明失败后果后继续推骰。"}},
        {"type": "decision", "actor": investigator_id, "payload": {"summary": "规则质疑玩家以超游模式要求 KP 解释不同玩家风格对应的检定和风险。"}},
        {"type": "decision", "actor": "player_simulator", "payload": {"summary": "规则质疑玩家主动要求查看地下室守秘人剧透；KP 先发出剧透警告并等待确认。"}},
        {"type": "clue", "actor": investigator_id, "payload": {"clue_id": "fresh-scratches", "summary": "推骰成功后，艾达·金看见门闩边缘的新划痕。"}},
        {"type": "status", "actor": investigator_id, "payload": {"summary": "三个玩家画像都保留了有效选择；KP 已说明不同路线的收益、风险和失败后果。"}},
        {"type": "session_ending", "actor": "keeper_under_test", "payload": {"summary": "本幕收束，后续入口记录为先追查沉思教堂，再决定是否进入科比特宅邸深处。"}},
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl(campaign_dir / "logs" / "audit.jsonl", [
        {
            "type": "spoiler_reveal",
            "spoiler_id": "pressure-corbitt-basement-reveal",
            "keeper_secret_id": "secret-corbitt-body",
            "scope": "corbitt_basement_presence",
            "confirmed": True,
            "transcript_turns": ["13b", "13c", "13d"],
            "payload": {
                "summary": "Player confirmed a warning-gated limited reveal that Walter Corbitt's body remains in the basement.",
            },
        },
    ])
    _write_jsonl_localized(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "三个调查风格汇入同一开局：谨慎玩家先查公开记录，鲁莽玩家直接进屋并推骰，规则质疑玩家要求解释裁定并确认一次剧透警告。KP 分别给出风险、失败后果、有限剧透和后续路线。",
        },
    ], ZH_HANS_HAUNTING_GLOSSARY)
    _write_jsonl_localized(run_dir / "player-feedback.jsonl", [
        {"player_profile": "careful_investigator", "category": "kp_clarity", "score": 5, "text": "KP 允许我先调查，并说明成功和失败会怎样改变进屋准备。"},
        {"player_profile": "reckless_investigator", "category": "agency", "score": 4, "text": "KP 没有阻止我冒险，但把更近的风险说清楚了。"},
        {"player_profile": "skeptical_rules_lawyer", "category": "meta_quality", "score": 5, "text": "KP 清楚解释了为什么不同做法对应不同检定和失败后果。"},
        {"player_profile": "skeptical_rules_lawyer", "category": "spoiler_safety", "score": 5, "text": "KP 在真正揭示地下室秘密前先给出剧透警告，等我确认后只回答了有限范围。"},
    ], ZH_HANS_HAUNTING_GLOSSARY, player_profile_labels["zh-Hans"])
    _write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {
            "severity": "low",
            "category": "rules_accuracy",
            "text": "Different player styles receive rulings based on fictional positioning and stated risk.",
            "evidence": _evidence(
                transcript_turns=[2, 3, 6, 7, 9, 10, "10a", 11],
                log_paths=[f"sandbox/.coc/campaigns/{run_id}/logs/rolls.jsonl", f"sandbox/.coc/campaigns/{run_id}/logs/events.jsonl"],
            ),
        },
        {
            "severity": "low",
            "category": "meta_quality",
            "text": "The skeptical profile challenges a ruling in meta mode and receives a separated explanation.",
            "evidence": _evidence(
                transcript_turns=[12, 13],
                artifact_paths=["transcript.jsonl", "player-view.jsonl"],
            ),
        },
        {
            "severity": "low",
            "category": "spoiler_safety",
            "text": "A Keeper-only reveal is warning-gated, player-confirmed, limited in scope, and recorded in logs/audit.jsonl.",
            "evidence": _evidence(
                transcript_turns=["13b", "13c", "13d"],
                log_paths=[f"sandbox/.coc/campaigns/{run_id}/logs/audit.jsonl"],
                state_files=[f"sandbox/.coc/campaigns/{run_id}/scenario/keeper-secrets.json"],
                artifact_paths=["transcript.jsonl", "player-view.jsonl", "keeper-view.jsonl"],
            ),
        },
        {
            "severity": "low",
            "category": "immersion",
            "text": "The run remains a compact pressure test rather than a full module session, but it exercises multiple virtual player styles.",
            "evidence": _evidence(
                transcript_turns=[1, 2, 6, 12, 14, 15],
                state_files=[f"sandbox/.coc/investigators/{investigator_id}/history.jsonl", f"sandbox/.coc/investigators/{investigator_id}/development.jsonl"],
                artifact_paths=["artifacts/battle-report.md"],
            ),
        },
    ])

    _write_campaign_save_and_indexes(campaign_dir)
    _write_view_streams(run_dir)
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
