import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { childEnvironment, discoverSharedGitDir, runLane } from "./run.ts";
import { main } from "./cli.ts";
import { type LaneRequest, resolveLane } from "./registry/index.ts";
import type { ProviderId } from "./registry/family.ts";
import type { RunnerReceipt } from "./types.ts";

let scratch = "";
let bin = "";
let previousPath: string | undefined;

function streamPath(path: string | null): string {
  if (path === null) throw new Error("expected a reserved stream artifact path");
  return path;
}

const fake = `#!/usr/bin/env bun
import { unlinkSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const name = process.argv[1].split("/").at(-1);
const isPreflight =
  (name === "claude" && args[0] === "auth") ||
  (name === "codex" && args[0] === "login");
const stage = isPreflight ? "preflight" : "model";
const startedPath = isPreflight
  ? process.env.FAKE_PREFLIGHT_STARTED_PATH
  : process.env.FAKE_MODEL_STARTED_PATH;
if (startedPath) writeFileSync(startedPath, String(process.pid));
const cancelStage = process.env.FAKE_CANCEL_STAGE ??
  (process.env.FAKE_CANCEL === "1" ? "model" : "");
if (cancelStage === stage) {
  const stop = (signal) => {
    writeFileSync(process.env.FAKE_TERMINATED_PATH, signal);
    if (process.env.FAKE_IGNORE_SIGNAL !== "1") process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  writeFileSync(process.env.FAKE_STARTED_PATH, String(process.pid));
  await Bun.sleep(5_000);
}
const delay = Number(
  stage === "preflight"
    ? process.env.FAKE_PREFLIGHT_DELAY_MS ?? 0
    : process.env.FAKE_MODEL_DELAY_MS ?? 0
);
if (delay > 0) await Bun.sleep(delay);
if (process.env.FAKE_TIMEOUT === "1" && !args.includes("status")) {
  await Bun.sleep(5_000);
}
if (name === "claude" && args[0] === "auth") {
  if (process.env.FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT === "1") {
    unlinkSync(process.argv[1]);
  }
  if (process.env.FAKE_UNAUTH === "1") {
    console.log(JSON.stringify({loggedIn:false}));
    process.exit(1);
  }
  console.log(JSON.stringify({loggedIn:true}));
  process.exit(0);
}
if (name === "codex" && args[0] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
const modelIndex = args.findIndex((value) => value === "--model");
const model = modelIndex >= 0 ? args[modelIndex + 1] : "unknown";
const reportedModel = model === "fable"
  ? "claude-fable-9-9"
  : model === "opus"
    ? "claude-opus-9"
    : model;
if (process.env.FAKE_INVALID_MODEL === "1") {
  console.error("The requested model is not supported with this account.");
  process.exit(1);
}
if (stage === "model" && process.env.FAKE_DESCENDANT_HOLDS_PIPES_MS) {
  const seconds = Number(process.env.FAKE_DESCENDANT_HOLDS_PIPES_MS) / 1000;
  const descendant = Bun.spawn(["/bin/sh", "-c", "sleep " + seconds], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (process.env.FAKE_DESCENDANT_PID_PATH) {
    writeFileSync(process.env.FAKE_DESCENDANT_PID_PATH, String(descendant.pid));
  }
  descendant.unref();
}
if (stage === "model" && process.env.FAKE_SELF_SIGNAL) {
  process.kill(process.pid, process.env.FAKE_SELF_SIGNAL);
  await Bun.sleep(5_000);
}
if (name === "claude") {
  console.log(JSON.stringify({result:"CLAUDE_OK",session_id:"c1",usage:{input_tokens:10,output_tokens:2},total_cost_usd:0.01,modelUsage:{[reportedModel]:{}}}));
} else if (name === "codex") {
  console.log(JSON.stringify({type:"thread.started",thread_id:"o1"}));
  console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"CODEX_OK"}}));
  console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:20,cached_input_tokens:5,output_tokens:3,reasoning_output_tokens:1}}));
}
if (process.env.FAKE_MODEL_EXITING_PATH) {
  writeFileSync(process.env.FAKE_MODEL_EXITING_PATH, String(process.pid));
}
`;

function makeExecutable(name: string): void {
  const path = join(bin, name);
  writeFileSync(path, fake);
  chmodSync(path, 0o755);
}

function options(provider: ProviderId, suffix: string = provider): LaneRequest {
  const parent = provider === "codex" ? "claude" : "codex";
  const model = provider === "claude" ? "fable" : "gpt-5.6-sol";
  return {
    parent,
    provider,
    model,
    effort: "max",
    mode: "read-only",
    promptPath: join(scratch, "prompt.md"),
    cwd: scratch,
    outputPath: join(scratch, `${suffix}.out`),
    receiptPath: join(scratch, `${suffix}.receipt.json`),
    timeoutMs: null,
  };
}

const laneOf = resolveLane;

function receipt(path: string): RunnerReceipt {
  return JSON.parse(readFileSync(path, "utf8")) as RunnerReceipt;
}

// Fixture git never sees the caller's GIT_* routing or hooks. A ceiling, when given, keeps
// repositories above the fixture root out of discovery.
function gitEnv(ceiling: string | null = null): NodeJS.ProcessEnv {
  const env = childEnvironment(laneOf({ ...options("claude"), mode: "isolated-write" }));
  return ceiling === null ? env : { ...env, GIT_CEILING_DIRECTORIES: ceiling };
}

