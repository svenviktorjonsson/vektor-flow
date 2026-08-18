from __future__ import annotations

from collections.abc import Callable
from typing import Any


def mixed_string_binary(
    op: str,
    left: Any,
    right: Any,
    stringify: Callable[[Any], str],
) -> tuple[bool, Any]:
    """Apply VKF's mixed string concatenation before ordinary binary dispatch."""
    if op not in {"PLUS", "AMPERSAND"}:
        return False, None
    if isinstance(left, str) and not isinstance(right, str):
        return True, left + stringify(right)
    if isinstance(right, str) and not isinstance(left, str):
        return True, stringify(left) + right
    return False, None
