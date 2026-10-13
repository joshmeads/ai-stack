import { describe, expect, it } from "bun:test";
import type { LaneRequest } from "../registry/index.ts";
import { adapterSuite, testLane } from "./adapter-suite.ts";
import { claude } from "./claude.ts";

adapterSuite(claude);

const lane = (request: Partial<LaneRequest> = {}) =>
  testLane({ provider: "claude", model: "fable", ...request });
const argv = (request: Partial<LaneRequest> = {}, sharedGitDir: string | null = null) =>
  claude.launch.argv(lane(request), { sharedGitDir });
const parse = (stdout: string) => claude.parse({ exitCode: 0, stdout, stderr: "" }, lane());

describe("claude launch", () => {
  it("passes Claude model, effort, permissions, and no-recursion controls", () => {
    expect(claude.executable).toBe("claude");
    expect(claude.launch.prompt).toBe("stdin");
    const args = argv();
    expect(args).toEqual([
      "-p",
      "--model",
      "fable",
      "--effort",
      "max",
      "--permission-mode",
      "plan",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--tools",
      "Read,Grep,Glob,Bash",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--disallowed-tools",
      "Agent,Task,WebSearch,WebFetch,Edit,Write,NotebookEdit",
      "--output-format",
      "json",
    ]);
    expect(args).not.toContain("bypassPermissions");
  });

  it("uses a bounded write mode without blanket bypasses", () => {
    expect(argv({ mode: "isolated-write" })).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "acceptEdits",
        "--tools",
        "Read,Write,Edit,Grep,Glob,Bash",
      ])
    );
  });

  it("sandboxes Claude writers and denies a shared git directory when one is supplied", () => {
    const writer = { mode: "isolated-write" };
    const sandbox = {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
    };
    const settings = (args: readonly string[]): unknown =>
      JSON.parse(args[args.indexOf("--settings") + 1] ?? "");

    expect(settings(argv(writer))).toEqual({ sandbox });
    expect(settings(argv(writer, "/repo/.git"))).toEqual({
      sandbox: { ...sandbox, filesystem: { denyWrite: ["/repo/.git"] } },
    });
    expect(settings(argv(writer, "/srv/my repo/.git"))).toEqual({
      sandbox: { ...sandbox, filesystem: { denyWrite: ["/srv/my repo/.git"] } },
    });

    const reader = argv({}, "/repo/.git");
    expect(reader).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
    expect(reader).not.toContain("--settings");
  });

  it("asks run.ts for the shared git directory only for a writer", () => {
    expect(claude.launch.needsSharedGitDir({ mode: "isolated-write" })).toBe(true);
    expect(claude.launch.needsSharedGitDir({ mode: "read-only" })).toBe(false);
  });

  it("covers low, medium, and high", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      expect(argv({ effort })).toEqual(expect.arrayContaining(["--effort", effort]));
    }
  });
});

