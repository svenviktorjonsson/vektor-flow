"""Error namespace exposed as the ``.errors`` stdlib module."""

from __future__ import annotations

from typing import Any

from ..errors import ERROR_NAMESPACE


def build_errors_namespace() -> dict[str, Any]:
    return dict(ERROR_NAMESPACE)
