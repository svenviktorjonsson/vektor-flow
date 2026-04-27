from __future__ import annotations

from vektorflow.runtime import (
    Multiset,
    VFLinkedList,
    VFQueue,
    VMap,
    is_runtime_collection,
    make_vflist,
    make_vfqueue,
    make_vmap,
)


def test_make_vmap_returns_runtime_owned_map() -> None:
    m = make_vmap({"a": 1})
    assert isinstance(m, VMap)
    assert m.get("a") == 1
    copied = m.copy()
    copied.set("b", 2)
    assert "b" not in m
    assert copied.get("b") == 2


def test_make_vflist_and_queue_share_runtime_surface() -> None:
    ll = make_vflist([1, 2, 3])
    assert isinstance(ll, VFLinkedList)
    assert ll.peek_left() == 1
    assert ll.pop_left() == 1
    assert ll.to_list() == [2, 3]

    q = make_vfqueue([4, 5])
    assert isinstance(q, VFQueue)
    assert list(q) == [4, 5]
    assert q.get() == 4
    q.put(6)
    assert list(q) == [5, 6]
    assert q.empty() is False
    assert q.get() == 5
    assert q.get() == 6
    assert q.get() is None
    assert q.empty() is True


def test_runtime_collection_predicate_covers_core_owned_collections() -> None:
    assert is_runtime_collection(make_vmap())
    assert is_runtime_collection(make_vflist())
    assert is_runtime_collection(make_vfqueue())
    assert is_runtime_collection(Multiset({1: 2}))
    assert not is_runtime_collection({"python": "dict"})
