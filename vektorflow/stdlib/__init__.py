"""Standard libraries resolved by explicit ``.name`` / ``name: .name`` imports.

``screen`` and ``bridge`` are not registered; implementations stay importable
from :mod:`vektorflow.stdlib.screen` and :mod:`vektorflow.stdlib.bridge` for
later use. Public host UI: ``use(\"ui\")`` and ``ui.display``.
"""

from __future__ import annotations

from typing import Any, Callable

from . import capture as capturelib
from . import collections as collectionslib
from . import errors as errorslib
from . import io as iolib
from . import math as mathlib
from . import physics as physicslib
from . import stat as statlib
from . import time as timelib
from . import ui as uilib

StdlibFactory = Callable[[], dict[str, Any]]

STDLIB_MODULES: dict[str, StdlibFactory] = {
    "math": mathlib.build_math_namespace,
    "physics": physicslib.build_physics_namespace,
    "capture": capturelib.build_capture_namespace,
    "errors": errorslib.build_errors_namespace,
    "io": iolib.build_io_namespace,
    "collections": collectionslib.build_collections_namespace,
    "stat": statlib.build_stat_namespace,
    "symbolic": lambda: {},
    "time": timelib.build_time_namespace,
    "ui": uilib.build_ui_namespace,
}

# Native stdlib namespaces now follow the same rule as ``errors``:
# they are available for explicit ``.name`` / ``name: .name`` imports, not
# as auto-preloaded bare names in the interpreter.
STDLIB_AUTOLOADED_NAMESPACES: tuple[str, ...] = ()


def resolve_stdlib(name: str) -> dict[str, Any]:
    """Return a namespace dict for built-in library ``name`` (e.g. ``"math"``)."""
    factory = STDLIB_MODULES.get(name)
    if factory is None:
        raise KeyError(f"unknown stdlib: {name!r}")
    return factory()
