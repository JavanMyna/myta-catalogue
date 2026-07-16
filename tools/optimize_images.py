#!/usr/bin/env python3
# ============================================================
# optimize_images.py — strip metadata, resize, convert to WebP.
#
# Usage
#   python tools/optimize_images.py                                    (defaults)
#   python tools/optimize_images.py --input images/original --output images/optimized
#   python tools/optimize_images.py --max-size 1200 --quality 80
#
# Defaults:
#   --input    images/original
#   --output   images/optimized
#   --max-size 1200    (longest-side cap, no upscale)
#   --quality  80      (WebP quality 0-100)
#
# Pipeline (per file):
#   1. Strip metadata — rebuild image from pixel data only; no EXIF/XMP
#      survives. This also discards the orientation tag, but we compensate
#      by applying Pillow's built-in EXIF orientation BEFORE stripping
#      (ImageOps.exif_transpose), so the output is always correctly rotated
#      without carrying the tag forward.
#   2. Resize — if longest side > max_size, scale down proportionally.
#      Preserves aspect ratio. Never upscales.
#   3. Convert to WebP — Pillow's WebP encoder with method=6 for better
#      compression at the same quality setting.
#   4. Copy to --output, preserving relative subfolder structure.
#
# Non-destructive: original files are never touched.
# ============================================================

import argparse
import os
import sys

from PIL import Image, ImageOps
from PIL.Image import DecompressionBombError

# ---------------------------------------------------------------------------
# Supported input formats (extensions we try to open)
# ---------------------------------------------------------------------------
SUPPORTED = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff"}
BOMB_LIMIT = 400_000_000   # 400 MP — generous enough for a 9k panorama


def _human_size(n_bytes):
    """Return a human-readable size string, e.g. '1.23 MB'."""
    if n_bytes >= 1_048_576:
        return f"{n_bytes / 1_048_576:.2f} MB"
    if n_bytes >= 1024:
        return f"{n_bytes / 1024:.2f} KB"
    return f"{n_bytes} B"


# ---------------------------------------------------------------------------
# Per-file pipeline
# ---------------------------------------------------------------------------
def process_one(src, dst_dir, max_size, quality):
    """
    Process a single image:
      - strip metadata (after applying EXIF orientation)
      - resize (no upscale, cap longest side at max_size)
      - save as WebP in dst_dir, mirroring the subfolder structure.

    Returns a dict {src, dest, src_bytes, dest_bytes, skipped, error}.
    """
    result = {"src": src, "dest": None, "src_bytes": 0, "dest_bytes": 0,
              "skipped": False, "error": None}

    ext = os.path.splitext(src)[1].lower()
    if ext not in SUPPORTED:
        result["skipped"] = True
        result["error"] = f"unsupported format ({ext})"
        return result

    # ---- 1. Open & orient ------------------------------------------------
    try:
        im = Image.open(src)
    except Exception as e:
        result["error"] = f"cannot open: {type(e).__name__}: {e}"
        return result

    try:
        # Apply EXIF orientation BEFORE we strip metadata, so the pixel
        # data is correctly rotated. After this, the .info dict is irrelevant
        # because we rebuild from pixels only.
        im = ImageOps.exif_transpose(im)
    except Exception:
        # Some images (non-JPEG, or corrupt EXIF) throw here; safe to
        # continue without orientation correction.
        pass

    # ---- 2. Strip metadata -----------------------------------------------
    # Build a new RGB image from pixel data only. This discards every
    # info/EXIF dict entry, mode metadata, etc. — full strip.
    if im.mode in ("1", "L", "P", "PA"):
        # Thumbnails / indexed-palette images; convert to RGB first
        # so the WebP encoder gets 3 channels.
        im = im.convert("RGB")
    elif im.mode == "RGBA":
        # Alpha channel preserved (PNG transparencies, etc.).
        pass
    elif im.mode == "LA":
        im = im.convert("RGBA")
    elif im.mode == "RGB":
        pass
    elif im.mode == "CMYK":
        im = im.convert("RGB")
    elif im.mode.startswith("I") or im.mode == "F":
        # Integer/Float depth maps; convert to 8-bit RGB for WebP.
        im = im.convert("RGB")
    else:
        # Unknown mode — best-effort convert to RGB.
        im = im.convert("RGB")

    # ---- 3. Resize -------------------------------------------------------
    w, h = im.size
    if w <= max_size and h <= max_size:
        # Already small enough — no resize needed (no upscale).
        pass
    else:
        longest = max(w, h)
        ratio = max_size / longest
        new_w = round(w * ratio)
        new_h = round(h * ratio)
        try:
            im = im.resize((new_w, new_h), Image.LANCZOS)
        except DecompressionBombError:
            # Unlikely after the transpose above, but guard.
            result["error"] = "DecompressionBombError during resize"
            return result

    # ---- 4. Save as WebP -------------------------------------------------
    # Build the output path preserving subfolder structure. We get the
    # path component *after* the input root by way of computing the
    # relative path from root_dir at the caller level. (See main.)
    rel = os.path.relpath(src, "")
    base = os.path.splitext(os.path.basename(rel))[0]
    dest = os.path.join(dst_dir, os.path.dirname(rel), base + ".webp")
    result["dest"] = dest

    os.makedirs(os.path.dirname(dest), exist_ok=True)

    # Pillow's WebP save parameters:
    #   quality  — 0 (worst) to 100 (best); 80 is a strong default.
    #   method   — 0 (fast) to 6 (slow, smallest file). 6 gives the best
    #              ratio without wasting CPU.
    #   lossless — False (we trade a tiny quality loss for big size savings).
    try:
        im.save(dest, "webp", quality=quality, method=6)
    except OSError as e:
        # Some uncommon sub-formats of TIFF/GIF fall through; catch.
        result["error"] = f"WebP save failed: {e}"
        return result

    result["src_bytes"] = os.path.getsize(src)
    result["dest_bytes"] = os.path.getsize(dest)
    im.close()
    return result


