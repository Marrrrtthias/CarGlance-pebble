#!/usr/bin/env python3
"""Render CarGlance's icons: the launcher and store icons (a white car on the
header blue) and the dashboard glyphs. The shapes are those the dashboard drew
with Poco before it moved to Piu, which can't draw circles.

Writes resources/images/menu_icon.png (25x25, launcher icon bundled in the
.pbw), store/icon_48.png, store/icon_144.png (app store listing) and the
glyph sheets resources/images/{lock,plug,bolt,refresh,car}.png.
No dependencies beyond the Python standard library.

    python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

WHITE = (255, 255, 255, 255)
BLUE = (0, 85, 170, 255)  # header blue in src/embeddedjs/windows/dashboard.js
CLEAR = (0, 0, 0, 0)


def round_rect(x, y, w, h, r):
    def inside(px, py):
        qx = min(max(px, x + r), x + w - r)
        qy = min(max(py, y + r), y + h - r)
        return (px - qx) ** 2 + (py - qy) ** 2 <= r * r and x <= px <= x + w and y <= py <= y + h
    return inside


def rect(x, y, w, h):
    return lambda px, py: x <= px <= x + w and y <= py <= y + h


def circle(cx, cy, r, poco=True):
    # Poco centers circles on a pixel, so the continuous center is +0.5.
    if poco:
        cx, cy, r = cx + 0.5, cy + 0.5, r + 0.5
    return lambda px, py: (px - cx) ** 2 + (py - cy) ** 2 <= r * r


# The header's car (formerly drawCar() in main.js), shape for shape, in paint order.
CAR = [
    (round_rect(-8, -9, 16, 9, 3), "fg"),    # cabin
    (rect(-5, -6, 4, 5), "bg"),              # windows
    (rect(1, -6, 4, 5), "bg"),
    (round_rect(-13, -1, 26, 9, 3), "fg"),   # body
    (circle(-7, 8, 4), "bg"),                # wheel arches
    (circle(7, 8, 4), "bg"),
    (circle(-7, 8, 3), "fg"),                # wheels
    (circle(7, 8, 3), "fg"),
]
# Glyph bounds in glyph units: x -13..13, y -9..13.
CAR_W, CAR_CX, CAR_CY = 26.0, 0.0, 2.0

# The same car fitted to whole pixels for the 25x25 launcher icon, where
# scaling the glyph above would close the 1px gaps around the wheels.
CAR_PIXEL = [
    (round_rect(-6.5, -8, 13, 8, 2), "fg"),     # cabin
    (rect(-4.5, -6, 4, 4), "bg"),               # windows
    (rect(0.5, -6, 4, 4), "bg"),
    (round_rect(-11.5, -1, 23, 8, 2), "fg"),    # body
    (circle(-6, 7.5, 3.5, False), "bg"),        # wheel arches
    (circle(6, 7.5, 3.5, False), "bg"),
    (circle(-6, 7.5, 2.5, False), "fg"),        # wheels
    (circle(6, 7.5, 2.5, False), "fg"),
]
# Bounds: x -11.5..11.5, y -8..11.
CAR_PIXEL_W, CAR_PIXEL_CX, CAR_PIXEL_CY = 23.0, 0.0, 1.5


def render(size, car_frac, corner_frac, ss, antialias, glyph=None):
    """car_frac: car width relative to the icon; corner_frac: tile corner
    radius relative to the icon (0 = square)."""
    car, car_w, car_cx, car_cy = glyph or (CAR, CAR_W, CAR_CX, CAR_CY)
    scale = size * car_frac / car_w
    tile = round_rect(0, 0, size, size, size * corner_frac) if corner_frac else rect(0, 0, size, size)
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    px = x + (sx + 0.5) / ss
                    py = y + (sy + 0.5) / ss
                    if not tile(px, py):
                        c = CLEAR
                    else:
                        gx = (px - size / 2) / scale + car_cx
                        gy = (py - size / 2) / scale + car_cy
                        c = BLUE
                        for shape, paint in car:
                            if shape(gx, gy):
                                c = WHITE if paint == "fg" else BLUE
                    for i in range(4):
                        acc[i] += c[i]
            n = ss * ss
            px = [round(v / n) for v in acc]
            if not antialias:
                # Snap to the nearest of the three colors (no blending), so the
                # icon stays crisp in the watch's 64-color palette.
                px = min((CLEAR, BLUE, WHITE), key=lambda c: sum((a - b) ** 2 for a, b in zip(c, px)))
            row.append(tuple(px))
        pixels.append(row)
    return pixels


def write_png(path, pixels):
    h, w = len(pixels), len(pixels[0])
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in pixels)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


# ---------------------------------------------------------------------------
# Dashboard glyphs: one color with alpha coverage, so they draw on any
# background. Holes (keyhole, car windows) are transparent. A glyph's color
# variants are stacked vertically in one sheet and picked in the watch app as
# Piu skin states (src/embeddedjs/windows/dashboard.js).

GLYPH = 36

GREEN = (0, 170, 85)
RED = (255, 85, 85)
YELLOW = (255, 170, 0)
WHITE_RGB = (255, 255, 255)
GRAY = (170, 170, 170)
DARK_GRAY = (85, 85, 85)


def line(x0, y0, x1, y1, width):
    """A stroke of the given width between pixel centers, with round caps."""
    x0, y0, x1, y1 = x0 + 0.5, y0 + 0.5, x1 + 0.5, y1 + 0.5
    dx, dy = x1 - x0, y1 - y0
    length2 = dx * dx + dy * dy
    r2 = (width / 2) ** 2

    def inside(px, py):
        t = max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / length2))
        qx, qy = x0 + t * dx - px, y0 + t * dy - py
        return qx * qx + qy * qy <= r2
    return inside


def sector(cx, cy, r, start, end):
    """A filled circle limited to angles start..end, in degrees clockwise
    from 12 o'clock."""
    disc = circle(cx, cy, r)
    cx, cy = cx + 0.5, cy + 0.5

    def inside(px, py):
        angle = math.degrees(math.atan2(px - cx, cy - py)) % 360
        return disc(px, py) and start <= angle <= end
    return inside


