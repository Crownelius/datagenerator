# datagenerator

CLI for generating JSONL datasets from a TXT file or an arxiv (Hugging Face Hub) stream using LLMs. Multi-turn conversation templates, OpenRouter routing, free-tier key spawning, optional reasoning capture.

Fork of [@teichai/datagen](https://github.com/TeichAI/datagen) (Apache 2.0). Adds:

- `--source arxiv` — stream papers from `common-pile/arxiv_papers` (or any HF dataset with the same shape) via the HF Datasets Server API
- `--template <yaml>` — multi-turn conversation per record, with `{placeholder}` substitution from record fields
- An `examples/arxiv.yaml` template that produces a 4-turn analysis per paper (explain → improve field → flaws → improve idea)

## Install

```bash
npm i -g @crownelius/datagenerator
```

Or local + npx:

```bash
npm i -D @crownelius/datagenerator
npx datagenerator --help
```

The `datagen` binary is also installed as an alias for backwards compatibility with the upstream tool.

## Quick start: TXT prompts (single-turn)

```bash
export API_KEY="your_openrouter_key"
echo "Explain the CAP theorem in 5 bullet points." > prompts.txt
datagenerator --model openai/gpt-oss-120b:free --prompts prompts.txt
```

## Quick start: arxiv (multi-turn)

```bash
export API_KEY="your_openrouter_key"
datagenerator \
  --model openai/gpt-oss-120b:free \
  --source arxiv \
  --template examples/arxiv.yaml \
  --source.limit 50 \
  --reasoningEffort high \
  --concurrent 10 \
  --out arxiv_dataset.jsonl
```

For each paper streamed from `common-pile/arxiv_papers`, the model runs the 4-turn template defined in `examples/arxiv.yaml`. Each output line is one paper's full conversation as a `messages` array, with `metadata` (paper id + title) attached.

### Output format

Single-turn (TXT source) — each line:

```json
{"messages":[{"role":"user","content":"..."},{"role":"assistant","thinking":"...","content":"..."}]}
```

Multi-turn (arxiv source) — each line:

```json
{"messages":[
  {"role":"system","content":"You are a senior research scientist..."},
  {"role":"user","content":"Below is the text of arxiv paper 0704.3395..."},
  {"role":"assistant","thinking":"...","content":"..."},
  {"role":"user","content":"How can this paper improve the field..."},
  {"role":"assistant","thinking":"...","content":"..."},
  ...
],"metadata":{"id":"0704.3395","title":"..."}}
```

Pass `--save-old-format` to embed `<think>...</think>` inside `content` instead (DeepSeek-R1 / Kimi convention).

## Configuration file

Same flags can be loaded from a YAML/JSON config:

```yaml
model: openai/gpt-oss-120b:free
out: ./arxiv.jsonl
source: arxiv
template: ./examples/arxiv.yaml
reasoningEffort: high
concurrent: 10
source:
  dataset: common-pile/arxiv_papers
  limit: 250
  offset: 0
openrouter:
  providerSort: throughput
```

```bash
datagenerator --config config.yaml
```

## Templates

A template is YAML or JSON with:

- `system` (string, optional) — system prompt
- `turns` (string array, required) — one entry per turn; each turn is a user prompt with `{placeholder}` substitution from record fields
- `metadataKeys` (string array, optional) — record fields to attach to the output line as `metadata`

For arxiv records, available fields are: `id`, `text`, `title`, `source`, plus any flat scalar fields under `metadata` (e.g. `license`, `authors`, `submitter`, `url`).

The model is given the FULL conversation context on each turn (system + all prior user/assistant pairs + the new user turn). Earlier turns' assistant outputs become context for later turns.

## Options

All upstream options:

- `--model <name>` — required.
- `--prompts <file>` — required when `--source txt` (default).
- `--out <file>` — output JSONL (default `dataset.jsonl`).
- `--api <baseUrl>` — API base (default OpenRouter).
- `--system <text>` — system prompt for single-turn TXT mode.
- `--store-system true|false` — store system message in output (default `true`).
- `--concurrent <num>` — parallel records in flight (default `1`).
- `--openrouter.isFree true|false` — treat `API_KEY` as a management key; auto-create per-request keys for free models.
- `--openrouter.provider <slugs>` — comma-separated provider slugs.
- `--openrouter.providerSort <price|throughput|latency>` — provider routing sort.
- `--reasoningEffort <none|minimal|low|medium|high|xhigh>` — passes through as `reasoning.effort`.
- `--save-old-format` — store assistant reasoning in legacy `<think>` tags inside content.
- `--dataset-readme [file]` — generate a HF-Hub-ready dataset card.
- `--timeout <ms>` — request timeout.
- `--no-progress` — disable progress bar.

Multi-turn / arxiv:

- `--source <txt|arxiv>` — input source (default `txt`).
- `--template <file>` — multi-turn template (required when `--source arxiv`; optional otherwise — currently TXT mode does not consume templates).
- `--source.dataset <id>` — HF Hub dataset id (default `common-pile/arxiv_papers`).
- `--source.config <name>` — HF dataset config (default `default`).
- `--source.split <name>` — HF dataset split (default `train`).
- `--source.limit <n>` — max records to process.
- `--source.offset <n>` — skip the first N records.

## Development

```bash
npm install
npm run build
npm test
```

## Attribution

Forked from [TeichAI/datagen](https://github.com/TeichAI/datagen) — Apache 2.0. Original CLI design, OpenRouter routing, free-key spawning, progress bar, dataset-README generator are from the upstream project. Multi-turn template engine and arxiv source are additions in this fork.

## License

Apache-2.0 (inherits from upstream).
