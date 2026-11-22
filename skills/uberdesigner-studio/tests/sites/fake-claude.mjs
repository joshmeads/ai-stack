#!/usr/bin/env node
// A stand-in for the Claude Code CLI: answers the inspector's setup checks, records what a change would send
// (system prompt and request) into $CAPTURE_DIR, and sends nothing. The suite never spends tokens.
// A scripted answer: when $CAPTURE_DIR/answer.json exists, the next change gets it as Claude's answer (once; the file
// is removed), so the suite can run a real change through the inspector's write path, then Undo it.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("2.1.325 (Claude Code)");
  process.exit(0);
}
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" }));
  process.exit(0);
}
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const i = args.indexOf("--system-prompt");
  if (process.env.CAPTURE_DIR) writeFileSync(`${process.env.CAPTURE_DIR}/${Date.now()}-${process.pid}.json`, JSON.stringify({ system: i >= 0 ? args[i + 1] : "", input }));
  const scripted = process.env.CAPTURE_DIR ? `${process.env.CAPTURE_DIR}/answer.json` : null;
  if (scripted && existsSync(scripted)) {
    const answer = readFileSync(scripted, "utf8");
    unlinkSync(scripted);
    const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 };
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: answer, usage, total_cost_usd: 0, num_turns: 1 }));
    process.exit(0);
  }
  process.exit(1);
});
