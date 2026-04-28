from pathlib import Path

from arxiv_corpus.download import pdf_path, already_downloaded


def test_pdf_path_buckets_by_yymm() -> None:
    out = Path("/tmp/pdfs")
    p = pdf_path(out, "2501.12345")
    assert p.parent.name == "2501"
    assert p.name == "2501.12345.pdf"


def test_pdf_path_handles_old_style_id() -> None:
    out = Path("/tmp/pdfs")
    p = pdf_path(out, "math.AG/0612001")
    assert p.name == "math.AG_0612001.pdf"


def test_already_downloaded_requires_min_size(tmp_path: Path) -> None:
    f = tmp_path / "x.pdf"
    f.write_bytes(b"x" * 100)
    assert not already_downloaded(f)
    f.write_bytes(b"x" * 2000)
    assert already_downloaded(f)