# ---------------------------------------------------------------------------
# Main driver
# ---------------------------------------------------------------------------
def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Strip metadata, resize, and convert images to WebP."
    )
    parser.add_argument(
        "--input", default="images/original",
        help="Root folder to scan (default: images/original)"
    )
    parser.add_argument(
        "--output", default="images/optimized",
        help="Output root folder (default: images/optimized)"
    )
    parser.add_argument(
        "--max-size", type=int, default=1200,
        help="Cap the longest side at this pixel count (default: 1200)"
    )
    parser.add_argument(
        "--quality", type=int, default=80,
        help="WebP quality 0-100 (default: 80)"
    )
    args = parser.parse_args(argv)

    src_root = os.path.abspath(args.input)
    dst_root = os.path.abspath(args.output)

    if not os.path.isdir(src_root):
        print(f"optimize_images.py: input folder not found: {src_root}")
        print("Create an images/original/ folder with your source images, or pass --input.")
        return 2

    # Respect the DecompressionBomb limit set by Part A (audit_exif.py);
    # bump gently so that honest high-res photos don't trip it.
    Image.MAX_IMAGE_PIXELS = BOMB_LIMIT

    print(f"Source:   {src_root}")
    print(f"Output:   {dst_root}")
    print(f"Max side: {args.max_size}px  |  Quality: {args.quality}")
    print()

    # ---- Scan -----------------------------------------------------------
    files = []
    for dp, _dirs, fn in os.walk(src_root):
        for name in fn:
            path = os.path.join(dp, name)
            if os.path.splitext(name)[1].lower() in SUPPORTED:
                files.append(path)

    if not files:
        print("No supported images found in", src_root)
        return 0

    print(f"Found {len(files)} image(s).  Processing...\n")

    # ---- Process --------------------------------------------------------
    results = []
    ok_count = 0
    skip_count = 0
    fail_count = 0
    orig_total = 0
    opt_total = 0

    for fpath in files:
        short = os.path.relpath(fpath, src_root)
        r = process_one(fpath, dst_root, args.max_size, args.quality)

        if r["skipped"]:
            print(f"  [skip]  {short}  —  {r['error']}")
            skip_count += 1
            continue

        if r["error"]:
            print(f"  [FAIL]  {short}  —  {r['error']}")
            fail_count += 1
            continue

        pct = 0
        if r["src_bytes"] > 0:
            pct = round((1 - r["dest_bytes"] / r["src_bytes"]) * 100, 1)

        print(f"  [ok]    {short}  {_human_size(r['src_bytes'])} → "
              f"{_human_size(r['dest_bytes'])}  ({pct}% smaller)")

        orig_total += r["src_bytes"]
        opt_total += r["dest_bytes"]
        ok_count += 1

        results.append(r)

    # ---- Summary --------------------------------------------------------
    print()
    if results:
        pct_total = round((1 - opt_total / orig_total) * 100, 1) if orig_total else 0
        print(f"Processed: {ok_count} ok  |  {skip_count} skipped  |  {fail_count} failed")
        print(f"Original total:  {_human_size(orig_total)}")
        print(f"Optimized total: {_human_size(opt_total)}")
        print(f"Overall reduction: {pct_total}%")
    else:
        print(f"Processed: 0 ok  |  {skip_count} skipped  |  {fail_count} failed")

    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())