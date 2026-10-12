import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Lane, LaunchFacts, ParseResult } from "./registry/index.ts";
import {
  ERROR_EVIDENCE_LIMIT,
  evidence,
  modelFailureStatus,
  PARENTS,
  type ReceiptStatus,
  type RunnerReceipt,
  UsageError,
} from "./types.ts";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelledBy: CancellationSignal | null;
}

type CancellationSignal = "SIGINT" | "SIGTERM";

interface RunCancellation {
  readonly promise: Promise<CancellationSignal>;
  readonly signal: CancellationSignal | null;
  dispose(): void;
}

type RetryWaitResult = "ready" | "cancelled" | "timed-out";

export interface RunResult {
  readonly exitCode: number;
  readonly receipt: RunnerReceipt;
}

// A provider's terminal event ends its stream, so malformed output keeps the tail.
function trailingEvidence(value: string): string {
  return value.trim().slice(-ERROR_EVIDENCE_LIMIT);
}

function removeIfExists(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

function reserve(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "wx", 0o600);
  closeSync(descriptor);
}

interface ModelStreams {
  readonly stdout: number;
  readonly stderr: number;
}

function modelStreamPaths(receiptPath: string): { stdoutPath: string; stderrPath: string } {
  return { stdoutPath: `${receiptPath}.stdout`, stderrPath: `${receiptPath}.stderr` };
}

function reserveOutputs(lane: Lane): ModelStreams {
  const { stdoutPath, stderrPath } = modelStreamPaths(lane.receiptPath);
  const paths = [lane.outputPath, lane.receiptPath, stdoutPath, stderrPath];
  const resolved = paths.map((path) => resolve(path));
  if (new Set(resolved).size !== paths.length || resolved.includes(resolve(lane.promptPath))) {
    throw new UsageError("prompt, output, receipt, and stream paths must be distinct");
  }
  const created: string[] = [];
  let stdout: number | null = null;
  try {
    for (const path of paths.slice(0, 2)) {
      reserve(path);
      created.push(path);
    }
    stdout = openSync(stdoutPath, "wx", 0o600);
    created.push(stdoutPath);
    const stderr = openSync(stderrPath, "wx", 0o600);
    return { stdout, stderr };
  } catch (error) {
    if (stdout !== null) closeSync(stdout);
    for (const path of created) removeIfExists(path);
    throw error;
  }
}

function writeReceipt(path: string, receipt: RunnerReceipt): void {
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function installRunCancellation(): RunCancellation {
  let signal: CancellationSignal | null = null;
  let resolveCancellation!: (value: CancellationSignal) => void;
  const promise = new Promise<CancellationSignal>((resolve) => {
    resolveCancellation = resolve;
  });

  const receive = (next: CancellationSignal): void => {
    if (signal === null) {
      signal = next;
      resolveCancellation(next);
    }
  };
  const onInterrupt = (): void => receive("SIGINT");
  const onTerminate = (): void => receive("SIGTERM");
  globalThis.process.on("SIGINT", onInterrupt);
  globalThis.process.on("SIGTERM", onTerminate);

  return {
    promise,
    get signal() {
      return signal;
    },
    dispose() {
      globalThis.process.off("SIGINT", onInterrupt);
      globalThis.process.off("SIGTERM", onTerminate);
    },
  };
}

// The adapter's policy applies first; the parent's identity markers are always dropped, so the
// child cannot detect a nested harness.
export function childEnvironment(
  lane: Lane,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const policy = lane.adapter.environment(lane.access);
  const keep = policy.kind === "allowlist"
    ? (key: string) => policy.names.includes(key) || policy.prefixes.some((prefix) => key.startsWith(prefix))
    : (key: string) => !policy.dropPrefixes.some((prefix) => key.startsWith(prefix));
  const result = Object.fromEntries(Object.entries(source).filter(([key]) => keep(key)));
  for (const key of PARENTS[lane.parent].identity) delete result[key];
  return result;
}

async function terminate(
  child: Bun.Subprocess,
  signal: CancellationSignal = "SIGTERM"
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return false;
  child.kill(signal);
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let exited: boolean;
  try {
    exited = await Promise.race([
      child.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        graceTimer = setTimeout(() => resolve(false), 1_000);
      }),
    ]);
  } finally {
    if (graceTimer !== null) clearTimeout(graceTimer);
  }
  if (!exited) {
    child.kill("SIGKILL");
    await child.exited;
  }
  return true;
}

