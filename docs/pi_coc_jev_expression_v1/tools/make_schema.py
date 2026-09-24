#!/usr/bin/env python3
from pathlib import Path
import json
R=Path(__file__).resolve().parents[1]
s={'type':'string','minLength':1}
arr=lambda item: {'type':'array','items':item}
ref=lambda x: {'$ref':'#/$defs/'+x}
obj=lambda p,req=None,extra=False: {'type':'object','properties':p,'required':list(p) if req is None else req,'additionalProperties':extra}
D={
 'context':obj({'authoritative_context':s,'task':s,'channel':s,'scope_complete':{'type':'boolean'},'context_format':s,'note':s},['authoritative_context','task','channel','scope_complete','context_format']),
 'example':obj({'example_id':s,'text':s,'explanation':s}),
 'boundary':obj({'example_id':s,'context':ref('context'),'text':s,'explanation':s,'expected_decision':{'enum':['CLEAN','NOT_APPLICABLE','INSUFFICIENT_CONTEXT']}}),
 'diagnosis':obj({'question':s,'violation_definition':s,'legitimate_exception':s,'decision_options':obj({k:s for k in ['VIOLATION','CLEAN','NOT_APPLICABLE','INSUFFICIENT_CONTEXT']}),'raw_probability_is_not_calibrated_correctness':{'const':True}}),
 'repair':obj({'owner':s,'objective':s,'positive_example_ids':arr(s),'preserve':arr(s),'transfer_mode':{'const':'technique_only'},'no_new_world_facts':{'const':True},'auto_repair_enabled':{'type':'boolean'}}),
 'review':obj({'status':{'enum':['pending','reviewed','rejected']},'calibration_status':{'enum':['unvalidated','calibrated']},'production_ready':{'type':'boolean'}}),
 'provenance':obj({'origin':s,'created_on':s,'book_excerpt':{'const':False},'copyright_note':s})
}
p={
 'schema_version':{'const':'1.0.0'},'card_id':{'type':'string','pattern':'^PEC-[A-Z]{3}-[0-9]{3}$'},
 'numeric_id':{'type':'integer','minimum':1001},'card_version':s,
 'family':{'enum':['FCT','AGY','CLR','SEN','HOR','LYR','DIA','VOI','PAC','MEM','RUL','OUT']},
 'family_name':s,'title':s,'scope':{'enum':['turn','clause','dialogue','window']},
 'channels':arr(s),'activation':{'enum':['integrity','style','diagnostic_meta']},
 'default_severity':{'enum':['blocker','major','minor']},'applicability':s,
 'failure_mode':s,'desired_behavior':s,'required_context':arr(s),'not_a_keyword_rule':{'const':True},
 'contrast':obj({'context':ref('context'),'negative':ref('example'),'positive':ref('example')}),
 'boundary':ref('boundary'),'diagnosis':ref('diagnosis'),'repair':ref('repair'),
 'related_card_ids':arr(s),'legacy_contract_refs':arr(s),'retrieval_text':s,
 'review':ref('review'),'provenance':ref('provenance')
}
schema={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:pi-coc:expression-card:1.0.0','title':'Expression Card v1',**obj(p),'$defs':D}
(R/'schema/card.schema.json').write_text(json.dumps(schema,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
