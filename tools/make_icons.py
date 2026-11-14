#!/usr/bin/env python3
"""Render CarGlance's icons: the launcher and store icons (a white car on the
header blue, the shapes the dashboard drew with Poco before it moved to Piu,
which can't draw circles) and the dashboard glyphs (the paths of the design
mockups).

Writes resources/images/menu_icon.png (25x25, launcher icon bundled in the
.pbw), store/icon_48.png, store/icon_144.png (app store listing) and the
glyph sheets resources/images/{lock,plug,bolt,refresh,car,chips}.png.
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

GLYPH = 36  # dashboard glyphs: one 36 px square per state
CHIP = 14   # the small icons in the facts strip and the warning bar

GREEN = (0, 170, 85)
RED = (255, 85, 85)
YELLOW = (255, 170, 0)
WHITE_RGB = (255, 255, 255)
GRAY = (170, 170, 170)
DARK_GRAY = (85, 85, 85)
LIGHT_BLUE = (85, 170, 255)
BLACK = (0, 0, 0)

# The shapes below take SVG coordinates (continuous, y down), so the paths of
# the design mockups carry over as they are.


def seg(x0, y0, x1, y1, width):
    """A stroke of the given width with round caps."""
    dx, dy = x1 - x0, y1 - y0
    length2 = dx * dx + dy * dy or 1e-9
    r2 = (width / 2) ** 2

    def inside(px, py):
        t = max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / length2))
        qx, qy = x0 + t * dx - px, y0 + t * dy - py
        return qx * qx + qy * qy <= r2
    return inside


def polyline(points, width, closed=False):
    pts = points + [points[0]] if closed else points
    segs = [seg(*pts[i], *pts[i + 1], width) for i in range(len(pts) - 1)]
    return lambda px, py: any(s(px, py) for s in segs)


def polygon(points):
    """A filled polygon (even-odd rule)."""
    def inside(px, py):
        hit = False
        j = len(points) - 1
        for i in range(len(points)):
            xi, yi = points[i]
            xj, yj = points[j]
            if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
        return hit
    return inside


def angle_of(px, py, cx, cy):
    """Degrees clockwise from 12 o'clock."""
    return math.degrees(math.atan2(px - cx, cy - py)) % 360


def arc(cx, cy, r, width, start, end):
    """A stroked arc from start to end degrees, clockwise from 12 o'clock."""
    def inside(px, py):
        if abs(math.hypot(px - cx, py - cy) - r) > width / 2:
            return False
        a = angle_of(px, py, cx, cy)
        return start <= a <= end if start <= end else a >= start or a <= end
    return inside


