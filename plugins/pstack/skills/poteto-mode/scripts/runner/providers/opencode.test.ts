import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelRun } from "../registry/contract.ts";
import type { LaneRequest } from "../registry/index.ts";
import { adapterSuite, testFacts, testLane } from "./adapter-suite.ts";
import { opencode } from "./opencode.ts";

adapterSuite(opencode);

// Sanitized from OpenCode 1.19.1 captures: structure kept, paths replaced by placeholders.
const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures/opencode", name), "utf8");

const MODEL = "opencode/deepseek-v4.1-flash-free";
const lane = (request: Partial<LaneRequest> = {}) => testLane({ provider: "opencode", model: MODEL, effort: "high", ...request });
const run = (overrides: Partial<ModelRun>): ModelRun => ({ exitCode: 0, stdout: "", stderr: "", sidecar: null, ...overrides });
const preflight = (exitCode: number, stdout: string, stderr = "", request: Partial<LaneRequest> = {}) =>
  opencode.preflight.classify({ exitCode, stdout, stderr }, lane(request));
const event = (type: string, part: Record<string, unknown> = {}) => JSON.stringify({ type, timestamp: 1, sessionID: "ses_x", part });

describe("opencode launch", () => {
  it("runs the pinned model and variant with a fixed title and the ERROR log on stderr", () => {
    expect(opencode.launch.argv(lane(), testFacts(opencode))).toEqual([
      "run", "--pure", "--agent", "build", "--format", "json", "--title", "pstack-lane", "--print-logs", "--log-level", "ERROR",
      "-m", MODEL, "--variant", "high",
    ]);
    expect(opencode.launch.argv(lane({ effort: "default", model: "openrouter/deepseek/deepseek-v4-pro" }), testFacts(opencode)))
      .toEqual(["run", "--pure", "--agent", "build", "--format", "json", "--title", "pstack-lane", "--print-logs", "--log-level", "ERROR", "-m", "openrouter/deepseek/deepseek-v4-pro"]);
  });

  it("refuses an isolated-write lane and efforts the family does not list", () => {
    expect(() => lane({ mode: "isolated-write" }))
      .toThrow("provider opencode does not support isolated-write; it supports only: read-only");
    expect(() => lane({ effort: "medium" }))
      .toThrow(`effort medium is not offered for opencode:${MODEL}; choose one of: low, high, max`);
  });

  it("writes a lockdown config that denies every tool except the read tools", () => {
    const config = opencode.launch.sidecar!.config!;
    expect([config.name, opencode.launch.sidecar!.output]).toEqual(["opencode.json", null]);
    expect(JSON.parse(config.content(lane()))).toEqual({
      share: "disabled",
      autoupdate: false,
      snapshot: false,
      instructions: [],
      permission: { "*": "deny", read: "allow", glob: "allow", grep: "allow", list: "allow", todowrite: "allow" },
    });
  });

  it("points OpenCode at the run-owned config and home, and passes no OPENCODE_ prefix or provider key", () => {
    expect(opencode.environment(lane().access, "/tmp/r.provider")).toMatchObject({
      kind: "allowlist",
      prefixes: ["LC_", "XDG_"],
      set: {
        XDG_CONFIG_HOME: "/tmp/r.provider",
        OPENCODE_TEST_HOME: "/tmp/r.provider",
        OPENCODE_CONFIG: "/tmp/r.provider/opencode.json",
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_CLAUDE_CODE: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
      },
    });
    const policy = opencode.environment(lane().access, "/tmp/r.provider");
    if (policy.kind !== "allowlist") throw new Error("expected an allowlist");
    expect(policy.names.filter((name) => /KEY|TOKEN|OPENCODE/.test(name))).toEqual([]);
    expect(opencode.launch.projectConfig).toEqual([".opencode/"]);
  });
});