def lock(locked):
    cx = 18
    shackle_y = 13 if locked else 8
    shapes = [(circle(cx, shackle_y, 10), "fg"), (circle(cx, shackle_y, 5), "cut")]
    if not locked:
        # Cut the left leg so it reads as an open shackle.
        shapes.append((rect(cx - 10, shackle_y, 6, 16 - shackle_y), "cut"))
    return shapes + [
        (rect(6, 15, 24, 19), "fg"),       # body
        (circle(cx, 23, 3), "cut"),        # keyhole
        (rect(cx - 1, 24, 3, 6), "cut"),
    ]


BOLT = [
    (line(24, 2, 12, 19, 4), "fg"),
    (line(12, 19, 24, 17, 4), "fg"),
    (line(24, 17, 12, 34, 4), "fg"),
]

PLUG = [
    (rect(11, 2, 3, 9), "fg"),                # prongs
    (rect(23, 2, 3, 9), "fg"),
    (round_rect(7, 10, 23, 14, 4), "fg"),
    (rect(16, 24, 5, 11), "fg"),              # cable
]

# Circular arrow, its arrowhead at 12 o'clock pointing clockwise.
REFRESH = [
    (sector(18, 18, 11, 70, 360), "fg"),
    (circle(18, 18, 7), "cut"),
    (line(23, 9, 17, 3, 3), "fg"),
    (line(23, 9, 17, 15, 3), "fg"),
]


def car_glyph():
    # The launcher car (CAR above) centered on 18, 17, its windows cut out.
    def moved(shape):
        return lambda px, py: shape(px - 18, py - 17)
    return [(moved(shape), "fg" if paint == "fg" else "cut") for shape, paint in CAR]


def render_glyph(shapes, ss=8):
    """Coverage (0..1) per pixel of a GLYPH x GLYPH box."""
    rows = []
    for y in range(GLYPH):
        row = []
        for x in range(GLYPH):
            hits = 0
            for sy in range(ss):
                for sx in range(ss):
                    px, py = x + (sx + 0.5) / ss, y + (sy + 0.5) / ss
                    on = False
                    for shape, paint in shapes:
                        if shape(px, py):
                            on = paint == "fg"
                    hits += on
            row.append(hits / (ss * ss))
        rows.append(row)
    return rows


def sheet(*variants):
    """Stacks (shapes, color) variants into one image. Alpha is quantized to
    the watch's four levels."""
    pixels = []
    for shapes, color in variants:
        for row in render_glyph(shapes):
            pixels.append([color + (round(c * 3) * 85,) if c else CLEAR for c in row])
    return pixels


if __name__ == "__main__":
    images = os.path.join(ROOT, "resources/images")
    # States: locked, unlocked, unknown (the closed lock, dimmed).
    write_png(os.path.join(images, "lock.png"), sheet(
        (lock(True), GREEN), (lock(False), RED), (lock(True), DARK_GRAY)))
    # States: plugged in, not plugged in or unknown.
    write_png(os.path.join(images, "plug.png"), sheet((PLUG, WHITE_RGB), (PLUG, DARK_GRAY)))
    write_png(os.path.join(images, "bolt.png"), sheet((BOLT, YELLOW)))
    # States: idle, refreshing.
    write_png(os.path.join(images, "refresh.png"), sheet((REFRESH, WHITE_RGB), (REFRESH, GRAY)))
    write_png(os.path.join(images, "car.png"), sheet((car_glyph(), WHITE_RGB)))

    write_png(os.path.join(ROOT, "resources/images/menu_icon.png"), render(
        25, CAR_PIXEL_W / 25, 0.16, 8, False, (CAR_PIXEL, CAR_PIXEL_W, CAR_PIXEL_CX, CAR_PIXEL_CY)))
    write_png(os.path.join(ROOT, "store/icon_48.png"), render(48, 0.72, 0.18, 8, True))
    write_png(os.path.join(ROOT, "store/icon_144.png"), render(144, 0.72, 0.18, 4, True))
