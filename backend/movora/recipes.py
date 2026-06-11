"""Encoding recipes — static config for the playback variants (IMPLEMENTATION_PLAN §13.1).

A recipe describes a playable target *format* (container + codecs + subtitle handling)
and the ``quality_score`` a variant built from it earns. Recipes are static Python
config, not a DB table: they change rarely, and a code change is cheaper than a
migration (a locked v2 decision — see the ``movora-v2-architecture`` memory).

Recipe ids are format-based, never platform-named: ``mp4-h264-aac-vtt@1`` (not
``webos-safe``). The v1 normalized mp4 is exactly this recipe — what a browser
``<video>`` and an LG webOS TV both Direct Play. New device targets attach as new
recipes here, never by rewriting this one.
"""

from __future__ import annotations

from dataclasses import dataclass

from movora.domain import CapabilityProfile

_CONTAINER_MEDIA_TYPES = {"mp4": "video/mp4", "webm": "video/webm"}


@dataclass(frozen=True)
class EncodingRecipe:
    """A playable target format and the quality a variant built from it earns."""

    id: str  # e.g. "mp4-h264-aac-vtt@1"
    label: str
    container: str  # file suffix without the dot, e.g. "mp4"
    video_codec: str  # e.g. "h264"
    audio_codec: str  # e.g. "aac"
    subtitle_format: str  # "vtt" | "ass"
    quality_score: int  # baseline a ready variant from this recipe earns (higher = better)

    @property
    def media_type(self) -> str:
        return _CONTAINER_MEDIA_TYPES.get(self.container, "application/octet-stream")

    def target_profile(self) -> CapabilityProfile:
        """The client capabilities a variant from this recipe satisfies."""
        return CapabilityProfile(
            supports_ass=self.subtitle_format == "ass",
            video_codecs=(self.video_codec,),
            audio_codecs=(self.audio_codec,),
        )


# The one v1 recipe: 8-bit H.264 + AAC in mp4 with VTT soft subs — the universal
# Direct Play target for browsers and webOS TVs.
WEB_H264 = EncodingRecipe(
    id="mp4-h264-aac-vtt@1",
    label="MP4 · H.264 · AAC",
    container="mp4",
    video_codec="h264",
    audio_codec="aac",
    subtitle_format="vtt",
    quality_score=90,
)

RECIPES: dict[str, EncodingRecipe] = {WEB_H264.id: WEB_H264}

# The recipe the v1 normalizer produces (and that the backfill maps normalized mp4s to).
DEFAULT_RECIPE = WEB_H264


def get_recipe(recipe_id: str) -> EncodingRecipe | None:
    return RECIPES.get(recipe_id)


def recipe_id_for(container: str, video_codec: str, audio_codec: str) -> str:
    """A stable id for a surgically-built device variant, from its output streams.

    Device variants don't map to a static recipe (the target depends on the source —
    a copied HEVC here, a re-encoded H.264 there), so the id is derived from the output
    tuple, e.g. ``mkv-hevc-10-ac3@1``. The selector matches on the variant's actual codec
    columns, not this id, so ids outside ``RECIPES`` are fine.
    """
    return f"{container}-{video_codec}-{audio_codec}@1"
