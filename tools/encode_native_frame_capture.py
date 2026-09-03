from __future__ import annotations

import base64
import json
from pathlib import Path
import sys

from PIL import Image


def main() -> None:
    evidence_path = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    if evidence.get("schema") != "vektor-flow/native-frame-media-capture-v1":
        raise RuntimeError("native frame capture schema is invalid")
    if evidence.get("status") != "ok" or evidence.get("capture_api") != "Frame.capture":
        raise RuntimeError("native Frame.capture did not complete")
    if evidence.get("boundary") != "frame-internal":
        raise RuntimeError("native capture crossed the frame boundary")
    states = evidence.get("states")
    playback = evidence.get("playback")
    if playback and playback.get("mode") == "repeat":
        frame_count = int(playback.get("sample_count", 0))
        frame_directory = evidence_path.parent / f"{evidence_path.stem}-frames"
        if frame_count < 2 or frame_count > 360:
            raise RuntimeError("native repeat capture frame count is invalid")
        states = []
        for index in range(frame_count):
            frame_evidence = json.loads(
                (frame_directory / f"{index:03d}.json").read_text(encoding="utf-8")
            )
            if (
                frame_evidence.get("type") != "vf_native_frame_media_capture_frame_v1"
                or frame_evidence.get("sample_index") != index
            ):
                raise RuntimeError(f"native repeat capture frame {index} is invalid")
            states.append(frame_evidence.get("state"))
    elif not isinstance(states, list) or len(states) != 2:
        raise RuntimeError("material gallery requires exactly two camera states")

    destination.mkdir(parents=True, exist_ok=True)
    encoded = []
    for index, state in enumerate(states):
        width = int(state["width"])
        height = int(state["height"])
        rgba = base64.b64decode(state["rgba_base64"], validate=True)
        if width <= 0 or height <= 0 or len(rgba) != width * height * 4:
            raise RuntimeError("native Frame.capture RGBA payload is malformed")
        view = str(state["view"])
        if playback and view != f"orbit-degree-{index:03d}":
            raise RuntimeError(f"native repeat capture view {index} is invalid")
        output = destination / f"{index:03d}-{view}.png"
        Image.frombytes("RGBA", (width, height), rgba).save(output, format="PNG")
        encoded.append({
            "view": view,
            "file": output.name,
            "width": width,
            "height": height,
            "checksum": state["checksum"],
        })

    print(json.dumps({
        "captureApi": evidence["capture_api"],
        "execution": "native hidden WebView2/WebGPU host",
        "boundary": evidence["boundary"],
        "states": encoded,
        "still": encoded[-1]["file"],
        "playback": playback,
    }))


if __name__ == "__main__":
    main()
