import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelRun } from "../registry/contract.ts";
import type { LaneRequest } from "../registry/index.ts";
import { adapterSuite, testFacts, testLane } from "./adapter-suite.ts";
import { pi } from "./pi.ts";

adapterSuite(pi);

const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures/pi", name), "utf8");

const GEMINI = "openrouter/~google/gemini-pro-latest";
const GROK = "openrouter/~x-ai/grok-latest";
const lane = (request: Partial<LaneRequest> = {}) => testLane({ provider: "pi", model: GEMINI, effort: "high", ...request });
const run = (overrides: Partial<ModelRun>): ModelRun => ({ exitCode: 0, stdout: "", stderr: "", sidecar: null, ...overrides });
const preflight = (stdout: string, request: Partial<LaneRequest> = {}, exitCode = 0) =>
  pi.preflight.classify({ exitCode, stdout, stderr: "" }, lane(request));

describe("pi launch", () => {
  it("runs the read-only tools with discovery off, the session off, and the prompt on stdin", () => {
    expect(pi.launch.argv(lane(), testFacts(pi))).toEqual([
      "-p", "--mode", "json", "--no-session", "--tools", "read,grep,find,ls",
      "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-approve",
      "--model", GEMINI, "--thinking", "high",
    ]);
    expect(pi.launch.prompt).toBe("stdin");
    expect(pi.launch.argv(lane(), testFacts(pi))).not.toContain("--no-context-files");
  });

  it("refuses an isolated-write lane and an effort the family does not list", () => {
    expect(() => lane({ mode: "isolated-write" })).toThrow("provider pi does not support isolated-write; it supports only: read-only");
    expect(() => lane({ effort: "ultra" })).toThrow("choose one of: low, medium, high, xhigh, max");
  });

  it("passes OpenRouter's key and the agent directory, and no other PI_ name or provider key", () => {
    const policy = pi.environment(lane().access, null);
    if (policy.kind !== "allowlist") throw new Error("expected an allowlist");
    expect(policy.set).toEqual({ PI_OFFLINE: "1", PI_TELEMETRY: "0" });
    expect(policy.names.filter((name) => name.startsWith("PI_") || name.endsWith("_API_KEY"))).toEqual(["OPENROUTER_API_KEY", "PI_CODING_AGENT_DIR"]);
    expect(policy.prefixes.some((prefix) => "PI_PACKAGE_DIR".startsWith(prefix))).toBe(false);
  });
});

describe("pi preflight", () => {
  it("passes only on a row whose provider and model equal the lane's, with fixed evidence", () => {
    expect(preflight(fixture("list-models-listed.txt"), { model: GROK }))
      .toEqual({ kind: "passed", evidence: `model ${GROK} listed; key not validated` });
    expect(preflight(fixture("list-models-listed.txt"), { model: "openrouter/~x-ai/grok" })).toEqual({ kind: "unavailable-model" });
  });

  it("reads the exit-0 list messages, and never reads other output as a login result", () => {
    expect(preflight(fixture("list-models-no-login.txt"))).toEqual({ kind: "unauthenticated" });
    expect(preflight(fixture("list-models-no-match.txt"))).toEqual({ kind: "unavailable-model" });
    expect(preflight("")).toEqual({ kind: "inconclusive" });
    expect(preflight(fixture("list-models-listed.txt"), {}, 1)).toEqual({ kind: "inconclusive" });
  });

  it("refuses a model outside OpenRouter, and ultra on an unregistered model, whatever the list says", () => {
    expect(preflight(fixture("list-models-listed.txt"), { model: "anthropic/claude-fable" })).toEqual({ kind: "unavailable-model" });
    expect(preflight(fixture("list-models-listed.txt"), { model: GROK, effort: "ultra" })).toEqual({ kind: "unavailable-model" });
  });
});

