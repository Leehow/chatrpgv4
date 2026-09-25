"""Checked source consultations exercise the TS RPC seam, not a simulated game."""
import copy
import hashlib
import json
from pathlib import Path

from module_helpers import indexed, opening, finish, request, claim, observed, write


def prepared(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    job, _, _ = opening(kernel, mid)
    finish(kernel, job)
    root = kernel.workspace / '.coc' / 'modules' / mid
    return mid, root


def answer_job(kernel, mid, question='What does the source say about her work?', **scope):
    params = dict(module_id=mid, purpose='answer', focus='Lena', question=question, foreground=True, **scope)
    queued = kernel.ok('module.read.request', params)
    job = kernel.ok('module.read.claim', dict(module_id=mid, owner='answer-test', **scope))
    assert job['job_id'] == queued['job_id'] and job['purpose'] == 'answer'
    work = Path(job['work_dir'])
    draft = dict(status='answered', answer='She works at the harbor.', source_refs=[dict(page=1)], limitations='This says nothing about her later movements.')
    write(work / 'draft.json', draft)
    observed(job)
    review = dict(checked=[dict(paths=['/status', '/answer', '/source_refs', '/limitations'], verdict='supported', source_refs=[dict(page=1)], reason='The original page supports this scoped answer.')], missing=[], draft_sha256=hashlib.sha256((work / 'draft.json').read_bytes()).hexdigest())
    write(work / 'review.json', review)
    return params, job, draft, review


def test_checked_answer_is_reused_without_publishing_a_graph(kernel, tmp_path):
    mid, root = prepared(kernel, tmp_path)
    before = json.loads((root / 'module.json').read_text())
    graph_bytes = (root / before['graph_file']).read_bytes()
    params, job, draft, _ = answer_job(kernel, mid)
    result = finish(kernel, job)
    assert result['state'] == 'ready'
    assert result['source_answer']['answer'] == draft['answer']
    assert result['source_answer']['authority'] == 'source-consultation'
    assert result['source_answer']['prepared'] is False
    assert result['source_answer']['source_refs'] == [dict(source_id=f'pdf:{mid}', pdf_index=0)]
    after = json.loads((root / 'module.json').read_text())
    for field in ['generation', 'graph_file', 'opening_ready', 'opening']:
        assert after[field] == before[field]
    assert after['reading']['materials'] == before['reading']['materials']
    assert (root / before['graph_file']).read_bytes() == graph_bytes
    assert kernel.ok('module.read.request', params)['source_answer'] == result['source_answer']
    assert finish(kernel, job)['replayed'] is True
    # A thin destination is not made playable by any answer.
    assert request(kernel, mid, 'detail', focus='Tower')['state'] == 'queued'


def test_answer_needs_question_and_independent_viewed_evidence(kernel, tmp_path):
    mid, _ = prepared(kernel, tmp_path)
    assert kernel.err('module.read.request', dict(module_id=mid, purpose='answer', focus='Lena'))['code'] == 'invalid_params'
    _, job, _, review = answer_job(kernel, mid)
    work = Path(job['work_dir'])
    args = dict(module_id=mid, job_id=job['job_id'], lease=job['lease'], outcome='completed', draft_path=str(work/'draft.json'), review_path=str(work/'review.json'))
    observed(job, review_pages=[])
    assert 'view' in kernel.err('module.read.finish', args)['message']
    observed(job)
    missing = copy.deepcopy(review)
    missing['checked'][0]['paths'].remove('/answer')
    write(work/'review.json', missing)
    assert 'omitted' in kernel.err('module.read.finish', args)['message']
    write(work/'review.json', review)
    changed = json.loads((work/'draft.json').read_text())
    changed['answer'] = 'A different unreviewed answer.'
    write(work/'draft.json', changed)
    assert 'candidate' in kernel.err('module.read.finish', args)['message']


def test_unresolved_answer_stays_non_authoritative_and_rejects_graph_fields(kernel, tmp_path):
    mid, _ = prepared(kernel, tmp_path)
    _, job, draft, review = answer_job(kernel, mid)
    work = Path(job['work_dir'])
    draft.update(status='unresolved', answer='The inspected page does not provide that detail.')
    draft['nodes'] = []
    write(work/'draft.json', draft)
    review['draft_sha256'] = hashlib.sha256((work/'draft.json').read_bytes()).hexdigest()
    write(work/'review.json', review)
    args = dict(module_id=mid, job_id=job['job_id'], lease=job['lease'], outcome='completed', draft_path=str(work/'draft.json'), review_path=str(work/'review.json'))
    assert 'fields' in kernel.err('module.read.finish', args)['message']
    del draft['nodes']
    write(work/'draft.json', draft)
    review['draft_sha256'] = hashlib.sha256((work/'draft.json').read_bytes()).hexdigest()
    write(work/'review.json', review)
    result = finish(kernel, job)['source_answer']
    assert result['status'] == 'unresolved' and result['supported'] is False


def test_campaign_answer_caches_and_attempt_leases_are_isolated(kernel, tmp_path):
    mid, root = prepared(kernel, tmp_path)
    library_params, library_job, _, _ = answer_job(kernel, mid)
    library_result = finish(kernel, library_job)
    library_before = (root/'module.json').read_bytes()
    for campaign in ['answer-a', 'answer-b']:
        reused = kernel.ok('module.read.request', {**library_params, 'campaign': campaign})
        assert reused['state'] == 'ready'
        assert reused['source_answer'] == library_result['source_answer']
        assert kernel.ok('module.read.claim', dict(module_id=mid, owner='answer-test', campaign=campaign))['job_id'] is None
    independent_question = 'Which organization employs Lena at the harbor?'
    # memo=False (contract §22.4.3): each campaign's fork holds the library's answer on Lena as its memo; these read past it.
    params_a, job_a, _, _ = answer_job(kernel, mid, question=independent_question, campaign='answer-a', memo=False)
    params_b, job_b, _, _ = answer_job(kernel, mid, question=independent_question, campaign='answer-b', memo=False)
    assert job_a['lease'] != job_b['lease']
    assert 'answer-a' in job_a['work_dir'] and 'answer-b' in job_b['work_dir']
    assert kernel.ok('module.read.request', params_b)['state'] == 'reading'
    finish(kernel, job_a, campaign='answer-a')
    assert kernel.ok('module.read.request', params_a)['state'] == 'ready'
    assert kernel.ok('module.read.request', params_b)['state'] == 'reading'
    wrong = dict(module_id=mid, campaign='answer-b', job_id=job_a['job_id'], lease=job_a['lease'], outcome='completed', draft_path=str(Path(job_a['work_dir'])/'draft.json'), review_path=str(Path(job_a['work_dir'])/'review.json'))
    assert kernel.err('module.read.finish', wrong)['code'] == 'invalid_params'
    finish(kernel, job_b, campaign='answer-b')
    assert (root/'module.json').read_bytes() == library_before


def test_answer_cache_requires_retained_unchanged_evidence(kernel, tmp_path):
    mid, _ = prepared(kernel, tmp_path)
    params, job, _, _ = answer_job(kernel, mid)
    finish(kernel, job)
    work = Path(job['work_dir'])
    (work/'review.json').write_text((work/'review.json').read_text() + ' ')
    error = kernel.err('module.read.request', params)
    assert error['details']['reason'] == 'source_answer_integrity'


def test_cancelled_answer_retries_only_when_explicitly_requested(kernel, tmp_path):
    mid, _ = prepared(kernel, tmp_path)
    params, job, _, _ = answer_job(kernel, mid)
    kernel.ok('module.read.finish', dict(module_id=mid, job_id=job['job_id'], lease=job['lease'], outcome='cancelled'))
    assert kernel.ok('module.read.request', params)['state'] == 'blocked'
    again = kernel.ok('module.read.request', {**params, 'retry': True})
    assert again['state'] == 'queued' and again['job_id'] != job['job_id']


def test_changed_context_lands_an_untouched_answer_under_the_new_generation(kernel, tmp_path):
    """Contract §22.4.6.1, SL-55 addendum: an answer whose focus no publication touched while it read lands under the
    current generation (it used to be refused `source_context_changed`); the stale-pinned waiter follows it."""
    mid, root = prepared(kernel, tmp_path)
    params, job, draft, _ = answer_job(kernel, mid)
    # Advance context through a real reviewed publication, never by editing generation hashes.
    request(kernel, mid, 'detail', focus='Dock', question='What does the harbor look like?')
    other = claim(kernel, mid)
    observed(other)
    write(Path(other['work_dir'])/'draft.json', dict(nodes=[dict(node_id='scene-dock', node_kind='scene', name='Dock', source_refs=[dict(page=1)], properties=dict(keeper_notes='A quiet harbor.'))], claims=[], node_refs=[], coverage={}, dependencies=[], critical=[], ready_nodes=['scene-dock']))
    write(Path(other['work_dir'])/'review.json', dict(checked=[dict(paths=['/nodes/0', '/coverage'], verdict='supported', source_refs=[dict(page=1)], reason='Source support.')], missing=[]))
    finish(kernel, other)
    generation = json.loads((root/'module.json').read_text())['generation']
    assert generation == job['base_generation'] + 1
    following = kernel.ok('module.read.request', {**params, 'context_generation': job['base_generation']})
    assert following['state'] == 'reading' and following['job_id'] == job['job_id']
    result = finish(kernel, job)
    assert result['state'] == 'ready' and result['generation'] == generation
    assert result['source_answer']['answer'] == draft['answer']
    assert kernel.ok('module.read.request', params)['source_answer'] == result['source_answer']
    assert kernel.ok('module.read.request', {**params, 'context_generation': job['base_generation']})['source_answer'] == result['source_answer']
