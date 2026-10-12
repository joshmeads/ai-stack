import { describe, expect, it } from "bun:test";
import type { LaneRequest } from "../registry/index.ts";
import { adapterSuite, testLane } from "./adapter-suite.ts";
import { codex } from "./codex.ts";

adapterSuite(codex);

const lane = (request: Partial<LaneRequest> = {}) =>
  testLane({ provider: "codex", model: "gpt-5.6-sol", ...request });
const argv = (request: Partial<LaneRequest> = {}) => codex.launch.argv(lane(request), { sharedGitDir: null });
const parse = (stdout: string) => codex.parse({ exitCode: 0, stdout, stderr: "" }, lane());

describe("codex launch", () => {
  it("pins Codex model, effort, sandbox, cwd, and JSONL output", () => {
    expect(codex.executable).toBe("codex");
    expect(codex.launch.prompt).toBe("stdin");
    const args = argv();
    expect(args).toEqual([
      "exec",
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_reasoning_effort="max"',
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/worktree",
      "--skip-git-repo-check",
      "--ephemeral",
      "--disable",
      "plugins",
      "--disable",
      "multi_agent",
      "--disable",
      "hooks",
      "--disable",
      "memories",
      "--json",
      "-",
    ]);
    expect(args).not.toContain("danger-full-access");
  });

  it("passes the ultra effort to Codex unchanged", () => {
    expect(argv({ model: "gpt-6.1-sol", effort: "ultra" }).slice(0, 5)).toEqual([
      "exec",
      "--model",
      "gpt-6.1-sol",
      "--config",
      'model_reasoning_effort="ultra"',
    ]);
  });

  it("uses a bounded write mode without blanket bypasses", () => {
    expect(argv({ mode: "isolated-write" })).toEqual(
      expect.arrayContaining(["--sandbox", "workspace-write"])
    );
  });

  it("covers low, medium, and high", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      expect(argv({ effort })).toEqual(
        expect.arrayContaining(["--config", `model_reasoning_effort="${effort}"`])
      );
    }
  });
});

describe("codex parse", () => {
  it("extracts Codex JSONL without inventing a provider-reported model", () => {
    const parsed = codex.parse({
      exitCode: 0,
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "codex-session" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "CODEX_OK" },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 20,
            cached_input_tokens: 4,
            output_tokens: 5,
            reasoning_output_tokens: 2,
          },
        }),
      ].join("\n"),
      stderr: "model: gpt-5.6-sol\nreasoning effort: max\n",
    }, lane());
    expect(parsed).toMatchObject({
      kind: "complete",
      text: "CODEX_OK",
      metadata: {
        reportedModel: null,
        sessionId: "codex-session",
        usage: {
          inputTokens: 20,
          cachedInputTokens: 4,
          outputTokens: 5,
          reasoningTokens: 2,
        },
      },
    });
    expect(codex.proof.report).toBe("absent");
  });

  it("rejects textless, failed and non-JSON responses", () => {
    expect(parse(JSON.stringify({ type: "turn.completed" })))
      .toEqual({ kind: "malformed", message: "codex result did not contain a final agent message" });
    expect(parse(JSON.stringify({ type: "turn.failed", error: { message: "quota exceeded" } })))
      .toEqual({ kind: "malformed", message: "quota exceeded" });
    expect(parse("not-json")).toEqual({ kind: "malformed", message: "codex emitted a non-JSON event" });
  });
});

describe("codex preflight", () => {
  it("passes a logged-in status with exit 0", () => {
    const classify = (exitCode: number, stdout: string, stderr = "") =>
      codex.preflight.classify({ exitCode, stdout, stderr }, lane());
    expect(classify(0, "Logged in using ChatGPT")).toEqual({ kind: "passed", evidence: "authenticated" });
    expect(classify(0, "", "Logged in using an API key")).toEqual({ kind: "passed", evidence: "authenticated" });
    expect(classify(1, "Logged in using ChatGPT")).toEqual({ kind: "unauthenticated" });
    expect(classify(0, "status unknown")).toEqual({ kind: "unauthenticated" });
    expect(codex.preflight.argv(lane())).toEqual(["login", "status"]);
    expect(codex.preflight.retryAfterUnauthenticatedMs).toBeNull();
  });
});
