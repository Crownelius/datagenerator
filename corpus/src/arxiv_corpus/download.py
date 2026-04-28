"""Polite PDF downloader for arxiv papers.

Targets `https://arxiv.org/pdf/<id>.pdf` directly. arxiv asks bulk users to
either go through the paid S3 bucket or be very gentle with the website;
we default to a 1.5-second sleep between requests and a small exponential
backoff on 429/5xx. Skip-existing means re-running is cheap.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Iterable

import requests

from .oai import DEFAULT_USER_AGENT

ARXIV_PDF_URL = "https://arxiv.org/pdf/{id}.pdf"
DEFAULT_DELAY_SECONDS = 1.5
DEFAULT_TIMEOUT = 120

log = logging.getLogger(__name__)


class DownloadError(Exception):
    pass


def pdf_path(out_dir: Path, paper_id: str) -> Path:
    safe = paper_id.replace("/", "_")
    bucket = safe[:4] if len(safe) >= 4 else safe
    return out_dir / bucket / f"{safe}.pdf"


def already_downloaded(path: Path, *, min_bytes: int = 1024) -> bool:
    return path.exists() and path.stat().st_size >= min_bytes


def fetch_pdf(
    paper_id: str,
    out_dir: Path,
    *,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> Path:
    target = pdf_path(out_dir, paper_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    if already_downloaded(target):
        return target

    url = ARXIV_PDF_URL.format(id=paper_id)
    sess = session or requests.Session()
    sess.headers.setdefault("User-Agent", DEFAULT_USER_AGENT)
    sess.headers.setdefault("Accept", "application/pdf")

    backoff = 5.0
    last_err = ""
    for attempt in range(5):
        try:
            r = sess.get(url, timeout=timeout, stream=True)
        except requests.RequestException as exc:
            last_err = str(exc)
            time.sleep(backoff)
            backoff = min(backoff * 2, 120)
            continue
        if r.status_code == 200:
            tmp = target.with_suffix(".pdf.tmp")
            with tmp.open("wb") as f:
                for chunk in r.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        f.write(chunk)
            tmp.replace(target)
            return target
        if r.status_code in (429, 500, 502, 503, 504):
            wait = int(r.headers.get("Retry-After", "0")) or backoff
            last_err = f"http {r.status_code}"
            time.sleep(min(wait, 300))
            backoff = min(backoff * 2, 120)
            continue
        if r.status_code == 404:
            raise DownloadError(f"PDF not found for arxiv id {paper_id} (404)")
        last_err = f"http {r.status_code}: {r.text[:200]}"
        break
    raise DownloadError(f"Download failed for {paper_id}: {last_err}")


def fetch_many(
    paper_ids: Iterable[str],
    out_dir: Path,
    *,
    delay_seconds: float = DEFAULT_DELAY_SECONDS,
    session: requests.Session | None = None,
) -> Iterable[tuple[str, Path | None, str | None]]:
    """Yield (id, path, error). Polite delay between requests."""
    sess = session or requests.Session()
    sess.headers.setdefault("User-Agent", DEFAULT_USER_AGENT)
    last_t = 0.0
    for pid in paper_ids:
        target = pdf_path(out_dir, pid)
        if already_downloaded(target):
            yield pid, target, None
            continue
        wait = delay_seconds - (time.time() - last_t)
        if wait > 0:
            time.sleep(wait)
        last_t = time.time()
        try:
            path = fetch_pdf(pid, out_dir, session=sess)
            yield pid, path, None
        except DownloadError as exc:
            log.warning("download failed for %s: %s", pid, exc)
            yield pid, None, str(exc)
