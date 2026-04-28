from arxiv_corpus.oai import _parse_records


SAMPLE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <ListRecords>
    <record>
      <header>
        <identifier>oai:arXiv.org:2501.12345</identifier>
        <datestamp>2025-01-15</datestamp>
      </header>
      <metadata>
        <arXivRaw xmlns="http://arxiv.org/OAI/arXivRaw/">
          <id>2501.12345</id>
          <title>A Test Paper on Things</title>
          <authors>Alice; Bob</authors>
          <abstract> A short abstract about something.  </abstract>
          <categories>cs.LG cs.AI</categories>
          <license>http://creativecommons.org/licenses/by/4.0/</license>
          <version version="v1"><date>2025-01-15</date></version>
          <version version="v2"><date>2025-02-01</date></version>
          <doi>10.1234/test.2025.12345</doi>
        </arXivRaw>
      </metadata>
    </record>
    <record>
      <header status="deleted">
        <identifier>oai:arXiv.org:2501.99999</identifier>
        <datestamp>2025-01-15</datestamp>
      </header>
    </record>
    <resumptionToken>next-page-token-abc</resumptionToken>
  </ListRecords>
</OAI-PMH>
"""


def test_parse_records_extracts_fields() -> None:
    records, token = _parse_records(SAMPLE_XML)
    assert token == "next-page-token-abc"
    assert len(records) == 1
    p = records[0]
    assert p.id == "2501.12345"
    assert p.title == "A Test Paper on Things"
    assert p.authors == "Alice; Bob"
    assert p.abstract == "A short abstract about something."
    assert p.categories == ["cs.LG", "cs.AI"]
    assert p.license == "http://creativecommons.org/licenses/by/4.0/"
    assert p.submitted == "2025-01-15"
    assert p.updated == "2025-02-01"
    assert p.doi == "10.1234/test.2025.12345"


def test_parse_records_skips_deleted() -> None:
    records, _ = _parse_records(SAMPLE_XML)
    assert all(r.id != "2501.99999" for r in records)


NO_RECORDS_XML = b"""<?xml version="1.0"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <error code="noRecordsMatch">No records match.</error>
</OAI-PMH>
"""


def test_parse_records_handles_no_records_match() -> None:
    records, token = _parse_records(NO_RECORDS_XML)
    assert records == []
    assert token is None
