"""arxiv-corpus-builder.

Harvests post-2024 arxiv papers via OAI-PMH metadata + direct PDF download,
converts PDFs to markdown via pymupdf4llm, and writes JSONL in the
common-pile/arxiv_papers schema for publication on HuggingFace Hub.
"""

__version__ = "0.1.0"
