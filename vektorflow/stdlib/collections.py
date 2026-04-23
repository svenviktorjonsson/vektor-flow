"""``collections`` — ``map`` (mutable hash map) and ``list`` (doubly linked list)."""

from __future__ import annotations

from collections import deque
from typing import Any, Callable

from ..errors import EvalError
from ..runtime.vflist import VFLinkedList
from ..runtime.vmap import VMap


def _map_factory(pos: list[Any], kw: dict[str, Any], spreads: list[Any]) -> VMap:
    if pos or spreads:
        raise EvalError("map() only accepts keyword-style pairs (x:value, …)")
    return VMap(kw)


def _list_factory(pos: list[Any], kw: dict[str, Any], spreads: list[Any]) -> VFLinkedList:
    if kw:
        raise EvalError("list() does not accept keyword arguments")
    if spreads:
        if pos or len(spreads) != 1:
            raise EvalError("list(:…) spread must be the only argument")
        try:
            return VFLinkedList.from_iterable(spreads[0])
        except TypeError as e:
            raise EvalError("list(:…) requires an iterable") from e
    if not pos:
        return VFLinkedList()
    if len(pos) == 1:
        return VFLinkedList.single(pos[0])
    return VFLinkedList.from_iterable(pos)


class _Ctor:
    __slots__ = ("_vkf_impl", "_vkf_ctor")

    def __init__(self, impl: Callable[..., Any], kind: str) -> None:
        self._vkf_impl = impl
        self._vkf_ctor = kind

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("Vektor Flow ctor must be invoked by the interpreter")

    def __repr__(self) -> str:
        return f"<vkf collections.{self._vkf_ctor}>"


class _Queue:
    """FIFO queue (for UI event loops, routing, etc.); uses a deque under the hood."""

    __vf_py_attrs__ = True
    __slots__ = ("_d",)

    def __init__(self) -> None:
        self._d: deque[Any] = deque()

    def put(self, item: Any) -> None:
        self._d.append(item)

    def get(self) -> Any | None:
        """``None`` if empty (non-blocking; pair with :meth:`empty`)."""
        if not self._d:
            return None
        return self._d.popleft()

    def empty(self) -> bool:
        return len(self._d) == 0


def _queue_factory(pos: list[Any], kw: dict[str, Any], spreads: list[Any]) -> _Queue:
    if pos or kw or spreads:
        raise EvalError("queue() takes no arguments")
    return _Queue()


def build_collections_namespace() -> dict[str, Any]:
    return {
        "map": _Ctor(_map_factory, "map"),
        "list": _Ctor(_list_factory, "list"),
        "queue": _Ctor(_queue_factory, "queue"),
    }
