"""Completed-campaign accounting seams; legacy fixtures are not gameplay evidence."""
import json

from conftest import CONTENT_DIR, RpcClient, campaign_dir, open_turn, read_json
from coc.rules import development
from coc.rules.tables import RuleTables
from test_rules_families import first_success


def end_session(client, call_id, **fields):
    return client.table('resolve', call_id=call_id, action={'intent': 'montage',
        'goal': 'Account for the source-reviewed conclusion.', 'method': '',
        'decision': 'development:end-session', **fields})


def legacy_completed(client):
    """Model the older release's completed status without a development capsule."""
    open_turn(client)
    call_id, _ = first_success(client, 't1-c', intent='investigate', goal='Inspect the desk.', method='Spot Hidden')
    ordinal = int(call_id.split('-c')[1]) + 1
    client.table('narrate', call_id=f't1-c{ordinal}', text='调查结束。')
    directory = campaign_dir(client.workspace)
    world = read_json(directory / 'world.json')
    world['ending'] = {'summary': 'The prior release closed the investigation.', 'turn': 1}
    (directory / 'world.json').write_text(json.dumps(world))
    meta = read_json(directory / 'campaign.json')
    meta.update(status='completed', ending=world['ending'])
    (directory / 'campaign.json').write_text(json.dumps(meta))
    return directory, world


def test_ending_requires_accounting_and_source_expression_uses_existing_frozen_plan(kernel):
    open_turn(kernel)
    directory = campaign_dir(kernel.workspace)
    before = (directory / 'world.json').read_bytes()
    error = kernel.table_err('apply', call_id='t1-c1', effects=[{'kind': 'time', 'minutes': 5},
        {'kind': 'ending', 'scope': 'campaign', 'summary': 'The investigation is over.'}])
    assert error['code'] == 'needs' and error['details']['reason'] == 'ending_settlement_required'
    assert 'development:end-session' in error['fix']
    assert (directory / 'world.json').read_bytes() == before
    result = end_session(kernel, 't1-c1', scenario_san_reward_expr='100D1')
    outcome = result['outcome']
    assert outcome['scenario_san_reward_roll']['total'] == 100
    assert outcome['san_after'] == 99
    assert kernel.table('look', focus='investigator')['san'] == 99
    capsule = development.load_ending_capsule(directory, outcome['ending_id'])
    assert capsule['scenario_san_reward_expr'] == '100D1'
    assert capsule['development_inputs']['thomas-hayes']['deterministic_plan']['scenario_san_reward']['total'] == 100
    kernel.table('apply', call_id='t1-c2', effects=[{'kind': 'ending', 'scope': 'campaign', 'summary': 'The investigation is over.'}])
    kernel.table('narrate', call_id='t1-c3', text='调查结束。')
    kernel.table('player_input', text='核对结算。')
    replay = end_session(kernel, 't2-c1')
    assert replay['outcome']['ending_id'] == outcome['ending_id']
    assert replay['outcome']['status'] == 'replayed' and replay['effects'] == []
    assert len(development.list_endings(directory)) == 1