describe("opencode preflight", () => {
  it("asks the model's provider and passes only when the model is listed", () => {
    expect(opencode.preflight.argv(lane(), null)).toEqual(["models", "opencode"]);
    expect(opencode.preflight.argv(lane({ model: "openrouter/deepseek/deepseek-v4-pro" }), null)).toEqual(["models", "openrouter"]);
    expect(preflight(0, fixture("models-opencode-gate-env.txt"))).toEqual({ kind: "passed", evidence: `model ${MODEL} listed` });
    expect(preflight(0, fixture("models-opencode-gate-env.txt"), "", { model: "opencode/deepseek-v4.1-flash" }))
      .toEqual({ kind: "unavailable-model" });
  });

  it("reads Provider not found as unauthenticated and a model with no provider as unavailable", () => {
    expect(preflight(1, "", fixture("models-openrouter-no-key.stderr.txt"), { model: "openrouter/deepseek/deepseek-v4-pro" }))
      .toEqual({ kind: "unauthenticated" });
    expect(preflight(0, fixture("models-opencode-gate-env.txt"), "", { model: "deepseek-v4.1-flash-free" }))
      .toEqual({ kind: "unavailable-model" });
  });

  it("reads any other failure as inconclusive", () => {
    for (const [exitCode, stderr] of [[1, ""], [1, "Error: network unreachable"], [2, "Provider not found: opencode"]] as const) {
      expect([exitCode, stderr, preflight(exitCode, MODEL, stderr)]).toEqual([exitCode, stderr, { kind: "inconclusive" }]);
    }
  });
});

describe("opencode guard", () => {
  const guard = opencode.preflight.guard!;
  const check = (stdout: string, exitCode = 0) => guard.check({ exitCode, stdout, stderr: "" });
  const withRules = (...rules: readonly Record<string, string>[]) => {
    const agent = JSON.parse(fixture("debug-agent-build-lockdown.json"));
    return JSON.stringify({ ...agent, permission: [...agent.permission, ...rules] });
  };
  const wider = (what: string) => ({
    status: "child-failed",
    message: `OpenCode's effective permissions are wider than the read-only lockdown (${what}); a managed, home, project or account config overrides the lane's lockdown`,
  }) as const;

  it("reads the build agent's merged ruleset and passes the lockdown with OpenCode's own tool-output rule", () => {
    expect(guard.argv).toEqual(["debug", "agent", "build", "--pure"]);
    expect(check(fixture("debug-agent-build-lockdown.json"))).toBeNull();
    expect(check(withRules({ permission: "bash", pattern: "*", action: "deny" }, { permission: "read", pattern: "*.env", action: "ask" }))).toBeNull();
  });

  it("refuses a managed config's tool and pattern rules after the lockdown", () => {
    expect(check(fixture("debug-agent-build-managed.json"))).toEqual(wider('bash "git *" allow, edit "*" allow'));
  });

  it("refuses an allowed or missing default, and a later ask or external_directory allow", () => {
    expect(check(withRules({ permission: "*", pattern: "*", action: "allow" }))).toEqual(wider('"*" allow'));
    const agent = JSON.parse(fixture("debug-agent-build-lockdown.json"));
    const noDefault = { ...agent, permission: agent.permission.filter((rule: { permission: string }) => rule.permission !== "*") };
    expect(check(JSON.stringify(noDefault))).toEqual(wider('"*" (no rule)'));
    expect(check(withRules({ permission: "webfetch", pattern: "*", action: "ask" }))).toEqual(wider('webfetch "*" ask'));
    expect(check(withRules({ permission: "external_directory", pattern: "*", action: "allow" }))).toEqual(wider('external_directory "*" allow'));
  });

  it("refuses output it cannot read", () => {
    const unreadable = { status: "child-failed", message: "`opencode debug agent build` did not print a readable permission ruleset" } as const;
    for (const [stdout, exitCode] of [
      ["not json", 0],
      [fixture("debug-agent-build-lockdown.json"), 1],
      [JSON.stringify({ name: "build", permission: [] }), 0],
      [JSON.stringify({ name: "build", permission: { "*": "deny" } }), 0],
      [withRules({ permission: "bash", action: "allow" }), 0],
    ] as const) {
      expect(check(stdout, exitCode)).toEqual(unreadable);
    }
  });
});

