from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


@dataclass
class TypedVector(list):
    """List value carrying a refined static vector type expression."""

    vf_type_expr: Any | None = None

    def __init__(self, values: Iterable[Any] = (), vf_type_expr: Any | None = None) -> None:
        super().__init__(values)
        self.vf_type_expr = vf_type_expr
