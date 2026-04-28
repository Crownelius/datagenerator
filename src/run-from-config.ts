import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, type DataclawConfig, type SourceConfig } from "./dataclaw-config.js";
import {
  callOpenRouterMessages,
  executeMultiTurn,
  buildOutputMessages
} from "./index.js";
import { loadTemplate, expandPlaceholders, type Template, type Record as TemplateRecord } from "./template.js";
import { streamArxivRows, type ArxivRow } from "./sources/arxiv.js";
import {
  createOpenRouterApiKey,
  deleteOpenRouterApiKey
} from "./openrouter.js";
import { Runtime, type RuntimeState } from "./runtime.js";
import { startRepl } from "./repl.js";
import { resolveProvider } from "./providers.js";

type RunOpts = { configPath?: string };

type ProviderKeyPool = {
  apiBase: string;
  keys: string[];
  spawnedHashes: string[];
  managementKey?: string;
};

type ProviderKeyPools = { [providerName: string]: ProviderKeyPool };

async function setupProviderKeys(cfg: DataclawConfig): Promise<ProviderKeyPools> {
  const pools: ProviderKeyPools = {};
  for (const [name, provider] of Object.entries(cfg.providers)) {
    const spec = resolveProvider(name);
    const apiBase = name === "openrouter" && cfg.api ? cfg.api : spec.apiBase;

    if (provider.keys && provider.keys.length > 0) {
      pools[name] = { apiBase, keys: [...provider.keys], spawnedHashes: [] };
      continue;
    }

    if (provider.management_key) {
      if (!spec.supportsKeySpawning) {
        throw new Error(
          `Provider "${name}" does not support management_key auto-spawn. ` +
          `Use \`keys: [...]\` instead.`
        );
      }
      const count = provider.auto_spawn_count ?? 10;
      console.log(`[${name}] Spawning ${count} sub-keys from management key...`);
      const baseName = `dataclaw-${Date.now()}`;
      const created = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          createOpenRouterApiKey(apiBase, provider.management_key as string, `${baseName}-${i + 1}`)
        )
      );
      pools[name] = {
        apiBase,
        keys: created.map((c) => c.key),
        spawnedHashes: created.map((c) => c.hash).filter((h): h is string => typeof h === "string"),
        managementKey: provider.management_key
      };
      continue;
    }

    throw new Error(`Provider "${name}" has neither \`keys\` nor \`management_key\`. Run 'datagen onboard'.`);
  }
  return pools;
}

async function teardownAllPools(pools: ProviderKeyPools): Promise<void> {
  for (const [name, pool] of Object.entries(pools)) {
    if (!pool.managementKey || pool.spawnedHashes.length === 0) continue;
    console.log(`[${name}] Cleaning up ${pool.spawnedHashes.length} spawned sub-keys...`);
    for (const hash of pool.spawnedHashes) {
      try {
        await deleteOpenRouterApiKey(pool.apiBase, pool.managementKey, hash);
      } catch (err) {
        console.warn(`[${name}] Failed to delete sub-key ${hash}: ${(err as any)?.message ?? err}`);
      }
    }
  }
}

function recordFromArxiv(row: ArxivRow): TemplateRecord {
  const r: TemplateRecord = {
    id: row.id,
    text: row.text,
    title: row.title ?? "",
    source: row.source
  };
  for (const [k, v] of Object.entries(row.metadata)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      r[k] = v as any;
    }
  }
  return r;
}

