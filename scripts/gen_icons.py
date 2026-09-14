"""FormFaker extension icon generator.

Draws the icon once at 512px (4x supersample) with Pillow + numpy, then
downsamples to the four sizes Chrome MV3 requires (16/32/48/128) with true
alpha transparency. Re-run after tweaking the geometry constants below:

    python3 scripts/gen_icons.py

Requires: Pillow, numpy (both already present in the dev environment).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "icons"
SIZES = [16, 32, 48, 128]

BASE = 128  # design coordinate space
SS = 4      # supersample factor -> draw at 512
CANVAS = BASE * SS

# --- palette -------------------------------------------------------------
BG_TOP = (79, 140, 255)     # azure
BG_BOTTOM = (122, 77, 246)  # violet
CARD = (255, 255, 255)
BAR = (79, 70, 229)         # indigo field bars
BAR_ACCENT = (34, 211, 238) # cyan "filled/valid" bar
SPARK = (255, 210, 74)      # gold magic sparkle

# --- geometry (in BASE units) -------------------------------------------
BADGE_R = 30
CARD_BOX = (36, 30, 92, 100)  # x0, y0, x1, y1
CARD_R = 9
BAR_R = 5
BARS = [
    (45, 44, 83, 54, BAR),
    (45, 61, 73, 71, BAR),
    (45, 78, 87, 88, BAR_ACCENT),
]
SPARK_C = (102, 25)
SPARK_R = 14


def s(v: float) -> float:
    """Scale a BASE-unit coordinate to the supersampled canvas."""
    return v * SS


def diagonal_gradient(size: int, c1: tuple, c2: tuple) -> Image.Image:
    """Top-left -> bottom-right linear gradient as an RGB image."""
    xs = np.linspace(0.0, 1.0, size, dtype=np.float32)
    t = (xs[:, None] + xs[None, :]) / 2.0  # diagonal ramp 0..1
    a = np.asarray(c1, dtype=np.float32)[None, None, :]
    b = np.asarray(c2, dtype=np.float32)[None, None, :]
    rgb = a + (b - a) * t[..., None]
    return Image.fromarray(rgb.astype(np.uint8), "RGB")


def star_points(cx: float, cy: float, r_outer: float, r_inner: float) -> list:
    """4-point twinkle: outer vertices on the axes, inner on the diagonals."""
    pts = []
    for k in range(8):
        ang = math.radians(-90 + k * 45)
        rad = r_outer if k % 2 == 0 else r_inner
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    return pts


def draw_master() -> Image.Image:
    grad = diagonal_gradient(CANVAS, BG_TOP, BG_BOTTOM).convert("RGBA")

    # rounded-square alpha mask for the badge
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, CANVAS - 1, CANVAS - 1], radius=s(BADGE_R), fill=255
    )
    badge = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    badge.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(badge)

    # white form card
    d.rounded_rectangle(
        [s(CARD_BOX[0]), s(CARD_BOX[1]), s(CARD_BOX[2]), s(CARD_BOX[3])],
        radius=s(CARD_R),
        fill=CARD,
    )

    # field bars
    for x0, y0, x1, y1, color in BARS:
        d.rounded_rectangle(
            [s(x0), s(y0), s(x1), s(y1)], radius=s(BAR_R), fill=color
        )

    # gold sparkle overlapping the top-right corner
    d.polygon(
        star_points(s(SPARK_C[0]), s(SPARK_C[1]), s(SPARK_R), s(SPARK_R * 0.30)),
        fill=SPARK,
    )

    return badge


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    master = draw_master()
    for size in SIZES:
        img = master.resize((size, size), Image.LANCZOS)
        img.save(OUT_DIR / f"icon{size}.png")
        print(f"wrote public/icons/icon{size}.png")

    # contact-sheet preview on light + dark, for visual QA (kept out of public/
    # so it never ships inside the extension package)
    preview = build_preview(master)
    preview_path = ROOT / "docs" / "icon-preview.png"
    preview.save(preview_path)
    print(f"wrote {preview_path.relative_to(ROOT)}")


def build_preview(master: Image.Image) -> Image.Image:
    pad, cell = 24, 160
    label_h = 28
    w = pad * 2 + cell * len(SIZES)
    h = pad * 2 + (cell + label_h) * 2
    sheet = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    dd = ImageDraw.Draw(sheet)
    dd.rectangle([0, h // 2, w, h], fill=(24, 26, 32, 255))  # dark bottom band
    for i, size in enumerate(SIZES):
        icon = master.resize((size, size), Image.LANCZOS)
        x = pad + i * cell
        for row, cy in enumerate((pad + cell // 2, h // 2 + pad + cell // 2)):
            box = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            box.paste(icon, (0, 0))
            sheet.alpha_composite(box, (x + (cell - size) // 2, cy - size // 2))
        dd.text((x + cell // 2 - 12, pad + cell + 2), f"{size}px", fill=(60, 60, 60))
        dd.text(
            (x + cell // 2 - 12, h // 2 + pad + cell + 2), f"{size}px", fill=(220, 220, 220)
        )
    return sheet


if __name__ == "__main__":
    main()
