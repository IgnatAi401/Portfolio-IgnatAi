"""在临时目录验证压缩、缓存失效和编辑保存，不改动作品数据。

    uv run --no-project python tools/test_serve.py
"""

import gzip
import http.client
import json
import os
import tempfile
import threading
import unittest
from contextlib import closing
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

import serve


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "shared").mkdir()
        self.data = {"countries": {}, "photos": [{"id": "test", "src": "test.webp", "title": "原始标题"}]}
        (self.root / "index.html").write_text("<!doctype html>摄影作品" * 100, "utf-8")
        (self.root / "site.js").write_text("const title = '摄影作品';\n" * 100, "utf-8")
        (self.root / "assets/vendor").mkdir(parents=True)
        (self.root / "assets/vendor/map.json").write_text('{"map":true}', "utf-8")
        self.old_data, self.old_backups, self.old_backed_up = serve.photodata.DATA, serve.BACKUPS, serve.backed_up
        serve.photodata.DATA = self.root / "shared/photos.json"
        serve.BACKUPS = self.root / "backups"
        serve.backed_up = False
        serve.photodata.save(self.data)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(serve.Handler, directory=str(self.root)))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        serve.photodata.DATA, serve.BACKUPS, serve.backed_up = self.old_data, self.old_backups, self.old_backed_up
        serve.compressed_file.cache_clear()
        self.tmp.cleanup()

    def request(self, path, *, method="GET", headers=None, body=None):
        with closing(http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)) as connection:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()

    def test_compression_preserves_content(self):
        for path in ("/", "/shared/photos.json", "/site.js"):
            with self.subTest(path=path):
                code, plain_headers, plain = self.request(path)
                gz_code, headers, body = self.request(path, headers={"Accept-Encoding": "gzip"})
                self.assertEqual((code, gz_code), (200, 200))
                self.assertEqual(gzip.decompress(body), plain)
                self.assertEqual(headers["Content-Encoding"], "gzip")
                self.assertEqual(int(headers["Content-Length"]), len(body))
                self.assertEqual(plain_headers["Vary"], "Accept-Encoding")
        self.assertEqual(self.request("/shared/photos.json")[1]["Cache-Control"], "no-store")
        self.assertEqual(self.request("/assets/vendor/map.json")[1]["Cache-Control"], "no-cache")

    def test_negotiation_and_head(self):
        for encoding in ("gzip;q=0", "br", "*;q=1, gzip;q=0"):
            with self.subTest(encoding=encoding):
                code, headers, _ = self.request("/site.js", headers={"Accept-Encoding": encoding})
                self.assertEqual(code, 200)
                self.assertNotIn("Content-Encoding", headers)
        code, headers, body = self.request("/site.js", method="HEAD", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(code, 200)
        self.assertEqual(body, b"")
        self.assertGreater(int(headers["Content-Length"]), 0)

    def test_revalidation_and_file_change(self):
        _, headers, _ = self.request("/site.js", headers={"Accept-Encoding": "gzip"})
        code, cached_headers, body = self.request("/site.js", headers={"Accept-Encoding": "gzip", "If-Modified-Since": headers["Last-Modified"]})
        self.assertEqual(code, 304)
        self.assertEqual(body, b"")
        self.assertEqual(cached_headers["Vary"], "Accept-Encoding")
        self.assertEqual(cached_headers["Cache-Control"], "no-cache")
        changed = b"const changed = true;"
        (self.root / "site.js").write_bytes(changed)
        _, _, body = self.request("/site.js", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(gzip.decompress(body), changed)

    def test_edit_save_and_backup(self):
        self.assertEqual(json.loads(self.request("/api/edit")[2]), {"ok": True})
        original = serve.photodata.DATA.read_bytes()
        self.data["photos"][0]["title"] = "修改后的标题"
        for _ in range(2):
            code, _, body = self.request("/api/photos", method="PUT", headers={"Content-Type": "application/json"}, body=json.dumps(self.data).encode())
            self.assertEqual(code, 200)
            self.assertEqual(json.loads(body)["count"], 1)
        backups = list(serve.BACKUPS.glob("*.json"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), original)
        self.assertEqual(serve.photodata.load(), self.data)

    def test_same_second_same_size_change(self):
        path = self.root / "site.js"
        path.write_bytes(b"const value = 1;")
        stat = path.stat()
        second = stat.st_mtime_ns // 1_000_000_000 * 1_000_000_000
        os.utime(path, ns=(stat.st_atime_ns, second + 100))
        _, headers, _ = self.request("/site.js", headers={"Accept-Encoding": "gzip"})
        condition = {"Accept-Encoding": "gzip", "If-None-Match": headers["ETag"], "If-Modified-Since": headers["Last-Modified"]}
        self.assertEqual(self.request("/site.js", headers=condition)[0], 304)
        path.write_bytes(b"const value = 2;")
        os.utime(path, ns=(stat.st_atime_ns, second + 200))
        code, updated, body = self.request("/site.js", headers=condition)
        self.assertEqual(code, 200)
        self.assertNotEqual(headers["ETag"], updated["ETag"])
        self.assertEqual(gzip.decompress(body), b"const value = 2;")


if __name__ == "__main__":
    unittest.main(verbosity=2)
