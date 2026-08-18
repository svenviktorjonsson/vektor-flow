"""Pytest defaults: isolate UI tests from the live overlay host."""

from __future__ import annotations

import pytest

import vektorflow.ui.launch as _vf_launch
from vektorflow.ui.runtime_packet_transport import (
    UIRuntimePacketTransport,
    reset_ui_runtime_packet_transport,
    set_ui_runtime_packet_transport,
)

_vf_launch._suppress_ui_auto_launch = True


@pytest.fixture(autouse=True)
def _offline_ui_runtime_transport():
    """Keep ordinary tests on the in-memory seam instead of probing a host."""
    set_ui_runtime_packet_transport(
        UIRuntimePacketTransport(
            direct_publisher=lambda _packets: (False, None, "UI host disabled under pytest")
        )
    )
    try:
        yield
    finally:
        reset_ui_runtime_packet_transport()
