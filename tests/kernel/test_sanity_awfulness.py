"""Contract §221.6-§221.8 through the emitted kernel: the sort of monster is bound from closed data, Getting Used to the
Awfulness caps the total lost to it at the failure half's maximum (p.169), a bout the Keeper picked is the one that
starts (p.157), and the Mythos Hardened flag is persisted state (p.169).

The seed is the one `test_sessions` pins: Thomas Hayes (SAN 55) fails the roll on seeing Corbitt move (1/1D8) and
loses 8, goes temporarily insane and begins a bout."""

from conftest import RpcClient, campaign_dir, open_turn, read_json
from test_rules_families import resolve, resolve_err, walk_to_confrontation

INVESTIGATOR = "thomas-hayes"


def snapshot(client):
    return read_json(campaign_dir(client.workspace) / "save" / "sanity-state" / f"{INVESTIGATOR}.json")


def test_awfulness_cap_is_the_failure_maximum_and_the_bout_is_the_keepers_pick(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    try:
        open_turn(client, "我掀开裹尸布。")
        n = walk_to_confrontation(client)
        checked = resolve(client, f"t1-c{n}", intent="investigate", goal="看见科比特的尸体动了", method="",
                          target="Walter Corbitt", decision="sanity:check", involuntary="freeze", bout="violence")
        outcome = checked["outcome"]
        assert outcome["san_loss"] == 8 and outcome["bout_active"] is True
        state = snapshot(client)
        # §221.6: the sort of monster is the actor's handle (no catalog pin), and 8 of a possible 8 is tracked.
        assert state["awfulness_caps"] == {"walter-corbitt": 8}
        assert state["mythos_hardened"] is False
        # §221.8: the bout is the one the Keeper picked, not a table roll.
        bout = state["bouts_of_madness"][-1]
        assert bout["bout_kind"] == "violence" and bout["bout_chosen"] is True
        assert any(e["type"] == "bout_of_madness" for e in state["events"])

        # The underlying insanity makes any loss of 1+ another bout; the cap leaves nothing to lose to Corbitt, so the
        # second sight costs 0 (a cap of 1 + 8 = 9 would have let the success half's 1 through).
        n += 1
        resolve(client, f"t1-c{n}", intent="investigate", goal="结束疯狂", method="", decision="sanity:bout-end")
        n += 1
        again = resolve(client, f"t1-c{n}", intent="investigate", goal="再看科比特一眼", method="",
                        target="Walter Corbitt", decision="sanity:check", involuntary="freeze")["outcome"]
        assert again["san_loss"] == 0 and again["san_after"] == again["san_before"]
        assert again["bout_active"] is False
        assert snapshot(client)["awfulness_caps"] == {"walter-corbitt": 8}
    finally:
        client.close()


def test_a_missing_loss_lists_the_rulebook_ladder(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client, "血从天花板滴下来。")
        missing = resolve_err(client, "t1-c1", intent="investigate", goal="血从天花板滴下来", method="",
                              decision="sanity:check", involuntary="freeze")
        assert missing["code"] == "needs" and missing["details"]["needs"]["field"] == "san_loss"
        options = missing["details"]["needs"]["options"]
        # §221.2: the options are the p.155 ladder's expressions from the rules data, not a literal in code.
        assert options == ["0/1D2", "0/1D3", "0/1D4", "1/1D4+1", "0/1D6", "1/1D6+1", "0/1D10", "1/1D10", "2/2D10+1", "1D10/1D100"]
    finally:
        client.close()
