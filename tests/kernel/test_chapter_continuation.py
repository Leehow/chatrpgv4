"""A chapter closes its accounting, not the campaign or the next scene."""
from conftest import RpcClient, campaign_dir, narrate, open_turn, read_json
from coc.rules import development
from test_postgame_settlement import end_session, legacy_completed


def rewards_on_disk(directory):
    root = directory / 'save/development-settlements'
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*.json')}


def end_effect(scope='chapter'):
    return {'kind': 'ending', 'scope': scope, 'summary': 'This chapter is resolved.'}


def move_on(client, call_id):
    return client.table('apply', call_id=call_id, effects=[{
        'kind': 'move', 'to': 'hall-of-records', 'via': 'The next investigation begins at the records office.',
        'travel_minutes': 0}])


def test_ending_scope_is_explicit_and_validated_before_world_effects(kernel):
    open_turn(kernel)
    directory = campaign_dir(kernel.workspace)
    before = (directory / 'world.json').read_bytes()
    for effect in ({'kind': 'ending', 'summary': 'Done.'}, end_effect('unknown')):
        error = kernel.table_err('apply', call_id='t1-c1', effects=[{'kind': 'time', 'minutes': 10}, effect])
        assert error['code'] == 'needs'
        assert error['details']['reason'] == 'ending_scope_required'
        assert error['details']['options'] == ['chapter', 'campaign']
        assert (directory / 'world.json').read_bytes() == before


def test_chapter_accounting_replays_until_movement_then_next_session_can_settle(kernel):
    open_turn(kernel)
    directory = campaign_dir(kernel.workspace)
    result = end_session(kernel, 't1-c1', scenario_san_reward_expr='1D1')
    kernel.table('apply', call_id='t1-c2', effects=[end_effect()])
    closed = narrate(kernel, 't1-c3', '这一章结束，旅程仍将继续。')
    assert any(row.get('family') == 'chapter' for row in closed['mechanics'])
    meta = read_json(directory / 'campaign.json')
    assert meta['status'] == 'active' and meta['ending']['scope'] == 'chapter'
    sheet = (directory / 'party/thomas-hayes.json').read_bytes()
    rewards = rewards_on_disk(directory)
    kernel.table('player_input', text='核对上一章，然后继续。')
    replay = end_session(kernel, 't2-c1', scenario_san_reward_expr='1D1')
    assert replay['outcome']['ending_id'] == result['outcome']['ending_id']
    assert replay['effects'] == []
    kernel.table('apply', call_id='t2-c2', effects=[end_effect()])
    assert read_json(directory / 'world.json')['ending']['turn'] == 1
    kernel.table('ask', call_id='t2-c3', prompt='下一步去哪里？', options=['档案馆', '先休息'])
    kernel.table('player_input', text='去档案馆。')
    move_on(kernel, 't3-c1')
    narrate(kernel, 't3-c2', '你抵达档案馆，新的调查开始了。')
    assert read_json(directory / 'campaign.json')['status'] == 'active'
    assert read_json(directory / 'world.json')['ending']['continued'] is True
    assert (directory / 'party/thomas-hayes.json').read_bytes() == sheet
    assert rewards_on_disk(directory) == rewards
    kernel.table('player_input', text='新的调查结束，结算这一段。')
    new = end_session(kernel, 't4-c1')
    assert new['outcome']['ending_id'] != result['outcome']['ending_id']
    assert len(development.list_endings(directory)) == 2


def test_legacy_chapter_correction_preserves_history_and_rewards_and_survives_restart(kernel):
    directory, original = legacy_completed(kernel)
    original_turn = (directory / 'turns/0001.json').read_bytes()
    kernel.table('player_input', text='补齐上一章的结算。')
    settled = end_session(kernel, 't2-c1', scenario_san_reward_expr='1D8')
    narrate(kernel, 't2-c2', '奖励和成长已经结算。')
    accounting_turn = (directory / 'turns/0002.json').read_bytes()
    sheet = (directory / 'party/thomas-hayes.json').read_bytes()
    rewards = rewards_on_disk(directory)
    opened = kernel.table('player_input', text='上一章结束不代表整场战役结束，继续下一章。')
    assert 'legacy ending has no scope' in opened['capsule']['head']
    mixed = kernel.table_err('apply', call_id='t3-c1', effects=[end_effect(), {'kind': 'time', 'minutes': 1}])
    assert mixed['code'] == 'campaign_not_ready'
    result = kernel.table('apply', call_id='t3-c1', effects=[end_effect()])
    assert result['receipts']
    assert read_json(directory / 'campaign.json')['status'] == 'completed'
    assert kernel.table_err('apply', call_id='t3-c2', effects=[{'kind': 'time', 'minutes': 1}])['code'] == 'campaign_not_ready'
    assert kernel.table_err('ask', call_id='t3-c2', prompt='继续吗？', options=['继续', '暂停'])['code'] == 'invalid_params'
    narrate(kernel, 't3-c2', '秘鲁章节已结算，原来的调查员继续下一章。')
    meta = read_json(directory / 'campaign.json')
    assert meta['status'] == 'active'
    assert meta['ending']['scope'] == 'chapter'
    assert meta['ending']['turn'] == original['ending']['turn']
    assert meta['ending']['summary'] == original['ending']['summary']
    other = RpcClient(kernel.workspace)
    try:
        other.table('open')
        other.table('player_input', text='去下一处调查地点。')
        replay = end_session(other, 't4-c1')
        assert replay['outcome']['ending_id'] == settled['outcome']['ending_id']
        assert replay['effects'] == []
        move_on(other, 't4-c2')
        narrate(other, 't4-c3', '新的调查已经开始。')
        assert read_json(directory / 'campaign.json')['status'] == 'active'
    finally:
        other.close()
    assert (directory / 'turns/0001.json').read_bytes() == original_turn
    assert (directory / 'turns/0002.json').read_bytes() == accounting_turn
    assert (directory / 'party/thomas-hayes.json').read_bytes() == sheet
    assert rewards_on_disk(directory) == rewards


def test_explicit_campaign_ending_cannot_be_reclassified(kernel):
    open_turn(kernel)
    end_session(kernel, 't1-c1')
    kernel.table('apply', call_id='t1-c2', effects=[end_effect('campaign')])
    narrate(kernel, 't1-c3', '整场战役已经结束。')
    kernel.table('player_input', text='再开一章。')
    assert kernel.table_err('apply', call_id='t2-c1', effects=[end_effect()])['code'] == 'campaign_not_ready'


def test_legacy_correction_requires_existing_accounting(kernel):
    directory, original = legacy_completed(kernel)
    kernel.table('player_input', text='继续下一章。')
    error = kernel.table_err('apply', call_id='t2-c1', effects=[end_effect()])
    assert error['details']['reason'] == 'ending_settlement_required'
    assert read_json(directory / 'world.json') == original
