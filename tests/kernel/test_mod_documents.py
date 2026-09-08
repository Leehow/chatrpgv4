"""Writable carrier behavior through the real kernel RPC; fixtures are not play."""
import json
from pathlib import Path

from conftest import CAMPAIGN, RpcClient, campaign_dir, narrate, open_turn, read_json
from test_mods import prepared


def paper(name="Notebook", text="", presentation="notebook"):
    return {"name":name, "category":"item", "description":"An ordinary writable carrier.",
            "basis":"Fixture text, not an authored scenario claim.", "parameters":{"charges":None,"effects":[]},
            "document":{"text":text,"presentation":presentation},
            "player_view":{"description":"A carried paper.","fields":[]}}


def owned_paper(kernel, text="Meet at the station."):
    open_turn(kernel)
    kernel.table("apply",call_id="t1-c1",effects=[prepared(kernel,paper(text=text)),
        {"kind":"object","name":"Notebook","to":"Thomas Hayes"}])


def view(kernel):
    return kernel.ok("mods.document.view",{"campaign":CAMPAIGN,"actor":"Thomas Hayes","name":"Notebook"})


def edit(kernel, snapshot, action="save", text="My own notes"):
    return kernel.ok("mods.document.apply",{"campaign":CAMPAIGN,"actor":"Thomas Hayes","name":"Notebook",
        "version":snapshot["version"],"action":action,**({"text":text} if action=="save" else {})})


def test_edit_reopen_reset_keeps_acquisition_source_and_turn_state(kernel):
    owned_paper(kernel)
    folder=campaign_dir(kernel.workspace)
    before={name:(folder/name).read_bytes() for name in ("turn.json","campaign.json","party/thomas-hayes.json")}
    original_world=read_json(folder/"world.json")
    first=view(kernel)
    assert first["original"]==first["text"]=="Meet at the station."
    assert first["editor"]=={"provider":"enhanced-items","renderer":"paper"}
    changed=edit(kernel,first,text="<script>not executable</script>\nMy notes")
    assert changed["original"]==first["original"] and changed["text"]!=first["text"]
    assert view(kernel)["text"]==changed["text"]
    reset=edit(kernel,changed,"reset")
    assert reset["text"]==reset["original"]==first["text"]
    assert before=={name:(folder/name).read_bytes() for name in before}
    world=read_json(folder/"world.json")
    assert world["objects"]["definitions"]==original_world["objects"]["definitions"]
    assert {k:v for k,v in world.items() if k!="objects"}=={k:v for k,v in original_world.items() if k!="objects"}
    assert len((folder/"document-edits.jsonl").read_text().splitlines())==2


def test_blank_original_and_stale_edits_are_preserved_across_processes(kernel):
    owned_paper(kernel,text="")
    first=view(kernel)
    other=RpcClient(kernel.workspace)
    try:
        edit(other,first,text="Written elsewhere")
        stale={"campaign":CAMPAIGN,"actor":"Thomas Hayes","name":"Notebook","version":first["version"],"action":"save","text":"Stale draft"}
        assert kernel.err("mods.document.apply",stale)["code"]=="revision_conflict"
        assert view(kernel)["text"]=="Written elsewhere"
        assert edit(kernel,view(kernel),"reset")["text"]==""
        assert kernel.err("mods.document.apply",{**stale,"version":view(kernel)["version"],"action":"reset","original":"Forged"})["code"]=="invalid_params"
    finally:
        other.close()


def test_transfer_captures_actual_received_text_and_blocks_prior_owner(kernel):
    owned_paper(kernel)
    old=edit(kernel,view(kernel),text="Player addition")
    kernel.table("apply",call_id="t1-c2",effects=[{"kind":"object","name":"Notebook","from":"Thomas Hayes","to":"Steven Knott"}])
    assert kernel.err("mods.document.view",{"campaign":CAMPAIGN,"actor":"Thomas Hayes","name":"Notebook"})["code"]=="not_owned"
    assert kernel.err("mods.document.apply",{"campaign":CAMPAIGN,"actor":"Thomas Hayes","name":"Notebook","action":"reset","version":old["version"]})["code"]=="not_owned"
    kernel.table("apply",call_id="t1-c3",effects=[{"kind":"object","name":"Notebook","from":"Steven Knott","to":"Steven Knott",
        "document":{"action":"write","text":"Knott's addition"},"why":"Knott writes in the paper he is holding"}])
    kernel.table("apply",call_id="t1-c4",effects=[{"kind":"object","name":"Notebook","from":"Steven Knott","to":"Thomas Hayes"}])
    received=view(kernel)
    assert received["original"]==received["text"]=="Knott's addition"
    changed=edit(kernel,received,text="Another player edit")
    assert edit(kernel,changed,"reset")["text"]=="Knott's addition"


