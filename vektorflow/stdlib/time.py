"""Built-in standard library ``time`` (use ``: .time`` in .vkf)."""

from __future__ import annotations

from typing import Any, Protocol

import time as _time


class TimeHost(Protocol):
    """Host callbacks used by the time stdlib."""

    def sleep(self, seconds: float) -> None: ...

    def current_time(self, fmt: str) -> str: ...

    def time_stamp(self) -> str: ...


class _PythonTimeHost:
    """Default host adapter backed by ``time`` and ``datetime``."""

    def sleep(self, seconds: float) -> None:
        _time.sleep(float(seconds))

    def current_time(self, fmt: str) -> str:
        from datetime import datetime

        return datetime.now().strftime(fmt)

    def time_stamp(self) -> str:
        return f"{_time.time():.6f}"


def _coerce_str(x: Any) -> str:
    if isinstance(x, str):
        return x
    raise TypeError(
        "format must be a string (strftime, like Python: %Y-%m-%d %H:%M:%S)"
    )


def _coerce_seconds(x: Any) -> float:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        raise TypeError("sleep: seconds must be int or float")
    return float(x)


def _normalize_host(host: TimeHost) -> TimeHost:
    required = ("sleep", "current_time", "time_stamp")
    for name in required:
        if not callable(getattr(host, name, None)):
            raise TypeError(
                "time host must define sleep(seconds), current_time(fmt), and time_stamp()"
            )
    return host


_time_host: TimeHost = _PythonTimeHost()


def set_time_host(host: TimeHost) -> None:
    """Install a custom time host for stdlib ``time``."""
    global _time_host
    _time_host = _normalize_host(host)


def set_time_native_host(host: TimeHost) -> None:
    """Compatibility alias for installing a preferred native time host."""
    set_time_host(host)


def get_time_host() -> TimeHost:
    """Return the currently installed time host."""
    return _time_host


def get_time_native_host() -> TimeHost:
    """Alias for ``get_time_host``."""
    return get_time_host()


def reset_time_host() -> None:
    """Restore the default Python-backed time host."""
    global _time_host
    _time_host = _PythonTimeHost()


def reset_time_native_host() -> None:
    """Alias for ``reset_time_host``."""
    reset_time_host()


def sleep(seconds: object) -> None:
    """Block for *seconds* (fractional allowed). Like Python :func:`time.sleep`."""
    s = _coerce_seconds(seconds)
    if s < 0:
        raise ValueError("sleep: seconds must be non-negative")
    _time_host.sleep(s)


def current_time(fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Current local time formatted with *fmt* (``strftime`` codes)."""
    t = _coerce_str(fmt)
    return _time_host.current_time(t)


def time_stamp() -> str:
    """``time.time()`` as a fixed-point decimal string (seconds since the epoch)."""
    return _time_host.time_stamp()


def build_time_namespace() -> dict[str, Any]:
    return {
        "sleep": sleep,
        "current_time": current_time,
        "time_stamp": time_stamp,
    }
