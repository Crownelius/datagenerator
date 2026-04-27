export type ArxivRow = {
  id: string;
  text: string;
  title?: string;
  source: string;
  metadata: { [k: string]: any };
};

export type ArxivStreamOpts = {
  dataset?: string;
  config?: string;
  split?: string;
  offset?: number;
  limit?: number;
  pageSize?: number;
  fetchImpl?: typeof fetch;
};

const HF_DATASETS_SERVER = "https://datasets-server.huggingface.co/rows";
const DEFAULT_DATASET = "common-pile/arxiv_papers";
const DEFAULT_CONFIG = "default";
const DEFAULT_SPLIT = "train";
const MAX_PAGE = 100;

export function buildHfRowsUrl(opts: {
  dataset: string;
  config: string;
  split: string;
  offset: number;
  length: number;
}): string {
  const params = new URLSearchParams({
    dataset: opts.dataset,
    config: opts.config,
    split: opts.split,
    offset: String(opts.offset),
    length: String(opts.length)
  });
  return `${HF_DATASETS_SERVER}?${params.toString()}`;
}

export function rowToArxivRow(raw: any): ArxivRow {
  const inner = raw?.row ?? raw ?? {};
  const meta = inner.metadata && typeof inner.metadata === "object" ? inner.metadata : {};
  return {
    id: String(inner.id ?? inner.paper_id ?? ""),
    text: typeof inner.text === "string" ? inner.text : "",
    title: typeof inner.title === "string" ? inner.title : (typeof meta.title === "string" ? meta.title : undefined),
    source: typeof inner.source === "string" ? inner.source : "arxiv-papers",
    metadata: meta
  };
}

export async function* streamArxivRows(opts: ArxivStreamOpts = {}): AsyncGenerator<ArxivRow> {
  const dataset = opts.dataset ?? DEFAULT_DATASET;
  const config = opts.config ?? DEFAULT_CONFIG;
  const split = opts.split ?? DEFAULT_SPLIT;
  const startOffset = opts.offset ?? 0;
  const limit = opts.limit ?? Infinity;
  const pageSize = Math.min(MAX_PAGE, opts.pageSize ?? MAX_PAGE);
  const fetchImpl = opts.fetchImpl ?? fetch;

  let offset = startOffset;
  let yielded = 0;

  while (yielded < limit) {
    const remaining = limit - yielded;
    const length = Math.min(pageSize, remaining);
    const url = buildHfRowsUrl({ dataset, config, split, offset, length });
    let attempt = 0;
    let res: Response | null = null;
    while (attempt < 5) {
      res = await fetchImpl(url);
      if (res.ok) break;
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(60_000, 1000 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, wait));
        attempt++;
        continue;
      }
      const body = await res.text().catch(() => "");
      throw new Error(`HF Datasets Server ${res.status} on ${url}: ${body.slice(0, 300)}`);
    }
    if (!res || !res.ok) {
      throw new Error(`HF Datasets Server failed after retries: ${url}`);
    }
    const data = (await res.json()) as any;
    const rows: any[] = Array.isArray(data?.rows) ? data.rows : [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const row = rowToArxivRow(r);
      if (!row.id || row.text.length < 100) continue;
      yield row;
      yielded++;
      if (yielded >= limit) return;
    }
    offset += rows.length;
    if (rows.length < length) break;
  }
}
