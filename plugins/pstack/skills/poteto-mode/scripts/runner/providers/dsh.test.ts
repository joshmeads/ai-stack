import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelRun } from "../registry/contract.ts";
import type { LaneRequest } from "../registry/index.ts";
import { modelFailureStatus } from "../types.ts";
import { adapterSuite, testFacts, testLane } from "./adapter-suite.ts";
import { dsh } from "./dsh.ts";

adapterSuite(dsh);

// Sanitized from dsh 0.2.0-rc.2 captures: `real-*` and `preflight-transport` against DeepSeek, the rest
// against a local mock. Structure kept, paths, session IDs and markers replaced.
const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures/dsh", name), "utf8");

const lane = (request: Partial<LaneRequest> = {}) => testLane({ provider: "dsh", model: "deepseek-flash", effort: "max", ...request });
const run = (overrides: Partial<ModelRun>): ModelRun => ({ exitCode: 0, stdout: "", stderr: "", sidecar: null, ...overrides });
const preflight = (stdout: string, exitCode = 1) => dsh.preflight.classify({ exitCode, stdout, stderr: "" }, lane());

describe("dsh launch", () => {
  it("reads the prompt from stdin with the run-owned patch before --json", () => {
    expect(dsh.launch.argv(lane(), testFacts(dsh))).toEqual([
      "--profile", "headless", "--patch", "/tmp/receipt.json.provider/patch.yml", "--json", "-",
    ]);
    expect(dsh.launch.prompt).toBe("stdin");
    expect(dsh.launch.sidecar?.output).toBeNull();
  });

  it("pins every sandbox and approval row enabled, the model and effort, and turns off the lockdown rows", () => {
    const patch = dsh.launch.sidecar!.config!.content(lane({ model: "deepseek-v4-pro", effort: "low", cwd: "/tmp/a dir: #x" }));
    expect(patch).toStartWith([
      "- id: sandbox",
      "  disabled: false",
      "- id: sandbox-policy",
      "  disabled: false",
      "  config:",
      "    mode: read-only",
      "    workspaceRoot: \"/tmp/a dir: #x\"",
      "- id: bash-sandbox",
      "  disabled: false",
      "  config:",
      "    timeoutMs: 60000",
      "- id: fs-sandbox",
      "  disabled: false",
      "- id: approval",
      "  disabled: false",
      "  config:",
      "    policy: ask",
      "- id: permission",
      "  disabled: false",
      "  config:",
      "    presets:",
      "      read-only:",
      "        sandbox: read-only",
      "        approval: ask",
      "      workspace-write:",
      "        sandbox: workspace-write",
      "        approval: ask",
      "      danger-full-access:",
      "        sandbox: danger-full-access",
      "        approval: never",
      "- id: agent-default-model",
      "  config:",
      "    provider: deepseek-official",
      "    model: \"deepseek-v4-pro\"",
      "    reasoningEffort: \"low\"",
    ].join("\n") + "\n");
    for (const id of [
      "agent-instructions", "skill-filesystem", "tool-skill", "tool-web", "web", "web-search-deepseek", "web-fetch-http",
      "tool-subagent", "tool-subagent-fork", "tool-subagent-control", "tool-subagent-list-agents", "tool-workflow",
      "workflow-ptc", "plugin-package-inventory-deepseek", "session-title-llm",
    ]) {
      expect(patch).toContain(`- id: ${id}\n  disabled: true\n`);
    }
    expect(patch).toEndWith("- id: session-log-deepseek\n  config:\n    enabled: false\n");
    expect(dsh.launch.sidecar!.config!.content(lane({ model: "deepseek-next", effort: "default" }))).not.toContain("reasoningEffort");
  });

  it("refuses an isolated-write lane and the medium effort for a registered family", () => {
    expect(() => lane({ mode: "isolated-write" })).toThrow("provider dsh does not support isolated-write; it supports only: read-only");
    expect(() => lane({ effort: "medium" })).toThrow("effort medium is not offered for dsh:deepseek-flash; choose one of: low, high, max");
  });

  it("passes DEEPSEEK_API_KEY and no other DEEPSEEK_ or DSH_ name", () => {
    const policy = dsh.environment(lane().access, "/tmp/receipt.json.provider");
    if (policy.kind !== "allowlist") throw new Error("expected an allowlist");
    expect(policy.names.filter((name) => /^(DSH_|DEEPSEEK_)/.test(name))).toEqual(["DEEPSEEK_API_KEY"]);
    expect(policy.prefixes.filter((prefix) => /^(DSH|DEEPSEEK)/.test(prefix))).toEqual([]);
    expect(policy.set).toBeUndefined();
  });
});

