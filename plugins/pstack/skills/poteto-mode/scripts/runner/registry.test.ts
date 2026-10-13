import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  defaultDescriptor,
  type LaneRequest,
  REGISTRY,
  resolveLane,
  resolveModel,
} from "./registry/index.ts";
import { EFFORTS } from "./types.ts";

const RUNNER = import.meta.dir;
const PLUGIN_ROOT = join(RUNNER, "../../../..");

function request(overrides: Partial<LaneRequest> = {}): LaneRequest {
  return {
    parent: "codex",
    provider: "claude",
    model: "opus",
    effort: "max",
    mode: "read-only",
    promptPath: "/tmp/prompt.md",
    cwd: "/tmp/worktree",
    outputPath: "/tmp/output.md",
    receiptPath: "/tmp/receipt.json",
    timeoutMs: null,
    ...overrides,
  };
}

function familyOf(provider: string, model: string): string | null {
  const match = resolveModel(provider, model);
  return match.kind === "unregistered" ? null : match.family.name;
}

describe("registry data", () => {
  it("resolves every released pair to its recorded family", () => {
    for (const { pair, family } of REGISTRY.releasedPairs) {
      const at = pair.indexOf(":");
      expect([pair, familyOf(pair.slice(0, at), pair.slice(at + 1))]).toEqual([pair, family]);
    }
  });

  it("lists every role-default pair as a released pair", () => {
    const released = new Set(REGISTRY.releasedPairs.map((entry) => entry.pair));
    for (const { lanes } of REGISTRY.roleDefaults) {
      for (const name of lanes) {
        if (name === "inherit-parent" || name === "auto") continue;
        const family = REGISTRY.families.find((entry) => entry.name === name)!;
        expect(released).toContain(`${family.provider}:${family.model}`);
      }
    }
  });

  it("keeps family names and (provider, model) pairs unique, and efforts ordered", () => {
    const names = REGISTRY.families.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+([.-][a-z0-9]+)*$/);
    const pairs = REGISTRY.families.flatMap((entry) => [entry.model, ...(entry.predecessors ?? []).map((kept) => kept.model)]
      .map((model) => `${entry.provider}:${model}`));
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const entry of REGISTRY.families) {
      for (const efforts of [entry.efforts, ...(entry.predecessors ?? []).map((kept) => kept.efforts)]) {
        expect(efforts.length).toBeGreaterThan(0);
        expect([...efforts]).toEqual(EFFORTS.filter((effort) => efforts.includes(effort)));
      }
      expect(entry.efforts).toContain(entry.defaultEffort);
    }
  });

  // Until the model catalog is generated from the registry, the hand-written matrix and
  // first-run sheet must say the same thing.
  it("matches the model matrix and setup's first-run sheet", () => {
    const dispatch = readFileSync(join(PLUGIN_ROOT, "skills/poteto-mode/references/provider-dispatch.md"), "utf8");
    const matrix = dispatch.slice(dispatch.indexOf("## Model matrix"));
    const rows = matrix.split("\n").filter((line) => /^\| [a-z]/.test(line)).slice(0, REGISTRY.families.length)
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
    expect(rows).toEqual(REGISTRY.families.map((entry) => [
      entry.name,
      entry.upstream ?? "-",
      entry.provider,
      entry.model,
      entry.defaultEffort,
      entry.efforts.join(" "),
      entry.provider === "claude" ? entry.name : "-",
    ]));
    const setup = readFileSync(join(PLUGIN_ROOT, "skills/setup-stack/SKILL.md"), "utf8");
    for (const { role, lanes } of REGISTRY.roleDefaults) {
      const descriptors = lanes.map((name) => {
        const family = REGISTRY.families.find((entry) => entry.name === name);
        return family === undefined ? name : defaultDescriptor(family);
      });
      expect(setup).toContain(`\n${role}: ${descriptors.join(", ")}\n`);
    }
  });
});

