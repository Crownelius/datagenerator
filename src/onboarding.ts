import * as readline from "node:readline/promises";
import { stdin as procStdin, stdout as procStdout } from "node:process";
import {
  GLOBAL_CONFIG_PATH,
  saveConfig,
  type DataclawConfig,
  type ProviderConfig,
  type SourceConfig
} from "./dataclaw-config.js";

const SOURCE_PRESETS: { [k: string]: Omit<SourceConfig, "concurrency"> } = {
  "arxiv (HuggingFace common-pile)": {
    name: "arxiv",
    type: "arxiv-hf",
    dataset: "common-pile/arxiv_papers",
    split: "train"
  },
  "arxiv (local corpus from corpus-builder)": {
    name: "corpus",
    type: "arxiv-corpus",
    path: "./corpus/work/corpus.jsonl"
  },
  "TXT prompts (one per line)": {
    name: "txt",
    type: "txt",
    path: "./prompts.txt"
  },
  "Custom HuggingFace dataset": {
    name: "hf",
    type: "hf-dataset"
  },
  "Local JSONL file": {
    name: "jsonl",
    type: "jsonl",
    path: "./input.jsonl"
  }
};

const PROVIDER_OPTIONS = [
  { key: "openrouter", label: "OpenRouter (default)" },
  { key: "openai", label: "OpenAI direct" },
  { key: "anthropic", label: "Anthropic direct" },
  { key: "together", label: "Together AI" },
  { key: "fireworks", label: "Fireworks AI" },
  { key: "deepinfra", label: "DeepInfra" }
];

async function prompt(rl: readline.Interface, q: string, fallback?: string): Promise<string> {
  const tail = fallback ? ` (${fallback})` : "";
  const ans = (await rl.question(`${q}${tail}: `)).trim();
  return ans.length > 0 ? ans : (fallback ?? "");
}

async function promptYesNo(rl: readline.Interface, q: string, fallback = false): Promise<boolean> {
  const ans = (await rl.question(`${q} ${fallback ? "[Y/n]" : "[y/N]"}: `)).trim().toLowerCase();
  if (!ans) return fallback;
  return ans.startsWith("y");
}

async function chooseFromList(
  rl: readline.Interface,
  q: string,
  options: string[],
  multi = false
): Promise<number[]> {
  console.log(`\n${q}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));
  const tail = multi ? " (comma-separated, e.g. 1,3)" : "";
  const ans = (await rl.question(`Choose${tail}: `)).trim();
  if (!ans) return [];
  const nums = ans.split(",").map((s) => parseInt(s.trim(), 10));
  return nums.filter((n) => Number.isFinite(n) && n >= 1 && n <= options.length).map((n) => n - 1);
}

export async function runOnboarding(opts: { savePath?: string } = {}): Promise<DataclawConfig> {
  const rl = readline.createInterface({ input: procStdin, output: procStdout });

  console.log("\n  ════════════════════════════════════════════════════════════");
  console.log("    Welcome to Datagenerator-arxiv. First-run setup.");
  console.log("  ════════════════════════════════════════════════════════════\n");

  // ----- Sources -----
  const sourceLabels = Object.keys(SOURCE_PRESETS);
  const picks = await chooseFromList(rl, "Pick one or more data sources:", sourceLabels, true);
  if (picks.length === 0) {
    console.log("  ! No sources selected; defaulting to arxiv (HuggingFace common-pile).");
    picks.push(0);
  }
  const sources: SourceConfig[] = [];
  for (const idx of picks) {
    const label = sourceLabels[idx];
    const preset = SOURCE_PRESETS[label];
    const concurrencyStr = await prompt(rl, `Concurrency for "${preset.name}"`, "10");
    const concurrency = Math.max(1, parseInt(concurrencyStr, 10) || 1);

    if (preset.type === "hf-dataset") {
      const dataset = await prompt(rl, `HF dataset id for "${preset.name}"`, "common-pile/arxiv_papers");
      sources.push({ ...preset, dataset, concurrency });
    } else if (preset.path !== undefined) {
      const path = await prompt(rl, `Path for "${preset.name}"`, preset.path);
      sources.push({ ...preset, path, concurrency });
    } else {
      sources.push({ ...preset, concurrency });
    }
  }

  // ----- Providers -----
  console.log("\nProvider keys (leave blank to skip a provider):");
  console.log("  - For OpenRouter, you can paste either a list of inference keys");
  console.log("    OR one management key (program will auto-spawn sub-keys).");
  console.log();

  const providers: { [k: string]: ProviderConfig } = {};

  // OpenRouter (special: management key option)
  const orMode = await chooseFromList(
    rl,
    "OpenRouter setup mode:",
    [
      "Skip OpenRouter",
      "Provide one or more inference keys",
      "Provide one management key (auto-spawn sub-keys at runtime)"
    ]
  );
  const orChoice = orMode[0] ?? 0;
  if (orChoice === 1) {
    const keysRaw = await prompt(rl, "OpenRouter inference keys (comma-separated)");
    const keys = keysRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (keys.length > 0) providers["openrouter"] = { keys };
  } else if (orChoice === 2) {
    const mgmt = await prompt(rl, "OpenRouter management key");
    if (mgmt) {
      const countStr = await prompt(rl, "Number of sub-keys to auto-spawn", "10");
      const count = Math.max(1, parseInt(countStr, 10) || 10);
      providers["openrouter"] = { management_key: mgmt, auto_spawn_count: count };
    }
  }

  // Other providers — single-key each
  for (const p of PROVIDER_OPTIONS.slice(1)) {
    const keyVal = await prompt(rl, `${p.label} API key`);
    if (keyVal) providers[p.key] = { keys: [keyVal] };
  }

  if (Object.keys(providers).length === 0) {
    console.log("\n  ! No providers configured. You can edit the config later.");
    providers["openrouter"] = { keys: [] };
  }

  // ----- Model + output -----
  const model = await prompt(rl, "\nDefault model", "openai/gpt-oss-120b:free");
  const reasoningEffort = await prompt(rl, "Reasoning effort (none/low/medium/high)", "high");
  const output = await prompt(rl, "Output JSONL path", "./dataset.jsonl");
  const wantsTemplate = await promptYesNo(rl, "Use a multi-turn template (e.g. examples/arxiv.yaml)?", true);
  const template = wantsTemplate ? await prompt(rl, "Template path", "./examples/arxiv.yaml") : undefined;

  rl.close();

  const cfg: DataclawConfig = {
    model,
    reasoning_effort: reasoningEffort,
    output,
    template,
    providers,
    sources
  };

  const savePath = opts.savePath ?? GLOBAL_CONFIG_PATH;
  saveConfig(cfg, savePath);
  console.log(`\n  ✓ Saved config to ${savePath}\n`);

  return cfg;
}
