"""Developer-only Python entrypoint with an optional deterministic wall clock."""
import datetime
import os
import runpy
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from python_oracle import ORACLE_KERNEL
sys.path.insert(0, str(ORACLE_KERNEL))

clock = os.environ.get("COC_TEST_CLOCK")
if clock:
    original_datetime = datetime.datetime
    instant = original_datetime.fromisoformat(clock.replace("Z", "+00:00"))
    epoch = instant.timestamp()

    class FixedDateTime(original_datetime):
        @classmethod
        def now(cls, tz=None):
            return cls.fromtimestamp(epoch, tz)

        @classmethod
        def utcnow(cls):
            return cls.fromtimestamp(epoch, datetime.timezone.utc).replace(tzinfo=None)

    datetime.datetime = FixedDateTime
    time.time = lambda: epoch
    gmtime, localtime, strftime = time.gmtime, time.localtime, time.strftime
    time.gmtime = lambda value=None: gmtime(epoch if value is None else value)
    time.localtime = lambda value=None: localtime(epoch if value is None else value)
    time.strftime = lambda fmt, value=None: strftime(fmt, localtime(epoch) if value is None else value)

runpy.run_module("coc.rpc", run_name="__main__")