function git(env: NodeJS.ProcessEnv, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", ...args], {
    env,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function gitRepository(env: NodeJS.ProcessEnv, path: string): void {
  git(env, "-c", "init.defaultBranch=main", "init", "-q", path);
  git(
    env, "-C", path, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false",
    "commit", "-q", "--allow-empty", "-m", "init"
  );
}

function runnerArgs(input: LaneRequest): string[] {
  const args = [
    join(import.meta.dir, "pstack-runner"),
    "--parent", input.parent,
    "--provider", input.provider,
    "--model", input.model,
    "--effort", input.effort,
    "--mode", input.mode,
    "--prompt", input.promptPath,
    "--cwd", input.cwd,
    "--output", input.outputPath,
    "--receipt", input.receiptPath,
  ];
  if (input.timeoutMs !== null) {
    args.push("--timeout", String(input.timeoutMs / 1_000));
  }
  return args;
}

async function waitFor(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function exitWithin(child: Bun.Subprocess, milliseconds: number): Promise<number> {
  const result = await Promise.race([
    child.exited,
    Bun.sleep(milliseconds).then(() => null),
  ]);
  if (result !== null) return result;
  child.kill("SIGKILL");
  await child.exited;
  throw new Error(`runner did not exit within ${milliseconds}ms`);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!processIsAlive(pid)) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for process ${pid} to exit`);
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-runner-test-"));
  bin = join(scratch, "bin");
  mkdirSync(bin);
  writeFileSync(join(scratch, "prompt.md"), "Return the marker.");
  for (const name of ["claude", "codex"]) makeExecutable(name);
  previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${dirname(process.execPath)}:${previousPath ?? ""}`;
  delete process.env.FAKE_TIMEOUT;
  delete process.env.FAKE_INVALID_MODEL;
  delete process.env.FAKE_CANCEL;
  delete process.env.FAKE_CANCEL_STAGE;
  delete process.env.FAKE_IGNORE_SIGNAL;
  delete process.env.FAKE_PREFLIGHT_DELAY_MS;
  delete process.env.FAKE_MODEL_DELAY_MS;
  delete process.env.FAKE_STARTED_PATH;
  delete process.env.FAKE_TERMINATED_PATH;
  delete process.env.FAKE_PREFLIGHT_STARTED_PATH;
  delete process.env.FAKE_MODEL_STARTED_PATH;
  delete process.env.FAKE_MODEL_EXITING_PATH;
  delete process.env.FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT;
  delete process.env.FAKE_UNAUTH;
  delete process.env.FAKE_DESCENDANT_HOLDS_PIPES_MS;
  delete process.env.FAKE_DESCENDANT_PID_PATH;
  delete process.env.FAKE_SELF_SIGNAL;
});

afterEach(() => {
  process.env.PATH = previousPath;
  delete process.env.FAKE_TIMEOUT;
  delete process.env.FAKE_INVALID_MODEL;
  delete process.env.FAKE_CANCEL;
  delete process.env.FAKE_CANCEL_STAGE;
  delete process.env.FAKE_IGNORE_SIGNAL;
  delete process.env.FAKE_PREFLIGHT_DELAY_MS;
  delete process.env.FAKE_MODEL_DELAY_MS;
  delete process.env.FAKE_STARTED_PATH;
  delete process.env.FAKE_TERMINATED_PATH;
  delete process.env.FAKE_PREFLIGHT_STARTED_PATH;
  delete process.env.FAKE_MODEL_STARTED_PATH;
  delete process.env.FAKE_MODEL_EXITING_PATH;
  delete process.env.FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT;
  delete process.env.FAKE_UNAUTH;
  delete process.env.FAKE_DESCENDANT_HOLDS_PIPES_MS;
  delete process.env.FAKE_DESCENDANT_PID_PATH;
  delete process.env.FAKE_SELF_SIGNAL;
  rmSync(scratch, { recursive: true, force: true });
});

