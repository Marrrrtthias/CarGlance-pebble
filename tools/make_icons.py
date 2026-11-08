#!/usr/bin/env python3
"""Render CarGlance's icons from the car glyph used by drawCar() in
src/embeddedjs/main.js: a white car on the blue header color.

Writes resources/images/menu_icon.png (25x25, launcher icon bundled in the
.pbw) and store/icon_48.png, store/icon_144.png (app store listing).
No dependencies beyond the Python standard library.

    python3 tools/make_icons.py
"""
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

WHITE = (255, 255, 255, 255)
BLUE = (0, 85, 170, 255)  # header blue in main.js
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


# drawCar(0, 0, white, blue), shape for shape, in paint order.
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


if __name__ == "__main__":
    write_png(os.path.join(ROOT, "resources/images/menu_icon.png"), render(
        25, CAR_PIXEL_W / 25, 0.16, 8, False, (CAR_PIXEL, CAR_PIXEL_W, CAR_PIXEL_CX, CAR_PIXEL_CY)))
    write_png(os.path.join(ROOT, "store/icon_48.png"), render(48, 0.72, 0.18, 8, True))
    write_png(os.path.join(ROOT, "store/icon_144.png"), render(144, 0.72, 0.18, 4, True))
