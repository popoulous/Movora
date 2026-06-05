# Vendored dependencies

Frozen copies of third-party code, kept here instead of as PyPI dependencies when
the upstream is unmaintained. Each sits behind a stable Movora interface, so it
can be replaced without changing callers.

## anitopy

- **Source:** https://github.com/igorcmoura/anitopy
- **License:** Mozilla Public License 2.0 (see [`anitopy/LICENSE`](anitopy/LICENSE)),
  © Igor Cescon de Moura. The MPL-2.0 files remain under MPL-2.0; the rest of
  Movora stays MIT (MPL is file-level copyleft, compatible with MIT).
- **Why vendored:** upstream is inactive (last release in 2022). Anime file-name
  conventions are stable, so a frozen copy stays valid, and we can patch it.
- **Modifications:** internal imports rewritten from `anitopy.*` to
  `movora.vendor.anitopy.*`. Used behind the `ParserStrategy` interface.
