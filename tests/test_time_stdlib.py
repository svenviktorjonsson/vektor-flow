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


def test_time_stamp_is_numeric() -> None:
    stamp = timelib.time_stamp()
    assert isinstance(stamp, float)


def test_time_host_swap_works() -> None:
    calls: list[tuple[str, tuple]] = []

    class FakeTimeHost:
        def sleep(self, seconds: float) -> None:
            calls.append(("sleep", (float(seconds),)))

        def current_time(self, fmt: str) -> str:
            calls.append(("current_time", (fmt,)))
            return f"fake-time::{fmt}"

        def time_stamp(self) -> float:
            calls.append(("time_stamp", ()))
            return 123.000001

    host = FakeTimeHost()
    timelib.set_time_host(host)

    assert timelib.current_time("%Y") == "fake-time::%Y"
    assert timelib.time_stamp() == 123.000001
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

        def time_stamp(self) -> float:
            return 0.0

    host = FakeTimeHost()
    timelib.set_time_native_host(host)
    assert timelib.get_time_native_host() is host
    assert timelib.get_time_host() is host
    timelib.reset_time_native_host()
    assert timelib.get_time_host() is not host


def test_sleep_rejects_bool_and_string() -> None:
    with pytest.raises(TypeError, match="seconds must be int or float"):
        timelib.sleep(True)
    with pytest.raises(TypeError, match="seconds must be int or float"):
        timelib.sleep("1")


def test_sleep_rejects_negative_seconds() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        timelib.sleep(-0.01)


def test_current_time_requires_string_format() -> None:
    with pytest.raises(TypeError, match="format must be a string"):
        timelib.current_time(123)  # type: ignore[arg-type]


def test_set_time_host_requires_full_protocol() -> None:
    class IncompleteTimeHost:
        def sleep(self, seconds: float) -> None:
            pass

    with pytest.raises(TypeError, match="time host must define"):
        timelib.set_time_host(IncompleteTimeHost())  # type: ignore[arg-type]
