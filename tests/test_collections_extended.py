"""Extensive tests for ``vektorflow.stdlib.collections`` — VMap, VFLinkedList,
queue, and interpreter-level VKF integration."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime.vflist import VFLinkedList
from vektorflow.runtime.vfqueue import VFQueue
from vektorflow.runtime.vmap import VMap
from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib.collections import build_collections_namespace


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _run(src: str) -> list[str]:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return [ln for ln in buf.getvalue().splitlines() if ln.strip()]


# ---------------------------------------------------------------------------
# resolve_stdlib contract
# ---------------------------------------------------------------------------

class TestResolveCollections:
    def test_collections_in_resolve_stdlib(self) -> None:
        ns = resolve_stdlib("collections")
        assert set(ns.keys()) >= {"map", "list", "queue"}

    def test_unknown_raises(self) -> None:
        with pytest.raises(KeyError):
            resolve_stdlib("not_a_thing")


# ---------------------------------------------------------------------------
# VMap — Python unit tests
# ---------------------------------------------------------------------------

class TestVMap:
    def test_empty_map(self) -> None:
        m = VMap()
        assert len(m) == 0

    def test_initial_dict(self) -> None:
        m = VMap({"a": 1, "b": 2})
        assert len(m) == 2

    def test_contains(self) -> None:
        m = VMap({"x": 10})
        assert "x" in m
        assert "y" not in m

    def test_get_existing(self) -> None:
        m = VMap({"k": 42})
        assert m.get("k") == 42

    def test_get_missing_default(self) -> None:
        m = VMap()
        assert m.get("missing") is None
        assert m.get("missing", 99) == 99

    def test_keys_values_items(self) -> None:
        m = VMap({"a": 1, "b": 2})
        assert set(m.keys()) == {"a", "b"}
        assert set(m.values()) == {1, 2}
        assert set(m.items()) == {("a", 1), ("b", 2)}

    def test_iter(self) -> None:
        m = VMap({"p": 1, "q": 2})
        keys = list(m)
        assert set(keys) == {"p", "q"}

    def test_repr(self) -> None:
        m = VMap({"a": 1})
        assert "VMap" in repr(m)

    def test_independent_copy(self) -> None:
        """VMap from dict should not share state with original dict."""
        d = {"x": 1}
        m = VMap(d)
        d["y"] = 2
        assert "y" not in m


# ---------------------------------------------------------------------------
# VFLinkedList — Python unit tests
# ---------------------------------------------------------------------------

class TestVFLinkedList:
    def test_empty_list(self) -> None:
        ll = VFLinkedList()
        assert len(ll) == 0
        assert list(ll) == []

    def test_single(self) -> None:
        ll = VFLinkedList.single(42)
        assert len(ll) == 1
        assert list(ll) == [42]

    def test_from_iterable(self) -> None:
        ll = VFLinkedList.from_iterable([1, 2, 3])
        assert list(ll) == [1, 2, 3]

    def test_append(self) -> None:
        ll = VFLinkedList()
        ll.append(10)
        ll.append(20)
        assert list(ll) == [10, 20]

    def test_extend(self) -> None:
        ll = VFLinkedList()
        ll.extend([1, 2, 3])
        assert list(ll) == [1, 2, 3]

    def test_insert_front(self) -> None:
        ll = VFLinkedList.from_iterable([2, 3])
        ll.insert(0, 1)
        assert list(ll) == [1, 2, 3]

    def test_insert_middle(self) -> None:
        ll = VFLinkedList.from_iterable([1, 3])
        ll.insert(1, 2)
        assert list(ll) == [1, 2, 3]

    def test_insert_end(self) -> None:
        ll = VFLinkedList.from_iterable([1, 2])
        ll.insert(2, 3)
        assert list(ll) == [1, 2, 3]

    def test_insert_negative_index(self) -> None:
        ll = VFLinkedList.from_iterable([1, 2, 3])
        ll.insert(-1, 99)
        assert list(ll) == [1, 2, 99, 3]

    def test_insert_out_of_range(self) -> None:
        ll = VFLinkedList.from_iterable([1, 2])
        with pytest.raises(IndexError):
            ll.insert(10, 99)

    def test_large_list(self) -> None:
        ll = VFLinkedList.from_iterable(range(1000))
        assert len(ll) == 1000
        assert list(ll) == list(range(1000))

    def test_repr(self) -> None:
        ll = VFLinkedList.from_iterable([1, 2])
        r = repr(ll)
        assert "VFLinkedList" in r

    def test_iteration_order(self) -> None:
        ll = VFLinkedList.from_iterable("abc")
        assert list(ll) == ["a", "b", "c"]

    def test_mixed_types(self) -> None:
        ll = VFLinkedList.from_iterable([1, "two", 3.0])
        assert list(ll) == [1, "two", 3.0]


# ---------------------------------------------------------------------------
# VKF — map tests
# ---------------------------------------------------------------------------

class TestMapVkf:
    def test_map_basic_fields(self) -> None:
        src = """
:.collections
m : map(a:1, b:2)
::: m.a
::: m.b
"""
        lines = _run(src)
        assert lines[0] in ("1", "1.0")
        assert lines[1] in ("2", "2.0")

    def test_map_set_new_field(self) -> None:
        src = """
:.collections
m : map()
m.x : 99
::: m.x
"""
        lines = _run(src)
        assert lines[0] in ("99", "99.0")

    def test_map_overwrite_field(self) -> None:
        src = """
