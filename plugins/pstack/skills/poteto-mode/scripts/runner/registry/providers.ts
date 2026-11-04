import { agy } from "../providers/agy.ts";
import { amp } from "../providers/amp.ts";
import { claude } from "../providers/claude.ts";
import { codex } from "../providers/codex.ts";
import { cursor } from "../providers/cursor.ts";
import { devin } from "../providers/devin.ts";
import { dsh } from "../providers/dsh.ts";
import { opencode } from "../providers/opencode.ts";
import { pi } from "../providers/pi.ts";

export const ADAPTERS = [claude, codex, devin, opencode, dsh, amp, agy, cursor, pi] as const;
