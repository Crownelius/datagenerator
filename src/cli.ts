#!/usr/bin/env node
import { main as legacyMain } from "./index.js";
import { runFromConfig } from "./run-from-config.js";
import { runOnboarding } from "./onboarding.js";
import { findConfigPath } from "./dataclaw-config.js";

async function dispatch(): Promise<void> {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (sub === "onboard") {
    await runOnboarding();
    return;
  }

  if (sub === "run") {
    const idx = argv.indexOf("--config");
    const explicit = idx >= 0 ? argv[idx + 1] : undefined;
    await runFromConfig({ configPath: explicit });
    return;
  }

  if (argv.length === 0) {
    const cfg = findConfigPath();
    if (!cfg) {
      console.log("\nNo config found. Starting first-run onboarding.\n");
      await runOnboarding();
      console.log("\nRun 'datagen run' to start a job using the saved config.\n");
      return;
    }
    await runFromConfig({});
    return;
  }

  // Anything else falls through to the legacy CLI (--model, --prompts, etc.)
  await legacyMain(argv);
}

dispatch().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
