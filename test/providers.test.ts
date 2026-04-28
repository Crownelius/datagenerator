import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProvider, isProviderName, PROVIDER_REGISTRY } from "../src/providers.js";

test("resolveProvider defaults to openrouter when undefined", () => {
  const p = resolveProvider(undefined);
  assert.equal(p.name, "openrouter");
  assert.equal(p.apiBase, "https://openrouter.ai/api/v1");
});

test("resolveProvider returns nvidia spec", () => {
  const p = resolveProvider("nvidia");
  assert.equal(p.name, "nvidia");
  assert.equal(p.apiBase, "https://integrate.api.nvidia.com/v1");
  assert.equal(p.supportsKeySpawning, false);
});

test("resolveProvider throws on unknown name", () => {
  assert.throws(() => resolveProvider("does-not-exist"), /Unknown provider/);
});

test("only openrouter supportsKeySpawning", () => {
  for (const [name, spec] of Object.entries(PROVIDER_REGISTRY)) {
    if (name === "openrouter") {
      assert.equal(spec.supportsKeySpawning, true, "openrouter should support spawn");
    } else {
      assert.equal(spec.supportsKeySpawning, false, `${name} should NOT support spawn`);
    }
  }
});

test("isProviderName accepts known and rejects unknown", () => {
  assert.equal(isProviderName("openrouter"), true);
  assert.equal(isProviderName("nvidia"), true);
  assert.equal(isProviderName("openai"), true);
  assert.equal(isProviderName("anthropic"), true);
  assert.equal(isProviderName("xxx"), false);
});

test("provider apiBase URLs are well-formed", () => {
  for (const [name, spec] of Object.entries(PROVIDER_REGISTRY)) {
    assert.match(spec.apiBase, /^https?:\/\//, `${name} apiBase missing scheme: ${spec.apiBase}`);
    assert.equal(spec.apiBase.endsWith("/"), false, `${name} apiBase should not have trailing slash`);
  }
});
