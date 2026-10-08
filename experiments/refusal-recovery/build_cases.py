#!/usr/bin/env python3
# Contract §197: builds the live reviewer probe's cases (experiments/refusal-recovery/probe.mjs) from the tables' own
# evidence, read only: the App's turn records and telemetry, the session tool calls, and the TR-F2 replay fixture. The
# output carries the tables' prose and stays outside the repository.
#   python3 experiments/refusal-recovery/build_cases.py <cases.json outside the repository>
import json, os, re, sys
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..')
HOME=os.path.expanduser('~/Library/Application Support/Pipi/pipicoc/pi-coc')
CAMP={'F2':'game-565055f1-8a99-4e69-9932-ca64c0e27d93','R3':'game-af36b938-4ca6-421e-bdec-759080123f69','F':'game-56788eff-11bf-4bfb-98e0-b47712330b3e'}
SESS={'F2':'2026-10-08T12-52-28-304Z_3fc2f27a-a6b5-4ad7-bfc6-92c71536e4ec.jsonl','R3':'2026-10-08T14-51-49-179Z_e8f5cec8-a956-40b5-84bc-60088ece43ab.jsonl'}
SDIR=os.path.join(HOME,'agent/ui-sessions/play/%2FUsers%2Fhaoli%2Fleehow%2Fplaytests%2Fjev-gui-20260928')
def turn(run,n):
    p=os.path.join(HOME,'.coc/campaigns',CAMP[run],'turns','%04d.json'%n)
    return json.load(open(p))
def context(run,n):
    prev=turn(run,n-1); w=prev.get('world') or {}
    delivered=[]
    for k in range(max(0,n-4),n):
        t=turn(run,k)
        if t.get('rendered_text'): delivered.append({'turn':k,'player':t.get('player_text'),'keeper':t['rendered_text']})
    sc=w.get('scene') or {}
    return {'turn':n,'playerText':turn(run,n)['player_text'],
      'investigators':[{'name':i['name']} for i in w.get('investigators',[])],
      'scene':sc.get('display_name') or sc.get('name'),
      'present':[p.get('name') if isinstance(p,dict) else p for p in (w.get('present') or [])],
      'delivered':delivered,'landed':[],'refused':[]}
sessions={}
def call(run,prefix):
    if run not in sessions: sessions[run]=[json.loads(l) for l in open(os.path.join(SDIR,SESS[run])) if l.strip()]
    for r in sessions[run]:
        for c in (r.get('message') or {}).get('content',[]) or []:
            if isinstance(c,dict) and c.get('type')=='toolCall' and c['id'].startswith(prefix): return c['arguments']
    raise KeyError(prefix)
tele={}
def destinations(run):
    if run not in tele: tele[run]=[json.loads(l) for l in open(os.path.join(HOME,'.coc/campaigns',CAMP[run],'telemetry.jsonl')) if l.strip()]
    out={}
    for r in tele[run]:
        if r.get('lane')!='admission': continue
        for line in r.get('proposed') or []:
            m=re.match(r'apply move: to="([^"]+)".*registered_destination=(\{.*\})$',line)
            if m:
                d=json.loads(m.group(2))
                out[m.group(1)]={'requested':m.group(1),**{k:d[k] for k in ('handle','label','summary','canonical_name') if k in d},
                  **({'aliases':d['also_called']} if 'also_called' in d else {}),**({'access':d['access']} if 'access' in d else {})}
    return out
cases=[]
def case(id,run,n,effects,line,expect,note,player=None):
    ctx=context(run,n)
    if player: ctx['playerText']=player
    cases.append({'id':id,'run':run,'turn':n,'effects':effects,'line':line,'destinations':destinations(run),'context':ctx,'expect':expect,'note':note})
r3t1=call('R3','call_424758cdccc0495')['effects']
case('R3-T1-alias','R3',1,r3t1,0,'admit','cross-language alias: also_called Globe clipping archive')
r3t9=call('R3','call_dd442275156f4f6')['effects']
case('R3-T9-clerk','R3',9,r3t9,0,'admit','over-literal: the player asked the clerk; earlier plan named the archive')
r3t12=call('R3','call_fdc24739756e4ee')['effects']
case('R3-T12-find','R3',12,r3t12,1,'admit','the find of a chosen search (the Latin tome beside the journal)')
case('R3-T12-journal','R3',12,r3t12,0,'admit','the journal the player searched for (stopped unanswered on the table)')
r3t16=call('R3','call_55db04c48251439')['effects']
case('R3-T16-holdback','R3',16,r3t16,0,'refuse:keeper_added','not yet: find the door, look down, do not go down')
case('R3-T17-control','R3',16,r3t16,0,'admit','control: T16 context, T17 words (walks down the stairs)',player=turn('R3',17)['player_text'])
case('R3-T1-interest-control','R3',1,r3t1,0,'refuse','control: interest only (那看看报纸) with the same move',player='那看看报纸')
fx=json.load(open(os.path.join(ROOT,'tests/extension/fixtures/refusal-recovery-trf2.json')))
case('F2-T1-handover','F2',1,fx['T1']['apply']['effects'],0,'admit','the captain hands over the folder (no giver named)')
case('F2-T3-farm','F2',3,fx['T3']['apply']['effects'],0,'admit','control: the farm the player named')
case('F2-T3-added','F2',3,fx['T3']['apply']['effects'],1,'refuse:keeper_added','the Keeper adds the supervisor remote house')
case('F2-T9-mapped','F2',9,fx['T9']['apply']['effects'],0,'refuse:keeper_added','the dead witness home mapped onto the Abramov house')
case('F2-T16-detour','F2',16,fx['T16']['apply']['effects'],0,'refuse:keeper_added','the farm detour')
case('F2-T16-house','F2',16,fx['T16']['apply']['effects'],1,'admit','the Abramov house the player named')
trf=[json.loads(l) for l in open(os.path.join(HOME,'.coc/campaigns',CAMP['F'],'telemetry.jsonl')) if l.strip()]
line=[x for r in trf if r.get('lane')=='admission' and r.get('turn')==3 for x in (r.get('proposed') or []) if x.startswith('apply move')][0]
m=re.match(r'apply move: to="([^"]+)"; label="([^"]+)"; via="([^"]+)"; registered_destination=(\{.*\})$',line)
d=json.loads(m.group(4))
mv={'kind':'move','to':m.group(1),'label':m.group(2),'via':m.group(3)}
ctx=context('F',3)
cases.append({'id':'TRF-t3-speech','run':'F','turn':3,'effects':[mv],'line':0,'destinations':{m.group(1):{'requested':m.group(1),**{k:d[k] for k in ('handle','label','summary') if k in d}}},'context':ctx,'expect':'refuse','note':'speech: tells the captain he will set out today while asking names'})
json.dump(cases,open(sys.argv[1],'w'),ensure_ascii=False,indent=1)
for c in cases: print(c['id'], c['context']['scene'], len(c['context']['delivered']), c['context']['playerText'][:40], [e.get('kind') for e in c['effects']])
