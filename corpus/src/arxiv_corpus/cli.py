"""arxiv-corpus CLI.

Four phases that can run independently or as one `build` pipeline:

  arxiv-corpus harvest  --from 2025-01-01 --until 2026-04-27 --out metadata.jsonl
  arxiv-corpus download --metadata metadata.jsonl --pdf-dir pdfs/
  arxiv-corpus convert  --metadata metadata.jsonl --pdf-dir pdfs/ --out corpus.jsonl
  arxiv-corpus publish  --corpus corpus.jsonl --repo Crownelius/arxiv-papers-2025-2026

  arxiv-corpus build    --from 2025-01-01 --until 2026-04-27 --workdir ./work \\
                         --repo Crownelius/arxiv-papers-2025-2026

Each phase is resumable: re-running skips work already done (existing
metadata rows, downloaded PDFs, converted entries).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .convert import ConversionError, pdf_to_markdown
from .download import DownloadError, fetch_pdf, pdf_path
from .filters import is_redistributable
from .oai import PaperMetadata, harvest
from .publish import append_jsonl, push_corpus

log = logging.getLogger("arxiv_corpus")


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def _read_existing_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    out: set[str] = set()
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            pid = row.get("id")
            if isinstance(pid, str):
                out.add(pid)
    return out


def _meta_to_row(p: PaperMetadata) -> dict:
    return {
        "id": p.id,
        "title": p.title,
        "authors": p.authors,
        "abstract": p.abstract,
        "categories": p.categories,
        "license": p.license,
        "submitted": p.submitted,
        "updated": p.updated,
        "doi": p.doi,
        "journal_ref": p.journal_ref,
    }


def cmd_harvest(args: argparse.Namespace) -> int:
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    seen = _read_existing_ids(out)
    log.info("Resuming with %d existing metadata rows", len(seen))

    n_new = 0
    with out.open("a", encoding="utf-8") as f:
        for p in harvest(
            from_date=args.from_date,
            until_date=args.until_date,
            metadata_prefix="arXivRaw",
            set_spec=args.set,
            delay_seconds=args.delay,
            max_pages=args.max_pages,
        ):
            if p.id in seen:
                continue
            f.write(json.dumps(_meta_to_row(p), ensure_ascii=False) + "\n")
            seen.add(p.id)
            n_new += 1
            if n_new % 1000 == 0:
                log.info("Harvested %d new metadata rows (total %d)", n_new, len(seen))
    log.info("Harvest complete: %d new rows, %d total in %s", n_new, len(seen), out)
    return 0


def _filtered_metadata(metadata_path: Path, include_restricted: bool) -> Iterable[dict]:
    with metadata_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not is_redistributable(row.get("license"), include_restricted=include_restricted):
                continue
            yield row


def cmd_download(args: argparse.Namespace) -> int:
    metadata = Path(args.metadata)
    if not metadata.exists():
        log.error("Metadata file not found: %s", metadata)
        return 2
    pdf_dir = Path(args.pdf_dir)
    pdf_dir.mkdir(parents=True, exist_ok=True)

    todo: list[str] = []
    skipped = 0
    for row in _filtered_metadata(metadata, args.include_restricted):
        pid = row["id"]
        target = pdf_path(pdf_dir, pid)
        if target.exists() and target.stat().st_size >= 1024:
            skipped += 1
            continue
        todo.append(pid)

    log.info("To download: %d  | already present: %d", len(todo), skipped)
    if not todo:
        return 0

    import requests as _r
    sess = _r.Session()
    last_t = 0.0
    n_ok = 0
    n_err = 0
    err_log = pdf_dir / "_errors.log"
    with err_log.open("a", encoding="utf-8") as elog:
        for i, pid in enumerate(todo, 1):
            wait = args.delay - (time.time() - last_t)
            if wait > 0:
                time.sleep(wait)
            last_t = time.time()
            try:
                fetch_pdf(pid, pdf_dir, session=sess)
                n_ok += 1
            except DownloadError as exc:
                n_err += 1
                elog.write(f"{pid}\t{exc}\n")
                elog.flush()
            if i % 50 == 0:
                log.info("Downloaded %d/%d (errors: %d)", i, len(todo), n_err)
    log.info("Download phase done: %d ok, %d failed (see %s)", n_ok, n_err, err_log)
    return 0


def cmd_convert(args: argparse.Namespace) -> int:
    metadata = Path(args.metadata)
    pdf_dir = Path(args.pdf_dir)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = _read_existing_ids(out)
    log.info("Resuming with %d already-converted entries", len(done))

    n_ok = 0
    n_err = 0
    n_skip = 0
    err_log = out.parent / "_convert_errors.log"
    now = datetime.now(timezone.utc).isoformat()

    with out.open("a", encoding="utf-8") as f, err_log.open("a", encoding="utf-8") as elog:
        for row in _filtered_metadata(metadata, args.include_restricted):
            pid = row["id"]
            if pid in done:
                n_skip += 1
                continue
            pdf = pdf_path(pdf_dir, pid)
            if not pdf.exists():
                n_err += 1
                elog.write(f"{pid}\tmissing PDF\n")
                continue
            try:
                text = pdf_to_markdown(pdf)
            except ConversionError as exc:
                n_err += 1
                elog.write(f"{pid}\t{exc}\n")
                continue
            corpus_row = {
                "id": pid,
                "text": text,
                "source": "arxiv-papers",
                "created": row.get("submitted") or "",
                "added": now,
                "metadata": {
                    "license": row.get("license") or "",
                    "authors": row.get("authors") or "",
                    "title": row.get("title") or "",
                    "url": f"https://arxiv.org/abs/{pid}",
                    "categories": row.get("categories") or [],
                    "doi": row.get("doi"),
                    "journal_ref": row.get("journal_ref"),
                },
            }
            f.write(json.dumps(corpus_row, ensure_ascii=False) + "\n")
            f.flush()
            n_ok += 1
            done.add(pid)
            if n_ok % 100 == 0:
                log.info("Converted %d (skipped %d, errors %d)", n_ok, n_skip, n_err)
    log.info("Convert phase done: %d ok, %d skipped, %d errors", n_ok, n_skip, n_err)
    return 0


def cmd_publish(args: argparse.Namespace) -> int:
    corpus = Path(args.corpus)
    if not corpus.exists():
        log.error("Corpus file not found: %s", corpus)
        return 2

    n = 0
    with corpus.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                n += 1
    log.info("Pushing %d-row corpus to %s", n, args.repo)

    push_corpus(
        repo_id=args.repo,
        jsonl_path=corpus,
        n_papers=n,
        from_date=args.from_date or "",
        until_date=args.until_date or "",
        license_filter="redistributable-only" if not args.include_restricted else "all-licenses-included",
        private=args.private,
        token=args.hf_token or os.environ.get("HF_TOKEN"),
    )
    log.info("Publish complete: https://huggingface.co/datasets/%s", args.repo)
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    workdir = Path(args.workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    metadata_path = workdir / "metadata.jsonl"
    pdf_dir = workdir / "pdfs"
    corpus_path = workdir / "corpus.jsonl"

    rc = cmd_harvest(argparse.Namespace(
        out=str(metadata_path),
        from_date=args.from_date,
        until_date=args.until_date,
        set=args.set,
        delay=args.harvest_delay,
        max_pages=args.max_pages,
    ))
    if rc:
        return rc

    rc = cmd_download(argparse.Namespace(
        metadata=str(metadata_path),
        pdf_dir=str(pdf_dir),
        delay=args.download_delay,
        include_restricted=args.include_restricted,
    ))
    if rc:
        return rc

    rc = cmd_convert(argparse.Namespace(
        metadata=str(metadata_path),
        pdf_dir=str(pdf_dir),
        out=str(corpus_path),
        include_restricted=args.include_restricted,
    ))
    if rc:
        return rc

    if args.repo:
        rc = cmd_publish(argparse.Namespace(
            corpus=str(corpus_path),
            repo=args.repo,
            from_date=args.from_date,
            until_date=args.until_date,
            include_restricted=args.include_restricted,
            private=args.private,
            hf_token=args.hf_token,
        ))
        if rc:
            return rc

    log.info("Build complete: workdir=%s", workdir)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="arxiv-corpus")
    parser.add_argument("--verbose", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_h = sub.add_parser("harvest", help="OAI-PMH metadata harvest")
    p_h.add_argument("--from", dest="from_date", required=True, help="YYYY-MM-DD")
    p_h.add_argument("--until", dest="until_date", default=None)
    p_h.add_argument("--out", required=True, help="metadata.jsonl path")
    p_h.add_argument("--set", default=None, help="OAI set spec (e.g. cs, math, physics)")
    p_h.add_argument("--delay", type=float, default=4.0, help="seconds between OAI page requests")
    p_h.add_argument("--max-pages", type=int, default=None)

    p_d = sub.add_parser("download", help="Download PDFs for filtered metadata")
    p_d.add_argument("--metadata", required=True)
    p_d.add_argument("--pdf-dir", required=True)
    p_d.add_argument("--delay", type=float, default=1.5)
    p_d.add_argument("--include-restricted", action="store_true",
                     help="Skip the redistributable-license filter (use only with explicit permission)")

    p_c = sub.add_parser("convert", help="Convert PDFs to markdown corpus.jsonl")
    p_c.add_argument("--metadata", required=True)
    p_c.add_argument("--pdf-dir", required=True)
    p_c.add_argument("--out", required=True)
    p_c.add_argument("--include-restricted", action="store_true")

    p_p = sub.add_parser("publish", help="Push corpus.jsonl to HuggingFace Hub")
    p_p.add_argument("--corpus", required=True)
    p_p.add_argument("--repo", required=True, help="HF dataset repo, e.g. Crownelius/arxiv-papers-2025-2026")
    p_p.add_argument("--from", dest="from_date", default=None)
    p_p.add_argument("--until", dest="until_date", default=None)
    p_p.add_argument("--include-restricted", action="store_true")
    p_p.add_argument("--private", action="store_true")
    p_p.add_argument("--hf-token", default=None, help="HF token (or set HF_TOKEN env var)")

    p_b = sub.add_parser("build", help="Run all phases end-to-end")
    p_b.add_argument("--from", dest="from_date", required=True)
    p_b.add_argument("--until", dest="until_date", default=None)
    p_b.add_argument("--workdir", required=True)
    p_b.add_argument("--repo", default=None, help="If set, publish after build")
    p_b.add_argument("--set", default=None)
    p_b.add_argument("--harvest-delay", type=float, default=4.0)
    p_b.add_argument("--download-delay", type=float, default=1.5)
    p_b.add_argument("--max-pages", type=int, default=None)
    p_b.add_argument("--include-restricted", action="store_true")
    p_b.add_argument("--private", action="store_true")
    p_b.add_argument("--hf-token", default=None)

    args = parser.parse_args(argv)
    _setup_logging(args.verbose)
    cmd = args.cmd
    if cmd == "harvest":
        return cmd_harvest(args)
    if cmd == "download":
        return cmd_download(args)
    if cmd == "convert":
        return cmd_convert(args)
    if cmd == "publish":
        return cmd_publish(args)
    if cmd == "build":
        return cmd_build(args)
    parser.error(f"unknown command: {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