describe("dsh preflight", () => {
  it("runs a positional task with the shipped preflight patch", () => {
    const argv = dsh.preflight.argv(lane());
    expect(argv).toEqual(["--profile", "headless", "--patch", join(import.meta.dir, "dsh-preflight.yml"), "--json", "preflight"]);
    expect(readFileSync(argv[3]!, "utf8")).toContain("baseURL: http://127.0.0.1:1\n- id: llm-retry\n  disabled: true\n");
  });

  it("passes TRANSPORT with fixed evidence that the key is not validated", () => {
    for (const name of ["preflight-transport.jsonl", "status-credential-present.jsonl"]) {
      expect(preflight(fixture(name))).toEqual({ kind: "passed", evidence: "credential present; not validated" });
    }
  });

  it("reads MISSING_CREDENTIAL as unauthenticated and anything else as inconclusive", () => {
    expect(preflight(fixture("status-logged-out.jsonl"))).toEqual({ kind: "unauthenticated" });
    for (const stdout of ["", "{", fixture("unsupported-effort.jsonl"), fixture("real-complete-flash-max.jsonl")]) {
      expect([stdout, preflight(stdout)]).toEqual([stdout, { kind: "inconclusive" }]);
    }
  });
});

describe("dsh parse", () => {
  it("takes the final text after a completed turn, with summed step usage and the session ID", () => {
    expect(dsh.parse(run({ stdout: fixture("real-complete-flash-max.jsonl") }), lane())).toEqual({
      kind: "complete",
      text: "MARKER-FIXTURE",
      metadata: {
        reportedModel: null,
        sessionId: "session-MARKER-FIXTURE",
        usage: {
          inputTokens: 3600,
          outputTokens: 65,
          totalTokens: 6993,
          cachedInputTokens: 3328,
          cacheCreationInputTokens: 0,
        },
        costUsd: null,
      },
    });
    expect(dsh.proof).toMatchObject({ report: "absent" });
    expect(dsh.proof.matches(lane(), "deepseek-flash")).toBe(false);
  });

  it("never completes SIGTERM's exit 0 with a partial final, and reads exit 130 as cancelled", () => {
    expect(dsh.parse(run({ stdout: fixture("cancel-sigterm.jsonl") }), lane()))
      .toEqual({ kind: "malformed", message: "dsh ended without a completed turn" });
    expect(dsh.parse(run({ exitCode: 130, stdout: fixture("cancel-sigint.jsonl") }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "cancelled" });
  });

  it("reads a turn_end error as child-failed with its code and message", () => {
    expect(dsh.parse(run({ exitCode: 1, stdout: fixture("unsupported-effort.jsonl"), stderr: fixture("unsupported-effort.stderr.txt") }), lane()))
      .toMatchObject({
        kind: "provider-failure",
        status: "child-failed",
        message: "dsh turn failed: UNSUPPORTED_REASONING_EFFORT: provider \"deepseek-official\" model \"deepseek-flash\" does not support reasoning effort \"medium\"",
        metadata: { sessionId: expect.stringMatching(/^session-/) },
      });
  });

  it("leaves DeepSeek's unknown-model refusal to the runner's unavailable-model rule", () => {
    const stderr = fixture("real-unknown-model.stderr.txt");
    expect(modelFailureStatus(stderr)).toBe("unavailable-model");
    expect(dsh.parse(run({ exitCode: 1, stdout: fixture("real-unknown-model.jsonl"), stderr }), lane()))
      .toEqual({ kind: "malformed", message: "dsh named an unavailable model" });
    // The model's own reply text cannot trigger the rule: it is anchored to dsh's stderr line.
    expect(modelFailureStatus("TOOL: The supported API model names are a, but you passed b")).toBe("child-failed");
  });

  it("refuses a completed turn without final text and a non-JSON event", () => {
    const completedEmpty = fixture("real-complete-flash-max.jsonl").replace("{\"type\":\"final\",\"text\":\"MARKER-FIXTURE\"}", "{\"type\":\"final\",\"text\":\"\"}");
    expect(dsh.parse(run({ stdout: completedEmpty }), lane()))
      .toEqual({ kind: "malformed", message: "dsh completed the turn without final text" });
    expect(dsh.parse(run({ stdout: "Welcome\n" }), lane())).toEqual({ kind: "malformed", message: "dsh emitted a non-JSON event" });
  });
});
