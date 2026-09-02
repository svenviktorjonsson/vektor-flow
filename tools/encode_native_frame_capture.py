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
    if not isinstance(states, list) or len(states) != 2:
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
        output = destination / f"{index:02d}-{view}.png"
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
    }))


if __name__ == "__main__":
    main()
