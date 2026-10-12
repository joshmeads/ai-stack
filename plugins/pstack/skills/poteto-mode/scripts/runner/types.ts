/** The two harnesses with a native subagent primitive, and the markers that identify each one. */
export const PARENTS = {
  claude: {
    identity: [
      "CLAUDECODE",
      "CLAUDE_CODE_CHILD_SESSION",
      "CLAUDE_CODE_SESSION_ID",
      "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
    ],
  },
  codex: {
    identity: [
      "CODEX_THREAD_ID",
      "CODEX_SESSION_ID",
      "CODEX_CI",
      "CODEX_SHELL",
      "CODEX_SANDBOX",
      "CODEX_SANDBOX_NETWORK_DISABLED",
      "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    ],
  },
} as const;
/** `default` passes no effort, so the CLI or model uses its own setting. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra", "default"] as const;
export const ACCESS_MODES = ["read-only", "isolated-write"] as const;

export type Parent = keyof typeof PARENTS;
export type Effort = (typeof EFFORTS)[number];
export type AccessMode = (typeof ACCESS_MODES)[number];

export type ReceiptStatus =
  | "complete"
  | "cancelled"
  | "unavailable-cli"
  | "unauthenticated"
  | "unavailable-model"
  | "timed-out"
  | "child-failed"
  | "malformed-output";

export interface NormalizedUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

export interface RunnerReceipt {
  readonly schemaVersion: 1;
  readonly status: ReceiptStatus;
  readonly parent: Parent;
  readonly provider: string;
  readonly model: string;
  readonly effort: Effort;
  readonly mode: AccessMode;
  readonly cwd: string;
  readonly promptPath: string;
  readonly outputPath: string;
  readonly stdoutPath: string | null;
  readonly stderrPath: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly elapsedMs: number;
  readonly executable: string | null;
  readonly preflight: {
    readonly argv: readonly string[];
    readonly status: "passed" | "failed" | "timed-out" | "cancelled" | "not-run";
    readonly evidence: string;
  };
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly reportedModel: string | null;
  readonly modelVerified: boolean;
  readonly modelEvidence: "provider-report" | "pinned-argv" | null;
  readonly sessionId: string | null;
  readonly usage: NormalizedUsage | null;
  readonly costUsd: number | null;
  readonly error: {
    readonly message: string;
    readonly evidence: string;
  } | null;
}

export class UsageError extends Error {}

export const ERROR_EVIDENCE_LIMIT = 4_000;

export function evidence(value: string): string {
  return value.trim().slice(0, ERROR_EVIDENCE_LIMIT);
}

export function modelFailureStatus(value: string): "unavailable-model" | "child-failed" {
  return /model.{0,40}(not found|unknown|unavailable|unsupported|not supported|invalid)|invalid.{0,20}model/i.test(value)
    ? "unavailable-model"
    : "child-failed";
}
