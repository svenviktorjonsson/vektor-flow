from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .axis_tagged import axis_tagged_data, is_axis_tagged_value
from .lazy_range import LazyList


def normalize_runtime_index(idx: Any, error_factory: Callable[[str], Exception]) -> Any:
    if isinstance(idx, bool):
        raise error_factory("index must be int or str")
    if isinstance(idx, complex):
        if idx.imag == 0 and idx.real == int(idx.real):
            return int(idx.real)
        raise error_factory("index must be int or str")
    if isinstance(idx, float) and idx == int(idx):
        return int(idx)
    if isinstance(idx, int):
        return idx
    if isinstance(idx, str):
        return idx
    raise error_factory("index must be int or str")


def runtime_value_index_get(
    base: Any,
    key: Any,
    error_factory: Callable[[str], Exception],
    read_collection_index: Callable[[Any, Any], tuple[bool, Any]] | None = None,
) -> tuple[bool, Any]:
    if is_axis_tagged_value(base):
        return runtime_value_index_get(
            axis_tagged_data(base),
            key,
            error_factory,
            read_collection_index,
        )
    normalized = normalize_runtime_index(key, error_factory)
    if isinstance(base, LazyList):
        return True, base.get_at(normalized)
    if read_collection_index is not None:
        handled, value = read_collection_index(base, normalized)
        if handled:
            return True, value
    if isinstance(base, dict):
        if key not in base:
            raise error_factory(f"missing key {key!r}")
        return True, base[key]
    return False, None


def runtime_value_index_set(
    container: Any,
    key: Any,
    value: Any,
    error_factory: Callable[[str], Exception],
    write_collection_index: Callable[[Any, Any, Any], bool] | None = None,
) -> bool:
    if is_axis_tagged_value(container):
        return runtime_value_index_set(
            axis_tagged_data(container),
            key,
            value,
            error_factory,
            write_collection_index,
        )
    if isinstance(container, LazyList):
        raise error_factory("cannot assign through index on lazy list")
    normalized = normalize_runtime_index(key, error_factory)
    if write_collection_index is not None and write_collection_index(container, normalized, value):
        return True
    if isinstance(container, dict):
        container[key] = value
        return True
    return False
