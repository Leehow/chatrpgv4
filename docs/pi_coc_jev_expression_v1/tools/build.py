#!/usr/bin/env python3
"""Compile original seed definitions into versioned card assets and reading views."""
from __future__ import annotations
import hashlib
import html
import json
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
SOURCE = runpy.run_path(str(ROOT / 'cards/author_cards.py'))
VERSION = '1.0.0'

CONTEXT_FIELDS = {
 'FCT':['public_facts','epistemic_limits','scope_complete'],
 'AGY':['player_authorizations','rule_effects','public_facts'],
 'CLR':['task','target_text'],
 'SEN':['public_facts','perception_limits','task'],
 'HOR':['public_facts','disclosure_policy','task'],
 'LYR':['public_facts','expression_goal','task'],
 'DIA':['npc_knowledge','npc_intent','player_input','public_facts'],
 'VOI':['npc_voice','npc_knowledge','recent_dialogue','task'],
 'PAC':['player_authorizations','public_facts','pending_choice','task'],
 'MEM':['current_revision','public_history','public_facts','recipient'],
 'RUL':['rule_receipts','player_authorizations','public_facts','disclosure_policy'],
 'OUT':['channel','delivery_status','source_permissions','scope_complete']
}
NA = {
 'AGY':{7,9}, 'CLR':{3,12}, 'SEN':{1,6}, 'HOR':{3,11},
 'LYR':{1,2,4,6,7}, 'OUT':{1,2,7}
}
OWNER_OVERRIDES = {
 ('FCT',10):'privacy_projection', ('FCT',8):'state_projection',
 ('FCT',9):'npc_projection', ('AGY',4):'authorization',
 ('AGY',5):'rules_or_director', ('AGY',12):'authorization',
 ('MEM',4):'privacy_projection', ('MEM',5):'state_projection',
 ('MEM',6):'worldline_projection', ('MEM',10):'state_projection',
 ('RUL',5):'authorization', ('RUL',6):'privacy_projection',
 ('RUL',9):'authorization', ('OUT',1):'output_projection',
 ('OUT',5):'privacy_projection', ('OUT',8):'fact_owner',
 ('OUT',9):'diagnostic_policy', ('OUT',10):'diagnostic_policy',
 ('OUT',11):'repair_planner', ('OUT',12):'delivery_runtime'
}
RELATED = {
 ('FCT',1):['PEC-HOR-002','PEC-HOR-011'],
 ('FCT',3):['PEC-DIA-005','PEC-MEM-007'],
 ('FCT',6):['PEC-LYR-008','PEC-OUT-003'],
 ('AGY',1):['PEC-AGY-011','PEC-SEN-010'],
 ('AGY',3):['PEC-PAC-001','PEC-PAC-002','PEC-PAC-011'],
 ('CLR',4):['PEC-CLR-003'],
 ('HOR',1):['PEC-LYR-010','PEC-HOR-008'],
 ('LYR',4):['PEC-PAC-006','PEC-CLR-008'],
 ('VOI',2):['PEC-VOI-012','PEC-MEM-009'],
 ('MEM',2):['PEC-MEM-012'],
 ('RUL',1):['PEC-RUL-012'],
 ('RUL',2):['PEC-CLR-001'],
 ('OUT',3):['PEC-FCT-006','PEC-OUT-004'],
 ('OUT',9):['PEC-OUT-010']
}

def dump(path: Path, obj: object) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def jsonl(path: Path, items: list[dict]) -> None:
    path.write_text(''.join(json.dumps(x, ensure_ascii=False, separators=(',',':'))+'\n' for x in items), encoding='utf-8')