def disc(cx, cy, r):
    return lambda px, py: (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def ellipse(cx, cy, rx, ry, rotation):
    c, s = math.cos(math.radians(rotation)), math.sin(math.radians(rotation))

    def inside(px, py):
        x, y = px - cx, py - cy
        u, v = x * c + y * s, -x * s + y * c
        return (u / rx) ** 2 + (v / ry) ** 2 <= 1
    return inside


def placed(shapes, ox, oy, scale=1.0):
    """Moves (and scales) shapes drawn in their own coordinates to ox, oy."""
    def move(shape):
        return lambda px, py: shape((px - ox) / scale, (py - oy) / scale)
    return [(move(shape), paint) for shape, paint in shapes]


# Lock, 26 x 30. The open shackle keeps its left leg and stops short of the
# right one.
def lock(locked):
    shackle = [(seg(7, 14, 7, 9, 3.5), "fg")]
    if locked:
        shackle += [(arc(13, 9, 6, 3.5, 270, 90), "fg"), (seg(19, 9, 19, 14, 3.5), "fg")]
    else:
        shackle += [(arc(13, 9, 6, 3.5, 270, 68), "fg")]
    return shackle + [
        (round_rect(3, 13, 20, 15, 2), "fg"),
        (rect(11.5, 18, 3, 5), "cut"),     # keyhole
    ]


# Bolt outline, 26 x 32.
BOLT = [(polyline([(16, 2), (6, 18), (15, 18), (11, 30), (21, 13), (12, 13)], 3, closed=True), "fg")]

# Plug outline, 26 x 30: prongs, a rounded head and the cable.
PLUG = [
    (seg(9, 2, 9, 9, 3), "fg"),
    (seg(17, 2, 17, 9, 3), "fg"),
    (seg(5, 9, 21, 9, 3), "fg"),
    (seg(21, 9, 21, 14, 3), "fg"),
    (seg(5, 9, 5, 14, 3), "fg"),
    (arc(13, 14, 8, 3, 90, 270), "fg"),
    (seg(13, 22, 13, 28, 3), "fg"),
]

# Circular arrow in a 24 x 24 box: an arc open towards the top right, its
# arrowhead a corner at the arc's end.
REFRESH = [
    (arc(12, 12, 8, 2.6, 135, 90), "fg"),
    (seg(20, 3, 20, 8, 2.6), "fg"),
    (seg(20, 8, 15, 8, 2.6), "fg"),
]

# Car from the front, 26 x 22, windscreen and headlights cut out.
CAR_FRONT = [
    (polygon([(5, 9), (7.5, 3), (18.5, 3), (21, 9), (23, 9), (23, 17), (21, 17), (21, 20), (18, 20),
              (18, 17), (8, 17), (8, 20), (5, 20), (5, 17), (3, 17), (3, 9)]), "fg"),
    (rect(8.5, 5, 9, 4), "cut"),
    (disc(7, 13, 1.6), "cut"),
    (disc(19, 13, 1.6), "cut"),
]

# Small icons, 14 x 14.
THERMOMETER = placed([
    (arc(5, 2, 2, 1.6, 270, 90), "fg"),
    (seg(7, 2, 7, 8.5, 1.6), "fg"),
    (seg(3, 2, 3, 8.5, 1.6), "fg"),
    (arc(5, 11, 3.2, 1.6, 38.7, 321.3), "fg"),
], 2, 0)

FAN = [(disc(7, 7, 1.3), "fg")] + [
    (ellipse(7 + 3.4 * math.sin(math.radians(a)), 7 - 3.4 * math.cos(math.radians(a)), 1.6, 2.9, a + 25), "fg")
    for a in (0, 90, 180, 270)
]

ODOMETER = placed([
    (arc(7, 7.71, 5.5, 1.6, 245.4, 114.6), "fg"),
    (seg(7, 8, 9.5, 5, 1.6), "fg"),
], 0, 1)

WARNING = [
    (polygon([(7, 1), (13, 12), (1, 12)]), "fg"),
    (rect(6.3, 4.5, 1.4, 4), "cut"),
    (rect(6.3, 9.3, 1.4, 1.4), "cut"),
]


def render_glyph(shapes, size, ss=8):
    """Coverage (0..1) per pixel of a size x size box."""
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
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


def sheet(*variants, size=GLYPH):
    """Stacks (shapes, color) variants into one image, at most four (Piu
    reaches only states 0 to 3 of a skin). Alpha is quantized to the watch's
    four levels."""
    pixels = []
    for shapes, color in variants:
        for row in render_glyph(shapes, size):
            pixels.append([color + (round(c * 3) * 85,) if c else CLEAR for c in row])
    return pixels


def columns(*sheets):
    """Puts sheets side by side, padding the shorter ones with transparency."""
    height = max(len(sh) for sh in sheets)
    return [
        [px for sh in sheets for px in (sh[y] if y < len(sh) else [CLEAR] * len(sh[0]))]
        for y in range(height)
    ]


if __name__ == "__main__":
    images = os.path.join(ROOT, "resources/images")
    # Row glyphs sit where the mockups put them in the 36 px box, which the
    # dashboard draws 4 px below a row's top at x 12.
    lock_on, lock_off = placed(lock(True), 1, 0), placed(lock(False), 1, 0)
    # States: locked, unlocked, unknown (the closed lock, dimmed).
    write_png(os.path.join(images, "lock.png"), sheet(
        (lock_on, GREEN), (lock_off, RED), (lock_on, DARK_GRAY)))
    # States: plugged in, not plugged in or unknown.
    plug = placed(PLUG, 1, -1)
    write_png(os.path.join(images, "plug.png"), sheet((plug, WHITE_RGB), (plug, GRAY)))
    write_png(os.path.join(images, "bolt.png"), sheet((placed(BOLT, 1, -2), YELLOW)))
    # Header glyphs: the refresh arrow at the left edge, the car right-aligned.
    # States: idle, refreshing.
    refresh = placed(REFRESH, 8, 7, 22 / 24)
    write_png(os.path.join(images, "refresh.png"), sheet((refresh, WHITE_RGB), (refresh, GRAY)))
    write_png(os.path.join(images, "car.png"), sheet((placed(CAR_FRONT, 2, 8), WHITE_RGB)))
    # The facts strip and the warning bar, in two columns (Piu variants):
    # Piu reaches only four states per skin. Column 0: thermometer, fan
    # (climate on), fan (climate off), odometer; column 1: warning (black on
    # the yellow bar).
    write_png(os.path.join(images, "chips.png"), columns(
        sheet((THERMOMETER, GRAY), (FAN, LIGHT_BLUE), (FAN, GRAY), (ODOMETER, GRAY), size=CHIP),
        sheet((WARNING, BLACK), size=CHIP)))

    write_png(os.path.join(ROOT, "resources/images/menu_icon.png"), render(
        25, CAR_PIXEL_W / 25, 0.16, 8, False, (CAR_PIXEL, CAR_PIXEL_W, CAR_PIXEL_CX, CAR_PIXEL_CY)))
    write_png(os.path.join(ROOT, "store/icon_48.png"), render(48, 0.72, 0.18, 8, True))
    write_png(os.path.join(ROOT, "store/icon_144.png"), render(144, 0.72, 0.18, 4, True))
