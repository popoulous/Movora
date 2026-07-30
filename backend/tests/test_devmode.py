"""The webOS developer-mode keepalive, driven through an injected transport."""

from __future__ import annotations

import json
import threading
import urllib.error

import pytest

from movora import devmode

TOKEN = "0123456789abcdef"


class _FakeLg:
    """Answers both LG endpoints in their real shape, recording what was asked."""

    def __init__(self, remaining: str = "999:59:59") -> None:
        self.urls: list[str] = []
        self.remaining = remaining

    def __call__(self, url: str) -> str:
        self.urls.append(url)
        message = "success" if "Reset" in url else self.remaining
        return json.dumps({"result": "success", "errorCode": "", "errorMsg": message})


def test_extending_resets_the_session_and_reports_the_time_left() -> None:
    lg = _FakeLg()

    outcome = devmode.extend_dev_mode(TOKEN, lg)

    assert [url.split("/")[-1].split("?")[0] for url in lg.urls] == [
        "ResetDevModeSession.dev",
        "CheckDevModeSession.dev",
    ]
    assert all(TOKEN in url for url in lg.urls)
    assert "999:59:59" in outcome


@pytest.mark.parametrize("token", [None, ""])
def test_without_a_token_lg_is_never_called(token: str | None) -> None:
    def explode(url: str) -> str:
        raise AssertionError("no token means no request")

    assert "skipped" in devmode.extend_dev_mode(token, explode)


def test_an_unreachable_lg_is_reported_not_raised() -> None:
    def offline(url: str) -> str:
        raise urllib.error.URLError("no route to host")

    # A missed round costs nothing against a 1000-hour timer; crashing the server would.
    assert devmode.extend_dev_mode(TOKEN, offline).startswith("failed - ")


def test_the_timer_only_starts_when_a_token_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started: list[object] = []

    class _RecordingThread:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

        def start(self) -> None:
            started.append(self.kwargs)

    monkeypatch.setattr(devmode, "_run_in_thread", True)
    monkeypatch.setattr(threading, "Thread", _RecordingThread)

    devmode.start_devmode_timer(None)
    devmode.start_devmode_timer(TOKEN, interval_seconds=0)
    assert started == []

    devmode.start_devmode_timer(TOKEN)
    assert len(started) == 1
