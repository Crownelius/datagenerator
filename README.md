# Datagenerator-arxiv

End-to-end pipeline for building LLM training datasets from arxiv (and other sources). Two tools in one repo:

- **TS CLI at the root** — `datagen`. Onboarding wizard, multi-source streaming, multi-turn templates, OpenRouter (or any OpenAI-compatible API), runtime REPL controls.
- **Python tool under `corpus/`** — `arxiv-corpus`. Builds a fresh post-2024 arxiv corpus (OAI-PMH metadata + direct PDF download + `pymupdf4llm` markdown conversion) and pushes it to HuggingFace Hub in the `common-pile/arxiv_papers` schema.

The two compose: `arxiv-corpus` builds the corpus → publishes to HF → `datagen` consumes the corpus and produces a multi-turn JSONL dataset for SFT.

Forked from [TeichAI/datagen](https://github.com/TeichAI/datagen) (Apache 2.0). Adds onboarding, config files, runtime mutability, multi-source plugins, and the bundled corpus-builder.

## Install

```bash
git clone https://github.com/Crownelius/Datagenerator-arxiv
cd Datagenerator-arxiv
npm install && npm run build
npm install -g .   # or: npm link

# Optional: install the corpus builder
pip install -e ./corpus
```

## Quick start

```bash
datagen
```

First run with no config triggers an interactive onboarding wizard. Pick sources, paste OpenRouter key(s) or a management key, set concurrency. Config saved to `~/.dataclaw/config.yaml`.

Subsequent runs use the saved config:

```bash
datagen run
```

## Onboarding (first run)

```
  ════════════════════════════════════════════════════════════
    Welcome to Datagenerator-arxiv. First-run setup.
  ════════════════════════════════════════════════════════════

Pick one or more data sources:
  1) arxiv (HuggingFace common-pile)
  2) arxiv (local corpus from corpus-builder)
  3) TXT prompts (one per line)
  4) Custom HuggingFace dataset
  5) Local JSONL file
Choose (comma-separated, e.g. 1,3): 1

Concurrency for "arxiv" (10): 10

OpenRouter setup mode:
  1) Skip OpenRouter
  2) Provide one or more inference keys
  3) Provide one management key (auto-spawn sub-keys at runtime)
Choose: 3
OpenRouter management key: ********
Number of sub-keys to auto-spawn (10): 10

Default model (openai/gpt-oss-120b:free): openai/gpt-oss-120b:free
Reasoning effort (high): high
Output JSONL path (./dataset.jsonl): ./dataset.jsonl
Use a multi-turn template? [Y/n]: y
Template path (./examples/arxiv.yaml): ./examples/arxiv.yaml

  ✓ Saved config to /home/you/.dataclaw/config.yaml
```

## Config file

Single source of truth for the run. Edit by hand or via `datagen onboard`. Example:

```yaml
model: openai/gpt-oss-120b:free
reasoning_effort: high
output: ./dataset.jsonl
template: ./examples/arxiv.yaml

providers:
  openrouter:
    # Mode A: list any number of inference keys; round-robin across them
    keys:
      - sk-or-v1-...
      - sk-or-v1-...
      - sk-or-v1-...

    # OR Mode B (mutually exclusive with `keys`):
    # one management key, the program auto-spawns N ephemeral sub-keys
    # at startup and deletes them on exit.
    # management_key: sk-or-v1-...
    # auto_spawn_count: 10

  # Optional additional providers
  anthropic:
    keys: [sk-ant-...]
  openai:
    keys: [sk-...]

sources:
  - name: arxiv
    type: arxiv-hf
    dataset: common-pile/arxiv_papers
    concurrency: 10
  - name: corpus
    type: arxiv-corpus
    path: ./corpus/work/corpus.jsonl
    concurrency: 5
```

Lookup order: `./dataclaw.yaml` (project-local), then `~/.dataclaw/config.yaml` (global).

## Runtime REPL

Once a run starts, type colon-commands at any time:

```
:c <N>            set concurrency for ALL active sources
:c <src> <N>      set concurrency for one source
:m <model>        change model
:r <effort>       set reasoning effort
:src add <name>   enable a configured source
:src rm <name>    disable a source (in-flight requests finish)
:pause            pause new starts
:resume           resume
:status           show full state
:help             list commands
:q                graceful quit, drain in-flight, save state
```

All changes hot-apply without restart.

## Source types

| Type | Description |
|---|---|
| `arxiv-hf` | Stream a HuggingFace arxiv dataset (default `common-pile/arxiv_papers`) |
| `arxiv-corpus` | Read a local JSONL produced by the bundled `corpus/` Python tool |
| `txt` | One prompt per line in a TXT file (legacy single-turn) |
| `jsonl` | Generic JSONL with `id` + `text` fields |
| `hf-dataset` | Any HuggingFace dataset with `id` + `text` fields |

## Multi-key vs management-key

- **`keys` list** — fan out across N user-provided keys. Use this when you've already created multiple OpenRouter (or NVIDIA, OpenAI, etc.) accounts/keys.
- **`management_key` + `auto_spawn_count`** — give the program your OpenRouter management key and it creates N ephemeral sub-keys at start, uses them, deletes them on `:q`. Bills attribute to the management key. Convenient for free-tier work. **OpenRouter only** — no other provider has an equivalent key-spawning API.

## Providers

`source.provider` selects which configured provider routes that source's requests. Each provider can have its own keys and its own model namespace.

| Provider | API base | Mode B (auto-spawn) | Notes |
|---|---|---|---|
| `openrouter` (default) | `openrouter.ai/api/v1` | ✓ | Aggregator with widest model selection |
| `nvidia` | `integrate.api.nvidia.com/v1` | ✗ | NVIDIA Build / NIM, OpenAI-compatible. 40 RPM free tier. Use multi-key fan-out across multiple NVIDIA accounts |
| `openai` | `api.openai.com/v1` | ✗ | OpenAI direct |
| `together` | `api.together.xyz/v1` | ✗ | Together AI |
| `fireworks` | `api.fireworks.ai/inference/v1` | ✗ | Fireworks AI |
| `deepinfra` | `api.deepinfra.com/v1/openai` | ✗ | DeepInfra |

### NVIDIA example

```yaml
model: meta/llama-3.1-405b-instruct
output: ./nvidia-out.jsonl
template: ./examples/arxiv.yaml

providers:
  nvidia:
    keys:
      - nvapi-...           # add multiple for higher effective RPM (40 RPM each)
      - nvapi-...
      - nvapi-...

sources:
  - name: arxiv
    type: arxiv-hf
    provider: nvidia        # this source uses the nvidia keys
    model: nvidia/nemotron-4-340b-instruct   # override the global model for this source
    dataset: common-pile/arxiv_papers
    concurrency: 6          # 6 across 3 keys keeps you under 40 RPM per key
```

NVIDIA model namespace examples: `nvidia/nemotron-4-340b-instruct`, `meta/llama-3.1-405b-instruct`, `meta/llama-3.3-70b-instruct`, `deepseek-ai/deepseek-r1`, `openai/gpt-oss-120b`. See https://build.nvidia.com/explore/discover for the full catalog.

### Mixed providers in one config

Sources can use different providers in the same run:

```yaml
sources:
  - name: arxiv-fast
    type: arxiv-hf
    provider: openrouter
    model: openai/gpt-oss-20b:free
    concurrency: 8
  - name: arxiv-deep
    type: arxiv-corpus
    path: ./corpus/work/corpus.jsonl
    provider: nvidia
    model: nvidia/nemotron-4-340b-instruct
    concurrency: 4
```

Both sources run concurrently. Each routes to its own provider's keys + base URL.

## Corpus builder (Python, under `./corpus/`)

Free pipeline for building a fresh post-2024 arxiv corpus and publishing it to HuggingFace Hub. See [`corpus/README.md`](corpus/README.md).

```bash
pip install -e ./corpus
arxiv-corpus build --from 2025-01-01 --until 2026-04-27 --workdir ./work \
  --repo Crownelius/arxiv-papers-2025-2026
```

Outputs JSONL in the `common-pile/arxiv_papers` schema, drop-in compatible with the `arxiv-hf` source above.

## Legacy CLI (TXT mode)

The original `@teichai/datagen` CLI is still supported for backwards compatibility:

```bash
datagen --model openai/gpt-oss-120b:free --prompts prompts.txt --concurrent 5
```

Any invocation with explicit `--model`/`--prompts` flags falls through to legacy mode. The new modes are activated by `datagen onboard` (wizard), `datagen run` (config-driven), or `datagen` with no args (auto-detects).

## Attribution

- Forked from [TeichAI/datagen](https://github.com/TeichAI/datagen) — original CLI design, OpenRouter routing, free-tier sub-key spawning, progress bar, dataset-card generator
- Multi-turn templates, arxiv source, onboarding wizard, REPL, runtime mutability, multi-source plugins, multi-key fan-out, and the bundled `corpus/` Python tool are additions in this fork

## License

Apache-2.0 (inherits from upstream).
