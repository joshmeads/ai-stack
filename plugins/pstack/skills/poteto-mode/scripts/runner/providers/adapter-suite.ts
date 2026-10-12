// Test-only: the properties every adapter keeps. Each providers/<id>.test.ts runs it once.
import { describe, expect, it } from "bun:test";
import type { ProviderAdapter } from "../registry/contract.ts";
import { type Lane, type LaneRequest, resolveLane } from "../registry/index.ts";
import { ACCESS_MODES, PARENTS, type Parent } from "../types.ts";

const BYPASS_TOKENS = [
  "danger-full-access",
  "bypassPermissions",
  "--dangerously-skip-permissions",
  "--always-approve",
  "dangerous",
];

/** A lane from raw request fields, with a parent that differs from the provider. */
export function testLane(request: Partial<LaneRequest> & { readonly provider: string }): Lane {
  const parent = (Object.keys(PARENTS) as Parent[]).find((name) => name !== request.provider)!;
  return resolveLane({
    parent,
    model: "suite-model",
    effort: "max",
    mode: "read-only",
    promptPath: "/tmp/prompt.md",
    cwd: "/tmp/worktree",
    outputPath: "/tmp/output.md",
    receiptPath: "/tmp/receipt.json",
    timeoutMs: null,
    ...request,
  });
}

export function adapterSuite(adapter: ProviderAdapter): void {
  describe(`${adapter.id} adapter contract`, () => {
    const lane = (request: Partial<LaneRequest> = {}) => testLane({ provider: adapter.id, ...request });
    const argv = (request: Partial<LaneRequest> = {}) => adapter.launch.argv(lane(request), { sharedGitDir: null });

    it("passes the requested model to the CLI unchanged", () => {
      expect(argv()).toEqual(expect.arrayContaining(["--model", "suite-model"]));
    });

    it("omits exactly the effort flag and value for the default effort", () => {
      const high = argv({ effort: "high" });
      const at = high.findIndex((token) => token.includes("high"));
      expect(at).toBeGreaterThan(0);
      expect(argv({ effort: "default" })).toEqual([...high.slice(0, at - 1), ...high.slice(at + 1)]);
    });

    it("delivers the prompt one way only", () => {
      for (const mode of ACCESS_MODES) {
        expect(argv({ mode }).includes("/tmp/prompt.md")).toBe(adapter.launch.prompt === "file");
      }
    });

    it("uses bounded modes without bypass tokens", () => {
      for (const mode of ACCESS_MODES) {
        for (const token of argv({ mode })) {
          for (const bypass of BYPASS_TOKENS) expect(token).not.toContain(bypass);
        }
      }
    });
  });
}
