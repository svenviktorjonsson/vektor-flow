"""Runtime packet transport adapter.

The authoritative UI seam is the runtime packet contract. This module adapts
that contract onto two delivery paths:

- direct HTTP publish to the overlay runtime packet API when it is reachable
- file/session mirroring as the fallback transport
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import json
from pathlib import Path
import socket
import threading
import time
from typing import Any, Callable, Mapping, Protocol, Sequence
import urllib.error
import urllib.request

from vektorflow.ui.file_io import write_text_if_changed


EMPTY_SCENE_TEXT = "[]\n"
EMPTY_STATE_TEXT = "{}\n"
EMPTY_DISPLAY_TEXT = '{\n  "screen": [],\n  "frames": {},\n  "geom": {}\n}\n'
EMPTY_PACKETS_TEXT = "[]\n"
INPUT_RUNTIME_PACKETS_URL_TEMPLATE = "http://127.0.0.1:{port}/api/runtime-packets/input"
RUNTIME_PACKETS_URL_TEMPLATE = "http://127.0.0.1:{port}/api/runtime-packets"
POP_URL_TEMPLATE = "http://127.0.0.1:{port}/api/pop"
FETCH_TIMEOUT_SENTINEL = object()
POLL_INTERVAL = 0.001
FETCH_TIMEOUT = 0.25
POP_TIMEOUT = 0.01
MAX_POP_EVENTS_PER_DRAIN = 128


def empty_payload_files() -> dict[str, str]:
    return {
        "vf-display.json": EMPTY_DISPLAY_TEXT,
        "vkf-scene.json": EMPTY_SCENE_TEXT,
        "vf-ui-state.json": EMPTY_STATE_TEXT,
        "vf-runtime-packets.json": EMPTY_PACKETS_TEXT,
    }


@dataclass(frozen=True)
class RuntimePayloadIngressSnapshot:
    published_payloads: tuple[dict[str, Any], ...] = ()


class RuntimePayloadIngress:
    """Shared publish/subscribe ingress with bounded payload history."""

    def __init__(
        self,
        *,
        max_history: int = 512,
        before_publish: Callable[[dict[str, Any]], None] | None = None,
        error_reporter: Callable[[Exception], None] | None = None,
    ) -> None:
        self._subs: list[Callable[[dict[str, Any]], None]] = []
        self._history: deque[dict[str, Any]] = deque(maxlen=max_history)
        self._before_publish = before_publish
        self._report_error = error_reporter

    @property
    def subscribers(self) -> tuple[Callable[[dict[str, Any]], None], ...]:
        return tuple(self._subs)

    def subscribe(self, fn: Callable[[dict[str, Any]], None]) -> None:
        self._subs.append(fn)

    def publish(self, payload: dict[str, Any]) -> None:
        evt = dict(payload)
        if self._history and self._history[-1] == evt:
            return
        if self._before_publish is not None:
            self._before_publish(dict(evt))
        self._history.append(evt)
        for sub in list(self._subs):
            try:
                sub(dict(evt))
            except Exception as exc:
                if self._report_error is not None:
                    self._report_error(exc)

    def snapshot(self) -> RuntimePayloadIngressSnapshot:
        return RuntimePayloadIngressSnapshot(
            published_payloads=tuple(dict(evt) for evt in self._history)
        )


@dataclass(frozen=True)
class UIRuntimePacketPublishResult:
    packet_count: int
    direct_published: bool
    mirrored: bool
    endpoint: str | None = None
    error: str | None = None


class RuntimePacketDirectPublisher(Protocol):
    def __call__(
        self,
        packets: Sequence[Mapping[str, Any]],
    ) -> tuple[bool, str | None, str | None]: ...


@dataclass(frozen=True)
class UIRuntimePageNavigateResult:
    navigated: bool
    endpoint: str | None = None
    url: str | None = None
    error: str | None = None


class OverlayRuntimePollTransport:
    """Thin HTTP adapter for incoming overlay event/runtime packet polling."""

    def fetch_pop_response(self, port: int, *, timeout: float) -> dict[str, Any] | object | None:
        return self.fetch_json(POP_URL_TEMPLATE.format(port=port), timeout=timeout)

    def fetch_runtime_packet_snapshot(self, port: int, *, timeout: float) -> dict[str, Any] | None:
        outer = self.fetch_json(INPUT_RUNTIME_PACKETS_URL_TEMPLATE.format(port=port), timeout=timeout)
        if outer is None:
            outer = self.fetch_json(RUNTIME_PACKETS_URL_TEMPLATE.format(port=port), timeout=timeout)
        return outer if isinstance(outer, dict) else None

    def fetch_json(self, url: str, *, timeout: float) -> dict[str, Any] | object | None:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:  # noqa: S310
                raw = resp.read()
            outer = json.loads(raw)
        except (TimeoutError, socket.timeout):
            return FETCH_TIMEOUT_SENTINEL
        except urllib.error.URLError as exc:
            if isinstance(getattr(exc, "reason", None), (TimeoutError, socket.timeout)):
                return FETCH_TIMEOUT_SENTINEL
            return None
        except Exception:
            return None
        return outer if isinstance(outer, dict) else None


class OverlayPortResolver:
    """Transport-owned cached discovery for the live overlay HTTP port."""

    def __init__(self) -> None:
        self._discovered_port = 0
        self._lock = threading.Lock()

    def get_overlay_port(self) -> int:
        with self._lock:
            if self._discovered_port:
                return self._discovered_port
            port = self._read_overlay_port_file()
            if port:
                self._discovered_port = port
            return self._discovered_port

    def reset_overlay_port(self) -> None:
        with self._lock:
            self._discovered_port = 0

    def _read_overlay_port_file(self) -> int:
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


class OverlayRuntimeEventPoller:
    """Transport-owned poll loop for incoming overlay events."""

    def __init__(
        self,
        *,
        port_provider: Callable[[], int],
        port_reset: Callable[[], None],
        publish_event_payload: Callable[[dict[str, Any]], None],
        error_reporter: Callable[[Exception], None],
        transport: OverlayRuntimePollTransport | None = None,
    ) -> None:
        self._subs: list[Callable[[dict[str, Any]], None]] = []
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._active_port = 0
        self._last_packet_seq = 0
        self._last_packet_revision = 0
        self._transport = transport or OverlayRuntimePollTransport()
        self._port_provider = port_provider
        self._port_reset = port_reset
        self._publish = publish_event_payload
        self._report_error = error_reporter

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
            self._stop.wait(timeout=POLL_INTERVAL)
            if self._stop.is_set():
                break
            self._drain_once()

    def _drain_once(self) -> None:
        port = self._port_provider()
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
        self._port_reset()
        new_port = self._port_provider()
        if not new_port or new_port == port:
            return
        self._active_port = new_port
        self._last_packet_seq = 0
        self._last_packet_revision = 0
        if not self._drain_pop_events_once(new_port):
            self._drain_runtime_packets_once(new_port)

    def _drain_pop_events_once(self, port: int) -> bool:
        for _ in range(MAX_POP_EVENTS_PER_DRAIN):
            outer = self._transport.fetch_pop_response(port, timeout=POP_TIMEOUT)
            if outer is FETCH_TIMEOUT_SENTINEL:
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
                self._report_error(TypeError("/api/pop line must be a JSON string or null"))
                continue
            try:
                payload = json.loads(line)
            except Exception as exc:
                self._report_error(exc)
                continue
            if not isinstance(payload, dict):
                self._report_error(TypeError("/api/pop line JSON must decode to an object"))
                continue
            self._publish_event_payload(payload)
        return True

    def _drain_runtime_packets_once(self, port: int) -> bool:
        outer = self._transport.fetch_runtime_packet_snapshot(port, timeout=FETCH_TIMEOUT)
        if outer is None or not isinstance(outer, dict):
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
        self._publish(dict(payload))
        for sub in list(self._subs):
            try:
                sub(dict(payload))
            except Exception as exc:
                self._report_error(exc)

    @staticmethod
    def _extract_input_event_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
        wrapped = payload.get("event")
        if isinstance(wrapped, dict):
            return dict(wrapped)
        if isinstance(payload.get("event"), str):
            return dict(payload)
        return None


def build_overlay_runtime_event_poller(
    *,
    port_provider: Callable[[], int],
    port_reset: Callable[[], None],
    publish_event_payload: Callable[[dict[str, Any]], None],
    error_reporter: Callable[[Exception], None],
    transport: OverlayRuntimePollTransport | None = None,
) -> OverlayRuntimeEventPoller:
    return OverlayRuntimeEventPoller(
        port_provider=port_provider,
        port_reset=port_reset,
        publish_event_payload=publish_event_payload,
        error_reporter=error_reporter,
        transport=transport,
    )


class OverlayRuntimeEventService:
    """Shared lifecycle owner for ingress, port resolution, and global poller."""

    def __init__(
        self,
        *,
        ingress_factory: Callable[[], RuntimePayloadIngress],
        error_reporter: Callable[[Exception], None],
        poller_factory: Callable[[], OverlayRuntimeEventPoller] | None = None,
    ) -> None:
        self._ingress_factory = ingress_factory
        self._ingress = ingress_factory()
        self._error_reporter = error_reporter
        self._poller_factory = poller_factory
        self._port_resolver = OverlayPortResolver()
        self._global_poller: OverlayRuntimeEventPoller | None = None
        self._poller_lock = threading.Lock()

    def get_ingress(self) -> RuntimePayloadIngress:
        return self._ingress

    def publish_payload(self, payload: dict[str, Any]) -> None:
        self._ingress.publish(payload)

    def snapshot(self) -> RuntimePayloadIngressSnapshot:
        return self._ingress.snapshot()

    def reset_ingress(self) -> None:
        self._ingress = self._ingress_factory()

    def get_overlay_port(self) -> int:
        return self._port_resolver.get_overlay_port()

    def reset_overlay_port(self) -> None:
        self._port_resolver.reset_overlay_port()

    def _create_poller(self) -> OverlayRuntimeEventPoller:
        if self._poller_factory is not None:
            return self._poller_factory()
        return OverlayRuntimeEventPoller(
            port_provider=lambda: self.get_overlay_port(),
            port_reset=lambda: self.reset_overlay_port(),
            publish_event_payload=lambda payload: self.publish_payload(payload),
            error_reporter=self._error_reporter,
        )

    def get_global_poller(self) -> OverlayRuntimeEventPoller:
        with self._poller_lock:
            if self._global_poller is None:
                self._global_poller = self._create_poller()
            return self._global_poller

    def reset_global_poller(self, *, reset_ingress: bool = True) -> None:
        with self._poller_lock:
            if self._global_poller is not None:
                try:
                    self._global_poller.stop()
                except Exception:
                    pass
            self._global_poller = None
        if reset_ingress:
            self.reset_ingress()

    def start_event_poller(self) -> OverlayRuntimeEventPoller:
        poller = self.get_global_poller()
        poller.start()
        return poller


def _default_direct_publish(
    packets: Sequence[Mapping[str, Any]],
) -> tuple[bool, str | None, str | None]:
    from vektorflow.ui.bridge import clear_base_cache, vf_base_url

    try:
        base = vf_base_url(wait_seconds=1.0, poll_interval=0.05)
    except RuntimeError as exc:
        return False, None, str(exc)

    endpoint_base = base.rstrip()
    snapshot_endpoint = endpoint_base.rstrip("/") + "/api/runtime-packets"
    endpoint = endpoint_base.rstrip("/") + "/api/runtime-packets/append"
    try:
        first_seq = _next_runtime_packet_seq(snapshot_endpoint)
    except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError, TypeError) as exc:
        clear_base_cache()
        return False, snapshot_endpoint, str(exc)
    body = json.dumps({"packets": resequence_runtime_packets(packets, first_seq=first_seq)}).encode("utf-8")
    req = urllib.request.Request(  # noqa: S310
        endpoint,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=0.75) as response:  # noqa: S310
            status = int(getattr(response, "status", 200) or 200)
            response.read()
    except (OSError, urllib.error.URLError, ValueError) as exc:
        clear_base_cache()
        return False, endpoint, str(exc)
    if 200 <= status < 300:
        return True, endpoint, None
    clear_base_cache()
    return False, endpoint, f"overlay runtime packet API returned HTTP {status}"


def _next_runtime_packet_seq(snapshot_endpoint: str) -> int:
    req = urllib.request.Request(  # noqa: S310
        snapshot_endpoint,
        method="GET",
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=0.75) as response:  # noqa: S310
        snapshot = json.loads(response.read().decode("utf-8", errors="replace"))
    packets = snapshot.get("packets") if isinstance(snapshot, dict) else None
    if not isinstance(packets, list):
        return 1
    max_seq = 0
    for packet in packets:
        if not isinstance(packet, Mapping):
            continue
        seq = packet.get("seq")
        if isinstance(seq, bool):
            continue
        if isinstance(seq, (int, float)) and int(seq) == seq and seq > max_seq:
            max_seq = int(seq)
    return max_seq + 1


def resequence_runtime_packets(
    packets: Sequence[Mapping[str, Any]],
    *,
    first_seq: int,
) -> list[dict[str, Any]]:
    seq = max(1, int(first_seq))
    resequenced: list[dict[str, Any]] = []
    for packet in packets:
        next_packet = dict(packet)
        next_packet["seq"] = seq
        resequenced.append(next_packet)
        seq += 1
    return resequenced


def navigate_overlay_runtime_page(page_rel: str) -> UIRuntimePageNavigateResult:
    from vektorflow.ui.bridge import clear_base_cache, vf_base_url

    try:
        base = vf_base_url(wait_seconds=1.0, poll_interval=0.05)
    except RuntimeError as exc:
        return UIRuntimePageNavigateResult(navigated=False, error=str(exc))

    endpoint = base.rstrip("/") + "/api/push"
    clean_rel = _string_path(page_rel)
    url = base.rstrip("/") + "/" + clean_rel + "?v=" + str(time.time_ns())
    body = json.dumps({"op": "navigate", "url": url}).encode("utf-8")
    req = urllib.request.Request(  # noqa: S310
        endpoint,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=0.75) as response:  # noqa: S310
            status = int(getattr(response, "status", 200) or 200)
            response.read()
    except (OSError, urllib.error.URLError, ValueError) as exc:
        clear_base_cache()
        return UIRuntimePageNavigateResult(navigated=False, endpoint=endpoint, url=url, error=str(exc))
    if 200 <= status < 300:
        return UIRuntimePageNavigateResult(navigated=True, endpoint=endpoint, url=url)
    clear_base_cache()
    return UIRuntimePageNavigateResult(
        navigated=False,
        endpoint=endpoint,
        url=url,
        error=f"overlay push API returned HTTP {status}",
    )


def _string_path(page_rel: str) -> str:
    return str(page_rel or "").replace("\\", "/").lstrip("/")


class UIRuntimePacketTransport:
    def __init__(
        self,
        *,
        direct_publisher: RuntimePacketDirectPublisher | None = None,
    ) -> None:
        self._direct_publisher = direct_publisher or _default_direct_publish

    def publish_packets(
        self,
        packets: Sequence[Mapping[str, Any]],
        *,
        packets_text: str | None = None,
        warn_missing_root: Callable[[], None] | None = None,
        keep_packet_mirror: bool = False,
    ) -> UIRuntimePacketPublishResult:
        packet_count = len(packets)
        if packet_count == 0:
            return UIRuntimePacketPublishResult(packet_count=0, direct_published=False, mirrored=False)

        direct_published, endpoint, error = self._direct_publisher(packets)
        mirrored = False
        if keep_packet_mirror and packets_text is not None:
            mirrored = mirror_payload_file(
                "vf-runtime-packets.json",
                packets_text,
                mirror_root=True,
                warn_missing_root=warn_missing_root,
            )
        return UIRuntimePacketPublishResult(
            packet_count=packet_count,
            direct_published=direct_published,
            mirrored=mirrored,
            endpoint=endpoint,
            error=error,
        )


_global_transport = UIRuntimePacketTransport()


def get_ui_runtime_packet_transport() -> UIRuntimePacketTransport:
    return _global_transport


def set_ui_runtime_packet_transport(transport: UIRuntimePacketTransport) -> None:
    global _global_transport
    _global_transport = transport


def reset_ui_runtime_packet_transport() -> None:
    global _global_transport
    _global_transport = UIRuntimePacketTransport()


def publish_runtime_packets(
    packets: Sequence[Mapping[str, Any]],
    *,
    packets_text: str | None = None,
    warn_missing_root: Callable[[], None] | None = None,
    keep_packet_mirror: bool = False,
) -> UIRuntimePacketPublishResult:
    return _global_transport.publish_packets(
        packets,
        packets_text=packets_text,
        warn_missing_root=warn_missing_root,
        keep_packet_mirror=keep_packet_mirror,
    )


def mirror_payload_file(
    filename: str,
    text: str,
    *,
    mirror_root: bool = False,
    warn_missing_root: Callable[[], None] | None = None,
) -> bool:
    try:
        from vektorflow.ui.launch import find_vektorflow_repo_root
        from vektorflow.ui.session import ensure_ui_session, write_session_file

        root = find_vektorflow_repo_root()
        if root is None:
            if warn_missing_root is not None:
                warn_missing_root()
            return False
        session = ensure_ui_session(root)
        write_session_file(session, filename, text, mirror_root=mirror_root)
        return True
    except OSError:
        return False


def seed_payload_dir(
    directory: Path,
    *,
    session_html: str | None = None,
    seed_compatibility_payloads: bool = True,
) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    payloads = empty_payload_files()
    if not seed_compatibility_payloads:
        payloads = {"vf-runtime-packets.json": payloads["vf-runtime-packets.json"]}
    for filename, text in payloads.items():
        write_text_if_changed(directory / filename, text)
    if session_html is not None:
        write_text_if_changed(directory / "vkf-scene.html", session_html)
