// Test-only: the properties every adapter keeps. Each providers/<id>.test.ts runs it once.
import { describe, expect, it } from "bun:test";
import type { LaunchFacts, ProviderAdapter } from "../registry/contract.ts";
import { effortsOf, type Lane, type LaneRequest, modelIds, REGISTRY, resolveLane } from "../registry/index.ts";
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

/** The facts run.ts passes before argv, with the provider sidecar paths it reserves next to the receipt. */
export function testFacts(adapter: ProviderAdapter, sharedGitDir: string | null = null): LaunchFacts {
  const sidecar = adapter.launch.sidecar;
  return {
    sharedGitDir,
    providerSidecar: sidecar === null ? null : {
      output: `/tmp/receipt.json.provider/${sidecar.output}`,
      config: sidecar.config === null ? null : `/tmp/receipt.json.provider/${sidecar.config.name}`,
    },
  };
}

export function adapterSuite(adapter: ProviderAdapter): void {
  describe(`${adapter.id} adapter contract`, () => {
    // An unregistered model-ID pair is already the CLI model ID, so it takes only the default effort.
    const unregistered = adapter.effortIn === "model-id" ? "default" : "max";
    const lane = (request: Partial<LaneRequest> = {}) =>
      testLane({ provider: adapter.id, effort: unregistered, ...request });
    const argv = (request: Partial<LaneRequest> = {}) => adapter.launch.argv(lane(request), testFacts(adapter));

    it("passes the requested model to the CLI unchanged", () => {
      expect(argv()).toEqual(expect.arrayContaining(["--model", "suite-model"]));
    });

    if (adapter.effortIn === "flag") {
      it("omits exactly the effort flag and value for the default effort", () => {
        const high = argv({ effort: "high" });
        const at = high.findIndex((token) => token.includes("high"));
        expect(at).toBeGreaterThan(0);
        expect(argv({ effort: "default" })).toEqual([...high.slice(0, at - 1), ...high.slice(at + 1)]);
      });
    } else {
      it("passes each registered effort's CLI model ID and no other effort token", () => {
        const families = REGISTRY.families.filter((entry) => entry.provider === adapter.id);
        expect(families.length).toBeGreaterThan(0);
        for (const family of families) {
          for (const effort of effortsOf(family)) {
            const args = argv({ model: family.model, effort });
            const id = modelIds(family)![effort]!;
            expect([family.name, effort, args[args.indexOf("--model") + 1]]).toEqual([family.name, effort, id]);
            expect(args.filter((token) => token.includes(effort) && token !== id)).toEqual([]);
          }
        }
        expect(() => lane({ effort: "max" })).toThrow("effort max is not offered");
      });
    }

    it("delivers the prompt one way only", () => {
      for (const mode of adapter.launch.supports) {
        expect(argv({ mode }).includes("/tmp/prompt.md")).toBe(adapter.launch.prompt === "file");
      }
    });

    it("uses bounded modes without bypass tokens", () => {
      for (const mode of adapter.launch.supports) {
        for (const token of argv({ mode })) {
          for (const bypass of BYPASS_TOKENS) expect(token).not.toContain(bypass);
        }
      }
    });

    it("refuses every access mode it does not support before launch", () => {
      for (const mode of ACCESS_MODES.filter((entry) => !adapter.launch.supports.includes(entry))) {
        expect(() => lane({ mode })).toThrow(`provider ${adapter.id} does not support ${mode}`);
      }
    });
  });
}