def test_existing_carrier_initializes_once_and_disabled_mod_keeps_editor(kernel):
    open_turn(kernel)
    draft=paper();draft.pop("document")
    kernel.table("apply",call_id="t1-c1",effects=[prepared(kernel,draft),{"kind":"object","name":"Notebook","to":"Thomas Hayes"}])
    initialize={"kind":"object","name":"Notebook","from":"Thomas Hayes","to":"Thomas Hayes","document":{"text":"Original","presentation":"book"}}
    kernel.table("apply",call_id="t1-c2",effects=[initialize])
    changed=edit(kernel,view(kernel),text="A player's annotation")
    assert kernel.table_err("apply",call_id="t1-c3",effects=[initialize])["code"]=="invalid_params"
    assert view(kernel)["text"]==changed["text"]
    kernel.ok("mods.configure",{"campaign":CAMPAIGN,"id":"enhanced-items","enabled":False})
    narrate(kernel,"t1-c3","我们收好纸页。")
    kernel.table("player_input",text="我继续查看自己的笔记。")
    assert view(kernel)["editor"]=={"provider":"core","renderer":"plain"}
    assert edit(kernel,view(kernel),"reset")["text"]=="Original"


def test_document_limits_and_container_custody(kernel):
    owned_paper(kernel)
    draft=paper(name="Bag");draft.pop("document")
    kernel.table("apply",call_id="t1-c2",effects=[prepared(kernel,draft),{"kind":"object","name":"Bag","to":"Thomas Hayes"},
        {"kind":"object","name":"Notebook","from":"Thomas Hayes","to":"Bag"}])
    snapshot=view(kernel)
    assert snapshot["original"]=="Meet at the station."
    assert kernel.err("mods.document.apply",{"campaign":CAMPAIGN,"actor":"Thomas Hayes","name":"Notebook","version":snapshot["version"],"action":"save","text":"x"*64001})["code"]=="invalid_params"
    kernel.table("apply",call_id="t1-c3",effects=[{"kind":"object","name":"Bag","from":"Thomas Hayes","to":"Steven Knott"}])
    assert kernel.err("mods.document.view",{"campaign":CAMPAIGN,"actor":"Thomas Hayes","name":"Notebook"})["code"]=="not_owned"


def test_document_worldline_snapshots_and_stale_editor_identity(kernel):
    from test_worldline import fork, switch, turn_json
    owned_paper(kernel)
    narrate(kernel,"t1-c2","我们收好笔记本。")
    fork(kernel,2,"side")
    side=edit(kernel,view(kernel),text="Writing on the other line")
    switch(kernel,turn_json(kernel)["turn"],"main")
    assert view(kernel)["text"]=="Meet at the station."
    assert kernel.err("mods.document.apply",{"campaign":CAMPAIGN,"actor":"Thomas Hayes","name":"Notebook",
        "version":side["version"],"action":"save","text":"Old tab"})["code"]=="revision_conflict"
    switch(kernel,turn_json(kernel)["turn"],"side")
    assert view(kernel)["text"]=="Writing on the other line"
    assert edit(kernel,view(kernel),"reset")["text"]=="Meet at the station."


def test_two_processes_cannot_both_save_the_same_revision(kernel):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    owned_paper(kernel)
    snapshot=view(kernel)
    other=RpcClient(kernel.workspace)
    barrier=Barrier(2)
    def save(client,text):
        barrier.wait()
        return client.call("mods.document.apply",{"campaign":CAMPAIGN,"actor":"Thomas Hayes","name":"Notebook",
            "version":snapshot["version"],"action":"save","text":text})
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            a=pool.submit(save,kernel,"First window")
            b=pool.submit(save,other,"Second window")
            results=[a.result(),b.result()]
        assert sum(r["ok"] for r in results)==1
        assert next(r for r in results if not r["ok"])["error"]["code"]=="revision_conflict"
        assert view(kernel)["text"]==next(r for r in results if r["ok"])["result"]["text"]
    finally:
        other.close()


def test_revealed_handout_is_copied_exactly_and_hidden_source_is_refused(kernel):
    from test_handout import TEXT_HANDOUT
    open_turn(kernel)
    draft=paper();draft["document"]={"handout":"Not yet revealed", "presentation":"paper"}
    request={"name":draft["name"],"category":draft["category"],"description":draft["description"]}
    job=kernel.ok("mods.job",{"campaign":CAMPAIGN,"role":"create","input":request})
    Path(job["cwd"],"result.json").write_text(json.dumps(draft))
    assert kernel.err("mods.accept",{"campaign":CAMPAIGN,"job":job["job"]})["code"]=="invalid_params"
    shown=kernel.table("apply",call_id="t1-c1",effects=[{"kind":"handout","name":TEXT_HANDOUT}])
    source=Path(shown["attachment"]["path"])
    source_bytes=source.read_bytes()
    name=kernel.table("status")["receipts"][-1]["name"]
    draft["document"]["handout"]=name
    Path(job["cwd"],"result.json").write_text(json.dumps(draft))
    accepted=kernel.ok("mods.accept",{"campaign":CAMPAIGN,"job":job["job"]})
    kernel.table("apply",call_id="t1-c2",effects=[{"kind":"define",**request,"_definition":accepted["definition"],"_provenance":accepted["provenance"]},
        {"kind":"object","name":"Notebook","to":"Thomas Hayes"}])
    snapshot=view(kernel)
    assert snapshot["text"].strip()==source_bytes.decode().split("\n",1)[1].strip()
    changed=edit(kernel,snapshot,text="A player rewrite")
    assert edit(kernel,changed,"reset")["text"]==snapshot["text"]
    assert source.read_bytes()==source_bytes
