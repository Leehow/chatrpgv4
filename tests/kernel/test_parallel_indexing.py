"""Selective source routing and ownership; transport tests, not gameplay."""
import hashlib
from pathlib import Path

from coc.modules.reading import Reading
from coc.modules.store import ModuleStore
from module_helpers import observed, write, opening, finish, request


def book(kernel, tmp_path, pages=669):
    source = tmp_path / 'source.pdf'
    source.write_bytes(b'%PDF-unit-source')
    return kernel.ok('module.source.bind', {'source': {'path': str(source),
        'file_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'page_count': pages}})['module_id']


def test_cold_long_book_queues_opening_directly_and_new_questions_revisit_ready_entities(kernel, tmp_path):
    mid = book(kernel, tmp_path)
    job, draft, review = opening(kernel, mid)
    store = ModuleStore(kernel.workspace)
    assert len(store.read_queue(mid)) == 2
    assert job['pages'] == [] and job['purpose'] == 'opening'
    assert [row['purpose'] for row in store.read_queue(mid)] == ['opening', 'index']
    assert not store.module(mid)['reading']['index_complete']
    finish(kernel, job)
    first = request(kernel, mid, 'detail', focus='Lena', question='What does she know about the tower?')
    same = request(kernel, mid, 'detail', focus='Lena', question='What does she know about the tower?')
    other = request(kernel, mid, 'detail', focus='Lena', question='What is her biography?')
    assert first['job_id'] == same['job_id'] != other['job_id']
    assert len(store.read_queue(mid)) == 4
    assert store.module(mid)['reading']['viewed_pages'] == [0, 1]
    focused = kernel.ok('module.read.claim', {'module_id': mid})
    assert focused['purpose'] == 'detail' and focused['question'] == 'What does she know about the tower?', store.read_queue(mid)
    automatic = kernel.ok('module.read.claim', {'module_id': mid})
    assert automatic['purpose'] == 'index'


def test_selective_navigation_is_one_owned_job_and_unread_ranges_remain_navigation(kernel, tmp_path):
    mid = book(kernel, tmp_path)
    first, other = Reading(ModuleStore(kernel.workspace)), Reading(ModuleStore(kernel.workspace))
    try:
        first.request({'module_id': mid, 'purpose': 'index'})
        abandoned = first.claim({'module_id': mid})
        assert abandoned['pages'] == []
        assert other.claim({'module_id': mid}) == {'job_id': None}
        first.release(mid)
        recovered = other.claim({'module_id': mid})
        assert recovered['job_id'] == abandoned['job_id'] and recovered['lease'] != abandoned['lease']
        assert recovered['attempts'] == 2 and Path(abandoned['work_dir']).exists()
        observed(recovered, read_pages=[5], full_pages=[5])
        write(Path(recovered['work_dir']) / 'draft.json', {'sections': [
            {'name': 'An authored chapter', 'pages': [[50, 93]], 'source_refs': [{'page': 5}]}]})
        other.finish({'module_id': mid, 'job_id': recovered['job_id'], 'lease': recovered['lease'],
            'outcome': 'completed', 'draft_path': str(Path(recovered['work_dir']) / 'draft.json')})
        state = other.store.module(mid)['reading']
        assert state['index_complete'] and state['viewed_pages'] == [4]
        assert other.store.read_sections(mid)[0]['pages'] == [[49, 92]]
    finally:
        first.release(mid)
        other.release(mid)


def test_foreground_question_claims_a_slot_while_background_reading_is_running(kernel, tmp_path):
    mid = book(kernel, tmp_path)
    first, other = Reading(ModuleStore(kernel.workspace)), Reading(ModuleStore(kernel.workspace))
    try:
        first.request({'module_id': mid, 'purpose': 'detail', 'focus': 'Museum'})
        background = first.claim({'module_id': mid})
        first.request({'module_id': mid, 'purpose': 'detail', 'focus': 'Hotel'})
        assert other.claim({'module_id': mid}) == {'job_id': None}
        other.request({'module_id': mid, 'purpose': 'detail', 'focus': 'Dinner', 'question': 'What evidence is shown?', 'foreground': True})
        foreground = other.claim({'module_id': mid})
        assert foreground['focus'] == 'Dinner' and foreground['concurrency'] == 2
        assert background['job_id'] != foreground['job_id']
        assert first.claim({'module_id': mid}) == {'job_id': None}
    finally:
        first.release(mid)
        other.release(mid)


def test_empty_detail_requests_never_dispatch_an_unbounded_reader(kernel, tmp_path):
    mid = book(kernel, tmp_path)
    error = kernel.err('module.read.request', {'module_id': mid, 'purpose': 'detail'})
    assert error['code'] == 'invalid_params'
    assert ModuleStore(kernel.workspace).read_queue(mid) == []
    assert kernel.err('module.read.request', {'module_id': mid, 'purpose': 'detail', 'question': 'What is the route?'})['code'] == 'invalid_params'


def test_same_focus_waits_for_background_publication_instead_of_racing_its_dossier(kernel, tmp_path):
    mid = book(kernel, tmp_path)
    first, other = Reading(ModuleStore(kernel.workspace)), Reading(ModuleStore(kernel.workspace))
    try:
        first.request({'module_id': mid, 'purpose': 'detail', 'focus': 'Meeting Nayra'})
        background = first.claim({'module_id': mid})
        other.request({'module_id': mid, 'purpose': 'detail', 'focus': 'meeting nayra',
                       'question': 'Who introduces the investigators?', 'foreground': True})
        assert other.claim({'module_id': mid}) == {'job_id': None}
        first.finish({'module_id': mid, 'job_id': background['job_id'], 'lease': background['lease'], 'outcome': 'cancelled'})
        assert other.claim({'module_id': mid})['question'] == 'Who introduces the investigators?'
    finally:
        first.release(mid)
        other.release(mid)
