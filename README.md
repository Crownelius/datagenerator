# arxiv-corpus-builder

Free pipeline for building a fresh arxiv corpus and publishing it to HuggingFace Hub in the [`common-pile/arxiv_papers`](https://huggingface.co/datasets/common-pile/arxiv_papers) schema. Drop-in compatible with downstream tools that expect that shape (e.g. [`Crownelius/datagenerator`](https://github.com/Crownelius/datagenerator)).

The pipeline:

1. **Harvest** — OAI-PMH `arXivRaw` metadata from `export.arxiv.org/oai2` (free, ~4s polite delay between pages)
2. **Filter** — keep only papers with redistributable licenses (CC-BY/CC0/arxiv non-exclusive) by default
3. **Download** — fetch PDFs from `arxiv.org/pdf/<id>` with a polite per-request delay
4. **Convert** — PDF → Markdown via [`pymupdf4llm`](https://pypi.org/project/pymupdf4llm/) (CPU, ~1-3 sec per paper)
5. **Publish** — push the JSONL to a HuggingFace dataset repo with a generated dataset card

Each phase is independently runnable and resume-safe. Re-running skips work already done.

## Install

```bash
pip install -e .
```

Requires Python ≥3.10. Dependencies: `requests`, `pymupdf4llm`, `huggingface_hub`, `datasets`, `tqdm`, `python-dateutil`.

## Quick start

End-to-end build of post-2024 papers, pushed to your HF org:

```bash
export HF_TOKEN=hf_...
arxiv-corpus build \
  --from 2025-01-01 \
  --until 2026-04-27 \
  --workdir ./work \
  --repo Crownelius/arxiv-papers-2025-2026
```

Phase-by-phase (useful for resuming or running on different machines):

```bash
arxiv-corpus harvest  --from 2025-01-01 --out work/metadata.jsonl
arxiv-corpus download --metadata work/metadata.jsonl --pdf-dir work/pdfs
arxiv-corpus convert  --metadata work/metadata.jsonl --pdf-dir work/pdfs --out work/corpus.jsonl
arxiv-corpus publish  --corpus work/corpus.jsonl --repo Crownelius/arxiv-papers-2025-2026
```

## Output schema

Each line in `corpus.jsonl`:

```json
{
  "id": "2501.12345",
  "text": "# Title\n\n## Abstract\n...",
  "source": "arxiv-papers",
  "created": "2025-01-15",
  "added": "2026-04-27T12:00:00+00:00",
  "metadata": {
    "license": "http://creativecommons.org/licenses/by/4.0/",
    "authors": "Alice; Bob",
    "title": "A Test Paper",
    "url": "https://arxiv.org/abs/2501.12345",
    "categories": ["cs.LG", "cs.AI"],
    "doi": "10.1234/test",
    "journal_ref": null
  }
}
```

This matches `common-pile/arxiv_papers` exactly.

## License filtering

The default policy includes only papers with explicit redistributable licenses:

- `http://creativecommons.org/licenses/by/4.0/` and `by/3.0`
- `http://creativecommons.org/licenses/by-sa/4.0/` and `by-sa/3.0`
- `http://creativecommons.org/publicdomain/zero/1.0/` (CC0)
- `http://arxiv.org/licenses/nonexclusive-distrib/1.0/`
- `http://arxiv.org/licenses/assumed-1991-2003/`

Non-commercial (`by-nc/*`), no-derivatives (`by-nd/*`), and missing licenses are skipped.

Use `--include-restricted` to disable the filter (caller accepts responsibility for any per-paper license restrictions).

## Cost and time

| Phase | Cost | Wall time (post-2024 ≈ 400K papers) |
|---|---|---|
| Harvest (OAI-PMH) | $0 | ~6-12 hours |
| Download (arxiv.org/pdf) | $0 | ~7 days at 1.5s/req |
| Convert (pymupdf4llm CPU) | $0 | ~10 days |
| Publish (HF Hub) | $0 | minutes |
| **Total** | **$0** | **~17 days unattended** |

For a smaller scope (e.g. just one category like `cs.LG`, or just 2025), divide proportionally.

## Etiquette

The OAI-PMH endpoint is the [official bulk-metadata channel](https://info.arxiv.org/help/oa/index.html). Direct `arxiv.org/pdf/` downloads are not officially endorsed for bulk fetching — arxiv's preferred bulk path is the requester-pays S3 bucket. The defaults in this tool (1.5s per PDF + retry on 429/5xx + identifying User-Agent) keep the load polite.

If you have explicit written permission from arxiv (or are on an institutional license / mirror), `--include-restricted` removes the redistribution filter for the dataset publish step. Per-paper licenses are always preserved in `metadata.license`.

## Running the tests

```bash
pip install -e ".[dev]" pytest
pytest -q
```

(There is no `[dev]` extra defined yet; pytest works fine in the base install.)

## License

Apache-2.0
