"""Local desktop server and isolated PlatformIO build service for the 4Runner studio."""

import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
from urllib.request import urlopen

from firmware import ROOT, Export, Invalid, Sources

HERE = Path(__file__).resolve().parent
STUDIO_ID = hashlib.sha256(os.fsencode(ROOT)).hexdigest()[:16]


def platformio():
    command = shutil.which("pio") or shutil.which("platformio")
    if command:
        return command
    penv = Path.home() / ".platformio" / "penv"
    paths = [penv / "Scripts/pio.exe", penv / "bin/pio"]
    return next((str(p) for p in paths if p.is_file()), None)


def compile_project(project, environments):
    pio = platformio()
    if not pio:
        return dict(ok=False, log="PlatformIO was not found. Install PlatformIO Core and run pio run in the extracted project.")
    command = [pio, "run", "-j", str(min(os.cpu_count() or 2, 8))]
    for name in environments:
        command += ["-e", name]
    try:
        result = subprocess.run(command, cwd=project, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, encoding="utf8",
                                errors="replace", timeout=900, check=False)
        return dict(ok=result.returncode == 0, log=result.stdout[-16000:])
    except (OSError, subprocess.TimeoutExpired) as error:
        return dict(ok=False, log=str(error))


class Studio:
    def __init__(self, folder):
        self.folder = folder
        self.project = folder / "project"
        self.lock = threading.Lock()

    def export(self, data, plan):
        with self.lock:
            root = plan.src.root
            src = self.project / "src"
            # Keep the build cache between exports, but start each source snapshot clean.
            if src.exists():
                shutil.rmtree(src)
            shutil.copytree(root / "src", src)
            shutil.copy2(root / "platformio.ini", self.project / "platformio.ini")
            for path, content in plan.render().items():
                (self.project / path).write_text(content, encoding="utf8", newline="\n")
            libs = self.project / ".pio/libdeps"
            if not libs.exists() and (root / ".pio/libdeps").exists():
                shutil.copytree(root / ".pio/libdeps", libs)
            environments = plan.environments()
            build = compile_project(self.project, environments)
            name = f"4runner-{plan.node}-{plan.slot}-{uuid.uuid4().hex[:12]}.zip"
            path = self.folder / name
            with zipfile.ZipFile(path, "x", zipfile.ZIP_DEFLATED) as archive:
                for source in sorted(src.rglob("*")):
                    if source.is_file():
                        archive.write(source, source.relative_to(self.project))
                archive.write(self.project / "platformio.ini", "platformio.ini")
                archive.writestr("design.json", json.dumps(data, indent=2, ensure_ascii=False))
                archive.writestr("channel-changes.json", json.dumps(plan.review(), indent=2))
                archive.writestr("build.txt", ("PASSED" if build["ok"] else "UNVERIFIED") + "\n" + build["log"])
                if build["ok"]:
                    for env in environments:
                        artifact = self.project / ".pio/build" / env / "firmware.uf2"
                        archive.write(artifact, f"build/{env}/firmware.uf2")
            return {**plan.review(), "name": name, "download": f"/exports/{name}", "build": build}


class Handler(BaseHTTPRequestHandler):
    def send_data(self, status, content, content_type, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(content)

    def json(self, status, value):
        self.send_data(status, json.dumps(value).encode(), "application/json")

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/api/status":
            self.json(200, {"studio": STUDIO_ID})
            return
        if path == "/api/baseline":
            try:
                self.json(200, Sources().baseline())
            except (OSError, ValueError, KeyError) as error:
                self.json(500, {"error": str(error)})
            return
        if path.startswith("/exports/"):
            name = path[len("/exports/"):]
            if re.fullmatch(r"4runner-(engine|cargo)-(fast|slow)-[0-9a-f]{12}\.zip", name):
                package = self.server.studio.folder / name
                if package.is_file():
                    self.send_data(200, package.read_bytes(), "application/zip", name)
                    return
            self.send_error(404)
            return
        base = HERE / ("assets" if path.startswith("/assets/") else "web")
        leaf = path.removeprefix("/assets/") if base.name == "assets" else path.lstrip("/") or "index.html"
        try:
            file = (base / leaf).resolve()
            if not file.is_relative_to(base) or not file.is_file():
                self.send_error(404)
                return
            media_type = "text/javascript" if file.suffix in {".js", ".mjs"} else mimetypes.guess_type(file.name)[0]
            self.send_data(200, file.read_bytes(), media_type or "application/octet-stream")
        except (ValueError, OSError):
            self.send_error(404)

    def do_POST(self):
        if self.path not in ("/api/review", "/api/export"):
            self.send_error(404)
            return
        origin = self.headers.get("Origin")
        allowed = {f"{h}:{self.server.server_port}" for h in ("127.0.0.1", "localhost")}
        if self.headers.get("Host", "") not in allowed or (origin and origin != "http://" + self.headers.get("Host", "")):
            self.json(403, {"error": "Open the local studio to export a design."})
            return
        if self.headers.get_content_type() != "application/json":
            self.json(415, {"error": "Expected a JSON design."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 8 * 1024 * 1024:
                raise Invalid("Design must be smaller than 8 MB.")
            data = json.loads(self.rfile.read(size))
            plan = Export(data, Sources())
            result = plan.review() if self.path == "/api/review" else self.server.studio.export(data, plan)
        except (Invalid, ValueError, KeyError, TypeError) as error:
            self.json(422, {"error": str(error)})
            return
        except OSError as error:
            self.json(500, {"error": f"Could not generate export: {error}"})
            return
        self.json(200, result)


class StudioServer(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR permits two listeners on the same address.
    allow_reuse_address = os.name != "nt"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--open", action="store_true", help="Open the app in the default browser.")
    options = parser.parse_args()
    cache = ROOT / ".pio"
    cache.mkdir(exist_ok=True)
    try:
        server = StudioServer(("127.0.0.1", options.port), Handler)
    except OSError as error:
        url = f"http://127.0.0.1:{options.port}"
        if options.open:
            try:
                with urlopen(url + "/api/status", timeout=1) as reply:
                    if json.load(reply).get("studio") == STUDIO_ID:
                        webbrowser.open(url)
                        return
            except (ValueError, AttributeError, OSError):
                pass
        parser.exit(1, f"Cannot open {url}: {error}\nChoose a different port with --port.\n")
    with server:
        with tempfile.TemporaryDirectory(prefix="studio-", dir=cache, ignore_cleanup_errors=True) as folder:
            server.studio = Studio(Path(folder))
            url = f"http://127.0.0.1:{server.server_port}"
            print(f"4Runner light studio  {url}  (Ctrl+C to stop)", flush=True)
            if options.open:
                webbrowser.open(url)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()
