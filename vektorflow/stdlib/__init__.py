"""Standard libraries resolved by ``use("name")`` (interpreter will bind these).

``screen`` and ``bridge`` are not registered; implementations stay importable
from :mod:`vektorflow.stdlib.screen` and :mod:`vektorflow.stdlib.bridge` for
later use. Public host UI: ``use(\\\"ui\\\")`` and ``ui.display``.
"""

from __future__ import annotations

from typing import Any, Callable

from . import capture as capturelib
from . import collections as collectionslib
from . import io as iolib
from . import math as mathlib
from . import time as timelib
from . import ui as uilib

StdlibFactory = Callable[[], dict[str, Any]]

STDLIB_MODULES: dict[str, StdlibFactory] = {
    "math": mathlib.build_math_namespace,
    "capture": capturelib.build_capture_namespace,
    "io": iolib.build_io_namespace,
    "collections": collectionslib.build_collections_namespace,
    "time": timelib.build_time_namespace,
    "ui": uilib.build_ui_namespace,
}


def resolve_stdlib(name: str) -> dict[str, Any]:
    """Return a namespace dict for built-in library ``name`` (e.g. ``"math"``)."""
    factory = STDLIB_MODULES.get(name)
    if factory is None:
        raise KeyError(f"unknown stdlib: {name!r}")
    return factory()
