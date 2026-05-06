from __future__ import annotations

from vektorflow.stdlib.bridge import build_bridge_namespace


def test_build_bridge_namespace_exports_expected_surface(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []

    monkeypatch.setattr(
        "vektorflow.stdlib.bridge._b.vf_base_url",
        lambda wait_seconds=0.0: calls.append(("vf_base_url", wait_seconds)) or "http://127.0.0.1:4321",
    )
    monkeypatch.setattr(
        "vektorflow.stdlib.bridge._b.pop_line_json",
        lambda: calls.append(("pop_line_json", None)) or {"kind": "hover"},
    )
    monkeypatch.setattr(
        "vektorflow.stdlib.bridge._b.clear_base_cache",
        lambda: calls.append(("clear_base_cache", None)),
    )

    ns = build_bridge_namespace()

    assert set(ns) == {"bridge", "base_url", "connect", "pop", "clear"}
    bridge = ns["bridge"]
    assert getattr(bridge, "__vf_py_attrs__", False) is True

    assert ns["base_url"]() == "http://127.0.0.1:4321"
    assert ns["connect"](12) == "http://127.0.0.1:4321"
    assert ns["pop"]() == {"kind": "hover"}
    assert ns["clear"]() is None

    assert bridge.base_url() == "http://127.0.0.1:4321"
    assert bridge.connect(7.5) == "http://127.0.0.1:4321"
    assert bridge.pop() == {"kind": "hover"}
    assert bridge.clear() is None

    assert calls == [
        ("vf_base_url", 0.0),
        ("vf_base_url", 12.0),
        ("pop_line_json", None),
        ("clear_base_cache", None),
        ("vf_base_url", 0.0),
        ("vf_base_url", 7.5),
        ("pop_line_json", None),
        ("clear_base_cache", None),
    ]


def test_bridge_pop_maps_empty_queue_to_empty_string(monkeypatch) -> None:
    monkeypatch.setattr("vektorflow.stdlib.bridge._b.pop_line_json", lambda: None)
    ns = build_bridge_namespace()

    assert ns["pop"]() == ""
    assert ns["bridge"].pop() == ""