describe("pi parse", () => {
  it("takes the reply, session, summed usage, cost and served model from the stream", () => {
    const parsed = pi.parse(run({ stdout: fixture("stream-complete-rolling-grok.jsonl") }), lane({ model: GROK }));
    expect(parsed).toMatchObject({
      kind: "complete",
      text: "ok",
      metadata: {
        reportedModel: "x-ai/grok-4.7",
        sessionId: "00000000-0000-0000-0000-000000000011",
        usage: { inputTokens: 1386, cachedInputTokens: 1152, cacheCreationInputTokens: 0, outputTokens: 23, reasoningTokens: 22, totalTokens: 2561 },
        costUsd: 0.003486,
      },
    });
  });

  it("keeps only the last message's text parts after a tool turn, across thinking parts", () => {
    const parsed = pi.parse(run({ stdout: fixture("stream-read-tool-text-before-thinking.jsonl") }), lane());
    if (parsed.kind !== "complete") throw new Error("expected complete");
    expect(parsed.text.startsWith("1. Skipped/failed: `write` tool is not available")).toBe(true);
    expect(parsed.metadata.reportedModel).toBe("google/gemini-4-argon");
    expect(parsed.metadata.usage).toMatchObject({ inputTokens: 1533 + 1593, outputTokens: 39 + 163 });
  });

  it("completes when forced calls to disallowed tools come back as not found", () => {
    const stdout = fixture("stream-forced-disallowed-tools.jsonl");
    for (const tool of ["bash", "write", "edit", "web_search"]) expect(stdout).toContain(`Tool ${tool} not found`);
    expect(pi.parse(run({ stdout }), lane({ model: GROK }))).toMatchObject({ kind: "complete", text: "done" });
  });

  it("reads an exit-0 provider error as child-failed with its text", () => {
    expect(pi.parse(run({ stdout: fixture("invalid-key-exit0.jsonl") }), lane({ model: GROK })))
      .toMatchObject({ kind: "provider-failure", status: "child-failed", message: expect.stringContaining("401"), metadata: { reportedModel: null } });
    expect(pi.parse(run({ stdout: fixture("unknown-model-exit0.jsonl"), stderr: fixture("unknown-model.stderr.txt") }), lane({ model: "openrouter/definitely/not-a-model" })))
      .toMatchObject({ kind: "provider-failure", status: "child-failed", message: expect.stringContaining("is not a valid model ID") });
  });

  it("reads a signal exit as cancelled, even after a finished stream", () => {
    expect(pi.parse(run({ exitCode: 143, stdout: fixture("cancel-sigterm-exit143.jsonl") }), lane({ model: GROK })))
      .toMatchObject({ kind: "provider-failure", status: "cancelled" });
    expect(pi.parse(run({ exitCode: 130, stdout: fixture("stream-complete-rolling-grok.jsonl") }), lane({ model: GROK })))
      .toMatchObject({ kind: "provider-failure", status: "cancelled" });
  });

  it("never completes a stream with no settled assistant reply", () => {
    expect(pi.parse(run({ stdout: fixture("empty-prompt-exit0.jsonl") }), lane()))
      .toEqual({ kind: "malformed", message: "pi stream did not contain an assistant message" });
    expect(pi.parse(run({ exitCode: 1, stdout: fixture("no-key-exit1.jsonl"), stderr: fixture("no-key.stderr.txt") }), lane()))
      .toEqual({ kind: "malformed", message: "pi stream did not contain an assistant message" });
    const unsettled = fixture("stream-complete-rolling-grok.jsonl").split("\n").filter((line) => !line.includes("agent_settled")).join("\n");
    expect(pi.parse(run({ stdout: unsettled }), lane())).toEqual({ kind: "malformed", message: "pi stream did not end with agent_settled" });
    expect(pi.parse(run({ stdout: "PINEAPPLE\n" }), lane())).toEqual({ kind: "malformed", message: "pi emitted a non-JSON event" });
  });
});

describe("pi model proof", () => {
  it("matches a rolling ID on vendor, a router ID on anything, and a concrete ID exactly", () => {
    expect(pi.proof.report).toBe("required");
    expect(pi.proof.matches(lane({ model: GROK }), "x-ai/grok-4.7")).toBe(true);
    expect(pi.proof.matches(lane(), "google/gemini-4-argon")).toBe(true);
    expect(pi.proof.matches(lane(), "x-ai/grok-4.7")).toBe(false);
    expect(pi.proof.matches(lane({ model: "openrouter/openrouter/free" }), "x-ai/grok-4.7")).toBe(true);
    const concrete = lane({ model: "openrouter/x-ai/grok-4" });
    expect(pi.proof.matches(concrete, "x-ai/grok-4")).toBe(true);
    const served = pi.parse(run({ stdout: fixture("stream-complete-rolling-grok.jsonl") }), concrete);
    if (served.kind !== "complete") throw new Error("expected complete");
    expect(pi.proof.matches(concrete, served.metadata.reportedModel!)).toBe(false);
    expect(pi.proof.matches(concrete, "x-ai/grok-4:free")).toBe(false);
  });

  it("reads the message's model when the stream has no responseModel, as OpenRouter does for a concrete ID", () => {
    const withoutResponseModel = (model: string) => fixture("stream-complete-rolling-grok.jsonl").split("\n").map((line) => {
      if (line.length === 0) return line;
      const event = JSON.parse(line);
      if (event.message) {
        delete event.message.responseModel;
        event.message.model = model;
      }
      return JSON.stringify(event);
    }).join("\n");
    const concrete = lane({ model: "openrouter/x-ai/grok-4.7" });
    const parsed = pi.parse(run({ stdout: withoutResponseModel("x-ai/grok-4.7") }), concrete);
    if (parsed.kind !== "complete") throw new Error("expected complete");
    expect(parsed.metadata.reportedModel).toBe("x-ai/grok-4.7");
    expect(pi.proof.matches(concrete, parsed.metadata.reportedModel!)).toBe(true);
    const rolling = lane({ model: GROK });
    const echoed = pi.parse(run({ stdout: withoutResponseModel("~x-ai/grok-latest") }), rolling);
    if (echoed.kind !== "complete") throw new Error("expected complete");
    expect(pi.proof.matches(rolling, echoed.metadata.reportedModel!)).toBe(false);
  });
});
