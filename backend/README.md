# Movora — backend

Python / FastAPI backend. The project is being built behind the stable
interfaces described in the implementation plan; the first module implemented is
the **subtitle pipeline** (the highest-risk, highest-value core).

## Develop

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -e ".[dev]"
pytest                          # run the test suite
ruff check .                    # lint
mypy                            # type-check
```

## Subtitle pipeline (`movora/subtitles`)

Extracts plain dialogue from Advanced SubStation Alpha (`.ass`) subtitles for the
SRT fallback used by "dumb" clients. The original soft ASS is never mutated — it
stays the source of truth (rendered client-side by JASSUB).

- `encoding` — normalise mixed Windows-1250 / UTF-8 files to clean UTF-8.
- `ass_parser` — parse `[V4+ Styles]` and `[Events]` into a typed model.
- `features` — aggregate per-style statistics (line share, runtime coverage,
  positioning / karaoke / drawing rates, alignment).
- `style_classifier` — a transparent, keep-biased classifier: dialogue vs.
  signs / songs / typesetting → `KEEP` / `DROP` / `ASK` with reasons.
- `clean_ass` — orchestrates the pipeline and extracts dialogue cues.

The classifier is the **baseline**; user overrides accumulate a labelled dataset
that may later train an ML classifier, measured against this baseline.
