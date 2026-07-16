#!/usr/bin/env python3
# ============================================================
# audit_exif.py — READ-ONLY EXIF/GPS audit for committed images.
#
# Purpose:
#   Walk a folder tree and report what EXIF metadata lives in every
#   image, so we can decide whether git history needs rewriting. This
#   script ONLY READS. It does not modify, move, delete, or overwrite
#   anything, and it touches no git command.
#
# Usage:
#   python audit_exif.py                 # scans the current directory
#   python audit_exif.py path/to/folder   # scans that folder recursively
#
# Output:
#   - Per-file line tagged [HIGH PRIORITY] / [ok] / [meta-only].
#   - If GPS is present, the decoded lat/long is printed so you can see
#     exactly what is exposed (see _decode_gps).
#   - Final summary: total scanned, count with GPS, count with other
#     metadata, count completely clean.
#
# Why this approach:
#   Pillow's Image._getexif() returns a dict keyed by integer EXIF tag
#   IDs. ExifTags.TAGS maps those IDs to human-readable names; GPSTAGS
#   maps the GPS sub-IFD IDs in the same way. We decode the GPSIFD
#   specifically (so we can show lat/long), and otherwise just list the
#   tag NAMES we found, without trying to decode every value. That is
#   enough to make the "is anything sensitive in here?" decision.
#
#   PNG/TIFF/GIF/BMP/WEBP all go through the same path. With EXIF they
#   expose the same tag space; some have XMP instead, which we also
#   surface as "XMP packet present" — XMP can carry GPS too, so it's
#   flagged for manual review rather than silently dropped.
#
# Requirements: Pillow (already a site dependency for Part B). No exiftool.
# ============================================================

import os
import sys

from PIL import Image, ExifTags, TiffImagePlugin

# Map EXIF tag id -> name (e.g. 271 -> "Make") and GPS tag id -> name.
TAGS = {v: k for k, v in ExifTags.TAGS.items()}          # name -> id
TAGS_BY_ID = ExifTags.TAGS                                # id -> name
GPSTAGS_BY_ID = ExifTags.GPSTAGS                          # gps id -> name

# Extensions we treat as images. Anything else is skipped.
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".webp"}


# ---- GPS decoding -------------------------------------------------------
# GPS coordinates are stored as three rationals (degrees/minutes/seconds)
# per axis plus a N/S/E/W ref. We turn that into a single signed float
# so a leaked location is obvious at a glance.
def _dms_to_float(dms, ref):
    d, m, s = dms
    # Pillow returns IFDRational here; convert each component to float.
    val = float(d) + float(m) / 60.0 + float(s) / 3600.0
    if ref in ("S", "W"):
        val = -val
    return val


def _decode_gps(gps_ifd):
    """
    Given the GPS sub-IFD dict, return (has_coords, (lat, lon) or None, subtag_names).

    Why this shape: many phones write a GPSInfo IFD that contains *no*
    coordinates — just GPSDateStamp/GPSTimeStamp (capture instant) or
    GPSSpeed (camera was running but had no fix). Such files leak zero
    real location but can still look scary if we only check "is the
    GPSInfo tag set?". We distinguish here:

      has_coords  -- True iff GPSLatitude (tag 2) AND GPSLongitude (tag 4)
                     are both present and decodable. Only this is a real
                     position leak (HIGH PRIORITY).
      coords      -- the decoded (lat, lon) floats when has_coords, else None.
      subtag_names -- names of the GPS sub-tags that ARE populated, so the
                     report can show "GPS IFD present but no coords" with
                     the actual contents (e.g. ['GPSTimeStamp','GPSDateStamp']).
    """
    subtag_names = []
    if hasattr(gps_ifd, "items"):
        for gk, gv in gps_ifd.items():
            nm = GPSTAGS_BY_ID.get(gk, "GPS_tag_%s" % gk)
            # skip values that are obviously "unset" (None / empty bytes)
            if gv is None:
                continue
            if isinstance(gv, (bytes,)) and len(gv) == 0:
                continue
            subtag_names.append(nm)

    has_lat = 2 in gps_ifd and gps_ifd.get(1) is not None
    has_lon = 4 in gps_ifd and gps_ifd.get(3) is not None
    if not (has_lat and has_lon):
        return (False, None, subtag_names)
    try:
        lat = _dms_to_float(gps_ifd.get(2), gps_ifd.get(1, "N"))
        lon = _dms_to_float(gps_ifd.get(4), gps_ifd.get(3, "E"))
        return (True, (lat, lon), subtag_names)
    except Exception:
        return (False, None, subtag_names)


