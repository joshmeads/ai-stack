import { claude } from "../providers/claude.ts";
import { codex } from "../providers/codex.ts";

/** The only list of providers. */
export const ADAPTERS = [claude, codex] as const;
