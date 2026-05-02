"""Host bootstrap manifest helpers for UI startup."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


HOST_MANIFEST_SCHEMA = "vektor-flow/host-bootstrap"
HOST_MANIFEST_VERSION = 1
HOST_MANIFEST_FILENAME = "vf-host-bootstrap.json"


def build_host_bootstrap_manifest(
    launch_mode: str,
) -> dict[str, Any]:
    return {
        "schema": HOST_MANIFEST_SCHEMA,
        "version": HOST_MANIFEST_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "launch_mode": launch_mode,
        "files": {
            "display": {
                "filename": "vf-display.json",
                "path": "vf-display.json",
                "url": "/vf-display.json",
            },
            "scene": {
                "filename": "vkf-scene.json",
                "path": "vkf-scene.json",
                "url": "/vkf-scene.json",
            },
            "ui_state": {
                "filename": "vf-ui-state.json",
                "path": "vf-ui-state.json",
                "url": "/vf-ui-state.json",
            },
        },
        "transport": {
            "mode": launch_mode,
            "ui_state_endpoint": "/vf-ui-state.json",
            "events_endpoint": "/vf-events.json",
        },
    }


def write_host_manifest_text(manifest: dict[str, Any]) -> str:
    return json.dumps(manifest, indent=2) + "\n"


def write_host_bootstrap_manifest(root: Path, manifest: dict[str, Any]) -> Path:
    root_dir = Path(root).resolve()
    out = root_dir / "web" / "vf-ui" / HOST_MANIFEST_FILENAME
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(write_host_manifest_text(manifest), encoding="utf-8")
    return out