async function runOneSource(
  src: SourceConfig,
  runtime: Runtime,
  cfg: DataclawConfig,
  template: Template | null,
  pools: ProviderKeyPools,
  outStream: ReturnType<typeof createWriteStream>,
  stats: { ok: number; err: number; inFlight: number; total: number; spentUsd: number }
): Promise<void> {
  const providerName = src.provider ?? "openrouter";
  const pool = pools[providerName];
  if (!pool) {
    throw new Error(`Source "${src.name}" requires provider "${providerName}" but no keys are configured.`);
  }
  const sourceModel = src.model ?? cfg.model;
  let keyIdx = 0;
  const acquireKey = (): string => {
    const k = pool.keys[keyIdx % pool.keys.length];
    keyIdx++;
    return k;
  };

  const inFlight = new Set<Promise<void>>();
  const slotWait = async () => {
    while (true) {
      const sourceState = runtime.state.sources.find((s) => s.name === src.name);
      if (!sourceState || !sourceState.enabled) return;
      const cap = sourceState.concurrency;
      if (!runtime.state.paused && inFlight.size < cap) return;
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      } else {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  };

  const handleRecord = (record: TemplateRecord) => {
    const p = (async () => {
      stats.inFlight++;
      try {
        const apiKey = acquireKey();
        const modelToUse = src.model ?? runtime.model ?? sourceModel;
        if (!template) {
          const userContent = String(record.text ?? "");
          const messages = [{ role: "user" as const, content: userContent }];
          const { content, reasoning } = await callOpenRouterMessages(
            pool.apiBase, apiKey, modelToUse, messages, undefined, runtime.reasoningEffort
          );
          const out = buildOutputMessages(
            "", userContent, content, false, reasoning, cfg.save_old_format ?? false
          );
          outStream.write(JSON.stringify({ messages: out, _provider: providerName }) + "\n");
        } else {
          const { messages } = await executeMultiTurn(
            pool.apiBase, apiKey, modelToUse, template, record,
            cfg.save_old_format ?? false,
            cfg.store_system ?? true,
            undefined, runtime.reasoningEffort, cfg.timeout ?? null
          );
          const outRow: { messages: typeof messages; metadata?: { [k: string]: any }; _provider: string } = {
            messages,
            _provider: providerName
          };
          if (template.metadataKeys && template.metadataKeys.length > 0) {
            const meta: { [k: string]: any } = {};
            for (const k of template.metadataKeys) {
              const v = (record as any)[k];
              if (v !== undefined) meta[k] = v;
            }
            if (Object.keys(meta).length > 0) outRow.metadata = meta;
          }
          outStream.write(JSON.stringify(outRow) + "\n");
        }
        stats.ok++;
      } catch (err: any) {
        stats.err++;
        console.error(`[${src.name}/${providerName}] error: ${err?.message ?? err}`);
      } finally {
        stats.inFlight--;
        stats.total++;
      }
    })();
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
  };

  if (src.type === "arxiv-hf" || src.type === "hf-dataset") {
    const dataset = src.dataset ?? "common-pile/arxiv_papers";
    for await (const row of streamArxivRows({
      dataset,
      config: src.config,
      split: src.split ?? "train",
      offset: src.offset,
      limit: src.limit
    })) {
      const sourceState = runtime.state.sources.find((s) => s.name === src.name);
      if (!sourceState || !sourceState.enabled) break;
      await slotWait();
      handleRecord(recordFromArxiv(row));
    }
  } else if (src.type === "arxiv-corpus" || src.type === "jsonl") {
    if (!src.path) throw new Error(`source ${src.name}: 'path' is required for type ${src.type}`);
    const { createReadStream } = await import("node:fs");
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: createReadStream(resolve(src.path)), crlfDelay: Infinity });
    for await (const line of rl) {
      const sourceState = runtime.state.sources.find((s) => s.name === src.name);
      if (!sourceState || !sourceState.enabled) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: any;
      try { row = JSON.parse(trimmed); } catch { continue; }
      const rec: TemplateRecord = {
        id: String(row.id ?? ""),
        text: String(row.text ?? ""),
        title: String(row.title ?? row.metadata?.title ?? ""),
        source: String(row.source ?? "jsonl")
      };
      for (const [k, v] of Object.entries(row.metadata ?? {})) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
          rec[k] = v as any;
        }
      }
      const recText = String(rec.text ?? "");
      if (!recText || recText.length < 50) continue;
      await slotWait();
      handleRecord(rec);
    }
  } else if (src.type === "txt") {
    if (!src.path) throw new Error(`source ${src.name}: 'path' is required for type txt`);
    const { createReadStream } = await import("node:fs");
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: createReadStream(resolve(src.path)), crlfDelay: Infinity });
    for await (const line of rl) {
      const sourceState = runtime.state.sources.find((s) => s.name === src.name);
      if (!sourceState || !sourceState.enabled) break;
      const prompt = line.trim();
      if (!prompt) continue;
      const rec: TemplateRecord = { id: `txt-${stats.total}`, text: prompt, title: "", source: "txt" };
      await slotWait();
      handleRecord(rec);
    }
  } else {
    throw new Error(`Unknown source type: ${src.type}`);
  }

  while (inFlight.size > 0) {
    await Promise.race(inFlight);
  }
}

export async function runFromConfig(opts: RunOpts): Promise<void> {
  const cfg = loadConfig(opts.configPath);

  console.log(`\nLoaded config: model=${cfg.model}, output=${cfg.output}, sources=${cfg.sources.length}`);
  for (const s of cfg.sources) {
    const prov = s.provider ?? "openrouter";
    console.log(`  - ${s.name} (${s.type} via ${prov}) concurrency=${s.concurrency}${s.model ? ` model=${s.model}` : ""}`);
  }

  let template: Template | null = null;
  if (cfg.template) {
    template = loadTemplate(resolve(cfg.template));
  }

  const pools = await setupProviderKeys(cfg);
  for (const [name, pool] of Object.entries(pools)) {
    console.log(`[${name}] ready: ${pool.keys.length} key(s), apiBase=${pool.apiBase}`);
  }

  const runtimeState: RuntimeState = {
    model: cfg.model,
    reasoningEffort: cfg.reasoning_effort ?? null,
    paused: false,
    sources: cfg.sources.map((s) => ({ name: s.name, concurrency: s.concurrency, enabled: true }))
  };
  const runtime = new Runtime(runtimeState);

  const outStream = createWriteStream(resolve(cfg.output), { flags: "a" });
  const stats = { ok: 0, err: 0, inFlight: 0, total: 0, spentUsd: 0 };

  let stopRequested = false;
  const repl = startRepl({
    runtime,
    getStats: () => ({
      ok: stats.ok,
      err: stats.err,
      inFlight: stats.inFlight,
      totalRequests: stats.total
    }),
    onQuit: () => { stopRequested = true; }
  });

  const sourceTasks = cfg.sources.map((s) =>
    runOneSource(s, runtime, cfg, template, pools, outStream, stats).catch((err) => {
      console.error(`[${s.name}] fatal: ${err?.message ?? err}`);
    })
  );

  const stopWatcher = (async () => {
    while (!stopRequested) await new Promise((r) => setTimeout(r, 500));
  })();

  await Promise.race([Promise.all(sourceTasks), stopWatcher]);

  repl.stop();
  outStream.end();
  await teardownAllPools(pools);

  console.log(`\nDone. ok=${stats.ok}, err=${stats.err}, total=${stats.total}`);
}
