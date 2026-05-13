from __future__ import annotations

from typing import Any, Iterable

from .vfvector import VFVector


class TypedVector(VFVector):
    """Vector value carrying a refined static vector type expression."""

    __slots__ = ("vf_type_expr",)

    def __init__(self, values: Iterable[Any] = (), vf_type_expr: Any | None = None) -> None:
        super().__init__(values)
        self.vf_type_expr = vf_type_expr
