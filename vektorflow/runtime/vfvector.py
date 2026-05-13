from __future__ import annotations

import ctypes
from collections.abc import Iterable, Iterator, Sequence
from typing import Any


class VFVector(Sequence[Any]):
    """Fixed-size vector storage backed by a contiguous ``ctypes.py_object`` buffer."""

    __slots__ = ("_buf", "_len")

    def __init__(self, values: Iterable[Any] = ()) -> None:
        seq = tuple(values)
        self._len = len(seq)
        buf_type = ctypes.py_object * self._len
        self._buf = buf_type(*seq)

    def __len__(self) -> int:
        return self._len

    def __iter__(self) -> Iterator[Any]:
        for i in range(self._len):
            yield self._buf[i]

    def __getitem__(self, index: int | slice) -> Any:
        if isinstance(index, slice):
            return VFVector(self._buf[i] for i in range(*index.indices(self._len)))
        return self._buf[index]

    def __setitem__(self, index: int | slice, value: Any) -> None:
        if isinstance(index, slice):
            positions = range(*index.indices(self._len))
            seq = tuple(value)
            if len(seq) != len(positions):
                raise ValueError("vector slice assignment must preserve length")
            for pos, item in zip(positions, seq):
                self._buf[pos] = item
            return
        self._buf[index] = value

    def __eq__(self, other: object) -> bool:
        if isinstance(other, VFVector):
            return tuple(self) == tuple(other)
        if isinstance(other, Sequence) and not isinstance(other, (str, bytes, bytearray)):
            return tuple(self) == tuple(other)
        return False

    def __repr__(self) -> str:
        return f"VFVector({', '.join(repr(item) for item in self)})"

    def to_tuple(self) -> tuple[Any, ...]:
        return tuple(self)


class VFVectorBuilder:
    """Growable builder that finalizes into a fixed-size :class:`VFVector`."""

    __slots__ = ("_buf", "_cap", "_len")

    def __init__(self, capacity: int = 4) -> None:
        self._cap = max(1, int(capacity))
        self._len = 0
        self._buf = (ctypes.py_object * self._cap)()

    def append(self, value: Any) -> None:
        if self._len >= self._cap:
            self._grow()
        self._buf[self._len] = value
        self._len += 1

    def extend(self, values: Iterable[Any]) -> None:
        for value in values:
            self.append(value)

    def build(self) -> VFVector:
        return VFVector(self._buf[i] for i in range(self._len))

    def _grow(self) -> None:
        new_cap = self._cap * 2
        new_buf = (ctypes.py_object * new_cap)()
        for i in range(self._len):
            new_buf[i] = self._buf[i]
        self._buf = new_buf
        self._cap = new_cap
