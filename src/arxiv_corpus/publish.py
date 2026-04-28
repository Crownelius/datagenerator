"""Publish a JSONL corpus to HuggingFace Hub as a dataset repo.

Uses huggingface_hub directly (no datasets library required for upload).
Pushes the JSONL plus a README.md with dataset card metadata in the
common-pile/arxiv_papers schema. Re-running is idempotent — the repo is
created if missing, the file is overwritten on each push.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable

from huggingface_hub import HfApi, create_repo, upload_file

log = logging.getLogger(__name__)


def render_dataset_card(
    *,
    repo_id: str,
    n_papers: int,
    from_date: str,
    until_date: str,
    license_filter: str,
) -> str:
    """Build a HuggingFace dataset README in YAML+Markdown."""
    return (
        "---\n"
        "language:\n- en\n"
        "license: other\n"
        "task_categories:\n- text-generation\n"
        "tags:\n- arxiv\n- science\n- corpus\n- common-pile-schema\n"
        "size_categories:\n"
        f"- {_size_bucket(n_papers)}\n"
        f"pretty_name: arxiv papers {from_date} to {until_date}\n"
        "---\n"
        "\n"
        f"# {repo_id}\n"
        "\n"
        "Fresh arxiv corpus harvested via OAI-PMH metadata + direct PDF download +\n"
        "pymupdf4llm conversion. Schema is drop-in compatible with\n"
        "[`common-pile/arxiv_papers`](https://huggingface.co/datasets/common-pile/arxiv_papers).\n"
        "\n"
        "## Coverage\n"
        "\n"
        f"- Date window: {from_date} → {until_date}\n"
        f"- Papers: {n_papers:,}\n"
        f"- License filter: {license_filter}\n"
        "\n"
        "## Schema\n"
        "\n"
        "Each line in `corpus.jsonl` is one paper with fields:\n"
        "\n"
        "- `id`: arxiv id (e.g. `2501.12345`)\n"
        "- `text`: paper as markdown (converted from PDF via pymupdf4llm)\n"
        "- `source`: `arxiv-papers`\n"
        "- `created`: paper submission date (ISO 8601)\n"
        "- `added`: ingest timestamp (ISO 8601)\n"
        "- `metadata`: `{license, authors, title, url, categories, doi?, journal_ref?}`\n"
        "\n"
        "## License notes\n"
        "\n"
        "Each paper retains its original arxiv author-set license. The corpus is\n"
        "filtered to include only papers under redistributable licenses (CC-BY,\n"
        "CC0, arxiv non-exclusive) unless `--include-restricted` was used at build\n"
        "time. Per-paper licenses are preserved in `metadata.license`.\n"
        "\n"
        "## Build pipeline\n"
        "\n"
        "Built with [`arxiv-corpus-builder`](https://github.com/Crownelius/arxiv-corpus-builder).\n"
    )


def _size_bucket(n: int) -> str:
    if n < 1_000:
        return "n<1K"
    if n < 10_000:
        return "1K<n<10K"
    if n < 100_000:
        return "10K<n<100K"
    if n < 1_000_000:
        return "100K<n<1M"
    return "1M<n<10M"


def push_corpus(
    *,
    repo_id: str,
    jsonl_path: Path,
    n_papers: int,
    from_date: str,
    until_date: str,
    license_filter: str,
    private: bool = False,
    token: str | None = None,
) -> None:
    """Create the repo if missing and upload the corpus + dataset card."""
    api = HfApi(token=token)
    create_repo(repo_id, repo_type="dataset", exist_ok=True, private=private, token=token)

    upload_file(
        path_or_fileobj=str(jsonl_path),
        path_in_repo="corpus.jsonl",
        repo_id=repo_id,
        repo_type="dataset",
        token=token,
    )

    card = render_dataset_card(
        repo_id=repo_id,
        n_papers=n_papers,
        from_date=from_date,
        until_date=until_date,
        license_filter=license_filter,
    )
    readme_path = jsonl_path.parent / "DATASET_README.md"
    readme_path.write_text(card, encoding="utf-8")
    upload_file(
        path_or_fileobj=str(readme_path),
        path_in_repo="README.md",
        repo_id=repo_id,
        repo_type="dataset",
        token=token,
    )

    log.info("Pushed %d-paper corpus to https://huggingface.co/datasets/%s", n_papers, repo_id)


def append_jsonl(rows: Iterable[dict], path: Path) -> int:
    """Append-only writer with a row counter. Resume-safe."""
    import json
    n = 0
    with path.open("a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            n += 1
    return n
