from __future__ import annotations

import contextlib
from collections import deque
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import EvalError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib.events import TouchEvent
from vektorflow.stdlib.ui import UIRoot
from vektorflow.ui.event_ingress import publish_ui_event_payload, reset_ui_event_ingress
from vektorflow.ui_display_ir import enqueue_public_host_event_payload


def _run(source: str) -> str:
    module = parse_module(source, filename="<touch>")
    interpreter = Interpreter(Path(__file__))
    output = StringIO()
    with contextlib.redirect_stdout(output):
        interpreter.run_module(module)
    return output.getvalue().strip()


def test_ui_module_exposes_read_only_touch_state_to_vkf() -> None:
    assert _run("""
:.ui
:: touch.n
:: touch.x
:: touch.y
:: touch.dx
:: touch.dy
""") == "0\n0\n0\n0\n0"


def test_vkf_cannot_assign_touch_state() -> None:
    with pytest.raises(EvalError, match="field bind requires struct"):
        _run("""
:.ui
touch.x:99
""")


def test_touch_pointer_events_update_state_and_materialize_typed_events() -> None:
    reset_ui_event_ingress()
    root = UIRoot()
    publish_ui_event_payload({
        "type": "vf_event", "event": "down", "pointerType": "touch",
        "pointerId": 4, "x": 10, "y": 20, "pressure": 0.5,
    })

    assert root.touch.n == 1
    assert (root.touch.x, root.touch.y) == (10, 20)
    assert root.cursor.pos == (0, 0)
    event = root.next_event()
    assert isinstance(event, TouchEvent)
    assert event.pointer_id == 4
    assert event.pressure == 0.5

    publish_ui_event_payload({
        "type": "vf_event", "event": "move", "pointerType": "touch",
        "pointerId": 4, "x": 13, "y": 25,
    })
    assert (root.touch.dx, root.touch.dy) == (3, 5)
    assert root.touch.contacts[0].id == 4

    publish_ui_event_payload({
        "type": "vf_event", "event": "down", "pointerType": "touch",
        "pointerId": 7, "x": 30, "y": 40,
    })
    assert root.touch.n == 2
    publish_ui_event_payload({
        "type": "vf_event", "event": "up", "pointerType": "touch",
        "pointerId": 4, "x": 13, "y": 25,
    })
    assert root.touch.n == 1
    assert root.touch.contacts[0].id == 7


def test_touch_move_coalescing_preserves_each_contact() -> None:
    queue: deque[object] = deque()
    first = {
        "type": "vf_event", "event": "move", "pointerType": "touch",
        "pointerId": 4, "x": 10, "y": 20,
    }
    second = {
        "type": "vf_event", "event": "move", "pointerType": "touch",
        "pointerId": 7, "x": 30, "y": 40,
    }
    enqueue_public_host_event_payload(queue, first)
    enqueue_public_host_event_payload(queue, second)
    assert len(queue) == 2