interface StreamCapture {
  readonly result: Promise<string>;
  cancel(): Promise<void>;
}

function captureStream(stream: ReadableStream<Uint8Array>, descriptor?: number): StreamCapture {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let cancellationRequested = false;

  const result = (async (): Promise<string> => {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (descriptor !== undefined) {
          let offset = 0;
          while (offset < next.value.byteLength) {
            offset += writeSync(descriptor, next.value, offset, next.value.byteLength - offset);
          }
        }
        text += decoder.decode(next.value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } catch (error) {
      text += decoder.decode();
      if (!cancellationRequested) throw error;
      return text;
    } finally {
      reader.releaseLock();
    }
  })();

  return {
    result,
    async cancel() {
      cancellationRequested = true;
      try {
        await reader.cancel();
      } catch {
        // The stream may already be closed and its reader released.
      }
    },
  };
}

type ProcessEvent =
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "cancelled"; readonly signal: CancellationSignal }
  | { readonly kind: "timed-out" };

async function runProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  prompt: string | null,
  deadlineAt: number | null,
  cancellation: RunCancellation,
  streamFiles?: ModelStreams
): Promise<ProcessResult> {
  const child = Bun.spawn([executable, ...args], {
    cwd,
    env,
    stdin: prompt === null ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  const stdoutCapture = captureStream(child.stdout, streamFiles?.stdout);
  const stderrCapture = captureStream(child.stderr, streamFiles?.stderr);
  const streams = Promise.all([stdoutCapture.result, stderrCapture.result]);
  const exited = child.exited.then((exitCode): ProcessEvent => ({
    kind: "exited",
    exitCode,
  }));
  const cancelled = cancellation.promise.then((signal): ProcessEvent => ({
    kind: "cancelled",
    signal,
  }));
  const deadline: Promise<ProcessEvent> | null = deadlineAt === null
    ? null
    : new Promise((resolve) => {
      const arm = (): void => {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) {
          resolve({ kind: "timed-out" });
          return;
        }
        deadlineTimer = setTimeout(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
      };
      arm();
    });
  try {
    if (prompt !== null) {
      const stdin = child.stdin;
      if (stdin === undefined) throw new Error("child stdin pipe was not created");
      stdin.write(prompt);
      stdin.end();
    }

    const completions = [exited, cancelled, streams.then(() => exited)];
    if (deadline !== null) completions.push(deadline);
    const first = await Promise.race(completions);

    let outcome = first;
    let captured: readonly [string, string] | null = null;
    let signalSent: CancellationSignal | null = null;

    if (first.kind === "exited") {
      const drains: Array<Promise<
        | { readonly kind: "drained"; readonly captured: readonly [string, string] }
        | ProcessEvent
      >> = [
        streams.then((value) => ({ kind: "drained" as const, captured: value })),
        cancelled,
      ];
      if (deadline !== null) drains.push(deadline);
      const drain = await Promise.race(drains);
      if (drain.kind === "drained") {
        captured = drain.captured;
        if (deadlineAt !== null && Date.now() >= deadlineAt) {
          outcome = { kind: "timed-out" };
        }
      } else {
        outcome = drain;
      }
    }

    const cancelledBy = cancellation.signal;
    const timedOut = cancelledBy === null && outcome.kind === "timed-out";
    if (cancelledBy !== null) {
      if (await terminate(child, cancelledBy)) signalSent = cancelledBy;
    } else if (timedOut) {
      if (await terminate(child)) signalSent = "SIGTERM";
    }
    if (captured === null) {
      await Promise.all([stdoutCapture.cancel(), stderrCapture.cancel()]);
      captured = await streams;
    }

    return {
      exitCode: await child.exited,
      signal: signalSent,
      stdout: captured[0],
      stderr: captured[1],
      timedOut,
      cancelledBy,
    };
  } catch (error) {
    await terminate(child, cancellation.signal ?? "SIGTERM");
    await Promise.all([stdoutCapture.cancel(), stderrCapture.cancel()]);
    await Promise.allSettled([stdoutCapture.result, stderrCapture.result]);
    throw error;
  } finally {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  }
}

async function waitForPreflightRetry(
  delayMs: number,
  deadlineAt: number | null,
  cancellation: RunCancellation
): Promise<RetryWaitResult> {
  if (cancellation.signal !== null) return "cancelled";

  const now = Date.now();
  if (deadlineAt !== null && now >= deadlineAt) return "timed-out";

  const retryAt = now + delayMs;
  const wakeAt = deadlineAt === null ? retryAt : Math.min(retryAt, deadlineAt);
  const timerResult: RetryWaitResult = wakeAt < retryAt ? "timed-out" : "ready";
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      cancellation.promise.then((): RetryWaitResult => "cancelled"),
      new Promise<RetryWaitResult>((resolve) => {
        timer = setTimeout(() => resolve(timerResult), wakeAt - now);
      }),
    ]);
    if (cancellation.signal !== null) return "cancelled";
    if (deadlineAt !== null && Date.now() >= deadlineAt) return "timed-out";
    return result;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

type SharedGitDiscovery =
  | { readonly kind: "found"; readonly sharedGitDir: string | null }
  | {
    readonly kind: "refused";
    readonly status: ReceiptStatus;
    readonly message: string;
    readonly evidence: string;
    readonly exitCode: number | null;
    readonly signal: string | null;
  };

// Older git has no --path-format, so a relative answer is resolved against the cwd.
const GIT_COMMON_DIR = ["rev-parse", "--git-common-dir"] as const;

function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

// A linked worktree keeps its refs, objects and index in a git directory outside the cwd. Git
// itself finds that directory, from the cwd and with the writer's environment, so the deny matches
// what the writer's own git will use. Returns null for a non-repository or a directory the cwd
// contains, and refuses whatever cannot be denied literally: denyWrite entries are globs that
// cannot be escaped, and Claude Code 2.1.288 on Linux drops entries containing * ? [ ].
export async function discoverSharedGitDir(
  cwd: string,
  env: NodeJS.ProcessEnv,
  deadlineAt: number | null,
  cancellation: RunCancellation
): Promise<SharedGitDiscovery> {
  const refuse = (
    status: ReceiptStatus,
    message: string,
    result: ProcessResult | null = null
  ): SharedGitDiscovery => ({
    kind: "refused",
    status,
    message,
    evidence: result === null ? "" : evidence(`${result.stdout}\n${result.stderr}`),
    exitCode: result?.exitCode ?? null,
    signal: result?.signal ?? null,
  });
  const git = Bun.which("git", { PATH: env.PATH, cwd });
  if (git === null) {
    return refuse(
      "unavailable-cli",
      "git executable not found, so the shared git directory cannot be found"
    );
  }
  // The C locale keeps git's "not a git repository" message in the English the check reads.
  const result = await runProcess(
    git,
    GIT_COMMON_DIR,
    cwd,
    { ...env, LC_ALL: "C" },
    null,
    deadlineAt,
    cancellation
  );
  if (result.cancelledBy !== null) {
    return refuse(
      "cancelled",
      `launcher received ${result.cancelledBy} during shared git directory discovery`,
      result
    );
  }
  if (result.timedOut) {
    return refuse("timed-out", "shared git directory discovery timed out", result);
  }
  // Only git's "searched and found nothing" answer means no repository. A .git that names a
  // missing or malformed git directory fails with other wording and is refused.
  const notARepository =
    /^fatal: not a git repository \(or any (of the parent directories|parent up to mount point)/m;
  if (result.exitCode === 128 && notARepository.test(result.stderr)) {
    return { kind: "found", sharedGitDir: null };
  }
  const reported = result.stdout.replace(/\n$/, "");
  if (result.exitCode !== 0 || reported.length === 0) {
    return refuse(
      "child-failed",
      `git rev-parse --git-common-dir exited with status ${result.exitCode}`,
      result
    );
  }
  let root: string;
  let shared: string;
  try {
    root = realpathSync(cwd);
    shared = realpathSync(resolve(root, reported));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return refuse("child-failed", `cannot resolve the shared git directory: ${message}`, result);
  }
  if (within(root, shared)) return { kind: "found", sharedGitDir: null };
  if (within(shared, root)) {
    return refuse(
      "child-failed",
      `cwd ${JSON.stringify(root)} is inside its shared git directory ${JSON.stringify(shared)}, ` +
        "so the Claude writer sandbox cannot deny that directory without denying the cwd",
      result
    );
  }
  if (/[*?[\]{}\u0000-\u001f\u007f]/.test(shared)) {
    return refuse(
      "child-failed",
      `shared git directory ${JSON.stringify(shared)} contains a glob or control character, ` +
        "so the Claude writer sandbox cannot deny it literally",
      result
    );
  }
  return { kind: "found", sharedGitDir: shared };
}

function retriedPreflightEvidence(
  first: string,
  second: string,
  secondPassed: boolean
): string {
  const firstLabel = "attempt 1 failed:\n";
  const secondLabel = `\n\nattempt 2 ${secondPassed ? "passed" : "failed"}:\n`;
  const payloadLimit = ERROR_EVIDENCE_LIMIT - firstLabel.length - secondLabel.length;
  const firstLimit = Math.floor(payloadLimit / 2);
  const secondLimit = payloadLimit - firstLimit;
  return `${firstLabel}${first.slice(0, firstLimit)}${secondLabel}${second.slice(0, secondLimit)}`;
}

function statusExitCode(status: ReceiptStatus): number {
  switch (status) {
    case "complete":
      return 0;
    case "cancelled":
      return 130;
    case "malformed-output":
      return 65;
    case "unavailable-cli":
    case "unavailable-model":
      return 69;
    case "child-failed":
      return 70;
    case "unauthenticated":
      return 77;
    case "timed-out":
      return 124;
  }
}

function modelProof(
  lane: Lane,
  reported: string | null
): {
  readonly reportedModel: string | null;
  readonly modelVerified: boolean;
  readonly modelEvidence: "provider-report" | "pinned-argv" | null;
} {
  if (reported !== null && lane.adapter.proof.matches(lane, reported)) {
    return {
      reportedModel: reported,
      modelVerified: true,
      modelEvidence: "provider-report",
    };
  }
  if (reported === null && lane.adapter.proof.report === "absent") {
    return {
      reportedModel: null,
      modelVerified: false,
      modelEvidence: "pinned-argv",
    };
  }
  return {
    reportedModel: reported,
    modelVerified: false,
    modelEvidence: null,
  };
}

function completeReceipt(
  lane: Lane,
  partial: Omit<RunnerReceipt, "schemaVersion" | "parent" | "provider" | "model" | "effort" | "mode" | "cwd" | "promptPath" | "outputPath" | "stdoutPath" | "stderrPath">
): RunnerReceipt {
  return {
    schemaVersion: 1,
    parent: lane.parent,
    provider: lane.adapter.id,
    model: lane.model,
    effort: lane.effort,
    mode: lane.access.mode,
    cwd: lane.cwd,
    promptPath: lane.promptPath,
    outputPath: lane.outputPath,
    ...modelStreamPaths(lane.receiptPath),
    ...partial,
  };
}

function validateLane(lane: Lane): void {
  if (
    lane.timeoutMs !== null &&
    (!Number.isFinite(lane.timeoutMs) || lane.timeoutMs <= 0)
  ) {
    throw new UsageError("timeout must be greater than zero");
  }
  if (!existsSync(lane.promptPath) || !statSync(lane.promptPath).isFile()) {
    throw new UsageError(`prompt is not a file: ${lane.promptPath}`);
  }
  if (!existsSync(lane.cwd) || !statSync(lane.cwd).isDirectory()) {
    throw new UsageError(`cwd is not a directory: ${lane.cwd}`);
  }
  if (
    lane.promptPath === lane.outputPath ||
    lane.promptPath === lane.receiptPath
  ) {
    throw new UsageError("prompt, output, and receipt paths must be distinct");
  }
}

interface LaneProgress {
  executable: string | null;
  preflight: RunnerReceipt["preflight"];
  argv: readonly string[];
}

async function executeLane(
  lane: Lane,
  cancellation: RunCancellation,
  started: number,
  deadlineAt: number | null,
  launchArgs: readonly string[],
  progress: LaneProgress,
  streamFiles: ModelStreams
): Promise<RunResult> {
  const { adapter } = lane;
  const startedAt = new Date(started).toISOString();
  const prompt = readFileSync(lane.promptPath, "utf8");
  const parentNetworkDisabled = lane.parent === "codex"
    && process.env.CODEX_SANDBOX_NETWORK_DISABLED === "1";
  const env = childEnvironment(lane);
  const executable = Bun.which(adapter.executable, {
    PATH: env.PATH,
    cwd: lane.cwd,
  });
  progress.executable = executable;
  progress.argv = [executable ?? adapter.executable, ...launchArgs];

  let preflightState = progress.preflight;
  let receipt: RunnerReceipt;

  const finishWithoutChild = (
    status: "cancelled" | "timed-out",
    phase: string
  ): RunResult => {
    const completed = Date.now();
    const receivedSignal = status === "cancelled" ? cancellation.signal : null;
    const terminalPreflight = preflightState.status === "not-run"
      ? { ...preflightState, status }
      : preflightState;
    receipt = completeReceipt(lane, {
      status,
      startedAt,
      completedAt: new Date(completed).toISOString(),
      elapsedMs: completed - started,
      executable,
      preflight: terminalPreflight,
      argv: [executable ?? adapter.executable, ...launchArgs],
      exitCode: null,
      signal: null,
      reportedModel: null,
      modelVerified: false,
      modelEvidence: null,
      sessionId: null,
      usage: null,
      costUsd: null,
      error: {
        message: receivedSignal === null
          ? `explicit deadline elapsed ${phase}`
          : `launcher received ${receivedSignal} ${phase}`,
        evidence: "",
      },
    });
    removeIfExists(lane.outputPath);
    writeReceipt(lane.receiptPath, receipt);
    return { exitCode: statusExitCode(status), receipt };
  };

  if (cancellation.signal !== null) {
    return finishWithoutChild("cancelled", "before authentication preflight");
  }
  if (deadlineAt !== null && Date.now() >= deadlineAt) {
    return finishWithoutChild("timed-out", "before authentication preflight");
  }

  if (executable === null) {
    const completed = Date.now();
    receipt = completeReceipt(lane, {
      status: "unavailable-cli",
      startedAt,
      completedAt: new Date(completed).toISOString(),
      elapsedMs: completed - started,
      executable: null,
      preflight: preflightState,
      argv: [adapter.executable, ...launchArgs],
      exitCode: null,
      signal: null,
      reportedModel: null,
      modelVerified: false,
      modelEvidence: null,
      sessionId: null,
      usage: null,
      costUsd: null,
      error: {
        message: `${adapter.executable} executable not found`,
        evidence: "",
      },
    });
    removeIfExists(lane.outputPath);
    writeReceipt(lane.receiptPath, receipt);
    return { exitCode: statusExitCode(receipt.status), receipt };
  }

  if (adapter.launch.needsSharedGitDir(lane.access)) {
    const discovery = await discoverSharedGitDir(lane.cwd, env, deadlineAt, cancellation);
    if (discovery.kind === "refused") {
      const completed = Date.now();
      receipt = completeReceipt(lane, {
        status: discovery.status,
        startedAt,
        completedAt: new Date(completed).toISOString(),
        elapsedMs: completed - started,
        executable,
        preflight: discovery.status === "cancelled" || discovery.status === "timed-out"
          ? { ...preflightState, status: discovery.status }
          : preflightState,
        argv: [executable, ...launchArgs],
        exitCode: discovery.exitCode,
        signal: discovery.signal,
        reportedModel: null,
        modelVerified: false,
        modelEvidence: null,
        sessionId: null,
        usage: null,
        costUsd: null,
        error: { message: discovery.message, evidence: discovery.evidence },
      });
      removeIfExists(lane.outputPath);
      writeReceipt(lane.receiptPath, receipt);
      return { exitCode: statusExitCode(discovery.status), receipt };
    }
    const facts: LaunchFacts = { sharedGitDir: discovery.sharedGitDir };
    launchArgs = adapter.launch.argv(lane, facts);
    progress.argv = [executable, ...launchArgs];
  }

  const preflight = adapter.preflight;
  const preflightArgs = preflight.argv(lane);
  const runPreflight = async () => {
    const run = await runProcess(executable, preflightArgs, lane.cwd, env, null, deadlineAt, cancellation);
    const verdict = preflight.classify(run, lane);
    const passed = !run.timedOut && verdict.kind === "passed";
    const raw = evidence(`${run.stdout}\n${run.stderr}`);
    return { run, verdict, passed, raw, shown: verdict.kind === "passed" && passed ? verdict.evidence : raw };
  };
  let attempt = await runPreflight();
  let preflightEvidence = attempt.shown;

  // The only retry an adapter can request is one more preflight after an "unauthenticated" verdict.
  if (
    preflight.retryAfterUnauthenticatedMs !== null &&
    attempt.verdict.kind === "unauthenticated" &&
    attempt.run.cancelledBy === null &&
    !attempt.run.timedOut
  ) {
    preflightState = {
      argv: [executable, ...preflightArgs],
      status: "failed",
      evidence: attempt.raw,
    };
    progress.preflight = preflightState;

    const retryWait = await waitForPreflightRetry(
      preflight.retryAfterUnauthenticatedMs,
      deadlineAt,
      cancellation
    );
    if (retryWait !== "ready") {
      preflightState = {
        ...preflightState,
        status: retryWait === "cancelled" ? "cancelled" : "timed-out",
      };
      progress.preflight = preflightState;
      return finishWithoutChild(
        retryWait === "cancelled" ? "cancelled" : "timed-out",
        "during authentication preflight retry delay"
      );
    }

    const firstPreflightEvidence = attempt.raw;
    attempt = await runPreflight();
    preflightEvidence = retriedPreflightEvidence(firstPreflightEvidence, attempt.shown, attempt.passed);
  }

  const preflightResult = attempt.run;
  preflightState = {
    argv: [executable, ...preflightArgs],
    status: preflightResult.cancelledBy !== null
      ? "cancelled"
      : preflightResult.timedOut
        ? "timed-out"
        : attempt.passed
          ? "passed"
          : "failed",
    evidence: preflightEvidence,
  };
  progress.preflight = preflightState;

  if (preflightState.status !== "passed") {
    const completed = Date.now();
    const status: ReceiptStatus = preflightResult.cancelledBy !== null
      ? "cancelled"
      : preflightResult.timedOut
        ? "timed-out"
        : attempt.verdict.kind === "unavailable-model"
          ? "unavailable-model"
          : "unauthenticated";
    receipt = completeReceipt(lane, {
      status,
      startedAt,
      completedAt: new Date(completed).toISOString(),
      elapsedMs: completed - started,
      executable,
      preflight: preflightState,
      argv: [executable, ...launchArgs],
      exitCode: preflightResult.exitCode,
      signal: preflightResult.signal,
      reportedModel: null,
      modelVerified: false,
      modelEvidence: null,
      sessionId: null,
      usage: null,
      costUsd: null,
      error: {
        message: preflightResult.cancelledBy !== null
          ? `launcher received ${preflightResult.cancelledBy} during preflight`
          : preflightResult.timedOut
            ? "authentication preflight timed out"
            : "authentication or model preflight failed",
        evidence: preflightEvidence,
      },
    });
    removeIfExists(lane.outputPath);
    writeReceipt(lane.receiptPath, receipt);
    return { exitCode: statusExitCode(status), receipt };
  }

  if (cancellation.signal !== null) {
    return finishWithoutChild("cancelled", "before model execution");
  }
  if (deadlineAt !== null && Date.now() >= deadlineAt) {
    return finishWithoutChild("timed-out", "before model execution");
  }

  const result = await runProcess(
    executable,
    launchArgs,
    lane.cwd,
    env,
    adapter.launch.prompt === "stdin" ? prompt : null,
    deadlineAt,
    cancellation,
    streamFiles
  );
  const completed = Date.now();
  const base = {
    startedAt,
    completedAt: new Date(completed).toISOString(),
    elapsedMs: completed - started,
    executable,
    preflight: preflightState,
    argv: [executable, ...launchArgs],
    exitCode: result.exitCode,
    signal: result.signal,
  } as const;

  const parsed: ParseResult | null = result.cancelledBy === null && !result.timedOut
    ? adapter.parse(result, lane)
    : null;
  const providerFailure = parsed?.kind === "provider-failure" ? parsed : null;
  const metadata = providerFailure?.metadata
    ?? (result.exitCode === 0 && parsed?.kind === "complete" ? parsed.metadata : null);
  if (result.cancelledBy !== null || result.timedOut || providerFailure !== null
      || result.exitCode !== 0) {
    const rawFailureEvidence = `${result.stderr}\n${result.stdout}`;
    const status: ReceiptStatus = result.cancelledBy !== null
      ? "cancelled"
      : result.timedOut
        ? "timed-out"
        : providerFailure?.status ?? modelFailureStatus(rawFailureEvidence);
    const sandboxHint = status === "child-failed" && providerFailure === null && parentNetworkDisabled
      ? "likely cause: Codex parent sandbox has network disabled; see provider-dispatch.md#host-and-parent-prerequisites"
      : null;
    const failureEvidence = evidence(providerFailure !== null
      ? `${providerFailure.message}\n${rawFailureEvidence}`
      : sandboxHint !== null
        ? `${sandboxHint}\n${rawFailureEvidence}`
        : rawFailureEvidence);
    receipt = completeReceipt(lane, {
      ...base,
      status,
      ...(metadata === null
        ? { reportedModel: null, modelVerified: false, modelEvidence: null }
        : modelProof(lane, metadata.reportedModel)),
      sessionId: metadata?.sessionId ?? null,
      usage: metadata?.usage ?? null,
      costUsd: metadata?.costUsd ?? null,
      error: {
        message: result.cancelledBy !== null
          ? result.signal === result.cancelledBy
            ? `launcher received ${result.cancelledBy}; signal was sent to child`
            : `launcher received ${result.cancelledBy} after child exited`
          : result.timedOut
            ? `launcher exceeded the explicit ${lane.timeoutMs}ms deadline`
            : providerFailure?.message ?? `child exited with status ${result.exitCode}${sandboxHint === null ? "" : `; ${sandboxHint}`}`,
        evidence: failureEvidence,
      },
    });
    removeIfExists(lane.outputPath);
    writeReceipt(lane.receiptPath, receipt);
    return { exitCode: statusExitCode(status), receipt };
  }

  try {
    if (parsed?.kind !== "complete") {
      throw new Error(parsed?.kind === "malformed" ? parsed.message : "provider result was not parsed");
    }
    const proof = modelProof(lane, parsed.metadata.reportedModel);
    if (!proof.modelVerified && proof.modelEvidence !== "pinned-argv") {
      throw new Error(
        `requested model ${lane.model} was not reported by ${adapter.id}`
      );
    }
    writeFileSync(lane.outputPath, parsed.text, { encoding: "utf8", mode: 0o600 });
    receipt = completeReceipt(lane, {
      ...base,
      status: "complete",
      ...proof,
      sessionId: parsed.metadata.sessionId,
      usage: parsed.metadata.usage,
      costUsd: parsed.metadata.costUsd,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    removeIfExists(lane.outputPath);
    receipt = completeReceipt(lane, {
      ...base,
      status: "malformed-output",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: null,
      sessionId: null,
      usage: null,
      costUsd: null,
      error: {
        message,
        evidence: trailingEvidence(`${result.stderr}\n${result.stdout}`),
      },
    });
  }

  writeReceipt(lane.receiptPath, receipt);
  return { exitCode: statusExitCode(receipt.status), receipt };
}

export async function runLane(
  lane: Lane,
  started: number = Date.now()
): Promise<RunResult> {
  validateLane(lane);
  const deadlineAt = lane.timeoutMs === null ? null : started + lane.timeoutMs;
  const launchArgs = lane.adapter.launch.argv(lane, { sharedGitDir: null });
  const progress: LaneProgress = {
    executable: null,
    preflight: {
      argv: [lane.adapter.executable, ...lane.adapter.preflight.argv(lane)],
      status: "not-run",
      evidence: "",
    },
    argv: [lane.adapter.executable, ...launchArgs],
  };
  const cancellation = installRunCancellation();
  let streamFiles: ModelStreams | null = null;
  try {
    streamFiles = reserveOutputs(lane);
    try {
      return await executeLane(
        lane,
        cancellation,
        started,
        deadlineAt,
        launchArgs,
        progress,
        streamFiles
      );
    } catch (error) {
      const completed = Date.now();
      const signal = cancellation.signal;
      const status: ReceiptStatus = signal !== null
        ? "cancelled"
        : deadlineAt !== null && completed >= deadlineAt
          ? "timed-out"
          : "child-failed";
      const message = error instanceof Error ? error.message : String(error);
      const terminalPreflight = progress.preflight.status === "not-run" && status !== "child-failed"
        ? { ...progress.preflight, status }
        : progress.preflight;
      const receipt = completeReceipt(lane, {
        status,
        startedAt: new Date(started).toISOString(),
        completedAt: new Date(completed).toISOString(),
        elapsedMs: completed - started,
        executable: progress.executable,
        preflight: terminalPreflight,
        argv: progress.argv,
        exitCode: null,
        signal: null,
        reportedModel: null,
        modelVerified: false,
        modelEvidence: null,
        sessionId: null,
        usage: null,
        costUsd: null,
        error: {
          message: status === "cancelled"
            ? `launcher received ${signal} after reserving output paths`
            : status === "timed-out"
              ? "explicit deadline elapsed after reserving output paths"
              : "launcher failed after reserving output paths",
          evidence: evidence(message),
        },
      });
      removeIfExists(lane.outputPath);
      writeReceipt(lane.receiptPath, receipt);
      return { exitCode: statusExitCode(status), receipt };
    }
  } finally {
    cancellation.dispose();
    if (streamFiles !== null) {
      closeSync(streamFiles.stdout);
      closeSync(streamFiles.stderr);
    }
  }
}
