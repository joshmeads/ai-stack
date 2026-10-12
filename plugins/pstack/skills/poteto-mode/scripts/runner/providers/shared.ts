import type { ChildRun, Lane, PreflightVerdict } from "../registry/contract.ts";
import { evidence, modelFailureStatus, type NormalizedUsage } from "../types.ts";

export type JsonObject = Record<string, unknown>;

export function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function normalizedUsage(value: unknown): NormalizedUsage | null {
  const usage = object(value);
  if (usage === null) return null;
  const result: NormalizedUsage = {
    inputTokens: finiteNumber(usage.input_tokens),
    cachedInputTokens: finiteNumber(
      usage.cached_input_tokens ?? usage.cache_read_input_tokens
    ),
    cacheCreationInputTokens: finiteNumber(
      usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens
    ),
    outputTokens: finiteNumber(usage.output_tokens),
    reasoningTokens: finiteNumber(
      usage.reasoning_tokens ?? usage.reasoning_output_tokens
    ),
    totalTokens: finiteNumber(usage.total_tokens),
  };
  return Object.values(result).some((entry) => entry !== undefined)
    ? result
    : null;
}

/** The usage key that matches the requested model, else the first one. */
export function modelFromUsage(
  value: unknown,
  lane: Lane,
  matches: (lane: Lane, reported: string) => boolean
): string | null {
  const usage = object(value);
  if (usage === null) return null;
  const models = Object.keys(usage);
  return models.find((model) => matches(lane, model)) ?? models[0] ?? null;
}

/** The requested ID, or the same ID followed by a build suffix. */
export function exactOrSuffixed(lane: Lane, reported: string): boolean {
  return reported === lane.model || reported.startsWith(`${lane.model}-`);
}

/** The flag and value for the lane's effort; nothing for `default`. */
export function effortArgs(lane: Lane, args: readonly string[]): readonly string[] {
  return lane.effort === "default" ? [] : args;
}

// Only preflight output is read for authentication; a failed model call's output can quote
// the child's own work.
const AUTH_FAILURE = /not logged in|not authenticated|unauthenticated|authentication|sign in|login required/i;

/** The failure that preflight text names, or null when it names none. */
export function namedPreflightFailure(value: string): "unauthenticated" | "unavailable-model" | null {
  if (AUTH_FAILURE.test(value)) return "unauthenticated";
  return modelFailureStatus(value) === "unavailable-model" ? "unavailable-model" : null;
}

/** Classifies a failed preflight from its bounded output, with `fallback` when the output names no failure. */
export function failedPreflight(
  run: ChildRun,
  fallback: "unauthenticated" | "unavailable-model"
): PreflightVerdict {
  return { kind: namedPreflightFailure(boundedOutput(run)) ?? fallback };
}

export function boundedOutput(run: ChildRun): string {
  return evidence(`${run.stdout}\n${run.stderr}`);
}
