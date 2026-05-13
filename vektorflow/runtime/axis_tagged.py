"""Axis-tagged collection values: attach axis labels via tight ``expr->…`` (same adjacency as ``.``)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class AxisTaggedValue:
    """Vector, multiset, or positional tuple with axis labels (``idx``) for dimension matching."""

    data: Any  # VFVector | tuple | Multiset
    idx: str

    def __repr__(self) -> str:
        return f"AxisTagged({self.data!r}, idx={self.idx!r})"
