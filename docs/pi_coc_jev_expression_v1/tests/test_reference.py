"""Deterministic contract tests. NO Jev/LLM inference, scoring, or network calls.

All response probabilities here are hand-built transport fixtures, not evaluation
results. The 432 seed labels are author expectations, not passed model test cases.
"""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'runtime'))
import reference as r
try:
    import jsonschema
except ImportError:
    jsonschema=None


def response_fixture(request, choices=None):
    """Make a typed fake answer to exercise compilation; never an accuracy result."""
    choices=choices or {}
    answers={}
    for qid,q in request['questions'].items():
        opts=list(q['criteria'])
        choice=choices.get(qid, 'CLEAN' if qid.endswith('_diagnosis') else 'NO_LOCAL_EVIDENCE')
        if choice not in opts: choice=opts[0]
        answers[qid]={'type':'choice','choice':choice,
                      'probabilities':{o:float(o==choice) for o in opts},'confidence':1.0}
    return {'model':'fixture-not-a-jev-model','answers':answers,
            'usage':{'input_tokens':0,'output_tokens':0}}


class AssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cards=r.load_cards()
        cls.examples=[json.loads(x) for x in (ROOT/'cards/examples.jsonl').read_text().splitlines()]

    def test_01_asset_counts(self):
        self.assertEqual(len(self.cards),144)
        self.assertEqual(len(self.examples),432)
        self.assertEqual(len({c['family'] for c in self.cards.values()}),12)
        for family in {c['family'] for c in self.cards.values()}:
            self.assertEqual(sum(c['family']==family for c in self.cards.values()),12)

    @unittest.skipIf(jsonschema is None,'Install jsonschema to run schema validation; this is not semantic validation')
    def test_02_all_cards_match_json_schema(self):
        schema=json.loads((ROOT/'schema/card.schema.json').read_text())
        validator=jsonschema.Draft202012Validator(schema)
        validator.check_schema(schema)
        for card in self.cards.values():
            with self.subTest(card=card['card_id']): validator.validate(card)

    def test_03_ids_and_example_refs_are_unique(self):
        self.assertEqual(len({c['numeric_id'] for c in self.cards.values()}),144)
        self.assertEqual(len({e['example_id'] for e in self.examples}),432)
        eids={e['example_id'] for e in self.examples}
        for c in self.cards.values():
            self.assertTrue(set(c['repair']['positive_example_ids'])<=eids)
            self.assertTrue(set(c['related_card_ids'])<=set(self.cards))

    def test_04_main_pairs_share_context(self):
        examples={e['example_id']:e for e in self.examples}
        for cid,c in self.cards.items():
            bad,good=examples[cid+':bad'],examples[cid+':good']
            self.assertEqual(bad['context'],good['context'])
            self.assertEqual(bad['context'],c['contrast']['context'])
            self.assertNotEqual(bad['text'],good['text'])
            self.assertEqual((bad['expected_decision'],good['expected_decision']),('VIOLATION','CLEAN'))

    def test_05_examples_are_unvalidated_public_seeds(self):
        for c in self.cards.values():
            self.assertFalse(c['repair']['auto_repair_enabled'])
            self.assertFalse(c['review']['production_ready'])
            self.assertEqual(c['review']['status'],'pending')
            self.assertEqual(c['provenance']['origin'],'original_synthetic_seed')
            self.assertFalse(c['provenance']['book_excerpt'])
        for e in self.examples:
            self.assertEqual(e['split'],'public_seed')
            self.assertEqual(e['human_review'],'pending')
            self.assertTrue(e['target_card_only'])

    def test_06_meta_cards_are_not_narrator_style(self):
        meta=[c for c in self.cards.values() if c['activation']=='diagnostic_meta']
        self.assertEqual(len(meta),5)
        self.assertTrue(all(c['channels']==['audit_note'] for c in meta))

    def test_07_manifest_hashes_match_files(self):
        manifest=json.loads((ROOT/'cards/manifest.json').read_text())
        self.assertFalse(manifest['semantic_model_evaluation_executed'])
        for name,sha in manifest['files'].items():
            self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),sha)

    def test_08_reader_and_indexes_contain_all_cards(self):
        reader=(ROOT/'cards/cards.md').read_text()
        for cid in self.cards: self.assertIn('### '+cid,reader)
        for name in ('selection_index.jsonl','diagnostic_index.jsonl'):
            rows=[json.loads(l) for l in (ROOT/'cards'/name).read_text().splitlines()]
            self.assertEqual({x['card_id'] for x in rows},set(self.cards))


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.cards=r.load_cards()
        self.case=json.loads((ROOT/'examples/current_draft.json').read_text())
        self.text,self.context=self.case['target_text'],self.case['context']
        self.ids=['PEC-FCT-001','PEC-AGY-001','PEC-AGY-003']
        self.req,self.binding=r.build_diagnosis_request(self.cards,self.ids,self.text,self.context)

    def test_09_unicode_spans_round_trip(self):
        text='😀门开了。“谁？”\n窗外没动静！最后一句'
        spans=r.split_spans(text)
        self.assertEqual(''.join(s.text for s in spans),text)
        for s in spans: self.assertEqual(text[s.start:s.end],s.text)
        self.assertEqual(spans[0].end,5)  # emoji is one code point, not two UTF-16 code units

    def test_10_empty_target_and_context_rejected(self):
        for text in ('','  ','\n'):
            with self.assertRaises(r.ContractError): r.split_spans(text)
        with self.assertRaises(r.ContractError):
            r.build_diagnosis_request(self.cards,self.ids,self.text,{})

    def test_11_unknown_or_duplicate_card_rejected(self):
        for ids in ([],['PEC-FCT-999'],['PEC-FCT-001','PEC-FCT-001']):
            with self.assertRaises(r.ContractError): r.selected_cards(self.cards,ids)

    def test_12_request_contains_semantics_not_only_ids(self):
        self.assertEqual(len(self.req['questions']),6)
        for qid,q in self.req['questions'].items():
            self.assertIn('violation_definition',q['instructions'])
            self.assertTrue(q['instructions']['violation_definition'])
            self.assertNotIn('teaching_only',q['instructions'])
            if qid.endswith('_diagnosis'):
                self.assertEqual(set(q['criteria']),set(r.DECISIONS))

    def test_13_teaching_examples_require_explicit_option(self):
        req,b=r.build_diagnosis_request(self.cards,self.ids,self.text,self.context,include_teaching_examples=True)
        self.assertIn('teaching_only',req['questions']['q0_diagnosis']['instructions'])
        self.assertTrue(b['teaching_examples_included'])

    def test_14_location_options_limit_and_no_localization_mode(self):
        text='门开了。'*252
        with self.assertRaises(r.ContractError):
            r.build_diagnosis_request(self.cards,self.ids,text,self.context)
        req,_=r.build_diagnosis_request(self.cards,self.ids,text,self.context,localize=False)
        self.assertEqual(len(req['questions']),3)

    def test_15_exact_choice_limit_is_supported(self):
        req,_=r.build_diagnosis_request(self.cards,['PEC-FCT-001'],'门开了。'*251,self.context)
        self.assertEqual(len(req['questions']['q0_location']['criteria']),255)

    def test_16_well_formed_fixture_validates(self):
        r.validate_response(self.req,response_fixture(self.req))

    def test_17_missing_question_or_model_or_usage_rejected(self):
        for mutate in (
            lambda x:x['answers'].pop('q0_diagnosis'),
            lambda x:x.pop('model'), lambda x:x.pop('usage')):
            response=response_fixture(self.req);mutate(response)
            with self.assertRaises(r.ContractError):r.validate_response(self.req,response)

    def test_18_type_mismatch_rejected(self):
        response=response_fixture(self.req)
        response['answers']['q0_diagnosis']['type']='noul'
        with self.assertRaises(r.ContractError):r.validate_response(self.req,response)

    def test_19_unknown_choice_and_probability_option_rejected(self):
        response=response_fixture(self.req)
        response['answers']['q0_diagnosis']['choice']='NOT_IN_SCHEMA'
        with self.assertRaises(r.ContractError):r.validate_response(self.req,response)
        response=response_fixture(self.req)
        response['answers']['q0_diagnosis']['probabilities']['EXTRA']=0
        with self.assertRaises(r.ContractError):r.validate_response(self.req,response)

    def test_20_nonfinite_and_bad_sum_rejected(self):
        for value in (float('nan'),float('inf'),-0.1,2,True):
            response=response_fixture(self.req)
            response['answers']['q0_diagnosis']['probabilities']['CLEAN']=value
            with self.assertRaises(r.ContractError):r.validate_response(self.req,response)
        response=response_fixture(self.req)
        response['answers']['q0_diagnosis']['probabilities']['VIOLATION']=0.2
        with self.assertRaises(r.ContractError):r.validate_response(self.req,response)

    def test_21_nonmaximum_choice_rejected(self):
        response=response_fixture(self.req)
        response['answers']['q0_diagnosis']['choice']='VIOLATION'
        with self.assertRaises(r.ContractError):r.validate_response(self.req,response)

    def test_22_noul_and_score_response_shapes(self):
        req={'questions':{'n':{'type':'noul'},'s':{'type':'score','criteria':['低','中','高']}}}
        response={'model':'fixture-not-a-model','usage':{'input_tokens':0,'output_tokens':0},'answers':{
            'n':{'type':'noul','noul':0.5},
            's':{'type':'score','score':1.5,'legend':{'0':'低','1':'中','2':'高'},
                 'confidence':0.5,'probabilities':{'0':0,'1':0.5,'2':0.5}}}}
        r.validate_response(req,response)
        response['answers']['s']['score']=2
        with self.assertRaises(r.ContractError):r.validate_response(req,response)

    def test_23_host_evidence_is_exact(self):
        e=r.evidence_for('s1',self.text,self.binding)
        self.assertEqual(e['quote'],self.text[e['start']:e['end']])
        self.assertEqual(e['offset_unit'],'unicode_code_point')

    def test_24_stale_draft_and_fake_span_rejected(self):
        with self.assertRaises(r.ContractError):r.evidence_for('s0',self.text+' ',self.binding)
        b=copy.deepcopy(self.binding);b['spans'][0]['text']='伪造引用'
        with self.assertRaises(r.ContractError):r.evidence_for('s0',self.text,b)

    def test_25_omission_never_fabricates_quote(self):
        for loc in ('OMISSION','WHOLE_TEXT','MULTIPLE','NO_LOCAL_EVIDENCE',None):
            self.assertIsNone(r.evidence_for(loc,self.text,self.binding)['quote'])

    def test_26_model_flag_not_automatically_authorized(self):
        response=response_fixture(self.req,{'q0_diagnosis':'VIOLATION','q0_location':'s1'})
        report=r.compile_report(self.cards,self.req,self.binding,response)
        self.assertEqual(len(report['findings']),1)
        finding=report['findings'][0]
        self.assertEqual(finding['status'],'model_flagged_unverified')
        self.assertFalse(finding['auto_repair_authorized'])
        self.assertFalse(report['publish_authorized'])
        self.assertEqual(finding['explanation_origin'],'static_card_not_model_generated_rationale')
        self.assertEqual(finding['positive_references'][0]['transfer_mode'],'technique_only')

    def test_27_clean_ignores_speculative_location(self):
        response=response_fixture(self.req,{'q0_location':'s1'})
        report=r.compile_report(self.cards,self.req,self.binding,response)
        self.assertEqual(report['findings'],[])
        self.assertEqual(len(report['decisions']),3)

    def test_28_unknown_and_not_applicable_are_preserved(self):
        response=response_fixture(self.req,{'q0_diagnosis':'INSUFFICIENT_CONTEXT','q1_diagnosis':'NOT_APPLICABLE'})
        report=r.compile_report(self.cards,self.req,self.binding,response)
        self.assertEqual(report['decisions'][0]['decision'],'INSUFFICIENT_CONTEXT')
        self.assertEqual(report['decisions'][1]['decision'],'NOT_APPLICABLE')
        self.assertFalse(report['publish_authorized'])

    def test_29_request_or_asset_mutation_rejected(self):
        response=response_fixture(self.req)
        req=copy.deepcopy(self.req);req['state']['target_text']+='改变'
        with self.assertRaises(r.ContractError):r.compile_report(self.cards,req,self.binding,response)
        cards=copy.deepcopy(self.cards);cards[self.ids[0]]['desired_behavior']='已篡改'
        with self.assertRaises(r.ContractError):r.compile_report(cards,self.req,self.binding,response)

    def test_30_context_receipt_mutation_rejected(self):
        b=copy.deepcopy(self.binding);b['context_digest']='invalid'
        with self.assertRaises(r.ContractError):
            r.compile_report(self.cards,self.req,b,response_fixture(self.req))

    def test_31_positive_choices_include_abstention(self):
        req=r.build_positive_selection_request(self.cards,self.ids,self.text,self.context)
        opts=req['questions']['positive_reference']['criteria']
        self.assertIn('KEEP_DRAFT',opts);self.assertIn('NONE',opts)
        self.assertIn('PEC-FCT-001:good',opts)

    def test_32_meta_examples_rejected_for_player_channel(self):
        context={**self.context,'channel':'player_narration'}
        with self.assertRaises(r.ContractError):
            r.build_positive_selection_request(self.cards,['PEC-OUT-009'],self.text,context)

    def test_33_repair_task_does_not_execute(self):
        response=response_fixture(self.req,{'q0_diagnosis':'VIOLATION','q0_location':'s1'})
        report=r.compile_report(self.cards,self.req,self.binding,response)
        task=r.compile_repair_task(self.text,self.context,report)
        self.assertFalse(task['automatic_execution_allowed'])
        self.assertFalse(task['allow_new_world_facts'])
        self.assertEqual(task['max_rewrite_attempts'],1)
        self.assertEqual(task['output_channel'],'unpublished_draft')

    def test_34_root_cause_routes_to_owner(self):
        req,b=r.build_diagnosis_request(self.cards,['PEC-FCT-010'],self.text,self.context)
        response=response_fixture(req,{'q0_diagnosis':'VIOLATION','q0_location':'s1'})
        report=r.compile_report(self.cards,req,b,response)
        task=r.compile_repair_task(self.text,self.context,report)
        self.assertEqual(task['candidate_local_repairs'],[])
        self.assertEqual(task['route_to_owner'][0]['repair_owner'],'privacy_projection')

    def test_35_stale_repair_task_rejected(self):
        report=r.compile_report(self.cards,self.req,self.binding,response_fixture(self.req))
        with self.assertRaises(r.ContractError):r.compile_repair_task(self.text+' ',self.context,report)
        with self.assertRaises(r.ContractError):r.compile_repair_task(self.text,{**self.context,'revision':999},report)

    def test_36_live_requires_key_and_obeys_local_budget(self):
        with self.assertRaises(r.ContractError):r.call_typesafe(self.req,api_key='')
        with self.assertRaises(r.ContractError):r.call_typesafe(self.req,api_key='fake',max_request_bytes=1)

    def test_37_provider_errors_do_not_become_clean(self):
        with patch('reference.urllib.request.build_opener') as p:
            p.return_value.open.side_effect=urllib.error.URLError('simulated; no connection')
            with self.assertRaises(r.ProviderError):r.call_typesafe(self.req,api_key='fake-for-fixture')
            self.assertEqual(p.return_value.open.call_count,1)

    def test_38_dry_run_cli_has_no_network_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=['reference.py','--output-prefix',str(Path(tmp)/'dry')]
            with patch.object(sys,'argv',args),patch('reference.call_typesafe') as live:
                self.assertEqual(r.main(),0)
                live.assert_not_called()
            self.assertTrue((Path(tmp)/'dry.request.json').exists())
            self.assertFalse((Path(tmp)/'dry.response.json').exists())

    def test_39_transport_rejects_redirect(self):
        req=r.urllib.request.Request(r.ENDPOINT)
        with self.assertRaises(urllib.error.HTTPError):
            r._NoRedirect().redirect_request(req,None,302,'fake',{},'https://example.invalid')

    def test_40_card_loader_rejects_duplicate_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=self.cards['PEC-FCT-001'];p=Path(tmp)/'dup.jsonl'
            p.write_text(json.dumps(c)+'\n'+json.dumps(c)+'\n')
            with self.assertRaises(r.ContractError):r.load_cards(p)


if __name__=='__main__':unittest.main()
