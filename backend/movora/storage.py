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
    """True when the library root is there and can be listed.

    Listing is the probe; what the listing contains is not. A share that went away takes
    the library folder with it — the mount point falls back to the bare directory
    underneath, so the folder no longer exists — and a share that hung answers the read
    with an error. An existing folder that happens to hold nothing is just an empty
    library, which is what deleting the last file leaves behind. The scanner leans on the
    same answer before it prunes (see ``scanner._prune_missing``).
    """
    try:
        with os.scandir(root) as entries:
            # Read one entry: opening a directory can succeed against a dead network
            # handle, and only the first read surfaces the error.
            next(entries, None)
    except OSError:
        return False
    return True
