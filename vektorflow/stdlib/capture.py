"""Capture helpers for pulling structured data out of text (stdlib ``capture``).

Intended for patterns like “capture 10 and 20 from this” — in practice you give
a **regex with named groups** (or numbered groups) and a **source string**.
Natural-language templates can sit on top later.
"""

from __future__ import annotations

import re
from typing import Any


def regex(source: str, pattern: str) -> dict[str, str]:
    """Match ``pattern`` against ``source``; return **named** groups as a dict.

    Example::

        regex("values are 10 and 20", r"values are (?P<a>\\d+) and (?P<b>\\d+)")
        # → {"a": "10", "b": "20"}

    If the pattern has no named groups, falls back to ``m0``, ``m1``, … keys
    for each **numbered** group.
    """
    m = re.search(pattern, source)
    if not m:
        raise ValueError("no match for capture.regex")

    gd = m.groupdict()
    if gd and any(v is not None for v in gd.values()):
        return {k: v for k, v in gd.items() if v is not None}

    groups = m.groups()
    if not groups:
        return {"_": m.group(0)}
    return {f"m{i}": g for i, g in enumerate(groups)}


def groups(source: str, pattern: str) -> tuple[str, ...]:
    """Return all **numbered** capture groups (unnamed)."""
    m = re.search(pattern, source)
    if not m:
        raise ValueError("no match for capture.groups")
    return m.groups()


def build_capture_namespace() -> dict[str, Any]:
    return {
        "regex": regex,
        "groups": groups,
    }
