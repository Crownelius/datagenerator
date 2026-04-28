export type ProviderName =
  | "openrouter"
  | "nvidia"
  | "openai"
  | "together"
  | "fireworks"
  | "deepinfra"
  | "anthropic";

export type ProviderSpec = {
  name: ProviderName;
  apiBase: string;
  supportsKeySpawning: boolean;
  supportsReasoningEffort: boolean;
  notes?: string;
};

export const PROVIDER_REGISTRY: { [k in ProviderName]: ProviderSpec } = {
  openrouter: {
    name: "openrouter",
    apiBase: "https://openrouter.ai/api/v1",
    supportsKeySpawning: true,
    supportsReasoningEffort: true,
    notes: "Supports management-key auto-spawn of ephemeral sub-keys."
  },
  nvidia: {
    name: "nvidia",
    apiBase: "https://integrate.api.nvidia.com/v1",
    supportsKeySpawning: false,
    supportsReasoningEffort: true,
    notes: "OpenAI-compatible. 40 RPM free tier. No key-spawning API; supply multiple keys for fan-out."
  },
  openai: {
    name: "openai",
    apiBase: "https://api.openai.com/v1",
    supportsKeySpawning: false,
    supportsReasoningEffort: true,
    notes: "Per-token billing applies."
  },
  together: {
    name: "together",
    apiBase: "https://api.together.xyz/v1",
    supportsKeySpawning: false,
    supportsReasoningEffort: true,
    notes: "Public per-token pricing."
  },
  fireworks: {
    name: "fireworks",
    apiBase: "https://api.fireworks.ai/inference/v1",
    supportsKeySpawning: false,
    supportsReasoningEffort: true,
    notes: "Public per-token pricing."
  },
  deepinfra: {
    name: "deepinfra",
    apiBase: "https://api.deepinfra.com/v1/openai",
    supportsKeySpawning: false,
    supportsReasoningEffort: true,
    notes: "OpenAI-compatible facade."
  },
  anthropic: {
    name: "anthropic",
    apiBase: "https://api.anthropic.com/v1",
    supportsKeySpawning: false,
    supportsReasoningEffort: false,
    notes: "Anthropic API is NOT OpenAI-compatible. Direct support deferred — use OpenRouter to access Anthropic models for now."
  }
};

export function isProviderName(s: string): s is ProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDER_REGISTRY, s);
}

export function resolveProvider(name: string | undefined): ProviderSpec {
  const fallback = PROVIDER_REGISTRY.openrouter;
  if (!name) return fallback;
  if (isProviderName(name)) return PROVIDER_REGISTRY[name];
  throw new Error(
    `Unknown provider: "${name}". Known: ${Object.keys(PROVIDER_REGISTRY).join(", ")}`
  );
}