:.collections
m : map(v:10)
m.v : 20
::: m.v
"""
        lines = _run(src)
        assert lines[0] in ("20", "20.0")

    def test_map_numeric_key(self) -> None:
        src = """
:.collections
m : map()
m.0 : 111
::: m.(0)
"""
        lines = _run(src)
        assert lines[0] in ("111", "111.0")

    def test_map_string_values(self) -> None:
        src = """
:.collections
m : map(name:"alice")
::: m.name
"""
        lines = _run(src)
        assert lines[0] == "alice"

    def test_map_multiple_types(self) -> None:
        src = """
:.collections
m : map(n:42, s:"hi", b:true)
::: m.n
::: m.s
::: m.b
"""
        lines = _run(src)
        assert lines[0] in ("42", "42.0")
        assert lines[1] == "hi"
        assert lines[2].lower() in ("true", "1")


# ---------------------------------------------------------------------------
# VKF — list tests
# ---------------------------------------------------------------------------

class TestListVkf:
    def test_list_empty(self) -> None:
        src = """
:.collections
L : list()
::: L
"""
        lines = _run(src)
        assert lines[0] == "[]"

    def test_list_single_element(self) -> None:
        src = """
:.collections
L : list(5)
::: L
"""
        lines = _run(src)
        assert lines[0] == "[5]"

    def test_list_multiple_elements(self) -> None:
        src = """
:.collections
L : list(1, 2, 3, 4)
::: L
"""
        lines = _run(src)
        assert lines[0] == "[1, 2, 3, 4]"

    def test_list_spread_from_vector(self) -> None:
        src = """
:.collections
v : [10, 20, 30]
L : list(:v)
::: L
"""
        lines = _run(src)
        assert lines[0] == "[10, 20, 30]"

    def test_take_from_list(self) -> None:
        src = """
:.collections
L : list(1, 2, 3, 4, 5)
::: take(3, L)
"""
        lines = _run(src)
        assert lines[0] == "(1, 2, 3)"

    def test_list_wraps_vector_as_single_element(self) -> None:
        src = """
:.collections
v : [1, 2, 3]
L : list(v)
::: L
"""
        lines = _run(src)
        assert lines[0] == "[[1, 2, 3]]"


# ---------------------------------------------------------------------------
# VKF — queue tests
# ---------------------------------------------------------------------------

class TestQueueVkf:
    def test_queue_basic_put_get(self) -> None:
        src = """
:.collections
q : queue()
q.put(1)
q.put(2)
q.put(3)
::: q.get()
::: q.get()
::: q.get()
"""
        lines = _run(src)
        assert lines[0] in ("1", "1.0")
        assert lines[1] in ("2", "2.0")
        assert lines[2] in ("3", "3.0")

    def test_queue_empty_returns_none(self) -> None:
        src = """
:.collections
q : queue()
::: q.empty()
"""
        lines = _run(src)
        assert lines[0].lower() in ("true", "1")

    def test_queue_fifo_order(self) -> None:
        src = """
:.collections
q : queue()
q.put(10)
q.put(20)
q.put(30)
a : q.get()
b : q.get()
c : q.get()
::: a
::: b
::: c
"""
        lines = _run(src)
        vals = [float(l) for l in lines]
        assert vals == [10.0, 20.0, 30.0]

    def test_queue_not_empty_after_put(self) -> None:
        src = """
:.collections
q : queue()
q.put(1)
::: q.empty()
"""
        lines = _run(src)
        assert lines[0].lower() in ("false", "0")


# ---------------------------------------------------------------------------
# Python-level collections namespace tests
# ---------------------------------------------------------------------------

class TestCollectionsNamespace:
    def test_map_factory_rejects_positional(self) -> None:
        from vektorflow.errors import EvalError
        ns = build_collections_namespace()
        ctor = ns["map"]
        with pytest.raises((EvalError, RuntimeError, Exception)):
            ctor._vkf_impl([1, 2], {}, [])

    def test_list_factory_empty(self) -> None:
        ns = build_collections_namespace()
        result = ns["list"]._vkf_impl([], {}, [])
        assert isinstance(result, VFLinkedList)
        assert len(result) == 0

    def test_list_factory_positional(self) -> None:
        ns = build_collections_namespace()
        result = ns["list"]._vkf_impl([1, 2, 3], {}, [])
        assert list(result) == [1, 2, 3]

    def test_list_factory_spread(self) -> None:
        ns = build_collections_namespace()
        result = ns["list"]._vkf_impl([], {}, [[10, 20, 30]])
        assert list(result) == [10, 20, 30]

    def test_list_factory_rejects_kw(self) -> None:
        from vektorflow.errors import EvalError
        ns = build_collections_namespace()
        with pytest.raises((EvalError, RuntimeError, Exception)):
            ns["list"]._vkf_impl([], {"x": 1}, [])

    def test_queue_factory_empty_args(self) -> None:
        ns = build_collections_namespace()
        q = ns["queue"]._vkf_impl([], {}, [])
        assert isinstance(q, VFQueue)
        assert q.empty()

    def test_queue_factory_rejects_args(self) -> None:
        from vektorflow.errors import EvalError
        ns = build_collections_namespace()
        with pytest.raises((EvalError, RuntimeError, Exception)):
            ns["queue"]._vkf_impl([1], {}, [])
