"""Values produced by axis suffixes ``_``, ``_i``, ``_ij`` on literal vectors, tuples, or multisets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .multiset import Multiset


@dataclass
class AxisTaggedValue:
    """Tuple vector, multiset, or positional tuple with axis labels (``idx``) for dimension matching."""

    data: Any  # tuple | Multiset
    idx: str

    def __repr__(self) -> str:
        return f"AxisTagged({self.data!r}, idx={self.idx!r})"
