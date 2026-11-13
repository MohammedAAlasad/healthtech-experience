#!/usr/bin/env python3
"""Trim near-black / near-white borders from the Booth 03 radiographs.

Usage: python3 booth03/tools/trim_borders.py [--dry-run]
Needs Pillow (pip install pillow). Not used by the web page; run it after replacing images.

- Works on booth03/images/case01.jpg .. case10.jpg.
- The first run copies each original to booth03/images/_originals/ (git-ignored). Every run trims FROM that
  backup, so running it twice gives the same result (no repeated trimming, no extra JPEG generations).
- An edge row/column is "border" when >= 97% of its pixels are near-black (all channels <= 20) or near-white
  (all channels >= 235). Coloured marks such as red arrows are neither, so a row that contains them is content.
- Keeps a 2% margin around the content and never removes more than 25% of the width/height on any side.
- Images with nothing to trim are restored byte-for-byte from the backup (no re-encoding).
"""
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "images"
BACKUP = IMAGES / "_originals"
DARK, LIGHT = 20, 235          # near-black <= DARK, near-white >= LIGHT (every RGB channel)
BORDER_FRACTION = 0.97         # share of border-coloured pixels for a line to count as border
MARGIN = 0.02                  # keep 2% of the dimension around the content
MAX_SIDE = 0.25                # never remove more than 25% of the dimension on any side
JPEG_QUALITY = 85


def is_border_pixel(p):
    r, g, b = p[:3]
    return (r <= DARK and g <= DARK and b <= DARK) or (r >= LIGHT and g >= LIGHT and b >= LIGHT)


def border_line(px, coords):
    hits = sum(1 for xy in coords if is_border_pixel(px[xy]))
    return hits >= BORDER_FRACTION * len(coords)


def content_box(im):
    """(left, top, right, bottom) after trimming border lines, with margin and per-side limits applied."""
    w, h = im.size
    px = im.load()
    max_x, max_y = int(w * MAX_SIDE), int(h * MAX_SIDE)
    top = 0
    while top < max_y and border_line(px, [(x, top) for x in range(w)]):
        top += 1
    bottom = h
    while h - bottom < max_y and border_line(px, [(x, bottom - 1) for x in range(w)]):
        bottom -= 1
    left = 0
    while left < max_x and border_line(px, [(left, y) for y in range(top, bottom)]):
        left += 1
    right = w
    while w - right < max_x and border_line(px, [(right - 1, y) for y in range(top, bottom)]):
        right -= 1
    mx, my = round(w * MARGIN), round(h * MARGIN)
    return max(0, left - mx), max(0, top - my), min(w, right + mx), min(h, bottom + my)


def main(argv):
    dry = "--dry-run" in argv
    files = [IMAGES / f"case{n:02d}.jpg" for n in range(1, 11)]
    missing = [f.name for f in files if not f.is_file() and not (BACKUP / f.name).is_file()]
    if missing:
        print("ERROR: missing image(s): " + ", ".join(missing))
        return 1
    if not dry:
        BACKUP.mkdir(exist_ok=True)
    for f in files:
        src = BACKUP / f.name
        if not src.is_file():
            if dry:
                src = f
            else:
                shutil.copy2(f, src)
        im = Image.open(src).convert("RGB")
        box = content_box(im)
        w, h = im.size
        cut = (box[0], box[1], w - box[2], h - box[3])
        if box == (0, 0, w, h):
            msg = "no border found, unchanged"
            if not dry:
                shutil.copy2(src, f)
        else:
            out = im.crop(box)
            msg = f"trimmed l/t/r/b = {cut[0]}/{cut[1]}/{cut[2]}/{cut[3]} px -> {out.size[0]}x{out.size[1]}"
            if not dry:
                out.save(f, "JPEG", quality=JPEG_QUALITY, optimize=True)
        print(f"{f.name}: {w}x{h} {msg}" + (" (dry run)" if dry else ""))
    if not dry:
        print(f"Originals kept in {BACKUP.relative_to(ROOT.parent)}/ (git-ignored).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
