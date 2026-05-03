"""Host-injection seams for UI timers and bridge polling (python-freeness helpers)."""

from __future__ import annotations

import pytest

from vektorflow.stdlib import ui
from vektorflow.ui import bridge


@pytest.fixture(autouse=True)
def _reset_hosts() -> None:
    ui.reset_ui_timer_host()
    bridge.reset_bridge_timer_host()
    bridge.clear_base_cache()
    yield
    ui.reset_ui_timer_host()
    bridge.reset_bridge_timer_host()
    bridge.clear_base_cache()


def test_ui_timer_host_swap_and_basic_calls() -> None:
    class FakeUiHost:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple]] = []

        def monotonic(self) -> float:
            self.calls.append(("monotonic", ()))
            return 42.0

        def sleep(self, seconds: float) -> None:
            self.calls.append(("sleep", (float(seconds),)))

    host = FakeUiHost()
    ui.set_ui_timer_host(host)

    assert ui.get_ui_timer_host() is host
    assert ui._ui_monotonic() == 42.0
    ui._ui_sleep(0.2)

    assert host.calls == [("monotonic", ()), ("sleep", (0.2,))]


def test_ui_timer_host_validate() -> None:
    class IncompleteHost:
        def monotonic(self) -> float:
            return 0.0

    with pytest.raises(TypeError, match="monotonic\\(\\) and sleep\\(seconds\\)"):
        ui.set_ui_timer_host(IncompleteHost())


def test_bridge_timer_host_swap_and_runtime_polling(monkeypatch, tmp_path) -> None:
    class FakeBridgeHost:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple]] = []
            self._t = 0.0

        def monotonic(self) -> float:
            self.calls.append(("monotonic", ()))
            self._t += 0.1
            return self._t

        def sleep(self, seconds: float) -> None:
            self.calls.append(("sleep", (float(seconds),)))
            self._t += float(seconds)

    host = FakeBridgeHost()
    bridge.set_bridge_timer_host(host)
    monkeypatch.delenv("VEKTORFLOW_VF_API", raising=False)
    monkeypatch.delenv("VEKTORFLOW_VF_PORT", raising=False)
    monkeypatch.setattr(bridge, "_port_file_candidates", lambda: [tmp_path / "missing-port.txt"])

    with pytest.raises(RuntimeError, match="vf overlay API base not found"):
        bridge.vf_base_url(wait_seconds=0.15, poll_interval=0.05)

    assert ("sleep", (0.05,)) in host.calls
    assert ("monotonic", ()) in host.calls
    assert bridge.get_bridge_timer_host() is host


def test_bridge_timer_host_validate() -> None:
    class IncompleteHost:
        def monotonic(self) -> float:
            return 1.0

    with pytest.raises(TypeError, match="monotonic\\(\\) and sleep"):
        bridge.set_bridge_timer_host(IncompleteHost())