describe("claude parse", () => {
  it("extracts Claude text, model, usage, cost, and session", () => {
    expect(parse(JSON.stringify({
      result: "CLAUDE_OK",
      session_id: "claude-session",
      usage: { input_tokens: 10, output_tokens: 3 },
      total_cost_usd: 0.05,
      modelUsage: { "claude-fable-9-9": { inputTokens: 10 } },
    }))).toMatchObject({
      kind: "complete",
      text: "CLAUDE_OK",
      metadata: {
        reportedModel: "claude-fable-9-9",
        sessionId: "claude-session",
        usage: { inputTokens: 10, outputTokens: 3 },
        costUsd: 0.05,
      },
    });
  });

  it("extracts the last Claude result event and its terminal metadata", () => {
    expect(parse(JSON.stringify([
      { type: "system", model: "claude-opus-9" },
      { type: "result", result: "EARLIER_RESULT" },
      null,
      { type: "assistant", message: { content: [{ type: "text", text: "progress" }] } },
      {
        type: "result", is_error: false, result: "CLAUDE_ARRAY_OK",
        session_id: "claude-array-session",
        usage: { input_tokens: 14, output_tokens: 4, cache_read_input_tokens: 2 },
        total_cost_usd: 0.03,
        modelUsage: { "claude-haiku-4-5-20251001": {}, "claude-fable-9-9": {} },
      },
      { type: "system", result: "NOT_A_TERMINAL_RESULT" },
    ]))).toMatchObject({
      kind: "complete",
      text: "CLAUDE_ARRAY_OK",
      metadata: {
        reportedModel: "claude-fable-9-9",
        sessionId: "claude-array-session",
        usage: { inputTokens: 14, outputTokens: 4, cachedInputTokens: 2 },
        costUsd: 0.03,
      },
    });
  });

  it("rejects Claude terminal errors before accepting partial or missing text", () => {
    for (const result of ["partial text", undefined]) {
      const terminal = { type: "result", is_error: true, result };
      for (const raw of [terminal, [{ type: "result", result: "earlier success" }, terminal]]) {
        expect(parse(JSON.stringify(raw)))
          .toEqual({ kind: "malformed", message: "claude reported an error result" });
      }
    }
  });

  it("rejects Claude arrays without a terminal result event", () => {
    for (const raw of [[], [null, "text"], [{ type: "assistant", result: "progress" }]]) {
      expect(parse(JSON.stringify(raw)))
        .toEqual({ kind: "malformed", message: "claude result did not contain a terminal event" });
    }
  });

  it("rejects Claude terminal results without final text", () => {
    for (const result of [undefined, "", 42]) {
      const terminal = { type: "result", is_error: false, result };
      for (const raw of [terminal, [terminal]]) {
        expect(parse(JSON.stringify(raw)))
          .toEqual({ kind: "malformed", message: "claude result did not contain final text" });
      }
    }
  });

  it("rejects malformed responses", () => {
    expect(parse("not-json")).toEqual({ kind: "malformed", message: "claude did not emit valid JSON" });
  });

  it("selects the requested Claude model when usage includes a side model", () => {
    expect(parse(JSON.stringify({
      result: "CLAUDE_OK",
      modelUsage: {
        "claude-haiku-4-5-20251001": {},
        "claude-fable-9-9": {},
      },
    }))).toMatchObject({ metadata: { reportedModel: "claude-fable-9-9" } });
  });
});

describe("claude model proof", () => {
  it("matches only concrete Claude revisions from the requested rolling family", () => {
    const fable = lane();
    expect(claude.proof.matches(fable, "claude-fable-9-9")).toBe(true);
    expect(claude.proof.matches(lane({ model: "opus" }), "claude-opus-9")).toBe(true);
    expect(claude.proof.matches(fable, "claude-opus-9")).toBe(false);
    expect(claude.proof.matches(fable, "claude-fable-beta")).toBe(false);
    expect(claude.proof.matches(fable, "fable")).toBe(false);
    expect(claude.proof.matches(fable, "fable-preview")).toBe(false);
    expect(claude.proof.matches(lane({ model: "haiku" }), "claude-haiku-5-5")).toBe(true);
    expect(claude.proof.matches(lane({ model: "haiku" }), "claude-opus-9")).toBe(false);
  });

  it("matches an unregistered Claude model exactly or with a suffix", () => {
    const pinned = lane({ model: "claude-sonnet-x" });
    expect(claude.proof.matches(pinned, "claude-sonnet-x")).toBe(true);
    expect(claude.proof.matches(pinned, "claude-sonnet-x-20260101")).toBe(true);
    expect(claude.proof.matches(pinned, "claude-sonnet-y")).toBe(false);
  });
});

describe("claude preflight", () => {
  it("passes only a logged-in JSON status with exit 0", () => {
    const classify = (exitCode: number, stdout: string) =>
      claude.preflight.classify({ exitCode, stdout, stderr: "" }, lane());
    expect(classify(0, JSON.stringify({ loggedIn: true }))).toEqual({ kind: "passed", evidence: "authenticated" });
    expect(classify(1, JSON.stringify({ loggedIn: true }))).toEqual({ kind: "unauthenticated" });
    expect(classify(0, JSON.stringify({ loggedIn: false }))).toEqual({ kind: "unauthenticated" });
    expect(classify(0, "[]")).toEqual({ kind: "unauthenticated" });
    expect(classify(0, "model claude-x is not supported")).toEqual({ kind: "unavailable-model" });
    expect(claude.preflight.argv(lane())).toEqual(["auth", "status", "--json"]);
    expect(claude.preflight.retryAfterUnauthenticatedMs).toBeNull();
  });
});
