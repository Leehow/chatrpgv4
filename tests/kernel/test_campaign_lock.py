"""The per-campaign RPC lock waits against a deadline and names what is holding it."""

import fcntl
import time

import pytest

from coc.errors import RpcError
from coc.store import Store, campaign_lock


def _campaign(tmp_path, name="held"):
    store = Store(tmp_path)
    folder = store.campaigns_dir / name
    folder.mkdir(parents=True)
    (folder / "campaign.json").write_text("{}", encoding="utf-8")
    return store


def test_uncontended_campaign_lock_still_serializes(tmp_path):
    store = _campaign(tmp_path)
    with campaign_lock(store, {"campaign": "held"}):
        pass
    # A params dict without a stored campaign is not lockable and must stay a plain pass-through.
    with campaign_lock(store, {"campaign": "absent"}):
        pass
    with campaign_lock(store, {}):
        pass


def test_a_held_campaign_is_refused_by_name_instead_of_waiting_without_end(tmp_path):
    store = _campaign(tmp_path)
    lock_dir = store.root / "locks"
    lock_dir.mkdir(parents=True, exist_ok=True)
    with (lock_dir / "held.lock").open("a+b") as holder:
        fcntl.flock(holder, fcntl.LOCK_EX)
        started = time.monotonic()
        with pytest.raises(RpcError) as raised:
            with campaign_lock(store, {"campaign": "held"}, timeout=0.15):
                pytest.fail("the guard must not enter a campaign another process holds")
        waited = time.monotonic() - started
    assert waited >= 0.15, "the guard waits for its deadline before refusing"
    assert raised.value.code == "internal"
    assert raised.value.details == {"reason": "campaign_locked", "campaign": "held"}
    assert "held" in raised.value.message
    assert raised.value.fix
    # The refusal releases the handle, so the campaign is available the moment its holder is done.
    with campaign_lock(store, {"campaign": "held"}, timeout=0.15):
        pass
