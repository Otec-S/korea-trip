#!/usr/bin/env python3
"""Photo pipeline for the trip report.

Originals stay outside the repo (one folder per city). This script:
  index  - reads every photo, extracts capture time and quality hints,
           writes .work/inventory.json and per-city contact sheets
  build  - takes tools/selection.json and writes web-ready copies to
           assets/photos/<city>/ plus assets/photos/photos.json
  check  - fails if any published image still carries metadata (GPS, EXIF)

Usage:
  python3 tools/build_photos.py index --src-root <dir with city folders>
  python3 tools/build_photos.py build --src-root <dir with city folders>
  python3 tools/build_photos.py check
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageStat

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:  # HEIC files will be reported as unreadable
    pillow_heif = None

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / ".work"
OUT = ROOT / "assets" / "photos"
SELECTION = ROOT / "tools" / "selection.json"

# Folder name on disk -> slug used on the site
CITIES = {"Сеул": "seoul", "Кёнджу": "gyeongju", "Ульсан": "ulsan", "Пусан": "busan"}

# Days spent in each city (inclusive, local time); travel days belong to both
STAYS = {
    "seoul": [("2026-10-28", "2026-11-02"), ("2026-11-10", "2026-11-12")],
    "gyeongju": [("2026-11-02", "2026-11-04")],
    "ulsan": [("2026-11-04", "2026-11-05")],
    "busan": [("2026-11-05", "2026-11-10")],
}

PHOTO_EXT = {".jpg", ".jpeg", ".heic", ".png"}
FULL_PX = 1600
THUMB_PX = 480
TAG_DATETIME_ORIGINAL = 36867
TAG_EXIF_IFD = 0x8769


def capture_time(img, path):
    """Best available capture time: EXIF, then file name, then None."""
    try:
        exif = img.getexif()
        raw = exif.get_ifd(TAG_EXIF_IFD).get(TAG_DATETIME_ORIGINAL) or exif.get(306)
        if raw:
            return dt.datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S"), "exif"
    except Exception:
        pass
    m = re.match(r"(\d{8})_(\d{6})", path.stem)
    if m:
        return dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S"), "filename"
    return None, "none"


def sharpness(img):
    """Edge variance on a small grey copy: low values hint at blur."""
    g = img.convert("L")
    g.thumbnail((400, 400))
    return round(ImageStat.Stat(g.filter(ImageFilter.FIND_EDGES)).var[0], 1)


def dhash(img, size=8):
    g = img.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(g.tobytes())
    bits = 0
    for row in range(size):
        for col in range(size):
            left = px[row * (size + 1) + col]
            right = px[row * (size + 1) + col + 1]
            bits = (bits << 1) | (left > right)
    return f"{bits:016x}"


def in_stay(slug, when):
    if when is None:
        return None
    day = when.date().isoformat()
    return any(a <= day <= b for a, b in STAYS[slug])


def open_upright(path):
    img = Image.open(path)
    when, source = capture_time(img, path)
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img, when, source


def cmd_index(args):
    src_root = Path(args.src_root)
    WORK.mkdir(exist_ok=True)
    inv_path = WORK / "inventory.json"
    inventory = json.loads(inv_path.read_text("utf-8")) if inv_path.exists() else {}
    thumbs = WORK / "thumbs"
    for folder, slug in CITIES.items():
        if args.city and slug != args.city:
            continue
        files = sorted(p for p in (src_root / folder).iterdir() if p.suffix.lower() in PHOTO_EXT)
        rows = inventory.setdefault(slug, {})
        (thumbs / slug).mkdir(parents=True, exist_ok=True)
        for p in files:
            if p.name in rows:
                continue
            try:
                img, when, source = open_upright(p)
            except Exception as e:  # unreadable file: keep it visible in the report
                rows[p.name] = {"error": str(e)}
                continue
            small = img.copy()
            small.thumbnail((360, 360))
            small.save(thumbs / slug / (p.stem + ".jpg"), quality=80)
            rows[p.name] = {
                "time": when.isoformat() if when else None,
                "time_source": source,
                "w": img.width,
                "h": img.height,
                "sharp": sharpness(img),
                "dhash": dhash(img),
                "in_stay": in_stay(slug, when),
            }
            inv_path.write_text(json.dumps(inventory, ensure_ascii=False, indent=1), "utf-8")
            print(slug, p.name, rows[p.name]["time"], flush=True)
    inv_path.write_text(json.dumps(inventory, ensure_ascii=False, indent=1), "utf-8")


def cmd_sheets(args):
    """Numbered contact sheets, 6 x 5 per page, in capture order."""
    inventory = json.loads((WORK / "inventory.json").read_text("utf-8"))
    out = WORK / "sheets"
    out.mkdir(exist_ok=True)
    cell, cols, rows_per = 300, 6, 5
    for slug, rows in inventory.items():
        items = sorted(
            ((n, r) for n, r in rows.items() if "error" not in r),
            key=lambda x: (x[1]["time"] or "", x[0]),
        )
        for page in range(0, len(items), cols * rows_per):
            chunk = items[page : page + cols * rows_per]
            sheet = Image.new("RGB", (cols * cell, ((len(chunk) - 1) // cols + 1) * (cell + 28)), "white")
            draw = ImageDraw.Draw(sheet)
            for i, (name, r) in enumerate(chunk):
                t = Image.open(WORK / "thumbs" / slug / (Path(name).stem + ".jpg"))
                t.thumbnail((cell - 8, cell - 8))
                x, y = (i % cols) * cell, (i // cols) * (cell + 28)
                sheet.paste(t, (x + (cell - t.width) // 2, y + (cell - t.height) // 2))
                flag = "" if r["in_stay"] else " !"
                label = f"#{page + i + 1} {(r['time'] or '?')[5:16]}{flag}"
                draw.rectangle([x, y + cell, x + cell, y + cell + 28], fill="black")
                draw.text((x + 6, y + cell + 6), label, fill="white", font_size=18)
            sheet.save(out / f"{slug}-{page // (cols * rows_per) + 1}.jpg", quality=82)
        # stable numbering so selections can refer to "#n"
        (out / f"{slug}-order.json").write_text(
            json.dumps([n for n, _ in items], ensure_ascii=False, indent=0), "utf-8"
        )


def cmd_build(args):
    src_root = Path(args.src_root)
    selection = json.loads(SELECTION.read_text("utf-8"))
    inventory = json.loads((WORK / "inventory.json").read_text("utf-8"))
    manifest = {}
    for folder, slug in CITIES.items():
        dest = OUT / slug
        dest.mkdir(parents=True, exist_ok=True)
        items = []
        for entry in selection.get(slug, []):
            name = entry["file"]
            # "from" covers photos that ended up in another city's folder
            img, when, _ = open_upright(src_root / entry.get("from", folder) / name)
            stem = Path(name).stem.lower()
            for px, suffix, q in ((FULL_PX, "", 80), (THUMB_PX, "-t", 72)):
                copy = img.copy()
                copy.thumbnail((px, px), Image.LANCZOS)
                target = dest / f"{stem}{suffix}.webp"
                if not target.exists() or args.force:
                    # a fresh save without exif= drops all metadata, GPS included
                    copy.convert("RGB").save(target, "WEBP", quality=q, method=6)
            full = Image.open(dest / f"{stem}.webp")
            items.append(
                {
                    "src": f"assets/photos/{slug}/{stem}.webp",
                    "thumb": f"assets/photos/{slug}/{stem}-t.webp",
                    "w": full.width,
                    "h": full.height,
                    "time": when.isoformat() if when else None,
                    "caption": entry.get("caption", ""),
                    "day": entry.get("day") or (when.date().isoformat() if when else None),
                }
            )
        items.sort(key=lambda x: x["time"] or "")
        manifest[slug] = items
        print(slug, len(items), "photos")
    (OUT / "photos.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), "utf-8")
    # also as a script so the page works when opened straight from disk (file://)
    (OUT / "photos.js").write_text(
        "window.TRIP_PHOTOS = " + json.dumps(manifest, ensure_ascii=False) + ";\n", "utf-8"
    )
    unused = sorted(
        p.relative_to(ROOT).as_posix()
        for p in OUT.rglob("*.webp")
        if not any(p.relative_to(ROOT).as_posix() in (i["src"], i["thumb"]) for v in manifest.values() for i in v)
    )
    if unused:
        print("not in selection (safe to delete):", *unused, sep="\n  ")


def cmd_check(args):
    bad = []
    count = 0
    for p in sorted(OUT.rglob("*.webp")):
        count += 1
        img = Image.open(p)
        if len(img.getexif()) or img.info.get("exif") or img.info.get("xmp"):
            bad.append(p.relative_to(ROOT).as_posix())
    print(f"checked {count} images, with metadata: {len(bad)}")
    for b in bad:
        print("  ", b)
    sys.exit(1 if bad or count == 0 else 0)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("index")
    a.add_argument("--src-root", required=True)
    a.add_argument("--city", choices=list(CITIES.values()))
    sub.add_parser("sheets")
    b = sub.add_parser("build")
    b.add_argument("--src-root", required=True)
    b.add_argument("--force", action="store_true")
    sub.add_parser("check")
    args = ap.parse_args()
    {"index": cmd_index, "sheets": cmd_sheets, "build": cmd_build, "check": cmd_check}[args.cmd](args)


if __name__ == "__main__":
    main()