cards=[]
examples=[]
for family, raw in SOURCE['RAW'].items():
    family_name, block, legacy = SOURCE['FAMILIES'][family]
    rows = raw.strip().splitlines()
    assert len(rows)==12, family
    for i, line in enumerate(rows, 1):
        fields=line.split('¦')
        assert len(fields)==12, (family,i,len(fields))
        title,severity,scope,when,ctx,bad,good,why,repair,bctx,btext,bwhy=fields
        cid=f'PEC-{family}-{i:03d}'
        meta=family=='OUT' and i>=8
        channel='audit_note' if meta else 'player_narration'
        context={
            'authoritative_context':ctx,
            'task':when,
            'channel':channel,
            'scope_complete':True,
            'context_format':'compact_seed_fixture',
            'note':'本例所需事实、规则/授权或历史均在authoritative_context中给出；未提及的内容不自动成立。'
        }
        boundary_context={
            'authoritative_context':bctx,
            'task':bctx,
            'channel':'alternate_task' if i in NA.get(family,set()) else channel,
            'scope_complete':True,
            'context_format':'compact_seed_fixture'
        }
        boundary_label='NOT_APPLICABLE' if i in NA.get(family,set()) else 'CLEAN'
        card={
            'schema_version':VERSION,'card_id':cid,'numeric_id':block*1000+i,
            'card_version':VERSION,'family':family,'family_name':family_name,
            'title':title,'scope':scope,'channels':[channel],
            'activation':'diagnostic_meta' if meta else ('integrity' if severity=='blocker' or family=='FCT' or (family=='RUL' and i!=2) else 'style'),
            'default_severity':severity,
            'applicability':when,
            'failure_mode':why,'desired_behavior':repair,
            'required_context':CONTEXT_FIELDS[family],
            'not_a_keyword_rule':True,
            'contrast':{
                'context':context,
                'negative':{'example_id':cid+':bad','text':bad,'explanation':why},
                'positive':{'example_id':cid+':good','text':good,'explanation':repair}
            },
            'boundary':{
                'example_id':cid+':boundary','context':boundary_context,
                'text':btext,'explanation':bwhy,'expected_decision':boundary_label
            },
            'diagnosis':{
                'question':f'只评估当前target_text在当前context下是否存在“{title}”所针对的问题。',
                'violation_definition':why,
                'legitimate_exception':bwhy,
                'decision_options':{
                    'VIOLATION':'本卡适用，且当前材料足以确认本卡定义的具体失误；不是仅与反例词面相似。',
                    'CLEAN':'本卡适用，但当前稿件没有该失误，包括有明确授权或语义功能的合法相似表达。',
                    'NOT_APPLICABLE':'当前渠道、任务或表现目标使本卡不适用。',
                    'INSUFFICIENT_CONTEXT':'缺少本卡必要上下文，或正文/历史不完整，无法作出判断。'
                },
                'raw_probability_is_not_calibrated_correctness':True
            },
            'repair':{
                'owner':OWNER_OVERRIDES.get((family,i),'narrator'),
                'objective':repair,
                'positive_example_ids':[cid+':good'],
                'preserve':['当前公开权威事实','必须交付信息','规则收据','玩家授权与当前认识范围','原始证物身份'],
                'transfer_mode':'technique_only',
                'no_new_world_facts':True,
                'auto_repair_enabled':False
            },
            'related_card_ids':RELATED.get((family,i),[]),
            'legacy_contract_refs':legacy,
            'retrieval_text':'；'.join([family_name,title,when,why,repair]),
            'review':{'status':'pending','calibration_status':'unvalidated','production_ready':False},
            'provenance':{'origin':'original_synthetic_seed','created_on':'2026-09-23','book_excerpt':False,
                'copyright_note':'本例为原创虚构教学材料；不包含所附商业模组正文。'}
        }
        cards.append(card)
        for label, part, ec in [('VIOLATION',card['contrast']['negative'],context),('CLEAN',card['contrast']['positive'],context)]:
            examples.append({'example_id':part['example_id'],'card_id':cid,'context':ec,
                'text':part['text'],'expected_decision':label,'explanation':part['explanation'],
                'split':'public_seed','target_card_only':True,'human_review':'pending','origin':'original_synthetic_seed'})
        b=card['boundary']
        examples.append({'example_id':b['example_id'],'card_id':cid,'context':b['context'],'text':b['text'],
            'expected_decision':boundary_label,'explanation':bwhy,'split':'public_seed',
            'target_card_only':True,'human_review':'pending','origin':'original_synthetic_seed'})

