from pathlib import Path
import sys

from PIL import Image


def main() -> None:
    frame_directory = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    frame_paths = sorted(frame_directory.glob("[0-9][0-9]-*.png"))
    if len(frame_paths) < 2:
        raise RuntimeError("material gallery GIF requires at least two capture frames")
    frames = [Image.open(path).convert("RGBA") for path in frame_paths]
    destination.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        destination,
        save_all=True,
        append_images=frames[1:],
        duration=[900] * len(frames),
        loop=0,
        disposal=2,
        optimize=False,
    )


if __name__ == "__main__":
    main()
