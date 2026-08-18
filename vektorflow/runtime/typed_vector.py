from __future__ import annotations

from typing import Any, Iterable

from .vfvector import VFVector


class TypedVector(VFVector):
    """Vector value carrying a refined static vector type expression."""

    __slots__ = ("vf_type_expr",)
    __vf_py_attrs__ = True

    @staticmethod
    def _to_int_shape(value: Any) -> int:
        if isinstance(value, bool):
            raise TypeError("shape components must be non-boolean integers")
        if not isinstance(value, int):
            if not isinstance(value, float) or value != int(value):
                raise TypeError(f"shape component {value!r} must be an integer")
            value = int(value)
        if value < 0:
            raise ValueError(f"shape components must be non-negative, got {value}")
        return value

    @classmethod
    def _coerce_shape(cls, shape: Any) -> tuple[int, ...]:
        if isinstance(shape, int) and not isinstance(shape, bool):
            return (cls._to_int_shape(shape),)
        if isinstance(shape, (VFVector, list, tuple)):
            dims = tuple(cls._to_int_shape(dim) for dim in shape)
            if not dims:
                raise ValueError("reshape shape cannot be empty")
            return dims
        raise TypeError("reshape shape must be an integer or a sequence of integers")

    @classmethod
    def _flatten_nested(cls, value: Any) -> list[Any]:
        if isinstance(value, (VFVector, list, tuple)):
            out: list[Any] = []
            for item in value:
                out.extend(cls._flatten_nested(item))
            return out
        return [value]

    @classmethod
    def _from_shape(
        cls,
        values: list[Any],
        shape: tuple[int, ...],
        start: int = 0,
    ) -> tuple[VFVector, int]:
        if len(shape) == 1:
            end = start + shape[0]
            return VFVector(values[start:end]), end
        out: list[VFVector] = []
        index = start
        for _ in range(shape[0]):
            child, index = cls._from_shape(values, shape[1:], index)
            out.append(child)
        return VFVector(out), index

    @classmethod
    def _shape_from_nested(cls, value: Any) -> tuple[int, ...]:
        if not isinstance(value, (VFVector, list, tuple)):
            return ()
        if not value:
            return (0,)
        child_shape = cls._shape_from_nested(value[0])
        for child in value[1:]:
            if child_shape != cls._shape_from_nested(child):
                raise ValueError("ragged values do not form a rectangular array")
        return (len(value),) + child_shape

    @property
    def shape(self) -> tuple[int, ...]:
        return self._shape_from_nested(self)

    @property
    def ndim(self) -> int:
        return len(self.shape)

    def reshape(self, shape: Any) -> "TypedVector":
        dims = self._coerce_shape(shape)
        flat = self._flatten_nested(self)
        size = 1
        for dim in dims:
            size *= dim
        if len(flat) != size:
            raise ValueError(f"cannot reshape array of size {len(flat)} to shape {dims}")
        nested, index = self._from_shape(flat, dims)
        if index != len(flat):
            raise ValueError("reshape produced an unexpected element mismatch")
        self._buf = nested._buf
        self._len = nested._len
        return self

    def __init__(self, values: Iterable[Any] = (), vf_type_expr: Any | None = None) -> None:
        super().__init__(values)
        self.vf_type_expr = vf_type_expr