# ---- per-file inspection -------------------------------------------------
def _fmt_coord(lat, lon):
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"{abs(lat):.4f}\u00b0 {ns}, {abs(lon):.4f}\u00b0 {ew}"


def audit_one(path):
    """Return a dict describing one image's EXIF state. Read-only."""
    rel = os.path.relpath(path)
    result = {
        "path": rel,
        "gps_coords": None,   # decoded (lat, lon) or None
        "gps_subtags": [],    # GPS sub-tag names present when IFD has no coords
        "make": None,
        "model": None,
        "datetime": None,
        "software": None,
        "other_tags": [],     # names of any other populated EXIF tags
        "xmp": False,
        "error": None,
    }

    try:
        with Image.open(path) as im:
            # ---- 1. EXIF via Pillow ----
            exif = None
            try:
                exif = im._getexif()            # JPEG/TIFF: the classic path
            except AttributeError:
                exif = None
            except Exception:
                exif = None

            if exif:
                gps_ifd = None
                for tag_id, value in exif.items():
                    name = TAGS_BY_ID.get(tag_id, str(tag_id))
                    if name == "GPSInfo":
                        # value is a nested IFD dict of GPS tag id -> value
                        gps_ifd = value
                        continue
                    if name == "Make" and isinstance(value, str) and value.strip():
                        result["make"] = value.strip()
                    elif name == "Model" and isinstance(value, str) and value.strip():
                        result["model"] = value.strip()
                    elif name in ("DateTime", "DateTimeOriginal", "DateTimeDigitized"):
                        if value and not result["datetime"]:
                            result["datetime"] = str(value)
                    elif name == "Software":
                        result["software"] = str(value) if value else None
                    else:
                        result["other_tags"].append(name)

                if gps_ifd:
                    has_coords, coords, subtag_names = _decode_gps(gps_ifd)
                    if has_coords:
                        result["gps_coords"] = coords
                    else:
                        # GPS IFD exists but has no lat/lon — record the
                        # sub-tags that ARE populated (timestamp/speed/etc.)
                        # so the report can show the IFD isn't leaking a
                        # position without falsely flagging HIGH PRIORITY.
                        result["gps_subtags"] = subtag_names

            # ---- 2. XMP packet (PNG/TIFF can carry GPS in XMP too) ----
            # im.info["XMPPacket" or "Raw profile type xmp"] are how Pillow surfaces it.
            if "XMPPacket" in im.info and im.info["XMPPacket"]:
                result["xmp"] = True
            elif any((k or "").lower() == "raw profile type xmp" for k in im.info):
                result["xmp"] = True

    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    return result


# ---- pretty printing -----------------------------------------------------
def _clean_camera(result):
    parts = []
    parts.append(result["make"] or "none found")
    if result["model"]:
        parts.append(result["model"])
    return " | ".join(parts)