describe("opencode parse", () => {
  it("takes the reply after the last step_start and sums usage and cost over every step", () => {
    expect(opencode.parse(run({ stdout: fixture("stream-complete-zen-free.jsonl") }), lane())).toEqual({
      kind: "complete",
      text: "c1889c77-4282-43bc-9962-8e2348de8475",
      metadata: {
        reportedModel: null,
        sessionId: "ses_ebd45be83ffepdmN8mnSK2STa0",
        usage: { inputTokens: 2232, cachedInputTokens: 5632, cacheCreationInputTokens: 0, outputTokens: 87, reasoningTokens: 0, totalTokens: 7951 },
        costUsd: 0,
      },
    });
    const paid = opencode.parse(run({ stdout: fixture("stream-complete-openrouter-cost.jsonl") }), lane());
    expect(paid).toMatchObject({
      kind: "complete",
      text: "930c99fe-5257-4a96-9f2e-5fcb8b0ca213",
      metadata: { usage: { inputTokens: 6212, cachedInputTokens: 41593, outputTokens: 98, reasoningTokens: 19, totalTokens: 47922 } },
    });
    expect(paid.kind === "complete" ? paid.metadata.costUsd : null).toBeCloseTo(0.0013435786, 12);
    expect(opencode.proof).toMatchObject({ report: "absent" });
    expect(opencode.proof.matches(lane(), MODEL)).toBe(false);
  });

  it("joins the last step's texts in order and ignores text from earlier steps", () => {
    const stdout = [
      event("step_start"), event("text", { text: "earlier" }), event("step_finish", { reason: "tool-calls" }),
      event("step_start"), event("text", { text: "one " }), event("text", { text: "two" }), event("step_finish", { reason: "stop" }),
    ].join("\n");
    expect(opencode.parse(run({ stdout }), lane())).toMatchObject({ kind: "complete", text: "one two" });
  });

  it("reads an auto-rejected tool call at exit 0 as a failure", () => {
    expect(opencode.parse(run({ stdout: fixture("tool-ask-auto-rejected.stdout.jsonl"), stderr: fixture("tool-ask-auto-rejected.stderr.txt") }), lane()))
      .toEqual({
        kind: "provider-failure",
        status: "child-failed",
        message: "opencode ended on a rejected tool call",
        metadata: {
          reportedModel: null,
          sessionId: "ses_ebd47fa9bffeo3kRPNs4MIWejp",
          usage: { inputTokens: 7908, cachedInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 77, reasoningTokens: 13, totalTokens: 7998 },
          costUsd: 0,
        },
      });
  });

  it("reads an error event as a failure with its name and message", () => {
    expect(opencode.parse(run({ exitCode: 1, stdout: fixture("unknown-model.stdout.jsonl"), stderr: fixture("unknown-model.stderr-error-line.txt") }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "child-failed", message: "opencode reported UnknownError: Unexpected server error. Check server logs for details." });
    expect(opencode.parse(run({ exitCode: 1, stdout: fixture("provider-error-midrun.stdout.jsonl") }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "child-failed", message: expect.stringContaining("UnknownError: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_GATEWAY_ID missing") });
  });

  it("reads exit 130 and 143 as cancelled", () => {
    for (const exitCode of [130, 143]) {
      expect(opencode.parse(run({ exitCode, stdout: fixture("cancel-sigterm.stdout.jsonl") }), lane())).toMatchObject({
        kind: "provider-failure",
        status: "cancelled",
        message: `opencode exited with status ${exitCode} after a signal`,
        metadata: { sessionId: "ses_ebd44eb9fffeJtwYYpMWCmalvr", usage: null },
      });
    }
  });

  it("never completes a stream that ends inside a step, on another reason or with no or empty text", () => {
    expect(opencode.parse(run({ stdout: fixture("cancel-sigterm.stdout.jsonl") }), lane()))
      .toEqual({ kind: "malformed", message: "opencode stream did not end with step_finish" });
    expect(opencode.parse(run({ stdout: "" }), lane())).toEqual({ kind: "malformed", message: "opencode stream did not end with step_finish" });
    expect(opencode.parse(run({ stdout: "not json\n" }), lane())).toEqual({ kind: "malformed", message: "opencode emitted a non-JSON event" });
    expect(opencode.parse(run({ stdout: [event("step_start"), event("step_finish", { reason: "stop" })].join("\n") }), lane()))
      .toEqual({ kind: "malformed", message: "opencode's last step has no text" });
    expect(opencode.parse(run({ stdout: [event("step_start"), event("text", { text: "" }), event("step_finish", { reason: "stop" })].join("\n") }), lane()))
      .toEqual({ kind: "malformed", message: "opencode's last step has no text" });
    expect(opencode.parse(run({ stdout: [event("step_start"), event("text", { text: "partial" }), event("step_finish", { reason: "length" })].join("\n") }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "child-failed", message: "opencode ended its last step with reason \"length\"" });
  });
});
