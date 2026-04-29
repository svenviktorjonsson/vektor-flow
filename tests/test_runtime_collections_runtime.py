from __future__ import annotations

import pytest

from vektorflow.errors import EvalError
from vektorflow.runtime import (
    Multiset,
    VFLinkedList,
    VFQueue,
    VMap,
    is_runtime_collection,
    make_multiset,
    make_singleton_vflist,
    make_vflist,
    make_vflist_from_call,
    make_vflist_from_values,
    make_vfqueue,
    make_vfqueue_from_call,
    make_vmap,
    make_vmap_from_call,
    runtime_collection_attr,
    runtime_collection_contains,
    runtime_collection_ctor_call,
    runtime_collection_assign,
    runtime_collection_assign_path,
    runtime_collection_get,
    runtime_collection_index_get,
    runtime_collection_index_read,
    runtime_collection_index_set,
    runtime_collection_items_sorted,
    runtime_collection_keys_sorted,
    runtime_collection_path_step,
    runtime_collection_read_attr,
    runtime_collection_require_get,
    runtime_collection_elementwise_values,
    runtime_collection_expanded_values,
    runtime_collection_mapped_result,
    runtime_collection_preserves_pipe_result,
    runtime_collection_pipe_result,
    runtime_collection_spill_values,
    runtime_collection_stringify,
    runtime_collection_to_multiset,
    runtime_collection_to_list,
    runtime_collection_rebuild_result,
    runtime_collection_multiset_from_count_pairs,
    runtime_collection_multiset_from_values,
    runtime_collection_take,
    runtime_collection_take_prefix,
    runtime_collection_values,
    runtime_collection_set,
    runtime_collection_kind,
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

    single = make_singleton_vflist(9)
    assert isinstance(single, VFLinkedList)
    assert list(single) == [9]
    assert list(make_vflist_from_values([])) == []
    assert list(make_vflist_from_values([7])) == [7]
    assert list(make_vflist_from_values([7, 8])) == [7, 8]


def test_runtime_collection_predicate_covers_core_owned_collections() -> None:
    assert is_runtime_collection(make_vmap())
    assert is_runtime_collection(make_vflist())
    assert is_runtime_collection(make_vfqueue())
    assert is_runtime_collection(Multiset({1: 2}))
    assert not is_runtime_collection({"python": "dict"})


def test_runtime_collection_kind_and_make_multiset() -> None:
    ms = make_multiset([(1, 2), (3, 1)])
    assert runtime_collection_kind(make_vmap()) == "map"
    assert runtime_collection_kind(make_vflist()) == "list"
    assert runtime_collection_kind(make_vfqueue()) == "queue"
    assert runtime_collection_kind(ms) == "multiset"
    assert runtime_collection_kind(("not", "a collection")) is None
    assert isinstance(ms, Multiset)
    assert ms.count(1) == 2


def test_runtime_collection_map_helpers() -> None:
    m = make_vmap({"x": 3})
    assert runtime_collection_contains(m, "x") is True
    assert runtime_collection_contains(m, "y") is False
    assert runtime_collection_get(m, "x") == 3
    assert runtime_collection_require_get(m, "x") == 3
    assert runtime_collection_assign(m, "y", 4) is True
    runtime_collection_set(m, "y", 4)
    assert runtime_collection_get(m, "y") == 4
    assert runtime_collection_index_get(m, "y") == 4
    m.set(2, 5)
    assert runtime_collection_items_sorted(m) == [(2, 5), ("x", 3), ("y", 4)]
    assert runtime_collection_keys_sorted(m) == [2, "x", "y"]
    ms = make_multiset([(3, 1), (1, 2)])
    assert runtime_collection_items_sorted(ms) == [(1, 2), (3, 1)]
    with pytest.raises(EvalError, match=r"missing key 'y'"):
        runtime_collection_require_get(make_vmap({"x": 3}), "y")
    with pytest.raises(EvalError, match=r"missing key 'y' in interpolation"):
        runtime_collection_require_get(
            make_vmap({"x": 3}), "y", missing_suffix=" in interpolation"
        )
    assert runtime_collection_assign([], 0, "x") is False
    m3 = make_vmap({"path": 1})
    assert runtime_collection_assign_path(m3, ["path"], 8) is True
    assert runtime_collection_index_get(m3, "path") == 8
    assert runtime_collection_assign_path([], ["path"], 8) is False
    with pytest.raises(EvalError, match=r"multi-key map assignment is not supported"):
        runtime_collection_assign_path(make_vmap({"x": 3}), ["x", "y"], 9)
    m2 = make_vmap({"x": 3})
    assert runtime_collection_index_set(m2, "z", 9) is True
    assert runtime_collection_index_get(m2, "z") == 9
    assert runtime_collection_index_read(m2, "z") == (True, 9)
    plain = {"x": 3}
    assert runtime_collection_index_set(plain, "z", 9) is True
    assert plain == {"x": 3, "z": 9}
    assert runtime_collection_index_read(plain, "z") == (True, 9)
    with pytest.raises(EvalError, match=r"missing key 'y'"):
        runtime_collection_index_read(plain, "y")
    assert runtime_collection_index_read([10, 20, 30], 1) == (True, 20)
    assert runtime_collection_index_read((10, 20, 30), 1) == (True, 20)
    assert runtime_collection_index_read("abc", 1) == (True, "b")
    seq = [1, 2, 3]
    assert runtime_collection_index_set(seq, 1, 9) is True
    assert seq == [1, 9, 3]
    with pytest.raises(IndexError):
        runtime_collection_index_set([], 0, "x")
    with pytest.raises(IndexError):
        runtime_collection_index_read([], 0)
    assert runtime_collection_index_read(object(), 0) == (False, None)
    with pytest.raises(TypeError):
        runtime_collection_index_get([], 0)


def test_runtime_collection_take_prefix_for_list_and_queue() -> None:
    assert runtime_collection_take_prefix(make_vflist([1, 2, 3]), 2) == (1, 2)
    assert runtime_collection_take_prefix(make_vfqueue([4, 5, 6]), 2) == (4, 5)
    assert runtime_collection_take_prefix([7, 8, 9], 2) == (7, 8)
    assert runtime_collection_take_prefix((10, 11, 12), 2) == (10, 11)
    assert runtime_collection_take(make_vflist([1, 2, 3]), 2) == (1, 2)
    assert runtime_collection_take(make_vfqueue([4, 5, 6]), 2) == (4, 5)
    assert runtime_collection_take([7, 8, 9], 2) == (7, 8)
    assert runtime_collection_take((10, 11, 12), 2) == (10, 11)
    assert runtime_collection_take(object(), 2) is None
    assert runtime_collection_to_list(make_vflist([1, 2, 3])) == [1, 2, 3]
    assert runtime_collection_to_list(make_vfqueue([4, 5, 6])) == [4, 5, 6]
    assert runtime_collection_to_list([7, 8, 9]) == [7, 8, 9]
    assert runtime_collection_to_list((10, 11, 12)) == [10, 11, 12]
    assert runtime_collection_to_list(object()) is None
    with pytest.raises(EvalError, match=r"take: use a sequence or iterator, not a multiset"):
        runtime_collection_take(make_multiset([(1, 2)]), 1)
    with pytest.raises(EvalError, match=r"to_list: use a sequence or iterator, not a multiset"):
        runtime_collection_to_list(make_multiset([(1, 2)]))
    assert runtime_collection_expanded_values(make_vflist([1, 2, 3])) == (1, 2, 3)
    assert runtime_collection_values(make_vflist([1, 2, 3])) == (1, 2, 3)
    assert runtime_collection_values(make_vfqueue([4, 5, 6])) == (4, 5, 6)
    assert runtime_collection_expanded_values(make_vfqueue([4, 5, 6])) == (4, 5, 6)
    assert runtime_collection_values([7, 8, 9]) == (7, 8, 9)
    assert runtime_collection_values((10, 11, 12)) == (10, 11, 12)
    assert runtime_collection_values("ab") == ("a", "b")
    assert runtime_collection_expanded_values([7, 8, 9]) == (7, 8, 9)
    assert runtime_collection_expanded_values((10, 11, 12)) == (10, 11, 12)
    assert runtime_collection_expanded_values("ab") == ("a", "b")
    assert set(runtime_collection_expanded_values(frozenset({13, 14}))) == {13, 14}
    assert set(runtime_collection_expanded_values({15, 16})) == {15, 16}
    assert runtime_collection_expanded_values(make_multiset([(1, 2), (3, 1)])) == (
        1,
        1,
        3,
    )
    assert runtime_collection_spill_values(make_multiset([(1, 2), (3, 1)])) == (
        1,
        1,
        3,
    )
    with pytest.raises(EvalError, match=r"\[: …\] multiset spill requires a multiset value"):
        runtime_collection_spill_values(make_vflist([1, 2, 3]))
    mapped = runtime_collection_mapped_result(
        make_multiset([(1, 2), (2, 1)]),
        [2, 2, 4],
    )
    assert isinstance(mapped, Multiset)
    assert runtime_collection_items_sorted(mapped) == [(2, 2), (4, 1)]
    assert runtime_collection_mapped_result(make_vflist([1, 2, 3]), [2, 4, 6]) is None
    handled, pipe_mapped = runtime_collection_pipe_result(
        make_multiset([(1, 2), (2, 1)]),
        [2, 2, 4],
    )
    assert handled is True
    assert isinstance(pipe_mapped, Multiset)
    assert runtime_collection_items_sorted(pipe_mapped) == [(2, 2), (4, 1)]
    assert runtime_collection_pipe_result(make_vflist([1, 2, 3]), [2, 4, 6]) == (
        False,
        None,
    )
    assert runtime_collection_preserves_pipe_result(make_multiset([(1, 2)])) is True
    assert runtime_collection_preserves_pipe_result(make_vflist([1, 2, 3])) is False
    assert runtime_collection_elementwise_values(make_multiset([(1, 2), (3, 1)])) == (
        1,
        1,
        3,
    )
    assert runtime_collection_elementwise_values([7, 8, 9]) == (7, 8, 9)
    assert runtime_collection_elementwise_values((10, 11, 12)) == (10, 11, 12)
    assert runtime_collection_elementwise_values("ab") == ("a", "b")
    assert set(runtime_collection_elementwise_values(frozenset({13, 14}))) == {13, 14}
    assert set(runtime_collection_elementwise_values({15, 16})) == {15, 16}
    assert runtime_collection_elementwise_values(make_vflist([1, 2, 3])) is None
    assert runtime_collection_stringify(make_vmap({"b": 2, "a": 1}), str) == "{a:1, b:2}"
    assert runtime_collection_stringify(make_vflist([1, 2, 3]), str) == "[1, 2, 3]"
    assert runtime_collection_stringify(make_vfqueue([4, 5]), str) == "[4, 5]"
    assert runtime_collection_stringify([7, 8, 9], str) == "[7, 8, 9]"
    assert runtime_collection_stringify((10, 11, 12), str) == "(10, 11, 12)"
    assert runtime_collection_stringify((10,), str) == "(10,)"
    assert runtime_collection_stringify({15, 16}, str) == "{15, 16}"
    assert runtime_collection_stringify(frozenset({13, 14}), str) == "{13, 14}"
    assert runtime_collection_stringify(set(), str) == "{}"
    assert runtime_collection_stringify(make_multiset([(1, 2), (3, 1)]), str) == "{1:2, 3:1}"
    assert runtime_collection_stringify(object(), str) is None
    assert runtime_collection_rebuild_result((1, 2), [3, 4]) == (True, (3, 4))
    assert runtime_collection_rebuild_result([1, 2], [3, 4]) == (True, [3, 4])
    assert runtime_collection_rebuild_result("ab", ["a", "a", "b", "b"]) == (True, "aabb")
    assert runtime_collection_rebuild_result(frozenset({1, 2}), [3, 4]) == (
        True,
        frozenset({3, 4}),
    )
    assert runtime_collection_rebuild_result({1, 2}, [3, 4]) == (True, {3, 4})
    assert runtime_collection_rebuild_result(object(), [3, 4]) == (False, None)
    built_ms = runtime_collection_multiset_from_values([1, 1, 3])
    assert isinstance(built_ms, Multiset)
    assert runtime_collection_items_sorted(built_ms) == [(1, 2), (3, 1)]
    built_pairs_ms = runtime_collection_multiset_from_count_pairs([(1, 2), (3, 1.0)])
    assert isinstance(built_pairs_ms, Multiset)
    assert runtime_collection_items_sorted(built_pairs_ms) == [(1, 2), (3, 1)]
    with pytest.raises(EvalError, match=r"multiset count must be a number"):
        runtime_collection_multiset_from_count_pairs([(1, "x")])
    with pytest.raises(EvalError, match=r"multiset count must be an integer"):
        runtime_collection_multiset_from_count_pairs([(1, 1.5)])
    with pytest.raises(EvalError, match=r"multiset count must be non-negative"):
        runtime_collection_multiset_from_count_pairs([(1, -1)])


def test_runtime_collection_queue_attrs_are_seam_owned_callables() -> None:
    q = make_vfqueue([4, 5])
    put = runtime_collection_attr(q, "put")
    get = runtime_collection_attr(q, "get")
    empty = runtime_collection_attr(q, "empty")
    missing = runtime_collection_attr(q, "missing")
    assert callable(put)
    assert callable(get)
    assert callable(empty)
    assert missing is None
    assert get() == 4
    put(6)
    assert get() == 5
    assert get() == 6
    assert empty() is True


def test_runtime_collection_read_attr_unifies_map_and_queue_reads() -> None:
    m = make_vmap({"name": "alice"})
    q = make_vfqueue([4])
    assert runtime_collection_read_attr(m, "name") == "alice"
    get = runtime_collection_read_attr(q, "get")
    assert callable(get)
    assert get() == 4
    with pytest.raises(Exception):
        runtime_collection_read_attr(m, "missing")


def test_runtime_collection_path_step_handles_runtime_map_reads() -> None:
    handled, value = runtime_collection_path_step(
        make_vmap({"name": "alice"}), "name", missing_suffix=" in string interpolation"
    )
    assert handled is True
    assert value == "alice"
    handled, value = runtime_collection_path_step(("not", "runtime"), "name")
    assert handled is False
    assert value is None
    with pytest.raises(EvalError, match=r"missing key 'missing' in string interpolation"):
        runtime_collection_path_step(
            make_vmap({"name": "alice"}),
            "missing",
            missing_suffix=" in string interpolation",
        )


def test_runtime_collection_call_factories() -> None:
    assert isinstance(make_vmap_from_call([], {"a": 1}, []), VMap)
    assert list(make_vflist_from_call([1, 2], {}, [])) == [1, 2]
    assert list(make_vflist_from_call([], {}, [[3, 4]])) == [3, 4]
    assert isinstance(make_vfqueue_from_call([], {}, []), VFQueue)

    with pytest.raises(Exception):
        make_vmap_from_call([1], {}, [])
    with pytest.raises(Exception):
        make_vflist_from_call([], {"x": 1}, [])
    with pytest.raises(Exception):
        make_vfqueue_from_call([1], {}, [])


def test_runtime_collection_ctor_call_dispatches_stdlib_collection_ctors() -> None:
    from vektorflow.stdlib.collections import build_collections_namespace

    ns = build_collections_namespace()
    assert isinstance(runtime_collection_ctor_call(ns["map"], [], {"a": 1}, []), VMap)
    assert list(runtime_collection_ctor_call(ns["list"], [1, 2], {}, [])) == [1, 2]
    assert isinstance(runtime_collection_ctor_call(ns["queue"], [], {}, []), VFQueue)
    assert runtime_collection_ctor_call(object(), [], {}, []) is None


def test_runtime_collection_to_multiset_reuses_runtime_multiset_surface() -> None:
    ms = runtime_collection_to_multiset([1, 2, 1, 3])
    assert isinstance(ms, Multiset)
    assert runtime_collection_items_sorted(ms) == [(1, 2), (2, 1), (3, 1)]
