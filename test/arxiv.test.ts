import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHfRowsUrl, rowToArxivRow, streamArxivRows } from "../src/sources/arxiv.js";

test("buildHfRowsUrl encodes parameters correctly", () => {
  const url = buildHfRowsUrl({
    dataset: "common-pile/arxiv_papers",
    config: "default",
    split: "train",
    offset: 100,
    length: 50
  });
  assert.match(url, /datasets-server\.huggingface\.co\/rows/);
  assert.match(url, /dataset=common-pile%2Farxiv_papers/);
  assert.match(url, /offset=100/);
  assert.match(url, /length=50/);
});

test("rowToArxivRow extracts canonical fields from nested HF response", () => {
  const r = rowToArxivRow({
    row_idx: 0,
    row: {
      id: "0704.3395",
      text: "...".repeat(100),
      source: "arxiv-papers",
      metadata: { license: "Public Domain", title: "Test Paper" }
    }
  });
  assert.equal(r.id, "0704.3395");
  assert.equal(r.title, "Test Paper");
  assert.equal(r.source, "arxiv-papers");
  assert.equal(r.metadata.license, "Public Domain");
});

test("rowToArxivRow handles missing metadata gracefully", () => {
  const r = rowToArxivRow({ row: { id: "x", text: "y" } });
  assert.equal(r.id, "x");
  assert.deepEqual(r.metadata, {});
});

test("streamArxivRows paginates via injected fetch and respects limit", async () => {
  let calls = 0;
  const fetchImpl = async (url: string | URL | Request) => {
    calls++;
    const u = typeof url === "string" ? url : url.toString();
    const offset = Number(new URL(u).searchParams.get("offset"));
    const rows = [
      { row: { id: `p${offset + 0}`, text: "x".repeat(200), source: "arxiv-papers", metadata: {} } },
      { row: { id: `p${offset + 1}`, text: "y".repeat(200), source: "arxiv-papers", metadata: {} } }
    ];
    return new Response(JSON.stringify({ rows, num_rows_total: 1000 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const out: string[] = [];
  for await (const r of streamArxivRows({ pageSize: 2, limit: 5, fetchImpl })) {
    out.push(r.id);
  }
  assert.equal(out.length, 5);
  assert.equal(calls >= 3, true);
});

test("streamArxivRows skips records with text shorter than 100 chars", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        rows: [
          { row: { id: "short", text: "tiny", metadata: {} } },
          { row: { id: "ok", text: "x".repeat(200), metadata: {} } }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const out: string[] = [];
  for await (const r of streamArxivRows({ pageSize: 100, limit: 10, fetchImpl })) {
    out.push(r.id);
  }
  assert.deepEqual(out, ["ok"]);
});
