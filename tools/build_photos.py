# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=11"]
# ///
"""把一个文件夹的原图压成网页用的图片，并把拍摄信息合并进 designs/shared/photos.json。

用法（在项目根目录）：
    uv run tools/build_photos.py ~/Desktop/俄罗斯 --slug russia --country 俄罗斯

- 大图：保持原图分辨率，WebP 质量 75（全屏看图用）
- 小图：长边 800px，WebP 质量 72（印样和放大镜用）
- 输出的图片不带任何 EXIF/GPS，颜色统一转成 sRGB
- photos.json 里已经有的照片只更新尺寸，不覆盖你改过的标题、城市等信息；原图里没有的信息留空
"""

import argparse
import io
import re
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image, ImageCms, ImageOps

import photodata

Image.MAX_IMAGE_PIXELS = None

SITE = photodata.SITE
FULL_Q = 75
THUMB_LONG, THUMB_Q = 800, 72
SRGB = ImageCms.createProfile("sRGB")


def to_srgb(im: Image.Image) -> Image.Image:
    icc = im.info.get("icc_profile")
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    if icc:
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        if "srgb" not in ImageCms.getProfileDescription(src).lower().replace(" ", ""):
            im = ImageCms.profileToProfile(im, src, SRGB, outputMode="RGB")
    return im.convert("RGB")


def fit(im: Image.Image, long: int) -> Image.Image:
    w, h = im.size
    k = long / max(w, h)
    return im if k >= 1 else im.resize((round(w * k), round(h * k)), Image.LANCZOS)


def gps_deg(v, ref):
    d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
    return round(-d if ref in ("S", "W") else d, 5)


def camera_name(make, model):
    if not model:
        return ""
    model = model.strip()
    m = re.match(r"NIKON Z (\d+)(?:_(\d))?$", model)
    if m:
        return f"Nikon Z{m[1]}" + (" " + "I" * int(m[2]) if m[2] else "")
    if make and not model.lower().startswith(make.split()[0].lower()):
        return f"{make.split()[0].title()} {model}"
    return model


def read_meta(im: Image.Image) -> dict:
    ex = im.getexif()
    sub, gps = ex.get_ifd(0x8769), ex.get_ifd(0x8825)
    dt = sub.get(36867) or ""
    t, f, mm = sub.get(33434), sub.get(33437), sub.get(37386)
    shutter = ""
    if t:
        t = float(t)
        shutter = f"1/{round(1 / t)}" if t < 1 else f"{t:g}s"
    return {
        "taken": f"{dt[:10].replace(':', '-')}T{dt[11:19]}" if len(dt) >= 19 else "",
        "lat": gps_deg(gps[2], gps[1]) if 2 in gps else None,
        "lon": gps_deg(gps[4], gps[3]) if 4 in gps else None,
        "camera": camera_name(ex.get(271), ex.get(272)),
        "lens": (sub.get(42036) or "").strip(),
        "f": f"{float(f):g}" if f else "",
        "s": shutter,
        "mm": round(float(mm)) if mm else None,
        "iso": int(sub[34855]) if sub.get(34855) else None,
    }


def process(job):
    src, slug, force = job
    name = f"{slug}/{src.stem}.webp"
    full, thumb = SITE / "photos" / "full" / name, SITE / "photos" / "thumb" / name
    with Image.open(src) as im:
        meta = read_meta(im)
        if force or not (full.exists() and thumb.exists()):
            im = to_srgb(ImageOps.exif_transpose(im))
            full.parent.mkdir(parents=True, exist_ok=True)
            thumb.parent.mkdir(parents=True, exist_ok=True)
            im.save(full, "WEBP", quality=FULL_Q, method=5)
            fit(im, THUMB_LONG).save(thumb, "WEBP", quality=THUMB_Q, method=5)
        with Image.open(full) as done:
            w, h = done.size
    return {"id": f"{slug}-{src.stem}", "src": name, "w": w, "h": h, **meta}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--slug", required=True, help="英文目录名，例如 russia")
    ap.add_argument("--country", required=True, help="国家中文名，例如 俄罗斯")
    ap.add_argument("--force", action="store_true", help="已压过的图也重新压")
    ap.add_argument("--known-only", action="store_true", help="只处理 photos.json 里已有的照片（跳过删掉的多余照片）")
    a = ap.parse_args()

    files = sorted(p for p in a.folder.expanduser().iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if a.known_only:
        ids = {p["id"] for p in photodata.load()["photos"]}
        files = [p for p in files if f"{a.slug}-{p.stem}" in ids]
    with ProcessPoolExecutor() as pool:
        results = list(pool.map(process, [(p, a.slug, a.force) for p in files]))

    data = photodata.load()
    data["countries"].setdefault(a.country, {"en": "", "iso": "", "cities": []})
    known = {p["id"]: p for p in data["photos"]}
    added = 0
    for r in results:
        if r["id"] in known:
            known[r["id"]].update(src=r["src"], w=r["w"], h=r["h"])
            continue
        data["photos"].append({
            "id": r["id"], "src": r["src"], "w": r["w"], "h": r["h"],
            "country": a.country, "city": "", "type": "", "title": "", "spot": "",
            **{k: r[k] for k in ("taken", "lat", "lon", "camera", "lens", "f", "s", "mm", "iso")},
            "pick": False,
        })
        added += 1
    photodata.save(data)
    print(f"处理 {len(results)} 张，新增 {added} 条记录 → {photodata.DATA.relative_to(photodata.ROOT)}")


if __name__ == "__main__":
    main()
