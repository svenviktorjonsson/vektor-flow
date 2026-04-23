"""vf-overlay event queue helpers (see ``vektorflow.ui.bridge``).

Not registered in :data:`vektorflow.stdlib.STDLIB_MODULES` — import this module
when wiring the host queue; there is no ``use(\\\"bridge\\\")``.
"""

from __future__ import annotations

from typing import Any

from vektorflow.ui import bridge as _b


class _Bridge:
    """Namespace so ``: .bridge`` exposes ``bridge.connect``, ``bridge.pop``, …"""

    __vf_py_attrs__ = True
    __slots__ = ()

    def connect(self, max_wait: float = 30.0) -> str:
        return _b.vf_base_url(wait_seconds=float(max_wait))

    def pop(self) -> Any:
        o = _b.pop_line_json()
        return "" if o is None else o

    def base_url(self) -> str:
        return _b.vf_base_url()

    def clear(self) -> None:
        _b.clear_base_cache()


def build_bridge_namespace() -> dict[str, Any]:
    b = _Bridge()

    return {
        "bridge": b,
        "base_url": b.base_url,
        "connect": b.connect,
        "pop": b.pop,
        "clear": b.clear,
    }
