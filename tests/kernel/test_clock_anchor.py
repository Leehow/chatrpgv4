"""The Keeper pins an undeclared opening once; projections and midnight use that anchor."""
import json
import shutil

import pytest

from conftest import CONTENT_DIR, RpcClient, campaign_dir, create_campaign, open_turn, read_json


@pytest.fixture(params=[None])
def undated(request, tmp_path):
    content = tmp_path / 'content'
    shutil.copytree(CONTENT_DIR, content)

    def remove_date(value):
        if isinstance(value, dict):
            declared = 'start_clock' in value or 'start_time' in value
            value.pop('start_clock', None)
            value.pop('start_time', None)
            if declared and request.param is not None:
                value['start_time'] = request.param
            for child in value.values():
                remove_date(child)
        elif isinstance(value, list):
            for child in value:
                remove_date(child)

    for name in ('module-meta.json', 'module-graph.json'):
        path = content / 'starters/the-haunting' / name
        if path.exists():
            data = json.loads(path.read_text())
            remove_date(data)
            path.write_text(json.dumps(data))
    client = RpcClient(tmp_path / 'workspace', content=content)
    try:
        yield client
    finally:
        client.close()


def pin(client, stamp='1975-07-14T09:00', call_id='t1-c1', reject=False):
    method = client.table_err if reject else client.table
    return method('apply', call_id=call_id, effects=[{
        'kind': 'clock', 'local_datetime': stamp, 'why': 'The book gives only the month.'}])


def clock(client):
    return client.table('view')['clock']


def assert_refusal(error, fix):
    assert error['code'] == 'invalid_params'
    assert fix in error['fix']
    print('REFUSAL', json.dumps(error))


def test_pin_projects_records_and_advances(undated):
    opened = open_turn(undated, 'I look around.')
    before = clock(undated)
    assert before == {'minutes': 0, 'elapsed': '0 h 0 min', 'day': 1,
                      'hh': '09', 'mm': '00', 'day_part': 'morning'}
    assert 'apply clock' in opened['capsule']['where']['clock']['pin']
    root = campaign_dir(undated.workspace)
    events_before = (root / 'events.jsonl').read_bytes()
    result = pin(undated)
    after = clock(undated)
    assert after == {'minutes': 0, 'elapsed': '0 h 0 min',
                     'at': '1975-07-14T09:00', 'day_part': 'morning'}
    assert before['minutes'] == after['minutes']
    assert undated.table('capsule')['where']['clock'] == after
    assert result['world']['clock'] == {'minutes': 0, 'start_local': '1975-07-14T09:00'}
    assert result['receipts'] == ['clock:t1-c1']
    receipt = next(r for r in undated.table('status')['receipts'] if r['kind'] == 'clock')
    assert receipt == {'id': 'clock:t1-c1', 'kind': 'clock', 'call_id': 't1-c1',
                       'local_datetime': '1975-07-14T09:00',
                       'why': 'The book gives only the month.', 'at': receipt['at']}
    assert (root / 'events.jsonl').read_bytes() == events_before
    assert 'day_ended' not in result
    print('CLOCK_BEFORE', json.dumps(before))
    print('CLOCK_AFTER', json.dumps(after))
    assert_refusal(pin(undated, call_id='t1-c2', reject=True), '1975-07-14T09:00')
    undated.table('apply', call_id='t1-c2', effects=[{'kind': 'time', 'minutes': 90}])
    assert clock(undated)['at'] == '1975-07-14T10:30'


def test_pin_in_opening_and_capsule(undated):
    create_campaign(undated)
    pin(undated, call_id='t0-c1')
    assert_refusal(pin(undated, call_id='t0-c2', reject=True), '1975-07-14T09:00')
    undated.table('narrate', call_id='t0-c2', text='The road stretches ahead.')
    opened = undated.table('player_input', text='I look around.')
    expected = {'minutes': 0, 'elapsed': '0 h 0 min',
                'at': '1975-07-14T09:00', 'day_part': 'morning'}
    assert clock(undated) == expected
    assert opened['capsule']['where']['clock'] == expected


def test_opening_mixed_batch_is_still_refused(undated):
    create_campaign(undated)
    error = undated.table_err('apply', call_id='t0-c1', effects=[
        {'kind': 'clock', 'local_datetime': '1975-07-14T09:00'},
        {'kind': 'clue', 'clue': 'knott-research-leads'}])
    assert error['code'] == 'turn_state'
    assert read_json(campaign_dir(undated.workspace) / 'world.json')['clock'] == {'minutes': 0}
    print('OPENING_MIXED_REFUSAL', json.dumps(error))


@pytest.mark.parametrize('opening', [False, True])
def test_module_date_cannot_be_overwritten(kernel, opening):
    create_campaign(kernel) if opening else open_turn(kernel)
    assert_refusal(pin(kernel, call_id='t0-c1' if opening else 't1-c1', reject=True),
                   '1920-10-12T10:00:00')


@pytest.mark.parametrize('undated', ['23:30'], indirect=True)
@pytest.mark.parametrize('opening', [False, True])
def test_module_clock_time_is_preserved(undated, opening):
    create_campaign(undated) if opening else open_turn(undated)
    call_id = 't0-c1' if opening else 't1-c1'
    assert_refusal(pin(undated, call_id=call_id, reject=True), '23:30')
    pin(undated, '1975-07-14T23:30', call_id=call_id)
    assert clock(undated) == {'minutes': 0, 'elapsed': '0 h 0 min',
                             'at': '1975-07-14T23:30', 'day_part': 'night'}


@pytest.mark.parametrize('stamp', [
    '1975-7-14T09:00', '1975-07-14 09:00', '1975-13-01T09:00',
    '1975-02-30T09:00', '1975-07-14T09:00Z', '1975-07-14T24:00',
    '1975-07-14T09:60', '1900-02-29T09:00', '1975-00-14T09:00',
    '1975-07-00T09:00', '1975-07-1T09:00', '1975-07-14T9:00',
    '1975-07-14T09:00+01:00', None,
])
def test_invalid_calendar_minutes_are_rejected(undated, stamp):
    open_turn(undated)
    assert_refusal(pin(undated, stamp, reject=True), 'YYYY-MM-DDTHH:MM')
    assert read_json(campaign_dir(undated.workspace) / 'world.json')['clock'] == {'minutes': 0}


def test_leap_day_is_accepted(undated):
    open_turn(undated)
    pin(undated, '2000-02-29T09:00')
    assert clock(undated)['at'] == '2000-02-29T09:00'


def test_midnight_uses_pinned_anchor(undated):
    open_turn(undated)
    pin(undated, '1975-07-14T20:00')
    advanced = undated.table('apply', call_id='t1-c2', effects=[{'kind': 'time', 'minutes': 300}])
    assert clock(undated)['at'] == '1975-07-15T01:00'
    assert advanced['day_ended']['days'] == 1


def test_pin_does_not_reset_elapsed_minutes(undated):
    open_turn(undated)
    undated.table('apply', call_id='t1-c1', effects=[{'kind': 'time', 'minutes': 90}])
    before = clock(undated)
    result = pin(undated, call_id='t1-c2')
    after = clock(undated)
    assert before['minutes'] == after['minutes'] == 90
    assert before['elapsed'] == after['elapsed'] == '1 h 30 min'
    assert after['at'] == '1975-07-14T10:30'
    assert 'day_ended' not in result
