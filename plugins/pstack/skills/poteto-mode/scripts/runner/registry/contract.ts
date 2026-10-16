import {
  type AccessKind,
  type AccessMode,
  type Effort,
  type NormalizedUsage,
  type Parent,
  UsageError,
  type WriterSandbox,
} from "../types.ts";

declare const laneBrand: unique symbol;

/** Full access exists only on a writer, so "read-only with full access" cannot be built. */
export type Access =
  | { readonly mode: "read-only" }
  | { readonly mode: "isolated-write"; readonly sandbox: WriterSandbox };

/** The only Access constructor. A writer is bounded unless the caller passes `full-access`. */
export function access(mode: AccessMode, sandbox: WriterSandbox = "bounded"): Access {
  if (mode === "isolated-write") return { mode, sandbox };
  if (sandbox === "full-access") throw new UsageError("writer sandbox full-access requires mode isolated-write");
  return { mode };
}

export function accessKind(value: Access): AccessKind {
  return value.mode === "isolated-write" && value.sandbox === "full-access" ? "isolated-write-full-access" : value.mode;
}

/** A validated lane. resolveLane is the only constructor, so nothing downstream re-parses strings. */
export interface Lane {
  readonly [laneBrand]: true;
  readonly parent: Parent;
  readonly adapter: ProviderAdapter;
  /** A narrow view, so the contract does not import the adapter list. Null for an unregistered pair. */
  readonly family: {
    readonly name: string;
    readonly label: string;
    readonly model: string;
    readonly rolling: RollingAlias | null;
  } | null;
  /** The descriptor's model component; the receipt's `model`. */
  readonly model: string;
  /** What argv passes. It differs from `model` only for a family whose effort is part of the model ID. */
  readonly cliModel: string;
  readonly effort: Effort;
  readonly access: Access;
  readonly promptPath: string;
  readonly cwd: string;
  readonly outputPath: string;
  readonly receiptPath: string;
  readonly timeoutMs: number | null;
}

/** A rolling alias such as `opus`. Claude resolves it to the newest `claude-opus-<revision>`. */
export interface RollingAlias {
  /** Reports and versioned predecessors look like `<revisionPrefix><digits and hyphens>`. */
  readonly revisionPrefix: `${string}-`;
}

export function isRevision(rolling: RollingAlias, model: string): boolean {
  return model.startsWith(rolling.revisionPrefix)
    && /^[0-9]+(?:-[0-9]+)*$/.test(model.slice(rolling.revisionPrefix.length));
}

/** What one child process left behind. */
export interface ChildRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A model run, with the bytes the CLI wrote to the provider sidecar's output, or null when it wrote none. */
export interface ModelRun extends ChildRun {
  readonly sidecar: string | null;
}

/** Only a preflight can say "unauthenticated" (#142). run.ts records the raw output of a failure.
 *  "inconclusive" is status output the adapter cannot read; run.ts records it as child-failed. */
export type PreflightVerdict =
  | { readonly kind: "passed"; readonly evidence: string }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "unavailable-model" }
  | { readonly kind: "inconclusive" };

export interface ProviderMetadata {
  readonly reportedModel: string | null;
  readonly sessionId: string | null;
  readonly usage: NormalizedUsage | null;
  readonly costUsd: number | null;
}

/** No "unauthenticated" kind: a model's output can quote the child's own work. */
export type ParseResult =
  | { readonly kind: "complete"; readonly text: string; readonly metadata: ProviderMetadata }
  | {
    readonly kind: "provider-failure";
    readonly status: "cancelled" | "child-failed";
    readonly message: string;
    readonly metadata: ProviderMetadata;
  }
  | { readonly kind: "malformed"; readonly message: string };

export type EnvPolicy =
  | {
    readonly kind: "allowlist";
    readonly names: readonly string[];
    readonly prefixes: readonly string[];
    /** Run-owned values, applied after filtering. One replaces an inherited value of the same name. */
    readonly set?: Readonly<Record<string, string>>;
  }
  | { readonly kind: "inherit"; readonly dropPrefixes: readonly string[] };

