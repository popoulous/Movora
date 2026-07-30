"""Movora tray launcher for a Windows host.

Runs the backend — which also serves the built web UI when MOVORA_FRONTEND_DIST is
set — as a hidden child process, keeps it alive, and offers Open / Restart / Quit
from a system-tray icon. Put a shortcut to this file (via pythonw.exe) into
shell:startup and the whole server comes up on login.

Why a tray app in the user's session and not a Windows service: mapped network
drives (the NAS media library) only exist in the user's logon session, so a
service running as SYSTEM would see every library path as missing.

If another Movora instance is already serving (a manually started dev console),
the launcher adopts it instead of fighting over the port — and takes over
seamlessly the moment that instance goes away.

Dependencies: pip install pystray pillow   (or: pip install -e backend[tray])
"""

from __future__ import annotations

import socket
import subprocess
import threading
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import pystray
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PYTHON = ROOT / "backend" / ".venv" / "Scripts" / "python.exe"
ICON_PNG = ROOT / "apps" / "webos" / "icon.png"
LOG_FILE = ROOT / "var" / "tray-backend.log"
URL = "http://localhost:8000"
WATCHDOG_INTERVAL_S = 5.0
SINGLETON_PORT = 47653  # arbitrary loopback port held to prevent a second launcher


def _health_ok() -> bool:
    try:
        with urllib.request.urlopen(f"{URL}/health", timeout=1.5) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError):
        return False


class Server:
    """The managed backend process (or an adopted, externally started one)."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        self.wanted = True
        self.lock = threading.Lock()

    def start(self) -> None:
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                return
            if _health_ok():
                return  # an external instance serves already — adopt it
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            log = open(LOG_FILE, "ab")  # noqa: SIM115 — owned by the child process
            self.process = subprocess.Popen(
                [
                    str(PYTHON), "-m", "uvicorn", "movora.api.app:app",
                    "--host", "0.0.0.0", "--port", "8000",
                ],
                cwd=str(ROOT / "backend"),
                stdout=log,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )

    def stop(self) -> None:
        with self.lock:
            self.wanted = False
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.process.kill()
            self.process = None

    def restart(self) -> None:
        self.stop()
        self.wanted = True
        self.start()

    def watch(self) -> None:
        """Keep the backend alive: respawn when neither our child nor an adopted
        external instance is serving. Runs forever on a daemon thread."""
        while True:
            if self.wanted:
                alive = self.process is not None and self.process.poll() is None
                if not alive and not _health_ok():
                    self.start()
            threading.Event().wait(WATCHDOG_INTERVAL_S)


def _icon_image() -> Image.Image:
    try:
        return Image.open(ICON_PNG)
    except OSError:
        image = Image.new("RGB", (64, 64), "#7a4dff")
        ImageDraw.Draw(image).text((22, 20), "M", fill="#ffffff")
        return image


def main() -> None:
    # One launcher at a time: holding a loopback port is the simplest cross-run lock.
    guard = socket.socket()
    try:
        guard.bind(("127.0.0.1", SINGLETON_PORT))
    except OSError:
        return  # another launcher already runs — nothing to do
    server = Server()
    server.start()
    threading.Thread(target=server.watch, daemon=True).start()

    def do_open(icon: pystray.Icon, item: pystray.MenuItem) -> None:
        webbrowser.open(URL)

    def do_restart(icon: pystray.Icon, item: pystray.MenuItem) -> None:
        threading.Thread(target=server.restart, daemon=True).start()

    def do_quit(icon: pystray.Icon, item: pystray.MenuItem) -> None:
        server.stop()
        icon.stop()

    icon = pystray.Icon(
        "movora",
        _icon_image(),
        "Movora",
        menu=pystray.Menu(
            pystray.MenuItem("Open Movora", do_open, default=True),
            pystray.MenuItem("Restart backend", do_restart),
            pystray.MenuItem("Quit (stop backend)", do_quit),
        ),
    )
    icon.run()
    guard.close()


if __name__ == "__main__":
    main()
