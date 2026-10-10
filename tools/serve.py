"""本地预览 + 编辑服务器（只在本机用，不要部署）。

    uv run --no-project python tools/serve.py        # 打开 http://localhost:4173

- 和普通静态服务器一样提供 designs/ 下的网页
- 网页的「编辑模式」把改动 PUT 到 /api/photos，这里写回 designs/shared/photos.json
- 每次启动后的第一次保存前，先把旧文件备份到 backups/ 目录
- 部署成纯静态网站时没有 /api，编辑按钮会自动隐藏
"""

import json
import os
import shutil
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import photodata

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 4173))
BACKUPS = photodata.ROOT / "backups"
backed_up = False


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.split("?")[0].endswith((".json", ".html", "/")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

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
    server = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=str(photodata.SITE)))
    print(f"预览：http://localhost:{PORT}　（Ctrl+C 停止）", flush=True)
    server.serve_forever()