describe("resolveLane", () => {
  it("passes an unregistered pair to the CLI unchanged with any listed effort", () => {
    const lane = resolveLane(request({ parent: "claude", provider: "codex", model: "gpt-6-nova", effort: "ultra" }));
    expect(lane.family).toBeNull();
    expect(lane.model).toBe("gpt-6-nova");
    expect(lane.adapter.launch.argv(lane, { sharedGitDir: null }))
      .toEqual(expect.arrayContaining(["--model", "gpt-6-nova", "--config", 'model_reasoning_effort="ultra"']));
    expect(resolveLane(request({ parent: "claude", provider: "codex", model: "gpt-6-nova", effort: "default" })).effort)
      .toBe("default");
  });

  it("rejects an effort that a registered family or kept predecessor does not list", () => {
    expect(() => resolveLane(request({ effort: "ultra" })))
      .toThrow("effort ultra is not offered for claude:opus; choose one of: low, medium, high, xhigh, max");
    expect(() => resolveLane(request({ effort: "default" }))).toThrow("effort default is not offered");
    expect(() => resolveLane(request({ parent: "claude", provider: "codex", model: "gpt-6-luna", effort: "ultra" })))
      .toThrow("effort ultra is not offered for codex:gpt-6-luna; choose one of: low, medium, high, xhigh, max");
    expect(() => resolveLane(request({ model: "haiku", effort: "ultra" })))
      .toThrow("effort ultra is not offered for claude:haiku");
    expect(resolveLane(request({ parent: "claude", provider: "codex", model: "gpt-5.6-sol", effort: "ultra" })).family?.name)
      .toBe("sol");
  });

  it("rejects an effort outside the global list", () => {
    expect(() => resolveLane(request({ provider: "codex", model: "gpt-6-nova", effort: "none" })))
      .toThrow(`effort must be one of: ${EFFORTS.join(", ")}`);
  });

  it("refuses an unnormalized Claude revision with today's message", () => {
    for (const [model, alias] of [["claude-opus-5", "opus"], ["claude-fable-9-9", "fable"], ["claude-haiku-5-5", "haiku"]]) {
      expect(() => resolveLane(request({ model })))
        .toThrow(`Claude model ${model} is a version pin; normalize it to ${alias} before invoking the runner`);
    }
    expect(resolveLane(request({ model: "claude-opus-beta" })).family).toBeNull();
  });

  it("rejects same-provider recursion and unknown names", () => {
    expect(() => resolveLane(request({ parent: "claude" })))
      .toThrow("provider claude is native to parent claude; use the parent subagent primitive");
    expect(() => resolveLane(request({ provider: "devin" }))).toThrow("provider must be one of: claude, codex");
    expect(() => resolveLane(request({ parent: "devin" }))).toThrow("parent must be one of: claude, codex");
    expect(() => resolveLane(request({ mode: "full" }))).toThrow("mode must be one of: read-only, isolated-write");
    expect(() => resolveLane(request({ model: " " }))).toThrow("model is required");
  });
});

describe("module boundaries", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
  }

  it("imports providers/* only from registry/providers.ts outside providers/", () => {
    const providers = join(RUNNER, "providers");
    const importers = sources(RUNNER)
      .filter((path) => !path.startsWith(`${providers}/`))
      .filter((path) => [...readFileSync(path, "utf8").matchAll(/from\s+"([^"]+)"/g)]
        .some(([, specifier]) => specifier!.startsWith(".")
          && resolve(dirname(path), specifier!).startsWith(`${providers}/`)))
      .map((path) => relative(RUNNER, path));
    expect(importers).toEqual(["registry/providers.ts"]);
  });

  it("keeps child-provider names out of run.ts except the parent sandbox diagnostic", () => {
    const run = readFileSync(join(RUNNER, "run.ts"), "utf8");
    const names = REGISTRY.adapters.map((adapter) => adapter.id).join("|");
    expect([...run.matchAll(new RegExp(`["'\`](?:${names})["'\`]`, "g"))].map(([literal]) => literal))
      .toEqual(['"codex"']);
    expect(run).toContain('lane.parent === "codex"');
  });
});
