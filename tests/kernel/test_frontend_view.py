"""The UI must not forge an action when it polls the investigator sheet."""
from conftest import CAMPAIGN, MODULE, PREGEN, campaign_dir, create_campaign, open_turn  # noqa: F401


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


def test_an_english_table_gets_no_glossary_because_it_needs_none(kernel):
    kernel.ok('campaign.create', {'id': 'en1', 'module': MODULE, 'pregen': PREGEN, 'play_language': 'en'})
    assert kernel.ok('table.view', {'campaign': 'en1'})['labels'] == {}


def test_a_discovered_clue_is_listed_by_the_name_the_table_gave_it(kernel):
    """`discovered_clues` is handles because that is what the world files. The player reads
    this list, so the projection carries the keeper's own name for the clue (§23) plus the
    module's summary when it says more than that name -- what the panel unfolds into."""
    open_turn(kernel)
    kernel.table('apply', call_id='t1-c1',
                 effects=[{'kind': 'clue', 'clue': 'knott-commission', 'label': '诺特的委托合同'}])
    row = kernel.ok('table.view', {'campaign': CAMPAIGN})['clues']['discovered'][0]
    assert row['clue'] == 'knott-commission' and row['label'] == '诺特的委托合同'
    assert row['summary'].startswith('Landlord Steven Knott pays $20/day')


def test_an_unnamed_clue_falls_back_to_the_graph_rather_than_to_its_handle(kernel):
    open_turn(kernel)
    kernel.table('apply', call_id='t1-c1', effects=[{'kind': 'clue', 'clue': 'knott-commission'}])
    row = kernel.ok('table.view', {'campaign': CAMPAIGN})['clues']['discovered'][0]
    assert row['clue'] == 'knott-commission'
    assert row['label'] and row['label'] != 'knott-commission'
    # The label IS the graph's own words here, so the summary repeats it and stays off the row.
    assert 'summary' not in row
