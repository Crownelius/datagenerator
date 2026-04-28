from arxiv_corpus.filters import is_redistributable


def test_cc_by_4_allowed() -> None:
    assert is_redistributable("http://creativecommons.org/licenses/by/4.0/")


def test_cc0_allowed() -> None:
    assert is_redistributable("http://creativecommons.org/publicdomain/zero/1.0/")


def test_arxiv_nonexclusive_allowed() -> None:
    assert is_redistributable("http://arxiv.org/licenses/nonexclusive-distrib/1.0/")


def test_cc_by_nc_blocked() -> None:
    assert not is_redistributable("http://creativecommons.org/licenses/by-nc/4.0/")


def test_missing_license_blocked() -> None:
    assert not is_redistributable(None)
    assert not is_redistributable("")


def test_unknown_license_blocked() -> None:
    assert not is_redistributable("http://example.com/some-other-license/")


def test_include_restricted_bypasses() -> None:
    assert is_redistributable(None, include_restricted=True)
    assert is_redistributable("http://creativecommons.org/licenses/by-nc/4.0/", include_restricted=True)
