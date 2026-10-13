import type { Effort } from "../types.ts";
import type { RollingAlias } from "./contract.ts";
import type { ADAPTERS } from "./providers.ts";

export type ProviderId = (typeof ADAPTERS)[number]["id"];

export interface KeptPredecessor {
  readonly model: string;
  /** The efforts setup accepts for this model today. Never inherited implicitly from the current model. */
  readonly efforts: readonly Effort[];
}

export interface FamilyEntry {
  /** The key role defaults name. A Claude family's native agents are stack-<name>-<effort>. */
  readonly name: string;
  /** The matrix label. */
  readonly label: string;
  readonly provider: ProviderId;
  /** The descriptor's model component. */
  readonly model: string;
  readonly efforts: readonly Effort[];
  readonly defaultEffort: Effort;
  /** Cursor's selector for the same choice, kept for sync review. */
  readonly upstream: string | null;
  /** Present for Claude rolling aliases. Drives report matching and read-time normalization. */
  readonly rolling?: RollingAlias;
  readonly predecessors?: readonly KeptPredecessor[];
}

export type LaneDefault<F extends string> = F | "inherit-parent" | "auto";

/** One model-sheet line: the role label users write, and its lanes in order. */
export interface RoleDefault<F extends string = string> {
  readonly role: string;
  readonly lanes: readonly LaneDefault<F>[];
}

/** A pair any model-matrix revision on main contained, and the family it must keep resolving to. */
export interface ReleasedPair<F extends string = string> {
  readonly pair: `${ProviderId}:${string}`;
  readonly family: F;
}

export function family<const F extends FamilyEntry>(entry: F): F {
  return entry;
}
