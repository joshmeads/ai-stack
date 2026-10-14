import { describe, expect, it } from "bun:test";
import type { LaneRequest } from "../registry/index.ts";
import { adapterSuite, testLane } from "./adapter-suite.ts";
import { grok } from "./grok.ts";

adapterSuite(grok);

const lane = (request: Partial<LaneRequest> = {}) =>
  testLane({ provider: "grok", model: "grok-4.6", ...request });
const argv = (request: Partial<LaneRequest> = {}) => grok.launch.argv(lane(request), { sharedGitDir: null, providerSidecar: null });
const parse = (stdout: string) => grok.parse({ exitCode: 0, stdout, stderr: "", sidecar: null }, lane());

describe("grok launch", () => {
  it("limits Grok to the assigned cwd and disables recursive agents", () => {
    expect(grok.executable).toBe("grok");
    expect(grok.launch.prompt).toBe("file");
    expect(argv({ effort: "xhigh" })).toEqual([
      "--prompt-file",
      "/tmp/prompt.md",
      "--model",
      "grok-4.6",
      "--reasoning-effort",
      "xhigh",
      "--permission-mode",
      "auto",
      "--sandbox",
      "read-only",
      "--tools",
      "read_file,grep,list_dir,run_terminal_cmd",
      "--disallowed-tools",
      "Agent,search_tool,use_tool",
      "--output-format",
      "streaming-messages-json",
      "--cwd",
      "/tmp/worktree",
      "--no-subagents",
      "--disable-web-search",
      "--verbatim",
    ]);
  });

  it("uses a bounded write mode without blanket bypasses", () => {
    const args = argv({ mode: "isolated-write" });
    expect(args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "auto",
        "--sandbox",
        "workspace",
        "--tools",
        "read_file,grep,list_dir,run_terminal_cmd,search_replace",
      ])
    );
    expect(args).not.toContain("--always-approve");
  });

  it("covers low, medium, and high", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      expect(argv({ effort })).toEqual(expect.arrayContaining(["--reasoning-effort", effort]));
    }
  });
});

describe("grok parse", () => {
  it("accepts Grok's reported build suffix", () => {
    const parsed = parse([
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "progress" }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "GROK_OK",
        session_id: "grok-session",
        usage: {
          input_tokens: 30,
          cache_read_input_tokens: 6,
          output_tokens: 7,
          reasoning_tokens: 3,
          total_tokens: 43,
        },
        total_cost_usd: 0.02,
        modelUsage: { "grok-4.6-build": {} },
      }),
    ].join("\n"));
    expect(parsed).toMatchObject({ kind: "complete", text: "GROK_OK", metadata: { reportedModel: "grok-4.6-build" } });
    expect(grok.proof.matches(lane(), "grok-4.6-build")).toBe(true);
  });

  for (const [stopReason, expectedStatus] of [
    ["cancelled", "cancelled"], ["canceled", "cancelled"], ["end_turn", "child-failed"],
  ] as const) {
    it(`issue78 retains terminal metadata for ${stopReason}`, () => {
      expect(parse(JSON.stringify({
        type: "result", subtype: "error_during_execution", is_error: true,
        stop_reason: stopReason, errors: ["Exact provider reason"],
        session_id: "terminal-session", modelUsage: { "grok-4.6-build": {} },
        usage: { input_tokens: 30, output_tokens: 4 }, total_cost_usd: 0.02,
      }))).toEqual({
        kind: "provider-failure",
        message: "Exact provider reason", status: expectedStatus,
        metadata: {
          reportedModel: "grok-4.6-build", sessionId: "terminal-session",
          usage: { inputTokens: 30, outputTokens: 4 }, costUsd: 0.02,
        },
      });
    });
  }

  it("issue78 rejects incomplete terminal status", () => {
    for (const terminal of [
      { type: "result", result: "text" },
      { type: "result", subtype: "success", result: "text" },
      { type: "result", subtype: "", is_error: true },
      { type: "result", subtype: "api_error", is_error: "true" },
    ]) {
      expect(parse(JSON.stringify(terminal)))
        .toEqual({ kind: "malformed", message: "grok result did not contain a valid terminal status" });
    }
    expect(parse("not-json")).toEqual({ kind: "malformed", message: "grok emitted a non-JSON event" });
    expect(parse('{"type":"assistant"}'))
      .toEqual({ kind: "malformed", message: "grok result did not contain a terminal event" });
  });
});
