from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from vektorflow.physics_hard_discs import HardDisc, HardDiscWorld2D


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "examples" / "generated"
GIF_PATH = OUT_DIR / "physics_hard_disc_collision_proof.gif"
PNG_PATH = OUT_DIR / "physics_hard_disc_collision_proof_contact.png"

WORLD_W = 1.20
WORLD_H = 0.80
FPS = 24
SECONDS = 5.0
FRAME_COUNT = int(FPS * SECONDS)


def demo_discs() -> tuple[HardDisc, ...]:
    density = 1.0
    return (
        HardDisc(0.15, 0.18, 0.34, 0.20, 0.045, density),
        HardDisc(0.33, 0.16, 0.23, 0.30, 0.060, density),
        HardDisc(0.55, 0.16, -0.18, 0.34, 0.040, density),
        HardDisc(0.78, 0.20, -0.29, 0.24, 0.070, density),
        HardDisc(1.04, 0.18, -0.35, 0.20, 0.050, density),
        HardDisc(0.20, 0.50, 0.31, -0.25, 0.065, density),
        HardDisc(0.45, 0.45, 0.25, -0.23, 0.048, density),
        HardDisc(0.66, 0.53, -0.30, -0.28, 0.055, density),
        HardDisc(0.90, 0.48, -0.32, -0.18, 0.042, density),
        HardDisc(1.08, 0.63, -0.20, -0.31, 0.058, density),
    )


def sample_world() -> list:
    world = HardDiscWorld2D(demo_discs(), width=WORLD_W, height=WORLD_H)
    return [world.advance_to(i / FPS) for i in range(FRAME_COUNT)]


def density_color(density: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, (density - 0.5) / 1.5))
    return (int(34 + 120 * t), int(211 - 40 * t), int(238 - 150 * t))


def render_frame(snapshots: list, frame_index: int) -> Image.Image:
    width, height = 720, 520
    margin_x = 60
    top = 76
    scale = 500
    world_px_w = int(WORLD_W * scale)
    world_px_h = int(WORLD_H * scale)
    image = Image.new("RGB", (width, height), "#10161f")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()

    draw.text((margin_x, 24), "Event-driven hard-disc vertex collisions", fill="#e8eef7", font=font)
    draw.text((margin_x, 42), "10 filled impostor circles, constant density=1.0, frictionless elastic contacts", fill="#91a2b7", font=font)

    box = (margin_x, top, margin_x + world_px_w, top + world_px_h)
    draw.rectangle(box, fill="#16222c", outline="#e6edf5", width=3)

    for k in range(1, 6):
        x = margin_x + k * world_px_w / 6.0
        draw.line((x, top, x, top + world_px_h), fill="#22303b", width=1)
    for k in range(1, 4):
        y = top + k * world_px_h / 4.0
        draw.line((margin_x, y, margin_x + world_px_w, y), fill="#22303b", width=1)

    trail_steps = (18, 12, 6)
    trail_colors = ("#21444d", "#25626d", "#2a8790")
    for back, color in zip(trail_steps, trail_colors, strict=True):
        past_index = max(0, frame_index - back)
        for disc in snapshots[past_index].discs:
            cx = margin_x + disc.x * scale
            cy = top + (WORLD_H - disc.y) * scale
            rr = max(2.0, disc.radius * scale * 0.20)
            draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=color)

    snapshot = snapshots[frame_index]
    for index, disc in enumerate(snapshot.discs, start=1):
        cx = margin_x + disc.x * scale
        cy = top + (WORLD_H - disc.y) * scale
        rr = disc.radius * scale
        fill = density_color(disc.density)
        draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=fill, outline="#ecfeff", width=2)
        draw.text((cx - 4, cy - 4), str(index), fill="#08111a", font=font)
        vx = disc.vx * 70.0
        vy = -disc.vy * 70.0
        draw.line((cx, cy, cx + vx, cy + vy), fill="#f9fafb", width=1)

    energy = snapshot.kinetic_energy
    min_gap = snapshot.min_gap
    draw.text((margin_x, top + world_px_h + 20), f"t={snapshot.time:0.2f}s   kinetic energy={energy:0.6f}   min gap={min_gap:0.5f}", fill="#d9e4ef", font=font)
    draw.text((margin_x, top + world_px_h + 38), "Boundary is a hard wall. Positions are sampled analytically between queued collision events.", fill="#91a2b7", font=font)
    return image


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    snapshots = sample_world()
    frames = [render_frame(snapshots, i) for i in range(FRAME_COUNT)]
    frames[0].save(
        GIF_PATH,
        save_all=True,
        append_images=frames[1:],
        duration=int(1000 / FPS),
        loop=0,
        optimize=False,
    )

    sheet_indices = [0, FRAME_COUNT // 4, FRAME_COUNT // 2, 3 * FRAME_COUNT // 4]
    sheet = Image.new("RGB", (720 * 2, 520 * 2), "#10161f")
    for slot, frame_index in enumerate(sheet_indices):
        sheet.paste(frames[frame_index], ((slot % 2) * 720, (slot // 2) * 520))
    sheet.save(PNG_PATH)
    print(GIF_PATH)
    print(PNG_PATH)


if __name__ == "__main__":
    main()
