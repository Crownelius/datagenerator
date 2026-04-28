import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { parseYaml } from "./config.js";

export type ProviderConfig = {
  keys?: string[];
  management_key?: string;
  auto_spawn_count?: number;
};

export type SourceConfig = {
  name: string;
  type: "arxiv-hf" | "arxiv-corpus" | "txt" | "jsonl" | "hf-dataset";
  dataset?: string;
  config?: string;
  split?: string;
  path?: string;
  limit?: number;
  offset?: number;
  concurrency: number;
};

export type DataclawConfig = {
  model: string;
  reasoning_effort?: string;
  output: string;
  template?: string;
  api?: string;
  store_system?: boolean;
  save_old_format?: boolean;
  timeout?: number;
  providers: { [name: string]: ProviderConfig };
  sources: SourceConfig[];
};

export const GLOBAL_CONFIG_PATH = resolve(homedir(), ".dataclaw", "config.yaml");
export const PROJECT_CONFIG_NAME = "dataclaw.yaml";

export function findConfigPath(cwd: string = process.cwd()): string | null {
  const proj = resolve(cwd, PROJECT_CONFIG_NAME);
  if (existsSync(proj)) return proj;
  if (existsSync(GLOBAL_CONFIG_PATH)) return GLOBAL_CONFIG_PATH;
  return null;
}

function asString(v: any): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function asNumber(v: any): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asBool(v: any): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return undefined;
}

function asStringArray(v: any): string[] | undefined {
  if (Array.isArray(v)) {
    const out = v.filter((x) => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
    return out.length > 0 ? out : undefined;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    return v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return undefined;
}

export function validate(cfg: DataclawConfig): string[] {
  const errs: string[] = [];
  if (!cfg.model) errs.push("`model` is required");
  if (!cfg.output) errs.push("`output` is required");
  if (!Array.isArray(cfg.sources) || cfg.sources.length === 0) {
    errs.push("`sources` must be a non-empty list");
  } else {
    cfg.sources.forEach((s, i) => {
      if (!s.name) errs.push(`sources[${i}].name is required`);
      if (!s.type) errs.push(`sources[${i}].type is required`);
      if (!Number.isFinite(s.concurrency) || s.concurrency < 1) {
        errs.push(`sources[${i}].concurrency must be >= 1`);
      }
    });
  }
  for (const [name, p] of Object.entries(cfg.providers || {})) {
    const hasKeys = Array.isArray(p.keys) && p.keys.length > 0;
    const hasMgmt = typeof p.management_key === "string" && p.management_key.length > 0;
    if (!hasKeys && !hasMgmt) {
      errs.push(`providers.${name}: provide either \`keys\` or \`management_key\``);
    }
    if (hasKeys && hasMgmt) {
      errs.push(`providers.${name}: \`keys\` and \`management_key\` are mutually exclusive`);
    }
    if (hasMgmt && (!p.auto_spawn_count || p.auto_spawn_count < 1)) {
      errs.push(`providers.${name}: when using \`management_key\`, set \`auto_spawn_count\` >= 1`);
    }
  }
  return errs;
}

export function loadConfig(path?: string): DataclawConfig {
  const cfgPath = path ?? findConfigPath();
  if (!cfgPath) {
    throw new Error(
      `No config found. Looked for ./dataclaw.yaml and ${GLOBAL_CONFIG_PATH}. ` +
      "Run 'datagen onboard' to create one."
    );
  }
  const text = readFileSync(cfgPath, "utf8");
  const trimmed = text.trimStart();
  const raw: any =
    trimmed.startsWith("{") || trimmed.startsWith("[")
      ? JSON.parse(text)
      : parseYaml(text);

  const providersRaw = raw.providers && typeof raw.providers === "object" ? raw.providers : {};
  const providers: { [name: string]: ProviderConfig } = {};
  for (const [name, p] of Object.entries(providersRaw)) {
    const pp = p as any;
    providers[name] = {
      keys: asStringArray(pp.keys),
      management_key: asString(pp.management_key),
      auto_spawn_count: asNumber(pp.auto_spawn_count)
    };
  }

  const sourcesRaw: any[] = Array.isArray(raw.sources) ? raw.sources : [];
  const sources: SourceConfig[] = sourcesRaw.map((s: any) => ({
    name: String(s.name ?? ""),
    type: String(s.type ?? "") as SourceConfig["type"],
    dataset: asString(s.dataset),
    config: asString(s.config),
    split: asString(s.split),
    path: asString(s.path),
    limit: asNumber(s.limit),
    offset: asNumber(s.offset),
    concurrency: asNumber(s.concurrency) ?? 1
  }));

  const cfg: DataclawConfig = {
    model: asString(raw.model) ?? "",
    reasoning_effort: asString(raw.reasoning_effort),
    output: asString(raw.output) ?? "dataset.jsonl",
    template: asString(raw.template),
    api: asString(raw.api),
    store_system: asBool(raw.store_system),
    save_old_format: asBool(raw.save_old_format),
    timeout: asNumber(raw.timeout),
    providers,
    sources
  };

  const errs = validate(cfg);
  if (errs.length > 0) {
    throw new Error("Config errors:\n  - " + errs.join("\n  - "));
  }
  return cfg;
}

export function saveConfig(cfg: DataclawConfig, path: string = GLOBAL_CONFIG_PATH): string {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const lines: string[] = [];
  lines.push(`model: ${cfg.model}`);
  if (cfg.reasoning_effort) lines.push(`reasoning_effort: ${cfg.reasoning_effort}`);
  lines.push(`output: ${cfg.output}`);
  if (cfg.template) lines.push(`template: ${cfg.template}`);
  if (cfg.api) lines.push(`api: ${cfg.api}`);
  if (typeof cfg.store_system === "boolean") lines.push(`store_system: ${cfg.store_system}`);
  if (typeof cfg.save_old_format === "boolean") lines.push(`save_old_format: ${cfg.save_old_format}`);
  if (typeof cfg.timeout === "number") lines.push(`timeout: ${cfg.timeout}`);

  lines.push("");
  lines.push("providers:");
  for (const [name, p] of Object.entries(cfg.providers)) {
    lines.push(`  ${name}:`);
    if (p.keys && p.keys.length > 0) {
      lines.push("    keys:");
      for (const k of p.keys) lines.push(`      - ${k}`);
    }
    if (p.management_key) {
      lines.push(`    management_key: ${p.management_key}`);
      if (p.auto_spawn_count) lines.push(`    auto_spawn_count: ${p.auto_spawn_count}`);
    }
  }

  lines.push("");
  lines.push("sources:");
  for (const s of cfg.sources) {
    lines.push(`  - name: ${s.name}`);
    lines.push(`    type: ${s.type}`);
    if (s.dataset) lines.push(`    dataset: ${s.dataset}`);
    if (s.config) lines.push(`    config: ${s.config}`);
    if (s.split) lines.push(`    split: ${s.split}`);
    if (s.path) lines.push(`    path: ${s.path}`);
    if (typeof s.limit === "number") lines.push(`    limit: ${s.limit}`);
    if (typeof s.offset === "number") lines.push(`    offset: ${s.offset}`);
    lines.push(`    concurrency: ${s.concurrency}`);
  }

  const content = lines.join("\n") + "\n";
  writeFileSync(path, content, "utf8");
  return path;
}
