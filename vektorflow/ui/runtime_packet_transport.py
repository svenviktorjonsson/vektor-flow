"""Runtime packet transport adapter.

The authoritative UI seam is the runtime packet contract. This module adapts
that contract onto two delivery paths:

- direct HTTP publish to the overlay runtime packet API when it is reachable
- file/session mirroring as the fallback transport
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import time
from typing import Any, Callable, Mapping, Protocol, Sequence
import urllib.error
import urllib.request

from vektorflow.ui.file_io import write_text_if_changed


EMPTY_SCENE_TEXT = "[]\n"
EMPTY_STATE_TEXT = "{}\n"
EMPTY_DISPLAY_TEXT = '{\n  "screen": [],\n  "frames": {},\n  "geom": {}\n}\n'
EMPTY_PACKETS_TEXT = "[]\n"


def empty_payload_files() -> dict[str, str]:
    return {
        "vf-display.json": EMPTY_DISPLAY_TEXT,
        "vkf-scene.json": EMPTY_SCENE_TEXT,
        "vf-ui-state.json": EMPTY_STATE_TEXT,
        "vf-runtime-packets.json": EMPTY_PACKETS_TEXT,
    }


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
) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for filename, text in empty_payload_files().items():
        write_text_if_changed(directory / filename, text)
    if session_html is not None:
        write_text_if_changed(directory / "vkf-scene.html", session_html)
