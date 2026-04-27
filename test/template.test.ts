import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTemplate, expandPlaceholders } from "../src/template.js";

test("expandPlaceholders replaces single placeholder", () => {
  const r = expandPlaceholders("Paper {id} is interesting.", { id: "0704.3395" });
  assert.equal(r, "Paper 0704.3395 is interesting.");
});

test("expandPlaceholders leaves unknown placeholders untouched", () => {
  const r = expandPlaceholders("Title: {title} (id={id})", { id: "x" });
  assert.equal(r, "Title: {title} (id=x)");
});

test("expandPlaceholders handles multiple variables and types", () => {
  const r = expandPlaceholders("a={a}, b={b}, c={c}", { a: 1, b: true, c: "hi" });
  assert.equal(r, "a=1, b=true, c=hi");
});

test("expandPlaceholders ignores undefined and null", () => {
  const r = expandPlaceholders("[{a}][{b}]", { a: "x", b: null });
  assert.equal(r, "[x][{b}]");
});

test("loadTemplate parses YAML with system + turns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "datagen-tmpl-"));
  const p = join(dir, "t.yaml");
  await writeFile(
    p,
    [
      "system: |",
      "  You are a helpful assistant.",
      "turns:",
      "  - First question with {placeholder}.",
      "  - Second question.",
      "metadataKeys:",
      "  - id",
      "  - title"
    ].join("\n"),
    "utf8"
  );
  const t = loadTemplate(p);
  assert.equal(t.system?.includes("helpful"), true);
  assert.equal(t.turns.length, 2);
  assert.deepEqual(t.metadataKeys, ["id", "title"]);
});

test("loadTemplate parses JSON template", async () => {
  const dir = await mkdtemp(join(tmpdir(), "datagen-tmpl-"));
  const p = join(dir, "t.json");
  await writeFile(
    p,
    JSON.stringify({ system: "sys", turns: ["q1", "q2", "q3"] }),
    "utf8"
  );
  const t = loadTemplate(p);
  assert.equal(t.system, "sys");
  assert.equal(t.turns.length, 3);
});

test("loadTemplate rejects empty turns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "datagen-tmpl-"));
  const p = join(dir, "t.json");
  await writeFile(p, JSON.stringify({ turns: [] }), "utf8");
  assert.throws(() => loadTemplate(p), /turns/);
});

test("loadTemplate rejects missing turns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "datagen-tmpl-"));
  const p = join(dir, "t.json");
  await writeFile(p, JSON.stringify({ system: "x" }), "utf8");
  assert.throws(() => loadTemplate(p), /turns/);
});