describe("Codex parent sandbox diagnostics", () => {
  let previousNetworkDisabled: string | undefined;

  beforeEach(() => {
    previousNetworkDisabled = process.env.CODEX_SANDBOX_NETWORK_DISABLED;
    delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  });

  afterEach(() => {
    if (previousNetworkDisabled === undefined) {
      delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
    } else {
      process.env.CODEX_SANDBOX_NETWORK_DISABLED = previousNetworkDisabled;
    }
  });

  it("names likely Codex sandbox cause after child failure", async () => {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
    const invoked = join(scratch, "model-invoked.json");
    writeFileSync(join(bin, "claude"), `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
if (process.argv[2] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
writeFileSync(${JSON.stringify(invoked)}, JSON.stringify({
  argv: process.argv.slice(2),
  networkDisabled: process.env.CODEX_SANDBOX_NETWORK_DISABLED ?? null,
}));
console.error("ENOTFOUND api.anthropic.com");
process.exit(1);
`);
    const input = options("claude");
    const result = await runLane(laneOf(input));
    const saved = receipt(input.receiptPath);
    expect(JSON.parse(readFileSync(invoked, "utf8"))).toMatchObject({
      argv: expect.arrayContaining(["--model", "fable"]),
      networkDisabled: null,
    });
    expect(result.exitCode).toBe(70);
    expect(saved.status).toBe("child-failed");
    expect(saved.exitCode).toBe(1);
    expect(saved.preflight.status).toBe("passed");
    expect(saved.error?.message).toContain("child exited with status 1");
    expect(saved.error?.message).toContain("likely cause: Codex parent sandbox has network disabled");
    expect(saved.error?.evidence).toStartWith("likely cause: Codex parent sandbox has network disabled");
    expect(saved.error?.evidence).toContain("ENOTFOUND api.anthropic.com");
    expect(saved.error?.message).toContain("provider-dispatch.md#host-and-parent-prerequisites");
    expect(saved.schemaVersion).toBe(1);
    expect(saved.model).toBe(input.model);
    expect(saved.effort as string).toBe(input.effort);
    expect(readFileSync(streamPath(saved.stderrPath), "utf8")).toBe("ENOTFOUND api.anthropic.com\n");
    expect(existsSync(input.outputPath)).toBe(false);
  });

  for (const marker of [undefined, "0", "true"]) {
    it(`does not infer blocked network from marker ${marker}`, async () => {
      if (marker !== undefined) process.env.CODEX_SANDBOX_NETWORK_DISABLED = marker;
      writeFileSync(join(bin, "claude"), `#!/usr/bin/env bun
if (process.argv[2] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
console.error("ENOTFOUND api.anthropic.com; EACCES local-state");
process.exit(1);
`);
      const result = await runLane(laneOf(options("claude")));
      expect(result.exitCode).toBe(70);
      expect(result.receipt.error).toEqual({
        message: "child exited with status 1",
        evidence: "ENOTFOUND api.anthropic.com; EACCES local-state",
      });
    });
  }

  it("does not blame a Claude parent even with the network marker", async () => {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
    writeFileSync(join(bin, "codex"), `#!/usr/bin/env bun
if (process.argv[2] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
console.error("ENOTFOUND api.openai.com");
process.exit(1);
`);
    const result = await runLane(laneOf(options("codex")));
    expect(result.exitCode).toBe(70);
    expect(result.receipt.error).toEqual({
      message: "child exited with status 1",
      evidence: "ENOTFOUND api.openai.com",
    });
  });

  it("puts the hint ahead of bounded evidence without changing raw sidecars", async () => {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
    const stderr = "startup warning\n".repeat(400) + "EACCES ~/.claude.json\n";
    writeFileSync(join(bin, "claude"), `#!/usr/bin/env bun
if (process.argv[2] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
process.stderr.write(${JSON.stringify(stderr)});
process.exit(1);
`);
    const input = options("claude");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(70);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.error?.evidence).toStartWith("likely cause: Codex parent sandbox has network disabled");
    expect(result.receipt.error?.evidence?.length).toBe(4_000);
    expect(readFileSync(streamPath(result.receipt.stderrPath), "utf8")).toBe(stderr);
  });

  it("leaves successful lanes unchanged with the marker", async () => {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
    const result = await runLane(laneOf(options("claude")));
    expect(result.exitCode).toBe(0);
    expect(result.receipt.status).toBe("complete");
    expect(result.receipt.error).toBeNull();
  });

  for (const status of ["unavailable-model", "unauthenticated", "timed-out"] as const) {
    it(`does not enrich ${status} with a sandbox hint`, async () => {
      process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
      const input = { ...options("claude"), timeoutMs: status === "timed-out" ? 150 : null };
      if (status === "unavailable-model") process.env.FAKE_INVALID_MODEL = "1";
      if (status === "unauthenticated") process.env.FAKE_UNAUTH = "1";
      if (status === "timed-out") process.env.FAKE_TIMEOUT = "1";
      const result = await runLane(laneOf(input));
      expect(result.receipt.status).toBe(status);
      expect(result.receipt.error?.message).not.toContain("Codex parent sandbox");
      expect(result.receipt.error?.evidence).not.toContain("Codex parent sandbox");
    }, 10_000);
  }
});

