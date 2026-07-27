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

It also keeps the LG TV's developer mode alive (see below), so the webOS client
stays installed.

Dependencies: pip install pystray pillow   (or: pip install -e backend[tray])
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime
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

# webOS uninstalls every app installed in developer mode once the session timer runs out
# (1000 hours), so the TV client silently disappears. The EXTEND button in LG's Developer
# Mode app just resets that timer, and the same reset is reachable over HTTP with the
# session token the TV stores — so a daily call from here keeps the app installed for good.
ENV_FILE = ROOT / ".env"
DEV_TOKEN_KEY = "MOVORA_WEBOS_DEV_TOKEN"  # read from the TV: /var/luna/preferences/devmode_enabled
DEVMODE_LOG = ROOT / "var" / "tray-devmode.log"
LG_RESET_URL = "https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken={token}"
LG_CHECK_URL = "https://developer.lge.com/secure/CheckDevModeSession.dev?sessionToken={token}"
KEEPALIVE_INTERVAL_S = 24 * 60 * 60


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


def _dev_token() -> str | None:
    """The TV's developer-mode session token, read from the (gitignored) .env."""
    try:
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in lines:
        key, _, value = line.partition("=")
        if key.strip() == DEV_TOKEN_KEY:
            return value.strip() or None
    return None


def _log_devmode(message: str) -> None:
    DEVMODE_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(DEVMODE_LOG, "a", encoding="utf-8") as log:
        log.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {message}\n")


def _lg_session_call(url: str, token: str) -> str:
    # Both endpoints answer {"result", "errorCode", "errorMsg"}; on success errorMsg
    # carries the payload worth logging — the remaining session time as HHH:MM:SS.
    with urllib.request.urlopen(url.format(token=token), timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return f"{payload.get('result')} ({payload.get('errorMsg')})"


def extend_dev_mode() -> str:
    """Reset the TV's developer-mode timer; returns a one-line result for the log."""
    token = _dev_token()
    if token is None:
        return f"skipped - set {DEV_TOKEN_KEY} in .env"
    try:
        reset = _lg_session_call(LG_RESET_URL, token)
        remaining = _lg_session_call(LG_CHECK_URL, token)
    except (urllib.error.URLError, OSError, ValueError) as err:
        return f"failed - {err}"  # offline, or LG unreachable: the next round retries
    return f"reset: {reset}, remaining: {remaining}"


def keepalive() -> None:
    """Extend the developer-mode session daily. Runs forever on a daemon thread."""
    while True:
        _log_devmode(extend_dev_mode())
        threading.Event().wait(KEEPALIVE_INTERVAL_S)


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
    threading.Thread(target=keepalive, daemon=True).start()

    def do_open(icon: pystray.Icon, item: pystray.MenuItem) -> None:
        webbrowser.open(URL)

    def do_restart(icon: pystray.Icon, item: pystray.MenuItem) -> None:
        threading.Thread(target=server.restart, daemon=True).start()

    def do_extend(icon: pystray.Icon, item: pystray.MenuItem) -> None:
        threading.Thread(target=lambda: _log_devmode(extend_dev_mode()), daemon=True).start()

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
            pystray.MenuItem("Extend TV dev mode", do_extend),
            pystray.MenuItem("Quit (stop backend)", do_quit),
        ),
    )
    icon.run()
    guard.close()


if __name__ == "__main__":
    if "--extend-now" in sys.argv:  # one-shot, no tray: manual run or smoke test
        outcome = extend_dev_mode()
        _log_devmode(outcome)
        print(outcome)
    else:
        main()
