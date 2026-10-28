"""Browser drivers for tools/pagecheck.py, bench.py and sureness.py, Python stdlib only. Each opens one headless browser and does just what the
page checks need: goto(url), js(expr) (awaits a promise, returns the value as JSON), screenshot(path), quit().

    marionette  Firefox and its family, over Marionette (its own protocol, built in; no geckodriver)
    cdp         any Chromium (Chrome, chrome-headless-shell, Edge, Brave, Opera), over the DevTools protocol
    webdriver   anything with a W3C WebDriver server (safaridriver, msedgedriver, geckodriver, ...), over HTTP

A browser is { driver, binary, args, ... } in tools/browsers.json; args may use {port} and {profile} (a fresh scratch
folder), which each driver fills in.
"""

import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


START_TIMEOUT = 60  # seconds for a browser to answer after launch
LOG_LINES = 30  # how much of a browser's output a failed start shows


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# The expression's value, awaited and as JSON text: every driver gets a string back and parses it the same way.
def wrapped(expr):
    return f"return (async () => JSON.stringify(await ({expr})))()"


class Driver:
    def __init__(self, config):
        self.config, self.port, self.proc = config, free_port(), None
        self.scratch = tempfile.mkdtemp(prefix="pagecheck-")
        self.profile = os.path.join(self.scratch, "profile")
        os.makedirs(self.profile)

    def launch(self, args, env=None):
        fill = lambda a: a.format(port=self.port, profile=self.profile)
        binary = os.path.expanduser(self.config["binary"])
        self.log = os.path.join(self.scratch, "browser.log")
        with open(self.log, "wb") as log:
            self.proc = subprocess.Popen([binary, *map(fill, self.config.get("args", [])), *map(fill, args)],
                                         env={**os.environ, **(env or {})}, stdout=log, stderr=subprocess.STDOUT)

    # fn()'s value once it stops raising: the browser answering. Fails if it hasn't within START_TIMEOUT seconds or has
    # exited, with the end of what it printed.
    def wait(self, fn, what="the browser"):
        end = time.time() + START_TIMEOUT
        while True:
            try:
                return fn()
            except Exception:
                code = self.proc.poll()
                if code is not None or time.time() > end:
                    how = f"exited with code {code}" if code is not None else f"didn't start in {START_TIMEOUT} s"
                    with open(self.log, errors="replace") as f:
                        tail = "".join(f.readlines()[-LOG_LINES:]).rstrip()
                    raise RuntimeError(f"{what} {how}" + (f"; its last output:\n{tail}" if tail else "; it printed nothing"))
                time.sleep(0.1)

    def quit(self):
        if self.proc:
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        # macOS gives the Library and Downloads folders Firefox makes in its scratch home a "deny delete" ACL: dropped first.
        if sys.platform == "darwin":
            subprocess.run(["chmod", "-R", "-N", self.scratch], stderr=subprocess.DEVNULL)
        shutil.rmtree(self.scratch, ignore_errors=True)


