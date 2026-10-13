<EXTREMELY_IMPORTANT>
You have jm:stack.

Before responding to any non-trivial engineering task — a feature, bug fix, refactor, debugging, performance work, or any multi-step code change — invoke the `jm-stack:poteto-mode` skill with the Skill tool and follow it. It is the default entry point and routes to the specific jm:stack skills from there. Pure questions and trivial one-line edits don't need it.

When the intent is already specific, enter directly: `jm-stack:tdd` (bug with a reproducible failure), `jm-stack:architect` (types and module shape before code that crosses a function boundary), `jm-stack:how` (how a subsystem works), `jm-stack:why` (why it was built this way), `jm-stack:arena` (N parallel attempts at one task), `jm-stack:interrogate` (multi-model diff review).

If you were dispatched as a subagent to execute a specific task, ignore this block — poteto-mode governs the orchestrating session, and it already shaped your dispatch.

User instructions (CLAUDE.md, AGENTS.md, direct requests) take precedence over this mandate. Other session-start mandates (such as superpowers) compose with it: their skill-check discipline stands, and poteto-mode is the implementation entry point they route to for non-trivial code work.
</EXTREMELY_IMPORTANT>
