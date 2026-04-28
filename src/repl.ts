import * as readline from "node:readline";
import { stdin as procStdin, stdout as procStdout } from "node:process";
import type { Runtime } from "./runtime.js";

export type ReplStats = {
  ok: number;
  err: number;
  inFlight: number;
  totalRequests: number;
  spentUsd?: number;
};

export type ReplDeps = {
  runtime: Runtime;
  getStats: () => ReplStats;
  onQuit: () => void;
};

const HELP = [
  "Runtime commands (type, then Enter):",
  "  :c <N>            set concurrency for ALL active sources",
  "  :c <src> <N>      set concurrency for one source",
  "  :m <model>        change model",
  "  :r <effort>       set reasoning effort (none|low|medium|high)",
  "  :src add <name>   enable a configured source",
  "  :src rm <name>    disable a source (in-flight finish)",
  "  :pause            pause new starts",
  "  :resume           resume",
  "  :status           show full state",
  "  :help             this message",
  "  :q                graceful quit (drain in-flight, save state)"
].join("\n");

function fmtState(rt: Runtime, stats: ReplStats): string {
  const lines: string[] = [];
  lines.push(`model:           ${rt.model}`);
  if (rt.reasoningEffort) lines.push(`reasoning_effort: ${rt.reasoningEffort}`);
  lines.push(`paused:          ${rt.state.paused}`);
  lines.push("sources:");
  for (const s of rt.state.sources) {
    const flag = s.enabled ? "✓" : "✗";
    lines.push(`  ${flag} ${s.name.padEnd(12)} concurrency=${s.concurrency}`);
  }
  lines.push(`requests:        ok=${stats.ok}, err=${stats.err}, in-flight=${stats.inFlight}, total=${stats.totalRequests}`);
  if (typeof stats.spentUsd === "number") {
    lines.push(`spent:           $${stats.spentUsd.toFixed(4)}`);
  }
  return lines.join("\n");
}

export function startRepl(deps: ReplDeps): { stop: () => void } {
  const rl = readline.createInterface({ input: procStdin, output: procStdout, terminal: false });
  const { runtime, getStats, onQuit } = deps;
  const echo = (s: string) => process.stdout.write(s + "\n");

  echo("\n" + HELP + "\n");

  rl.on("line", (line) => {
    const cmd = line.trim();
    if (!cmd) return;
    if (!cmd.startsWith(":")) return;
    const tokens = cmd.slice(1).split(/\s+/);
    const [verb, ...args] = tokens;

    switch (verb) {
      case "help":
      case "?":
        echo(HELP);
        return;

      case "c": {
        if (args.length === 1) {
          const n = parseInt(args[0], 10);
          if (!Number.isFinite(n) || n < 1) {
            echo("usage: :c <N>   (N must be >= 1)");
            return;
          }
          runtime.setConcurrency(null, n);
          echo(`concurrency set to ${n} for all active sources`);
        } else if (args.length === 2) {
          const [src, nStr] = args;
          const n = parseInt(nStr, 10);
          if (!Number.isFinite(n) || n < 1) {
            echo(`usage: :c ${src} <N>   (N must be >= 1)`);
            return;
          }
          runtime.setConcurrency(src, n);
          echo(`concurrency for ${src} set to ${n}`);
        } else {
          echo("usage: :c <N>  OR  :c <source> <N>");
        }
        return;
      }

      case "m": {
        if (args.length !== 1) { echo("usage: :m <model>"); return; }
        runtime.setModel(args[0]);
        echo(`model set to ${args[0]}`);
        return;
      }

      case "r": {
        if (args.length !== 1) { echo("usage: :r <none|low|medium|high>"); return; }
        runtime.setReasoningEffort(args[0]);
        echo(`reasoning_effort set to ${args[0]}`);
        return;
      }

      case "src": {
        if (args.length !== 2) { echo("usage: :src add <name>  OR  :src rm <name>"); return; }
        const [op, name] = args;
        if (op === "add") {
          runtime.enableSource(name);
          echo(`source ${name} enabled`);
        } else if (op === "rm" || op === "remove") {
          runtime.disableSource(name);
          echo(`source ${name} disabled (in-flight will finish)`);
        } else {
          echo("usage: :src add <name>  OR  :src rm <name>");
        }
        return;
      }

      case "pause":
        runtime.pause();
        echo("paused; in-flight will finish, no new starts");
        return;

      case "resume":
        runtime.resume();
        echo("resumed");
        return;

      case "status":
        echo(fmtState(runtime, getStats()));
        return;

      case "q":
      case "quit":
      case "exit":
        echo("graceful quit; draining in-flight...");
        onQuit();
        return;

      default:
        echo(`unknown command: :${verb}    (type :help)`);
    }
  });

  return {
    stop: () => rl.close()
  };
}
