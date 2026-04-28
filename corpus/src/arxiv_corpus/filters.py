"""License filter for arxiv papers.

Default policy: include only papers whose author-set license URL is on the
allow-list (Creative Commons + CC0 + arxiv non-exclusive). Empty/missing
licenses are excluded by default since arxiv treats them as "all rights
reserved" for redistribution purposes.

Allow-list mirrors common-pile's filter so the output schema is drop-in
compatible.
"""

from __future__ import annotations

REDISTRIBUTABLE_LICENSES: frozenset[str] = frozenset({
    "http://creativecommons.org/licenses/by/4.0/",
    "http://creativecommons.org/licenses/by-sa/4.0/",
    "http://creativecommons.org/licenses/by/3.0/",
    "http://creativecommons.org/licenses/by-sa/3.0/",
    "http://creativecommons.org/licenses/publicdomain/",
    "http://creativecommons.org/publicdomain/zero/1.0/",
    "http://arxiv.org/licenses/nonexclusive-distrib/1.0/",
    "http://arxiv.org/licenses/assumed-1991-2003/",
})

NON_COMMERCIAL_LICENSES: frozenset[str] = frozenset({
    "http://creativecommons.org/licenses/by-nc/4.0/",
    "http://creativecommons.org/licenses/by-nc-sa/4.0/",
    "http://creativecommons.org/licenses/by-nc-nd/4.0/",
    "http://creativecommons.org/licenses/by-nd/4.0/",
})


def is_redistributable(license_url: str | None, *, include_restricted: bool = False) -> bool:
    """Return True if `license_url` is on the redistribution allow-list.

    Set `include_restricted=True` to bypass the filter entirely (caller
    accepts responsibility for any per-paper license restrictions).
    """
    if include_restricted:
        return True
    if not license_url:
        return False
    return license_url.strip() in REDISTRIBUTABLE_LICENSES
