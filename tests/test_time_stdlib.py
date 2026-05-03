"""Stdlib ``time`` — sleep, strftime, stamp."""

from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib import time as timelib


def test_resolve_time_stdlib() -> None:
    m = resolve_stdlib("time")
    assert "sleep" in m and "current_time" in m and "time_stamp" in m


@pytest.fixture(autouse=True)
def _reset_time_host() -> None:
    timelib.reset_time_host()
    yield
    timelib.reset_time_host()


def test_vkf_time_demo_runs() -> None:
    src = """
:.time
a : current_time("%Y")
:: time_stamp()
:: sleep(0.01)
:: a
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    s = str(ip.globals.get("a", ""))
    assert len(s) == 4 and s.isdigit()


def test_time_host_swap_works() -> None:
    calls: list[tuple[str, tuple]] = []

    class FakeTimeHost:
        def sleep(self, seconds: float) -> None:
            calls.append(("sleep", (float(seconds),)))

        def current_time(self, fmt: str) -> str:
            calls.append(("current_time", (fmt,)))
            return f"fake-time::{fmt}"

        def time_stamp(self) -> str:
            calls.append(("time_stamp", ()))
            return "123.000001"

    host = FakeTimeHost()
    timelib.set_time_host(host)

    assert timelib.current_time("%Y") == "fake-time::%Y"
    assert timelib.time_stamp() == "123.000001"
    timelib.sleep(0.25)

    assert ("current_time", ("%Y",)) in calls
    assert ("time_stamp", ()) in calls
    assert ("sleep", (0.25,)) in calls


def test_time_host_aliases() -> None:
    class FakeTimeHost:
        def sleep(self, seconds: float) -> None:
            pass

        def current_time(self, fmt: str) -> str:
            return "ok"

        def time_stamp(self) -> str:
            return "0"

    host = FakeTimeHost()
    timelib.set_time_native_host(host)
    assert timelib.get_time_native_host() is host
    assert timelib.get_time_host() is host
    timelib.reset_time_native_host()
    assert timelib.get_time_host() is not host
