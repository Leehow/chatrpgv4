"""Authored spatial projections and bounded previews; no gameplay acceptance."""
import copy
import json
import shutil

from conftest import CONTENT_DIR, RpcClient
from coc.capsule import BUDGETS, json_size, where_section
from coc.module_graph import ModuleGraph


PLACE_TEXT = ('The passage has worn stone walls, scattered rubble, low ceilings, and narrow alcoves. '
              'Its western branch connects to the workshop, while the eastern branch returns to the courtyard.')
RULE_TEXT = ('The entrance is difficult to notice because the surrounding masonry is broken and scattered, '
             'and the doorway is partly concealed by debris from the upper floor. '
             'Once discovered, entering the passage requires no skill roll.')


def spatial_graph():
    data = json.loads((CONTENT_DIR / 'starters/the-haunting/module-graph.json').read_text())
    scene = 'scene-commission-briefing'
    assert any(node['node_id'] == scene for node in data['nodes'])
    additions = [
        ('location-test-building', 'location', 'Test Building', ''),
        ('location-other-building', 'location', 'Other Building', ''),
        ('asset-direct-plan', 'asset', 'Direct Plan', ''),
        ('asset-building-plan', 'asset', 'Building Plan', ''),
        ('asset-unrelated-plan', 'asset', 'Unrelated Plan', ''),
    ]
    additions += [(f'location-room-{i}', 'location', f'Room {i}', PLACE_TEXT) for i in range(10)]
    additions += [(f'rule-passage-{i}', 'rule', f'Passage Rule {i}', RULE_TEXT) for i in range(8)]
    data['nodes'].extend({'node_id': nid, 'node_kind': kind, 'name': name, 'summary': summary,
                         'properties': {}, 'visibility': 'keeper-only',
                         'source_refs': [{'source_id': 'fixture', 'pdf_index': 0}]}
                        for nid, kind, name, summary in additions)
    links = [(scene, 'occurs-at', 'location-test-building'),
             ('asset-direct-plan', 'depicts', scene),
             ('asset-direct-plan', 'depicts', 'location-test-building'),
             ('asset-building-plan', 'depicts', 'location-test-building'),
             ('asset-unrelated-plan', 'depicts', 'location-other-building')]
    links += [(f'location-room-{i}', 'located-in', 'location-test-building') for i in range(10)]
    links += [(scene, 'uses-rule', f'rule-passage-{i}') for i in range(8)]
    data['relations'].extend({'relation_id': f'rel-spatial-fixture-{i}', 'relation_kind': kind,
                              'from_node_id': source, 'to_node_id': target, 'properties': {}}
                             for i, (source, kind, target) in enumerate(links))
    return data, scene


def test_compact_previews_admit_truncation_and_full_scene_retains_spatial_conditions(tmp_path):
    data, scene_id = spatial_graph()
    path = tmp_path / 'graph.json'
    path.write_text(json.dumps(data))
    graph = ModuleGraph('the-haunting', path)
    before = copy.deepcopy(graph.raw)
    scene = graph.nodes[scene_id]
    full = where_section(graph, {}, scene)
    compact = where_section(graph, {}, scene, compact=True)
    assert len(full['places']) == 10 and len(full['rules']) == 8
    assert all(row['line'] == PLACE_TEXT for row in full['places'])
    assert all(row['line'] == RULE_TEXT for row in full['rules'])
    assert 'truncated' not in full
    assert len(compact['places']) == graph.SCENE_PLACES
    assert len(compact['rules']) == graph.SCENE_RULES
    assert compact['truncated'] is True
    assert all(row['truncated'] and len(row['line']) <= graph.SCENE_PLACE_CHARS for row in compact['places'])
    assert all(row['truncated'] and len(row['line']) <= graph.SCENE_RULE_CHARS for row in compact['rules'])
    assert graph.raw == before
    assert full['exits'] == compact['exits']
    assert not any(row['to'] in ('workshop', 'courtyard') for row in full['exits'])


def test_scene_finds_maps_of_its_authored_location_once_without_unrelated_maps(tmp_path):
    data, scene_id = spatial_graph()
    path = tmp_path / 'graph.json'
    path.write_text(json.dumps(data))
    graph = ModuleGraph('the-haunting', path)
    assets = graph.scene_assets(graph.nodes[scene_id])
    names = [row['name'] for row in assets]
    assert names.count('Direct Plan') == 1
    assert names.count('Building Plan') == 1
    assert 'Unrelated Plan' not in names


def test_table_scene_look_is_full_while_turn_capsule_stays_bounded(tmp_path):
    data, _ = spatial_graph()
    content = tmp_path / 'content'
    shutil.copytree(CONTENT_DIR, content)
    (content / 'starters/the-haunting/module-graph.json').write_text(json.dumps(data))
    client = RpcClient(tmp_path / 'workspace', content=content)
    try:
        client.ok('campaign.create', {'id': 'c1', 'module': 'the-haunting',
                                      'pregen': 'thomas-hayes', 'play_language': 'en'})
        full = client.table('look', focus='scene')['where']
        assert len(full['places']) == 10 and full['places'][0]['line'] == PLACE_TEXT
        assert len(full['rules']) == 8 and full['rules'][0]['line'] == RULE_TEXT
        client.table('narrate', call_id='t0-c1', text='The owner places a key on the desk.')
        capsule = client.table('player_input', text='I examine the key.')['capsule']
        assert 'where' in capsule['truncated'] and capsule['where']['truncated'] is True
        assert len(capsule['where']['places']) <= ModuleGraph.SCENE_PLACES
        assert len(capsule['where']['rules']) <= ModuleGraph.SCENE_RULES
        assert json_size(capsule['where']) <= BUDGETS['where']
        again = client.table('look', focus='scene')['where']
        assert again['places'] == full['places'] and again['rules'] == full['rules']
    finally:
        client.close()
