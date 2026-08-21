"""Regular-expression matching and group extraction (stdlib ``regex``)."""

from __future__ import annotations

import re
from typing import Any


def match(source: str, pattern: str) -> dict[str, str]:
    """Search ``source`` and return named or numbered capture groups."""
    found = re.search(pattern, source)
    if not found:
        raise ValueError("regular expression did not match")

    named = found.groupdict()
    if named and any(value is not None for value in named.values()):
        return {name: value for name, value in named.items() if value is not None}

    captured = found.groups()
    if not captured:
        return {"_": found.group(0)}
    return {f"m{index}": value for index, value in enumerate(captured)}


def groups(source: str, pattern: str) -> tuple[str, ...]:
    """Search ``source`` and return numbered capture groups."""
    found = re.search(pattern, source)
    if not found:
        raise ValueError("regular expression did not match")
    return found.groups()


def build_regex_namespace() -> dict[str, Any]:
    return {"match": match, "groups": groups}
