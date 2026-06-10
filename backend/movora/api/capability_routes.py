"""Capability probe samples — tiny synthetic clips the TV client actually plays to
confirm what it can decode. ``canPlayType`` is only advisory, so a real HTTP
playback probe is the ground truth (plan §13.4). Served unauthenticated: the clips
are public synthetic media and the probe runs around pairing/capability testing.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/capabilities", tags=["capabilities"])

_SAMPLES_DIR = Path(__file__).resolve().parent.parent / "assets" / "capability_samples"
_MANIFEST = _SAMPLES_DIR / "manifest.json"
_MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".vtt": "text/vtt",
}


class CapabilitySample(BaseModel):
    id: str
    category: str  # video | container | audio | subtitle
    label: str
    mime: str
    filename: str


def _load_samples() -> list[CapabilitySample]:
    if not _MANIFEST.is_file():
        return []
    data = json.loads(_MANIFEST.read_text(encoding="utf-8"))
    samples: list[CapabilitySample] = []
    for entry in data.get("samples", []):
        filename = entry.get("filename")
        if not filename:
            continue
        samples.append(
            CapabilitySample(
                id=entry["id"],
                category=entry.get("category", "other"),
                label=entry.get("label", entry["id"]),
                mime=entry.get("mime", ""),
                filename=filename,
            )
        )
    return samples


@router.get("/samples", response_model=list[CapabilitySample])
def list_samples() -> list[CapabilitySample]:
    """The probe manifest: which clips the client should try to play."""
    return _load_samples()


@router.get("/samples/{sample_id}")
def get_sample(sample_id: str) -> FileResponse:
    """Stream one probe clip (FileResponse honours Range so the player can load it)."""
    sample = next((s for s in _load_samples() if s.id == sample_id), None)
    if sample is None:
        raise HTTPException(status_code=404, detail="unknown sample")
    path = (_SAMPLES_DIR / sample.filename).resolve()
    # Guard against a crafted manifest filename escaping the samples directory.
    if path.parent != _SAMPLES_DIR.resolve() or not path.is_file():
        raise HTTPException(status_code=404, detail="sample file missing")
    media_type = _MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type)
