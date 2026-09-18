"""The UI must not forge an action when it polls the investigator sheet."""
import json
import shutil

import pytest

from conftest import CAMPAIGN, CONTENT_DIR, MODULE, PREGEN, RpcClient, campaign_dir, create_campaign, open_turn  # noqa: F401


def test_sheet_is_read_only_and_hides_undiscovered_clues(kernel):
    client = kernel
    create_campaign(client)
    root = campaign_dir(client.workspace)
    before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
    first = client.ok('table.view', {'campaign': CAMPAIGN})
    second = client.ok('table.view', {'campaign': CAMPAIGN})
    after = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
    assert first == second
    assert before == after
    assert first['investigators']
    assert 'here' not in first['clues']
    assert first['state'] == client.table('status')['state']


def test_the_view_carries_the_clock_in_the_fiction_not_only_elapsed(kernel):
    """The panel prints when it is at the table, so `table.view` hands it the same clock the
    capsule gets (§23) -- The Haunting declares `start_clock.local_datetime`, so `at` moves with
    the world minutes while `elapsed` keeps counting from the campaign's own start."""
    open_turn(kernel, '我在门厅里等了一会儿。')
    assert kernel.ok('table.view', {'campaign': CAMPAIGN})['clock'] == {
        'minutes': 0, 'elapsed': '0 h 0 min', 'at': '1920-10-12T10:00', 'day_part': 'morning'}
    kernel.table('apply', call_id='t1-c1', effects=[{'kind': 'time', 'minutes': 250}])
    assert kernel.ok('table.view', {'campaign': CAMPAIGN})['clock'] == {
        'minutes': 250, 'elapsed': '4 h 10 min', 'at': '1920-10-12T14:10', 'day_part': 'afternoon'}


@pytest.mark.parametrize('start_time', [None, '23:30'])
def test_the_view_carries_a_day_clock_without_a_declared_date(tmp_path, start_time):
    content = tmp_path / 'content'
    shutil.copytree(CONTENT_DIR, content)

    def remove_date(value):
        if isinstance(value, dict):
            if 'start_clock' in value:
                value.pop('start_clock')
                value.pop('start_time', None)
                if start_time is not None:
                    value['start_time'] = start_time
            for child in value.values():
                remove_date(child)
        elif isinstance(value, list):
            for child in value:
                remove_date(child)

    for name in ('module-meta.json', 'module-graph.json'):
        path = content / 'starters/the-haunting' / name
        # Graph-only starters no longer carry a separate metadata file.
        if path.exists():
            data = json.loads(path.read_text())
            remove_date(data)
            path.write_text(json.dumps(data))
    client = RpcClient(tmp_path / 'workspace', content=content)
    try:
        opened = open_turn(client, 'I wait for a while.')
        # A book that named no opening hour opens at the system's default, 09:00 (contract §23).
        start = 9 * 60 if start_time is None else 23 * 60 + 30
        initial = {
            'minutes': 0, 'elapsed': '0 h 0 min', 'day': 1,
            'hh': '09' if start_time is None else '23',
            'mm': '00' if start_time is None else '30',
            'day_part': 'morning' if start_time is None else 'night'}
        assert client.ok('table.view', {'campaign': CAMPAIGN})['clock'] == initial
        assert opened['capsule']['where']['clock'] == {
            **initial,
            'pin': 'Use apply clock once to pin the opening local_datetime when the book gives no full date, keeping any declared start_time.'}
        client.table('apply', call_id='t1-c1', effects=[{'kind': 'time', 'minutes': 90}])
        clock = client.ok('table.view', {'campaign': CAMPAIGN})['clock']
        assert clock == {
            'minutes': 90, 'elapsed': '1 h 30 min',
            'day': 1 if start_time is None else 2,
            'hh': '10' if start_time is None else '01',
            'mm': '30' if start_time is None else '00',
            'day_part': 'morning' if start_time is None else 'small_hours'}
        assert clock['day'] - 1 == (start + clock['minutes']) // 1440
        # Advance to the next midnight, not a full day after the 90-minute reading.
        remaining = 1440 - (start + 90) % 1440
        ended = client.table('apply', call_id='t1-c2', effects=[{'kind': 'time', 'minutes': remaining}])
        clock = client.ok('table.view', {'campaign': CAMPAIGN})['clock']
        assert clock == {
            'minutes': 90 + remaining,
            'elapsed': f'{(90 + remaining) // 60} h {(90 + remaining) % 60} min',
            'day': 2 if start_time is None else 3,
            'hh': '00', 'mm': '00', 'day_part': 'small_hours'}
        assert clock['day'] - 1 == (start + clock['minutes']) // 1440
        assert ended['day_ended']['days'] == 1
    finally:
        client.close()


