"""Built-in standard library ``time`` (use ``: .time`` in .vkf)."""

from __future__ import annotations

import time as _time
from datetime import datetime
from typing import Any


def _coerce_str(x: Any) -> str:
    if isinstance(x, str):
        return x
    raise TypeError("format must be a string (strftime, like Python: %Y-%m-%d %H:%M:%S)")


def sleep(seconds: object) -> None:
    """Block for *seconds* (fractional allowed). Like Python :func:`time.sleep`."""
    s = float(seconds)  # type: ignore[arg-type]
    if s < 0:
        raise ValueError("sleep: seconds must be non-negative")
    _time.sleep(s)


def current_time(fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Current local time formatted with *fmt* (``strftime`` codes, e.g. ``%Y-%m-%d %H:%M:%S``)."""
    t = _coerce_str(fmt)
    return datetime.now().strftime(t)


def time_stamp() -> str:
    """``time.time()`` as a fixed-point decimal string (seconds since the epoch, UTC)."""
    return f"{_time.time():.6f}"


def build_time_namespace() -> dict[str, Any]:
    return {
        "sleep": sleep,
        "current_time": current_time,
        "time_stamp": time_stamp,
    }
