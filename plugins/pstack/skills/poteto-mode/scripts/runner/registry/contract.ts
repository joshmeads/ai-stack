import type { AccessMode, Effort, NormalizedUsage, Parent } from "../types.ts";

declare const laneBrand: unique symbol;

export interface Access {
  readonly mode: AccessMode;
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
  /** The descriptor's model component, passed to the CLI unchanged. */
  readonly model: string;
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

/** Only a preflight can say "unauthenticated" (#142). run.ts records the raw output of a failure. */
export type PreflightVerdict =
  | { readonly kind: "passed"; readonly evidence: string }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "unavailable-model" };

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
  | { readonly kind: "allowlist"; readonly names: readonly string[]; readonly prefixes: readonly string[] }
  | { readonly kind: "inherit"; readonly dropPrefixes: readonly string[] };

/** Facts run.ts establishes before argv. Each is null unless the adapter asked for it. */
export interface LaunchFacts {
  readonly sharedGitDir: string | null;
}

export interface ProviderAdapter {
  /** The descriptor's provider component and the receipt's `provider`. */
  readonly id: string;
  /** Looked up on the child's PATH. Missing → unavailable-cli. */
  readonly executable: string;
  readonly preflight: {
    argv(lane: Lane): readonly string[];
    /** One more preflight after an "unauthenticated" verdict, after this delay. null means none. */
    readonly retryAfterUnauthenticatedMs: number | null;
    classify(run: ChildRun, lane: Lane): PreflightVerdict;
  };
  readonly launch: {
    /** "stdin": run.ts writes the prompt to stdin. "file": argv carries lane.promptPath. */
    readonly prompt: "stdin" | "file";
    needsSharedGitDir(access: Access): boolean;
    /** Omits the effort flag for the `default` effort. */
    argv(lane: Lane, facts: LaunchFacts): readonly string[];
  };
  /** run.ts calls parse for every child that exits by itself. After a nonzero exit it honors only provider-failure. */
  parse(run: ChildRun, lane: Lane): ParseResult;
  readonly proof: {
    /** "absent": the CLI never reports the served model, so the exact argv is the evidence (pinned-argv). */
    readonly report: "required" | "absent";
    matches(lane: Lane, reported: string): boolean;
  };
  environment(access: Access): EnvPolicy;
}

/** Keeps the literal id, from which the provider list derives ProviderId. */
export function adapter<const Id extends string>(
  value: ProviderAdapter & { readonly id: Id }
): ProviderAdapter & { readonly id: Id } {
  return value;
}
