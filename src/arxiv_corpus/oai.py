"""arxiv OAI-PMH metadata harvester.

Uses the `arXivRaw` metadata format which exposes the paper's license URL
in addition to title/authors/abstract/categories/dates. Resumption tokens
let the harvest continue across requests, and the OAI-PMH endpoint
respects from/until date windows.

References:
- https://info.arxiv.org/help/oa/index.html
- https://www.openarchives.org/OAI/openarchivesprotocol.html
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterator
from xml.etree import ElementTree as ET

import requests

OAI_ENDPOINT = "https://export.arxiv.org/oai2"
NS = {
    "oai": "http://www.openarchives.org/OAI/2.0/",
    "raw": "http://arxiv.org/OAI/arXivRaw/",
}
DEFAULT_USER_AGENT = "arxiv-corpus-builder/0.1 (https://github.com/Crownelius/arxiv-corpus-builder)"
POLITE_DELAY_SECONDS = 4.0


@dataclass
class PaperMetadata:
    id: str
    title: str
    authors: str
    abstract: str
    categories: list[str]
    license: str | None
    submitted: str
    updated: str | None
    doi: str | None = None
    journal_ref: str | None = None
    raw: dict = field(default_factory=dict)


class OAIHarvestError(Exception):
    pass


def _text(elem: ET.Element | None) -> str | None:
    if elem is None or elem.text is None:
        return None
    return elem.text.strip()


def _normalize(text: str | None) -> str | None:
    if text is None:
        return None
    return re.sub(r"\s+", " ", text).strip() or None


def _parse_records(xml: bytes) -> tuple[list[PaperMetadata], str | None]:
    root = ET.fromstring(xml)
    error = root.find("oai:error", NS)
    if error is not None:
        code = error.get("code", "unknown")
        message = (error.text or "").strip()
        if code == "noRecordsMatch":
            return [], None
        raise OAIHarvestError(f"OAI error {code}: {message}")

    records_root = root.find("oai:ListRecords", NS)
    if records_root is None:
        return [], None

    out: list[PaperMetadata] = []
    for record in records_root.findall("oai:record", NS):
        header = record.find("oai:header", NS)
        if header is not None and header.get("status") == "deleted":
            continue
        meta = record.find("oai:metadata/raw:arXivRaw", NS)
        if meta is None:
            continue
        pid = _text(meta.find("raw:id", NS))
        if not pid:
            continue
        title = _normalize(_text(meta.find("raw:title", NS))) or ""
        abstract = _normalize(_text(meta.find("raw:abstract", NS))) or ""
        authors = _normalize(_text(meta.find("raw:authors", NS))) or ""
        cat_elem = meta.find("raw:categories", NS)
        cats = (cat_elem.text or "").split() if cat_elem is not None else []
        license_url = _text(meta.find("raw:license", NS))
        versions = meta.findall("raw:version", NS)
        submitted = ""
        updated = None
        for v in versions:
            d = _text(v.find("raw:date", NS))
            if not d:
                continue
            if not submitted:
                submitted = d
            updated = d
        doi = _text(meta.find("raw:doi", NS))
        journal_ref = _text(meta.find("raw:journal-ref", NS))
        out.append(
            PaperMetadata(
                id=pid,
                title=title,
                authors=authors,
                abstract=abstract,
                categories=cats,
                license=license_url,
                submitted=submitted,
                updated=updated,
                doi=doi,
                journal_ref=journal_ref,
                raw={},
            )
        )

    token_elem = records_root.find("oai:resumptionToken", NS)
    token = (token_elem.text or "").strip() if token_elem is not None and token_elem.text else None
    return out, token


def _format_date(d: date | datetime | str | None) -> str | None:
    if d is None:
        return None
    if isinstance(d, str):
        return d
    if isinstance(d, datetime):
        return d.date().isoformat()
    return d.isoformat()


def harvest(
    *,
    from_date: date | datetime | str | None = None,
    until_date: date | datetime | str | None = None,
    metadata_prefix: str = "arXivRaw",
    set_spec: str | None = None,
    delay_seconds: float = POLITE_DELAY_SECONDS,
    session: requests.Session | None = None,
    max_pages: int | None = None,
) -> Iterator[PaperMetadata]:
    """Yield PaperMetadata for every record in the OAI-PMH window.

    Honours arxiv's polite-delay convention (4 seconds between page requests).
    """
    sess = session or requests.Session()
    sess.headers.setdefault("User-Agent", DEFAULT_USER_AGENT)

    params: dict[str, str] = {"verb": "ListRecords", "metadataPrefix": metadata_prefix}
    fdt = _format_date(from_date)
    if fdt:
        params["from"] = fdt
    udt = _format_date(until_date)
    if udt:
        params["until"] = udt
    if set_spec:
        params["set"] = set_spec

    pages = 0
    while True:
        for attempt in range(5):
            r = sess.get(OAI_ENDPOINT, params=params, timeout=120)
            if r.status_code == 200:
                break
            if r.status_code == 503:
                wait = int(r.headers.get("Retry-After", "30"))
                time.sleep(min(wait, 300))
                continue
            r.raise_for_status()
        else:
            raise OAIHarvestError(f"OAI request failed after retries: {r.status_code}")

        records, token = _parse_records(r.content)
        for rec in records:
            yield rec

        pages += 1
        if max_pages is not None and pages >= max_pages:
            return
        if not token:
            return
        params = {"verb": "ListRecords", "resumptionToken": token}
        time.sleep(delay_seconds)