describe("stream sidecars and terminal data", () => {
  for (const stream of ["stdout", "stderr"]) {
    it(`rolls back reservations without overwriting an existing ${stream} sidecar`, async () => {
      const input = options("claude");
      const conflict = `${input.receiptPath}.${stream}`;
      writeFileSync(conflict, "operator evidence");
      await expect(runLane(laneOf(input))).rejects.toThrow();
      expect(readFileSync(conflict, "utf8")).toBe("operator evidence");
      for (const path of [input.outputPath, input.receiptPath,
        `${input.receiptPath}.${stream === "stdout" ? "stderr" : "stdout"}`]) {
        expect(existsSync(path)).toBe(false);
      }
    });

    it(`rejects a ${stream} sidecar colliding with the prompt or output`, async () => {
      const input = options("claude");
      const conflict = `${input.receiptPath}.${stream}`;
      writeFileSync(conflict, "operator prompt");
      await expect(runLane(laneOf({ ...input, promptPath: conflict }))).rejects.toThrow("must be distinct");
      expect(readFileSync(conflict, "utf8")).toBe("operator prompt");
      rmSync(conflict);
      await expect(runLane(laneOf({ ...input, outputPath: conflict }))).rejects.toThrow("must be distinct");
      for (const path of [input.outputPath, input.receiptPath,
        `${input.receiptPath}.stdout`, `${input.receiptPath}.stderr`]) {
        expect(existsSync(path)).toBe(false);
      }
    });
  }

  it("retains complete streams when writes are partial", async () => {
    const input = options("claude");
    const stdout = JSON.stringify({ result: "CLAUDE_OK", modelUsage: { "claude-fable-9-9": {} } }) + "\n";
    const stderr = "complete stderr despite partial writes\n";
    writeFileSync(join(bin, "claude"), fake.replace("const modelIndex =",
      `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(0);\nconst modelIndex =`));
    const originalWrite = fs.writeSync;
    let partialWrites = 0;
    const write = spyOn(fs, "writeSync").mockImplementation((descriptor, data, offset, length) => {
      if (typeof data === "string") return originalWrite(descriptor, data, offset);
      partialWrites++;
      return originalWrite(descriptor, data, offset,
        Math.min(typeof length === "number" ? length : data.byteLength, 7));
    });
    try {
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(0);
      expect(partialWrites).toBeGreaterThan(1);
      expect(readFileSync(streamPath(result.receipt.stdoutPath))).toEqual(Buffer.from(stdout));
      expect(readFileSync(streamPath(result.receipt.stderrPath))).toEqual(Buffer.from(stderr));
    } finally {
      write.mockRestore();
    }
  });

  it("terminalizes a sidecar write failure without waiting for the child", async () => {
    const input = options("claude");
    writeFileSync(join(bin, "claude"), fake.replace("const modelIndex =",
      'process.stdout.write("stream data"); await Bun.sleep(10_000);\nconst modelIndex ='));
    const originalWrite = fs.writeSync;
    const write = spyOn(fs, "writeSync").mockImplementation((descriptor, data, offset, length) => {
      if (typeof data === "string") return originalWrite(descriptor, data, offset);
      throw new Error("sidecar storage unavailable");
    });
    try {
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(70);
      expect(result.receipt.status).toBe("child-failed");
      expect(result.receipt.error?.evidence).toContain("sidecar storage unavailable");
      expect(existsSync(input.outputPath)).toBe(false);
      expect(existsSync(streamPath(result.receipt.stdoutPath))).toBe(true);
      expect(existsSync(streamPath(result.receipt.stderrPath))).toBe(true);
    } finally {
      write.mockRestore();
    }
  });

  it("retains undecodable stderr bytes rather than re-encoding captured text", async () => {
    const input = options("claude");
    const bytes = Buffer.from([0, 255, 195, 169, 13, 10]);
    writeFileSync(join(bin, "claude"), fake.replace("const modelIndex =",
      `process.stderr.write(Buffer.from(${JSON.stringify([...bytes])}));\nconst modelIndex =`));
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(0);
    expect(readFileSync(streamPath(result.receipt.stderrPath))).toEqual(bytes);
  });

  for (const exitCode of [0, 1]) {
    it(`keeps malformed terminal data distinct after child exit ${exitCode}`, async () => {
      const input = options("claude");
      const stdout = "startup failed\n";
      writeFileSync(join(bin, "claude"), fake.replace("const modelIndex =",
        `process.stdout.write(${JSON.stringify(stdout)}); process.exit(${exitCode});\nconst modelIndex =`));
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(exitCode === 0 ? 65 : 70);
      expect(result.receipt).toMatchObject({
        status: exitCode === 0 ? "malformed-output" : "child-failed",
        exitCode, reportedModel: null, modelVerified: false,
        sessionId: null, error: { message: exitCode === 0
          ? "claude did not emit valid JSON" : "child exited with status 1" },
      });
      expect(readFileSync(streamPath(result.receipt.stdoutPath), "utf8")).toEndWith(stdout);
      expect(existsSync(input.outputPath)).toBe(false);
    });
  }

  it("does not read authentication from malformed terminal data after a nonzero exit", async () => {
    const input = options("claude");
    writeFileSync(join(bin, "claude"), fake.replace("const modelIndex =",
      'process.stdout.write(\'{"type":"result","is_error":true}\\n\'); console.error("Not logged in. Run claude auth login."); process.exit(1);\nconst modelIndex ='));
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(70);
    expect(result.receipt).toMatchObject({
      status: "child-failed", exitCode: 1, error: { message: "child exited with status 1" },
    });
    expect(result.receipt.error?.evidence).toContain("Not logged in.");
  });

  it("retains strict model verification for successful Claude results", async () => {
    const input = options("claude");
    writeFileSync(join(bin, "claude"), fake.replace('? "claude-fable-9-9"', '? "claude-opus-9"'));
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(65);
    expect(result.receipt).toMatchObject({ status: "malformed-output", modelVerified: false });
    expect(result.receipt.error?.message).toBe("requested model fable was not reported by claude");
    expect(readFileSync(streamPath(result.receipt.stdoutPath), "utf8")).toContain("claude-opus-9");
    expect(existsSync(input.outputPath)).toBe(false);
  });
});

