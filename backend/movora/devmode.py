"""Keep an LG TV's developer-mode session alive.

webOS uninstalls every app installed in developer mode once the session timer runs out
(1000 hours, about 41 days), so the TV client silently disappears — from the owner's
side it looks like someone deleted it. The EXTEND button in LG's Developer Mode app
just resets that timer, and the same reset is reachable over HTTP with the session
token the TV keeps in /var/luna/preferences/devmode_enabled. A daily call from the
server therefore keeps the app installed for good.

An *expired* session cannot be revived: developer mode has to be switched on again on
the TV and the token re-read. That is why this runs unattended rather than on demand.

The whole feature is opt-in: without MOVORA_WEBOS_DEV_TOKEN nothing starts, which is
the normal case for anyone running Movora without a side-loaded TV client.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable

RESET_URL = "https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken={token}"
CHECK_URL = "https://developer.lge.com/secure/CheckDevModeSession.dev?sessionToken={token}"
DEFAULT_INTERVAL_SECONDS = 24 * 60 * 60
_REQUEST_TIMEOUT_S = 15

# A URL in, the raw response body out. Injected in tests so they never touch the network.
Transport = Callable[[str], str]

logger = logging.getLogger("movora.devmode")

# Production runs the timer in a thread; tests set this False (mirrors normalize.py).
_run_in_thread = True


def _http_get(url: str) -> str:
    with urllib.request.urlopen(url, timeout=_REQUEST_TIMEOUT_S) as response:
        return str(response.read().decode("utf-8"))


def _session_call(url: str, token: str, transport: Transport) -> str:
    # Both endpoints answer {"result", "errorCode", "errorMsg"}; on success errorMsg
    # carries the payload worth logging — the remaining session time as HHH:MM:SS.
    payload = json.loads(transport(url.format(token=token)))
    return f"{payload.get('result')} ({payload.get('errorMsg')})"


def extend_dev_mode(token: str | None, transport: Transport = _http_get) -> str:
    """Reset the TV's developer-mode timer; returns a one-line result worth logging.

    Never raises. A keepalive that takes the server down with it would be worse than a
    missed round, and the next round retries anyway — LG being unreachable for a day
    costs nothing against a 1000-hour timer."""
    if not token:
        return "skipped - no developer-mode token configured"
    try:
        reset = _session_call(RESET_URL, token, transport)
        remaining = _session_call(CHECK_URL, token, transport)
    except (urllib.error.URLError, OSError, ValueError) as error:
        return f"failed - {error}"
    return f"reset: {reset}, remaining: {remaining}"


def start_devmode_timer(
    token: str | None, interval_seconds: int = DEFAULT_INTERVAL_SECONDS
) -> None:
    """Extend the developer-mode session now and every interval after. A no-op without
    a token, in tests, and when the interval is disabled."""
    if not token or not _run_in_thread or interval_seconds <= 0:
        return

    def loop() -> None:
        while True:
            logger.info("webOS developer mode: %s", extend_dev_mode(token))
            time.sleep(interval_seconds)

    threading.Thread(target=loop, daemon=True).start()