def test_late_accounting_preserves_ending_and_cannot_repeat_or_replace_reward(kernel):
    directory, world = legacy_completed(kernel)
    old_record = (directory / 'turns/0001.json').read_bytes()
    kernel.table('player_input', text='请补齐遗漏的结算。')
    before = kernel.table('look', focus='investigator')
    result = end_session(kernel, 't2-c1', scenario_san_reward_expr='1D8')
    outcome = result['outcome']
    capsule = development.load_ending_capsule(directory, outcome['ending_id'])
    assert capsule['campaign_ending_turn'] == 1
    assert capsule['development_inputs']['thomas-hayes']['skills_checked']
    assert 1 <= outcome['scenario_san_reward_roll']['total'] <= 8
    after = kernel.table('look', focus='investigator')
    assert after['san'] > before['san']
    assert read_json(directory / 'world.json') == world
    assert read_json(directory / 'campaign.json')['status'] == 'completed'
    assert (directory / 'turns/0001.json').read_bytes() == old_record
    assert end_session(kernel, 't2-c1', scenario_san_reward_expr='1D8')['replayed']
    replay = end_session(kernel, 't2-c2', scenario_san_reward_expr='1D8')
    assert replay['outcome']['status'] == 'replayed' and replay['effects'] == []
    error = kernel.table_err('resolve', call_id='t2-c3', action={'intent': 'montage', 'goal': 'Change rewards.',
        'method': '', 'decision': 'development:end-session', 'scenario_san_reward_expr': '10D8'})
    assert error['code'] == 'idempotency_conflict' and 'frozen' in error['message']
    assert kernel.table('look', focus='investigator') == after
    kernel.table('narrate', call_id='t2-c4', text='遗漏的结算已经补齐，原结局保持不变。')
    client = RpcClient(kernel.workspace)
    try:
        client.table('open')
        client.table('player_input', text='再核对一次。')
        again = end_session(client, 't3-c1')
        assert again['outcome']['ending_id'] == outcome['ending_id'] and again['effects'] == []
        assert client.table('look', focus='investigator') == after
        assert len(development.list_endings(directory)) == 1
        assert (directory / 'turns/0001.json').read_bytes() == old_record
    finally:
        client.close()


def test_postgame_allowlist_blocks_adventure_and_routing_overrides(kernel):
    directory, world = legacy_completed(kernel)
    kernel.table('player_input', text='核对结算。')
    for effect in ({'kind': 'time', 'minutes': 5}, {'kind': 'ending', 'summary': 'Replace ending.'},
                   {'kind': 'flag', 'name': 'new-adventure', 'value': True}):
        assert kernel.table_err('apply', call_id='t2-c1', effects=[effect])['code'] == 'campaign_not_ready'
    for extra in ({'decision': 'core-check:ordinary-check'}, {'push': True}, {'luck': 1},
                  {'target': 'Steven Knott'}, {'intent': 'investigate'}):
        action = {'intent': 'montage', 'goal': 'Continue the adventure.', 'method': '',
                  'decision': 'development:end-session', **extra}
        assert kernel.table_err('resolve', call_id='t2-c1', action=action)['code'] == 'campaign_not_ready'
    assert read_json(directory / 'world.json') == world
    invalid = kernel.table_err('resolve', call_id='t2-c1', action={'intent': 'montage', 'goal': 'Account.',
        'method': '', 'decision': 'development:end-session', 'scenario_san_reward_expr': 'not-dice'})
    assert invalid['code'] == 'invalid_params'
    assert development.list_endings(directory) == []
    kernel.table('ask', call_id='t2-c2', kind='story', prompt='先核对哪部分？', options=['源奖励', '成长'])
    assert kernel.table('player_input', text='先核对源奖励。')['state'] == 'open'
    assert read_json(directory / 'campaign.json')['status'] == 'completed'


def test_completed_pending_settlement_reuses_the_frozen_source_reward(kernel):
    directory, _ = legacy_completed(kernel)
    sheet = read_json(directory / 'party/thomas-hayes.json')
    tables = RuleTables(CONTENT_DIR / 'rulesets/coc7/rules-json')
    capsule = development.build_ending_capsule(tables, directory,
        {'scene_id': 'commission-briefing', 'kind': 'conclusion', 'decision_id': 't1-c90',
         'investigator_ids': ['thomas-hayes'], 'scenario_san_reward_expr': '1D8'},
        {'thomas-hayes': sheet}, luck_recovery_gate=None, captured_at='2026-01-01T00:00:00Z')
    development.persist_ending_capsule(directory, capsule)
    kernel.table('player_input', text='恢复待完成的结算。')
    result = kernel.table('resolve', call_id='t2-c1', action={'intent': 'montage', 'goal': 'Finish pending accounting.',
        'method': '', 'decision': 'development:settle-ending'})
    assert result['outcome']['ending_id'] == capsule['ending_id']
    assert result['outcome']['scenario_san_reward_roll'] == capsule['development_inputs']['thomas-hayes']['deterministic_plan']['scenario_san_reward']
    assert development.pending_settlements(directory) == []
    assert end_session(kernel, 't2-c2')['outcome']['status'] == 'replayed'
