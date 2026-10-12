import { claude } from "../providers/claude.ts";
import { codex } from "../providers/codex.ts";
import { grok } from "../providers/grok.ts";

/** The only list of providers. */
export const ADAPTERS = [claude, codex, grok] as const;
