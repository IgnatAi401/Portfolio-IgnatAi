"""photos.json 的读写：每张照片占一行，方便直接打开文件查看和比对。"""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "designs"
DATA = SITE / "shared" / "photos.json"


def load() -> dict:
    return json.loads(DATA.read_text("utf-8")) if DATA.exists() else {"countries": {}, "photos": []}


def dumps(data: dict) -> str:
    j = lambda v: json.dumps(v, ensure_ascii=False)
    countries = ",\n".join(f"  {j(k)}: {j(v)}" for k, v in data.get("countries", {}).items())
    photos = ",\n".join(f"  {j(p)}" for p in data.get("photos", []))
    return f'{{\n "countries": {{\n{countries}\n }},\n "photos": [\n{photos}\n ]\n}}\n'


def save(data: dict) -> None:
    DATA.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA.with_suffix(".tmp")
    tmp.write_text(dumps(data), "utf-8")
    os.replace(tmp, DATA)