def test_sheet_does_not_persist_legacy_trail_migration(kernel):
    import json
    create_campaign(kernel)
    path = campaign_dir(kernel.workspace) / 'world.json'
    world = json.loads(path.read_text())
    world.pop('scene_trail', None)
    path.write_text(json.dumps(world))
    before = path.read_bytes()
    kernel.ok('table.view', {'campaign': CAMPAIGN})
    assert path.read_bytes() == before


def test_the_glossary_is_the_rules_data_in_the_campaigns_play_language(kernel):
    """The panel renders whatever `labels` says, so an empty map is an English sheet on a
    Chinese table -- which is what shipped. The words come from the rules tables, never
    from a table in code (§16.1)."""
    create_campaign(kernel)
    labels = kernel.ok('table.view', {'campaign': CAMPAIGN})['labels']
    assert labels['STR'] == '力量' and labels['POW'] == '意志'
    assert labels['Library Use'] == '图书馆使用' and labels['Spot Hidden'] == '侦查'
    # A characteristic check is filed under its full canonical word, so the glossary must
    # answer that form as well as the abbreviation (§23).
    assert labels['Appearance'] == '外貌'
    # Only what the data renames: nothing is minted here for a term the rulebook leaves alone.
    assert 'MOV' not in labels
    assert all(isinstance(value, str) and value for value in labels.values())


def test_an_english_table_gets_only_the_rows_the_data_declares_for_english(kernel):
    """No tag is a shortcut: the glossary is the union of the data's `en` rows, which exist only
    where the key is an identifier (the kernel's own words), never for a canonical English word."""
    kernel.ok('campaign.create', {'id': 'en1', 'module': MODULE, 'pregen': PREGEN, 'play_language': 'en'})
    labels = kernel.ok('table.view', {'campaign': 'en1'})['labels']
    assert 'STR' not in labels and 'Spot Hidden' not in labels and 'Antiquarian' not in labels
    assert labels['intact'] == 'Intact' and labels['sanity_bout'] == 'Bout of madness'


def test_a_discovered_clue_is_listed_by_the_name_the_table_gave_it(kernel):
    """`discovered_clues` is handles because that is what the world files. The player reads
    this list, so the projection carries the Keeper's own name and account for the clue, never
    the module's Keeper-only summary (§80)."""
    open_turn(kernel)
    kernel.table('apply', call_id='t1-c1',
                 effects=[{'kind': 'clue', 'clue': 'knott-commission', 'label': '诺特的委托合同',
                           'how': '诺特当面委托调查房屋。'}])
    row = kernel.ok('table.view', {'campaign': CAMPAIGN})['clues']['discovered'][0]
    assert row['clue'] == 'knott-commission' and row['label'] == '诺特的委托合同'
    assert row['how'] == '诺特当面委托调查房屋。'
    assert 'summary' not in row


def test_an_unnamed_clue_falls_back_to_the_graph_rather_than_to_its_handle(kernel):
    open_turn(kernel)
    kernel.table('apply', call_id='t1-c1', effects=[{'kind': 'clue', 'clue': 'knott-commission'}])
    row = kernel.ok('table.view', {'campaign': CAMPAIGN})['clues']['discovered'][0]
    assert row['clue'] == 'knott-commission'
    assert row['label'] and row['label'] != 'knott-commission'
    # The label IS the graph's own words here, so the summary repeats it and stays off the row.
    assert 'summary' not in row