assert len(cards)==144 and len(examples)==432
assert len({c['card_id'] for c in cards})==144
ids={c['card_id'] for c in cards}
assert all(set(c['related_card_ids'])<=ids for c in cards)
jsonl(ROOT/'cards/cards.jsonl',cards)
jsonl(ROOT/'cards/examples.jsonl',examples)
jsonl(ROOT/'cards/selection_index.jsonl',[
    {k:c[k] for k in ['card_id','numeric_id','card_version','family','title','scope','channels','activation','applicability','desired_behavior','retrieval_text']}
    for c in cards])
jsonl(ROOT/'cards/diagnostic_index.jsonl',[
    {k:c[k] for k in ['card_id','family','scope','channels','activation','default_severity','applicability','failure_mode','required_context','diagnosis']}
    for c in cards])
jsonl(ROOT/'tests/seed_cases.jsonl',[
    {'case_id':e['example_id'],'target_card_ids':[e['card_id']],'input':{'target_text':e['text'],'context':e['context']},
     'expected':{e['card_id']:e['expected_decision']},'split':'public_seed','evidence':'authored_expected_label_not_model_result'}
    for e in examples])
# Reader catalogue generated from the same single source of truth.
lines=['# Pi CoC 表达正反例卡库 · 144 张','',
       '**版本1.0.0 · 2026-09-23 · 全部为原创种子，人工复核待完成。**','',
       '共144组同上下文正反例、144个合法/不适用边界例。反例是教学材料，不是当前世界事实。正例只展示方法，不是唯一标准答案。',
       '', '工程审阅家族的OUT-008至OUT-012不作为玩家旁白范例。','', '## 家族目录','']
for f,(name,_,_) in SOURCE['FAMILIES'].items():
    lines.append(f'- [{f} · {name}](#{f.lower()})：12张')
for f,(name,_,_) in SOURCE['FAMILIES'].items():
    lines+=['',f'<a id="{f.lower()}"></a>',f'## {f} · {name}','']
    for c in (c for c in cards if c['family']==f):
        a=c['contrast']; b=c['boundary']
        lines += [f"### {c['card_id']} · {c['title']}",'',
            f"**范围：** {c['scope']} · **级别：** {c['default_severity']} · **渠道：** {', '.join(c['channels'])} · **数值索引：** {c['numeric_id']}",'',
            f"**适用：** {c['applicability']}",'',
            f"**本组共同上下文：** {a['context']['authoritative_context']}",'',
            '**反例：**','',f"> {a['negative']['text']}",'',
            f"**问题：** {c['failure_mode']}",'',
            '**正例：**','',f"> {a['positive']['text']}",'',
            f"**修复方法：** {c['desired_behavior']}",'',
            f"**防误判上下文：** {b['context']['authoritative_context']}",'',
            f"> {b['text']}",'',
            f"**为何不应按反例处理：** {b['explanation']}（预期：{b['expected_decision']}）",'',
            f"**处理拥有者：** `{c['repair']['owner']}`；**正例引用：** `{c['card_id']}:good`；只迁移方法，不搬运事实。",'']
(ROOT/'cards/cards.md').write_text('\n'.join(lines),encoding='utf-8')
manifest={
 'package_id':'pi-coc-expression-cards-v1','version':VERSION,'created_on':'2026-09-23',
 'card_count':len(cards),'main_contrast_pairs':144,'boundary_examples':144,'total_examples':len(examples),
 'all_examples_are_public_seed':True,'semantic_model_evaluation_executed':False,'human_review':'pending',
 'family_counts':{f:12 for f in SOURCE['FAMILIES']},
 'files':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'cards/cards.jsonl',ROOT/'cards/examples.jsonl',ROOT/'cards/selection_index.jsonl',ROOT/'cards/diagnostic_index.jsonl',ROOT/'tests/seed_cases.jsonl']}
}
dump(ROOT/'cards/manifest.json',manifest)
print(json.dumps({'cards':len(cards),'examples':len(examples),'families':len(SOURCE['FAMILIES'])}))
