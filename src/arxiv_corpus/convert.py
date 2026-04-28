"""PDF -> Markdown via pymupdf4llm.

Lightweight, CPU-only, ~1-3 sec per typical arxiv PDF. Quality is good
enough for LM training material. For higher-fidelity math/table parsing,
swap in `marker` (slower, GPU-heavy) — outside the free-and-fast scope of
this tool.
"""

from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)


class ConversionError(Exception):
    pass


def pdf_to_markdown(pdf_path: Path) -> str:
    try:
        import pymupdf4llm
    except ImportError as exc:
        raise ConversionError(
            "pymupdf4llm not installed. Run: pip install pymupdf4llm"
        ) from exc

    if not pdf_path.exists():
        raise ConversionError(f"PDF not found: {pdf_path}")
    if pdf_path.stat().st_size < 1024:
        raise ConversionError(f"PDF too small (<1 KB): {pdf_path}")

    try:
        text = pymupdf4llm.to_markdown(str(pdf_path))
    except Exception as exc:
        raise ConversionError(f"pymupdf4llm failed on {pdf_path.name}: {exc}") from exc

    if not isinstance(text, str) or len(text.strip()) < 100:
        raise ConversionError(f"pymupdf4llm produced no text for {pdf_path.name}")

    return text