def print_report(results):
    print()
    for r in results:
        rel = r["path"]
        if r["error"]:
            print(f"[unreadable]  {rel} -- {r['error']}")
            continue

        lat_lon = r["gps_coords"]
        # Decide bucket. Anything with decoded coordinates -> HIGH PRIORITY.
        if lat_lon is not None:
            lat, lon = lat_lon
            gps_str = "GPS: " + _fmt_coord(lat, lon)
            cam = "Camera: " + (" | ".join(filter(None, [r["make"], r["model"]])) or "none found")
            date = "Date: " + (r["datetime"] or "none found")
            print(f"[HIGH PRIORITY] {rel} -- {gps_str} | {cam} | {date}")
            if r["software"]:
                print(f"               Software: {r['software']}")
            if r["other_tags"]:
                print(f"               Other tags: {', '.join(r['other_tags'])}")
            if r["xmp"]:
                print(f"               XMP packet present (review for embedded GPS)")
            continue

        meta_bits = []
        cam = " | ".join(filter(None, [r["make"], r["model"]]))
        if cam:
            meta_bits.append("Camera: " + cam)
        if r["datetime"]:
            meta_bits.append("Date: " + r["datetime"])
        if r["software"]:
            meta_bits.append("Software: " + r["software"])
        if r["other_tags"]:
            meta_bits.append("Tags: " + ", ".join(r["other_tags"]))
        if r["xmp"]:
            meta_bits.append("XMP present")

        if r["gps_subtags"]:
            # GPS IFD present but with no coordinates (datestamp/timestamp/speed).
            sub = ", ".join(r["gps_subtags"])
            tag = "[meta-only]"
            detail = f"No GPS coords | GPS IFD present ({sub})"
        else:
            tag = "[ok]" if not meta_bits else "[meta-only]"
            detail = "No GPS"

        if meta_bits:
            print(f"{tag}    {rel} -- {detail} | " + " | ".join(meta_bits))
        else:
            print(f"{tag}    {rel} -- {detail} | Camera: none found | Date: none found")

    print()
    total = len(results)
    unreadable = sum(1 for r in results if r["error"])
    with_coords = sum(1 for r in results if not r["error"] and r["gps_coords"] is not None)
    gps_ifd_no_coords = sum(1 for r in results if not r["error"] and r["gps_coords"] is None and r["gps_subtags"])
    other_meta = sum(1 for r in results if not r["error"] and r["gps_coords"] is None and
                     not r["gps_subtags"] and
                     (r["make"] or r["model"] or r["datetime"] or r["software"] or r["other_tags"] or r["xmp"]))
    clean = sum(1 for r in results if not r["error"] and r["gps_coords"] is None and not r["gps_subtags"] and not
                (r["make"] or r["model"] or r["datetime"] or r["software"] or r["other_tags"] or r["xmp"]))
    print(
        f"Summary: {total} images scanned | "
        f"{with_coords} with GPS coordinates (HIGH PRIORITY)"
        + (f" | {gps_ifd_no_coords} with GPS IFD but no coordinates" if gps_ifd_no_coords else "")
        + f" | {other_meta} with other metadata | {clean} clean"
        + (f" | {unreadable} unreadable" if unreadable else "")
    )
    if with_coords:
        print("NOTE: Files flagged 'HIGH PRIORITY' expose real-world coordinates in git history.")
        print("      Purging them from history (e.g. git filter-repo) is a separate manual step.")
    if gps_ifd_no_coords and not with_coords:
        print("NOTE: Some files have a GPS IFD but contain no coordinates — only timestamps/speed/etc.")
        print("      No real location is exposed; nevertheless, the Part B optimizer will drop the whole IFD.")


# ---- entry point ---------------------------------------------------------
def main(argv):
    root = argv[1] if len(argv) > 1 else os.getcwd()
    if not os.path.isdir(root):
        print(f"audit_exif.py: not a directory: {root}", file=sys.stderr)
        return 2

    print(f"audit_exif.py — read-only EXIF scan of: {os.path.abspath(root)}")
    print("(no files will be modified)")

    results = []
    for dirpath, dirs, files in os.walk(root):
        # Prune in place so os.walk does not descend into git internals
        # (.git) or this repo's gitignored _orig_backup/ — its files aren't
        # committed, so they don't belong in the audit.
        dirs[:] = [d for d in dirs if d not in (".git", "_orig_backup")]
        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext in IMAGE_EXTS:
                results.append(audit_one(os.path.join(dirpath, name)))

    if not results:
        print("No images found.")
        return 0

    # Stable, readable ordering: by relative path.
    results.sort(key=lambda r: r["path"].lower())
    print_report(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))