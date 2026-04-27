import { readFileSync } from "node:fs";
import { parseYaml } from "./config.js";

export type Template = {
  system?: string;
  turns: string[];
  metadataKeys?: string[];
};

export type Record = {
  [key: string]: string | number | boolean | null | undefined;
};

export function loadTemplate(path: string): Template {
  const text = readFileSync(path, "utf8");
  const trimmed = text.trimStart();
  const parsed: any =
    trimmed.startsWith("{") || trimmed.startsWith("[")
      ? JSON.parse(text)
      : parseYaml(text);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Template must be a YAML/JSON object at the root.");
  }
  const turns = parsed.turns;
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error("Template must have a non-empty 'turns' array.");
  }
  for (const t of turns) {
    if (typeof t !== "string" || t.trim().length === 0) {
      throw new Error("Each turn must be a non-empty string.");
    }
  }
  const system = typeof parsed.system === "string" ? parsed.system : undefined;
  const metadataKeysRaw = parsed.metadataKeys;
  let metadataKeys: string[] | undefined;
  if (Array.isArray(metadataKeysRaw)) {
    metadataKeys = metadataKeysRaw.filter((k: any) => typeof k === "string");
  }
  return { system, turns: turns as string[], metadataKeys };
}

export function expandPlaceholders(template: string, record: Record): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (full, key) => {
    const v = record[key];
    if (v === undefined || v === null) return full;
    return String(v);
  });
}
