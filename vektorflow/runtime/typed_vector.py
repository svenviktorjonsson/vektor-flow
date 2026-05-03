from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


@dataclass
class TypedVector(list):
    """List value carrying a refined static vector type expression."""

    vf_type_expr: Any | None = None
    __vf_py_attrs__ = True

    @staticmethod
    def _to_int_shape(value: Any) -> int:
        if isinstance(value, bool):
            raise TypeError("shape components must be non-boolean integers")
        if not isinstance(value, int):
            if isinstance(value, float):
                if value != int(value):
                    raise TypeError(f"shape component {value!r} must be an integer")
                value = int(value)
            else:
                raise TypeError(f"shape component {value!r} must be an integer")
        if value < 0:
            raise ValueError(f"shape components must be non-negative, got {value}")
        return value

    @staticmethod
    def _coerce_shape(shape: Any) -> tuple[int, ...]:
        if isinstance(shape, int):
            return (TypedVector._to_int_shape(shape),)
        if isinstance(shape, (list, tuple)):
            dims = tuple(TypedVector._to_int_shape(dim) for dim in shape)
            if not dims:
                raise ValueError("reshape shape cannot be empty")
            return dims
        if isinstance(shape, TypedVector):
            return tuple(shape)
        raise TypeError("reshape shape must be an integer or a sequence of integers")

    @staticmethod
    def _flatten_nested(value: Any) -> list[Any]:
        if isinstance(value, (list, tuple, TypedVector)):
            out: list[Any] = []
            for item in value:
                out.extend(TypedVector._flatten_nested(item))
            return out
        return [value]

    @staticmethod
    def _from_shape(values: list[Any], shape: tuple[int, ...], start: int = 0) -> tuple[Any, int]:
        if len(shape) == 1:
            end = start + shape[0]
            return values[start:end], end
        out: list[Any] = []
        index = start
        for _ in range(shape[0]):
            child, index = TypedVector._from_shape(values, shape[1:], index)
            out.append(child)
        return out, index

    @staticmethod
    def _shape_from_nested(value: Any) -> tuple[int, ...]:
        if not isinstance(value, (list, tuple, TypedVector)):
            return ()
        if not value:
            return (0,)
        child_shape = TypedVector._shape_from_nested(value[0])
        for child in value[1:]:
            if child_shape != TypedVector._shape_from_nested(child):
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
            raise ValueError(
                f"cannot reshape array of size {len(flat)} to shape {dims}"
            )
        nested, index = self._from_shape(flat, dims, 0)
        if index != len(flat):
            raise ValueError("reshape produced an unexpected element mismatch")
        super().clear()
        super().extend(nested if isinstance(nested, list) else [nested])
        return self

    def __init__(self, values: Iterable[Any] = (), vf_type_expr: Any | None = None) -> None:
        super().__init__(values)
        self.vf_type_expr = vf_type_expr
