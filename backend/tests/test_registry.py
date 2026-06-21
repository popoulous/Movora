from movora.db.models import LibraryKind
from movora.domain import ParsedFields, SeriesLocalization, SeriesMetadata
from movora.interfaces import MetadataProvider
from movora.metadata.registry import MetadataRegistry


class _Provider:
    def fetch(self, parsed: ParsedFields) -> SeriesMetadata | None:
        return None

    def with_language(self, language: str) -> MetadataProvider:
        return self

    def localize(self, external_id: str) -> SeriesLocalization | None:
        return None


def test_registry_picks_provider_by_kind() -> None:
    anime, movie, series = _Provider(), _Provider(), _Provider()
    registry = MetadataRegistry(anime=anime, movie=movie, series=series)

    assert registry.for_kind(LibraryKind.ANIME) is anime
    assert registry.for_kind(LibraryKind.MOVIE) is movie
    assert registry.for_kind(LibraryKind.SERIES) is series