/** Facts run.ts establishes before argv. Each is null unless the adapter asked for it. */
export interface LaunchFacts {
  readonly sharedGitDir: string | null;
  /** The lane's private provider directory, the absent output path in it and the written config. */
  readonly providerSidecar: {
    readonly directory: string;
    readonly output: string | null;
    readonly config: string | null;
  } | null;
}

/** A private directory run.ts creates next to the receipt (0700). It writes `config` there (0600), creating any
 *  subdirectories in `name` (0700), before the preflight. It passes the absent `output` path and reads that file
 *  after the child exits; a null `output` means the CLI writes no file there. */
export interface ProviderSidecar {
  readonly output: string | null;
  readonly config: { readonly name: string; content(lane: Lane): string } | null;
}

export interface ProviderAdapter {
  /** The descriptor's provider component and the receipt's `provider`. */
  readonly id: string;
  /** Looked up on the child's PATH. Missing → unavailable-cli. */
  readonly executable: string;
  /** "flag": argv carries the effort, and omits the flag for `default`.
   *  "model-id": this provider's family entries map each effort to a CLI model ID.
   *  "config": the sidecar config carries the effort, and omits it for `default`. */
  readonly effortIn: "flag" | "model-id" | "config";
  readonly preflight: {
    /** sidecar is the lane's provider sidecar, already written, or null when the adapter declares none. */
    argv(lane: Lane, sidecar: LaunchFacts["providerSidecar"]): readonly string[];
    /** One more preflight after an "unauthenticated" verdict, after this delay. null means none. */
    readonly retryAfterUnauthenticatedMs: number | null;
    classify(run: ChildRun, lane: Lane): PreflightVerdict;
    /** The exact CLI version the adapter was measured against. run.ts runs `<executable> <argv>` before the
     *  authentication preflight and refuses the lane as unavailable-cli unless the trimmed stdout equals `expected`. */
    readonly version?: { readonly argv: readonly string[]; readonly expected: string };
  };
  readonly launch: {
    /** "stdin": run.ts writes the prompt to stdin. "file": argv carries lane.promptPath. */
    readonly prompt: "stdin" | "file";
    readonly sidecar: ProviderSidecar | null;
    /** resolveLane refuses any other access kind before launch. */
    readonly supports: readonly AccessKind[];
    /** Relative paths that hold the provider's project config, such as hooks; one ending in "/" names a directory
     *  only, any other a directory or a file. run.ts refuses the lane when the cwd or any parent up to the git root
     *  and below the home directory holds one, because the CLI would load that repository-controlled config. */
    readonly projectConfig: readonly string[];
    /** With "stdin" prompts, what run.ts writes instead of the bare prompt. */
    stdinEnvelope?(prompt: string): string;
    needsSharedGitDir(access: Access): boolean;
    /** Omits the effort flag for the `default` effort. */
    argv(lane: Lane, facts: LaunchFacts): readonly string[];
  };
  /** run.ts calls parse for every child that exits by itself. After a nonzero exit it honors only provider-failure. */
  parse(run: ModelRun, lane: Lane): ParseResult;
  readonly proof: {
    /** "absent": the CLI never reports the served model, so the exact argv is the evidence (pinned-argv). */
    readonly report: "required" | "absent";
    matches(lane: Lane, reported: string): boolean;
  };
  /** sidecarDir is the lane's provider directory, or null when the adapter declares no sidecar. */
  environment(access: Access, sidecarDir: string | null): EnvPolicy;
  /** Markdown that render.ts puts into the model catalog's routes and provider notes. */
  readonly docs: {
    readonly name: string;
    readonly hostPrerequisites: readonly string[];
    readonly statePaths: readonly string[];
    readonly notes: readonly string[];
  };
}

/** Keeps the literal id and effort shape, from which the provider list derives ProviderId and family shapes. */
export function adapter<const Id extends string, const E extends ProviderAdapter["effortIn"]>(
  value: ProviderAdapter & { readonly id: Id; readonly effortIn: E }
): ProviderAdapter & { readonly id: Id; readonly effortIn: E } {
  return value;
}
