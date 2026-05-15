"""Authoritative UI event ingress contract.

The live host may deliver events through HTTP polling, but that transport is an
adapter. The authoritative seam is publish/subscribe over raw event payloads so
tests can inject and inspect payloads without a browser or overlay.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import socket
import threading
import urllib.request
import time
from typing import Any, Callable


@dataclass(frozen=True)
class UIEventIngressSnapshot:
    published_payloads: tuple[dict[str, Any], ...] = ()


class UIEventIngress:
    def __init__(self, *, max_history: int = 512) -> None:
        self._subs: list[Callable[[dict[str, Any]], None]] = []
        self._history: deque[dict[str, Any]] = deque(maxlen=max_history)

    @property
    def subscribers(self) -> tuple[Callable[[dict[str, Any]], None], ...]:
        return tuple(self._subs)

    def subscribe(self, fn: Callable[[dict[str, Any]], None]) -> None:
        self._subs.append(fn)

    def publish(self, payload: dict[str, Any]) -> None:
        evt = dict(payload)
        if self._history and self._history[-1] == evt:
            return
        self._history.append(evt)
        _trace_ingress(evt)
        for sub in list(self._subs):
            try:
                sub(dict(evt))
            except Exception as exc:
                _trace_ingress_error(exc)

    def snapshot(self) -> UIEventIngressSnapshot:
        return UIEventIngressSnapshot(published_payloads=tuple(dict(evt) for evt in self._history))


_global_ingress = UIEventIngress()


def get_ui_event_ingress() -> UIEventIngress:
    return _global_ingress


def publish_ui_event_payload(payload: dict[str, Any]) -> None:
    _global_ingress.publish(payload)


def get_ui_event_snapshot() -> UIEventIngressSnapshot:
    return _global_ingress.snapshot()


def reset_ui_event_ingress() -> None:
    global _global_ingress
    _global_ingress = UIEventIngress()


def _read_overlay_port_file() -> int:
    """Read vf-api-port.txt written by vf-overlay.exe next to the executable."""
    try:
        from vektorflow.ui.launch import _read_overlay_state, find_vektorflow_repo_root, find_vf_overlay_exe

        candidates: list[Path] = []
        state = _read_overlay_state()
        state_exe = state.get("exe") if isinstance(state, dict) else None
        if isinstance(state_exe, str) and state_exe.strip():
            candidates.append(Path(state_exe).resolve())
        root = find_vektorflow_repo_root()
        if root is not None:
            exe = find_vf_overlay_exe(root)
            if exe is not None:
                resolved = exe.resolve()
                if resolved not in candidates:
                    candidates.append(resolved)
        for exe_path in candidates:
            port_file = exe_path.parent / "web" / "vf-api-port.txt"
            if port_file.is_file():
                txt = port_file.read_text(encoding="utf-8").strip()
                if txt.isdigit():
                    return int(txt)
    except Exception:
        pass
    return 0


_discovered_overlay_port: int = 0
_overlay_port_lock = threading.Lock()


def get_overlay_port() -> int:
    """Return the HTTP port of the running vf-overlay, or 0 if not found."""
    global _discovered_overlay_port
    with _overlay_port_lock:
        if _discovered_overlay_port:
            return _discovered_overlay_port
        port = _read_overlay_port_file()
        if port:
            _discovered_overlay_port = port
        return _discovered_overlay_port


def reset_overlay_port() -> None:
    global _discovered_overlay_port
    with _overlay_port_lock:
        _discovered_overlay_port = 0


_INPUT_RUNTIME_PACKETS_URL_TEMPLATE = "http://127.0.0.1:{port}/api/runtime-packets/input"
_RUNTIME_PACKETS_URL_TEMPLATE = "http://127.0.0.1:{port}/api/runtime-packets"
_POP_URL_TEMPLATE = "http://127.0.0.1:{port}/api/pop"
_POLL_INTERVAL = 0.001
_FETCH_TIMEOUT = 0.25
_POP_TIMEOUT = 0.01
_MAX_POP_EVENTS_PER_DRAIN = 128
_FETCH_TIMEOUT_SENTINEL = object()


class OverlayPoller:
    """Background thread that drains runtime packet snapshots into UI ingress."""

    def __init__(self) -> None:
        self._subs: list[Callable[[dict[str, Any]], None]] = []
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._active_port = 0
        self._last_packet_seq = 0
        self._last_packet_revision = 0

    def subscribe(self, fn: Callable[[dict[str, Any]], None]) -> None:
        self._subs.append(fn)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="vf-event-poller")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)
            self._thread = None

    def _run(self) -> None:
        while not self._stop.is_set():
            self._stop.wait(timeout=_POLL_INTERVAL)
            if self._stop.is_set():
                break
            self._drain_once()

    def _drain_once(self) -> None:
        port = get_overlay_port()
        if not port:
            return
        if port != self._active_port:
            self._active_port = port
            self._last_packet_seq = 0
            self._last_packet_revision = 0
        if self._drain_pop_events_once(port):
            return
        if self._drain_runtime_packets_once(port):
            return
        reset_overlay_port()
        new_port = get_overlay_port()
        if not new_port or new_port == port:
            return
        self._active_port = new_port
        self._last_packet_seq = 0
        self._last_packet_revision = 0
        if not self._drain_pop_events_once(new_port):
            self._drain_runtime_packets_once(new_port)

    def _drain_pop_events_once(self, port: int) -> bool:
        url = _POP_URL_TEMPLATE.format(port=port)
        for _ in range(_MAX_POP_EVENTS_PER_DRAIN):
            outer = self._fetch_json(url, timeout=_POP_TIMEOUT)
            if outer is _FETCH_TIMEOUT_SENTINEL:
                # /api/pop is the intended low-latency event stream. A missed
                # short poll means "try again next tick", not "fall back to
                # slower snapshot endpoints" while the cursor is moving.
                return True
            if outer is None:
                return False
            if not isinstance(outer, dict):
                return False
            line = outer.get("line")
            if line is None:
                return True
            if isinstance(line, bytes):
                line = line.decode("utf-8")
            if not isinstance(line, str):
                _trace_ingress_error(TypeError("/api/pop line must be a JSON string or null"))
                continue
            try:
                payload = json.loads(line)
            except Exception as exc:
                _trace_ingress_error(exc)
                continue
            if not isinstance(payload, dict):
                _trace_ingress_error(TypeError("/api/pop line JSON must decode to an object"))
                continue
            self._publish_event_payload(payload)
        return True

    def _drain_runtime_packets_once(self, port: int) -> bool:
        outer = self._fetch_runtime_packet_snapshot(_INPUT_RUNTIME_PACKETS_URL_TEMPLATE.format(port=port))
        if outer is None:
            outer = self._fetch_runtime_packet_snapshot(_RUNTIME_PACKETS_URL_TEMPLATE.format(port=port))
            if outer is None:
                return False
        if not isinstance(outer, dict):
            return False
        packets = outer.get("packets")
        if not isinstance(packets, list):
            return False
        revision = int(outer.get("revision", 0) or 0)
        if revision and revision < self._last_packet_revision:
            self._last_packet_seq = 0
        self._last_packet_revision = max(self._last_packet_revision, revision)
        max_seen_seq = 0
        for packet in packets:
            if not isinstance(packet, dict):
                continue
            seq = int(packet.get("seq", 0) or 0)
            if seq > max_seen_seq:
                max_seen_seq = seq
            if seq <= self._last_packet_seq:
                continue
            if str(packet.get("kind", "")) != "input.event":
                continue
            payload = packet.get("payload")
            if isinstance(payload, dict):
                event_payload = self._extract_input_event_payload(payload)
                if event_payload is not None:
                    self._publish_event_payload(event_payload)
            self._last_packet_seq = max(self._last_packet_seq, seq)
        if max_seen_seq < self._last_packet_seq:
            self._last_packet_seq = max_seen_seq
        return True

    def _publish_event_payload(self, payload: dict[str, Any]) -> None:
        publish_ui_event_payload(payload)
        for sub in list(self._subs):
            try:
                sub(dict(payload))
            except Exception as exc:
                _trace_ingress_error(exc)

    @staticmethod
    def _extract_input_event_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
        wrapped = payload.get("event")
        if isinstance(wrapped, dict):
            return dict(wrapped)
        if isinstance(payload.get("event"), str):
            return dict(payload)
        return None

    def _fetch_runtime_packet_snapshot(self, url: str) -> dict[str, Any] | None:
        return self._fetch_json(url, timeout=_FETCH_TIMEOUT)

    def _fetch_json(self, url: str, *, timeout: float) -> dict[str, Any] | None:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                raw = resp.read()
            outer = json.loads(raw)
        except (TimeoutError, socket.timeout):
            return _FETCH_TIMEOUT_SENTINEL
        except urllib.error.URLError as exc:
            if isinstance(getattr(exc, "reason", None), (TimeoutError, socket.timeout)):
                return _FETCH_TIMEOUT_SENTINEL
            _trace_poll_error(url, exc)
            return None
        except Exception as exc:
            _trace_poll_error(url, exc)
            return None
        return outer if isinstance(outer, dict) else None


_global_poller: OverlayPoller | None = None
_poller_lock = threading.Lock()


def get_global_poller() -> OverlayPoller:
    global _global_poller
    with _poller_lock:
        if _global_poller is None:
            _global_poller = OverlayPoller()
        return _global_poller


def reset_global_poller() -> None:
    global _global_poller
    with _poller_lock:
        if _global_poller is not None:
            try:
                _global_poller.stop()
            except Exception:
                pass
        _global_poller = None
    reset_ui_event_ingress()


def start_event_poller() -> OverlayPoller:
    poller = get_global_poller()
    poller.start()
    return poller


def _trace_enabled() -> bool:
    raw = str(os.environ.get("VF_UI_TRACE_EVENTS", "") or "").strip().lower()
    return raw not in ("", "0", "false", "off", "no")


def _trace_ingress(evt: dict[str, Any]) -> None:
    if not _trace_enabled():
        return
    try:
        base = os.environ.get("LOCALAPPDATA", "") or ""
        if not base:
            return
        p = Path(base) / "vektor-flow" / "python-ui-events.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        event = str(evt.get("event", ""))
        frame = str(evt.get("frame_id", evt.get("frameId", "")) or "")
        widget = str(evt.get("widget_id", evt.get("widgetId", "")) or "")
        object_id = evt.get("object_id", "")
        simplex_id = evt.get("simplex_id", "")
        with p.open("a", encoding="utf-8") as f:
            f.write(
                f"{ts} ingress event={event} frame={frame} widget={widget} "
                f"object_id={object_id} simplex_id={simplex_id}\n"
            )
    except OSError:
        pass


def _trace_ingress_error(exc: Exception) -> None:
    if not _trace_enabled():
        return
    try:
        base = os.environ.get("LOCALAPPDATA", "") or ""
        if not base:
            return
        p = Path(base) / "vektor-flow" / "python-ui-events.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        with p.open("a", encoding="utf-8") as f:
            f.write(f"{ts} ingress subscriber error={type(exc).__name__}: {exc}\n")
    except OSError:
        pass


def _trace_poll_error(url: str, exc: Exception) -> None:
    if not _trace_enabled():
        return
    try:
        base = os.environ.get("LOCALAPPDATA", "") or ""
        if not base:
            return
        p = Path(base) / "vektor-flow" / "python-ui-events.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        with p.open("a", encoding="utf-8") as f:
            f.write(f"{ts} ingress poll error url={url} error={type(exc).__name__}: {exc}\n")
    except OSError:
        pass
