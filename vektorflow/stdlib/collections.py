"""``collections`` — ``map`` (mutable hash map) and ``list`` (doubly linked list)."""

from __future__ import annotations

from typing import Any, Callable

from ..runtime import (
    VFLinkedList,
    VFQueue,
    VMap,
    make_vflist_from_call,
    make_vfqueue_from_call,
    make_vmap_from_call,
)


def _map_factory(pos: list[Any], kw: dict[str, Any], spreads: list[Any]) -> VMap:
    return make_vmap_from_call(pos, kw, spreads)


def _list_factory(pos: list[Any], kw: dict[str, Any], spreads: list[Any]) -> VFLinkedList:
    return make_vflist_from_call(pos, kw, spreads)


class _Ctor:
    __slots__ = ("_vkf_impl", "_vkf_ctor")

    def __init__(self, impl: Callable[..., Any], kind: str) -> None:
        self._vkf_impl = impl
        self._vkf_ctor = kind

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("Vektor Flow ctor must be invoked by the interpreter")

    def __repr__(self) -> str:
        return f"<vkf collections.{self._vkf_ctor}>"


def _queue_factory(pos: list[Any], kw: dict[str, Any], spreads: list[Any]) -> VFQueue:
    return make_vfqueue_from_call(pos, kw, spreads)


def build_collections_namespace() -> dict[str, Any]:
    return {
        "map": _Ctor(_map_factory, "map"),
        "list": _Ctor(_list_factory, "list"),
        "queue": _Ctor(_queue_factory, "queue"),
    }
