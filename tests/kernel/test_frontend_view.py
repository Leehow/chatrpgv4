"""The UI must not forge an action when it polls the investigator sheet."""
from conftest import CAMPAIGN, campaign_dir, create_campaign


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
