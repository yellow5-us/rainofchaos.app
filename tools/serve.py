"""Serve html/ locally like production: /poe1 and /poe2 are the page itself (index.html), as on S3.

    python3 tools/serve.py [port] [--fixtures]      (default 8765), then open http://localhost:8765/

/version.json is this checkout's commit (local-<commit>, as a deploy by hand says). --fixtures serves the page checks'
rates (tests/pages/rates.json and poe2/rates.json) instead of the real ones, and their version.json;
open /tests/pages.html to run the checks (tools/pagecheck.py does it in each browser). /tests/ and /html/ are those
folders of the repo, so the tests' imports of ../html/js/... resolve; every other path is under html/.
"""

import functools
import http.server
import io
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = {"/rates.json": "/tests/pages/rates.json", "/poe2/rates.json": "/tests/pages/poe2/rates.json", "/version.json": "/tests/pages/version.json"}


def local_version():
    """version.json as a deploy by hand writes it: this checkout's commit."""
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    return json.dumps({"version": f"local-{commit or 'unknown'}", "commit": commit}).encode()


class Handler(http.server.SimpleHTTPRequestHandler):
    fixtures = False

    def send_head(self):
        path = self.path.split("?")[0]
        if path in ("/poe1", "/poe2"):
            self.path = "/index.html"
        elif self.fixtures and path in FIXTURES:
            self.path = FIXTURES[path]
        elif path == "/version.json":
            body = local_version()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return io.BytesIO(body)
        return super().send_head()

    def translate_path(self, path):
        top = path.split("?")[0].split("/")[1]
        return super().translate_path(path if top in ("tests", "html") else "/html" + path)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8765
    Handler.fixtures = "--fixtures" in sys.argv
    handler = functools.partial(Handler, directory=str(ROOT))
    print(f"http://localhost:{port}/  (/poe1, /poe2){', fixture rates' if Handler.fixtures else ''}", flush=True)
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
