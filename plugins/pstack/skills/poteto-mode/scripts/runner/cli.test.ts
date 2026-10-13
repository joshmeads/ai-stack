import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { main, parseArgs } from "./cli.ts";

function argv(extra: readonly string[] = []): string[] {
  return [
    "--parent",
    "claude",
    "--provider",
    "codex",
    "--model",
    "gpt-5.6-sol",
    "--effort",
    "max",
    "--mode",
    "read-only",
    "--prompt",
    join(process.cwd(), "prompt.md"),
    "--cwd",
    process.cwd(),
    "--output",
    join(process.cwd(), "output.md"),
    "--receipt",
    join(process.cwd(), "receipt.json"),
    ...extra,
  ];
}

describe("runner CLI parsing", () => {
  it("does not invent a timeout", () => {
    expect(parseArgs(argv())?.timeoutMs).toBeNull();
  });

  it("honors an explicit positive timeout", () => {
    expect(parseArgs(argv(["--timeout", "5400"]))?.timeoutMs).toBe(5_400_000);
  });

  it("rejects a non-positive timeout", () => {
    expect(() => parseArgs(argv(["--timeout", "0"]))).toThrow(
      "greater than zero"
    );
  });

  it("accepts the ultra effort", () => {
    const args = argv().map((value) => (value === "max" ? "ultra" : value));
    expect(parseArgs(args)?.effort).toBe("ultra");
  });

  it("rejects an effort the registered family does not list", () => {
    const args = argv().map((value) => (value === "max" ? "default" : value));
    expect(() => parseArgs(args)).toThrow("effort default is not offered for codex:gpt-5.6-sol");
  });

  it("accepts the default effort for an unregistered pair", () => {
    const args = argv().map((value) =>
      value === "max" ? "default" : value === "gpt-5.6-sol" ? "gpt-7-preview" : value
    );
    expect(parseArgs(args)).toMatchObject({ model: "gpt-7-preview", effort: "default", family: null });
  });

  it("lists every registered provider in the help text", async () => {
    let stdout = "";
    expect(await main(["--help"], Date.now(), { stdout: (value) => { stdout += value; }, stderr: () => {} })).toBe(0);
    expect(stdout).toStartWith(
      "Usage: pstack-runner --parent <claude|codex> --provider <claude|codex> \\\n"
    );
  });

  it("refuses an unnormalized Claude revision with a usage error", async () => {
    let stderr = "";
    const args = argv().map((value) =>
      value === "claude" ? "codex" : value === "codex" ? "claude" : value === "gpt-5.6-sol" ? "claude-opus-5-5" : value
    );
    expect(await main(args, Date.now(), { stdout: () => {}, stderr: (value) => { stderr += value; } })).toBe(64);
    expect(stderr).toStartWith(
      "error: Claude model claude-opus-5-5 is a version pin; normalize it to opus before invoking the runner\n"
    );
  });
});
