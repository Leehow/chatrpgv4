"""Regenerate test evidence with the repository's locked Python, never at runtime.

Run from the repository root:
    uv run --frozen python kernel-ts/testing/generate_reference.py
"""
from __future__ import annotations

import hashlib
import json
import random
import struct
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "kernel"))

from coc.fileio import canonical_json, sha256_text
from coc.rpc import build_methods, handle_line
from coc.store import Store
from coc.table import Table
from coc.worldline import line_seed, turn_seed


def random_case(seed):
    rng = random.Random(seed)
    floats = [rng.random() for _ in range(12)]
    widths = [0, 1, 2, 31, 32, 33, 53, 63, 64, 65, 127, 128, 129, 521]
    bits = [str(rng.getrandbits(width)) for width in widths]
    limits = [1, 2, 3, 10, 100, 2**32 - 1, 2**32, 2**53 + 1, 2**128 + 1]
    below = [str(rng._randbelow(limit)) for limit in limits]
    ranges = [[10], [-5, 30], [30, -30, -3], [-100, -1, 7], [0, 2**90, 3]]
    ranged = [str(rng.randrange(*arguments)) for arguments in ranges]
    integers = [[1, 6], [-50, 50], [1, 1], [-2**80, 2**80]]
    dice = [str(rng.randint(*arguments)) for arguments in integers]
    population = ["first", "second", "third", "fourth", "fifth"]
    choice = [rng.choice(population) for _ in range(8)]
    shuffled = list(range(21))
    rng.shuffle(shuffled)
    rng.shuffle([])
    rng.shuffle(["only"])
    tail = rng.random()
    stream = random.Random(seed)
    stream_hash = hashlib.sha256(b"".join(struct.pack(">I", stream.getrandbits(32)) for _ in range(2000))).hexdigest()
    return {
        "seed": {"type": "string" if isinstance(seed, str) else "integer", "value": str(seed)},
        "random": floats, "widths": widths, "bits": bits,
        "limits": list(map(str, limits)), "below": below,
        "ranges": [[str(value) for value in row] for row in ranges], "ranged": ranged,
        "integers": [[str(value) for value in row] for row in integers], "dice": dice,
        "choice": choice, "shuffled": shuffled, "tail": tail, "stream_sha256": stream_hash,
    }


def json_case(source):
    value = json.loads(source)
    canonical = canonical_json(value)
    return {"source": source, "canonical": canonical, "sha256": sha256_text(canonical),
            "stored": json.dumps(value, indent=2, ensure_ascii=False) + "\n",
            "line": json.dumps(value, ensure_ascii=False) + "\n"}


def main():
    seeds = ["", "0", "foundation", "caf\u00e9", "caf\u0065\u0301", "\u8c03\u67e5\u5458\U0001f3b2", "x" * 4096,
             0, 1, -1, 2**32 - 1, 2**32, 2**32 + 1, -(2**32 + 1),
             2**53 - 1, 2**53, 2**64 - 1, 2**64, 2**521 + 17]
    worldlines = []
    for name, commit, turn in [("main", None, 0), ("after-midnight", "test-fork-commit", 1),
                                ("\u96e8\u591c", "another-fork", 9007199254740993)]:
        seed = line_seed("foundation-campaign", name, commit)
        material = turn_seed(seed, turn)
        worldlines.append({"name": name, "seed": seed, "turn": str(turn), "material": material})
        seeds.append(material)
    sources = [
        '{"z":1,"a":[true,null,"caf\\u00e9",{"nested":"\\u8c03\\u67e5"}]}',
        '{"\\ud800\\udc00":1,"\\ue000":2,"a":3,"\\udbff\\udfff":4}',
        '{"10":"ten","2":"two","1":"one","__proto__":{"safe":true}}',
        '{"repeat":1,"repeat":2,"2":"last"}',
        '[0,-0,1,-1,9007199254740991,9007199254740992,9007199254740993,18446744073709551617]',
        '[0.0,-0.0,1.0,-1.0,1e0,1e-4,1e-5,1e-6,1e15,1e16,1e20,1e21,1e23,1.0000000000000001e18]',
        '[5e-324,2.2250738585072014e-308,1.7976931348623157e308,1e400,-1e400,NaN,Infinity,-Infinity]',
        '"\\u0000\\b\\f\\n\\r\\t\\u001f/\\\\\\\"\\u0085\\u2028\\u2029"',
        '[]', '{}', 'null', 'true', '""',
    ]
    floats = []
    bits_rng = random.Random("foundation-float-format")
    for _ in range(512):
        bits = bits_rng.getrandbits(64)
        value = struct.unpack(">d", bits.to_bytes(8, "big"))[0]
        floats.append({"bits": bits.to_bytes(8, "big").hex(), "text": json.dumps(value)})
    invalid = ['{', '[', '[1,]', '{"a":1,}', '{"a" 1}', '{"a":}', '[1 2]', '01', '1e',
               '"bad\\x"', '"bad\\u12xy"', '"unterminated', '"control\n"', '\ufeff{}', '{}x',
               'null', '[]', '{"method":"kernel.hello"}', '{"id":7,"method":"kernel.hello"}',
               '{"id":"bad","method":false}', '{"id":"bad","method":"kernel.hello","params":[]}',
               '{"id":"unknown","method":"nonexistent"}', '{"id":"unknown","method":"a\'b"}']
    files = {
        "zeta/campaign.json": '{"id":"zeta","title":"Last","module_id":"the-haunting","status":"active"}',
        "zeta/turn.json": '{"turn":3}',
        "alpha/campaign.json": '{"title":"First","status":"setting_up"}',
        "empty-values/campaign.json": '{"id":null,"title":null,"module_id":null,"status":null}',
        "empty-values/turn.json": '{"turn":null}',
        "float-turn/campaign.json": '{"id":"float-turn","title":"Typed number"}',
        "float-turn/turn.json": '{"turn":6.0}',
        "\ue000/campaign.json": '{}',
        "\U00010000/campaign.json": '{}',
    }
    with tempfile.TemporaryDirectory(prefix="pi-coc-foundation-reference-") as directory:
        workspace = Path(directory)
        table = Table(Store(workspace), ROOT / "content", random.Random("foundation-reference"))
        methods = build_methods(table)
        # Host-facing methods that exist only in the TypeScript kernel (contract §29); the Python
        # reference never implements them, but the locked vocabulary comparison must list them,
        # including inside the unknown_method error frames.
        extended = {**methods, "table.graph": lambda params: None, "table.branch": lambda params: None}
        vocabulary = sorted(extended)
        empty_list = table.campaign_list({})
        for name, text in files.items():
            path = workspace / ".coc" / "campaigns" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        rpc = {"methods": vocabulary, "hello": table.hello({}), "empty_list": empty_list,
               "files": files, "campaign_list_line": json.dumps(table.campaign_list({}), ensure_ascii=False),
               "invalid": [{"line": line, "response": handle_line(line, extended)} for line in invalid]}
    output = {"python": sys.version.split()[0], "rng": [random_case(seed) for seed in seeds],
              "worldlines": worldlines, "json": [json_case(source) for source in sources],
              "floats": floats, "rpc": rpc}
    destination = Path(__file__).with_name("python-reference.json")
    destination.write_text(json.dumps(output, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"wrote {destination.relative_to(ROOT)}: {len(seeds)} RNG seeds, {len(sources)} JSON cases, {len(floats)} floats")


if __name__ == "__main__":
    main()
