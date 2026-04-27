"""Mutable key–value map (stdlib ``collections.map``), not a struct dict."""

from __future__ import annotations

from typing import Any, Iterator


class VMap:
    """Hash map with O(1) get/set; keys are str or normalized indices (int/float)."""

    __slots__ = ("_d",)

    def __init__(self, initial: dict[Any, Any] | None = None) -> None:
        self._d: dict[Any, Any] = dict(initial) if initial else {}

    def __repr__(self) -> str:
        return f"VMap({self._d!r})"

    def __len__(self) -> int:
        return len(self._d)

    def __iter__(self) -> Iterator[Any]:
        return iter(self._d)

    def __contains__(self, k: Any) -> bool:
        return k in self._d

    def get(self, k: Any, default: Any = None) -> Any:
        return self._d.get(k, default)

    def copy(self) -> VMap:
        return VMap(self._d)

    def set(self, k: Any, value: Any) -> None:
        self._d[k] = value

    def items(self) -> Any:
        return self._d.items()

    def keys(self) -> Any:
        return self._d.keys()

    def values(self) -> Any:
        return self._d.values()