class Marionette(Driver):
    def start(self):
        # Firefox launched from a shell on macOS needs a home of its own (CFFIXED_USER_HOME) or it can't find a profile.
        home = os.path.join(self.scratch, "home")
        os.makedirs(home)
        with open(os.path.join(self.profile, "user.js"), "w") as f:
            f.write(f'user_pref("marionette.port", {self.port});\n'
                    'user_pref("browser.shell.checkDefaultBrowser", false);\n'
                    'user_pref("datareporting.policy.dataSubmissionEnabled", false);\n'
                    'user_pref("media.autoplay.default", 0);\n')
        self.launch(["--marionette", "-no-remote", "-profile", self.profile], env={"CFFIXED_USER_HOME": home})
        self.sock = self.wait(lambda: socket.create_connection(("127.0.0.1", self.port), timeout=60))
        self.buf, self.id = b"", 0
        self._read()  # the handshake
        self.cmd("WebDriver:NewSession", {"capabilities": {}})

    def _read(self):
        while b":" not in self.buf:
            self.buf += self.sock.recv(65536)
        n, rest = self.buf.split(b":", 1)
        while len(rest) < int(n):
            rest += self.sock.recv(65536)
        self.buf = rest[int(n):]
        return json.loads(rest[:int(n)])

    def cmd(self, name, params=None):
        self.id += 1
        msg = json.dumps([0, self.id, name, params or {}]).encode()
        self.sock.sendall(str(len(msg)).encode() + b":" + msg)
        while True:
            _, mid, error, result = self._read()
            if mid == self.id:
                if error:
                    raise RuntimeError(f"{name}: {error.get('message', error)}")
                return result

    def goto(self, url):
        self.cmd("WebDriver:Navigate", {"url": url})

    def js(self, expr):
        return json.loads(self.cmd("WebDriver:ExecuteScript", {"script": wrapped(expr), "args": []})["value"] or "null")

    def screenshot(self, path):
        with open(path, "wb") as f:
            f.write(base64.b64decode(self.cmd("WebDriver:TakeScreenshot", {"full": True})["value"]))

    def quit(self):
        try:
            self.cmd("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            if self.proc:
                self.proc.kill()
        super().quit()


class CDP(Driver):
    def start(self):
        self.launch([f"--remote-debugging-port={self.port}", f"--user-data-dir={self.profile}", "about:blank"])
        pages = self.wait(lambda: json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list")))
        self._connect(next(p["webSocketDebuggerUrl"] for p in pages if p["type"] == "page"))
        self.id = 0
        self.cmd("Page.enable")

    # A minimal WebSocket client: text frames, masked as a client's must be.
    def _connect(self, url):
        hostport, path = url[len("ws://"):].split("/", 1)
        host, port = hostport.rsplit(":", 1)
        self.sock = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += self.sock.recv(1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise RuntimeError(head.decode(errors="replace"))

    def _exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("closed")
            buf += chunk
        return buf

    def _recv(self):
        msg = b""
        while True:
            b0, b1 = self._exact(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._exact(8))[0]
            msg += self._exact(n)
            if b0 & 0x80:
                return msg.decode()

    def cmd(self, method, params=None):
        self.id += 1
        data = json.dumps({"id": self.id, "method": method, "params": params or {}}).encode()
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536
                                else bytes([0x80 | 127]) + struct.pack(">Q", n))
        mask = os.urandom(4)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        while True:
            m = json.loads(self._recv())
            if m.get("id") == self.id:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m.get("result", {})

    def goto(self, url):
        self.cmd("Page.navigate", {"url": url})

    def js(self, expr):
        r = self.cmd("Runtime.evaluate", {"expression": f"(async () => JSON.stringify(await ({expr})))()",
                                          "awaitPromise": True, "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description") or r["exceptionDetails"])
        return json.loads(r["result"].get("value") or "null")

    def screenshot(self, path):
        with open(path, "wb") as f:
            f.write(base64.b64decode(self.cmd("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})["data"]))

    def quit(self):
        try:
            self.cmd("Browser.close")
        except Exception:
            if self.proc:
                self.proc.kill()
        super().quit()


class WebDriver(Driver):
    """The browser's own WebDriver server (`binary`, started with `args`, e.g. ["--port", "{port}"]); `capabilities`
    from the table go in the new session's alwaysMatch (e.g. {"browserName": "safari"})."""

    def start(self):
        self.launch([])
        self.base = f"http://127.0.0.1:{self.port}"
        self.wait(lambda: self.http("GET", "/status"), what="the WebDriver server")
        caps = {"alwaysMatch": self.config.get("capabilities", {})}
        self.session = self.http("POST", "/session", {"capabilities": caps})["sessionId"]

    def http(self, method, path, body=None):
        req = urllib.request.Request(self.base + path, method=method, headers={"Content-Type": "application/json"},
                                     data=None if body is None else json.dumps(body).encode())
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.load(res)["value"]
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path}: {e.read().decode(errors='replace')}")

    def goto(self, url):
        self.http("POST", f"/session/{self.session}/url", {"url": url})

    def js(self, expr):
        return json.loads(self.http("POST", f"/session/{self.session}/execute/sync", {"script": wrapped(expr), "args": []}) or "null")

    def screenshot(self, path):
        with open(path, "wb") as f:
            f.write(base64.b64decode(self.http("GET", f"/session/{self.session}/screenshot")))

    def quit(self):
        try:
            self.http("DELETE", f"/session/{getattr(self, 'session', '')}")
        except Exception:
            pass
        if self.proc:
            self.proc.terminate()
        super().quit()


DRIVERS = {"marionette": Marionette, "cdp": CDP, "webdriver": WebDriver}
