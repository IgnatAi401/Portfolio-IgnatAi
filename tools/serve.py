"""本地预览 + 编辑服务器（只在本机用，不要部署）。

    uv run --no-project python tools/serve.py        # 打开 http://localhost:4173

- 和普通静态服务器一样提供 designs/ 下的网页
- 网页的「编辑模式」把改动 PUT 到 /api/photos，这里写回 designs/shared/photos.json
- 每次启动后的第一次保存前，先把旧文件备份到 backups/ 目录
- 部署成纯静态网站时没有 /api，编辑按钮会自动隐藏
"""

import gzip
import io
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache, partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import photodata

BACKUPS = photodata.ROOT / "backups"
backed_up = False
TEXT_SUFFIXES = {".html", ".json", ".css", ".js"}


def accepts_gzip(header):
    qualities = {}
    for entry in header.lower().split(","):
        name, *params = entry.strip().split(";")
        quality = 1.0
        for param in params:
            key, sep, value = param.strip().partition("=")
            if key == "q" and sep:
                try:
                    quality = float(value)
                except ValueError:
                    quality = 0.0
        qualities[name] = quality
    return qualities.get("gzip", qualities.get("*", 0)) > 0


@lru_cache(maxsize=16)
def compressed_file(path, modified_ns, size):
    # 修改时间和大小作为缓存键，编辑文件后立即失效；不缓存照片。
    return gzip.compress(Path(path).read_bytes(), compresslevel=6, mtime=0)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split("?")[0].lower()
        if "/assets/vendor/" in path or path.endswith((".css", ".js")):
            self.send_header("Cache-Control", "no-cache")
        elif path.endswith((".json", ".html", "/")):
            self.send_header("Cache-Control", "no-store")
        if path.endswith(tuple(TEXT_SUFFIXES) + ("/",)):
            self.send_header("Vary", "Accept-Encoding")
        super().end_headers()

    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir() and self.path.split("?")[0].endswith("/"):
            path /= "index.html"
        if path.suffix.lower() not in TEXT_SUFFIXES or not accepts_gzip(self.headers.get("Accept-Encoding", "")):
            return super().send_head()
        try:
            stat = path.stat()
            if not path.is_file():
                return super().send_head()
            etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}-gzip"'
            tags = self.headers.get("If-None-Match")
            if tags and any(tag.strip().removeprefix("W/") in (etag, "*") for tag in tags.split(",")):
                self.send_response(304)
                self.send_header("ETag", etag)
                self.end_headers()
                return None
            since = self.headers.get("If-Modified-Since")
            if since and not self.headers.get("If-None-Match"):
                try:
                    date = parsedate_to_datetime(since)
                    if date.tzinfo is None:
                        date = date.replace(tzinfo=timezone.utc)
                    modified = datetime.fromtimestamp(stat.st_mtime, timezone.utc).replace(microsecond=0)
                    if modified <= date:
                        self.send_response(304)
                        self.end_headers()
                        return None
                except (ValueError, TypeError, OverflowError):
                    pass
            body = compressed_file(str(path), stat.st_mtime_ns, stat.st_size)
        except OSError:
            return super().send_head()
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.end_headers()
        return io.BytesIO(body)

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/edit":
            return self.reply(200, {"ok": True})
        super().do_GET()

    def do_PUT(self):
        global backed_up
        if self.path != "/api/photos":
            return self.reply(404, {"error": "not found"})
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            if not isinstance(data.get("photos"), list) or not isinstance(data.get("countries"), dict):
                raise ValueError("格式不对：需要 countries 和 photos")
            if not all(isinstance(p, dict) and p.get("id") and p.get("src") for p in data["photos"]):
                raise ValueError("有照片缺少 id 或 src")
        except Exception as e:  # noqa: BLE001
            return self.reply(400, {"error": str(e)})
        if not backed_up and photodata.DATA.exists():
            BACKUPS.mkdir(exist_ok=True)
            shutil.copy2(photodata.DATA, BACKUPS / f"photos-{time.strftime('%Y%m%d-%H%M%S')}.json")
            backed_up = True
        photodata.save(data)
        self.reply(200, {"ok": True, "count": len(data["photos"])})

    def log_message(self, fmt, *args):
        if self.command == "PUT" or (len(args) > 1 and str(args[1])[:1] in "45"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 4173))
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(photodata.SITE)))
    print(f"预览：http://localhost:{port}　（Ctrl+C 停止）", flush=True)
    server.serve_forever()
