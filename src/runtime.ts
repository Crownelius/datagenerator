import { EventEmitter } from "node:events";

export type RuntimeState = {
  model: string;
  reasoningEffort: string | null;
  paused: boolean;
  sources: { name: string; concurrency: number; enabled: boolean }[];
};

export class Runtime extends EventEmitter {
  state: RuntimeState;

  constructor(initial: RuntimeState) {
    super();
    this.state = { ...initial, sources: [...initial.sources] };
  }

  get model(): string {
    return this.state.model;
  }
  setModel(model: string) {
    if (!model || this.state.model === model) return;
    this.state.model = model;
    this.emit("change", { kind: "model", model });
  }

  get reasoningEffort(): string | null {
    return this.state.reasoningEffort;
  }
  setReasoningEffort(eff: string | null) {
    if (this.state.reasoningEffort === eff) return;
    this.state.reasoningEffort = eff;
    this.emit("change", { kind: "reasoning_effort", reasoningEffort: eff });
  }

  setConcurrency(sourceName: string | null, n: number) {
    if (!Number.isFinite(n) || n < 1) return;
    if (sourceName === null) {
      this.state.sources.forEach((s) => (s.concurrency = n));
    } else {
      const src = this.state.sources.find((s) => s.name === sourceName);
      if (!src) return;
      src.concurrency = n;
    }
    this.emit("change", { kind: "concurrency", sourceName, concurrency: n });
  }

  enableSource(name: string) {
    const s = this.state.sources.find((x) => x.name === name);
    if (!s) return;
    if (s.enabled) return;
    s.enabled = true;
    this.emit("change", { kind: "source_enabled", name });
  }

  disableSource(name: string) {
    const s = this.state.sources.find((x) => x.name === name);
    if (!s) return;
    if (!s.enabled) return;
    s.enabled = false;
    this.emit("change", { kind: "source_disabled", name });
  }

  pause() {
    if (this.state.paused) return;
    this.state.paused = true;
    this.emit("change", { kind: "pause" });
  }

  resume() {
    if (!this.state.paused) return;
    this.state.paused = false;
    this.emit("change", { kind: "resume" });
  }

  totalConcurrency(): number {
    return this.state.sources.filter((s) => s.enabled).reduce((sum, s) => sum + s.concurrency, 0);
  }

  enabledSourceNames(): string[] {
    return this.state.sources.filter((s) => s.enabled).map((s) => s.name);
  }
}
