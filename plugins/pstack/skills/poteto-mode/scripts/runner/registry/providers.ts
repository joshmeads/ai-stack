import { agy } from "../providers/agy.ts";
import { claude } from "../providers/claude.ts";
import { codex } from "../providers/codex.ts";
import { devin } from "../providers/devin.ts";
import { dsh } from "../providers/dsh.ts";
import { grok } from "../providers/grok.ts";

/** The only list of providers. */
export const ADAPTERS = [claude, codex, grok, devin, dsh, agy] as const;
