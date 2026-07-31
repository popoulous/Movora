"""Whether a library's storage is reachable right now.

The media usually lives on a network share, and a share can be absent at any moment:
the NAS is off, the link dropped, or it simply had not finished mounting when the
server started. Telling "the share is gone" apart from "this one file was deleted" is
what lets the clients say something true — an unreachable library is a temporary state
to report, not a library that lost its content.
"""

from __future__ import annotations

import os
from pathlib import Path


def storage_available(root: Path) -> bool:
    """True when the library root is readable and holds at least one entry.

    An empty directory counts as unavailable on purpose: that is exactly what an
    unmounted share looks like from the inside, and a library worth listing is never
    empty. The same reasoning guards the scanner from pruning everything (see
    ``scanner._prune_missing``).
    """
    try:
        with os.scandir(root) as entries:
            return next(entries, None) is not None
    except OSError:
        return False