describe("runLane", () => {
  for (const startup of ["dotenv", "bunfig", "bun-options", "node-options", "combined", "hostile-path", "bare-name"]) {
    it(`shipped launcher startup isolation: ${startup}`, async () => {
      const input = options("codex", startup);
      // Exceed pipe capacity so the fake provider must consume stdin before exiting.
      writeFileSync(input.promptPath, "Return the marker.\n".repeat(100_000));
      const captured = join(scratch, "provider-env.txt");
      const capturedPrompt = join(scratch, "provider-prompt.txt");
      const bunPreload = join(scratch, "bun-preload.ran");
      const nodePreload = join(scratch, "node-preload.ran");
      const env: Record<string, string> = {
        PATH: process.env.PATH!,
        PSTACK_ENV_CAPTURE: captured,
        PSTACK_PROMPT_CAPTURE: capturedPrompt,
        PSTACK_INHERITED_ENV_SENTINEL: "inherited-from-parent",
      };
      if (startup === "dotenv" || startup === "combined") {
        writeFileSync(join(scratch, ".env"), "PSTACK_PROJECT_ENV_SENTINEL=loaded-from-project-dotenv\n");
        writeFileSync(join(scratch, ".env.local"), "PSTACK_LOCAL_ENV_SENTINEL=loaded-from-project-local-dotenv\n");
      }
      if (startup === "bunfig" || startup === "combined") {
        writeFileSync(join(scratch, "bunfig.toml"), 'preload = ["./project-preload.ts"]\n');
        writeFileSync(join(scratch, "project-preload.ts"),
          `await Bun.write(${JSON.stringify(bunPreload)}, "project preload ran");\n`);
      }
      if (startup === "bun-options" || startup === "combined") {
        writeFileSync(join(scratch, "startup.env"), "PSTACK_PROJECT_ENV_SENTINEL=loaded-from-bun-options\n");
        env.BUN_OPTIONS = "--env-file=./startup.env";
      }
      if (startup === "node-options" || startup === "combined") {
        writeFileSync(join(scratch, "project-preload.cjs"),
          `require("node:fs").writeFileSync(${JSON.stringify(nodePreload)}, "node preload ran");\n`);
        env.NODE_OPTIONS = "--require=./project-preload.cjs";
      }
      writeFileSync(join(bin, "codex"), `#!/bin/sh
if [ "$1" = "login" ]; then
  printf '%s\\n' 'Logged in using ChatGPT'
  exit 0
fi
cat > "$PSTACK_PROMPT_CAPTURE"
printf '%s\\n' "\${PSTACK_PROJECT_ENV_SENTINEL-unset}" "\${PSTACK_LOCAL_ENV_SENTINEL-unset}" "\${PSTACK_INHERITED_ENV_SENTINEL-unset}" "\${BUN_OPTIONS-unset}" "\${NODE_OPTIONS-unset}" > "$PSTACK_ENV_CAPTURE"
printf '%s\\n' '{"type":"thread.started","thread_id":"isolated"}' '{"type":"item.completed","item":{"type":"agent_message","text":"CODEX_OK"}}' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'
`);
      chmodSync(join(bin, "codex"), 0o755);
      const helperSentinel = join(scratch, "helper.ran");
      if (startup === "hostile-path") {
        for (const name of ["env", "dirname", "readlink"]) {
          writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' '${name}' > "${helperSentinel}"\nexit 1\n`);
          chmodSync(join(bin, name), 0o755);
        }
      }
      const runner = Bun.spawn(startup === "bare-name"
        ? ["/bin/sh", "pstack-runner", ...runnerArgs(input).slice(1)]
        : runnerArgs(input), {
        cwd: startup === "bare-name" ? import.meta.dir : scratch,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = new Response(runner.stdout).text();
      const stderr = new Response(runner.stderr).text();
      const exitCode = await exitWithin(runner, 3_000);
      const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
      expect(exitCode, JSON.stringify({
        stdout: stdoutText,
        stderr: stderrText,
        receipt: existsSync(input.receiptPath) ? receipt(input.receiptPath) : null,
      })).toBe(0);
      expect(readFileSync(capturedPrompt, "utf8")).toBe(readFileSync(input.promptPath, "utf8"));
      expect(readFileSync(captured, "utf8")).toBe("unset\nunset\ninherited-from-parent\nunset\nunset\n");
      expect(existsSync(bunPreload)).toBe(false);
      expect(existsSync(nodePreload)).toBe(false);
      expect(existsSync(helperSentinel)).toBe(false);
      expect(readFileSync(input.outputPath, "utf8")).toContain("CODEX_OK");
      expect(receipt(input.receiptPath)).toMatchObject({ status: "complete" });
    });
  }

  for (const provider of ["claude", "codex"] as const) {
    it(`executes and receipts the ${provider} external lane`, async () => {
      const input = options(provider);
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(0);
      expect(readFileSync(input.outputPath, "utf8")).toContain(
        provider.toUpperCase()
      );
      expect(receipt(input.receiptPath)).toMatchObject({
        status: "complete",
        provider,
        model: input.model,
        modelVerified: provider !== "codex",
        modelEvidence: provider === "codex" ? "pinned-argv" : "provider-report",
        preflight: { status: "passed" },
      });
      const saved = receipt(input.receiptPath);
      expect(readFileSync(streamPath(saved.stdoutPath), "utf8")).toContain(provider.toUpperCase());
      expect(readFileSync(streamPath(saved.stderrPath))).toEqual(Buffer.alloc(0));
      for (const path of [saved.stdoutPath, saved.stderrPath]) {
        expect(statSync(streamPath(path)).mode & 0o777).toBe(0o600);
      }
      if (provider === "claude") {
        expect(receipt(input.receiptPath).reportedModel).toBe("claude-fable-9-9");
      }
    });
  }

  it("records Codex's exact argv without fabricating a reported model", async () => {
    const input = options("codex");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(0);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      model: "gpt-5.6-sol",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: "pinned-argv",
    });
  });

  it("classifies an unavailable model without falling back", async () => {
    process.env.FAKE_INVALID_MODEL = "1";
    const input = options("codex");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(69);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "unavailable-model",
      model: "gpt-5.6-sol",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: null,
    });
  });

  for (const text of [
    "reviewing the authentication middleware",
    "not logged in",
    "unauthenticated",
    "sign in",
    "login required",
  ]) {
    for (const stream of ["stdout", "stderr"] as const) {
      it(`classifies a failed model call mentioning "${text}" on ${stream} as child-failed`, async () => {
        writeFileSync(join(bin, "codex"), `#!/usr/bin/env bun
if (process.argv[2] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
console.${stream === "stdout" ? "log" : "error"}(${JSON.stringify(text)});
process.exit(1);
`);
        const input = options("codex");
        const result = await runLane(laneOf(input));
        expect(result.exitCode).toBe(70);
        expect(result.receipt).toMatchObject({
          status: "child-failed",
          exitCode: 1,
          preflight: { status: "passed" },
          error: { message: "child exited with status 1" },
        });
        expect(result.receipt.error?.evidence).toContain(text);
      });
    }
  }

  it("kills a timed-out child and preserves a failure receipt", async () => {
    process.env.FAKE_TIMEOUT = "1";
    const input = { ...options("claude"), timeoutMs: 30 };
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(124);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath).status).toBe("timed-out");
  });

  it("does not spawn the model when preflight exhausts the wrapper deadline", async () => {
    const modelStarted = join(scratch, "deadline-model.started");
    const input = { ...options("claude", "preflight-deadline"), timeoutMs: 300 };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_PREFLIGHT_DELAY_MS: "1000",
        FAKE_MODEL_STARTED_PATH: modelStarted,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(124);
    await Promise.all([stdout, stderr]);
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "timed-out",
      signal: "SIGTERM",
      preflight: { status: "timed-out" },
    });
  });

  it("lets a delayed wrapper lane finish when timeout is omitted", async () => {
    const input = options("claude", "unbounded-default");
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: { ...process.env, FAKE_MODEL_DELAY_MS: "400" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 3_000)).toBe(0);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      signal: null,
    });
    expect(receipt(input.receiptPath).elapsedMs).toBeGreaterThanOrEqual(400);
  });

  it("keeps a very long explicit deadline without timer overflow", async () => {
    const input = {
      ...options("claude", "long-runtime-deadline"),
      timeoutMs: 2_147_483_648,
    };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: { ...process.env, FAKE_MODEL_DELAY_MS: "100" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(0);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      signal: null,
      exitCode: 0,
    });
  });

  it("counts wrapper import and parsing time against an explicit deadline", async () => {
    const preflightStarted = join(scratch, "expired-preflight.started");
    const modelStarted = join(scratch, "expired-model.started");
    process.env.FAKE_PREFLIGHT_STARTED_PATH = preflightStarted;
    process.env.FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = { ...options("claude", "expired-at-entry"), timeoutMs: 100 };
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await main(
      runnerArgs(input).slice(1),
      Date.now() - 1_000,
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      }
    );

    expect(exitCode).toBe(124);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain('"status":"timed-out"');
    expect(existsSync(preflightStarted)).toBe(false);
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "timed-out",
      preflight: { status: "timed-out" },
    });
  });

  it("spends one explicit deadline across preflight and model execution", async () => {
    process.env.FAKE_PREFLIGHT_DELAY_MS = "1200";
    process.env.FAKE_MODEL_DELAY_MS = "1200";
    const input = { ...options("claude"), timeoutMs: 1_500 };
    const result = await runLane(laneOf(input));
    const recorded = receipt(input.receiptPath);

    expect(result.exitCode).toBe(124);
    expect(recorded.status).toBe("timed-out");
    expect(recorded.preflight.status).toBe("passed");
    expect(recorded.elapsedMs).toBeLessThan(2_100);
  });

  it("bounds a descendant-held pipe by the explicit deadline without fabricating a signal", async () => {
    const descendantPidPath = join(scratch, "deadline-descendant.pid");
    const input = { ...options("claude", "deadline-drain"), timeoutMs: 700 };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_DESCENDANT_HOLDS_PIPES_MS: "5000",
        FAKE_DESCENDANT_PID_PATH: descendantPidPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(124);
    await Promise.all([stdout, stderr]);
    const recorded = receipt(input.receiptPath);
    expect(recorded).toMatchObject({
      status: "timed-out",
      exitCode: 0,
      signal: null,
      preflight: { status: "passed" },
    });
    expect(recorded.elapsedMs).toBeLessThan(1_500);

    const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
    if (processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
  });

  it("does not claim a signal was sent to an already signal-reaped child", async () => {
    const descendantPidPath = join(scratch, "signalled-descendant.pid");
    const input = { ...options("claude", "signalled-drain"), timeoutMs: 700 };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_DESCENDANT_HOLDS_PIPES_MS: "5000",
        FAKE_DESCENDANT_PID_PATH: descendantPidPath,
        FAKE_SELF_SIGNAL: "SIGTERM",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(124);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "timed-out",
      exitCode: 143,
      signal: null,
      preflight: { status: "passed" },
    });

    const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
    if (processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
  });

  it("lets manual cancellation end a post-exit pipe drain without a default timeout", async () => {
    const descendantPidPath = join(scratch, "cancel-descendant.pid");
    const modelExiting = join(scratch, "cancel-model.exiting");
    const input = options("claude", "cancel-drain");
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_DESCENDANT_HOLDS_PIPES_MS: "5000",
        FAKE_DESCENDANT_PID_PATH: descendantPidPath,
        FAKE_MODEL_EXITING_PATH: modelExiting,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(modelExiting);
    await waitForExit(Number(readFileSync(modelExiting, "utf8")));
    runner.kill("SIGTERM");

    expect(await exitWithin(runner, 2_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      exitCode: 0,
      signal: null,
      preflight: { status: "passed" },
      error: { message: "launcher received SIGTERM after child exited" },
    });

    const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
    if (processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
  });

  it("clears a losing long-deadline timer when the shipped wrapper succeeds", async () => {
    const input = { ...options("claude", "long-deadline"), timeoutMs: 60_000 };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 3_000)).toBe(0);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath).status).toBe("complete");
  });

  it("cancels a preflight with SIGINT and writes a terminal receipt", async () => {
    const input = options("claude", "preflight-cancelled");
    const started = join(scratch, "preflight-child.started");
    const terminated = join(scratch, "preflight-child.terminated");
    const isolatedRunner = join(scratch, "isolated-runner");
    cpSync(import.meta.dir, isolatedRunner, { recursive: true });
    const runner = Bun.spawn([
      join(isolatedRunner, "pstack-runner"),
      ...runnerArgs(input).slice(1),
    ], {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_CANCEL_STAGE: "preflight",
        FAKE_STARTED_PATH: started,
        FAKE_TERMINATED_PATH: terminated,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(started);
    runner.kill("SIGINT");

    expect(await exitWithin(runner, 3_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(terminated, "utf8")).toBe("SIGINT");
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      signal: "SIGINT",
      preflight: { status: "cancelled" },
    });
  });

  it("reaps the child and exits after repeated cancellation with a long deadline", async () => {
    const input = { ...options("codex", "repeated-cancel"), timeoutMs: 60_000 };
    const started = join(scratch, "repeated-child.started");
    const terminated = join(scratch, "repeated-child.terminated");
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_CANCEL: "1",
        FAKE_IGNORE_SIGNAL: "1",
        FAKE_STARTED_PATH: started,
        FAKE_TERMINATED_PATH: terminated,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(started);
    const childPid = Number(readFileSync(started, "utf8"));
    runner.kill("SIGTERM");
    await Bun.sleep(100);
    runner.kill("SIGTERM");

    expect(await exitWithin(runner, 4_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(terminated, "utf8")).toBe("SIGTERM");
    expect(processIsAlive(childPid)).toBe(false);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      signal: "SIGTERM",
    });
  });

  it("forwards cancellation, preserves its receipt, and permits a new attempt", async () => {
    const input = options("codex", "cancelled");
    const started = join(scratch, "cancelled-child.started");
    const terminated = join(scratch, "cancelled-child.terminated");
    const env = {
      ...process.env,
      FAKE_CANCEL: "1",
      FAKE_STARTED_PATH: started,
      FAKE_TERMINATED_PATH: terminated,
    };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(started);
    runner.kill("SIGTERM");

    expect(await runner.exited).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(terminated, "utf8")).toBe("SIGTERM");
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      signal: "SIGTERM",
      exitCode: 0,
      error: { message: "launcher received SIGTERM; signal was sent to child" },
    });

    const samePaths = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const sameStdout = new Response(samePaths.stdout).text();
    const sameStderr = new Response(samePaths.stderr).text();
    expect(await samePaths.exited).toBe(64);
    await Promise.all([sameStdout, sameStderr]);
    expect(receipt(input.receiptPath).status).toBe("cancelled");

    const retry = options("codex", "cancelled-retry");
    const result = await runLane(laneOf(retry));
    expect(result.exitCode).toBe(0);
    expect(receipt(retry.receiptPath).status).toBe("complete");
  });

  it("reports a missing CLI without fabricating output", async () => {
    process.env.PATH = join(scratch, "empty-bin");
    mkdirSync(process.env.PATH);
    const input = options("codex");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(69);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath).status).toBe("unavailable-cli");
  });

  it("runs simultaneous same-provider lanes only into their unique paths", async () => {
    const first = options("claude", "first");
    const second = options("claude", "second");
    const results = await Promise.all([runLane(laneOf(first)), runLane(laneOf(second))]);
    expect(results.map((result) => result.exitCode)).toEqual([0, 0]);
    expect(first.outputPath).not.toBe(second.outputPath);
    expect(receipt(first.receiptPath).sessionId).toBe("c1");
    expect(receipt(second.receiptPath).sessionId).toBe("c1");
  });

  it("refuses a second writer for an already-reserved path", async () => {
    const input = options("claude");
    writeFileSync(input.outputPath, "owned");
    await expect(runLane(laneOf(input))).rejects.toThrow();
    expect(readFileSync(input.outputPath, "utf8")).toBe("owned");
    expect(existsSync(input.receiptPath)).toBe(false);
  });

  it("terminalizes catchable failures after reserving output paths", async () => {
    const unreadable = options("claude", "unreadable-prompt");
    chmodSync(unreadable.promptPath, 0o000);
    const unreadableRunner = Bun.spawn(runnerArgs(unreadable), {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const unreadableStdout = new Response(unreadableRunner.stdout).text();
    const unreadableStderr = new Response(unreadableRunner.stderr).text();
    expect(await unreadableRunner.exited).toBe(70);
    await Promise.all([unreadableStdout, unreadableStderr]);
    chmodSync(unreadable.promptPath, 0o600);

    const preservedReceipt = readFileSync(unreadable.receiptPath, "utf8");
    expect(statSync(unreadable.receiptPath).size).toBeGreaterThan(0);
    expect(existsSync(unreadable.outputPath)).toBe(false);
    expect(receipt(unreadable.receiptPath)).toMatchObject({
      status: "child-failed",
      preflight: { status: "not-run" },
      error: { message: "launcher failed after reserving output paths" },
    });

    const samePaths = Bun.spawn(runnerArgs(unreadable), {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const sameStdout = new Response(samePaths.stdout).text();
    const sameStderr = new Response(samePaths.stderr).text();
    expect(await samePaths.exited).toBe(64);
    await Promise.all([sameStdout, sameStderr]);
    expect(readFileSync(unreadable.receiptPath, "utf8")).toBe(preservedReceipt);

    const spawnFailure = options("claude", "spawn-failure");
    const modelStarted = join(scratch, "spawn-failure-model.started");
    const spawnRunner = Bun.spawn(runnerArgs(spawnFailure), {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT: "1",
        FAKE_MODEL_STARTED_PATH: modelStarted,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const spawnStdout = new Response(spawnRunner.stdout).text();
    const spawnStderr = new Response(spawnRunner.stderr).text();
    expect(await spawnRunner.exited).toBe(70);
    await Promise.all([spawnStdout, spawnStderr]);
    expect(existsSync(modelStarted)).toBe(false);
    expect(existsSync(spawnFailure.outputPath)).toBe(false);
    expect(receipt(spawnFailure.receiptPath)).toMatchObject({
      status: "child-failed",
      preflight: { status: "passed" },
    });

    makeExecutable("claude");
    const retry = options("claude", "post-reservation-retry");
    expect((await runLane(laneOf(retry))).exitCode).toBe(0);
    expect(receipt(retry.receiptPath).status).toBe("complete");
  });

  it("records a shared git refusal like a preflight failure and starts no provider", async () => {
    const shared = join(scratch, "repo[1]");
    const lane = join(scratch, "lane");
    gitRepository(gitEnv(), shared);
    git(gitEnv(), "-C", shared, "worktree", "add", "-q", "-b", "lane", lane);
    const preflightStarted = join(scratch, "refused-preflight.started");
    const modelStarted = join(scratch, "refused-model.started");
    process.env.FAKE_PREFLIGHT_STARTED_PATH = preflightStarted;
    process.env.FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = { ...options("claude"), mode: "isolated-write" as const, cwd: lane };
    const exitCode = await main(runnerArgs(input).slice(1), Date.now(), {
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(70);
    const refused = receipt(input.receiptPath);
    expect(refused.status).toBe("child-failed");
    expect(refused.preflight.status).toBe("not-run");
    expect(refused.error?.message).toContain("contains a glob or control character");
    expect(existsSync(preflightStarted)).toBe(false);
    expect(existsSync(modelStarted)).toBe(false);
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("rejects same-provider recursion", () => {
    const input = { ...options("claude"), parent: "claude" as const };
    expect(() => laneOf(input)).toThrow("native to parent");
  });

  it("rejects a versioned Claude family before it can stay pinned", () => {
    const input = { ...options("claude"), model: "claude-fable-9-9" };
    expect(() => laneOf(input)).toThrow(
      "normalize it to fable before invoking the runner"
    );
    expect(existsSync(input.outputPath)).toBe(false);
    expect(existsSync(input.receiptPath)).toBe(false);
  });
});

describe("childEnvironment", () => {
  it("removes only inherited runtime identity needed to avoid nested detection", () => {
    const source = {
      PATH: "/bin",
      CODEX_THREAD_ID: "codex",
      CODEX_CI: "1",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      KEEP_ME: "yes",
    };
    expect(childEnvironment(laneOf({ ...options("claude"), mode: "read-only" }), source)).toEqual({
      PATH: "/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      KEEP_ME: "yes",
    });
    expect(childEnvironment(laneOf({ ...options("codex"), mode: "read-only" }), source)).toEqual({
      PATH: "/bin",
      CODEX_THREAD_ID: "codex",
      CODEX_CI: "1",
      KEEP_ME: "yes",
    });
  });

  it("drops GIT_* only for a Claude writer", () => {
    const source = { PATH: "/bin", GIT_DIR: "/elsewhere/.git", GIT_WORK_TREE: "/elsewhere" };
    expect(childEnvironment(laneOf({ ...options("claude"), mode: "isolated-write" }), source)).toEqual({ PATH: "/bin" });
    expect(childEnvironment(laneOf({ ...options("claude"), mode: "read-only" }), source)).toEqual(source);
    expect(childEnvironment(laneOf({ ...options("codex"), mode: "isolated-write" }), source)).toEqual(source);
  });
});

describe("discoverSharedGitDir", () => {
  const cancellation = { promise: new Promise<never>(() => {}), signal: null, dispose() {} };

  it("uses git's answer and refuses what it cannot deny literally", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pstack-shared-git-")));
    const env = gitEnv(dirname(root));
    const discover = (cwd: string) => discoverSharedGitDir(cwd, env, null, cancellation);
    try {
      const main = join(root, "main");
      const linked = join(root, "linked");
      const shared = { kind: "found", sharedGitDir: join(main, ".git") } as const;
      const none = { kind: "found", sharedGitDir: null } as const;
      gitRepository(env, main);
      git(env, "-C", main, "worktree", "add", "-q", "-b", "lane", linked);
      mkdirSync(join(linked, "sub"));

      expect(await discover(linked)).toEqual(shared);
      expect(await discover(join(linked, "sub"))).toEqual(shared);
      expect(await discover(main)).toEqual(none);
      expect(await discover(root)).toEqual(none);

      // An empty .git directory is not a repository to git, which keeps searching upward.
      mkdirSync(join(linked, "sub", ".git"));
      expect(await discover(join(linked, "sub"))).toEqual(shared);

      // The gitdir names the main repository through a symlink; the deny is the real directory.
      symlinkSync(main, join(root, "alias"));
      const aliased = join(root, "alias", ".git", "worktrees", "linked");
      writeFileSync(join(linked, ".git"), `gitdir: ${aliased}\n`);
      expect(await discover(linked)).toEqual(shared);

      const bare = join(root, "bare.git");
      git(env, "clone", "-q", "--bare", main, bare);
      git(env, "-C", bare, "worktree", "add", "-q", join(bare, "nested"));
      expect(await discover(join(bare, "nested"))).toMatchObject({
        kind: "refused",
        status: "child-failed",
        message: expect.stringContaining("is inside its shared git directory"),
      });

      const bracketed = join(root, "repo[1]");
      gitRepository(env, bracketed);
      const bracketedLane = join(root, "bracketed-lane");
      git(env, "-C", bracketed, "worktree", "add", "-q", "-b", "lane", bracketedLane);
      expect(await discover(bracketedLane)).toMatchObject({
        kind: "refused",
        status: "child-failed",
        message: expect.stringContaining("contains a glob or control character"),
      });

      // A .git file naming a missing directory is a broken repository, not a non-repository.
      writeFileSync(join(linked, ".git"), `gitdir: ${join(root, "missing")}\n`);
      expect(await discover(linked)).toMatchObject({ kind: "refused", status: "child-failed" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
